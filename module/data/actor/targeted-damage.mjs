import { COMBAT_HALT_BUFF_TYPE_HALT, COMBAT_HALT_BUFF_TYPE_NATURAL, getCombatHaltBuffTotals, parseHaltSlashValues } from "./combat-modifiers.mjs";

export const PC_ARMOR_CHARGE_MULTIPLIER_FLAG = "armorChargeMultiplier";
export const PC_DEFAULT_ARMOR_CHARGE_MULTIPLIER = 2;
export const PC_WOUND_HEAD_MULTIPLIER_FLAG = "woundHeadMultiplier";
export const PC_DEFAULT_WOUND_HEAD_MULTIPLIER = 1;
export const PC_WOUND_ARMS_MULTIPLIER_FLAG = "woundArmsMultiplier";
export const PC_DEFAULT_WOUND_ARMS_MULTIPLIER = 2;
export const PC_WOUND_LEGS_MULTIPLIER_FLAG = "woundLegsMultiplier";
export const PC_DEFAULT_WOUND_LEGS_MULTIPLIER = 2;
export const PC_WOUND_TORSO_MULTIPLIER_FLAG = "woundTorsoMultiplier";
export const PC_DEFAULT_WOUND_TORSO_MULTIPLIER = 3;

export const TARGETED_DAMAGE_LOCATION_DISPLAY_MAP = Object.freeze({
  Head: "Head",
  Torso: "Torso",
  RightArm: "Right Arm",
  LeftArm: "Left Arm",
  RightLeg: "Right Leg",
  LeftLeg: "Left Leg"
});

export const TARGETED_DAMAGE_CONDITION_KEY_MAP = Object.freeze({
  Head: "head",
  Torso: "torso",
  RightArm: "arms",
  LeftArm: "arms",
  RightLeg: "legs",
  LeftLeg: "legs"
});

export const TARGETED_DAMAGE_HALT_INDEX_MAP = Object.freeze({
  Head: 0,
  RightArm: 1,
  LeftArm: 1,
  RightLeg: 2,
  LeftLeg: 2,
  Torso: 3
});

export const LOWEST_HALT_LOCATION_PRIORITY = Object.freeze([
  "Head",
  "RightArm",
  "LeftArm",
  "RightLeg",
  "LeftLeg",
  "Torso"
]);

export const TARGETED_DAMAGE_HARD_FLAG_MAP = Object.freeze({
  Head: { hard: "hardHead", naturalHard: "naturalHardHead" },
  Torso: { hard: "hardTorso", naturalHard: "naturalHardTorso" },
  RightArm: { hard: "hardArms", naturalHard: "naturalHardArms" },
  LeftArm: { hard: "hardArms", naturalHard: "naturalHardArms" },
  RightLeg: { hard: "hardLegs", naturalHard: "naturalHardLegs" },
  LeftLeg: { hard: "hardLegs", naturalHard: "naturalHardLegs" }
});

export function sanitizePositiveMultiplier(value, fallback = 1, min = 0.1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, fallback);
  return Math.max(min, parsed);
}

export function getWoundThresholdMultipliers(actor) {
  return {
    head: sanitizePositiveMultiplier(actor?.getFlag?.("peasant-core", PC_WOUND_HEAD_MULTIPLIER_FLAG), PC_DEFAULT_WOUND_HEAD_MULTIPLIER),
    arms: sanitizePositiveMultiplier(actor?.getFlag?.("peasant-core", PC_WOUND_ARMS_MULTIPLIER_FLAG), PC_DEFAULT_WOUND_ARMS_MULTIPLIER),
    legs: sanitizePositiveMultiplier(actor?.getFlag?.("peasant-core", PC_WOUND_LEGS_MULTIPLIER_FLAG), PC_DEFAULT_WOUND_LEGS_MULTIPLIER),
    torso: sanitizePositiveMultiplier(actor?.getFlag?.("peasant-core", PC_WOUND_TORSO_MULTIPLIER_FLAG), PC_DEFAULT_WOUND_TORSO_MULTIPLIER)
  };
}

export function getArmorChargeMultiplier(actor) {
  return sanitizePositiveMultiplier(
    actor?.getFlag?.("peasant-core", PC_ARMOR_CHARGE_MULTIPLIER_FLAG),
    PC_DEFAULT_ARMOR_CHARGE_MULTIPLIER
  );
}

export function getTargetedDamageLocationDisplay(location) {
  return TARGETED_DAMAGE_LOCATION_DISPLAY_MAP[location] || location || "Torso";
}

export function getTargetedDamageConditionKey(location) {
  return TARGETED_DAMAGE_CONDITION_KEY_MAP[location] || "torso";
}

export function isArmorPenLocationLike({ isAP = false, rawText = "", locationResultText = "", label = "" } = {}) {
  if (isAP) return true;
  const combined = [rawText, locationResultText, label]
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  return combined.includes("armor pen") || combined.includes("head pen");
}

export function getLowestHaltDamageLocation(actor) {
  if (!actor) return "Torso";

  const haltParts = parseHaltSlashValues(actor.system?.haltValues || "0/0/0/0");
  const naturalHaltParts = parseHaltSlashValues(actor.system?.naturalHaltValues || "0/0/0/0");
  const combatHaltTotals = getCombatHaltBuffTotals(actor.system?.combatMods?.haltBuffs);
  const armorHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_HALT] || [0, 0, 0, 0];
  const naturalHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_NATURAL] || [0, 0, 0, 0];

  let bestLocation = "Torso";
  let bestValue = Number.POSITIVE_INFINITY;
  for (const location of LOWEST_HALT_LOCATION_PRIORITY) {
    const haltValue = getHaltValueForLocation(location, haltParts, armorHaltBuffs, naturalHaltParts, naturalHaltBuffs);
    if (haltValue < bestValue) {
      bestValue = haltValue;
      bestLocation = location;
    }
  }
  return bestLocation;
}

export function getHighestHaltDamageLocation(actor) {
  if (!actor) return "Torso";

  const haltParts = parseHaltSlashValues(actor.system?.haltValues || "0/0/0/0");
  const naturalHaltParts = parseHaltSlashValues(actor.system?.naturalHaltValues || "0/0/0/0");
  const combatHaltTotals = getCombatHaltBuffTotals(actor.system?.combatMods?.haltBuffs);
  const armorHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_HALT] || [0, 0, 0, 0];
  const naturalHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_NATURAL] || [0, 0, 0, 0];

  let bestLocation = "Torso";
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const location of LOWEST_HALT_LOCATION_PRIORITY) {
    const haltValue = getHaltValueForLocation(location, haltParts, armorHaltBuffs, naturalHaltParts, naturalHaltBuffs);
    if (haltValue > bestValue) {
      bestValue = haltValue;
      bestLocation = location;
    }
  }
  return bestLocation;
}

function getHaltValueForLocation(location, haltParts, armorHaltBuffs, naturalHaltParts, naturalHaltBuffs) {
  const haltIndex = TARGETED_DAMAGE_HALT_INDEX_MAP[location] ?? 0;
  const armorHalt = (Number.parseInt(haltParts[haltIndex], 10) || 0) + (armorHaltBuffs[haltIndex] || 0);
  const naturalHalt = (Number.parseInt(naturalHaltParts[haltIndex], 10) || 0) + (naturalHaltBuffs[haltIndex] || 0);
  return armorHalt + naturalHalt;
}

export function normalizeAppliedDamageType(rawType, fallback = "blunt") {
  const normalized = String(rawType || "").trim().toLowerCase();
  switch (normalized) {
    case "blunt":
      return "blunt";
    case "hybrid":
      return "hybrid";
    case "lethal":
      return "lethal";
    case "critical":
    case "crit":
      return "critical";
    case "flexible":
      return "flexible";
    default:
      return fallback;
  }
}
