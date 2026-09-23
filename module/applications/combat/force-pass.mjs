import {
  getForcePassSpendTypeLabel,
  getForcePassStressCostFromRollResult,
  getPreAccuracyMoSFromRollResult,
  getStressCapacityForSpendType,
  spendStressForForcePass
} from "../../data/actor/stress.mjs";
import { captureActorRollUndo } from "../chat-undo.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { isChainCancelledResult, showForcePassPromptDialog } from "./prompt-dialogs.mjs";
import { markRollForcedPass } from "./roll-chat-updates.mjs";

const PC_SYSTEM_ID = "peasant-core";
export const PC_STRESS_ROLL_FLAG = "stressRoll";

function serializeStressRollResult(rollResult) {
  return {
    toHit: Number.isFinite(Number(rollResult?.toHit)) ? Number(rollResult.toHit) : null,
    accuracy: Number.isFinite(Number(rollResult?.accuracy)) ? Number(rollResult.accuracy) : null,
    initialDice: Array.isArray(rollResult?.initialDice) ? rollResult.initialDice.map(Number) : [],
    allDice: Array.isArray(rollResult?.allDice) ? rollResult.allDice.map(Number) : [],
    keptDice: Array.isArray(rollResult?.keptDice) ? rollResult.keptDice.map(Number) : [],
    additionalDice: Array.isArray(rollResult?.additionalDice) ? rollResult.additionalDice.map(Number) : [],
    initialTotal: Number.isFinite(Number(rollResult?.initialTotal)) ? Number(rollResult.initialTotal) : null,
    total: Number.isFinite(Number(rollResult?.total)) ? Number(rollResult.total) : null,
    baseMoS: Number.isFinite(Number(rollResult?.baseMoS)) ? Number(rollResult.baseMoS) : null,
    accuracyMoS: Number.isFinite(Number(rollResult?.accuracyMoS)) ? Number(rollResult.accuracyMoS) : 0,
    criticalMoS: Number.isFinite(Number(rollResult?.criticalMoS)) ? Number(rollResult.criticalMoS) : 0,
    totalMoS: Number.isFinite(Number(rollResult?.totalMoS)) ? Number(rollResult.totalMoS) : null,
    isSuccess: !!rollResult?.isSuccess,
    resultText: String(rollResult?.resultText || "").trim(),
    criticalType: String(rollResult?.criticalType || "").trim()
  };
}

async function markStressRollRetryAvailable({ actor, rollLabel, rollResult, kind, stressCostMultiplier, fixedSpendType }) {
  const message = rollResult?.chatMessage;
  if (!message?.setFlag) return;
  await message.setFlag(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG, {
    version: 1,
    status: "available",
    processing: false,
    kind: ["save", "check"].includes(kind) ? kind : "roll",
    actorId: actor?.id || null,
    actorUuid: actor?.uuid || null,
    actorName: actor?.name || "Actor",
    rollLabel: String(rollLabel || "Roll").trim() || "Roll",
    stressCostMultiplier: Math.max(1, Number(stressCostMultiplier) || 1),
    fixedSpendType: String(fixedSpendType || "").trim().toLowerCase() || null,
    rollResult: serializeStressRollResult(rollResult),
    createdAt: Date.now()
  });
}

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

export async function maybeForcePassFailedRoll({
  actor = null,
  rollLabel = "Skill Roll",
  rollResult = null,
  kind = "roll",
  stressCostMultiplier = 1,
  fixedSpendType = null,
  cancelChainOnClose = true
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

  const stressCost = getForcePassStressCostFromRollResult(rollResult)
    * Math.max(1, Number(stressCostMultiplier) || 1);
  if (stressCost <= 0) {
    return { forced: false, stressCost, spendType: null, reason: "no-cost" };
  }

  const promptResult = await showForcePassPromptDialog({
    actor,
    rollLabel,
    stressCost,
    fixedSpendType,
    promptText: isGlancingSuccess
      ? `Spend ${stressCost} stress to make this a full success?`
      : ""
  });
  if (isChainCancelledResult(promptResult)) {
    await markStressRollRetryAvailable({
      actor,
      rollLabel,
      rollResult,
      kind,
      stressCostMultiplier,
      fixedSpendType
    });
    return {
      forced: false,
      stressCost,
      spendType: promptResult?.spendType || null,
      reason: "close",
      chainCancelled: cancelChainOnClose
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

  const spendType = String(fixedSpendType || promptResult.spendType || "general").trim().toLowerCase();
  const availableCapacity = getStressCapacityForSpendType(actor, spendType);
  if (availableCapacity < stressCost) {
    ui.notifications?.warn?.(`Not enough ${getForcePassSpendTypeLabel(spendType)} capacity to spend ${stressCost} stress.`);
    return { forced: false, stressCost, spendType, reason: "insufficient-capacity" };
  }

  const stressSpend = await captureActorRollUndo(
    actor,
    `${rollLabel || "Roll"} Force Pass Stress`,
    () => spendStressForForcePass(actor, spendType, stressCost)
  );
  const spendResult = stressSpend.result;
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

  return {
    forced: true,
    stressCost,
    spendType,
    reason: isGlancingSuccess ? "glancing-success-upgraded" : "forced-pass",
    undoRecords: stressSpend.undoRecords
  };
}

export const maybeForcePassFailedNotableRoll = maybeForcePassFailedRoll;
