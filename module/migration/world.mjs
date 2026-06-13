// Peasant Core world migrations
import { normalizeHaltValues } from "../data/actor/combat-modifiers.mjs";
import { normalizeRangeRateValue } from "../data/actor/combat-tags.mjs";
import { parseOptionalInteger } from "../data/actor/helpers.mjs";

export const PC_WORLD_MIGRATION_VERSION_SETTING = "worldMigrationVersion";
const PC_WORLD_MIGRATION_NOTABLE_CUSTOM_TAGS = 1;
const PC_WORLD_MIGRATION_DEFENSE_BLOCK = 2;
const PC_WORLD_MIGRATION_DEFENSE_BLOCK_TYPES = 3;
const PC_WORLD_MIGRATION_DEFENSE_BLOCK_CLEANUP = 4;
const PC_WORLD_MIGRATION_CHARACTER_EXPERIMENTAL_REMOVAL = 5;
const PC_WORLD_MIGRATION_OPTIONAL_NUMBERS = 6;
const PC_WORLD_MIGRATION_STRUCTURED_NUMBERS = 7;
const PC_WORLD_MIGRATION_NOTABLE_COMBAT_IDS = 8;
const PC_WORLD_MIGRATION_LATEST = PC_WORLD_MIGRATION_NOTABLE_COMBAT_IDS;
const PC_CHARACTER_TYPES = new Set(["character"]);
const PC_REMOVED_CHARACTER_EXPERIMENTAL_TYPE = "characterExperimental";

function createNotableCombatId() {
  return foundry?.utils?.randomID?.(16) ?? `combat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function migrateSkillOptionalNumbers(skill) {
  if (!skill || typeof skill !== "object") return { skill, changed: false };
  const migrated = {
    ...skill,
    tohit: parseOptionalInteger(skill.tohit, { min: 1 }),
    accuracy: parseOptionalInteger(skill.accuracy, { allowSign: true }),
    ap: parseOptionalInteger(skill.ap, { min: 0 }),
    sp: parseOptionalInteger(skill.sp, { min: 0 })
  };
  return { skill: migrated, changed: !valuesEqual(skill, migrated) };
}

function migrateCombatOptionalNumbers(combat) {
  if (!combat || typeof combat !== "object") return { combat, changed: false };
  const migrated = {
    ...combat,
    tohit: parseOptionalInteger(combat.tohit, { min: 1 }),
    accuracy: parseOptionalInteger(combat.accuracy, { allowSign: true })
  };
  return { combat: migrated, changed: !valuesEqual(combat, migrated) };
}

function migrateCombatStructuredNumbers(combat) {
  if (!combat || typeof combat !== "object") return { combat, changed: false };
  const migrated = {
    ...combat,
    rangeRate: normalizeRangeRateValue(combat.rangeRate)
  };
  return { combat: migrated, changed: !valuesEqual(combat, migrated) };
}

function migrateSkillsOptionalNumbers(rawSkills) {
  if (!Array.isArray(rawSkills)) return { skills: rawSkills, changed: false };
  let changed = false;
  const skills = rawSkills.map((skill) => {
    const result = migrateSkillOptionalNumbers(skill);
    changed = changed || result.changed;
    return result.skill;
  });
  return { skills, changed };
}

function migrateNotableCombatOptionalNumbers(rawCombats) {
  if (!Array.isArray(rawCombats)) return { combats: rawCombats, changed: false };
  let changed = false;
  const combats = rawCombats.map((combat) => {
    const result = migrateCombatOptionalNumbers(combat);
    changed = changed || result.changed;
    return result.combat;
  });
  return { combats, changed };
}

function migrateNotableCombatStructuredNumbers(rawCombats) {
  if (!Array.isArray(rawCombats)) return { combats: rawCombats, changed: false };
  let changed = false;
  const combats = rawCombats.map((combat) => {
    const result = migrateCombatStructuredNumbers(combat);
    changed = changed || result.changed;
    return result.combat;
  });
  return { combats, changed };
}

function migrateNotableCombatIds(rawCombats) {
  if (!Array.isArray(rawCombats)) return { combats: rawCombats, changed: false };
  let changed = false;
  const seen = new Set();
  const combats = rawCombats.map((combat) => {
    if (!combat || typeof combat !== "object") return combat;
    const current = String(combat.id ?? "").trim();
    if (current && !seen.has(current)) {
      seen.add(current);
      if (current === combat.id) return combat;
      changed = true;
      return { ...combat, id: current };
    }

    let id = "";
    do {
      id = createNotableCombatId();
    } while (seen.has(id));
    seen.add(id);
    changed = true;
    return { ...combat, id };
  });
  return { combats, changed };
}

function migrateHaltBuffStructuredNumbers(rawCombatMods) {
  const combatMods = (rawCombatMods && typeof rawCombatMods === "object") ? rawCombatMods : {};
  if (!Array.isArray(combatMods.haltBuffs)) return { combatMods, changed: false };
  let changed = false;
  const haltBuffs = combatMods.haltBuffs.map((buff) => {
    if (!buff || typeof buff !== "object") return buff;
    const migrated = { ...buff, values: normalizeHaltValues(buff.values) };
    changed = changed || !valuesEqual(buff, migrated);
    return migrated;
  });
  return { combatMods: { ...combatMods, haltBuffs }, changed };
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
    const rawSystem = actor._source?.system ?? actor.system ?? {};
    const rawCombats = rawSystem.notableCombats ?? actor.system?.notableCombats;
    let migrationState = { combats: rawCombats, changed: false };
    const updateData = {};

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

    if (currentVersion < PC_WORLD_MIGRATION_OPTIONAL_NUMBERS) {
      const initiative = parseOptionalInteger(rawSystem.initiative, { allowSign: true });
      if (!valuesEqual(rawSystem.initiative, initiative)) updateData["system.initiative"] = initiative;

      const reflexAoeSaveTarget = parseOptionalInteger(rawSystem.reflexAoeSaveTarget, { min: 1 });
      if (!valuesEqual(rawSystem.reflexAoeSaveTarget, reflexAoeSaveTarget)) {
        updateData["system.reflexAoeSaveTarget"] = reflexAoeSaveTarget;
      }

      const skillsMigration = migrateSkillsOptionalNumbers(rawSystem.skills);
      if (skillsMigration.changed) updateData["system.skills"] = skillsMigration.skills;

      const combatOptionalMigration = migrateNotableCombatOptionalNumbers(migrationState.combats);
      migrationState = {
        combats: combatOptionalMigration.combats,
        changed: migrationState.changed || combatOptionalMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_STRUCTURED_NUMBERS) {
      const haltValues = normalizeHaltValues(rawSystem.haltValues);
      if (!valuesEqual(rawSystem.haltValues, haltValues)) updateData["system.haltValues"] = haltValues;

      const naturalHaltValues = normalizeHaltValues(rawSystem.naturalHaltValues);
      if (!valuesEqual(rawSystem.naturalHaltValues, naturalHaltValues)) updateData["system.naturalHaltValues"] = naturalHaltValues;

      const combatModsMigration = migrateHaltBuffStructuredNumbers(rawSystem.combatMods);
      if (combatModsMigration.changed) updateData["system.combatMods"] = combatModsMigration.combatMods;

      const combatStructuredMigration = migrateNotableCombatStructuredNumbers(migrationState.combats);
      migrationState = {
        combats: combatStructuredMigration.combats,
        changed: migrationState.changed || combatStructuredMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_NOTABLE_COMBAT_IDS) {
      const combatIdMigration = migrateNotableCombatIds(migrationState.combats);
      migrationState = {
        combats: combatIdMigration.combats,
        changed: migrationState.changed || combatIdMigration.changed
      };
    }

    const { combats, changed } = migrationState;
    if (changed) updateData["system.notableCombats"] = combats;
    if (Object.keys(updateData).length === 0) continue;

    try {
      await actor.update(updateData, { render: false });
      migratedActors += 1;
    } catch (err) {
      hadFailures = true;
      console.error(`Peasant Core | Failed to migrate actor data for ${actor.name}:`, err);
    }
  }

  if (!hadFailures) {
    await game.settings.set("peasant-core", PC_WORLD_MIGRATION_VERSION_SETTING, PC_WORLD_MIGRATION_LATEST);
  }

  if (migratedActors > 0) {
    console.log(`Peasant Core | Migrated actor data on ${migratedActors} actor(s).`);
  }
  if (migratedActorTypes > 0) {
    console.log(`Peasant Core | Converted ${migratedActorTypes} removed experimental actor type(s) to character.`);
  }
}
