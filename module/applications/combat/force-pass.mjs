import {
  getForcePassSpendTypeLabel,
  getForcePassStressCostFromRollResult,
  getPreAccuracyMoSFromRollResult,
  getStressCapacityForSpendType,
  spendStressForForcePass
} from "../../data/actor/stress.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { isChainCancelledResult, showForcePassPromptDialog } from "./prompt-dialogs.mjs";
import { markRollForcedPass } from "./roll-chat-updates.mjs";

function isCriticalFailureRollResult(rollResult) {
  if (!rollResult || typeof rollResult !== "object") return false;
  const criticalType = String(rollResult.criticalType || "").trim().toLowerCase();
  const resultText = String(rollResult.resultText || "").trim().toLowerCase();
  if (criticalType === "critical failure" || resultText === "critical failure") return true;
  if (criticalType.includes("critical") && criticalType.includes("failure")) return true;

  const criticalMoS = Number(rollResult.criticalMoS);
  return Number.isFinite(criticalMoS) && criticalMoS < 0;
}

function isGlancingSuccessRollResult(rollResult) {
  if (!rollResult || typeof rollResult !== "object" || !rollResult.isSuccess) return false;
  if (String(rollResult.criticalType || "").trim()) return false;
  if (String(rollResult.resultText || "").trim() === "Glancing Success") return true;

  const preAccuracyMoS = getPreAccuracyMoSFromRollResult(rollResult);
  const totalMoS = Number(rollResult.totalMoS);
  return Number.isFinite(preAccuracyMoS)
    && Number.isFinite(totalMoS)
    && preAccuracyMoS < 0
    && totalMoS >= 0;
}

function getStressUpgradedTotalMoS(rollResult) {
  const accuracyMoS = Number.isFinite(Number(rollResult?.accuracyMoS))
    ? Number(rollResult.accuracyMoS)
    : 0;
  const criticalMoS = Number.isFinite(Number(rollResult?.criticalMoS))
    ? Number(rollResult.criticalMoS)
    : 0;
  return Math.max(0, accuracyMoS + criticalMoS);
}

export async function maybeForcePassFailedNotableRoll({
  actor = null,
  rollLabel = "Skill Roll",
  rollResult = null
} = {}) {
  if (!actor || !rollResult) {
    return { forced: false, stressCost: 0, spendType: null, reason: "not-failed" };
  }

  if (isCriticalFailureRollResult(rollResult)) {
    return { forced: false, stressCost: 0, spendType: null, reason: "critical-failure" };
  }

  const isGlancingSuccess = isGlancingSuccessRollResult(rollResult);
  if (rollResult.isSuccess && !isGlancingSuccess) {
    return { forced: false, stressCost: 0, spendType: null, reason: "not-failed" };
  }

  const preAccuracyMoS = getPreAccuracyMoSFromRollResult(rollResult);
  if (!Number.isFinite(preAccuracyMoS) || preAccuracyMoS >= 0) {
    return { forced: false, stressCost: 0, spendType: null, reason: "accuracy-or-non-dice-failure" };
  }

  const stressCost = getForcePassStressCostFromRollResult(rollResult);
  if (stressCost <= 0) {
    return { forced: false, stressCost, spendType: null, reason: "no-cost" };
  }

  const promptResult = await showForcePassPromptDialog({
    actor,
    rollLabel,
    stressCost,
    promptText: isGlancingSuccess
      ? `Spend ${stressCost} stress to make this a full success?`
      : ""
  });
  if (isChainCancelledResult(promptResult)) {
    return {
      forced: false,
      stressCost,
      spendType: promptResult?.spendType || null,
      reason: "close",
      chainCancelled: true
    };
  }
  if (!promptResult?.forced) {
    return {
      forced: false,
      stressCost,
      spendType: promptResult?.spendType || null,
      reason: promptResult?.selection || "declined"
    };
  }

  const spendType = String(promptResult.spendType || "general").trim().toLowerCase();
  const availableCapacity = getStressCapacityForSpendType(actor, spendType);
  if (availableCapacity < stressCost) {
    ui.notifications?.warn?.(`Not enough ${getForcePassSpendTypeLabel(spendType)} capacity to spend ${stressCost} stress.`);
    return { forced: false, stressCost, spendType, reason: "insufficient-capacity" };
  }

  const spendResult = await spendStressForForcePass(actor, spendType, stressCost);
  if (!spendResult?.ok) {
    ui.notifications?.warn?.(`Could not spend ${stressCost} ${getForcePassSpendTypeLabel(spendType)}.`);
    return { forced: false, stressCost, spendType, reason: "spend-failed" };
  }

  rollResult.baseMoS = 0;
  rollResult.totalMoS = getStressUpgradedTotalMoS(rollResult);
  rollResult.isSuccess = true;
  rollResult.resultText = "Success";
  if (isGlancingSuccess) {
    rollResult.glancingSuccessUpgraded = true;
    rollResult.glancingSuccessStressCost = stressCost;
    rollResult.glancingSuccessSpendType = spendType;
  } else {
    rollResult.forcedPass = true;
    rollResult.forcedPassStressCost = stressCost;
    rollResult.forcedPassSpendType = spendType;
  }

  try {
    await markRollForcedPass(rollResult, {
      stressCost,
      spendType,
      noteLabel: isGlancingSuccess ? "Full Success" : "Forced Pass",
      setMoSToZero: false
    });
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to restyle roll as forced pass", e);
  }

  return { forced: true, stressCost, spendType, reason: isGlancingSuccess ? "glancing-success-upgraded" : "forced-pass" };
}
