import { getCombatDefenseResponseKey, normalizeCombatDefense } from "../../data/actor/combat-defense.mjs";
import { getCombatCostModifiers } from "../../data/actor/combat-modifiers.mjs";
import { applyDefensePenaltiesToRollResult, forceRollResultFailureDueToDefense } from "../../data/actor/defense-penalties.mjs";
import {
  doesSuccessfulAreaDefenseDefendAttack,
  doesPromptResultCountAsActiveDefense,
  getAccuracyPenaltyFromDefenseRoll,
  getFailureLabelFromDefensePromptResult,
  getToHitPenaltyFromDefenseRoll,
  isMageDefenseDamageRedirect,
  isNarrowSuccessAttack,
  isShieldDefenseDamageBlock,
  isWeaponDefenseDamageBlock
} from "../../data/actor/defense-results.mjs";
import { getCombatMagnetismGrade, getCombatTargetingType, hasRangeRateValue } from "../../data/actor/combat-tags.mjs";
import { normalizeAppliedDamageType } from "../../data/actor/targeted-damage.mjs";
import { hasCombatDice } from "../../dice/combat-dice.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { getLocationBySkillOptions } from "../actor/location-table.mjs";
import { attachRollUndoToChatMessage, captureActorRollUndo, collectRollUndoRecords } from "../chat-undo.mjs";
import {
  attachEdgeChainToChatMessages,
  attachEdgeExplodeToChatMessage,
  createNotableCombatEdgeChainContext,
  ensureNotableCombatEdgeChainIdentity,
  getCriticalEdgeBlockFromRollResult
} from "./edge-chain-rolls.mjs";
import { getActiveNotableCombatTargets, getPreferredActorToken } from "./actor-targets.mjs";
import { emitDefensePromptRequestsForAttack } from "./defense-prompt-requests.mjs";
import { consumeNotableCombatRollUse, executeResolvedNotableCombatRoll } from "./notable-combat-rolls.mjs";
import { isChainCancelledResult, showFlexibleDamageTypePrompt } from "./prompt-dialogs.mjs";
import { showRangeRatePrompt } from "./range-rate-dialog.mjs";
import { updateSkillRollChatCardFromResult } from "./roll-chat-updates.mjs";
import { resolveSuccessfulAttackDamageForTarget } from "./successful-attack-damage.mjs";
import { resolveSuccessfulHealForTarget } from "./successful-heal.mjs";

function cloneData(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  } catch (_) {}
  return JSON.parse(JSON.stringify(value));
}

function getRollOutcomeChatMessage(rollOutcome) {
  return rollOutcome?.sharedAttackRoll?.rollResult?.chatMessage
    || rollOutcome?.rollResult?.chatMessage
    || null;
}

function addChatMessage(messages, candidate) {
  const message = candidate?.setFlag
    ? candidate
    : (candidate?.id ? game.messages?.get(candidate.id) || null : null);
  if (message?.id && !messages.some((entry) => entry?.id === message.id)) messages.push(message);
}

function addIncomingResolutionChatMessages(messages, resolution) {
  addChatMessage(messages, resolution?.damageRoll?.chatMessage);
  addChatMessage(messages, resolution?.healRoll?.chatMessage);
  addChatMessage(messages, resolution?.application?.applyResult?.chatMessage);
  addChatMessage(messages, resolution?.application?.armApplyResult?.chatMessage);
  addChatMessage(messages, resolution?.application?.overflowApplyResult?.chatMessage);
}

function collectRollOutcomeChatMessages(rollOutcome) {
  const messages = [];
  addChatMessage(messages, getRollOutcomeChatMessage(rollOutcome));

  for (const promptEntry of rollOutcome?.defensePromptSummary?.promptResults || []) {
    addChatMessage(messages, promptEntry?.result?.defenseRoll?.sharedAttackRoll?.rollResult?.chatMessage);
    addChatMessage(messages, promptEntry?.result?.defenseRoll?.rollResult?.chatMessage);
  }

  addIncomingResolutionChatMessages(messages, rollOutcome?.incomingHitResolution);
  addIncomingResolutionChatMessages(messages, rollOutcome?.incomingHealResolution);
  for (const targetRoll of rollOutcome?.targetRolls || []) {
    addIncomingResolutionChatMessages(messages, targetRoll?.incomingHitResolution);
    addIncomingResolutionChatMessages(messages, targetRoll?.incomingHealResolution);
  }

  return messages;
}

function collectIncomingApplicationUndoRecords(resolution) {
  return collectRollUndoRecords(resolution?.application?.undoRecords);
}

function collectDefensePromptUndoRecords(defensePromptSummary) {
  const records = [];
  for (const promptEntry of defensePromptSummary?.promptResults || []) {
    records.push(...collectRollUndoRecords(promptEntry?.result?.defenseRoll?.undoRecords));
  }
  return records;
}

function collectRollOutcomeUndoRecords(rollOutcome, ...baseRecords) {
  const records = collectRollUndoRecords(
    ...baseRecords,
    collectDefensePromptUndoRecords(rollOutcome?.defensePromptSummary),
    collectRollOutcomePostRollUndoRecords(rollOutcome)
  );

  return records;
}

function collectRollOutcomePostRollUndoRecords(rollOutcome, ...baseRecords) {
  const records = collectRollUndoRecords(
    ...baseRecords,
    rollOutcome?.forcePassResult,
    rollOutcome?.sharedAttackRoll?.forcePassResult,
    collectIncomingApplicationUndoRecords(rollOutcome?.incomingHitResolution),
    collectIncomingApplicationUndoRecords(rollOutcome?.incomingHealResolution)
  );

  for (const targetRoll of rollOutcome?.targetRolls || []) {
    records.push(...collectIncomingApplicationUndoRecords(targetRoll?.incomingHitResolution));
    records.push(...collectIncomingApplicationUndoRecords(targetRoll?.incomingHealResolution));
  }

  return records;
}

function serializeRollResult(rollResult) {
  if (!rollResult) return null;
  return {
    toHit: Number.isFinite(Number(rollResult.toHit)) ? Number(rollResult.toHit) : null,
    accuracy: Number.isFinite(Number(rollResult.accuracy)) ? Number(rollResult.accuracy) : null,
    initialDice: Array.isArray(rollResult.initialDice) ? rollResult.initialDice.map(Number) : [],
    allDice: Array.isArray(rollResult.allDice) ? rollResult.allDice.map(Number) : [],
    keptDice: Array.isArray(rollResult.keptDice) ? rollResult.keptDice.map(Number) : [],
    additionalDice: Array.isArray(rollResult.additionalDice) ? rollResult.additionalDice.map(Number) : [],
    initialTotal: Number.isFinite(Number(rollResult.initialTotal)) ? Number(rollResult.initialTotal) : null,
    total: Number.isFinite(Number(rollResult.total)) ? Number(rollResult.total) : null,
    baseMoS: Number.isFinite(Number(rollResult.baseMoS)) ? Number(rollResult.baseMoS) : null,
    accuracyMoS: Number.isFinite(Number(rollResult.accuracyMoS)) ? Number(rollResult.accuracyMoS) : null,
    criticalMoS: Number.isFinite(Number(rollResult.criticalMoS)) ? Number(rollResult.criticalMoS) : 0,
    totalMoS: Number.isFinite(Number(rollResult.totalMoS)) ? Number(rollResult.totalMoS) : null,
    isSuccess: !!rollResult.isSuccess,
    resultText: String(rollResult.resultText || "").trim(),
    criticalType: String(rollResult.criticalType || "").trim(),
    messageId: rollResult.chatMessage?.id || null
  };
}

function serializeDefensePromptResult(promptResult) {
  if (!promptResult) return null;
  return {
    handled: !!promptResult.handled,
    selection: String(promptResult.selection || "").trim(),
    selectedCombatIndex: promptResult.selectedCombatIndex ?? null,
    selectedDefense: cloneData(promptResult.selectedDefense || null),
    appliedAccuracyPenalty: Number(promptResult.appliedAccuracyPenalty) || 0,
    appliedToHitPenalty: Number(promptResult.appliedToHitPenalty) || 0,
    activeDefense: !!promptResult.activeDefense,
    primalEvasionPenalty: Number(promptResult.primalEvasionPenalty) || 0,
    shieldBlockBraced: !!promptResult.shieldBlockBraced,
    defenseRoll: promptResult.defenseRoll ? {
      rolled: !!promptResult.defenseRoll.rolled,
      actorId: promptResult.defenseRoll.actorId || null,
      combatIndex: promptResult.defenseRoll.combatIndex ?? null,
      combatName: promptResult.defenseRoll.combatName || null,
      rollResult: serializeRollResult(
        promptResult.defenseRoll?.sharedAttackRoll?.rollResult
        || promptResult.defenseRoll?.rollResult
      )
    } : null,
    reflexSaveResult: promptResult.reflexSaveResult ? {
      isSuccess: !!promptResult.reflexSaveResult.isSuccess,
      totalMoS: Number.isFinite(Number(promptResult.reflexSaveResult.totalMoS)) ? Number(promptResult.reflexSaveResult.totalMoS) : null,
      resultText: String(promptResult.reflexSaveResult.resultText || "").trim()
    } : null
  };
}

function hydrateDefensePromptResult(promptResult) {
  if (!promptResult) return null;
  const hydrated = cloneData(promptResult);
  if (hydrated?.defenseRoll?.rollResult) {
    hydrated.defenseRoll.rollResult = hydrateRollResult(hydrated.defenseRoll.rollResult);
  }
  return hydrated;
}

function createActorRef(actor) {
  return {
    actorId: actor?.id || null,
    actorUuid: actor?.uuid || null,
    actorName: actor?.name || null
  };
}

function createTokenRef(tokenLike) {
  const tokenDocument = tokenLike?.document ?? tokenLike ?? null;
  const actor = tokenLike?.actor || tokenDocument?.actor || null;
  return {
    tokenId: tokenDocument?.id || null,
    tokenUuid: tokenDocument?.uuid || null,
    sceneId: tokenDocument?.parent?.id || tokenDocument?.scene?.id || canvas?.scene?.id || null,
    tokenName: tokenLike?.name || tokenDocument?.name || null,
    actorId: actor?.id || null,
    actorUuid: actor?.uuid || null,
    actorName: actor?.name || null
  };
}

function createTargetRef(target) {
  if (!target) return null;
  const tokenRef = createTokenRef(target.token || target.tokenDocument || null);
  return {
    ...tokenRef,
    actorId: target.actor?.id || target.actorId || tokenRef.actorId || null,
    actorUuid: target.actor?.uuid || tokenRef.actorUuid || null,
    actorName: target.actor?.name || tokenRef.actorName || null,
    targetName: String(target.targetName || target.token?.name || target.tokenDocument?.name || target.actor?.name || "").trim() || "Target"
  };
}

function createTargetCheckpointEntries(rollOutcome) {
  if (rollOutcome?.multiTarget) {
    return (rollOutcome.targetRolls || []).map((targetRoll) => ({
      targetRef: cloneData(targetRoll?.targetRef || {
        targetName: targetRoll?.targetName || null,
        tokenId: targetRoll?.targetTokenId || null,
        actorId: targetRoll?.targetActorId || null
      }),
      targetLabel: targetRoll?.targetName || targetRoll?.targetLabel || "",
      defensePromptResult: serializeDefensePromptResult(targetRoll?.defensePromptResult || null)
    })).filter((entry) => entry.targetRef);
  }

  return rollOutcome?.targetRef ? [{
    targetRef: cloneData(rollOutcome.targetRef),
    targetLabel: rollOutcome?.targetName || rollOutcome?.targetLabel || "",
    defensePromptResult: serializeDefensePromptResult(rollOutcome?.defensePromptSummary?.promptResults?.[0]?.result || null)
  }] : [];
}

function createNotableCombatPostRollCheckpoint({
  stage = "attack",
  actor = null,
  combat = null,
  combatIndex = null,
  attackerToken = null,
  targetingType = "",
  isHealRoll = false,
  resolvedDamageType = null,
  rollOutcome = null,
  defenseTargetRef = null
} = {}) {
  const attackRollResult = rollOutcome?.sharedAttackRoll?.rollResult
    || rollOutcome?.preDefenseRollResult
    || rollOutcome?.rollResult
    || null;
  return {
    version: 2,
    type: "notableCombatPostRoll",
    stage,
    actor: createActorRef(actor),
    combatIndex,
    combatName: combat?.name || rollOutcome?.combatName || "Combat",
    attackerToken: createTokenRef(attackerToken),
    targetingType: String(targetingType || "").trim(),
    isHealRoll: !!isHealRoll,
    resolvedDamageType: resolvedDamageType || null,
    attackMessageId: attackRollResult?.chatMessage?.id || null,
    attackRollResult: serializeRollResult(attackRollResult),
    multiTarget: !!rollOutcome?.multiTarget,
    targetLabel: rollOutcome?.targetLabel || "",
    defenseTargetRef: defenseTargetRef ? cloneData(defenseTargetRef) : null,
    targets: createTargetCheckpointEntries(rollOutcome)
  };
}

function isTrainedRollResult(rollResult) {
  if (Array.isArray(rollResult?.initialDice) && rollResult.initialDice.length >= 2) return true;
  return !(Array.isArray(rollResult?.allDice) && rollResult.allDice.length >= 3);
}

async function attachEdgeExplodeCheckpointToRollResult(rollResult, {
  checkpoint = null,
  preRollRecords = [],
  postRollRecords = []
} = {}) {
  const message = rollResult?.chatMessage || null;
  if (!message?.setFlag || !checkpoint) return;
  await attachEdgeExplodeToChatMessage(message, rollResult, {
    trained: isTrainedRollResult(rollResult),
    stage: checkpoint.stage,
    checkpoint,
    preRollRecords,
    postRollRecords
  });
}

async function attachNotableCombatEdgeExplodeCheckpoints(rollOutcome, {
  actor = null,
  combat = null,
  combatIndex = null,
  attackerToken = null,
  targetingType = "",
  isHealRoll = false,
  resolvedDamageType = null,
  preRollRecords = [],
  postRollRecords = []
} = {}) {
  const baseCheckpoint = createNotableCombatPostRollCheckpoint({
    stage: "attack",
    actor,
    combat,
    combatIndex,
    attackerToken,
    targetingType,
    isHealRoll,
    resolvedDamageType,
    rollOutcome
  });
  await attachEdgeExplodeCheckpointToRollResult(
    rollOutcome?.sharedAttackRoll?.rollResult || rollOutcome?.preDefenseRollResult || rollOutcome?.rollResult,
    { checkpoint: baseCheckpoint, preRollRecords, postRollRecords }
  );

  for (const promptEntry of rollOutcome?.defensePromptSummary?.promptResults || []) {
    const defenseRoll = promptEntry?.result?.defenseRoll || null;
    const defenseCheckpoint = createNotableCombatPostRollCheckpoint({
      stage: "defense",
      actor,
      combat,
      combatIndex,
      attackerToken,
      targetingType,
      isHealRoll,
      resolvedDamageType,
      rollOutcome,
      defenseTargetRef: promptEntry?.targetRef || {
        targetName: promptEntry?.targetName || null,
        tokenId: promptEntry?.targetTokenId || null,
        actorId: promptEntry?.targetActorId || null
      }
    });
    await attachEdgeExplodeCheckpointToRollResult(
      defenseRoll?.sharedAttackRoll?.rollResult || defenseRoll?.rollResult,
      { checkpoint: defenseCheckpoint, preRollRecords, postRollRecords }
    );
  }
}

async function resolveActorRef(ref) {
  if (!ref) return null;
  const actorUuid = String(ref.actorUuid || "").trim();
  if (actorUuid && typeof fromUuid === "function") {
    try {
      const actor = await fromUuid(actorUuid);
      if (actor?.documentName === "Actor" || String(actor?.collectionName || "").toLowerCase() === "actors") return actor;
      if (actor?.actor) return actor.actor;
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to resolve Edge Explode actor UUID", e);
    }
  }

  const actorId = String(ref.actorId || "").trim();
  return actorId ? game.actors?.get(actorId) || null : null;
}

async function resolveTokenRef(ref) {
  if (!ref) return null;
  const tokenUuid = String(ref.tokenUuid || "").trim();
  if (tokenUuid && typeof fromUuid === "function") {
    try {
      const tokenDocument = await fromUuid(tokenUuid);
      if (tokenDocument) return tokenDocument;
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to resolve Edge Explode token UUID", e);
    }
  }

  const sceneId = String(ref.sceneId || "").trim();
  const tokenId = String(ref.tokenId || "").trim();
  if (sceneId && tokenId) {
    const tokenDocument = game.scenes?.get(sceneId)?.tokens?.get(tokenId) || null;
    if (tokenDocument) return tokenDocument;
  }

  if (tokenId) {
    const sceneToken = canvas?.scene?.tokens?.get(tokenId) || null;
    if (sceneToken) return sceneToken;
  }

  return null;
}

async function resolveTargetRef(ref) {
  const tokenDocument = await resolveTokenRef(ref);
  const token = tokenDocument?.object || tokenDocument || null;
  const actor = token?.actor || tokenDocument?.actor || await resolveActorRef(ref);
  if (!actor) return null;
  return {
    token,
    tokenDocument,
    actor,
    tokenId: tokenDocument?.id || ref?.tokenId || null,
    actorId: actor.id || ref?.actorId || null,
    targetName: String(ref?.targetName || token?.name || tokenDocument?.name || actor.name || "").trim() || "Target"
  };
}

function refsMatch(left, right) {
  if (!left || !right) return false;
  const leftTokenUuid = String(left.tokenUuid || "").trim();
  const rightTokenUuid = String(right.tokenUuid || "").trim();
  if (leftTokenUuid && rightTokenUuid && leftTokenUuid === rightTokenUuid) return true;

  const leftTokenId = String(left.tokenId || "").trim();
  const rightTokenId = String(right.tokenId || "").trim();
  const leftSceneId = String(left.sceneId || "").trim();
  const rightSceneId = String(right.sceneId || "").trim();
  if (leftTokenId && rightTokenId && leftTokenId === rightTokenId && (!leftSceneId || !rightSceneId || leftSceneId === rightSceneId)) return true;

  const leftActorUuid = String(left.actorUuid || "").trim();
  const rightActorUuid = String(right.actorUuid || "").trim();
  if (leftActorUuid && rightActorUuid && leftActorUuid === rightActorUuid) return true;

  const leftActorId = String(left.actorId || "").trim();
  const rightActorId = String(right.actorId || "").trim();
  return !!(leftActorId && rightActorId && leftActorId === rightActorId);
}

function hydrateRollResult(serializedRollResult, chatMessage = null) {
  if (!serializedRollResult) return null;
  return {
    ...cloneData(serializedRollResult),
    chatMessage
  };
}

function getReplayCombat(actor, checkpoint) {
  const combats = Array.isArray(actor?.system?.notableCombats) ? actor.system.notableCombats : [];
  const index = Number.parseInt(checkpoint?.combatIndex, 10);
  if (Number.isFinite(index) && combats[index]) return { combat: combats[index], combatIndex: index };

  const combatName = String(checkpoint?.combatName || "").trim();
  if (combatName) {
    const foundIndex = combats.findIndex((combat) => String(combat?.name || "").trim() === combatName);
    if (foundIndex >= 0) return { combat: combats[foundIndex], combatIndex: foundIndex };
  }

  return { combat: null, combatIndex: -1 };
}

function updateReplayDefensePromptResult(entry, checkpoint, replacementDefenseRollResult) {
  const promptResult = hydrateDefensePromptResult(entry?.defensePromptResult || null);
  if (!promptResult || checkpoint?.stage !== "defense") return promptResult;
  if (!refsMatch(entry?.targetRef, checkpoint?.defenseTargetRef)) return promptResult;

  const selectedDefense = promptResult.selectedDefense || null;
  promptResult.defenseRoll = {
    ...(promptResult.defenseRoll || {}),
    rollResult: replacementDefenseRollResult
  };
  promptResult.appliedAccuracyPenalty = getAccuracyPenaltyFromDefenseRoll(
    selectedDefense,
    checkpoint?.targetingType,
    replacementDefenseRollResult
  );
  promptResult.appliedToHitPenalty = getToHitPenaltyFromDefenseRoll(
    selectedDefense,
    replacementDefenseRollResult
  );
  promptResult.activeDefense = promptResult.selection === "defense" || !!promptResult.activeDefense;
  return promptResult;
}

async function buildReplayAttackRollForTarget({
  baseAttackRollResult = null,
  targetEntry = null,
  targetingType = "",
  preserveChatMessage = false
} = {}) {
  const defensePromptResult = targetEntry?.defensePromptResult || null;
  const defenseAccuracyPenalty = Number(defensePromptResult?.appliedAccuracyPenalty) || 0;
  const defenseToHitPenalty = Number(defensePromptResult?.appliedToHitPenalty) || 0;
  const defenseFailureLabel = getFailureLabelFromDefensePromptResult(defensePromptResult);
  const areaDefenseDefendedAttack = doesSuccessfulAreaDefenseDefendAttack(targetingType, defensePromptResult);
  const penaltyApplication = applyDefensePenaltiesToRollResult(baseAttackRollResult, {
    defenseAccuracyPenalty,
    defenseToHitPenalty,
    defenseFailureLabel,
    preserveChatMessage
  });
  let rollResult = penaltyApplication?.rollResult || baseAttackRollResult || null;
  if (areaDefenseDefendedAttack && rollResult) {
    const defendedApplication = forceRollResultFailureDueToDefense(rollResult, {
      defenseFailureLabel,
      preserveChatMessage
    });
    if (defendedApplication?.rollResult) rollResult = defendedApplication.rollResult;
  }
  if (preserveChatMessage && rollResult?.chatMessage) {
    try {
      await updateSkillRollChatCardFromResult(rollResult, {
        label: rollResult.resultText || null
      });
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to update replayed attack roll after Edge Explode", e);
    }
  }

  return {
    rolled: true,
    targetLabel: targetEntry?.targetLabel || "",
    defenseAccuracyPenalty,
    defenseToHitPenalty,
    rollResult
  };
}

function getReplayWeaponMasteryMagnetismGrade(combat, defensePromptResult, { requireMelee = false } = {}) {
  const baseGrade = getCombatMagnetismGrade(combat);
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  const isMelee = getCombatDefenseResponseKey(getCombatTargetingType(combat)) === "melee";
  const defensePassed = !!defensePromptResult?.defenseRoll?.rollResult?.isSuccess;
  const masteryApplies = !!(
    defensePromptResult?.selection === "defense"
    && defense.block
    && defense.blockType === "Weapon"
    && defense.masteryBonus
    && defensePassed
    && (!requireMelee || isMelee)
  );
  return masteryApplies ? Math.max(baseGrade, 1) : baseGrade;
}

function getLocationChoiceSignature(mos, { magnetismGrade = 0 } = {}) {
  return getLocationBySkillOptions(mos, { magnetismGrade })
    .map((option) => String(option?.key || "").trim())
    .filter(Boolean)
    .join("|");
}

function getAttackDownstreamSignature(combat, attackRoll, defensePromptResult, { isHealRoll = false } = {}) {
  const rollResult = attackRoll?.rollResult || null;
  if (isHealRoll) return `heal:${rollResult?.isSuccess ? "success" : "failure"}`;

  const targetingKey = getCombatDefenseResponseKey(getCombatTargetingType(combat));
  const mageBlockFailure = isMageDefenseDamageRedirect(attackRoll, defensePromptResult);
  const shieldBlockFailure = isShieldDefenseDamageBlock(attackRoll, defensePromptResult);
  const weaponBlockFailure = isWeaponDefenseDamageBlock(attackRoll, defensePromptResult);
  const narrowSuccessWithoutDefense = isNarrowSuccessAttack(attackRoll)
    && !doesPromptResultCountAsActiveDefense(defensePromptResult);
  const canApplyDamage = !!(
    rollResult?.isSuccess
    || narrowSuccessWithoutDefense
    || mageBlockFailure
    || shieldBlockFailure
    || weaponBlockFailure
  );
  if (!canApplyDamage) return "damage:none";

  if (shieldBlockFailure) return "damage:shield-block";
  if (mageBlockFailure) return "damage:mage-block";
  if (["aoe", "areaBlast", "tileBlast"].includes(targetingKey)) {
    return `damage:${targetingKey}:success:${rollResult?.isSuccess ? "1" : "0"}`;
  }

  const magnetismGrade = getReplayWeaponMasteryMagnetismGrade(combat, defensePromptResult, {
    requireMelee: !weaponBlockFailure
  });
  const locationChoices = getLocationChoiceSignature(Number(rollResult?.totalMoS) || 0, { magnetismGrade });
  const route = weaponBlockFailure ? "weapon-block" : "normal";
  return [
    "damage",
    route,
    rollResult?.isSuccess ? "success" : "failure",
    String(rollResult?.resultText || "").trim(),
    locationChoices
  ].join(":");
}

export async function planNotableCombatEdgeExplodeReplay({
  checkpoint = null,
  rollResult = null
} = {}) {
  if (!checkpoint || checkpoint.version !== 2 || checkpoint.type !== "notableCombatPostRoll") {
    return { ok: false, error: "Edge Explode checkpoint was unavailable." };
  }

  const actor = await resolveActorRef(checkpoint.actor);
  if (!actor) return { ok: false, error: "The original roll actor was not found." };

  const { combat } = getReplayCombat(actor, checkpoint);
  if (!combat) return { ok: false, error: "The original combat entry was not found." };

  const oldBaseAttackRollResult = hydrateRollResult(checkpoint.attackRollResult);
  const newBaseAttackRollResult = checkpoint.stage === "defense"
    ? oldBaseAttackRollResult
    : rollResult;
  if (!oldBaseAttackRollResult || !newBaseAttackRollResult) {
    return { ok: false, error: "The original attack roll checkpoint was incomplete." };
  }

  const targetEntries = (checkpoint.targets || []).length
    ? checkpoint.targets
    : [{ targetLabel: checkpoint.targetLabel || "", defensePromptResult: null }];
  for (const entry of targetEntries) {
    const oldEntry = {
      ...cloneData(entry),
      defensePromptResult: hydrateDefensePromptResult(entry?.defensePromptResult || null)
    };
    const newEntry = {
      ...cloneData(entry),
      defensePromptResult: updateReplayDefensePromptResult(entry, checkpoint, rollResult)
    };
    const oldAttackRoll = await buildReplayAttackRollForTarget({
      baseAttackRollResult: oldBaseAttackRollResult,
      targetEntry: oldEntry,
      targetingType: checkpoint.targetingType,
      preserveChatMessage: false
    });
    const newAttackRoll = await buildReplayAttackRollForTarget({
      baseAttackRollResult: newBaseAttackRollResult,
      targetEntry: newEntry,
      targetingType: checkpoint.targetingType,
      preserveChatMessage: false
    });
    const oldSignature = getAttackDownstreamSignature(combat, oldAttackRoll, oldEntry.defensePromptResult, {
      isHealRoll: checkpoint.isHealRoll
    });
    const newSignature = getAttackDownstreamSignature(combat, newAttackRoll, newEntry.defensePromptResult, {
      isHealRoll: checkpoint.isHealRoll
    });
    if (oldSignature !== newSignature) {
      return {
        ok: true,
        replayRequired: true,
        reason: "downstream-options-changed",
        oldSignature,
        newSignature
      };
    }
  }

  return {
    ok: true,
    replayRequired: false,
    reason: "same-downstream-options"
  };
}

export async function replayNotableCombatPostRollEffects({
  checkpoint = null,
  rollResult = null
} = {}) {
  if (!checkpoint || checkpoint.version !== 2 || checkpoint.type !== "notableCombatPostRoll") {
    return { ok: false, error: "Edge Explode checkpoint was unavailable." };
  }

  const actor = await resolveActorRef(checkpoint.actor);
  if (!actor) return { ok: false, error: "The original roll actor was not found." };

  const { combat, combatIndex } = getReplayCombat(actor, checkpoint);
  if (!combat) return { ok: false, error: "The original combat entry was not found." };

  const attackerTokenDocument = await resolveTokenRef(checkpoint.attackerToken);
  const attackerToken = attackerTokenDocument?.object || attackerTokenDocument || null;
  const attackMessage = checkpoint.attackMessageId ? game.messages?.get(checkpoint.attackMessageId) || null : null;
  const baseAttackRollResult = checkpoint.stage === "defense"
    ? hydrateRollResult(checkpoint.attackRollResult, attackMessage)
    : rollResult;
  if (!baseAttackRollResult) return { ok: false, error: "The original attack roll checkpoint was incomplete." };

  const targetEntries = [];
  for (const entry of checkpoint.targets || []) {
    const target = await resolveTargetRef(entry?.targetRef);
    if (!target) {
      return { ok: false, error: `Could not find ${entry?.targetRef?.targetName || entry?.targetLabel || "a target"}.` };
    }
    targetEntries.push({
      ...cloneData(entry),
      target,
      defensePromptResult: updateReplayDefensePromptResult(entry, checkpoint, rollResult)
    });
  }

  const targetRolls = [];
  let incomingHitResolution = null;
  let incomingHealResolution = null;
  if (checkpoint.multiTarget) {
    for (const entry of targetEntries) {
      const targetAttackRoll = await buildReplayAttackRollForTarget({
        baseAttackRollResult,
        targetEntry: entry,
        targetingType: checkpoint.targetingType,
        preserveChatMessage: false
      });
      if (checkpoint.isHealRoll) {
        incomingHealResolution = await resolveSuccessfulHealForTarget({
          actor,
          attackerToken,
          combat,
          target: entry.target,
          attackRoll: targetAttackRoll
        });
      } else {
        incomingHitResolution = await resolveSuccessfulAttackDamageForTarget({
          actor,
          attackerToken,
          combat,
          target: entry.target,
          attackRoll: targetAttackRoll,
          defensePromptResult: entry.defensePromptResult,
          appliedDamageType: checkpoint.resolvedDamageType || null
        });
        if (isChainCancelledResult(incomingHitResolution)) {
          return { ok: false, error: "Edge Explode downstream damage replay was cancelled." };
        }
      }
      targetRolls.push({
        ...targetAttackRoll,
        targetTokenId: entry.target.tokenId,
        targetActorId: entry.target.actorId,
        targetName: entry.target.targetName,
        targetRef: createTargetRef(entry.target),
        defensePromptResult: entry.defensePromptResult,
        incomingHitResolution,
        incomingHealResolution
      });
    }
  } else {
    const entry = targetEntries[0] || { target: null, defensePromptResult: null, targetLabel: checkpoint.targetLabel || "" };
    const singleRoll = await buildReplayAttackRollForTarget({
      baseAttackRollResult,
      targetEntry: entry,
      targetingType: checkpoint.targetingType,
      preserveChatMessage: true
    });
    if (checkpoint.isHealRoll) {
      incomingHealResolution = await resolveSuccessfulHealForTarget({
        actor,
        attackerToken,
        combat,
        target: entry.target,
        attackRoll: singleRoll
      });
    } else {
      incomingHitResolution = await resolveSuccessfulAttackDamageForTarget({
        actor,
        attackerToken,
        combat,
        target: entry.target,
        attackRoll: singleRoll,
        defensePromptResult: entry.defensePromptResult,
        appliedDamageType: checkpoint.resolvedDamageType || null
      });
      if (isChainCancelledResult(incomingHitResolution)) {
        return { ok: false, error: "Edge Explode downstream damage replay was cancelled." };
      }
    }
    targetRolls.push({
      ...singleRoll,
      targetTokenId: entry.target?.tokenId || null,
      targetActorId: entry.target?.actorId || null,
      targetName: entry.target?.targetName || null,
      targetRef: createTargetRef(entry.target),
      defensePromptResult: entry.defensePromptResult,
      incomingHitResolution,
      incomingHealResolution
    });
  }

  const replayOutcome = checkpoint.multiTarget
    ? {
      rolled: true,
      actorId: actor.id,
      combatIndex,
      combatName: combat.name || checkpoint.combatName || "Combat",
      multiTarget: true,
      sharedAttackRoll: { rolled: true, rollResult: baseAttackRollResult },
      targetRolls
    }
    : {
      ...(targetRolls[0] || { rolled: true, rollResult: baseAttackRollResult }),
      actorId: actor.id,
      combatIndex,
      combatName: combat.name || checkpoint.combatName || "Combat",
      multiTarget: false,
      incomingHitResolution,
      incomingHealResolution
    };

  const postRollRecords = collectRollOutcomePostRollUndoRecords(replayOutcome);
  return {
    ok: true,
    rollOutcome: replayOutcome,
    postRollRecords,
    messageIds: collectRollOutcomeChatMessages(replayOutcome)
      .map((message) => message?.id)
      .filter(Boolean)
  };
}

function findCriticalEdgeBlockFromRollResult(rollResult) {
  const edgeBlock = getCriticalEdgeBlockFromRollResult(rollResult);
  return edgeBlock?.edgeBlockedReason ? edgeBlock : null;
}

function collectDefensePromptRollResults(defensePromptSummary) {
  const rollResults = [];
  for (const promptEntry of defensePromptSummary?.promptResults || []) {
    const defenseRoll = promptEntry?.result?.defenseRoll || null;
    rollResults.push(defenseRoll?.sharedAttackRoll?.rollResult);
    rollResults.push(defenseRoll?.rollResult);
  }
  return rollResults.filter(Boolean);
}

function getRollOutcomeCriticalEdgeBlock(rollOutcome) {
  const rollResults = [
    rollOutcome?.sharedAttackRoll?.rollResult,
    rollOutcome?.rollResult,
    ...collectDefensePromptRollResults(rollOutcome?.defensePromptSummary),
    ...(rollOutcome?.targetRolls || []).map(targetRoll => targetRoll?.rollResult)
  ].filter(Boolean);

  for (const rollResult of rollResults) {
    const edgeBlock = findCriticalEdgeBlockFromRollResult(rollResult);
    if (edgeBlock) return edgeBlock;
  }

  return {};
}

function withNotableCombatRerunAdjustments(edgeChainContext, { toHitAdj = 0, accuracyAdj = 0 } = {}) {
  if (!edgeChainContext?.rerun) return edgeChainContext;
  return {
    ...edgeChainContext,
    rerun: {
      ...edgeChainContext.rerun,
      toHitAdj: Number.parseInt(toHitAdj, 10) || 0,
      accuracyAdj: Number.parseInt(accuracyAdj, 10) || 0
    }
  };
}

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
  rollMode = "",
  edgeChainContext = null,
  edgeExplodeReroll = null
} = {}) {
  try {
    if (!actor) return false;

    const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
    const combat = combats[combatIndex] || null;
    if (!combat) return false;
    if (!edgeChainContext) await ensureNotableCombatEdgeChainIdentity(actor, combatIndex);
    const baseEdgeChainContext = edgeChainContext || createNotableCombatEdgeChainContext({
      actor,
      combatIndex,
      promptForTargets,
      rollOverrides,
      toHitAdj,
      accuracyAdj,
      targetLabel,
      selectedDamageType,
      cardClass,
      rollMode
    });
    const resolvedEdgeChainContext = withNotableCombatRerunAdjustments(baseEdgeChainContext, { toHitAdj, accuracyAdj });
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
        attackerToken,
        edgeChainContext: resolvedEdgeChainContext,
        edgeExplodeReroll
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
    let resourceCostUndoRecords = [];

    if (typeof actor.applyPeasantCombatResourceCosts === "function") {
      const resourceCosts = await captureActorRollUndo(
        actor,
        `${combat.name || "Combat"} Resource Costs`,
        () => actor.applyPeasantCombatResourceCosts(combat, costModifiersByType)
      );
      resourceCostUndoRecords = resourceCosts.undoRecords;
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
        cardClass,
        edgeChainContext: resolvedEdgeChainContext,
        edgeExplodeReroll
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
          targetRef: createTargetRef(target),
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
        cardClass,
        edgeChainContext: resolvedEdgeChainContext,
        edgeExplodeReroll
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
      const preDefenseRollResult = singleRoll?.rollResult || null;
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
            preDefenseRollResult,
            multiTarget: false,
            defensePromptSummary,
            targetTokenId: target?.tokenId || null,
            targetActorId: target?.actorId || null,
            targetName: target?.targetName || null,
            targetRef: createTargetRef(target),
            incomingHitResolution,
            chainCancelled: true
          };
        }
      }
      rollOutcome = {
        ...singleRoll,
        preDefenseRollResult,
        multiTarget: false,
        defensePromptSummary,
        targetTokenId: target?.tokenId || null,
        targetActorId: target?.actorId || null,
        targetName: target?.targetName || null,
        targetRef: createTargetRef(target),
        incomingHitResolution,
        incomingHealResolution
      };
    }

    const rollUse = await captureActorRollUndo(
      actor,
      `${combat.name || "Combat"} Use`,
      () => consumeNotableCombatRollUse(actor, combatIndex, sheet)
    );
    rollOutcome.rollUseResult = rollUse.result;

    const preRollRecords = collectRollUndoRecords(
      resourceCostUndoRecords,
      collectDefensePromptUndoRecords(rollOutcome?.defensePromptSummary),
      rollUse.undoRecords
    );
    const postRollRecords = collectRollOutcomePostRollUndoRecords(rollOutcome);
    const undoRecords = collectRollUndoRecords(preRollRecords, postRollRecords);
    rollOutcome.undoRecords = undoRecords;
    rollOutcome.preRollRecords = preRollRecords;
    rollOutcome.postRollRecords = postRollRecords;
    const undoMessage = getRollOutcomeChatMessage(rollOutcome);
    await attachRollUndoToChatMessage(undoMessage, undoRecords, {
      label: `Undo ${combat.name || "Combat"} Roll Effects`
    });
    await attachNotableCombatEdgeExplodeCheckpoints(rollOutcome, {
      actor,
      combat,
      combatIndex,
      attackerToken,
      targetingType,
      isHealRoll,
      resolvedDamageType,
      preRollRecords,
      postRollRecords
    });
    await attachEdgeChainToChatMessages(
      collectRollOutcomeChatMessages(rollOutcome),
      resolvedEdgeChainContext,
      undoRecords,
      {
        ...getRollOutcomeCriticalEdgeBlock(rollOutcome),
        preRollRecords,
        postRollRecords
      }
    );

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
  rollMode = "",
  edgeChainContext = null,
  edgeExplodeReroll = null
} = {}) {
  if (!actor) return false;

  const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
  const combat = combats[combatIndex] || null;
  if (!combat) return false;
  if (!edgeChainContext) await ensureNotableCombatEdgeChainIdentity(actor, combatIndex);
  const resolvedEdgeChainContext = edgeChainContext || createNotableCombatEdgeChainContext({
    actor,
    combatIndex,
    promptForTargets,
    rollOverrides,
    targetLabel,
    selectedDamageType,
    cardClass,
    rollMode
  });

  const hasRangeRate = hasRangeRateValue(combat.rangeRate);
  if (!hasRangeRate) {
    return await performNotableCombatRoll({ actor, combatIndex, sheet, promptForTargets, rollOverrides, targetLabel, selectedDamageType, cardClass, rollMode, edgeChainContext: resolvedEdgeChainContext, edgeExplodeReroll });
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
    edgeChainContext: resolvedEdgeChainContext,
    edgeExplodeReroll,
    rollNotableCombat: performNotableCombatRoll
  });
}
