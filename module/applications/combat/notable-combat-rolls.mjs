import { applyDefensePenaltiesToRollResult } from "../../data/actor/defense-penalties.mjs";
import { applyToHitAccuracy } from "../../dice/roll-targets.mjs";
import { performSkillRoll, performUntrainedSkillRoll } from "../../dice/rolls.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { getActorRollSpeaker } from "./actor-targets.mjs";
import { maybeForcePassFailedNotableRoll } from "./force-pass.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";
import { markRollFailureDueToDefense } from "./roll-chat-updates.mjs";

export async function consumeNotableCombatRollUse(actor, combatIndex, sheet = null) {
  try {
    const result = await actor?.consumePeasantCombatUse?.(combatIndex);
    if (result?.changed && typeof sheet?.render === "function") sheet.render(false);
    return result;
  } catch (err) {
    console.warn("Failed to consume combat use after autoroll:", err);
    return { ok: false, changed: false, error: err };
  }
}

export async function executeResolvedNotableCombatRoll({
  actor,
  combat,
  combatIndex,
  attackerToken = null,
  toHitAdj = 0,
  accuracyAdj = 0,
  rollOverrides = null,
  defenseAccuracyPenalty = 0,
  defenseToHitPenalty = 0,
  defenseFailureLabel = "Failure due to Defense",
  targetLabel = ""
} = {}) {
  const combatMods = actor.system?.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 };
  const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
  const accuracyMod = Number.parseInt(combatMods.accuracy, 10) || 0;

  const baseToHit = Number.isFinite(Number.parseInt(combat.tohit, 10))
    ? Number.parseInt(combat.tohit, 10)
    : 7;
  const baseAccuracy = Number.parseInt(combat.accuracy, 10) || 0;
  const accuracyHasValue = !(combat.accuracy === undefined || combat.accuracy === null || combat.accuracy === "");
  const combatRollBaseName = `${combat.name || "Combat"} Roll`;
  const combatName = targetLabel ? `${combatRollBaseName} vs ${targetLabel}` : combatRollBaseName;

  const rankStr = String(combat.rank || "").trim().toLowerCase();
  const isUntrained = rankStr === "u";

  let finalToHit;
  let finalAccuracy;
  let accuracyValue;
  let untrainedAccuracyValue;

  const hasRollOverrides = !!rollOverrides && Number.isFinite(Number.parseInt(rollOverrides.toHit, 10));
  if (hasRollOverrides) {
    finalToHit = Number.parseInt(rollOverrides.toHit, 10) + toHitAdj + defenseToHitPenalty;

    const overrideAccuracyRaw = rollOverrides.accuracy;
    if (overrideAccuracyRaw === undefined || overrideAccuracyRaw === null || overrideAccuracyRaw === "") {
      finalAccuracy = 0 + accuracyAdj - defenseAccuracyPenalty;
      accuracyValue = finalAccuracy === 0 ? undefined : finalAccuracy;
    } else {
      finalAccuracy = (Number.parseInt(overrideAccuracyRaw, 10) || 0) + accuracyAdj - defenseAccuracyPenalty;
      accuracyValue = finalAccuracy;
    }
    untrainedAccuracyValue = finalAccuracy;
  } else {
    const totalToHitMod = toHitMod + toHitAdj + defenseToHitPenalty;
    const totalAccuracyMod = accuracyMod + accuracyAdj - defenseAccuracyPenalty;
    const rollCalc = applyToHitAccuracy(baseToHit, baseAccuracy, totalToHitMod, totalAccuracyMod, 2);
    finalToHit = rollCalc.toHit;
    finalAccuracy = rollCalc.accuracy;
    accuracyValue = (!accuracyHasValue && finalAccuracy === 0) ? undefined : finalAccuracy;
    untrainedAccuracyValue = finalAccuracy;
  }

  const speaker = getActorRollSpeaker(actor, attackerToken);
  let rollResult = null;

  if (isUntrained) {
    const untrainedName = targetLabel
      ? `${combat.name || "Combat"} Untrained Roll vs ${targetLabel}`
      : `${combat.name || "Combat"} Untrained Roll`;

    rollResult = await performUntrainedSkillRoll({
      toHit: finalToHit,
      accuracy: untrainedAccuracyValue,
      skillName: untrainedName,
      speaker
    });
  } else {
    rollResult = await performSkillRoll({ toHit: finalToHit, accuracy: accuracyValue, skillName: combatName, speaker });
  }

  const forcePassResult = await maybeForcePassFailedNotableRoll({
    actor,
    rollLabel: combatName,
    rollResult
  });
  if (isChainCancelledResult(forcePassResult)) {
    return {
      rolled: true,
      actorId: actor.id,
      combatIndex,
      combatName: combat.name || "Combat",
      rollLabel: combatName,
      toHit: finalToHit,
      accuracy: accuracyValue,
      defenseAccuracyPenalty,
      defenseToHitPenalty,
      forcePassResult,
      targetLabel,
      rollResult,
      chainCancelled: true
    };
  }
  const penaltyApplication = applyDefensePenaltiesToRollResult(rollResult, {
    defenseAccuracyPenalty,
    defenseToHitPenalty,
    defenseFailureLabel,
    preserveChatMessage: true
  });
  if (penaltyApplication?.rollResult) {
    rollResult = penaltyApplication.rollResult;
  }
  const failureDueToDefense = !!penaltyApplication?.failureDueToDefense;
  if (failureDueToDefense && rollResult) {
    try {
      await markRollFailureDueToDefense(rollResult, { label: defenseFailureLabel });
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to restyle attack roll as defense failure", e);
    }
  }

  return {
    rolled: true,
    actorId: actor.id,
    combatIndex,
    combatName: combat.name || "Combat",
    rollLabel: combatName,
    toHit: finalToHit,
    accuracy: accuracyValue,
    defenseAccuracyPenalty,
    defenseToHitPenalty,
    forcePassResult,
    targetLabel,
    rollResult
  };
}
