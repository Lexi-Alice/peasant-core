import { getAutomatedCombatDamageTypeLabel } from "../../data/actor/combat-damage.mjs";
import { normalizeCombatDefense, resolveMageBlockDamage, resolveShieldBlockDamage } from "../../data/actor/combat-defense.mjs";
import {
  deleteMageBlockBarrier,
  getMageBlockBarrierEffect,
  getMageBlockBarrierHp,
  getMageBlockDefenseIdentity,
  getMageBlockDuressEffect,
  updateMageBlockBarrierHp
} from "../../data/active-effect/mage-block-effects.mjs";
import { getCombatTargetingType } from "../../data/actor/combat-tags.mjs";
import { isSimplifiedHpActor } from "../../data/actor/helpers.mjs";
import { createGuardBrokenEffectData } from "../../data/actor/guard-broken.mjs";
import { withPeasantActorSourceWriteContext } from "../../data/actor/source-system.mjs";
import { applyCombatStressDamageForActor } from "../../data/actor/stress.mjs";
import { canSpendActiveArmorCharge, getActiveArmorTraining } from "../../data/actor/active-armor.mjs";
import {
  getTargetedDamageLocationDisplay,
  isArmorPenLocationLike,
  normalizeAppliedDamageType
} from "../../data/actor/targeted-damage.mjs";
import { PC_SOCKET_NAMESPACE, PC_SOCKET_PROMPT_INCOMING_HIT } from "../../socket/remote-prompts.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { attachRollUndoToChatMessage, captureActorRollUndo, collectRollUndoRecords } from "../chat-undo.mjs";
import { getPreferredDefensePromptRecipientUser, resolveDefensePromptActor } from "./actor-targets.mjs";
import { withWaitingForDefenderResponse } from "./prompt-dialogs.mjs";
import { applyTargetedDamageWorkflow } from "./targeted-damage-workflow.mjs";
import { showShieldBracePrompt } from "./shield-brace-dialog.mjs";

function resolveSelectedCombatIndex(combats, selection = {}) {
  const selectedCombatId = String(selection.selectedCombatId || "").trim();
  if (selectedCombatId) {
    return combats.findIndex((combat) => String(combat?.id || "") === selectedCombatId);
  }
  const selectedCombatIndex = Number.parseInt(selection.selectedCombatIndex, 10);
  return Number.isFinite(selectedCombatIndex) ? selectedCombatIndex : -1;
}

async function applyGuardBrokenEffect(actor) {
  const existing = Array.from(actor?.effects || []).find((effect) => (
    effect?.flags?.["peasant-core"]?.guardBroken === true
    || effect?.getFlag?.("peasant-core", "guardBroken") === true
  ));
  const source = createGuardBrokenEffectData(game?.combat || null);
  if (existing?.update) {
    await existing.update({
      start: source.start,
      duration: source.duration,
      disabled: false
    });
    return existing;
  }
  const created = await actor?.createEmbeddedDocuments?.("ActiveEffect", [source]);
  return created?.[0] || null;
}

async function applyIncomingShieldBlock(defenderActor, payload = {}) {
  const damageAmount = Number(payload.damageAmount);
  if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
    return { handled: false, applied: false, reason: "invalidDamage" };
  }

  const shieldBlock = (payload.shieldBlock && typeof payload.shieldBlock === "object") ? payload.shieldBlock : {};
  const combats = typeof defenderActor.getPeasantNotableCombatsForUpdate === "function"
    ? defenderActor.getPeasantNotableCombatsForUpdate()
    : JSON.parse(JSON.stringify(Array.isArray(defenderActor.system?.notableCombats) ? defenderActor.system.notableCombats : []));
  const combatIndex = resolveSelectedCombatIndex(combats, shieldBlock);
  if (!Number.isFinite(combatIndex) || combatIndex < 0) {
    return { handled: false, applied: false, reason: "invalidShieldBlockDefense" };
  }
  const combat = combats[combatIndex] || null;
  const defense = normalizeCombatDefense(combat?.defense);
  if (!combat || !defense.block || defense.blockType !== "Shield") {
    return { handled: false, applied: false, reason: "invalidShieldBlockDefense" };
  }

  const normalResult = resolveShieldBlockDamage(defense, damageAmount, { braced: false });
  const bracedResult = resolveShieldBlockDamage(defense, damageAmount, { braced: true });
  const replayChoice = shieldBlock.replayBraceChoice;
  const choice = replayChoice === "normal" || replayChoice === "braced"
    ? replayChoice
    : await showShieldBracePrompt({
      actor: defenderActor,
      defense,
      damageAmount,
      normalResult,
      bracedResult
    });
  if (choice !== "normal" && choice !== "braced") {
    return { handled: true, applied: false, chainCancelled: true, reason: "shieldBraceCancelled" };
  }

  const resolution = choice === "braced" ? bracedResult : normalResult;
  const shieldHpBefore = defense.hp;
  const shieldDamageApplied = resolution.shieldDamageApplied;
  const shieldOverflowDamage = resolution.shieldOverflowDamage;
  const shieldHpAfter = resolution.shieldHpAfter;
  const shieldHardnessAfter = resolution.shieldHardnessAfter;
  const armDamage = resolution.armDamage;
  if (shieldHpAfter !== shieldHpBefore || shieldHardnessAfter !== defense.hardness) {
    combat.defense = {
      ...defense,
      hp: shieldHpAfter,
      hardness: shieldHardnessAfter
    };
    combats[combatIndex] = combat;
    if (typeof defenderActor.setPeasantNotableCombats === "function") {
      await defenderActor.setPeasantNotableCombats(combats);
    } else {
      await defenderActor.update({ "system.notableCombats": combats }, withPeasantActorSourceWriteContext());
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
      domeAlreadyResolved: !!payload.domeAlreadyResolved,
      chatSpeaker: ChatMessage.getSpeaker({ actor: defenderActor })
    });
  }
  const guardBrokenEffect = choice === "braced" ? await applyGuardBrokenEffect(defenderActor) : null;

  return {
    handled: true,
    applied: true,
    shieldBlock: true,
    braced: choice === "braced",
    damageAmount,
    hardness: resolution.hardnessApplied,
    hardnessApplied: resolution.hardnessApplied,
    damageAfterHardness: resolution.damageAfterHardness,
    incomingShieldDamage: resolution.shieldDamage,
    shieldDamageApplied,
    shieldOverflowDamage,
    shieldHpBefore,
    shieldHpAfter,
    shieldHardnessBefore: defense.hardness,
    shieldHardnessAfter,
    armDamage,
    overkill: resolution.overkill,
    armLocation: shieldArm,
    armLocationDisplay: getTargetedDamageLocationDisplay(shieldArm),
    armApplyResult,
    guardBrokenEffect,
    dome: armApplyResult?.dome || null,
    resistance: armApplyResult?.resistance || null
  };
}

async function applyIncomingWeaponBlock(defenderActor, payload = {}) {
  const weaponBlock = (payload.weaponBlock && typeof payload.weaponBlock === "object") ? payload.weaponBlock : {};
  const originalDamageAmount = Number(weaponBlock.originalDamageAmount);
  if (!Number.isFinite(originalDamageAmount) || originalDamageAmount <= 0) {
    return { handled: false, applied: false, reason: "invalidDamage" };
  }

  const combats = typeof defenderActor.getPeasantNotableCombatsForUpdate === "function"
    ? defenderActor.getPeasantNotableCombatsForUpdate()
    : JSON.parse(JSON.stringify(Array.isArray(defenderActor.system?.notableCombats) ? defenderActor.system.notableCombats : []));
  const combatIndex = resolveSelectedCombatIndex(combats, weaponBlock);
  if (combatIndex < 0) return { handled: false, applied: false, reason: "invalidWeaponBlockDefense" };
  const combat = combats[combatIndex] || null;
  const defense = normalizeCombatDefense(combat?.defense);
  if (!combat || !defense.block || defense.blockType !== "Weapon") {
    return { handled: false, applied: false, reason: "invalidWeaponBlockDefense" };
  }

  const weaponHardness = Math.max(0, Number.parseInt(defense.hardness, 10) || 0);
  const weaponDamageMitigated = Math.min(weaponHardness, originalDamageAmount);
  const weaponOverflowDamage = Math.max(0, originalDamageAmount - weaponHardness);

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
      armorGrade: payload.armorGrade || "",
      ignoreHaltReduction: !!payload.ignoreHaltReduction,
      woundLocation: payload.woundLocation || null,
      suppressLocationBreaks: !!payload.suppressLocationBreaks,
      domeAlreadyResolved: !!payload.domeAlreadyResolved,
      chatSpeaker: ChatMessage.getSpeaker({ actor: defenderActor })
    });
  }

  return {
    handled: true,
    applied: true,
    weaponBlock: true,
    originalDamageAmount,
    weaponHardness,
    weaponDamageMitigated,
    weaponOverflowDamage,
    cleanHit: weaponOverflowDamage > 0,
    weaponSunderRequired: weaponOverflowDamage > 0,
    masteryBonus: !!defense.masteryBonus,
    overflowApplyResult: applyResult,
    dome: applyResult?.dome || null,
    resistance: applyResult?.resistance || null
  };
}

export async function applyIncomingHit(payload = {}) {
  const defenderActor = await resolveDefensePromptActor(payload);
  if (!defenderActor) return null;

  const undoCapture = await captureActorRollUndo(
    defenderActor,
    `${payload.attackCombatName || "Incoming Hit"} Damage`,
    () => applyIncomingHitToActor(defenderActor, payload),
    { includeSpellEffects: true }
  );
  if (!undoCapture.result || typeof undoCapture.result !== "object") return undoCapture.result;

  const undoRecords = collectRollUndoRecords(undoCapture.undoRecords, undoCapture.result.undoRecords);
  await attachIncomingHitUndoToCards(undoCapture.result, undoRecords);

  return {
    ...undoCapture.result,
    undoRecords
  };
}

async function applyIncomingMageBlock(defenderActor, payload = {}) {
  const damageAmount = Number(payload.damageAmount);
  if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
    return { handled: false, applied: false, reason: "invalidDamage" };
  }

  const mageBlock = (payload.mageBlock && typeof payload.mageBlock === "object") ? payload.mageBlock : {};
  const combats = typeof defenderActor.getPeasantNotableCombatsForUpdate === "function"
    ? defenderActor.getPeasantNotableCombatsForUpdate()
    : JSON.parse(JSON.stringify(Array.isArray(defenderActor.system?.notableCombats) ? defenderActor.system.notableCombats : []));
  const combatIndex = resolveSelectedCombatIndex(combats, mageBlock);
  if (combatIndex < 0) return { handled: false, applied: false, reason: "invalidMageBlockDefense" };
  const combat = combats[combatIndex] || null;
  const defense = normalizeCombatDefense(combat?.defense);
  const identity = getMageBlockDefenseIdentity("notableCombats", combat?.id, "base");
  const duress = getMageBlockDuressEffect(defenderActor, identity);
  if (!combat || !defense.block || defense.blockType !== "Mage" || !duress) {
    return { handled: false, applied: false, reason: "invalidMageBlockDefense" };
  }

  const barrier = getMageBlockBarrierEffect(defenderActor, identity);
  const barrierHp = barrier ? getMageBlockBarrierHp(barrier).value : 0;
  const resolution = resolveMageBlockDamage({ ...defense, hp: barrierHp }, damageAmount);
  if (barrier) {
    if (resolution.hpAfter <= 0) await deleteMageBlockBarrier(barrier, duress);
    else if (resolution.hpAfter !== resolution.hpBefore) await updateMageBlockBarrierHp(barrier, resolution.hpAfter);
  }

  const damageType = normalizeAppliedDamageType(payload.damageType, "blunt");
  const appliedType = damageType === "flexible" ? "blunt" : damageType;
  let overflowApplyResult = null;
  let guardBrokenEffect = null;
  let chatMessage = null;
  if (resolution.overflow > 0) {
    overflowApplyResult = await defenderActor.applyPeasantLocationlessDamage?.({
      amount: resolution.overflow,
      type: appliedType,
      domeAlreadyResolved: true,
      ignoreResistance: true
    });
    guardBrokenEffect = await applyGuardBrokenEffect(defenderActor);
    chatMessage = await ChatMessage.create({
      user: game.user?.id,
      speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
      content: `<div class="pc-mage-block-overflow"><strong>Mage Block Overflow</strong><p>${resolution.overflow} Clean Hit damage passes through the barrier.</p><p>Manually Sunder a Foci. Make the required Crush and Spell Jam resistance checks.</p></div>`
    });
  }

  const overflowed = resolution.overflow > 0;
  return {
    handled: true,
    applied: overflowed ? !!overflowApplyResult?.ok : true,
    mageBlock: true,
    mageBarrierAction: String(mageBlock.mageBarrierAction || "").trim() || null,
    damageAmount,
    hpBefore: resolution.hpBefore,
    hpAfter: resolution.hpAfter,
    absorbed: resolution.absorbed,
    overflow: resolution.overflow,
    cleanHit: overflowed,
    fociSunderRequired: overflowed,
    guardBreakRequired: overflowed,
    crushResistanceRequired: overflowed,
    spellJamResistanceRequired: overflowed,
    overflowApplyResult,
    guardBrokenEffect,
    chatMessage,
    dome: overflowApplyResult?.dome || null,
    resistance: overflowApplyResult?.resistance || null
  };
}

async function attachIncomingHitUndoToCards(result, undoRecords) {
  if (!undoRecords.length) return;
  const label = "Undo Damage Effects";
  await attachRollUndoToChatMessage(result?.applyResult?.chatMessage, undoRecords, { label });
  await attachRollUndoToChatMessage(result?.armApplyResult?.chatMessage, undoRecords, { label });
  await attachRollUndoToChatMessage(result?.overflowApplyResult?.chatMessage, undoRecords, { label });
  await attachRollUndoToChatMessage(result?.mageBlockResult?.overflowApplyResult?.chatMessage, undoRecords, { label });
  await attachRollUndoToChatMessage(result?.mageBlockResult?.chatMessage, undoRecords, { label });
}

async function applyIncomingHitToActor(defenderActor, payload = {}) {
  if (payload.mageBlock && typeof payload.mageBlock === "object") {
    const mageBlockResult = await applyIncomingMageBlock(defenderActor, payload);
    return { ...mageBlockResult, mageBlockResult };
  }
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
      ? await defenderActor.applyPeasantLocationlessDamage({ amount: damageAmount, type: appliedType, domeAlreadyResolved: !!payload.domeAlreadyResolved })
      : await defenderActor.applyPeasantDamage?.(damageAmount, appliedType, false, { domeAlreadyResolved: !!payload.domeAlreadyResolved });
    return {
      handled: true,
      applied: !!applyResult?.ok,
      locationlessDamage: true,
      appliedDamageType: appliedType,
      applyResult,
      dome: applyResult?.dome || null,
      resistance: applyResult?.resistance || null
    };
  }

  const location = String(payload.location || "Torso").trim() || "Torso";
  const armorPenHit = isArmorPenLocationLike({
    isAP: payload.isAP,
    rawText: payload.locationResultText,
    locationResultText: payload.locationDisplay,
    label: payload.location
  });
  const effectiveArmorPenHit = !payload.preventByLuckPenetration && armorPenHit;
  let applyResult = null;
  try {
    applyResult = await applyTargetedDamageWorkflow(defenderActor, {
      amount: damageAmount,
      type: appliedType,
      location,
      isAP: effectiveArmorPenHit,
      useArmorCharge: !!payload.useArmorCharge,
      armorGrade: payload.armorGrade || "",
      ignoreHaltReduction: !!payload.ignoreHaltReduction,
      woundLocation: payload.woundLocation || null,
      suppressLocationBreaks: !!payload.suppressLocationBreaks,
      domeAlreadyResolved: !!payload.domeAlreadyResolved,
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
    isAP: effectiveArmorPenHit,
    applyResult,
    woundThresholds: applyResult?.woundThresholds,
    devastatingWoundsBefore: applyResult?.devastatingWoundsBefore,
    devastatingWoundsGained: applyResult?.devastatingWoundsGained,
    devastatingWoundsAfter: applyResult?.devastatingWoundsAfter,
    breakType: applyResult?.breakType,
    breakCriticalDamage: applyResult?.breakCriticalDamage,
    dome: applyResult?.dome || null,
    resistance: applyResult?.resistance || null
  };
}

export async function applyIncomingHeal(payload = {}) {
  const targetActor = await resolveDefensePromptActor(payload);
  if (!targetActor) return null;

  const undoCapture = await captureActorRollUndo(
    targetActor,
    `${payload.attackCombatName || "Incoming Heal"} Healing`,
    () => applyIncomingHealToActor(targetActor, payload)
  );
  if (!undoCapture.result || typeof undoCapture.result !== "object") return undoCapture.result;

  return {
    ...undoCapture.result,
    undoRecords: collectRollUndoRecords(undoCapture.undoRecords, undoCapture.result.undoRecords)
  };
}

async function applyIncomingHealToActor(targetActor, payload = {}) {
  const healAmount = Number(payload.healAmount);
  if (!Number.isFinite(healAmount) || healAmount <= 0) {
    return { handled: false, applied: false, reason: "invalidHeal" };
  }

  const rawHealType = String(payload.healType || "").trim().toLowerCase();
  const healType = rawHealType === "greater" || rawHealType === "special" ? rawHealType : "temporary";
  if (typeof targetActor.applyPeasantHeal !== "function") {
    return { handled: false, applied: false, reason: "healUnavailable" };
  }

  let applyResult = null;
  try {
    applyResult = await targetActor.applyPeasantHeal(healAmount, healType);
  } catch (error) {
    console.error("Peasant Core | applyIncomingHeal failed while applying healing", {
      payload,
      target: targetActor?.name,
      error
    });
    return {
      handled: true,
      applied: false,
      reason: "workflowError",
      error: String(error?.message || error || "Unknown error")
    };
  }

  let secondaryHealingStress = null;
  const effectiveHealingPower = Math.max(0, Math.floor(Number(applyResult?.effectiveHealingPower) || 0));
  if (applyResult?.ok && effectiveHealingPower > 0) {
    try {
      const buildScore = Math.max(0, Math.floor(Number(targetActor.system?.build) || 0));
      const summerGridBonus = targetActor.system?.blessing?.type === "summer" && !isSimplifiedHpActor(targetActor) ? 2 : 0;
      const buildDivisor = Math.max(1, buildScore + summerGridBonus);
      const stressAmount = Math.max(0, Math.floor(effectiveHealingPower / buildDivisor));
      let overflow = 0;
      let appliedStress = 0;
      if (stressAmount > 0) {
        overflow = Math.max(0, Number(await applyCombatStressDamageForActor(targetActor, "general", stressAmount)) || 0);
        appliedStress = Math.max(0, stressAmount - overflow);
        if (overflow > 0) {
          ui.notifications?.warn?.(`Not enough General Stress capacity; applied ${appliedStress} of ${stressAmount}.`);
        }
      }

      secondaryHealingStress = {
        applied: appliedStress > 0,
        stressType: "general",
        amount: stressAmount,
        appliedStress,
        overflow,
        effectiveHealingPower,
        buildScore,
        buildDivisor
      };
    } catch (error) {
      console.error("Peasant Core | applyIncomingHeal failed while applying secondary healing stress", {
        payload,
        target: targetActor?.name,
        error
      });
      secondaryHealingStress = {
        prompted: false,
        applied: false,
        stressType: "general",
        amount: 0,
        appliedStress: 0,
        overflow: 0,
        effectiveHealingPower,
        reason: "stressWorkflowError",
        error: String(error?.message || error || "Unknown error")
      };
    }
  }

  return {
    handled: true,
    applied: !!applyResult?.ok,
    healAmount,
    healType,
    applyResult,
    secondaryHealingStress
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
  if (!targetActor || !combat) return null;

  const armorTraining = getActiveArmorTraining(targetActor);
  if (!canSpendActiveArmorCharge(targetActor)) {
    let appliedDamageType = normalizeAppliedDamageType(damageType, "blunt");
    if (appliedDamageType === "flexible") appliedDamageType = "blunt";
    return {
      handled: true,
      useArmorCharge: false,
      appliedDamageType,
      armorGrade: armorTraining.grade,
      preventByLuckPenetration: false,
      bySkillPenetrationMosAdjustment: 0,
      armorChargeUnavailable: true
    };
  }

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
    attackTargetingType: getCombatTargetingType(combat),
    targetSceneId: targetTokenDocument?.parent?.id || targetTokenDocument?.scene?.id || null,
    targetTokenId: targetTokenDocument?.id || null,
    targetTokenUuid: targetTokenDocument?.uuid || null,
    targetTokenName: target?.targetName || targetTokenDocument?.name || targetActor?.name || "Target",
    targetActorId: targetActor?.id || null,
    targetActorUuid: targetActor?.uuid || null,
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
  mageBlock = null,
  locationlessDamage = false,
  woundLocation = null,
  suppressLocationBreaks = false,
  domeAlreadyResolved = false
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
  const preventByLuckPenetration = !!incomingHitResolution?.preventByLuckPenetration && !locationRoll?.bySkill;
  const armorPenHit = !preventByLuckPenetration && isArmorPenLocationLike({
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
    attackTargetingType: getCombatTargetingType(combat),
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
    preventByLuckPenetration,
    damageAmount: resolvedDamageAmount,
    damageType: appliedDamageType,
    damageTypeLabel: getAutomatedCombatDamageTypeLabel(appliedDamageType),
    useArmorCharge: !!incomingHitResolution?.useArmorCharge,
    armorGrade: incomingHitResolution?.armorGrade || "",
    ignoreHaltReduction: !!ignoreHaltReduction,
    shieldBlock: (shieldBlock && typeof shieldBlock === "object") ? shieldBlock : null,
    weaponBlock: (weaponBlock && typeof weaponBlock === "object") ? weaponBlock : null,
    mageBlock: (mageBlock && typeof mageBlock === "object") ? mageBlock : null,
    locationlessDamage: !!locationlessDamage,
    woundLocation: woundLocation || null,
    suppressLocationBreaks: !!suppressLocationBreaks,
    domeAlreadyResolved: !!domeAlreadyResolved
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
        return {
          ...localApplication,
          requestPayload: payload
        };
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
    return {
      ...applicationResult,
      requestPayload: payload
    };
  }

  return (applicationResult && typeof applicationResult === "object")
    ? { ...applicationResult, requestPayload: payload }
    : applicationResult;
}

export async function requestIncomingHealApplicationForTarget({
  target = null,
  attackerActor = null,
  attackerToken = null,
  combat = null,
  healRoll = null,
  healType = ""
} = {}) {
  const targetActor = target?.actor || null;
  const targetTokenDocument = target?.tokenDocument || target?.token?.document || target?.token || null;
  if (!targetActor || !combat || !healRoll) return null;

  const recipient = getPreferredDefensePromptRecipientUser(targetActor, targetTokenDocument);
  if (!recipient?.id) {
    pcLog.debug("Peasant Core | Incoming heal apply skipped: no recipient user found", {
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
    || "Healer"
  ).trim() || "Healer";
  const resolvedHealAmount = Number(healRoll.total) || 0;
  const rawHealType = String(healType || healRoll?.healType || combat?.heal?.type || "").trim().toLowerCase();
  const resolvedHealType = rawHealType === "greater" || rawHealType === "special" ? rawHealType : "temporary";

  const payload = {
    originatingUserId: game.user?.id || null,
    recipientUserId: recipient.id,
    attackerActorId: attackerActor?.id || null,
    attackerActorUuid: attackerActor?.uuid || null,
    attackerTokenUuid: attackerTokenDocument?.uuid || null,
    attackerTokenName: attackerName,
    attackCombatIndex: null,
    attackCombatName: String(combat?.name || "Heal").trim() || "Heal",
    attackTargetingType: getCombatTargetingType(combat),
    targetSceneId: targetTokenDocument?.parent?.id || targetTokenDocument?.scene?.id || null,
    targetTokenId: targetTokenDocument?.id || null,
    targetTokenUuid: targetTokenDocument?.uuid || null,
    targetTokenName: target?.targetName || targetTokenDocument?.name || targetActor?.name || "Target",
    targetActorId: targetActor?.id || null,
    targetActorUuid: targetActor?.uuid || null,
    healAmount: resolvedHealAmount,
    healType: resolvedHealType
  };

  const applyIncomingHealForUser = game.peasantCore?.applyIncomingHealForUser;
  if (recipient.id !== game.user?.id && typeof applyIncomingHealForUser === "function") {
    try {
      const remoteApplication = await applyIncomingHealForUser(recipient.id, payload);
      if (remoteApplication) return remoteApplication;
    } catch (error) {
      console.error("Peasant Core | Remote incoming heal apply failed, falling back to local application.", error);
    }
  }

  let canApplyLocally = false;
  try {
    canApplyLocally = !!game.user?.isGM
      || (typeof targetActor?.canUserModify === "function" && targetActor.canUserModify(game.user, "update"));
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to test local incoming-heal apply permission", e);
  }

  if (canApplyLocally) {
    try {
      const localApplication = await applyIncomingHeal(payload);
      if (localApplication?.handled && localApplication?.applied) {
        return localApplication;
      }
    } catch (error) {
      console.error("Peasant Core | Local incoming heal apply failed, falling back to remote application.", error);
    }
  }

  let applicationResult = null;
  if (typeof applyIncomingHealForUser === "function") {
    applicationResult = await applyIncomingHealForUser(recipient.id, payload);
  } else {
    applicationResult = await applyIncomingHeal(payload);
  }

  const applicationHandled = !!(applicationResult && typeof applicationResult === "object" && applicationResult.handled);
  const applicationApplied = !!(applicationResult && typeof applicationResult === "object" && applicationResult.applied);
  if (applicationHandled && applicationApplied) {
    return applicationResult;
  }

  return applicationResult;
}
