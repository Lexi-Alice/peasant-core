import {
  getDevastatingWoundAccuracyModifier,
  getDevastatingWoundCount,
  getEffectiveSkillCombatModifiers
} from "./combat-modifiers.mjs";
import { getWoundThresholdMultipliers } from "./targeted-damage.mjs";

export {
  getDevastatingWoundAccuracyModifier,
  getDevastatingWoundCount,
  getEffectiveSkillCombatModifiers
};

export function getBaseWoundThresholds(actorOrData) {
  const system = actorOrData?.system ?? actorOrData ?? {};
  const columns = Number(system.hp?.cols);
  const hpColumns = Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : 7;
  const multipliers = getWoundThresholdMultipliers(actorOrData);
  return {
    head: hpColumns * multipliers.head,
    arms: hpColumns * multipliers.arms,
    legs: hpColumns * multipliers.legs,
    torso: hpColumns * multipliers.torso
  };
}

export function getEffectiveWoundThresholds(actorOrData) {
  const base = getBaseWoundThresholds(actorOrData);
  const wounds = getDevastatingWoundCount(actorOrData);
  return {
    head: { base: base.head, effective: Math.max(1, base.head - 2 * wounds) },
    arms: { base: base.arms, effective: Math.max(1, base.arms - 4 * wounds) },
    legs: { base: base.legs, effective: Math.max(1, base.legs - 4 * wounds) },
    torso: { base: base.torso, effective: Math.max(1, base.torso - 6 * wounds) }
  };
}
