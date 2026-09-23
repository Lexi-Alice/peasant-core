import { getEquippedArmorEffects } from "./equipped-armor.mjs";

const ARMOR_TRAINING_CLASS = Object.freeze({ light: 2, medium: 3, heavy: 4 });
const ARMOR_CAPACITY_BY_CLASS = Object.freeze({
  2: Object.freeze({ light: [1, 2], medium: [0, 0], heavy: [0, 0] }),
  3: Object.freeze({ light: [2, 3], medium: [1, 2], heavy: [0, 0] }),
  4: Object.freeze({ light: [3, 4], medium: [2, 3], heavy: [1, 2] }),
  5: Object.freeze({ light: [5, 6], medium: [4, 5], heavy: [3, 4] })
});
const ARMOR_MOVEMENT_PENALTY = Object.freeze({ light: -1, medium: -2, heavy: -3 });
const ARMOR_GRADE_WEIGHT = Object.freeze({ light: 1, medium: 2, heavy: 3 });

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function numericRank(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "u") return -1;
  const rank = Number(normalized);
  return Number.isInteger(rank) ? Math.max(0, Math.min(4, rank)) : 0;
}

function armorSkills(actor) {
  return (Array.isArray(actor?.system?.skills) ? actor.system.skills : [])
    .filter((skill) => String(skill?.category ?? "").trim().toLowerCase() === "martial"
      && String(skill?.type ?? "").trim().toLowerCase() === "defense"
      && String(skill?.defenseType ?? "").trim().toLowerCase() === "armor");
}

export function getEquippedArmorGrade(actor) {
  return getEquippedArmorEffects(actor).grade;
}

export function getActorArmorSkill(actor) {
  return armorSkills(actor).reduce((selected, skill) => {
    if (!selected) return skill;
    const classLevel = integer(skill?.class, 1);
    const selectedClass = integer(selected?.class, 1);
    if (classLevel !== selectedClass) return classLevel > selectedClass ? skill : selected;
    return numericRank(skill?.rank) > numericRank(selected?.rank) ? skill : selected;
  }, null);
}

function getArmorSkillCapacity(grade, skill) {
  const classLevel = Math.max(1, integer(skill?.class, 1));
  if (classLevel < 2 || !ARMOR_GRADE_WEIGHT[grade]) return 0;
  const rank4 = numericRank(skill?.rank) >= 4;
  if (classLevel <= 5) return ARMOR_CAPACITY_BY_CLASS[classLevel]?.[grade]?.[rank4 ? 1 : 0] ?? 0;

  const class5Capacity = ARMOR_CAPACITY_BY_CLASS[5][grade][0];
  return class5Capacity + 2 * (classLevel - 5) + Number(rank4);
}

export function getActiveArmorChargeCapacity(actor) {
  const grade = getEquippedArmorGrade(actor);
  if (!grade) return 0;
  return getArmorSkillCapacity(grade, getActorArmorSkill(actor));
}

export function getActiveArmorTraining(actor) {
  const grade = getEquippedArmorGrade(actor);
  const skill = getActorArmorSkill(actor);
  const requiredClass = ARMOR_TRAINING_CLASS[grade] ?? 0;
  const trained = requiredClass > 0 && integer(skill?.class, 1) >= requiredClass;
  return {
    grade,
    skill,
    requiredClass,
    trained,
    capacity: getArmorSkillCapacity(grade, skill),
    movementPenalty: grade && !trained ? ARMOR_MOVEMENT_PENALTY[grade] : 0
  };
}

export function getUntrainedArmorMovementPenalty(actor) {
  return getActiveArmorTraining(actor).movementPenalty;
}

export function canSpendActiveArmorCharge(actor) {
  const training = getActiveArmorTraining(actor);
  const current = Math.max(0, Math.floor(Number(actor?.system?.armorCharge?.value) || 0));
  return !!training.grade && training.trained && Math.min(current, training.capacity) > 0;
}
