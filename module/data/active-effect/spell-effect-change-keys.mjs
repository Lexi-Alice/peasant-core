import {
  applyPeasantNumericActiveEffectChange,
  clampPeasantInteger
} from "./change-modes.mjs";
import { normalizeHaltValues } from "../actor/combat-modifiers.mjs";

export const MANIFEST_SPELL_EFFECT_CHANGE_KEYS = Object.freeze({
  buffCategory: "effect.system.buffCategory",
  manifestType: "effect.system.manifestType",
  currentHp: "effect.system.magicalHp.value",
  maximumHp: "effect.system.magicalHp.max",
  magnetismGrade: "effect.system.magnetismGrade"
});

const MANIFEST_SPELL_EFFECT_CHANGE_KEY_SET = new Set(Object.values(MANIFEST_SPELL_EFFECT_CHANGE_KEYS));
const RESISTANCE_HALT_LOCATIONS = Object.freeze(["head", "arms", "legs", "torso"]);
const ACTIVE_EFFECT_TYPE_MODES = Object.freeze({
  custom: 0,
  multiply: 1,
  add: 2,
  downgrade: 3,
  upgrade: 4,
  override: 5
});
const ACTIVE_EFFECT_MODE_TYPES = Object.freeze(Object.fromEntries(
  Object.entries(ACTIVE_EFFECT_TYPE_MODES).map(([type, mode]) => [mode, type])
));

function activeEffectMode(name, fallback) {
  return globalThis.CONST?.ACTIVE_EFFECT_MODES?.[name] ?? fallback;
}

function normalizedIdentifier(value) {
  return String(value ?? "").trim().toLowerCase();
}

function orderedChanges(changes) {
  return Array.from(changes ?? []).map((change, index) => ({ change, index }))
    .sort((left, right) => (
      (Number(left.change?.priority) || 0) - (Number(right.change?.priority) || 0)
      || left.index - right.index
    ))
    .map(({ change }) => change);
}

export function getManifestSpellEffectChanges(effect) {
  return effect?.changes
    ?? effect?.system?.changes
    ?? effect?._source?.changes
    ?? effect?._source?.system?.changes
    ?? [];
}

export function getManifestSpellEffectChangeMode(change) {
  // Foundry v14 stores string `type` values; numeric `mode` remains compatible with older sources.
  const numericMode = Number(change?.mode);
  if (Number.isInteger(numericMode)) return numericMode;
  const type = String(change?.type ?? "").trim().toLowerCase();
  if (type in ACTIVE_EFFECT_TYPE_MODES) return ACTIVE_EFFECT_TYPE_MODES[type];
  const custom = type.match(/^custom\.(-?\d+)$/);
  return custom ? Number.parseInt(custom[1], 10) : activeEffectMode("CUSTOM", 0);
}

function toNativeActiveEffectChange(change) {
  const mode = getManifestSpellEffectChangeMode(change);
  return {
    key: String(change?.key ?? ""),
    type: ACTIVE_EFFECT_MODE_TYPES[mode] ?? `custom.${mode}`,
    value: change?.value,
    phase: String(change?.phase ?? "initial"),
    priority: Number.isFinite(Number(change?.priority)) ? Number(change.priority) : 20
  };
}

export function toFoundryManifestSpellEffectChanges(changes) {
  return Array.from(changes ?? []).map(toNativeActiveEffectChange);
}

export function isManifestSpellEffectChangeKey(key) {
  return MANIFEST_SPELL_EFFECT_CHANGE_KEY_SET.has(String(key ?? "").trim());
}

export function getManifestSpellEffectState(effect, { changes = null } = {}) {
  const rows = orderedChanges(changes ?? getManifestSpellEffectChanges(effect));
  const customMode = activeEffectMode("CUSTOM", 0);
  let buffCategory = "";
  let manifestType = "";
  let currentHp = 0;
  let maximumHp = 0;
  let maximumHpSeen = false;
  let magnetismGrade = 0;

  for (const change of rows) {
    const key = String(change?.key ?? "").trim();
    if (!isManifestSpellEffectChangeKey(key)) continue;

    if (key === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.buffCategory) {
      const value = normalizedIdentifier(change?.value);
      if (getManifestSpellEffectChangeMode(change) === customMode && ["aura", "armor"].includes(value)) buffCategory = value;
      continue;
    }
    if (key === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.manifestType) {
      const value = normalizedIdentifier(change?.value);
      if (getManifestSpellEffectChangeMode(change) === customMode && ["dome", "resistance"].includes(value)) manifestType = value;
      continue;
    }
    if (key === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp) {
      currentHp = applyPeasantNumericActiveEffectChange(currentHp, change?.value, getManifestSpellEffectChangeMode(change));
      continue;
    }
    if (key === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.maximumHp) {
      maximumHpSeen = true;
      maximumHp = applyPeasantNumericActiveEffectChange(maximumHp, change?.value, getManifestSpellEffectChangeMode(change));
      continue;
    }
    magnetismGrade = applyPeasantNumericActiveEffectChange(magnetismGrade, change?.value, getManifestSpellEffectChangeMode(change));
  }

  const max = clampPeasantInteger(maximumHp, { min: 0 });
  const value = clampPeasantInteger(currentHp, {
    min: 0,
    max: maximumHpSeen ? max : Infinity
  });
  return {
    buffCategory,
    manifestType,
    magicalHp: { value, max },
    magnetismGrade: clampPeasantInteger(magnetismGrade, { min: 0 })
  };
}

export function buildManifestSpellEffectChanges({
  manifestType = "",
  hp = null,
  haltValues = null,
  magnetismGrade = 1
} = {}) {
  const type = normalizedIdentifier(manifestType);
  if (!["dome", "resistance"].includes(type)) return [];

  const customMode = activeEffectMode("CUSTOM", 0);
  const addMode = activeEffectMode("ADD", 2);
  const overrideMode = activeEffectMode("OVERRIDE", 5);
  const rows = [
    { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.buffCategory, mode: customMode, value: type === "dome" ? "aura" : "armor", priority: 20 },
    { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.manifestType, mode: customMode, value: type, priority: 20 },
    { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp, mode: addMode, value: clampPeasantInteger(hp?.value, { min: 0 }), priority: 20 },
    { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.maximumHp, mode: overrideMode, value: clampPeasantInteger(hp?.max, { min: 0 }), priority: 20 }
  ];

  if (type === "dome") {
    rows.push({
      key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.magnetismGrade,
      mode: addMode,
      value: clampPeasantInteger(magnetismGrade, { min: 0 }),
      priority: 20
    });
    return rows;
  }

  const values = normalizeHaltValues(haltValues ?? [1, 1, 1, 1]);
  rows.push(...RESISTANCE_HALT_LOCATIONS.map((location, index) => ({
    key: `system.naturalHaltValues.${location}`,
    mode: addMode,
    value: values[index],
    priority: 20
  })));
  return rows;
}

export function setManifestSpellCurrentHp(changes, value) {
  const rows = Array.from(changes ?? []);
  const firstIndex = rows.findIndex((change) => (
    String(change?.key ?? "").trim() === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp
  ));
  const first = firstIndex >= 0 ? rows[firstIndex] : null;
  const currentRow = {
    key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp,
    value: clampPeasantInteger(value, { min: 0 }),
    priority: Number.isFinite(Number(first?.priority)) ? Number(first.priority) : 20
  };
  if (rows.some((change) => Object.hasOwn(change ?? {}, "type"))) {
    currentRow.type = "add";
    currentRow.phase = String(first?.phase ?? "initial");
  } else currentRow.mode = activeEffectMode("ADD", 2);
  const filtered = rows.filter((change) => (
    String(change?.key ?? "").trim() !== MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp
  ));
  filtered.splice(firstIndex >= 0 ? firstIndex : filtered.length, 0, currentRow);
  return filtered;
}

export function migrateLegacyManifestSpellEffectSystemData(source) {
  if (!source || typeof source !== "object") return false;
  const manifestType = normalizedIdentifier(source.manifestKind);
  if (!["dome", "resistance"].includes(manifestType)) return false;

  const existingChanges = Array.from(source.changes ?? []);
  const existingState = getManifestSpellEffectState({ changes: existingChanges });
  const hasMagnetismRow = existingChanges.some((change) => (
    String(change?.key ?? "").trim() === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.magnetismGrade
  ));
  const resistanceKeys = new Set(RESISTANCE_HALT_LOCATIONS.map((location) => (
    `system.naturalHaltValues.${location}`
  )));
  const existingHaltRows = new Map(existingChanges
    .filter((change) => resistanceKeys.has(String(change?.key ?? "").trim()))
    .map((change) => [String(change.key).trim(), change]));
  const generated = buildManifestSpellEffectChanges({
    manifestType,
    hp: source.magicalHp,
    haltValues: source.haltValues,
    magnetismGrade: hasMagnetismRow ? existingState.magnetismGrade : 1
  }).map(toNativeActiveEffectChange).map((change) => (
    manifestType === "resistance" && existingHaltRows.has(change.key)
      ? existingHaltRows.get(change.key)
      : change
  ));
  const selfKeys = new Set(Object.values(MANIFEST_SPELL_EFFECT_CHANGE_KEYS));
  const unrelated = existingChanges.filter((change) => {
    const key = String(change?.key ?? "").trim();
    return !selfKeys.has(key) && !(manifestType === "resistance" && resistanceKeys.has(key));
  });
  source.changes = [...generated, ...unrelated];
  delete source.buffCategory;
  delete source.manifestKind;
  delete source.magicalHp;
  delete source.haltValues;
  return true;
}
