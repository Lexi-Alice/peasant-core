import { applyDefensePenaltiesToRollResult } from "../../data/actor/defense-penalties.mjs";
import { getEffectiveSkillCombatModifiers } from "../../data/actor/combat-modifiers.mjs";
import { hasOptionalInteger, parseOptionalInteger } from "../../data/actor/helpers.mjs";
import { getNotableCombatImage } from "../../data/actor/notable-combat-image.mjs";
import { isSignatureSkillType } from "../../data/actor/skill-entry-types.mjs";
import { applyToHitAccuracy } from "../../dice/roll-targets.mjs";
import { performSkillRoll, performUntrainedSkillRoll } from "../../dice/rolls.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { getActorRollSpeaker } from "./actor-targets.mjs";
import { maybeForcePassFailedRoll } from "./force-pass.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";
import { markRollFailureDueToDefense } from "./roll-chat-updates.mjs";

export async function consumeNotableCombatRollUse(actor, combatIndex, sheet = null, usageContext = null) {
  try {
    const result = usageContext?.version === 1
      ? await actor?.consumePeasantEntryUses?.(
          { collection: usageContext.ref?.collection, entryId: usageContext.ref?.entryId },
          {
            usageId: usageContext.ref?.usageId || "base",
            pool: usageContext.signaturePool || "primary",
            spendSignature: isSignatureSkillType(usageContext.data?.type)
          }
        )
      : await actor?.consumePeasantCombatUse?.(combatIndex);
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
  targetLabel = "",
  cardClass = "",
  edgeChainContext = null,
  edgeExplodeReroll = null,
  combatMods = null
} = {}) {
  const resolvedCombatMods = combatMods || getEffectiveSkillCombatModifiers(actor);
  const toHitMod = Number.parseInt(resolvedCombatMods.toHit, 10) || 0;
  const accuracyMod = Number.parseInt(resolvedCombatMods.accuracy, 10) || 0;
  const resolvedDefenseAccuracyPenalty = Math.abs(Number(defenseAccuracyPenalty) || 0);
  const resolvedDefenseToHitPenalty = Number(defenseToHitPenalty) || 0;

  const combatToHit = parseOptionalInteger(combat.tohit, { min: 1 });
  const combatAccuracy = parseOptionalInteger(combat.accuracy, { allowSign: true });
  const baseToHit = hasOptionalInteger(combatToHit) ? combatToHit : 7;
  const baseAccuracy = combatAccuracy ?? 0;
  const accuracyHasValue = hasOptionalInteger(combatAccuracy);
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
    finalToHit = Number.parseInt(rollOverrides.toHit, 10) + toHitAdj + resolvedDefenseToHitPenalty;

    const overrideAccuracyRaw = rollOverrides.accuracy;
    if (overrideAccuracyRaw === undefined || overrideAccuracyRaw === null || overrideAccuracyRaw === "") {
      finalAccuracy = 0 + accuracyAdj - resolvedDefenseAccuracyPenalty;
      accuracyValue = finalAccuracy === 0 ? undefined : finalAccuracy;
    } else {
      finalAccuracy = (Number.parseInt(overrideAccuracyRaw, 10) || 0) + accuracyAdj - resolvedDefenseAccuracyPenalty;
      accuracyValue = finalAccuracy;
    }
    untrainedAccuracyValue = finalAccuracy;
  } else {
    const totalToHitMod = toHitMod + toHitAdj + resolvedDefenseToHitPenalty;
    const totalAccuracyMod = accuracyMod + accuracyAdj - resolvedDefenseAccuracyPenalty;
    const rollCalc = applyToHitAccuracy(baseToHit, baseAccuracy, totalToHitMod, totalAccuracyMod, 2);
    finalToHit = rollCalc.toHit;
    finalAccuracy = rollCalc.accuracy;
    accuracyValue = (!accuracyHasValue && finalAccuracy === 0) ? undefined : finalAccuracy;
    untrainedAccuracyValue = finalAccuracy;
  }

  const speaker = getActorRollSpeaker(actor, attackerToken);
  const imageSrc = getNotableCombatImage(combat);
  let rollResult = null;

  if (isUntrained) {
    const untrainedName = targetLabel
      ? `${combat.name || "Combat"} Untrained Roll vs ${targetLabel}`
      : `${combat.name || "Combat"} Untrained Roll`;

    rollResult = await performUntrainedSkillRoll({
      toHit: finalToHit,
      accuracy: untrainedAccuracyValue,
      skillName: untrainedName,
      speaker,
      cardClass,
      imageSrc,
      edgeChainContext,
      edgeExplodeReroll
    });
  } else {
    rollResult = await performSkillRoll({ toHit: finalToHit, accuracy: accuracyValue, skillName: combatName, speaker, cardClass, imageSrc, edgeChainContext, edgeExplodeReroll });
  }

  const forcePassResult = await maybeForcePassFailedRoll({
    actor,
    rollLabel: combatName,
    rollResult,
    cancelChainOnClose: !String(cardClass || "").split(/\s+/).includes("pc-defense-roll-card")
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
      defenseAccuracyPenalty: resolvedDefenseAccuracyPenalty,
      defenseToHitPenalty: resolvedDefenseToHitPenalty,
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
  const defenseOutcomeLabel = (failureDueToDefense || penaltyApplication?.narrowSuccessIntoDefense)
    ? String(rollResult?.resultText || defenseFailureLabel)
    : "";
  if (defenseOutcomeLabel && rollResult) {
    try {
      await markRollFailureDueToDefense(rollResult, { label: defenseOutcomeLabel });
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
    defenseAccuracyPenalty: resolvedDefenseAccuracyPenalty,
    defenseToHitPenalty: resolvedDefenseToHitPenalty,
    forcePassResult,
    targetLabel,
    rollResult
  };
}
