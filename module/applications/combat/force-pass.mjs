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

export async function maybeForcePassFailedNotableRoll({
  actor = null,
  rollLabel = "Skill Roll",
  rollResult = null
} = {}) {
  if (!actor || !rollResult || rollResult.isSuccess) {
    return { forced: false, stressCost: 0, spendType: null, reason: "not-failed" };
  }

  if (String(rollResult.criticalType || "").trim() === "Critical Failure") {
    return { forced: false, stressCost: 0, spendType: null, reason: "critical-failure" };
  }

  const preAccuracyMoS = getPreAccuracyMoSFromRollResult(rollResult);
  if (!Number.isFinite(preAccuracyMoS) || preAccuracyMoS >= 0) {
    return { forced: false, stressCost: 0, spendType: null, reason: "accuracy-or-non-dice-failure" };
  }

  const stressCost = getForcePassStressCostFromRollResult(rollResult);
  if (stressCost <= 0) {
    return { forced: false, stressCost, spendType: null, reason: "no-cost" };
  }

  const promptResult = await showForcePassPromptDialog({ actor, rollLabel, stressCost });
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

  rollResult.totalMoS = 0;
  rollResult.isSuccess = true;
  rollResult.resultText = "Success";
  rollResult.forcedPass = true;
  rollResult.forcedPassStressCost = stressCost;
  rollResult.forcedPassSpendType = spendType;

  try {
    await markRollForcedPass(rollResult, { stressCost, spendType });
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to restyle roll as forced pass", e);
  }

  return { forced: true, stressCost, spendType, reason: "forced-pass" };
}
