import { getCombatCostModifiers } from "../../data/actor/combat-modifiers.mjs";
import { applyDefensePenaltiesToRollResult } from "../../data/actor/defense-penalties.mjs";
import { getFailureLabelFromDefensePromptResult } from "../../data/actor/defense-results.mjs";
import { normalizeAppliedDamageType } from "../../data/actor/targeted-damage.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { getActiveNotableCombatTargets, getPreferredActorToken } from "./actor-targets.mjs";
import { emitDefensePromptRequestsForAttack } from "./defense-prompt-requests.mjs";
import { consumeNotableCombatRollUse, executeResolvedNotableCombatRoll } from "./notable-combat-rolls.mjs";
import { isChainCancelledResult, showFlexibleDamageTypePrompt } from "./prompt-dialogs.mjs";
import { showRangeRatePrompt } from "./range-rate-dialog.mjs";
import { updateSkillRollChatCardFromResult } from "./roll-chat-updates.mjs";
import { resolveSuccessfulAttackDamageForTarget } from "./successful-attack-damage.mjs";

export async function performNotableCombatRoll({
  actor,
  combatIndex,
  toHitAdj = 0,
  accuracyAdj = 0,
  sheet = null,
  promptForTargets = true,
  rollOverrides = null,
  targetLabel = "",
  selectedDamageType = null,
  cardClass = ""
} = {}) {
  try {
    if (!actor) return false;

    const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
    const combat = combats[combatIndex] || null;
    if (!combat) return false;
    pcLog.debug("Peasant Core | performNotableCombatRoll", {
      actor: actor.name,
      combatIndex,
      combatName: combat?.name || "Combat",
      promptForTargets
    });

    const attackerToken = getPreferredActorToken(actor);
    const activeTargets = promptForTargets ? getActiveNotableCombatTargets() : [];
    const shouldRollPerTarget = activeTargets.length > 1;
    let resolvedDamageType = normalizeAppliedDamageType(selectedDamageType, "");
    if (!resolvedDamageType) {
      const combatDamageType = normalizeAppliedDamageType(combat?.damage?.type, "");
      if (combatDamageType === "flexible" && activeTargets.length > 0) {
        const damageTypePrompt = await showFlexibleDamageTypePrompt({
          combatName: combat?.name || "Attack"
        });
        if (isChainCancelledResult(damageTypePrompt)) {
          return {
            rolled: false,
            actorId: actor.id,
            combatIndex,
            combatName: combat.name || "Combat",
            chainCancelled: true,
            damageTypePrompt
          };
        }
        resolvedDamageType = normalizeAppliedDamageType(damageTypePrompt?.damageType, "blunt");
      }
    }

    let defensePromptSummary = { totalAccuracyPenalty: 0, promptResults: [] };
    if (promptForTargets) {
      defensePromptSummary = await emitDefensePromptRequestsForAttack({
        actor,
        combat,
        combatIndex,
        attackerToken
      }) || defensePromptSummary;
    }
    if (defensePromptSummary?.abortChain) {
      return {
        rolled: false,
        actorId: actor.id,
        combatIndex,
        combatName: combat.name || "Combat",
        chainCancelled: true,
        defensePromptSummary
      };
    }

    const combatMods = actor.system?.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 };
    const costModifiersByType = getCombatCostModifiers(combatMods);

    if (typeof actor.applyPeasantCombatResourceCosts === "function") {
      await actor.applyPeasantCombatResourceCosts(combat, costModifiersByType);
    }

    let rollOutcome;
    if (shouldRollPerTarget) {
      const sharedAttackRoll = await executeResolvedNotableCombatRoll({
        actor,
        combat,
        combatIndex,
        attackerToken,
        toHitAdj,
        accuracyAdj,
        rollOverrides,
        defenseAccuracyPenalty: 0,
        defenseToHitPenalty: 0,
        targetLabel: "Multiple Targets",
        cardClass
      });
      if (isChainCancelledResult(sharedAttackRoll)) {
        await consumeNotableCombatRollUse(actor, combatIndex, sheet);
        return {
          rolled: false,
          actorId: actor.id,
          combatIndex,
          combatName: combat.name || "Combat",
          multiTarget: true,
          targetRolls: [],
          sharedAttackRoll,
          chainCancelled: true,
          defensePromptSummary
        };
      }

      const promptResultByTokenId = new Map(
        (defensePromptSummary?.promptResults || [])
          .map((entry) => [String(entry?.targetTokenId || ""), entry])
          .filter(([tokenId]) => !!tokenId)
      );

      const targetRolls = [];
      for (const target of activeTargets) {
        const promptEntry = promptResultByTokenId.get(String(target.tokenId || "")) || null;
        const defenseAccuracyPenalty = Number(promptEntry?.result?.appliedAccuracyPenalty) || 0;
        const defenseToHitPenalty = Number(promptEntry?.result?.appliedToHitPenalty) || 0;
        const defenseFailureLabel = getFailureLabelFromDefensePromptResult(promptEntry?.result);
        const penaltyApplication = applyDefensePenaltiesToRollResult(sharedAttackRoll?.rollResult, {
          defenseAccuracyPenalty,
          defenseToHitPenalty,
          defenseFailureLabel,
          preserveChatMessage: false
        });
        const targetRoll = {
          ...sharedAttackRoll,
          targetLabel: target.targetName,
          defenseAccuracyPenalty,
          defenseToHitPenalty,
          rollResult: penaltyApplication?.rollResult || sharedAttackRoll?.rollResult || null,
          sharedAttackRollId: sharedAttackRoll?.rollResult?.chatMessage?.id || null
        };
        if (isChainCancelledResult(targetRoll)) {
          await consumeNotableCombatRollUse(actor, combatIndex, sheet);
          return {
            rolled: false,
            actorId: actor.id,
            combatIndex,
            combatName: combat.name || "Combat",
            multiTarget: true,
            targetRolls,
            chainCancelled: true,
            defensePromptSummary
          };
        }
        const incomingHitResolution = await resolveSuccessfulAttackDamageForTarget({
          actor,
          attackerToken,
          combat,
          target,
          attackRoll: targetRoll,
          defensePromptResult: promptEntry?.result || null,
          appliedDamageType: resolvedDamageType || null
        });
        if (isChainCancelledResult(incomingHitResolution)) {
          await consumeNotableCombatRollUse(actor, combatIndex, sheet);
          return {
            rolled: true,
            actorId: actor.id,
            combatIndex,
            combatName: combat.name || "Combat",
            multiTarget: true,
            targetRolls,
            chainCancelled: true,
            defensePromptSummary,
            cancelledAfterRoll: true
          };
        }
        targetRolls.push({
          ...targetRoll,
          targetTokenId: target.tokenId,
          targetActorId: target.actorId,
          targetName: target.targetName,
          defensePromptResult: promptEntry?.result || null,
          incomingHitResolution
        });
      }

      rollOutcome = {
        rolled: !!sharedAttackRoll?.rolled,
        actorId: actor.id,
        combatIndex,
        combatName: combat.name || "Combat",
        multiTarget: true,
        sharedAttackRoll,
        targetRolls,
        defensePromptSummary
      };
    } else {
      const defenseAccuracyPenalty = Number(defensePromptSummary?.totalAccuracyPenalty) || 0;
      const defenseToHitPenalty = Number(defensePromptSummary?.totalToHitPenalty) || 0;
      const defenseFailureLabel = getFailureLabelFromDefensePromptResult(defensePromptSummary?.promptResults?.[0]?.result);
      const target = activeTargets[0] || null;
      const resolvedTargetLabel = target?.targetName || targetLabel || "";
      const singleRoll = await executeResolvedNotableCombatRoll({
        actor,
        combat,
        combatIndex,
        attackerToken,
        toHitAdj,
        accuracyAdj,
        rollOverrides,
        defenseAccuracyPenalty: 0,
        defenseToHitPenalty: 0,
        targetLabel: resolvedTargetLabel,
        cardClass
      });
      if (isChainCancelledResult(singleRoll)) {
        await consumeNotableCombatRollUse(actor, combatIndex, sheet);
        return {
          ...singleRoll,
          multiTarget: false,
          defensePromptSummary,
          targetTokenId: target?.tokenId || null,
          targetActorId: target?.actorId || null,
          targetName: target?.targetName || null,
          chainCancelled: true
        };
      }
      if (singleRoll?.rollResult && (Math.abs(defenseAccuracyPenalty) > 0 || Math.abs(defenseToHitPenalty) > 0)) {
        const penaltyApplication = applyDefensePenaltiesToRollResult(singleRoll.rollResult, {
          defenseAccuracyPenalty,
          defenseToHitPenalty,
          defenseFailureLabel,
          preserveChatMessage: true
        });
        if (penaltyApplication?.rollResult) {
          singleRoll.rollResult = penaltyApplication.rollResult;
          singleRoll.toHit = penaltyApplication.rollResult.toHit;
          singleRoll.accuracy = penaltyApplication.rollResult.accuracy;
          singleRoll.defenseAccuracyPenalty = defenseAccuracyPenalty;
          singleRoll.defenseToHitPenalty = defenseToHitPenalty;
          try {
            await updateSkillRollChatCardFromResult(singleRoll.rollResult, {
              label: penaltyApplication.failureDueToDefense ? defenseFailureLabel : null
            });
          } catch (e) {
            pcLog.debug("Peasant Core | Failed to update single-target roll after defense penalties", e);
          }
        }
      }
      const incomingHitResolution = await resolveSuccessfulAttackDamageForTarget({
        actor,
        attackerToken,
        combat,
        target,
        attackRoll: singleRoll,
        defensePromptResult: defensePromptSummary?.promptResults?.[0]?.result || null,
        appliedDamageType: resolvedDamageType || null
      });
      if (isChainCancelledResult(incomingHitResolution)) {
        await consumeNotableCombatRollUse(actor, combatIndex, sheet);
        return {
          ...singleRoll,
          multiTarget: false,
          defensePromptSummary,
          targetTokenId: target?.tokenId || null,
          targetActorId: target?.actorId || null,
          targetName: target?.targetName || null,
          incomingHitResolution,
          chainCancelled: true
        };
      }
      rollOutcome = {
        ...singleRoll,
        multiTarget: false,
        defensePromptSummary,
        targetTokenId: target?.tokenId || null,
        targetActorId: target?.actorId || null,
        targetName: target?.targetName || null,
        incomingHitResolution
      };
    }

    await consumeNotableCombatRollUse(actor, combatIndex, sheet);

    return rollOutcome;
  } catch (e) {
    console.error("Peasant Core | performNotableCombatRoll failed", e);
    return { rolled: false, error: e };
  }
}

export async function startNotableCombatRoll({
  actor,
  combatIndex,
  sheet = null,
  promptForTargets = true,
  rollOverrides = null,
  targetLabel = "",
  selectedDamageType = null,
  cardClass = ""
} = {}) {
  if (!actor) return false;

  const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
  const combat = combats[combatIndex] || null;
  if (!combat) return false;

  const hasRangeRate = !!combat.rangeRate && combat.rangeRate !== "///";
  if (!hasRangeRate) {
    return await performNotableCombatRoll({ actor, combatIndex, sheet, promptForTargets, rollOverrides, targetLabel, selectedDamageType, cardClass });
  }

  return showRangeRatePrompt({
    combat,
    actor,
    combatIndex,
    sheet,
    promptForTargets,
    rollOverrides,
    targetLabel,
    selectedDamageType,
    cardClass,
    rollNotableCombat: performNotableCombatRoll
  });
}
