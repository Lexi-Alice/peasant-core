export function applyDefensePenaltiesToRollResult(sourceRollResult, {
  defenseAccuracyPenalty = 0,
  defenseToHitPenalty = 0,
  defenseFailureLabel = "Failure due to Defense",
  preserveChatMessage = false
} = {}) {
  if (!sourceRollResult || typeof sourceRollResult !== "object") return null;

  const defensePenaltyValue = Number(defenseAccuracyPenalty) || 0;
  const defenseToHitPenaltyValue = Number(defenseToHitPenalty) || 0;
  const totalDefensePenaltyValue = defensePenaltyValue + defenseToHitPenaltyValue;

  const rollResult = {
    ...sourceRollResult,
    chatMessage: preserveChatMessage ? sourceRollResult.chatMessage : null
  };

  const sourceTotalMoS = Number(sourceRollResult.totalMoS);
  const resolvedSourceTotalMoS = Number.isFinite(sourceTotalMoS) ? sourceTotalMoS : 0;
  const preDefenseTotalMoS = rollResult.forcedPass ? 0 : resolvedSourceTotalMoS;

  if (Number.isFinite(Number(sourceRollResult.baseMoS))) {
    rollResult.baseMoS = Number(sourceRollResult.baseMoS) - (defenseToHitPenaltyValue * 0.25);
  }

  const sourceAccuracyMoS = Number(sourceRollResult.accuracyMoS);
  if (Number.isFinite(sourceAccuracyMoS)) {
    rollResult.accuracyMoS = sourceAccuracyMoS - (defensePenaltyValue * 0.25);
  } else if (defensePenaltyValue !== 0) {
    rollResult.accuracyMoS = -(defensePenaltyValue * 0.25);
  }

  if (Number.isFinite(Number(sourceRollResult.toHit))) {
    rollResult.toHit = Number(sourceRollResult.toHit) + defenseToHitPenaltyValue;
  }

  const sourceAccuracyValue = sourceRollResult.accuracy;
  const sourceAccuracyNum = (sourceAccuracyValue === undefined || sourceAccuracyValue === null || sourceAccuracyValue === "")
    ? 0
    : (Number.parseInt(sourceAccuracyValue, 10) || 0);
  const adjustedAccuracy = sourceAccuracyNum - defensePenaltyValue;
  rollResult.accuracy = (sourceAccuracyValue === undefined || sourceAccuracyValue === null || sourceAccuracyValue === "") && adjustedAccuracy === 0
    ? undefined
    : adjustedAccuracy;

  rollResult.totalMoS = preDefenseTotalMoS - (totalDefensePenaltyValue * 0.25);

  const failureDueToDefense = totalDefensePenaltyValue > 0
    && preDefenseTotalMoS >= 0
    && Number(rollResult.totalMoS) <= 0;

  rollResult.failureDueToDefense = failureDueToDefense;
  rollResult.failureDueToPrimalEvasion = failureDueToDefense && defenseFailureLabel === "Failure due to Primal Evasion";

  if (failureDueToDefense) {
    rollResult.isSuccess = false;
    rollResult.resultText = defenseFailureLabel;
  } else {
    rollResult.isSuccess = Number(rollResult.totalMoS) >= 0;
  }

  return {
    rollResult,
    defensePenaltyValue,
    defenseToHitPenaltyValue,
    totalDefensePenaltyValue,
    failureDueToDefense
  };
}
