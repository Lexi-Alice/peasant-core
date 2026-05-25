export const COMBAT_VIEW_TAG_TYPES = Object.freeze([
  "resourceCosts",
  "speed",
  "range",
  "rangeRate",
  "damage",
  "overkill",
  "magnetism",
  "heal",
  "manifest",
  "tagUses",
  "sections",
  "aoe",
  "targetingType",
  "defense",
  "reach",
  "stability",
  "strengthen",
  "custom",
  "self"
]);

export const COMBAT_EDITOR_TAG_TYPES = Object.freeze([
  "description",
  "resourceCosts",
  "speed",
  "range",
  "rangeRate",
  "damage",
  "overkill",
  "magnetism",
  "heal",
  "manifest",
  "tagUses",
  "sections",
  "aoe",
  "targetingType",
  "defense",
  "reach",
  "stability",
  "strengthen",
  "custom",
  "self"
]);

export const COMBAT_FULL_TAG_ORDER = Object.freeze([
  "description",
  "staminaCost",
  "attunementCost",
  "resourceCosts",
  "speed",
  "range",
  "rangeRate",
  "damage",
  "overkill",
  "magnetism",
  "heal",
  "manifest",
  "tagUses",
  "sections",
  "aoe",
  "targetingType",
  "defense",
  "reach",
  "stability",
  "strengthen",
  "custom",
  "self"
]);

export function normalizeCombatMagnetism(rawMagnetism) {
  const source = (rawMagnetism && typeof rawMagnetism === "object") ? rawMagnetism.grade : rawMagnetism;
  const grade = Number.parseInt(source, 10);
  return { grade: Number.isFinite(grade) ? Math.max(0, grade) : 0 };
}

export function getCombatMagnetismGrade(combatData) {
  return normalizeCombatMagnetism(combatData?.magnetism).grade;
}

export function normalizeCustomTagEntry(entry) {
  const name = String(entry?.name ?? "").trim();
  const value = String(entry?.value ?? "").trim();
  return { name, value };
}

export function getCombatCustomTags(combatData) {
  const list = Array.isArray(combatData?.customTags)
    ? combatData.customTags.map(normalizeCustomTagEntry).filter((tag) => !!tag.name)
    : [];
  if (list.length > 0) return list;

  const legacy = normalizeCustomTagEntry(combatData?.customTag || {});
  return legacy.name ? [legacy] : [];
}

export function syncCombatCustomTags(combatData) {
  const normalized = getCombatCustomTags(combatData);
  combatData.customTags = normalized;
  combatData.customTag = normalized[0] ? { ...normalized[0] } : { name: "", value: "" };
  return combatData;
}
