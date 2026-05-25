import {
  createDefaultCombatDefenseEffectivenessEntry,
  getCombatDefenseResponseKey,
  normalizeCombatDefense,
  normalizeCombatDefenseEffectivenessEntry,
  parseCombatDefenseMosPer
} from "./combat-defense.mjs";
import { PC_DEFAULT_PRIMAL_EVASION, PC_PRIMAL_EVASION_FLAG } from "./sheet-settings.mjs";

export function getDefenseEffectivenessForTargeting(defenseData, targetingType) {
  const targetKey = getCombatDefenseResponseKey(targetingType);
  if (!targetKey) return createDefaultCombatDefenseEffectivenessEntry();
  return normalizeCombatDefenseEffectivenessEntry(defenseData?.effectiveness?.[targetKey]);
}

export function getAccuracyPenaltyFromDefenseRoll(defenseData, targetingType, rollResult) {
  const effectiveness = getDefenseEffectivenessForTargeting(defenseData, targetingType);
  const mosPer = parseCombatDefenseMosPer(effectiveness?.mosPer);
  const accuracyPenalty = Math.abs(Number.parseInt(effectiveness?.accuracyPenalty, 10) || 0);
  const totalMoS = Number(rollResult?.totalMoS);

  if (!Number.isFinite(totalMoS) || totalMoS <= 0 || mosPer <= 0 || accuracyPenalty === 0) {
    return 0;
  }

  const steps = Math.floor((totalMoS + 1e-9) / mosPer);
  if (steps <= 0) return 0;
  return steps * accuracyPenalty;
}

export function getActorPrimalEvasionValue(actor) {
  const rawValue = Number(actor?.getFlag?.("peasant-core", PC_PRIMAL_EVASION_FLAG));
  if (!Number.isFinite(rawValue)) return PC_DEFAULT_PRIMAL_EVASION;
  return Math.max(0, Math.floor(rawValue));
}

export function canApplyPrimalEvasion(actor, targetingType) {
  if (getCombatDefenseResponseKey(targetingType) === "smite") return false;
  return getActorPrimalEvasionValue(actor) >= 1;
}

export function createPrimalEvasionDefenseResult(actor, targetingType) {
  const penalty = canApplyPrimalEvasion(actor, targetingType) ? getActorPrimalEvasionValue(actor) : 0;
  return {
    handled: true,
    selection: "none",
    selectedCombatIndex: null,
    selectedDefense: null,
    defenseRoll: null,
    appliedAccuracyPenalty: penalty,
    appliedToHitPenalty: 0,
    activeDefense: penalty >= 1,
    primalEvasionPenalty: penalty
  };
}

export function getToHitPenaltyFromDefenseRoll(defenseData, rollResult) {
  const defense = normalizeCombatDefense(defenseData);
  const totalMoS = Number(rollResult?.totalMoS);
  if (!defense.appliesDebuff) return 0;
  if (!defense.appliesBefore) return 0;
  if (!Number.isFinite(totalMoS) || totalMoS < 0) return 0;
  return Number.parseInt(defense.debuffToHit, 10) || 0;
}

export function doesPromptResultCountAsActiveDefense(defensePromptResult) {
  if (!defensePromptResult || typeof defensePromptResult !== "object") return false;
  if (defensePromptResult.selection === "defense") return true;
  return !!defensePromptResult.activeDefense;
}

export function getFailureLabelFromDefensePromptResult(defensePromptResult) {
  if (Number(defensePromptResult?.primalEvasionPenalty) >= 1) {
    return "Failure due to Primal Evasion";
  }
  return "Failure due to Defense";
}

export function isMageDefenseDamageRedirect(attackRoll, defensePromptResult) {
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  return !!(
    defensePromptResult?.selection === "defense"
    && attackRoll?.rollResult?.failureDueToDefense
    && defense.block
    && defense.blockType === "Mage"
  );
}

export function isShieldDefenseDamageBlock(attackRoll, defensePromptResult) {
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  return !!(
    defensePromptResult?.selection === "defense"
    && attackRoll?.rollResult?.failureDueToDefense
    && defense.block
    && defense.blockType === "Shield"
  );
}

export function isWeaponDefenseDamageBlock(attackRoll, defensePromptResult) {
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  return !!(
    defensePromptResult?.selection === "defense"
    && attackRoll?.rollResult?.failureDueToDefense
    && defense.block
    && defense.blockType === "Weapon"
  );
}
