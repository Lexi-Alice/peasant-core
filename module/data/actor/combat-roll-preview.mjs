import { applyToHitAccuracy } from "../../dice/roll-targets.mjs";
import { getEffectiveSkillCombatModifiers } from "./combat-modifiers.mjs";
import { hasOptionalInteger, parseOptionalInteger } from "./helpers.mjs";
import { isRollableSkillType } from "./skill-entry-types.mjs";
import { DEFENSIVE_REFLEXES_TO_HIT_KEY } from "../active-effect/key-policy.mjs";

export function getNotableCombatRollPreview(actor, combat, { defenseRoll = false } = {}) {
  if (!actor || !combat) {
    return {
      allowToHitAcc: false,
      hasToHit: false,
      hasAccuracy: false,
      modifiedTohit: "",
      accuracyNum: 0,
      accuracySign: "+"
    };
  }

  const combatMods = getEffectiveSkillCombatModifiers(actor);
  const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
  const accuracyMod = Number.parseInt(combatMods.accuracy, 10) || 0;
  const tohitValue = parseOptionalInteger(combat.tohit, { min: 1 });
  const accuracyValue = parseOptionalInteger(combat.accuracy, { allowSign: true });
  const hasBaseTohit = hasOptionalInteger(tohitValue);
  const hasBaseAccuracy = hasOptionalInteger(accuracyValue);
  const baseAccuracy = accuracyValue ?? 0;
  const baseTohit = hasBaseTohit ? tohitValue : 7;
  const combatCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
  const accuracyNum = combatCalc.accuracy;
  const addMode = Number(globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2);
  const defenseToHitModifier = defenseRoll
    ? Array.from(actor.effects || []).reduce((total, effect) => {
      if (effect?.disabled) return total;
      return (effect?.changes ?? effect?._source?.changes ?? []).reduce((sum, change) => {
        const value = Number(change?.value);
        return change?.key === DEFENSIVE_REFLEXES_TO_HIT_KEY
          && Number(change?.mode) === addMode
          && Number.isFinite(value)
          ? sum + value
          : sum;
      }, total);
    }, 0)
    : 0;
  const modifiedTohit = combatCalc.toHit + defenseToHitModifier;
  const allowToHitAcc = isRollableSkillType(combat.type);

  return {
    allowToHitAcc,
    hasToHit: allowToHitAcc && (hasBaseTohit || defenseToHitModifier !== 0),
    hasAccuracy: allowToHitAcc && (accuracyNum !== 0 || hasBaseAccuracy),
    modifiedTohit,
    accuracyNum,
    accuracySign: accuracyNum >= 0 ? "+" : ""
  };
}
