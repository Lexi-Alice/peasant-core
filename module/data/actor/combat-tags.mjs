import { parseOptionalInteger } from "./helpers.mjs";

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
  "targetingType",
  "defense",
  "reach",
  "stability",
  "strengthen",
  "custom",
  "self"
]);

export const COMBAT_TARGETING_TYPE_OPTIONS = Object.freeze([
  "Melee",
  "Projectile",
  "Normal Targeting",
  "Smite",
  "AoE",
  "Area Blast",
  "Tile Blast"
]);

export function normalizeCombatTargetingType(rawType) {
  const normalized = String(rawType ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  switch (normalized) {
    case "melee":
      return "Melee";
    case "projectile":
      return "Projectile";
    case "normal":
    case "normaltargeting":
      return "Normal Targeting";
    case "smite":
      return "Smite";
    case "aoe":
    case "area":
      return "AoE";
    case "blast":
    case "areablast":
      return "Area Blast";
    case "tile":
    case "tileblast":
      return "Tile Blast";
    default:
      return "";
  }
}

export function getLegacyAoeTargetingType(combatData) {
  const value = Number.parseInt(combatData?.aoe?.value, 10) || 0;
  if (value <= 0) return "";

  const type = String(combatData?.aoe?.type ?? "").trim().toLowerCase();
  if (type === "blast") return "Area Blast";
  if (type === "tile") return "Tile Blast";
  return "AoE";
}

export function getCombatTargetingType(combatData) {
  const rawTargetingType = String(combatData?.targetingType ?? "").trim();
  return normalizeCombatTargetingType(rawTargetingType)
    || getLegacyAoeTargetingType(combatData)
    || rawTargetingType;
}

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

export function normalizeRangeRateValue(raw) {
  const parts = Array.isArray(raw) ? raw.slice(0, 4) : String(raw ?? "").split("/").slice(0, 4);
  while (parts.length < 4) parts.push(null);
  return parts.map(value => parseOptionalInteger(value, { min: 0 }));
}

export function formatRangeRateValue(raw) {
  return normalizeRangeRateValue(raw)
    .map(value => value === null ? "x" : String(value))
    .join("/");
}

export function hasRangeRateValue(raw) {
  return normalizeRangeRateValue(raw).some(value => value !== null);
}

export function getRangeRatePartInputValue(raw, index) {
  const value = normalizeRangeRateValue(raw)[index];
  return value === null ? "" : String(value);
}
