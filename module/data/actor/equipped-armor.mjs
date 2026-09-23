import { normalizeHaltValues } from "./combat-modifiers.mjs";

export const PC_ARMOR_EQUIPMENT_CATEGORIES = new Set(["light-armor", "medium-armor", "heavy-armor"]);
const ARMOR_GRADE_BY_CATEGORY = Object.freeze({ "light-armor": "light", "medium-armor": "medium", "heavy-armor": "heavy" });
const ARMOR_GRADE_WEIGHT = Object.freeze({ light: 1, medium: 2, heavy: 3 });

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

export function getEquippedArmorEffects(actor) {
  const effects = {
    haltValues: [0, 0, 0, 0],
    hardHead: false,
    hardArms: false,
    hardLegs: false,
    hardTorso: false,
    grade: "",
    movementModifier: 0,
    aoeSaveModifier: 0,
    aoeAutoFail: false
  };

  for (const item of actor?.items ?? []) {
    const system = item?.system;
    if (item?.type !== "equipment" || !system?.equipped || !PC_ARMOR_EQUIPMENT_CATEGORIES.has(system.category)) continue;

    const armor = system.armor ?? {};
    const grade = ARMOR_GRADE_BY_CATEGORY[system.category] ?? "";
    if ((ARMOR_GRADE_WEIGHT[grade] ?? 0) > (ARMOR_GRADE_WEIGHT[effects.grade] ?? 0)) effects.grade = grade;
    const haltValues = normalizeHaltValues(armor.haltValues);
    effects.haltValues = effects.haltValues.map((value, index) => value + haltValues[index]);
    effects.hardHead ||= !!armor.hardHead;
    effects.hardArms ||= !!armor.hardArms;
    effects.hardLegs ||= !!armor.hardLegs;
    effects.hardTorso ||= !!armor.hardTorso;
    effects.movementModifier += integer(armor.movementProfile);

    const aoeModifier = String(armor.aoeSaveModifier ?? "0").trim().toUpperCase();
    if (aoeModifier === "CS") effects.aoeAutoFail = true;
    else effects.aoeSaveModifier += integer(aoeModifier);
  }

  return effects;
}

export function addEquippedArmorHalt(values, effects) {
  return normalizeHaltValues(values).map((value, index) => value + effects.haltValues[index]);
}

// Sheet fields show effective totals, so remove item contributions before saving the manual actor values.
export function removeEquippedArmorHalt(values, effects) {
  return normalizeHaltValues(values).map((value, index) => Math.max(0, value - effects.haltValues[index]));
}

export function getArmorAdjustedMovement(value, effects, trainingPenalty = 0) {
  return Math.max(0, integer(value) + effects.movementModifier + integer(trainingPenalty));
}

export function removeEquippedArmorMovement(value, effects, trainingPenalty = 0) {
  return Math.max(0, integer(value) - effects.movementModifier - integer(trainingPenalty));
}

export function getArmorAdjustedAoeSaveTarget(value, effects) {
  return Math.max(2, integer(value) + effects.aoeSaveModifier);
}

export function removeEquippedArmorAoeSaveModifier(value, effects) {
  return Math.max(1, integer(value) - effects.aoeSaveModifier);
}
