import { PC_SOCKET_NAMESPACE, PC_SOCKET_PROMPT_DEFENSE } from "../../socket/remote-prompts.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { getActiveNotableCombatTargets, getPreferredActorToken, getPreferredDefensePromptRecipientUser } from "./actor-targets.mjs";
import { isChainCancelledResult, withWaitingForDefenderResponse } from "./prompt-dialogs.mjs";

export async function emitDefensePromptRequestsForAttack({ actor, combat, combatIndex, attackerToken = null } = {}) {
  const targetingType = String(combat?.targetingType || "").trim();
  if (!targetingType) {
    pcLog.debug("Peasant Core | Defense prompt skipped: no targeting type", {
      actor: actor?.name,
      combatIndex,
      combatName: combat?.name || "Combat"
    });
    return { totalAccuracyPenalty: 0, promptResults: [] };
  }

  const targets = getActiveNotableCombatTargets();
  if (!targets.length) {
    pcLog.debug("Peasant Core | Defense prompt skipped: no targeted tokens", {
      actor: actor?.name,
      combatIndex,
      combatName: combat?.name || "Combat",
      targetingType
    });
    return { totalAccuracyPenalty: 0, promptResults: [] };
  }
  pcLog.debug("Peasant Core | Defense prompt targets", {
    attack: combat?.name || "Combat",
    targetingType,
    targets: targets.map((target) => ({
      tokenId: target.tokenId,
      actorId: target.actorId,
      name: target.targetName
    }))
  });

  const resolvedAttackerToken = attackerToken || getPreferredActorToken(actor);
  const attackerTokenDocument = resolvedAttackerToken?.document ?? resolvedAttackerToken ?? null;
  const attackerTokenName = String(
    resolvedAttackerToken?.name
    || attackerTokenDocument?.name
    || actor?.name
    || "Attacker"
  ).trim() || "Attacker";

  const promptResults = [];

  for (const target of targets) {
    const targetToken = target.token;
    const targetTokenDocument = target.tokenDocument;
    const targetActor = target.actor;
    if (!targetActor) continue;
    const recipient = getPreferredDefensePromptRecipientUser(targetActor, targetTokenDocument);
    if (!recipient?.id) {
      pcLog.debug("Peasant Core | Defense prompt skipped: no recipient user found", {
        target: targetTokenDocument?.name || targetActor?.name,
        targetActorId: targetActor?.id,
        targetingType
      });
      continue;
    }

    const payload = {
      promptId: foundry.utils.randomID(),
      type: PC_SOCKET_PROMPT_DEFENSE,
      originatingUserId: game.user?.id || null,
      recipientUserId: recipient.id,
      attackerActorId: actor?.id || null,
      attackerActorUuid: actor?.uuid || null,
      attackerTokenUuid: attackerTokenDocument?.uuid || null,
      attackerTokenName,
      attackCombatIndex: combatIndex,
      attackCombatName: String(combat?.name || "Attack").trim() || "Attack",
      attackTargetingType: targetingType,
      targetSceneId: targetTokenDocument?.parent?.id || targetTokenDocument?.scene?.id || null,
      targetTokenId: targetTokenDocument?.id || null,
      targetTokenUuid: targetTokenDocument?.uuid || null,
      targetTokenName: String(target.targetName || targetToken?.name || targetTokenDocument?.name || targetActor?.name || "").trim(),
      targetActorId: targetActor?.id || null,
      targetActorUuid: targetActor?.uuid || null
    };
    pcLog.debug("Peasant Core | Requesting defense prompt", {
      attack: payload.attackCombatName,
      targetingType,
      target: payload.targetTokenName || payload.targetActorId,
      recipient: recipient.name,
      recipientUserId: recipient.id,
      currentUserId: game.user?.id || null
    });

    const requestDefensePromptForUser = game.peasantCore?.requestDefensePromptForUser;
    const showDefensePrompt = game.peasantCore?.showDefensePrompt;
    const cancelPromptForUser = game.peasantCore?.cancelPromptForUser;
    let promptResult = null;
    if (typeof requestDefensePromptForUser === "function") {
      promptResult = await withWaitingForDefenderResponse(
        () => requestDefensePromptForUser(recipient.id, payload),
        {
          enabled: recipient.id !== game.user?.id,
          onAbort: () => cancelPromptForUser?.(recipient.id, {
            promptId: payload.promptId,
            targetActorId: targetActor?.id || null,
            targetTokenId: targetTokenDocument?.id || null
          })
        }
      );
    } else if ((recipient.id === game.user?.id || game.user?.isGM) && typeof showDefensePrompt === "function") {
      console.warn("Peasant Core | Defense prompt API missing request handler; handling on current client.", {
        attack: payload.attackCombatName,
        target: payload.targetTokenName || payload.targetActorId,
        intendedRecipientUserId: recipient.id
      });
      promptResult = await showDefensePrompt({
        ...payload,
        recipientUserId: game.user?.id || recipient.id
      });
    } else {
      console.warn("Peasant Core | Defense prompt using raw socket fallback; no synchronous defense result will be available.", {
        attack: payload.attackCombatName,
        target: payload.targetTokenName || payload.targetActorId,
        recipientUserId: recipient.id
      });
      game.socket.emit(PC_SOCKET_NAMESPACE, payload);
    }

    pcLog.debug("Peasant Core | Sent defense prompt", {
      attacker: attackerTokenName,
      target: targetTokenDocument?.name || targetActor?.name,
      targetingType,
      recipient: recipient.name
    });

    promptResults.push({
      targetTokenId: targetTokenDocument?.id || null,
      targetActorId: targetActor?.id || null,
      targetName: target.targetName || targetTokenDocument?.name || targetActor?.name || "",
      recipientUserId: recipient.id,
      result: promptResult
    });

    if (isChainCancelledResult(promptResult)) {
      return {
        totalAccuracyPenalty: 0,
        totalToHitPenalty: 0,
        promptResults,
        abortChain: true
      };
    }
  }

  const totalAccuracyPenalty = promptResults.reduce((sum, entry) => {
    const appliedPenalty = Number(entry?.result?.appliedAccuracyPenalty);
    return sum + (Number.isFinite(appliedPenalty) ? appliedPenalty : 0);
  }, 0);

  const totalToHitPenalty = promptResults.reduce((sum, entry) => {
    const appliedPenalty = Number(entry?.result?.appliedToHitPenalty);
    return sum + (Number.isFinite(appliedPenalty) ? appliedPenalty : 0);
  }, 0);

  return { totalAccuracyPenalty, totalToHitPenalty, promptResults, abortChain: false };
}
