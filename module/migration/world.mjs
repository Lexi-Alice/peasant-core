// Peasant Core world migrations
export const PC_WORLD_MIGRATION_VERSION_SETTING = "worldMigrationVersion";
const PC_WORLD_MIGRATION_NOTABLE_CUSTOM_TAGS = 1;
const PC_WORLD_MIGRATION_DEFENSE_BLOCK = 2;
const PC_WORLD_MIGRATION_DEFENSE_BLOCK_TYPES = 3;
const PC_WORLD_MIGRATION_DEFENSE_BLOCK_CLEANUP = 4;
const PC_WORLD_MIGRATION_CHARACTER_EXPERIMENTAL_REMOVAL = 5;
const PC_WORLD_MIGRATION_LATEST = PC_WORLD_MIGRATION_CHARACTER_EXPERIMENTAL_REMOVAL;
const PC_CHARACTER_TYPES = new Set(["character"]);
const PC_REMOVED_CHARACTER_EXPERIMENTAL_TYPE = "characterExperimental";

function normalizeNotableCombatCustomTagEntry(entry) {
  return {
    name: String(entry?.name ?? "").trim(),
    value: String(entry?.value ?? "").trim()
  };
}

function isPeasantCharacterType(type) {
  return PC_CHARACTER_TYPES.has(String(type ?? "").trim());
}

function isRemovedCharacterExperimentalType(type) {
  return String(type ?? "").trim() === PC_REMOVED_CHARACTER_EXPERIMENTAL_TYPE;
}

function normalizeNotableCombatCustomTags(combat) {
  const customTags = Array.isArray(combat?.customTags)
    ? combat.customTags.map(normalizeNotableCombatCustomTagEntry).filter((tag) => !!tag.name)
    : [];
  if (customTags.length > 0) return customTags;
  const legacyCustomTag = normalizeNotableCombatCustomTagEntry(combat?.customTag || {});
  return legacyCustomTag.name ? [legacyCustomTag] : [];
}

function migrateNotableCombatCustomTags(rawCombats) {
  if (!Array.isArray(rawCombats)) return { combats: rawCombats, changed: false };

  let changed = false;
  const combats = rawCombats.map((combat) => {
    if (!combat || typeof combat !== "object") return combat;

    const normalizedCustomTags = normalizeNotableCombatCustomTags(combat);
    const normalizedCustomTag = normalizedCustomTags[0] ? { ...normalizedCustomTags[0] } : { name: "", value: "" };
    const currentCustomTags = Array.isArray(combat.customTags)
      ? combat.customTags.map(normalizeNotableCombatCustomTagEntry).filter((tag) => !!tag.name)
      : [];
    const currentCustomTag = normalizeNotableCombatCustomTagEntry(combat.customTag || {});

    const tagsChanged = JSON.stringify(currentCustomTags) !== JSON.stringify(normalizedCustomTags);
    const legacyChanged = currentCustomTag.name !== normalizedCustomTag.name || currentCustomTag.value !== normalizedCustomTag.value;
    if (tagsChanged || legacyChanged) changed = true;

    return {
      ...combat,
      customTags: normalizedCustomTags,
      customTag: normalizedCustomTag
    };
  });

  return { combats, changed };
}

function migrateNotableCombatDefenseBlock(rawCombats) {
  if (!Array.isArray(rawCombats)) return { combats: rawCombats, changed: false };

  let changed = false;
  const combats = rawCombats.map((combat) => {
    if (!combat || typeof combat !== "object") return combat;
    const defense = (combat.defense && typeof combat.defense === "object") ? { ...combat.defense } : null;
    if (!defense) return combat;

    const hasBlock = typeof defense.block === "boolean";
    const hasLegacyContactless = typeof defense.contactless === "boolean";
    const legacyContactless = !!defense.contactless;
    const block = hasBlock ? !!defense.block : (hasLegacyContactless ? !legacyContactless : false);
    const hardness = block ? Math.max(0, Number.parseInt(defense.hardness, 10) || 0) : 0;
    const hp = block ? Math.max(0, Number.parseInt(defense.hp, 10) || 0) : 0;
    const migratedDefense = {
      ...defense,
      block,
      hardness,
      hp
    };
    delete migratedDefense.contactless;
    delete migratedDefense.alwaysBraced;

    const defenseChanged = JSON.stringify(defense) !== JSON.stringify(migratedDefense);
    if (defenseChanged) changed = true;

    return {
      ...combat,
      defense: migratedDefense
    };
  });

  return { combats, changed };
}

function migrateNotableCombatDefenseBlockTypes(rawCombats) {
  if (!Array.isArray(rawCombats)) return { combats: rawCombats, changed: false };

  let changed = false;
  const combats = rawCombats.map((combat) => {
    if (!combat || typeof combat !== "object") return combat;
    const defense = (combat.defense && typeof combat.defense === "object") ? { ...combat.defense } : null;
    if (!defense) return combat;

    const block = !!defense.block;
    const blockTypeRaw = String(defense.blockType || "").trim().toLowerCase();
    const blockType = (blockTypeRaw === "weapon" || blockTypeRaw === "mage") ? `${blockTypeRaw.charAt(0).toUpperCase()}${blockTypeRaw.slice(1)}` : "Shield";
    const migratedDefense = {
      ...defense,
      block,
      blockType: block ? blockType : "Shield",
      hardness: block && blockType !== "Mage" ? Math.max(0, Number.parseInt(defense.hardness, 10) || 0) : 0,
      hp: block ? Math.max(0, Number.parseInt(defense.hp, 10) || 0) : 0
    };
    delete migratedDefense.contactless;
    delete migratedDefense.alwaysBraced;

    const defenseChanged = JSON.stringify(defense) !== JSON.stringify(migratedDefense);
    if (defenseChanged) changed = true;

    return {
      ...combat,
      defense: migratedDefense
    };
  });

  return { combats, changed };
}

export async function migrateWorldNotableCombatData() {
  if (!game.user?.isGM) return;

  const currentVersion = Number(game.settings.get("peasant-core", PC_WORLD_MIGRATION_VERSION_SETTING) || 0);
  if (currentVersion >= PC_WORLD_MIGRATION_LATEST) return;

  let migratedActors = 0;
  let migratedActorTypes = 0;
  let hadFailures = false;

  for (const actor of game.actors ?? []) {
    if (
      currentVersion < PC_WORLD_MIGRATION_CHARACTER_EXPERIMENTAL_REMOVAL
      && isRemovedCharacterExperimentalType(actor.type)
    ) {
      try {
        await actor.update({ type: "character" }, { render: false });
        migratedActorTypes += 1;
      } catch (err) {
        hadFailures = true;
        console.error(`Peasant Core | Failed to convert removed experimental actor type for ${actor.name}:`, err);
      }
    }

    if (!isPeasantCharacterType(actor.type)) continue;
    const rawCombats = actor._source?.system?.notableCombats ?? actor.system?.notableCombats;
    let migrationState = { combats: rawCombats, changed: false };

    if (currentVersion < PC_WORLD_MIGRATION_NOTABLE_CUSTOM_TAGS) {
      migrationState = migrateNotableCombatCustomTags(migrationState.combats);
    }
    if (currentVersion < PC_WORLD_MIGRATION_DEFENSE_BLOCK) {
      const defenseMigration = migrateNotableCombatDefenseBlock(migrationState.combats);
      migrationState = {
        combats: defenseMigration.combats,
        changed: migrationState.changed || defenseMigration.changed
      };
    }
    if (currentVersion < PC_WORLD_MIGRATION_DEFENSE_BLOCK_TYPES) {
      const defenseTypeMigration = migrateNotableCombatDefenseBlockTypes(migrationState.combats);
      migrationState = {
        combats: defenseTypeMigration.combats,
        changed: migrationState.changed || defenseTypeMigration.changed
      };
    }
    if (currentVersion < PC_WORLD_MIGRATION_DEFENSE_BLOCK_CLEANUP) {
      const defenseCleanupMigration = migrateNotableCombatDefenseBlockTypes(migrationState.combats);
      migrationState = {
        combats: defenseCleanupMigration.combats,
        changed: migrationState.changed || defenseCleanupMigration.changed
      };
    }

    const { combats, changed } = migrationState;
    if (!changed) continue;

    try {
      await actor.update({ "system.notableCombats": combats }, { render: false });
      migratedActors += 1;
    } catch (err) {
      hadFailures = true;
      console.error(`Peasant Core | Failed to migrate notable combat data for actor ${actor.name}:`, err);
    }
  }

  if (!hadFailures) {
    await game.settings.set("peasant-core", PC_WORLD_MIGRATION_VERSION_SETTING, PC_WORLD_MIGRATION_LATEST);
  }

  if (migratedActors > 0) {
    console.log(`Peasant Core | Migrated notable combat data on ${migratedActors} actor(s).`);
  }
  if (migratedActorTypes > 0) {
    console.log(`Peasant Core | Converted ${migratedActorTypes} removed experimental actor type(s) to character.`);
  }
}
