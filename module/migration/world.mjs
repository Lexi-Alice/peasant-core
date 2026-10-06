// Peasant Core world migrations
import { normalizeHaltValues } from "../data/actor/combat-modifiers.mjs";
import { applyOverchargedEffect, isOverchargedEffect } from "../data/active-effect/overcharged.mjs";
import { clonePlainValue, getActorSourceSystem, withPeasantActorStateWriteContext } from "../data/actor/source-system.mjs";
import {
  MANIFEST_SPELL_EFFECT_CHANGE_KEYS,
  buildManifestSpellEffectChanges,
  getManifestSpellEffectState
} from "../data/active-effect/spell-effect-change-keys.mjs";
import {
  buildMageBlockBarrierEffectSource,
  buildMageBlockDuressEffectSource,
  getMageBlockBarrierEffect,
  getMageBlockEffectConsolidationMigration,
  getMageBlockDefenseIdentity,
  getMageBlockDuressEffect
} from "../data/active-effect/mage-block-effects.mjs";
import { normalizeRangeRateValue } from "../data/actor/combat-tags.mjs";
import { getNotableCombatEffectImage } from "../data/actor/notable-combat-image.mjs";
import { parseOptionalInteger } from "../data/actor/helpers.mjs";
import { isSignatureSkillType, normalizeSkillTypeForCategory } from "../data/actor/skill-entry-types.mjs";
import { normalizeLegacySkillEffectLink } from "../data/actor/skill-entries.mjs";
import {
  DEFAULT_SIR_LOCATIONS,
  PC_CUSTOM_SIR_LOCATION_VALUES_FLAG,
  migrateHeraldryEffectChanges,
  migrateLegacyHeraldryData,
  normalizeSirValue,
  normalizeSirValueMap
} from "../data/actor/identity-options.mjs";

export const PC_WORLD_MIGRATION_VERSION_SETTING = "worldMigrationVersion";
const PC_WORLD_MIGRATION_NOTABLE_CUSTOM_TAGS = 1;
const PC_WORLD_MIGRATION_DEFENSE_BLOCK = 2;
const PC_WORLD_MIGRATION_DEFENSE_BLOCK_TYPES = 3;
const PC_WORLD_MIGRATION_DEFENSE_BLOCK_CLEANUP = 4;
const PC_WORLD_MIGRATION_CHARACTER_EXPERIMENTAL_REMOVAL = 5;
const PC_WORLD_MIGRATION_OPTIONAL_NUMBERS = 6;
const PC_WORLD_MIGRATION_STRUCTURED_NUMBERS = 7;
const PC_WORLD_MIGRATION_NOTABLE_COMBAT_IDS = 8;
const PC_WORLD_MIGRATION_SIR_NUMBERS = 9;
const PC_WORLD_MIGRATION_SKILL_TYPES = 10;
const PC_WORLD_MIGRATION_CATEGORY_SKILL_TYPES = 11;
const PC_WORLD_MIGRATION_SIGNATURE_TYPES = 12;
const PC_WORLD_MIGRATION_MAGIC_SPELL_TYPES = 13;
const PC_WORLD_MIGRATION_MARTIAL_TYPES = 14;
const PC_WORLD_MIGRATION_SIGNATURE_USAGE_METADATA = 15;
const PC_WORLD_MIGRATION_DURESS_USES = 16;
const PC_WORLD_MIGRATION_TAG_PRESENTATION_METADATA = 17;
const PC_WORLD_MIGRATION_TAG_LAYOUT_GROUPS = 18;
const PC_WORLD_MIGRATION_MANIFEST_EFFECT_CHANGES = 19;
const PC_WORLD_MIGRATION_USAGE_DESCRIPTIONS = 20;
const PC_WORLD_MIGRATION_E5_COMBAT_STATE = 21;
const PC_WORLD_MIGRATION_MAGE_BLOCK_EFFECTS = 22;
const PC_WORLD_MIGRATION_MAGE_BLOCK_SINGLE_EFFECT = 23;
const PC_WORLD_MIGRATION_MAGE_BLOCK_ZERO_HP_CLEANUP = PC_WORLD_MIGRATION_MAGE_BLOCK_SINGLE_EFFECT + 1;
const PC_WORLD_MIGRATION_USAGE_EFFECT_AUTOMATION = PC_WORLD_MIGRATION_MAGE_BLOCK_ZERO_HP_CLEANUP + 1;
const PC_WORLD_MIGRATION_REMOVE_SHARED_TAGS = PC_WORLD_MIGRATION_USAGE_EFFECT_AUTOMATION + 1;
const PC_WORLD_MIGRATION_HERALDRY = PC_WORLD_MIGRATION_REMOVE_SHARED_TAGS + 1;
const PC_WORLD_MIGRATION_OVERCHARGED_EFFECT = PC_WORLD_MIGRATION_HERALDRY + 1;
const PC_WORLD_MIGRATION_LATEST = PC_WORLD_MIGRATION_OVERCHARGED_EFFECT;
const PC_CHARACTER_TYPES = new Set(["character"]);
const PC_REMOVED_CHARACTER_EXPERIMENTAL_TYPE = "characterExperimental";

function createNotableCombatId() {
  return foundry?.utils?.randomID?.(16) ?? `combat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeNotableCombatCustomTagEntry(entry) {
  const normalized = {
    name: String(entry?.name ?? "").trim(),
    value: String(entry?.value ?? "").trim()
  };
  const id = String(entry?.id ?? "").trim();
  return id ? { id, ...normalized } : normalized;
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

export function migrateSkillUsageEffectLinks(entries) {
  let changed = false;
  const migrated = (entries ?? []).map(entry => {
    if (!entry || typeof entry !== "object") return entry;
    const mapUsage = usage => {
      if (!usage || !Array.isArray(usage.effectLinks)) return usage;
      const effectLinks = usage.effectLinks.map(normalizeLegacySkillEffectLink);
      changed ||= !valuesEqual(effectLinks, usage.effectLinks);
      return { ...usage, effectLinks };
    };
    return {
      ...entry,
      baseUsage: mapUsage(entry.baseUsage),
      usages: Array.isArray(entry.usages) ? entry.usages.map(mapUsage) : entry.usages
    };
  });
  return { entries: migrated, changed };
}

function normalizeMigrationInteger(value, { fallback = 0, min = 0 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.trunc(number));
}

function migrateMageBarrierDefense(defense) {
  if (!defense || typeof defense !== "object" || Array.isArray(defense)
    || String(defense.blockType ?? "").trim().toLowerCase() !== "mage") return { defense, changed: false };

  const hp = normalizeMigrationInteger(defense.hp);
  const sourceMaxHp = normalizeMigrationInteger(defense.maxHp);
  const maxHp = sourceMaxHp > 0 ? sourceMaxHp : (hp > 0 ? hp : 40);
  const migrated = {
    ...defense,
    hp: Math.min(hp, maxHp),
    maxHp,
    mageBarrierInitialized: typeof defense.mageBarrierInitialized === "boolean"
      ? defense.mageBarrierInitialized
      : false
  };
  return { defense: migrated, changed: !valuesEqual(defense, migrated) };
}

function migrateE5CombatEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { entry, changed: false };
  let migrated = entry;
  let changed = false;
  const baseDefense = migrateMageBarrierDefense(entry.defense);
  if (baseDefense.changed) {
    migrated = { ...migrated, defense: baseDefense.defense };
    changed = true;
  }
  if (Array.isArray(entry.usages)) {
    let usagesChanged = false;
    const usages = entry.usages.map((usage) => {
      const mechanics = usage?.mechanics;
      const defense = migrateMageBarrierDefense(mechanics?.defense);
      if (!defense.changed) return usage;
      usagesChanged = true;
      return { ...usage, mechanics: { ...mechanics, defense: defense.defense } };
    });
    if (usagesChanged) {
      migrated = { ...migrated, usages };
      changed = true;
    }
  }
  return { entry: migrated, changed };
}

function migrateE5CombatEntries(entries) {
  if (!Array.isArray(entries)) return { entries, changed: false };
  let changed = false;
  const migrated = entries.map((entry) => {
    const result = migrateE5CombatEntry(entry);
    changed ||= result.changed;
    return result.entry;
  });
  return { entries: migrated, changed };
}

function normalizeBlessingMigrationValue(blessing) {
  const source = blessing && typeof blessing === "object" && !Array.isArray(blessing) ? blessing : {};
  const type = String(source.type ?? "").trim().toLowerCase();
  const migrated = Object.fromEntries(Object.entries(source).filter(([key]) => key !== "target"));
  migrated.type = ["spring", "summer", "fall", "winter"].includes(type) ? type : "";
  return migrated;
}

function normalizeFallBlessingUses(rawUses, { defaultMax, blessingType }) {
  if (rawUses === undefined || rawUses === null) {
    return { value: blessingType === "fall" ? defaultMax : 0, max: defaultMax };
  }
  const uses = rawUses && typeof rawUses === "object" && !Array.isArray(rawUses) ? rawUses : {};
  const max = normalizeMigrationInteger(uses.max);
  const value = Math.min(max, normalizeMigrationInteger(uses.value));
  return { value, max };
}

export function getE5CombatStateMigrationUpdate(actorSource, { skills, notableCombats } = {}) {
  const source = actorSource?._source ?? actorSource ?? {};
  const system = source.system ?? actorSource?.system ?? {};
  if (!isPeasantCharacterType(actorSource?.type ?? source.type)) return {};

  const update = {};
  const woundCount = normalizeMigrationInteger(system.devastatingWounds);
  if (!Object.hasOwn(system, "devastatingWounds") || !valuesEqual(system.devastatingWounds, woundCount)) {
    update["system.devastatingWounds"] = woundCount;
  }

  const skillEntries = skills ?? system.skills;
  if (Object.hasOwn(system, "blessing")) {
    const blessing = normalizeBlessingMigrationValue(system.blessing);
    if (!valuesEqual(system.blessing, blessing)) update["system.blessing"] = blessing;
  }

  const blessingType = String(system.blessing?.type ?? "").trim().toLowerCase();
  const derivedFallMaximum = Math.max(1, Math.floor(normalizeMigrationInteger(system.edge?.max) / 2));
  const fallBlessingUses = normalizeFallBlessingUses(system.fallBlessingUses, {
    defaultMax: derivedFallMaximum,
    blessingType
  });
  if (!valuesEqual(system.fallBlessingUses, fallBlessingUses)) {
    update["system.fallBlessingUses"] = fallBlessingUses;
  }

  const skillsMigration = migrateE5CombatEntries(skillEntries);
  if (skillsMigration.changed) update["system.skills"] = skillsMigration.entries;
  const combatEntries = notableCombats ?? system.notableCombats;
  const combatsMigration = migrateE5CombatEntries(combatEntries);
  if (combatsMigration.changed) update["system.notableCombats"] = combatsMigration.entries;
  return update;
}

function migrationEntryId(collection, entries, index) {
  const ids = new Set((Array.isArray(entries) ? entries : []).map((entry) => String(entry?.id || "").trim()).filter(Boolean));
  let id = `mage-${collection}-${index + 1}`;
  let suffix = 1;
  while (ids.has(id)) id = `mage-${collection}-${index + 1}-${suffix++}`;
  return id;
}

function migrateMageDefenseToEffects(actor, defense, {
  collection,
  entryId,
  usageId = "base",
  name = "Mage Block",
  img = ""
} = {}) {
  if (!defense || typeof defense !== "object" || Array.isArray(defense)
    || String(defense.blockType ?? "").trim().toLowerCase() !== "mage") {
    return { defense, changed: false, effectSources: [] };
  }

  const hp = normalizeMigrationInteger(defense.hp);
  const sourceMax = normalizeMigrationInteger(defense.maxHp);
  const maxHp = sourceMax > 0 ? sourceMax : (hp > 0 ? hp : 40);
  const initialized = defense.mageBarrierInitialized === true;
  const identity = getMageBlockDefenseIdentity(collection, entryId, usageId);
  const effectSources = [];
  if (identity && hp > 0 && !getMageBlockBarrierEffect(actor, identity)) {
    effectSources.push(buildMageBlockBarrierEffectSource(actor, {
      identity, img, hp: Math.min(hp, maxHp), maxHp, includeDuress: initialized
    }));
  } else if (identity && hp > 0 && initialized && !getMageBlockDuressEffect(actor, identity)) {
    effectSources.push(buildMageBlockDuressEffectSource(actor, { identity, name, img }));
  }

  const migrated = { ...defense, maxHp };
  delete migrated.hp;
  delete migrated.mageBarrierInitialized;
  return { defense: migrated, changed: !valuesEqual(defense, migrated), effectSources };
}

export function getE5MageBlockEffectsMigration(actor, { skills, notableCombats } = {}) {
  const sourceSystem = actor?._source?.system ?? actor?.system ?? {};
  const input = {
    skills: Array.isArray(skills) ? skills : sourceSystem.skills,
    notableCombats: Array.isArray(notableCombats) ? notableCombats : sourceSystem.notableCombats
  };
  let changed = false;
  const effectSources = [];
  const migratedEntries = {};

  for (const collection of ["skills", "notableCombats"]) {
    const entries = input[collection];
    if (!Array.isArray(entries)) {
      migratedEntries[collection] = entries;
      continue;
    }
    const usedIds = entries.map((entry) => String(entry?.id || "").trim()).filter(Boolean);
    const migrated = entries.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      let nextEntry = entry;
      let entryId = String(entry.id || "").trim();
      const img = getNotableCombatEffectImage(actor, entry);
      const migrateOne = (defense, usageId, name) => {
        if (String(defense?.blockType ?? "").trim().toLowerCase() !== "mage") return { defense, changed: false, effectSources: [] };
        const hp = normalizeMigrationInteger(defense.hp);
        const marker = defense.mageBarrierInitialized === true;
        if (!entryId && (hp > 0 || marker)) {
          entryId = migrationEntryId(collection, usedIds, index);
          usedIds.push(entryId);
          nextEntry = { ...nextEntry, id: entryId };
        }
        return migrateMageDefenseToEffects(actor, defense, { collection, entryId, usageId, name, img });
      };

      const base = migrateOne(entry.defense, "base", entry.name);
      if (base.changed) nextEntry = { ...nextEntry, defense: base.defense };
      effectSources.push(...base.effectSources.filter(Boolean));

      if (Array.isArray(entry.usages)) {
        let usagesChanged = false;
        const usages = entry.usages.map((usage, usageIndex) => {
          const defense = usage?.mechanics?.defense;
          if (String(defense?.blockType ?? "").trim().toLowerCase() !== "mage") return usage;
          let usageId = String(usage?.id || "").trim();
          const hp = normalizeMigrationInteger(defense?.hp);
          const marker = defense?.mageBarrierInitialized === true;
          let nextUsage = usage;
          if (!usageId && (hp > 0 || marker)) {
            usageId = `mage-usage-${usageIndex + 1}`;
            const usedUsageIds = new Set(entry.usages.map((item) => String(item?.id || "").trim()));
            let suffix = 1;
            while (usedUsageIds.has(usageId)) usageId = `mage-usage-${usageIndex + 1}-${suffix++}`;
            nextUsage = { ...usage, id: usageId };
          }
          const result = migrateOne(defense, usageId || `usage-${usageIndex + 1}`, `${entry.name || "Mage Block"}${usage?.name ? ` - ${usage.name}` : ""}`);
          effectSources.push(...result.effectSources.filter(Boolean));
          if (!result.changed && nextUsage === usage) return usage;
          usagesChanged = true;
          return {
            ...nextUsage,
            mechanics: { ...usage.mechanics, defense: result.defense }
          };
        });
        if (usagesChanged) nextEntry = { ...nextEntry, usages };
      }

      changed ||= nextEntry !== entry;
      return nextEntry;
    });
    migratedEntries[collection] = migrated;
    if (!valuesEqual(entries, migrated)) changed = true;
  }

  return {
    ...migratedEntries,
    changed,
    effectSources
  };
}

const MANIFEST_RESISTANCE_HALT_KEYS = Object.freeze([
  "system.naturalHaltValues.head",
  "system.naturalHaltValues.arms",
  "system.naturalHaltValues.legs",
  "system.naturalHaltValues.torso"
]);

export function getManifestSpellEffectMigrationUpdate(source, { persistCanonical = false } = {}) {
  if (source?.type !== "spellEffect") return null;
  const legacySystem = source?.system;
  if (!legacySystem || typeof legacySystem !== "object") return null;

  const legacyManifestType = String(legacySystem.manifestKind ?? "").trim().toLowerCase();
  const existingChanges = Array.from(source?.changes ?? legacySystem.changes ?? []);
  const currentState = getManifestSpellEffectState({ changes: existingChanges });
  const manifestType = currentState.manifestType || legacyManifestType;
  if (!["dome", "resistance"].includes(manifestType)) return null;

  const legacyFields = ["buffCategory", "manifestKind", "magicalHp", "haltValues"]
    .filter((field) => Object.hasOwn(legacySystem, field));
  if (!legacyFields.length) {
    // Type-data migration normalized this source in memory; persist that canonical v14 system data.
    if (!persistCanonical || !Array.isArray(legacySystem.changes)) return null;
    return {
      _id: String(source?._id ?? source?.id ?? ""),
      system: structuredClone(legacySystem)
    };
  }

  const hp = Object.hasOwn(legacySystem, "magicalHp")
    ? legacySystem.magicalHp
    : currentState.magicalHp;
  const hasMagnetismRow = existingChanges.some((change) => (
    String(change?.key ?? "").trim() === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.magnetismGrade
  ));
  const generated = buildManifestSpellEffectChanges({
    manifestType,
    hp,
    haltValues: legacySystem.haltValues,
    magnetismGrade: hasMagnetismRow ? currentState.magnetismGrade : 1
  });
  const selfKeys = new Set(Object.values(MANIFEST_SPELL_EFFECT_CHANGE_KEYS));
  const resistanceHaltKeys = new Set(MANIFEST_RESISTANCE_HALT_KEYS);
  const existingHaltRows = new Map(existingChanges
    .filter((change) => resistanceHaltKeys.has(String(change?.key ?? "").trim()))
    .map((change) => [String(change.key).trim(), change]));
  const canonical = generated.map((change) => (
    manifestType === "resistance" && existingHaltRows.has(change.key)
      ? existingHaltRows.get(change.key)
      : change
  ));
  const unrelated = existingChanges.filter((change) => {
    const key = String(change?.key ?? "").trim();
    return !selfKeys.has(key) && !(manifestType === "resistance" && resistanceHaltKeys.has(key));
  });
  const update = { _id: String(source?._id ?? source?.id ?? ""), changes: [...canonical, ...unrelated] };
  for (const field of legacyFields) update[`system.-=${field}`] = null;
  return update._id ? update : null;
}

function getRawActorEffects(actor) {
  if (Array.isArray(actor?._source?.effects)) return actor._source.effects;
  return Array.from(actor?.effects ?? []).map((effect) => effect?._source ?? effect);
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

function migrateEntryTypes(rawEntries) {
  if (!Array.isArray(rawEntries)) return { entries: rawEntries, changed: false };
  let changed = false;
  const entries = rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const type = String(entry.type ?? "").trim();
    const typeKey = type.toLowerCase();
    const migratedType = !type || typeKey === "standard"
      ? "skill"
      : (typeKey === "other" ? "Custom" : entry.type);
    if (migratedType === entry.type) return entry;
    changed = true;
    return { ...entry, type: migratedType };
  });
  return { entries, changed };
}

function migrateEntryCategoryTypes(rawEntries) {
  if (!Array.isArray(rawEntries)) return { entries: rawEntries, changed: false };
  let changed = false;
  const entries = rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const type = normalizeSkillTypeForCategory(entry.type, entry.category);
    if (type === entry.type) return entry;
    changed = true;
    return { ...entry, type };
  });
  return { entries, changed };
}

function migrateEntrySignatureTypes(rawEntries) {
  if (!Array.isArray(rawEntries)) return { entries: rawEntries, changed: false };
  let changed = false;
  const signatureCategories = new Set(["", "martial", "tradewrite", "mundane"]);
  const entries = rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const category = String(entry.category ?? "").trim().toLowerCase();
    let type = normalizeSkillTypeForCategory(entry.type, entry.category);
    let sig = false;
    if (signatureCategories.has(category) && (entry.sig || isSignatureSkillType(type))) {
      type = "Signature";
      sig = true;
    } else if (isSignatureSkillType(type)) {
      type = category === "magic" ? "Spellcraft" : "skill";
    }
    const migrated = { ...entry, type, sig };
    changed = changed || !valuesEqual(entry, migrated);
    return migrated;
  });
  return { entries, changed };
}

function migrateMagicSpellTypes(rawEntries) {
  if (!Array.isArray(rawEntries)) return { entries: rawEntries, changed: false };
  let changed = false;
  const entries = rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const isMagic = String(entry.category ?? "").trim().toLowerCase() === "magic";
    const isLegacySkill = String(entry.type ?? "").trim().toLowerCase() === "skill";
    if (!isMagic || !isLegacySkill) return entry;
    changed = true;
    return { ...entry, type: "Spell" };
  });
  return { entries, changed };
}

function migrateMartialTypes(rawEntries) {
  if (!Array.isArray(rawEntries)) return { entries: rawEntries, changed: false };
  let changed = false;
  const entries = rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const { sig: _legacySig, ...migrated } = entry;
    migrated.type = normalizeSkillTypeForCategory(entry.type, entry.category);
    const isMartialSignature = String(entry.category ?? "").trim().toLowerCase() === "martial"
      && isSignatureSkillType(migrated.type);
    if (isMartialSignature && !String(migrated.signatureType ?? "").trim()) {
      const weaponType = String(entry.weaponType ?? "").trim();
      if (weaponType) migrated.signatureType = weaponType;
    }
    changed = changed || !valuesEqual(entry, migrated);
    return migrated;
  });
  return { entries, changed };
}

function migrateSignatureUsageMetadata(rawEntries) {
  if (!Array.isArray(rawEntries)) return { entries: rawEntries, changed: false };
  let changed = false;
  const entries = rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const signatureUsage = entry.signatureUsage;
    if (!signatureUsage || typeof signatureUsage !== "object" || Array.isArray(signatureUsage)) return entry;
    if (!("label" in signatureUsage) && !("note" in signatureUsage)) return entry;
    const { label: _label, note: _note, ...remainingSignatureUsage } = signatureUsage;
    changed = true;
    return { ...entry, signatureUsage: remainingSignatureUsage };
  });
  return { entries, changed };
}

function migrateSignatureUsageDuressUses(rawEntries) {
  if (!Array.isArray(rawEntries)) return { entries: rawEntries, changed: false };
  let changed = false;
  const entries = rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const signatureUsage = entry.signatureUsage;
    if (!signatureUsage || typeof signatureUsage !== "object" || Array.isArray(signatureUsage)) return entry;
    if (!("duressEnabled" in signatureUsage)) return entry;
    const { duressEnabled, ...remainingSignatureUsage } = signatureUsage;
    changed = true;
    return {
      ...entry,
      signatureUsage: {
        ...remainingSignatureUsage,
        duressUses: "duressUses" in signatureUsage ? !!signatureUsage.duressUses : !!duressEnabled
      }
    };
  });
  return { entries, changed };
}

function migrateTagLayoutMetadata(rawEntries, { removeGroups = false } = {}) {
  if (!Array.isArray(rawEntries)) return { entries: rawEntries, changed: false };
  let changed = false;
  const cleanLayout = (layout) => {
    if (!Array.isArray(layout)) return layout;
    const cleaned = [];
    for (const row of layout) {
      if (removeGroups && row?.kind === "group") {
        changed = true;
        continue;
      }
      if (!row || typeof row !== "object" || Array.isArray(row) || (!("label" in row) && !("note" in row))) {
        cleaned.push(row);
        continue;
      }
      const { label: _label, note: _note, ...remaining } = row;
      changed = true;
      cleaned.push(remaining);
    }
    return cleaned;
  };
  const cleanUsage = (usage) => usage && typeof usage === "object" && !Array.isArray(usage)
    ? { ...usage, ...(Array.isArray(usage.layout) ? { layout: cleanLayout(usage.layout) } : {}) }
    : usage;
  const entries = rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return {
      ...cleanUsage(entry),
      ...(entry.baseUsage && typeof entry.baseUsage === "object" && !Array.isArray(entry.baseUsage)
        ? { baseUsage: cleanUsage(entry.baseUsage) }
        : {}),
      ...(Array.isArray(entry.usages) ? { usages: entry.usages.map(cleanUsage) } : {})
    };
  });
  return { entries, changed };
}

function migrateUsageDescriptions(rawEntries) {
  if (!Array.isArray(rawEntries)) return { entries: rawEntries, changed: false };
  let changed = false;
  const stripDescription = (usage) => {
    if (!usage || typeof usage !== "object" || Array.isArray(usage) || !("description" in usage)) return usage;
    const { description: _description, ...remaining } = usage;
    changed = true;
    return remaining;
  };
  const entries = rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return {
      ...entry,
      ...(entry.baseUsage && typeof entry.baseUsage === "object" && !Array.isArray(entry.baseUsage)
        ? { baseUsage: stripDescription(entry.baseUsage) }
        : {}),
      ...(Array.isArray(entry.usages) ? { usages: entry.usages.map(stripDescription) } : {})
    };
  });
  return { entries, changed };
}

function removeSharedTagState(rawEntries) {
  if (!Array.isArray(rawEntries)) return { entries: rawEntries, changed: false };
  let changed = false;
  const entries = rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const cleaned = { ...entry };
    if (Object.hasOwn(cleaned, "sharedTagTypes")) {
      delete cleaned.sharedTagTypes;
      changed = true;
    }
    if (Array.isArray(cleaned.usages)) {
      cleaned.usages = cleaned.usages.map((usage) => {
        if (!usage || typeof usage !== "object" || Array.isArray(usage)) return usage;
        if (!Object.hasOwn(usage, "replaceSharedTagTypes")) return usage;
        const local = { ...usage };
        delete local.replaceSharedTagTypes;
        changed = true;
        return local;
      });
    }
    return cleaned;
  });
  return { entries, changed };
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

async function migrateWorldHeraldryData() {
  let hadFailures = false;
  const documents = new Set([...(game.actors ?? []), ...(game.items ?? [])]);
  const actorDeltas = new Map();
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      if (token.actorLink || !token.actor) continue;
      if (token.delta && isPeasantCharacterType(token.actor.type)) {
        try {
          // A legacy override can be hidden by a canonical field inherited from the base Actor.
          const rawSystem = token.delta._source?.system ?? {};
          const system = migrateLegacyHeraldryData(rawSystem);
          const update = {};
          for (const [legacy, canonical] of [["race", "finalHeraldry"], ["customRace", "customFinalHeraldry"]]) {
            if (!Object.hasOwn(rawSystem, legacy) && !Object.hasOwn(rawSystem, canonical)) continue;
            update[`system.${canonical}`] = system[canonical];
            update[`system.-=${legacy}`] = null;
          }
          if (Object.keys(update).length && !(await token.delta.update(update, { render: false, diff: false }))) {
            throw new Error("Heraldry token update returned no document");
          }
        } catch (err) {
          hadFailures = true;
          console.error(`Peasant Core | Failed to migrate Heraldry for token ${token.name}:`, err);
        }
        actorDeltas.set(token.actor, token.delta);
      }
      documents.add(token.actor);
    }
  }
  for (const document of [...documents]) {
    const delta = actorDeltas.get(document);
    for (const item of document.items ?? []) {
      if (!delta || delta._source?.items?.some(source => !source._tombstone && source._id === (item.id ?? item._id))) {
        documents.add(item);
      }
    }
  }

  for (const document of documents) {
    try {
      if (isPeasantCharacterType(document.type) && !actorDeltas.has(document)) {
        const rawSystem = document._source?.system ?? document.system ?? {};
        const defaults = {
          majorHeraldry: "", customMajorHeraldry: "",
          minorHeraldry: "", customMinorHeraldry: "",
          finalHeraldry: "Human", customFinalHeraldry: ""
        };
        if (["race", "customRace", ...Object.keys(defaults)].some(key => Object.hasOwn(rawSystem, key))) {
          const system = migrateLegacyHeraldryData(rawSystem);
          // Persist canonical fields even when the load-time model migration has already renamed them.
          const update = Object.fromEntries(Object.entries(defaults).map(([key, initial]) => [`system.${key}`, system[key] ?? initial]));
          for (const legacy of ["race", "customRace"]) {
            update[`system.-=${legacy}`] = null;
          }
          if (!(await document.update(update, { render: false, diff: false }))) {
            throw new Error("Heraldry actor update returned no document");
          }
        }
      }
      const effectSources = actorDeltas.has(document) ? actorDeltas.get(document)._source?.effects ?? [] : getRawActorEffects(document);
      const effectUpdates = effectSources
        .filter(effect => (effect.system?.changes ?? effect.changes)?.some(change => /^system\.(?:race|customRace|finalHeraldry|customFinalHeraldry)$/.test(change.key)))
        .map(effect => ({ _id: effect._id ?? effect.id, "system.changes": migrateHeraldryEffectChanges(effect.system?.changes ?? effect.changes) }));
      if (effectUpdates.length) {
        const updated = await document.updateEmbeddedDocuments("ActiveEffect", effectUpdates, { render: false, diff: false });
        if (effectUpdates.some(update => !updated?.some(effect => (effect.id ?? effect._id) === update._id))) {
          throw new Error("Heraldry effect update returned missing documents");
        }
      }
    } catch (err) {
      hadFailures = true;
      console.error(`Peasant Core | Failed to migrate Heraldry for ${document.name}:`, err);
    }
  }
  return !hadFailures;
}

function getOverchargedEffectSources(actor) {
  return Array.from(actor.effects ?? []).filter(isOverchargedEffect)
    .map(effect => clonePlainValue(effect.toObject?.() ?? effect._source));
}

async function restoreOverchargedEffects(actor, beforeEffects) {
  const beforeIds = new Set(beforeEffects.map(source => source._id));
  const effects = Array.from(actor.effects ?? []).filter(isOverchargedEffect);
  const newIds = effects.filter(effect => !beforeIds.has(effect.id)).map(effect => effect.id);
  if (newIds.length) await actor.deleteEmbeddedDocuments("ActiveEffect", newIds);
  const updates = beforeEffects.filter(source => {
    const effect = effects.find(effect => effect.id === source._id);
    return effect && !valuesEqual(source, effect.toObject?.() ?? effect._source);
  });
  if (updates.length) {
    await actor.updateEmbeddedDocuments("ActiveEffect", updates, { render: false, diff: false, recursive: false });
  }
}

async function migrateWorldOverchargedEffects() {
  const actors = new Set(game.actors ?? []);
  const falseTokenStates = new Map();
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      const actor = token.actor;
      if (token.actorLink || !actor || !isPeasantCharacterType(actor.type)) continue;
      actors.add(actor);
      if (actor.system?.conditions?.overcharged !== true) {
        falseTokenStates.set(actor, getOverchargedEffectSources(actor));
      }
    }
  }
  // Snapshot synthetic actors before clearing a flag inherited from their base Actor.
  const legacyActorStates = new Map([...actors]
    .filter(actor => isPeasantCharacterType(actor.type) && getActorSourceSystem(actor).conditions?.overcharged === true)
    .map(actor => [actor, getOverchargedEffectSources(actor)]));
  let hadFailures = false;
  for (const actor of legacyActorStates.keys()) {
    try {
      await applyOverchargedEffect(actor);
    } catch (err) {
      hadFailures = true;
      console.error(`Peasant Core | Failed to migrate Overcharged for ${actor.name}:`, err);
    }
  }
  // ActorDelta inherits newly created/enabled base effects, including on tokens with a saved false override.
  for (const [actor, beforeEffects] of falseTokenStates) {
    try {
      await restoreOverchargedEffects(actor, beforeEffects);
    } catch (err) {
      hadFailures = true;
      console.error(`Peasant Core | Failed to preserve Overcharged for token ${actor.name}:`, err);
    }
  }
  if (hadFailures) {
    // Retain the legacy state on failure so the next attempt can recover the same token overrides.
    for (const [actor, beforeEffects] of legacyActorStates) {
      try {
        await restoreOverchargedEffects(actor, beforeEffects);
        if (getActorSourceSystem(actor).conditions?.overcharged !== true) {
          await actor.update({ "system.conditions.overcharged": true }, withPeasantActorStateWriteContext());
        }
      } catch (err) {
        console.error(`Peasant Core | Failed to roll back Overcharged migration for ${actor.name}:`, err);
      }
    }
  }
  return !hadFailures;
}

export async function migrateWorldNotableCombatData() {
  if (!game.user?.isGM) return;

  const currentVersion = Number(game.settings.get("peasant-core", PC_WORLD_MIGRATION_VERSION_SETTING) || 0);
  if (currentVersion >= PC_WORLD_MIGRATION_LATEST) return;

  let migratedActors = 0;
  let migratedActorTypes = 0;
  let migratedSpellEffects = 0;
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

    if (currentVersion < PC_WORLD_MIGRATION_MANIFEST_EFFECT_CHANGES) {
      const effectUpdates = getRawActorEffects(actor)
        .map((source) => getManifestSpellEffectMigrationUpdate(source, { persistCanonical: true }))
        .filter(Boolean);
      if (effectUpdates.length > 0) {
        try {
          await actor.updateEmbeddedDocuments("ActiveEffect", effectUpdates, {
            render: false,
            diff: false,
            recursive: false
          });
          migratedSpellEffects += effectUpdates.length;
        } catch (err) {
          hadFailures = true;
          console.error(`Peasant Core | Failed to migrate Manifest Spell Effects for ${actor.name}:`, err);
        }
      }
    }

    if (!isPeasantCharacterType(actor.type)) continue;
    const rawSystem = actor._source?.system ?? actor.system ?? {};
    const rawCombats = rawSystem.notableCombats ?? actor.system?.notableCombats;
    let migrationState = { combats: rawCombats, changed: false };
    const updateData = {};
    let mageBlockEffectSources = [];
    let mageBlockEffectConsolidation = { updates: [], deleteIds: [] };

    if (currentVersion < PC_WORLD_MIGRATION_SIR_NUMBERS) {
      for (const { field } of DEFAULT_SIR_LOCATIONS) {
        if (!Object.prototype.hasOwnProperty.call(rawSystem, field)) continue;
        const value = normalizeSirValue(rawSystem[field]);
        if (!valuesEqual(rawSystem[field], value)) updateData[`system.${field}`] = value;
      }

      const legacyCustomSirs = actor.getFlag?.("peasant-core", PC_CUSTOM_SIR_LOCATION_VALUES_FLAG);
      const hasLegacyCustomSirs = !!legacyCustomSirs
        && typeof legacyCustomSirs === "object"
        && !Array.isArray(legacyCustomSirs);
      const rawCustomSirs = rawSystem.customSirs;
      const customSirs = normalizeSirValueMap({
        ...(hasLegacyCustomSirs ? legacyCustomSirs : {}),
        ...(rawCustomSirs && typeof rawCustomSirs === "object" ? rawCustomSirs : {})
      });
      if (hasLegacyCustomSirs || !valuesEqual(rawCustomSirs ?? {}, customSirs)) {
        updateData["system.customSirs"] = customSirs;
      }
      if (hasLegacyCustomSirs) updateData[`flags.peasant-core.-=${PC_CUSTOM_SIR_LOCATION_VALUES_FLAG}`] = null;
    }

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

    if (currentVersion < PC_WORLD_MIGRATION_SKILL_TYPES) {
      const skillTypesMigration = migrateEntryTypes(updateData["system.skills"] ?? rawSystem.skills);
      if (skillTypesMigration.changed) updateData["system.skills"] = skillTypesMigration.entries;

      const combatTypesMigration = migrateEntryTypes(migrationState.combats);
      migrationState = {
        combats: combatTypesMigration.entries,
        changed: migrationState.changed || combatTypesMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_CATEGORY_SKILL_TYPES) {
      const skillTypesMigration = migrateEntryCategoryTypes(updateData["system.skills"] ?? rawSystem.skills);
      if (skillTypesMigration.changed) updateData["system.skills"] = skillTypesMigration.entries;

      const combatTypesMigration = migrateEntryCategoryTypes(migrationState.combats);
      migrationState = {
        combats: combatTypesMigration.entries,
        changed: migrationState.changed || combatTypesMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_SIGNATURE_TYPES) {
      const skillSignatureMigration = migrateEntrySignatureTypes(updateData["system.skills"] ?? rawSystem.skills);
      if (skillSignatureMigration.changed) updateData["system.skills"] = skillSignatureMigration.entries;

      const combatSignatureMigration = migrateEntrySignatureTypes(migrationState.combats);
      migrationState = {
        combats: combatSignatureMigration.entries,
        changed: migrationState.changed || combatSignatureMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_MAGIC_SPELL_TYPES) {
      const skillSpellMigration = migrateMagicSpellTypes(updateData["system.skills"] ?? rawSystem.skills);
      if (skillSpellMigration.changed) updateData["system.skills"] = skillSpellMigration.entries;

      const combatSpellMigration = migrateMagicSpellTypes(migrationState.combats);
      migrationState = {
        combats: combatSpellMigration.entries,
        changed: migrationState.changed || combatSpellMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_MARTIAL_TYPES) {
      const skillMartialMigration = migrateMartialTypes(updateData["system.skills"] ?? rawSystem.skills);
      if (skillMartialMigration.changed) updateData["system.skills"] = skillMartialMigration.entries;

      const combatMartialMigration = migrateMartialTypes(migrationState.combats);
      migrationState = {
        combats: combatMartialMigration.entries,
        changed: migrationState.changed || combatMartialMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_SIGNATURE_USAGE_METADATA) {
      const skillSignatureUsageMigration = migrateSignatureUsageMetadata(updateData["system.skills"] ?? rawSystem.skills);
      if (skillSignatureUsageMigration.changed) updateData["system.skills"] = skillSignatureUsageMigration.entries;

      const combatSignatureUsageMigration = migrateSignatureUsageMetadata(migrationState.combats);
      migrationState = {
        combats: combatSignatureUsageMigration.entries,
        changed: migrationState.changed || combatSignatureUsageMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_DURESS_USES) {
      const skillDuressUsesMigration = migrateSignatureUsageDuressUses(updateData["system.skills"] ?? rawSystem.skills);
      if (skillDuressUsesMigration.changed) updateData["system.skills"] = skillDuressUsesMigration.entries;

      const combatDuressUsesMigration = migrateSignatureUsageDuressUses(migrationState.combats);
      migrationState = {
        combats: combatDuressUsesMigration.entries,
        changed: migrationState.changed || combatDuressUsesMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_TAG_PRESENTATION_METADATA) {
      const skillTagMetadataMigration = migrateTagLayoutMetadata(updateData["system.skills"] ?? rawSystem.skills);
      if (skillTagMetadataMigration.changed) updateData["system.skills"] = skillTagMetadataMigration.entries;

      const combatTagMetadataMigration = migrateTagLayoutMetadata(migrationState.combats);
      migrationState = {
        combats: combatTagMetadataMigration.entries,
        changed: migrationState.changed || combatTagMetadataMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_TAG_LAYOUT_GROUPS) {
      const skillTagGroupMigration = migrateTagLayoutMetadata(updateData["system.skills"] ?? rawSystem.skills, { removeGroups: true });
      if (skillTagGroupMigration.changed) updateData["system.skills"] = skillTagGroupMigration.entries;

      const combatTagGroupMigration = migrateTagLayoutMetadata(migrationState.combats, { removeGroups: true });
      migrationState = {
        combats: combatTagGroupMigration.entries,
        changed: migrationState.changed || combatTagGroupMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_USAGE_DESCRIPTIONS) {
      const skillUsageDescriptionMigration = migrateUsageDescriptions(updateData["system.skills"] ?? rawSystem.skills);
      if (skillUsageDescriptionMigration.changed) updateData["system.skills"] = skillUsageDescriptionMigration.entries;

      const combatUsageDescriptionMigration = migrateUsageDescriptions(migrationState.combats);
      migrationState = {
        combats: combatUsageDescriptionMigration.entries,
        changed: migrationState.changed || combatUsageDescriptionMigration.changed
      };
    }

    if (currentVersion < PC_WORLD_MIGRATION_E5_COMBAT_STATE) {
      const e5Update = getE5CombatStateMigrationUpdate(actor, {
        skills: updateData["system.skills"] ?? rawSystem.skills,
        notableCombats: migrationState.combats
      });
      const migratedCombats = e5Update["system.notableCombats"];
      delete e5Update["system.notableCombats"];
      Object.assign(updateData, e5Update);
      if (migratedCombats !== undefined) {
        migrationState = { combats: migratedCombats, changed: true };
      }
    }

    if (currentVersion < PC_WORLD_MIGRATION_MAGE_BLOCK_EFFECTS) {
      const sourceSkills = updateData["system.skills"] ?? rawSystem.skills;
      const mageBlockMigration = getE5MageBlockEffectsMigration(actor, {
        skills: sourceSkills,
        notableCombats: migrationState.combats
      });
      if (!valuesEqual(sourceSkills, mageBlockMigration.skills)) updateData["system.skills"] = mageBlockMigration.skills;
      if (!valuesEqual(migrationState.combats, mageBlockMigration.notableCombats)) {
        migrationState = { combats: mageBlockMigration.notableCombats, changed: true };
      }
      mageBlockEffectSources = mageBlockMigration.effectSources;
    }

    if (currentVersion < PC_WORLD_MIGRATION_MAGE_BLOCK_ZERO_HP_CLEANUP) {
      mageBlockEffectConsolidation = getMageBlockEffectConsolidationMigration(actor);
    }

    if (currentVersion < PC_WORLD_MIGRATION_USAGE_EFFECT_AUTOMATION) {
      const skillLinks = migrateSkillUsageEffectLinks(updateData["system.skills"] ?? rawSystem.skills);
      if (skillLinks.changed) updateData["system.skills"] = skillLinks.entries;
      const combatLinks = migrateSkillUsageEffectLinks(migrationState.combats);
      if (combatLinks.changed) migrationState = { combats: combatLinks.entries, changed: true };
    }

    if (currentVersion < PC_WORLD_MIGRATION_REMOVE_SHARED_TAGS) {
      const skills = removeSharedTagState(updateData["system.skills"] ?? rawSystem.skills);
      if (skills.changed) updateData["system.skills"] = skills.entries;
      const combats = removeSharedTagState(migrationState.combats);
      if (combats.changed) migrationState = { combats: combats.entries, changed: true };
    }

    const { combats, changed } = migrationState;
    if (changed) updateData["system.notableCombats"] = combats;
    if (
      Object.keys(updateData).length === 0
      && mageBlockEffectSources.length === 0
      && mageBlockEffectConsolidation.updates.length === 0
      && mageBlockEffectConsolidation.deleteIds.length === 0
    ) continue;

    try {
      if (mageBlockEffectSources.length) {
        await actor.createEmbeddedDocuments("ActiveEffect", mageBlockEffectSources, {
          peasantCoreSpellEffectWrite: true
        });
      }
      if (mageBlockEffectConsolidation.updates.length) {
        await actor.updateEmbeddedDocuments("ActiveEffect", mageBlockEffectConsolidation.updates, {
          peasantCoreSpellEffectWrite: true
        });
      }
      if (mageBlockEffectConsolidation.deleteIds.length) {
        await actor.deleteEmbeddedDocuments("ActiveEffect", mageBlockEffectConsolidation.deleteIds, {
          peasantCoreSpellEffectWrite: true
        });
      }
      if (Object.keys(updateData).length) await actor.update(updateData, { render: false });
      migratedActors += 1;
    } catch (err) {
      hadFailures = true;
      console.error(`Peasant Core | Failed to migrate actor data for ${actor.name}:`, err);
    }
  }

  if (currentVersion < PC_WORLD_MIGRATION_HERALDRY) {
    if (!(await migrateWorldHeraldryData())) hadFailures = true;
  }

  if (currentVersion < PC_WORLD_MIGRATION_OVERCHARGED_EFFECT) {
    if (!(await migrateWorldOverchargedEffects())) hadFailures = true;
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
  if (migratedSpellEffects > 0) {
    console.log(`Peasant Core | Migrated ${migratedSpellEffects} Manifest Spell Effect(s) to native Changes rows.`);
  }
}
