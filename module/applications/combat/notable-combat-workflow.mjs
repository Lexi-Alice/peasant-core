import { getCombatCostModifiers } from "../../data/actor/combat-modifiers.mjs";
import { applyDefensePenaltiesToRollResult, forceRollResultFailureDueToDefense } from "../../data/actor/defense-penalties.mjs";
import { doesSuccessfulAreaDefenseDefendAttack, getFailureLabelFromDefensePromptResult } from "../../data/actor/defense-results.mjs";
import { getCombatTargetingType, hasRangeRateValue } from "../../data/actor/combat-tags.mjs";
import { normalizeAppliedDamageType } from "../../data/actor/targeted-damage.mjs";
import { hasCombatDice } from "../../dice/combat-dice.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { getActiveNotableCombatTargets, getPreferredActorToken } from "./actor-targets.mjs";
import { emitDefensePromptRequestsForAttack } from "./defense-prompt-requests.mjs";
import { consumeNotableCombatRollUse, executeResolvedNotableCombatRoll } from "./notable-combat-rolls.mjs";
import { isChainCancelledResult, showFlexibleDamageTypePrompt } from "./prompt-dialogs.mjs";
import { showRangeRatePrompt } from "./range-rate-dialog.mjs";
import { updateSkillRollChatCardFromResult } from "./roll-chat-updates.mjs";
import { resolveSuccessfulAttackDamageForTarget } from "./successful-attack-damage.mjs";
import { resolveSuccessfulHealForTarget } from "./successful-heal.mjs";

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
  cardClass = "",
  rollMode = ""
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

    const targetingType = getCombatTargetingType(combat);
    const attackerToken = getPreferredActorToken(actor);
    const activeTargets = promptForTargets ? getActiveNotableCombatTargets() : [];
    const shouldRollPerTarget = activeTargets.length > 1;
    const hasHealRoll = hasCombatDice(combat?.heal);
    const hasDamageRoll = hasCombatDice(combat?.damage);
    const requestedHealRoll = String(rollMode || "").trim().toLowerCase() === "heal";
    const isHealRoll = hasHealRoll && (requestedHealRoll || !hasDamageRoll);
    let resolvedDamageType = normalizeAppliedDamageType(selectedDamageType, "");
    if (!isHealRoll && !resolvedDamageType) {
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
    if (promptForTargets && !isHealRoll) {
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
        const areaDefenseDefendedAttack = doesSuccessfulAreaDefenseDefendAttack(targetingType, promptEntry?.result);
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
        if (areaDefenseDefendedAttack && targetRoll.rollResult) {
          const defendedApplication = forceRollResultFailureDueToDefense(targetRoll.rollResult, {
            defenseFailureLabel,
            preserveChatMessage: false
          });
          if (defendedApplication?.rollResult) {
            targetRoll.rollResult = defendedApplication.rollResult;
          }
        }
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
        let incomingHitResolution = null;
        let incomingHealResolution = null;
        if (isHealRoll) {
          incomingHealResolution = await resolveSuccessfulHealForTarget({
            actor,
            attackerToken,
            combat,
            target,
            attackRoll: targetRoll
          });
        } else {
          incomingHitResolution = await resolveSuccessfulAttackDamageForTarget({
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
        }
        targetRolls.push({
          ...targetRoll,
          targetTokenId: target.tokenId,
          targetActorId: target.actorId,
          targetName: target.targetName,
          defensePromptResult: promptEntry?.result || null,
          incomingHitResolution,
          incomingHealResolution
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
      const defensePromptResult = defensePromptSummary?.promptResults?.[0]?.result || null;
      const defenseFailureLabel = getFailureLabelFromDefensePromptResult(defensePromptResult);
      const areaDefenseDefendedAttack = doesSuccessfulAreaDefenseDefendAttack(targetingType, defensePromptResult);
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
              label: penaltyApplication.narrowSuccessIntoDefense
                ? singleRoll.rollResult.resultText
                : (penaltyApplication.failureDueToDefense ? defenseFailureLabel : null)
            });
          } catch (e) {
            pcLog.debug("Peasant Core | Failed to update single-target roll after defense penalties", e);
          }
        }
      }
      if (singleRoll?.rollResult && areaDefenseDefendedAttack) {
        const defendedApplication = forceRollResultFailureDueToDefense(singleRoll.rollResult, {
          defenseFailureLabel,
          preserveChatMessage: true
        });
        if (defendedApplication?.rollResult) {
          singleRoll.rollResult = defendedApplication.rollResult;
          try {
            await updateSkillRollChatCardFromResult(singleRoll.rollResult, {
              label: singleRoll.rollResult.resultText
            });
          } catch (e) {
            pcLog.debug("Peasant Core | Failed to update single-target roll after area defense success", e);
          }
        }
      }
      let incomingHitResolution = null;
      let incomingHealResolution = null;
      if (isHealRoll) {
        incomingHealResolution = await resolveSuccessfulHealForTarget({
          actor,
          attackerToken,
          combat,
          target,
          attackRoll: singleRoll
        });
      } else {
        incomingHitResolution = await resolveSuccessfulAttackDamageForTarget({
          actor,
          attackerToken,
          combat,
          target,
          attackRoll: singleRoll,
          defensePromptResult,
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
      }
      rollOutcome = {
        ...singleRoll,
        multiTarget: false,
        defensePromptSummary,
        targetTokenId: target?.tokenId || null,
        targetActorId: target?.actorId || null,
        targetName: target?.targetName || null,
        incomingHitResolution,
        incomingHealResolution
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
  cardClass = "",
  rollMode = ""
} = {}) {
  if (!actor) return false;

  const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
  const combat = combats[combatIndex] || null;
  if (!combat) return false;

  const hasRangeRate = hasRangeRateValue(combat.rangeRate);
  if (!hasRangeRate) {
    return await performNotableCombatRoll({ actor, combatIndex, sheet, promptForTargets, rollOverrides, targetLabel, selectedDamageType, cardClass, rollMode });
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
    rollMode,
    rollNotableCombat: performNotableCombatRoll
  });
}
