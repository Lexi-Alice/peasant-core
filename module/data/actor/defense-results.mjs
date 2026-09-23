import {
  createDefaultCombatDefenseEffectivenessEntry,
  getCombatDefenseResponseKey,
  normalizeCombatDefense,
  normalizeCombatDefenseEffectivenessEntry,
  parseCombatDefenseMosPer
} from "./combat-defense.mjs";
import { getCombatMagnetismGrade } from "./combat-tags.mjs";
import { PC_DEFAULT_PRIMAL_EVASION, PC_PRIMAL_EVASION_FLAG } from "./sheet-settings.mjs";

export function getWeaponMasteryMagnetismGrade(combat, defensePromptResult) {
  const baseGrade = getCombatMagnetismGrade(combat);
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  const masteryApplies = !!(
    defensePromptResult?.selection === "defense"
    && defense.block
    && defense.blockType === "Weapon"
    && defense.masteryBonus
    && defensePromptResult?.defenseRoll?.rollResult?.isSuccess
  );
  return masteryApplies ? Math.max(baseGrade, 1) : baseGrade;
}

export function getDefenseEffectivenessForTargeting(defenseData, targetingType) {
  const targetKey = getCombatDefenseResponseKey(targetingType);
  if (!targetKey) return createDefaultCombatDefenseEffectivenessEntry();
  return normalizeCombatDefenseEffectivenessEntry(defenseData?.effectiveness?.[targetKey]);
}

export function getAccuracyPenaltyFromDefenseRoll(defenseData, targetingType, rollResult) {
  const defense = normalizeCombatDefense(defenseData);
  if (defense.block && defense.blockType === "Mage") return 0;
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
  const responseKey = getCombatDefenseResponseKey(targetingType);
  if (["smite", "aoe", "areaBlast", "tileBlast"].includes(responseKey)) return false;
  return getActorPrimalEvasionValue(actor) >= 1;
}

export function doesSuccessfulAreaDefenseDefendAttack(targetingType, defensePromptResult) {
  const responseKey = getCombatDefenseResponseKey(targetingType);
  return !!(
    ["aoe", "areaBlast", "tileBlast"].includes(responseKey)
    && defensePromptResult?.selection === "defense"
    && defensePromptResult?.defenseRoll?.rollResult?.isSuccess
  );
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

export function isNarrowSuccessAttack(attackRoll) {
  const rollResult = attackRoll?.rollResult;
  if (!rollResult || typeof rollResult !== "object") return false;
  if (String(rollResult.resultText || "").trim() === "Narrow Success") return true;

  const baseMoS = Number(rollResult.baseMoS);
  const totalMoS = Number(rollResult.totalMoS);
  return !!(
    !rollResult.isSuccess
    && !String(rollResult.criticalType || "").trim()
    && Number.isFinite(baseMoS)
    && Number.isFinite(totalMoS)
    && baseMoS >= 0
    && totalMoS < 0
  );
}

function doesAttackDamageReachBlock(attackRoll) {
  return !!(
    attackRoll?.rollResult?.failureDueToDefense
    || isNarrowSuccessAttack(attackRoll)
  );
}

function hasPassedMageBlock(defensePromptResult) {
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  const rawMoS = defensePromptResult?.defenseRoll?.rollResult?.totalMoS;
  const totalMoS = Number(rawMoS);
  return !!(
    defensePromptResult?.selection === "defense"
    && defense.block
    && defense.blockType === "Mage"
    && rawMoS !== null
    && rawMoS !== undefined
    && String(rawMoS).trim() !== ""
    && Number.isFinite(totalMoS)
    && totalMoS >= 0
  );
}

export function isConfirmedManifestDomeResult(domeResult) {
  const penetration = domeResult?.penetration;
  return !!(
    domeResult?.handled
    && penetration !== null
    && penetration !== undefined
    && String(penetration).trim() !== ""
    && Number.isFinite(Number(penetration))
  );
}

export function doesAttackReachManifestDome({
  attackRoll = null,
  preDefenseRollResult = null,
  defensePromptResult = null
} = {}) {
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  const successfulPreDomeDeflection = !!(
    defensePromptResult?.selection === "defense"
    && defensePromptResult?.defenseRoll?.rollResult?.isSuccess
    && !defense.block
    && !defense.appliesDebuff
  );
  if (successfulPreDomeDeflection) return false;
  if (hasPassedMageBlock(defensePromptResult)) return true;

  if (defensePromptResult?.selection === "defense" && defense.block && doesAttackDamageReachBlock(attackRoll)) {
    return true;
  }
  const relevantRollResult = defense.appliesDebuff ? preDefenseRollResult : attackRoll?.rollResult;
  return !!(
    relevantRollResult?.isSuccess
    || (
      relevantRollResult === attackRoll?.rollResult
      && isNarrowSuccessAttack(attackRoll)
      && !doesPromptResultCountAsActiveDefense(defensePromptResult)
    )
  );
}

export function getPostDomeMagnetismGrade(existingGrade, domeResult) {
  const current = Math.max(0, Number.parseInt(existingGrade, 10) || 0);
  if (!domeResult?.handled || !domeResult?.applied || Number(domeResult.penetration) <= 0) return current;
  const domeGrade = Math.max(0, Number.parseInt(domeResult.magnetismGrade, 10) || 0);
  return current + domeGrade;
}

export function shouldContinueAfterManifestDome({
  attackRoll = null,
  defensePromptResult = null,
  domeResult = null
} = {}) {
  if (!isConfirmedManifestDomeResult(domeResult) || Number(domeResult.penetration) <= 0) return false;
  if (attackRoll?.rollResult?.isSuccess) return true;
  if (isNarrowSuccessAttack(attackRoll) && !doesPromptResultCountAsActiveDefense(defensePromptResult)) return true;
  if (hasPassedMageBlock(defensePromptResult)) return true;

  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  return !!(
    defensePromptResult?.selection === "defense"
    && defense.block
    && doesAttackDamageReachBlock(attackRoll)
  );
}

export function isMageDefenseDamageRedirect(defensePromptResult) {
  return hasPassedMageBlock(defensePromptResult);
}

export function isShieldDefenseDamageBlock(attackRoll, defensePromptResult) {
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  return !!(
    defensePromptResult?.selection === "defense"
    && doesAttackDamageReachBlock(attackRoll)
    && defense.block
    && defense.blockType === "Shield"
  );
}

export function isWeaponDefenseDamageBlock(attackRoll, defensePromptResult) {
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  return !!(
    defensePromptResult?.selection === "defense"
    && doesAttackDamageReachBlock(attackRoll)
    && defense.block
    && defense.blockType === "Weapon"
  );
}
