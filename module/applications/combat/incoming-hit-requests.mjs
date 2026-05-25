import { getAutomatedCombatDamageTypeLabel } from "../../data/actor/combat-damage.mjs";
import { normalizeCombatDefense } from "../../data/actor/combat-defense.mjs";
import {
  getTargetedDamageLocationDisplay,
  isArmorPenLocationLike,
  normalizeAppliedDamageType
} from "../../data/actor/targeted-damage.mjs";
import { PC_SOCKET_NAMESPACE, PC_SOCKET_PROMPT_INCOMING_HIT } from "../../socket/remote-prompts.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { getPreferredDefensePromptRecipientUser, resolveDefensePromptActor } from "./actor-targets.mjs";
import { withWaitingForDefenderResponse } from "./prompt-dialogs.mjs";
import { applyTargetedDamageWorkflow } from "./targeted-damage-workflow.mjs";

async function applyIncomingShieldBlock(defenderActor, payload = {}) {
  const damageAmount = Number(payload.damageAmount);
  if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
    return { handled: false, applied: false, reason: "invalidDamage" };
  }

  const shieldBlock = (payload.shieldBlock && typeof payload.shieldBlock === "object") ? payload.shieldBlock : {};
  const combatIndex = Number.parseInt(shieldBlock.selectedCombatIndex, 10);
  if (!Number.isFinite(combatIndex) || combatIndex < 0) {
    return { handled: false, applied: false, reason: "invalidShieldBlockDefense" };
  }

  const combats = typeof defenderActor.getPeasantNotableCombatsForUpdate === "function"
    ? defenderActor.getPeasantNotableCombatsForUpdate()
    : JSON.parse(JSON.stringify(Array.isArray(defenderActor.system?.notableCombats) ? defenderActor.system.notableCombats : []));
  const combat = combats[combatIndex] || null;
  const defense = normalizeCombatDefense(combat?.defense);
  if (!combat || !defense.block || defense.blockType !== "Shield") {
    return { handled: false, applied: false, reason: "invalidShieldBlockDefense" };
  }

  const hardness = Math.max(0, Number.parseInt(defense.hardness, 10) || 0);
  const shieldHpBefore = Math.max(0, Number.parseInt(defense.hp, 10) || 0);
  const damageAfterHardness = Math.max(0, damageAmount - hardness);
  const braced = !!shieldBlock.braced;

  let incomingShieldDamage = 0;
  let armDamage = 0;
  if (damageAfterHardness > 0) {
    if (braced) {
      incomingShieldDamage = damageAfterHardness;
    } else {
      incomingShieldDamage = Math.ceil(damageAfterHardness / 2);
      armDamage = Math.floor(damageAfterHardness / 2);
    }
  }

  const shieldDamageApplied = Math.min(shieldHpBefore, incomingShieldDamage);
  const shieldOverflowDamage = Math.max(0, incomingShieldDamage - shieldHpBefore);
  armDamage += shieldOverflowDamage;

  const shieldHpAfter = Math.max(0, shieldHpBefore - shieldDamageApplied);
  if (shieldHpAfter !== shieldHpBefore) {
    combat.defense = {
      ...defense,
      hp: shieldHpAfter
    };
    combats[combatIndex] = combat;
    if (typeof defenderActor.setPeasantNotableCombats === "function") {
      await defenderActor.setPeasantNotableCombats(combats, { render: false });
    } else {
      await defenderActor.update({ "system.notableCombats": combats }, { render: false });
    }
  }

  const shieldArm = defense.shieldArm || "LeftArm";
  let armApplyResult = null;
  if (armDamage > 0) {
    armApplyResult = await applyTargetedDamageWorkflow(defenderActor, {
      amount: armDamage,
      type: "blunt",
      location: shieldArm,
      isAP: false,
      useArmorCharge: false,
      ignoreHaltReduction: true,
      chatSpeaker: ChatMessage.getSpeaker({ actor: defenderActor })
    });
  }

  return {
    handled: true,
    applied: true,
    shieldBlock: true,
    braced,
    damageAmount,
    hardness,
    damageAfterHardness,
    incomingShieldDamage,
    shieldDamageApplied,
    shieldOverflowDamage,
    shieldHpBefore,
    shieldHpAfter,
    armDamage,
    armLocation: shieldArm,
    armLocationDisplay: getTargetedDamageLocationDisplay(shieldArm),
    armApplyResult
  };
}

async function applyIncomingWeaponBlock(defenderActor, payload = {}) {
  const weaponBlock = (payload.weaponBlock && typeof payload.weaponBlock === "object") ? payload.weaponBlock : {};
  const originalDamageAmount = Number(weaponBlock.originalDamageAmount);
  if (!Number.isFinite(originalDamageAmount) || originalDamageAmount <= 0) {
    return { handled: false, applied: false, reason: "invalidDamage" };
  }

  const combatIndex = Number.parseInt(weaponBlock.selectedCombatIndex, 10);
  if (!Number.isFinite(combatIndex) || combatIndex < 0) {
    return { handled: false, applied: false, reason: "invalidWeaponBlockDefense" };
  }

  const combats = typeof defenderActor.getPeasantNotableCombatsForUpdate === "function"
    ? defenderActor.getPeasantNotableCombatsForUpdate()
    : JSON.parse(JSON.stringify(Array.isArray(defenderActor.system?.notableCombats) ? defenderActor.system.notableCombats : []));
  const combat = combats[combatIndex] || null;
  const defense = normalizeCombatDefense(combat?.defense);
  if (!combat || !defense.block || defense.blockType !== "Weapon") {
    return { handled: false, applied: false, reason: "invalidWeaponBlockDefense" };
  }

  const weaponHpBefore = Math.max(0, Number.parseInt(defense.hp, 10) || 0);
  const weaponDamageApplied = Math.min(weaponHpBefore, originalDamageAmount);
  const weaponOverflowDamage = Math.max(0, originalDamageAmount - weaponHpBefore);
  const weaponHpAfter = Math.max(0, weaponHpBefore - weaponDamageApplied);

  if (weaponHpAfter !== weaponHpBefore) {
    combat.defense = {
      ...defense,
      hp: weaponHpAfter
    };
    combats[combatIndex] = combat;
    if (typeof defenderActor.setPeasantNotableCombats === "function") {
      await defenderActor.setPeasantNotableCombats(combats, { render: false });
    } else {
      await defenderActor.update({ "system.notableCombats": combats }, { render: false });
    }
  }

  let applyResult = null;
  if (weaponOverflowDamage > 0) {
    const appliedType = normalizeAppliedDamageType(payload.damageType, "blunt");
    const overflowType = appliedType === "flexible" ? "blunt" : appliedType;
    const location = String(payload.location || "Torso").trim() || "Torso";
    const armorPenHit = isArmorPenLocationLike({
      isAP: payload.isAP,
      rawText: payload.locationResultText,
      locationResultText: payload.locationDisplay,
      label: payload.location
    });
    applyResult = await applyTargetedDamageWorkflow(defenderActor, {
      amount: weaponOverflowDamage,
      type: overflowType,
      location,
      isAP: armorPenHit,
      useArmorCharge: !!payload.useArmorCharge,
      ignoreHaltReduction: !!payload.ignoreHaltReduction,
      chatSpeaker: ChatMessage.getSpeaker({ actor: defenderActor })
    });
  }

  return {
    handled: true,
    applied: true,
    weaponBlock: true,
    originalDamageAmount,
    weaponDamageApplied,
    weaponOverflowDamage,
    weaponHpBefore,
    weaponHpAfter,
    masteryBonus: !!defense.masteryBonus,
    overflowApplyResult: applyResult
  };
}

export async function applyIncomingHit(payload = {}) {
  const defenderActor = await resolveDefensePromptActor(payload);
  if (!defenderActor) return null;

  if (payload.shieldBlock && typeof payload.shieldBlock === "object") {
    return applyIncomingShieldBlock(defenderActor, payload);
  }
  if (payload.weaponBlock && typeof payload.weaponBlock === "object") {
    return applyIncomingWeaponBlock(defenderActor, payload);
  }

  const damageAmount = Number(payload.damageAmount);
  if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
    return { handled: false, applied: false, reason: "invalidDamage" };
  }

  let appliedType = normalizeAppliedDamageType(payload.damageType, "blunt");
  if (appliedType === "flexible") appliedType = "blunt";

  if (payload.locationlessDamage) {
    const applyResult = typeof defenderActor.applyPeasantLocationlessDamage === "function"
      ? await defenderActor.applyPeasantLocationlessDamage({ amount: damageAmount, type: appliedType })
      : await defenderActor.applyPeasantDamage?.(damageAmount, appliedType, false);
    return {
      handled: true,
      applied: !!applyResult?.ok,
      locationlessDamage: true,
      appliedDamageType: appliedType,
      applyResult
    };
  }

  const location = String(payload.location || "Torso").trim() || "Torso";
  const armorPenHit = isArmorPenLocationLike({
    isAP: payload.isAP,
    rawText: payload.locationResultText,
    locationResultText: payload.locationDisplay,
    label: payload.location
  });
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
  ignoreHaltReduction = false,
  shieldBlock = null,
  weaponBlock = null,
  locationlessDamage = false
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
    ignoreHaltReduction: !!ignoreHaltReduction,
    shieldBlock: (shieldBlock && typeof shieldBlock === "object") ? shieldBlock : null,
    weaponBlock: (weaponBlock && typeof weaponBlock === "object") ? weaponBlock : null,
    locationlessDamage: !!locationlessDamage
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
