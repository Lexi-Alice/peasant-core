import { getAutomatedCombatDamageTypeLabel } from "../../data/actor/combat-damage.mjs";
import {
  isArmorPenLocationLike,
  normalizeAppliedDamageType
} from "../../data/actor/targeted-damage.mjs";
import { PC_SOCKET_NAMESPACE, PC_SOCKET_PROMPT_INCOMING_HIT } from "../../socket/remote-prompts.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { getPreferredDefensePromptRecipientUser, resolveDefensePromptActor } from "./actor-targets.mjs";
import { withWaitingForDefenderResponse } from "./prompt-dialogs.mjs";
import { applyTargetedDamageWorkflow } from "./targeted-damage-workflow.mjs";

export async function applyIncomingHit(payload = {}) {
  const defenderActor = await resolveDefensePromptActor(payload);
  if (!defenderActor) return null;

  const damageAmount = Number(payload.damageAmount);
  if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
    return { handled: false, applied: false, reason: "invalidDamage" };
  }

  const location = String(payload.location || "Torso").trim() || "Torso";
  const armorPenHit = isArmorPenLocationLike({
    isAP: payload.isAP,
    rawText: payload.locationResultText,
    locationResultText: payload.locationDisplay,
    label: payload.location
  });
  let appliedType = normalizeAppliedDamageType(payload.damageType, "blunt");
  if (appliedType === "flexible") appliedType = "blunt";

  let applyResult = null;
  try {
    applyResult = await applyTargetedDamageWorkflow(defenderActor, {
      amount: damageAmount,
      type: appliedType,
      location,
      isAP: armorPenHit,
      useArmorCharge: !!payload.useArmorCharge,
      ignoreHaltReduction: !!payload.ignoreHaltReduction,
      chatSpeaker: ChatMessage.getSpeaker({ actor: defenderActor })
    });
  } catch (error) {
    console.error("Peasant Core | applyIncomingHit failed while applying targeted damage workflow", {
      payload,
      defender: defenderActor?.name,
      error
    });
    return {
      handled: true,
      applied: false,
      reason: "workflowError",
      error: String(error?.message || error || "Unknown error")
    };
  }

  return {
    handled: true,
    applied: !!applyResult?.ok,
    useArmorCharge: !!payload.useArmorCharge,
    ignoreHaltReduction: !!payload.ignoreHaltReduction,
    appliedDamageType: appliedType,
    location,
    isAP: armorPenHit,
    applyResult
  };
}

export async function requestIncomingHitResolutionForTarget({
  target = null,
  attackerActor = null,
  attackerToken = null,
  combat = null,
  locationRoll = null,
  damagePreview = "",
  damageType = "",
  damageTypeLabel = ""
} = {}) {
  const targetActor = target?.actor || null;
  const targetTokenDocument = target?.tokenDocument || target?.token?.document || target?.token || null;
  if (!targetActor || !combat || !locationRoll) return null;

  const recipient = getPreferredDefensePromptRecipientUser(targetActor, targetTokenDocument);
  if (!recipient?.id) {
    pcLog.debug("Peasant Core | Incoming hit prompt skipped: no recipient user found", {
      target: target?.targetName || targetActor?.name,
      combatName: combat?.name || "Combat"
    });
    return null;
  }

  const attackerTokenDocument = attackerToken?.document ?? attackerToken ?? null;
  const attackerName = String(
    attackerToken?.name
    || attackerTokenDocument?.name
    || attackerActor?.name
    || "Attacker"
  ).trim() || "Attacker";
  const armorPenHit = isArmorPenLocationLike({
    isAP: locationRoll?.isAP,
    rawText: locationRoll?.rawText,
    locationResultText: locationRoll?.locationDisplay
  });

  const payload = {
    promptId: foundry.utils.randomID(),
    type: PC_SOCKET_PROMPT_INCOMING_HIT,
    originatingUserId: game.user?.id || null,
    recipientUserId: recipient.id,
    attackerActorId: attackerActor?.id || null,
    attackerActorUuid: attackerActor?.uuid || null,
    attackerTokenUuid: attackerTokenDocument?.uuid || null,
    attackerTokenName: attackerName,
    attackCombatIndex: null,
    attackCombatName: String(combat?.name || "Attack").trim() || "Attack",
    attackTargetingType: String(combat?.targetingType || "").trim(),
    targetSceneId: targetTokenDocument?.parent?.id || targetTokenDocument?.scene?.id || null,
    targetTokenId: targetTokenDocument?.id || null,
    targetTokenUuid: targetTokenDocument?.uuid || null,
    targetTokenName: target?.targetName || targetTokenDocument?.name || targetActor?.name || "Target",
    targetActorId: targetActor?.id || null,
    targetActorUuid: targetActor?.uuid || null,
    location: locationRoll.location,
    locationDisplay: locationRoll.locationDisplay,
    locationResultText: locationRoll.rawText,
    isAP: armorPenHit,
    damagePreview: String(damagePreview || "").trim(),
    damageType: String(damageType || "").trim(),
    damageTypeLabel: String(damageTypeLabel || "").trim()
  };

  const requestIncomingHitForUser = game.peasantCore?.requestIncomingHitForUser;
  const cancelPromptForUser = game.peasantCore?.cancelPromptForUser;
  if (typeof requestIncomingHitForUser === "function") {
    return await withWaitingForDefenderResponse(
      () => requestIncomingHitForUser(recipient.id, payload),
      {
        enabled: recipient.id !== game.user?.id,
        onAbort: () => cancelPromptForUser?.(recipient.id, {
          promptId: payload.promptId,
          targetActorId: targetActor?.id || null,
          targetTokenId: targetTokenDocument?.id || null
        })
      }
    );
  }

  if (game?.socket) {
    game.socket.emit(PC_SOCKET_NAMESPACE, payload);
  }
  return null;
}

export async function requestIncomingHitApplicationForTarget({
  target = null,
  attackerActor = null,
  attackerToken = null,
  combat = null,
  damageRoll = null,
  locationRoll = null,
  incomingHitResolution = null,
  damageAmountOverride = null,
  ignoreHaltReduction = false
} = {}) {
  const targetActor = target?.actor || null;
  const targetTokenDocument = target?.tokenDocument || target?.token?.document || target?.token || null;
  if (!targetActor || !combat || !damageRoll || !locationRoll) return null;

  const recipient = getPreferredDefensePromptRecipientUser(targetActor, targetTokenDocument);
  if (!recipient?.id) {
    pcLog.debug("Peasant Core | Incoming hit apply skipped: no recipient user found", {
      target: target?.targetName || targetActor?.name,
      combatName: combat?.name || "Combat"
    });
    return null;
  }

  const attackerTokenDocument = attackerToken?.document ?? attackerToken ?? null;
  const attackerName = String(
    attackerToken?.name
    || attackerTokenDocument?.name
    || attackerActor?.name
    || "Attacker"
  ).trim() || "Attacker";

  let appliedDamageType = normalizeAppliedDamageType(
    incomingHitResolution?.appliedDamageType || damageRoll?.normalizedType || combat?.damage?.type,
    "blunt"
  );
  if (appliedDamageType === "flexible") appliedDamageType = "blunt";
  const armorPenHit = isArmorPenLocationLike({
    isAP: locationRoll?.isAP,
    rawText: locationRoll?.rawText,
    locationResultText: locationRoll?.locationDisplay
  });
  const parsedDamageAmountOverride = (
    damageAmountOverride === null
    || damageAmountOverride === undefined
    || String(damageAmountOverride).trim() === ""
  )
    ? null
    : Number(damageAmountOverride);
  const resolvedDamageAmount = Number.isFinite(parsedDamageAmountOverride)
    ? parsedDamageAmountOverride
    : (Number(damageRoll.total) || 0);

  const payload = {
    originatingUserId: game.user?.id || null,
    recipientUserId: recipient.id,
    attackerActorId: attackerActor?.id || null,
    attackerActorUuid: attackerActor?.uuid || null,
    attackerTokenUuid: attackerTokenDocument?.uuid || null,
    attackerTokenName: attackerName,
    attackCombatIndex: null,
    attackCombatName: String(combat?.name || "Attack").trim() || "Attack",
    attackTargetingType: String(combat?.targetingType || "").trim(),
    targetSceneId: targetTokenDocument?.parent?.id || targetTokenDocument?.scene?.id || null,
    targetTokenId: targetTokenDocument?.id || null,
    targetTokenUuid: targetTokenDocument?.uuid || null,
    targetTokenName: target?.targetName || targetTokenDocument?.name || targetActor?.name || "Target",
    targetActorId: targetActor?.id || null,
    targetActorUuid: targetActor?.uuid || null,
    location: locationRoll.location,
    locationDisplay: locationRoll.locationDisplay,
    locationResultText: locationRoll.rawText,
    isAP: armorPenHit,
    damageAmount: resolvedDamageAmount,
    damageType: appliedDamageType,
    damageTypeLabel: getAutomatedCombatDamageTypeLabel(appliedDamageType),
    useArmorCharge: !!incomingHitResolution?.useArmorCharge,
    ignoreHaltReduction: !!ignoreHaltReduction
  };

  let canApplyLocally = false;
  try {
    canApplyLocally = !!game.user?.isGM
      || (typeof targetActor?.canUserModify === "function" && targetActor.canUserModify(game.user, "update"));
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to test local incoming-hit apply permission", e);
  }

  if (canApplyLocally) {
    try {
      const localApplication = await applyIncomingHit(payload);
      if (localApplication?.handled && localApplication?.applied) {
        return localApplication;
      }
    } catch (error) {
      console.error("Peasant Core | Local incoming hit apply failed, falling back to remote application.", error);
    }
  }

  const applyIncomingHitForUser = game.peasantCore?.applyIncomingHitForUser;
  let applicationResult = null;
  if (typeof applyIncomingHitForUser === "function") {
    applicationResult = await applyIncomingHitForUser(recipient.id, payload);
  } else {
    applicationResult = await applyIncomingHit(payload);
  }

  const applicationHandled = !!(applicationResult && typeof applicationResult === "object" && applicationResult.handled);
  const applicationApplied = !!(applicationResult && typeof applicationResult === "object" && applicationResult.applied);
  if (applicationHandled && applicationApplied) {
    return applicationResult;
  }

  return applicationResult;
}
