import { getCombatDefenseResponseKey, normalizeCombatDefense } from "../../data/actor/combat-defense.mjs";
import { getCombatCostModifiers, getEffectiveSkillCombatModifiers } from "../../data/actor/combat-modifiers.mjs";
import { applyDefensePenaltiesToRollResult, forceRollResultFailureDueToDefense } from "../../data/actor/defense-penalties.mjs";
import {
  doesSuccessfulAreaDefenseDefendAttack,
  doesPromptResultCountAsActiveDefense,
  getAccuracyPenaltyFromDefenseRoll,
  getFailureLabelFromDefensePromptResult,
  getToHitPenaltyFromDefenseRoll,
  getWeaponMasteryMagnetismGrade,
  isMageDefenseDamageRedirect,
  isNarrowSuccessAttack,
  isShieldDefenseDamageBlock,
  isWeaponDefenseDamageBlock
} from "../../data/actor/defense-results.mjs";
import { getCombatTargetingType, hasRangeRateValue } from "../../data/actor/combat-tags.mjs";
import { normalizeAppliedDamageType } from "../../data/actor/targeted-damage.mjs";
import { hasCombatDice } from "../../dice/combat-dice.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { getLocationBySkillOptions } from "../actor/location-table.mjs";
import { applyRollUndoRecords, attachRollUndoToChatMessage, captureActorRollUndo, collectRollUndoRecords } from "../chat-undo.mjs";
import {
  attachEdgeChainToChatMessages,
  attachEdgeExplodeToChatMessage,
  attachEdgeIndividualDieToChatMessage,
  createEdgeIndividualValueRollKey,
  createNotableCombatEdgeChainContext,
  ensureNotableCombatEdgeChainIdentity,
  getCriticalEdgeBlockFromRollResult
} from "./edge-chain-rolls.mjs";
import { getActiveNotableCombatTargets, getPreferredActorToken } from "./actor-targets.mjs";
import { emitDefensePromptRequestsForAttack } from "./defense-prompt-requests.mjs";
import { buildManifestSpellCastPreflight } from "./manifest-spell-effects.mjs";
import { offerSkillEntryEffects } from "./skill-entry-effects.mjs";
import { confirmManifestSpellReplacements, rollManualCombatTag } from "./manual-combat-tag-rolls.mjs";
import { consumeNotableCombatRollUse, executeResolvedNotableCombatRoll } from "./notable-combat-rolls.mjs";
import { isChainCancelledResult, showFlexibleDamageTypePrompt } from "./prompt-dialogs.mjs";
import { showRangeRatePrompt } from "./range-rate-dialog.mjs";
import { updateSkillRollChatCardFromResult } from "./roll-chat-updates.mjs";
import { resolveSuccessfulAttackDamageForTarget } from "./successful-attack-damage.mjs";
import { resolveSuccessfulHealForTarget } from "./successful-heal.mjs";
import { isSkillTagAutoEligible } from "../../data/actor/skill-entry-conditions.mjs";

const MANIFEST_SPELL_ROLL_TYPES = Object.freeze(["manifestDome", "manifestResistance"]);

function cloneData(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  } catch (_) {}
  return JSON.parse(JSON.stringify(value));
}

function rejectDamageWithoutTargeting(combat) {
  if (!hasCombatDice(combat?.damage) || getCombatTargetingType(combat)) return null;
  const error = `${combat?.name || "Notable"} has Damage but no Targeting type. Add Targeting before using it.`;
  globalThis.ui?.notifications?.warn?.(error);
  return { rolled: false, error };
}

function getRollOutcomeChatMessage(rollOutcome) {
  return rollOutcome?.sharedAttackRoll?.rollResult?.chatMessage
    || rollOutcome?.rollResult?.chatMessage
    || null;
}

function getChatMessageDocument(candidate) {
  return candidate?.setFlag
    ? candidate
    : (candidate?.id ? game.messages?.get(candidate.id) || null : null);
}

function addChatMessage(messages, candidate) {
  const message = getChatMessageDocument(candidate);
  if (message?.id && !messages.some((entry) => entry?.id === message.id)) messages.push(message);
}

function addIncomingResolutionChatMessages(messages, resolution) {
  addChatMessage(messages, resolution?.reflexSaveResult?.rollResult?.chatMessage);
  addChatMessage(messages, resolution?.damageRoll?.chatMessage);
  for (const barrierMessage of resolution?.damageRoll?.barrierMessages || []) {
    addChatMessage(messages, barrierMessage);
  }
  addChatMessage(messages, resolution?.healRoll?.chatMessage);
  addChatMessage(messages, resolution?.application?.applyResult?.chatMessage);
  addChatMessage(messages, resolution?.application?.armApplyResult?.chatMessage);
  addChatMessage(messages, resolution?.application?.overflowApplyResult?.chatMessage);
}

export function collectIncomingResolutionChatMessages(resolution) {
  const messages = [];
  addIncomingResolutionChatMessages(messages, resolution);
  addChatMessage(messages, resolution?.rollResult?.chatMessage);
  addChatMessage(messages, resolution?.locationRoll?.chatMessage);
  addChatMessage(messages, resolution?.application?.chatMessage);
  addChatMessage(messages, resolution?.application?.mageBlockResult?.overflowApplyResult?.chatMessage);
  return messages;
}

function collectRollOutcomeChatMessages(rollOutcome) {
  const messages = [];
  addChatMessage(messages, getRollOutcomeChatMessage(rollOutcome));

  for (const promptEntry of rollOutcome?.defensePromptSummary?.promptResults || []) {
    addChatMessage(messages, promptEntry?.result?.reflexSaveResult?.rollResult?.chatMessage);
    addChatMessage(messages, promptEntry?.result?.defenseRoll?.sharedAttackRoll?.rollResult?.chatMessage);
    addChatMessage(messages, promptEntry?.result?.defenseRoll?.rollResult?.chatMessage);
  }

  addIncomingResolutionChatMessages(messages, rollOutcome?.incomingHitResolution);
  addIncomingResolutionChatMessages(messages, rollOutcome?.incomingHealResolution);
  for (const targetRoll of rollOutcome?.targetRolls || []) {
    addIncomingResolutionChatMessages(messages, targetRoll?.incomingHitResolution);
    addIncomingResolutionChatMessages(messages, targetRoll?.incomingHealResolution);
  }
  for (const manifestRoll of rollOutcome?.manifestRolls || []) {
    addChatMessage(messages, manifestRoll?.chatMessage);
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
    collectIncomingApplicationUndoRecords(rollOutcome?.incomingHealResolution),
    ...(rollOutcome?.manifestRolls || []).flatMap((manifestRoll) => (
      collectRollUndoRecords(...(manifestRoll?.recipients || []))
    ))
  );

  for (const targetRoll of rollOutcome?.targetRolls || []) {
    records.push(...collectIncomingApplicationUndoRecords(targetRoll?.incomingHitResolution));
    records.push(...collectIncomingApplicationUndoRecords(targetRoll?.incomingHealResolution));
  }

  return records;
}

function getManifestSpellRollTypes(combat) {
  return MANIFEST_SPELL_ROLL_TYPES.filter((rollType) => hasCombatDice(combat?.[rollType]));
}

function getActorKey(actorLike) {
  return String(
    actorLike?.actor?.uuid
    || actorLike?.actorUuid
    || actorLike?.uuid
    || actorLike?.targetRef?.actorUuid
    || actorLike?.targetActorId
    || actorLike?.actorId
    || actorLike?.id
    || ""
  ).trim();
}

function getSuccessfulManifestActorKeys(activeTargets, rollOutcome) {
  if (!activeTargets.length) {
    return rollOutcome?.rollResult?.isSuccess ? null : new Set();
  }
  if (!rollOutcome?.multiTarget) {
    return rollOutcome?.rollResult?.isSuccess
      ? new Set(activeTargets.map(getActorKey).filter(Boolean))
      : new Set();
  }
  return new Set(
    (rollOutcome?.targetRolls || [])
      .filter((targetRoll) => targetRoll?.rollResult?.isSuccess)
      .map(getActorKey)
      .filter(Boolean)
  );
}

function filterManifestPreflight(preflight, successfulActorKeys) {
  if (successfulActorKeys === null) return preflight;
  return {
    ...preflight,
    recipients: (preflight?.recipients || [])
      .filter((recipient) => successfulActorKeys.has(getActorKey(recipient)))
  };
}

async function rollManifestSpellsForOutcome({
  actor,
  combat,
  combatIndex,
  manifestRollTypes,
  manifestPreflights,
  activeTargets,
  rollOutcome,
  edgeChainContext = null,
  edgeIndividualDieReplay = null,
  usageContext = null
}) {
  const successfulActorKeys = getSuccessfulManifestActorKeys(activeTargets, rollOutcome);
  const manifestRolls = [];
  for (let index = 0; index < manifestRollTypes.length; index += 1) {
    if (!isSkillTagAutoEligible(combat, manifestRollTypes[index], { success: true, hit: true })) continue;
    const approvedManifestPreflight = filterManifestPreflight(
      manifestPreflights[index],
      successfulActorKeys
    );
    if (!approvedManifestPreflight?.recipients?.length) continue;
    const manifestRoll = await rollManualCombatTag({
      actor,
      combatIndex,
      rollType: manifestRollTypes[index],
      approvedManifestPreflight,
      edgeChainContext,
      edgeIndividualDieReplay,
      usageContext
    });
    if (manifestRoll) manifestRolls.push(manifestRoll);
  }
  return manifestRolls;
}

export function serializeRollResult(rollResult) {
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

export function serializeDefensePromptResult(promptResult) {
  if (!promptResult) return null;
  return {
    handled: !!promptResult.handled,
    selection: String(promptResult.selection || "").trim(),
    selectedCombatIndex: promptResult.selectedCombatIndex ?? null,
    selectedCombatId: promptResult.selectedCombatId || null,
    selectedUsageId: promptResult.selectedUsageId || "base",
    mageBarrierAction: promptResult.mageBarrierAction || null,
    skipResourceCosts: !!promptResult.skipResourceCosts,
    selectedDefense: cloneData(promptResult.selectedDefense || null),
    appliedAccuracyPenalty: Number(promptResult.appliedAccuracyPenalty) || 0,
    appliedToHitPenalty: Number(promptResult.appliedToHitPenalty) || 0,
    activeDefense: !!promptResult.activeDefense,
    primalEvasionPenalty: Number(promptResult.primalEvasionPenalty) || 0,
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
    reflexSaveResult: serializeReflexSaveResult(promptResult.reflexSaveResult)
  };
}

function serializeReflexSaveResult(result) {
  if (!result) return null;
  return {
    toHit: result.toHit,
    passed: !!result.passed,
    rollResult: result.rollResult ? {
      ...serializeRollResult(result.rollResult),
      forcePassResult: cloneData(result.rollResult.forcePassResult)
    } : null
  };
}

function hydrateReflexSaveResult(result) {
  if (!result) return null;
  return {
    ...cloneData(result),
    rollResult: hydrateRollResult(result.rollResult, game.messages?.get(result.rollResult?.messageId) || null)
  };
}

function hydrateDefensePromptResult(promptResult) {
  if (!promptResult) return null;
  const hydrated = cloneData(promptResult);
  if (hydrated?.defenseRoll?.rollResult) {
    hydrated.defenseRoll.rollResult = hydrateRollResult(hydrated.defenseRoll.rollResult);
  }
  if (hydrated.reflexSaveResult) hydrated.reflexSaveResult = hydrateReflexSaveResult(hydrated.reflexSaveResult);
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
    tokenId: target.tokenId || tokenRef.tokenId,
    tokenUuid: target.tokenUuid || tokenRef.tokenUuid,
    actorId: target.actor?.id || target.actorId || tokenRef.actorId || null,
    actorUuid: target.actor?.uuid || tokenRef.actorUuid || null,
    actorName: target.actor?.name || tokenRef.actorName || null,
    targetName: String(target.targetName || target.token?.name || target.tokenDocument?.name || target.actor?.name || "").trim() || "Target"
  };
}

function serializeLocationRoll(locationRoll) {
  if (!locationRoll || typeof locationRoll !== "object") return null;
  const keys = [
    "rawText", "location", "locationDisplay", "isAP", "originalIsAP", "bySkill", "byMagnetism",
    "magnetismGrade", "domeMagnetismGrade", "byAoe", "byWeaponBlock", "byShieldBlock", "byMageBlock"
  ];
  const serialized = Object.fromEntries(keys
    .filter((key) => Object.hasOwn(locationRoll, key))
    .map((key) => [key, cloneData(locationRoll[key])]));
  const locationMessageId = String(locationRoll.locationMessageId || locationRoll.chatMessage?.id || "").trim();
  if (locationMessageId) serialized.locationMessageId = locationMessageId;
  return serialized;
}

function hydrateLocationRoll(locationRoll) {
  if (!locationRoll || typeof locationRoll !== "object") return null;
  const hydrated = cloneData(locationRoll);
  const messageId = String(hydrated.locationMessageId || "").trim();
  if (messageId) hydrated.chatMessage = game.messages?.get(messageId) || null;
  return hydrated;
}

function serializeArmorChargeResolution(resolution) {
  if (!resolution || typeof resolution !== "object") return null;
  return {
    handled: !!resolution.handled,
    useArmorCharge: !!resolution.useArmorCharge,
    appliedDamageType: resolution.appliedDamageType || null,
    armorGrade: String(resolution.armorGrade || "").trim(),
    preventByLuckPenetration: !!resolution.preventByLuckPenetration,
    bySkillPenetrationMosAdjustment: Math.max(0, Number(resolution.bySkillPenetrationMosAdjustment) || 0),
    armorChargeUnavailable: !!resolution.armorChargeUnavailable
  };
}

function serializeShieldBlockReplayChoice(application) {
  if (application?.shieldBlock !== true || typeof application.braced !== "boolean") return {};
  return { shieldBlockReplayChoice: application.braced ? "braced" : "normal" };
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
      locationRoll: serializeLocationRoll(targetRoll?.locationRoll || targetRoll?.incomingHitResolution?.locationRoll),
      armorChargeResolution: serializeArmorChargeResolution(targetRoll?.incomingHitResolution?.resolution),
      ...serializeShieldBlockReplayChoice(targetRoll?.incomingHitResolution?.application),
      reflexSaveResult: serializeReflexSaveResult(targetRoll?.incomingHitResolution?.reflexSaveResult || targetRoll?.defensePromptResult?.reflexSaveResult),
      defensePromptResult: serializeDefensePromptResult(targetRoll?.defensePromptResult || null)
    })).filter((entry) => entry.targetRef);
  }

  return rollOutcome?.targetRef ? [{
    targetRef: cloneData(rollOutcome.targetRef),
    targetLabel: rollOutcome?.targetName || rollOutcome?.targetLabel || "",
    locationRoll: serializeLocationRoll(rollOutcome?.locationRoll || rollOutcome?.incomingHitResolution?.locationRoll),
    armorChargeResolution: serializeArmorChargeResolution(rollOutcome?.resolution || rollOutcome?.incomingHitResolution?.resolution),
    ...serializeShieldBlockReplayChoice(rollOutcome?.incomingHitResolution?.application),
    reflexSaveResult: serializeReflexSaveResult(rollOutcome?.incomingHitResolution?.reflexSaveResult || rollOutcome?.defensePromptResult?.reflexSaveResult || rollOutcome?.defensePromptSummary?.promptResults?.[0]?.result?.reflexSaveResult),
    defensePromptResult: serializeDefensePromptResult(rollOutcome?.defensePromptResult || rollOutcome?.defensePromptSummary?.promptResults?.[0]?.result || null)
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
  manifestRollTypes = [],
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
    manifestRollTypes: Array.from(manifestRollTypes || []),
    resolvedDamageType: resolvedDamageType || null,
    ...(rollOutcome?.usageContext?.version === 1 ? { usageContext: cloneData(rollOutcome.usageContext) } : {}),
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

function getDefensePromptTargetRef(promptEntry) {
  return promptEntry?.targetRef || {
    targetName: promptEntry?.targetName || null,
    tokenId: promptEntry?.targetTokenId || null,
    actorId: promptEntry?.targetActorId || null
  };
}

async function attachEdgeExplodeCheckpointToRollResult(rollResult, {
  checkpoint = null,
  preRollRecords = [],
  postRollRecords = []
} = {}) {
  const message = getChatMessageDocument(rollResult?.chatMessage);
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
  manifestRollTypes = [],
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
    manifestRollTypes,
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
      manifestRollTypes,
      resolvedDamageType,
      rollOutcome,
      defenseTargetRef: getDefensePromptTargetRef(promptEntry)
    });
    await attachEdgeExplodeCheckpointToRollResult(
      defenseRoll?.sharedAttackRoll?.rollResult || defenseRoll?.rollResult,
      { checkpoint: defenseCheckpoint, preRollRecords, postRollRecords }
    );
  }
}

async function updateEdgeIndividualCheckpoint(candidate, checkpoint, { rollKey = "", chainId = "" } = {}) {
  const message = getChatMessageDocument(candidate);
  const flag = message?.getFlag?.("peasant-core", "edgeIndividualDie");
  if (!flag || !message?.setFlag) return null;
  const nextFlag = {
    ...flag,
    chainId: String(chainId || flag.chainId || checkpoint?.chainId || "").trim(),
    checkpoint: cloneData(checkpoint),
    rollKey: String(rollKey || flag.rollKey || "").trim()
  };
  await message.setFlag("peasant-core", "edgeIndividualDie", nextFlag);
  return nextFlag;
}

export async function attachNotableCombatEdgeIndividualDieCheckpoints(rollOutcome, {
  actor = null,
  combat = null,
  combatIndex = null,
  attackerToken = null,
  targetingType = "",
  isHealRoll = false,
  manifestRollTypes = [],
  resolvedDamageType = null,
  preRollRecords = [],
  postRollRecords = [],
  edgeChainContext = null,
  replayCheckpoint = null
} = {}) {
  const chainId = String(
    edgeChainContext?.chainId
    || rollOutcome?.rollResult?.chatMessage?.getFlag?.("peasant-core", "edgeIndividualDie")?.chainId
    || ""
  ).trim();
  const baseCheckpoint = createNotableCombatPostRollCheckpoint({
    stage: "attack",
    actor,
    combat,
    combatIndex,
    attackerToken,
    targetingType,
    isHealRoll,
    manifestRollTypes,
    resolvedDamageType,
    rollOutcome
  });
  baseCheckpoint.chainId = chainId;
  if (replayCheckpoint?.stage === "save") {
    baseCheckpoint.targets = replayCheckpoint.targets.map(entry => (
      baseCheckpoint.targets.find(updated => matchesSaveTarget(entry.targetRef, updated.targetRef)) || cloneData(entry)
    ));
  }
  await updateEdgeIndividualCheckpoint(
    rollOutcome?.sharedAttackRoll?.rollResult?.chatMessage
      || rollOutcome?.preDefenseRollResult?.chatMessage
      || rollOutcome?.rollResult?.chatMessage,
    baseCheckpoint,
    { chainId }
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
      manifestRollTypes,
      resolvedDamageType,
      rollOutcome,
      defenseTargetRef: getDefensePromptTargetRef(promptEntry)
    });
    defenseCheckpoint.chainId = chainId;
    await updateEdgeIndividualCheckpoint(
      defenseRoll?.sharedAttackRoll?.rollResult?.chatMessage || defenseRoll?.rollResult?.chatMessage,
      defenseCheckpoint,
      { chainId }
    );
  }

  const targetEntries = rollOutcome?.multiTarget ? (rollOutcome.targetRolls || []) : [rollOutcome];
  for (const entry of targetEntries) {
    const targetRef = cloneData(entry?.targetRef || null);
    const save = entry?.incomingHitResolution?.reflexSaveResult
      || entry?.defensePromptResult?.reflexSaveResult
      || entry?.defensePromptSummary?.promptResults?.[0]?.result?.reflexSaveResult;
    if (save?.rollResult?.chatMessage) {
      const postMessages = [];
      addIncomingResolutionChatMessages(postMessages, entry?.incomingHitResolution);
      await updateEdgeIndividualCheckpoint(save.rollResult.chatMessage, {
        ...cloneData(baseCheckpoint),
        stage: "save",
        saveTargetRef: targetRef,
        savePostMessageIds: postMessages.filter(message => message.id !== save.rollResult.chatMessage.id).map(message => message.id),
        savePostRollRecords: collectRollUndoRecords(entry?.incomingHitResolution?.application?.undoRecords)
      }, { chainId });
    }
    for (const [kind, valueRoll] of [
      ["damage", entry?.incomingHitResolution?.damageRoll],
      ["heal", entry?.incomingHealResolution?.healRoll]
    ]) {
      if (!valueRoll?.chatMessage || !valueRoll?.allDice?.length) continue;
      const rollKey = createEdgeIndividualValueRollKey(kind, { targetRef });
      const checkpoint = {
        ...cloneData(baseCheckpoint),
        stage: "value",
        valueKind: kind,
        valueTargetRef: targetRef,
        rollKey
      };
      await attachEdgeIndividualDieToChatMessage(valueRoll.chatMessage, valueRoll, {
        kind,
        label: combat?.name || rollOutcome?.combatName || "Combat",
        diceFaces: valueRoll.diceValue,
        naturalDiceCount: valueRoll.diceCount,
        useStability: valueRoll.allDice.length > valueRoll.diceCount,
        useStrengthen: valueRoll.allDice.length > valueRoll.diceCount && !!combat?.strengthen,
        flat: valueRoll.flat,
        checkpoint,
        rollKey,
        chainId
      });
    }
  }

  for (const manifestRoll of rollOutcome?.manifestRolls || []) {
    if (!manifestRoll?.chatMessage || !manifestRoll?.allDice?.length) continue;
    const rollType = String(manifestRoll.rollType || "manifest").trim() || "manifest";
    const rollKey = createEdgeIndividualValueRollKey("manifest", {
      rollType,
      actorRef: createActorRef(actor),
      combatIndex
    });
    const checkpoint = {
      ...cloneData(baseCheckpoint),
      stage: "value",
      valueKind: "manifest",
      valueRollType: rollType,
      rollKey
    };
    await updateEdgeIndividualCheckpoint(manifestRoll.chatMessage, checkpoint, { rollKey, chainId });
  }
  return baseCheckpoint;
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
    tokenUuid: tokenDocument?.uuid || ref?.tokenUuid || null,
    actorId: actor.id || ref?.actorId || null,
    targetName: String(ref?.targetName || token?.name || tokenDocument?.name || actor.name || "").trim() || "Target"
  };
}

function refsMatch(left, right) {
  if (!left || !right) return false;
  const leftTokenUuid = String(left.tokenUuid || "").trim();
  const rightTokenUuid = String(right.tokenUuid || "").trim();
  if (leftTokenUuid && rightTokenUuid) return leftTokenUuid === rightTokenUuid;

  const leftTokenId = String(left.tokenId || "").trim();
  const rightTokenId = String(right.tokenId || "").trim();
  const leftSceneId = String(left.sceneId || "").trim();
  const rightSceneId = String(right.sceneId || "").trim();
  if (leftTokenId && rightTokenId) {
    return leftTokenId === rightTokenId && (!leftSceneId || !rightSceneId || leftSceneId === rightSceneId);
  }

  const leftActorUuid = String(left.actorUuid || "").trim();
  const rightActorUuid = String(right.actorUuid || "").trim();
  if (leftActorUuid && rightActorUuid) return leftActorUuid === rightActorUuid;

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
  if (checkpoint?.usageContext?.version === 1) {
    const collection = String(checkpoint.usageContext.ref?.collection || "").trim();
    const entries = ["skills", "notableCombats"].includes(collection) && Array.isArray(actor?.system?.[collection])
      ? actor.system[collection]
      : [];
    const entryId = String(checkpoint.usageContext.ref?.entryId || "").trim();
    const combatIndex = entries.findIndex((entry) => String(entry?.id || "").trim() === entryId);
    if (combatIndex < 0) return { combat: null, combatIndex: -1 };
    const usageId = String(checkpoint.usageContext.ref?.usageId || "base").trim() || "base";
    const usageExists = usageId === "base"
      || entries[combatIndex]?.usages?.some((usage) => String(usage?.id || "").trim() === usageId);
    return usageExists
      ? { combat: cloneData(checkpoint.usageContext.data), combatIndex }
      : { combat: null, combatIndex: -1 };
  }
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

function matchesSaveTarget(left, right) {
  return !!left && !!right
    && createEdgeIndividualValueRollKey("save", { targetRef: left }) === createEdgeIndividualValueRollKey("save", { targetRef: right });
}

function updateReplayDefensePromptResult(entry, checkpoint, replacementDefenseRollResult) {
  const promptResult = hydrateDefensePromptResult(entry?.defensePromptResult || null);
  if (promptResult && checkpoint?.stage === "save" && matchesSaveTarget(entry?.targetRef, checkpoint?.saveTargetRef)) {
    promptResult.reflexSaveResult = {
      toHit: replacementDefenseRollResult.toHit,
      passed: !!replacementDefenseRollResult.isSuccess,
      rollResult: replacementDefenseRollResult
    };
    return promptResult;
  }
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

export function createNotableCombatDefenseReplayCheckpoint(checkpoint, rollResult) {
  const next = cloneData(checkpoint);
  next.targets = (next.targets || []).map(entry => ({
    ...entry,
    defensePromptResult: serializeDefensePromptResult(updateReplayDefensePromptResult(entry, checkpoint, rollResult))
  }));
  return next;
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

function getLocationChoiceSignature(mos, armorChargeResolution = null) {
  const armorCharge = armorChargeResolution?.useArmorCharge
    ? { grade: armorChargeResolution.armorGrade }
    : null;
  return getLocationBySkillOptions(mos, { armorCharge })
    .map((option) => String(option?.key || "").trim())
    .filter(Boolean);
}

function getLocationModeSignature(locationRoll, {
  mos = 0,
  armorChargeResolution = null,
  magnetismGrade = 0,
  useStoredMode = false
} = {}) {
  if (!locationRoll) return "missing";
  if (locationRoll.bySkill) {
    const rawText = String(locationRoll.rawText || "").trim();
    const location = String(locationRoll.location || "").trim();
    const isAP = !!locationRoll.isAP || /(?:armor\s*pen|head\s*pen)/i.test(rawText);
    const armorCharge = armorChargeResolution?.useArmorCharge
      ? { grade: armorChargeResolution.armorGrade }
      : null;
    const selectedKey = getLocationBySkillOptions(6, { armorCharge })
      .find((option) => option.location === location && !!option.isAP === isAP)?.key || "unknown";
    const availableChoices = new Set(getLocationChoiceSignature(mos, armorChargeResolution));
    return `by-skill:${selectedKey}:${availableChoices.has(selectedKey) ? "available" : "unavailable"}`;
  }
  if (locationRoll.byAoe || locationRoll.byWeaponBlock || locationRoll.byShieldBlock || locationRoll.byMageBlock) {
    return "non-location";
  }
  const magnetized = useStoredMode
    ? locationRoll.byMagnetism === true
    : Number(magnetismGrade) > 0 || Number(locationRoll.domeMagnetismGrade) > 0;
  return `by-luck:${magnetized ? "torso" : "table"}`;
}

function getAttackDownstreamSignature(combat, attackRoll, defensePromptResult, {
  isHealRoll = false,
  manifestRollTypes = [],
  locationRoll = null,
  armorChargeResolution = null,
  useStoredLocationMode = false
} = {}) {
  const rollResult = attackRoll?.rollResult || null;
  if (isHealRoll) return `heal:${rollResult?.isSuccess ? "success" : "failure"}`;
  if (manifestRollTypes.length) return `manifest:${rollResult?.isSuccess ? "success" : "failure"}`;

  const targetingKey = getCombatDefenseResponseKey(getCombatTargetingType(combat));
  const mageBlockRedirect = isMageDefenseDamageRedirect(defensePromptResult);
  const shieldBlockFailure = isShieldDefenseDamageBlock(attackRoll, defensePromptResult);
  const weaponBlockFailure = isWeaponDefenseDamageBlock(attackRoll, defensePromptResult);
  const narrowSuccessWithoutDefense = isNarrowSuccessAttack(attackRoll)
    && !doesPromptResultCountAsActiveDefense(defensePromptResult);
  const canApplyDamage = !!(
    rollResult?.isSuccess
    || narrowSuccessWithoutDefense
    || mageBlockRedirect
    || shieldBlockFailure
    || weaponBlockFailure
  );
  if (!canApplyDamage) return "damage:none";

  const attackScale = isSkillTagAutoEligible(combat, "tippingScales", {
    success: rollResult?.isSuccess === true,
    hit: rollResult?.isSuccess === true
  }) ? Number(combat.tippingScales) || 0 : 0;
  const damageSignature = `damage:scale:${attackScale}`;
  if (shieldBlockFailure) return `${damageSignature}:shield-block`;
  if (mageBlockRedirect) return `${damageSignature}:mage-block`;
  if (["aoe", "areaBlast", "tileBlast"].includes(targetingKey)) {
    return `${damageSignature}:${targetingKey}:success:${rollResult?.isSuccess ? "1" : "0"}`;
  }

  const magnetismGrade = getWeaponMasteryMagnetismGrade(combat, defensePromptResult);
  const locationMode = getLocationModeSignature(locationRoll, {
    mos: Number(rollResult?.totalMoS) || 0,
    armorChargeResolution,
    magnetismGrade,
    useStoredMode: useStoredLocationMode
  });
  const route = weaponBlockFailure ? "weapon-block" : "normal";
  return [
    damageSignature,
    route,
    rollResult?.isSuccess ? "success" : "failure",
    String(rollResult?.resultText || "").trim(),
    locationMode
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
  const offerTargets = [];
  let attackRollResult = newBaseAttackRollResult;
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
    if (!checkpoint.multiTarget) attackRollResult = newAttackRoll.rollResult;
    const actorUuid = entry?.targetRef?.actorUuid || null;
    offerTargets.push({
      actorUuid,
      success: newAttackRoll.rollResult?.isSuccess,
      hit: checkpoint.isHealRoll !== true && newAttackRoll.rollResult?.isSuccess === true
    });
    const oldSignature = getAttackDownstreamSignature(combat, oldAttackRoll, oldEntry.defensePromptResult, {
      isHealRoll: checkpoint.isHealRoll,
      manifestRollTypes: checkpoint.manifestRollTypes,
      locationRoll: oldEntry.locationRoll,
      armorChargeResolution: oldEntry.armorChargeResolution,
      useStoredLocationMode: true
    });
    const newSignature = getAttackDownstreamSignature(combat, newAttackRoll, newEntry.defensePromptResult, {
      isHealRoll: checkpoint.isHealRoll,
      manifestRollTypes: checkpoint.manifestRollTypes,
      locationRoll: newEntry.locationRoll,
      armorChargeResolution: newEntry.armorChargeResolution
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
    reason: "same-downstream-options",
    attackRollResult,
    offerTargets
  };
}

async function captureReplayTargetFailure(target, operation, onSaveReplayProgress) {
  if (!onSaveReplayProgress || !target?.actor) return operation();
  let replayError = null;
  const captured = await captureActorRollUndo(target.actor, "Combat Replay", async () => {
    try { return await operation(); }
    catch (error) { replayError = error; return null; }
  }, { includeSpellEffects: true, includeSkillEffects: true });
  if (replayError) {
    onSaveReplayProgress({ application: { undoRecords: captured.undoRecords } });
    throw replayError;
  }
  return captured.result;
}

export async function replayNotableCombatPostRollEffects({
  checkpoint = null,
  rollResult = null,
  edgeIndividualDieReplay = null,
  onSaveReplayProgress = null
} = {}) {
  if (!checkpoint || checkpoint.version !== 2 || checkpoint.type !== "notableCombatPostRoll") {
    return { ok: false, error: "Edge Explode checkpoint was unavailable." };
  }

  const actor = await resolveActorRef(checkpoint.actor);
  if (!actor) return { ok: false, error: "The original roll actor was not found." };

  const { combat, combatIndex } = getReplayCombat(actor, checkpoint);
  if (!combat) return { ok: false, error: "The original combat entry was not found." };
  const combatMods = checkpoint.usageContext?.version === 1
    ? cloneData(checkpoint.usageContext.modifiers || {})
    : null;

  const attackerTokenDocument = await resolveTokenRef(checkpoint.attackerToken);
  const attackerToken = attackerTokenDocument?.object || attackerTokenDocument || null;
  const attackMessage = checkpoint.attackMessageId ? game.messages?.get(checkpoint.attackMessageId) || null : null;
  const baseAttackRollResult = checkpoint.stage === "attack"
    ? rollResult
    : hydrateRollResult(checkpoint.attackRollResult, attackMessage);
  if (!baseAttackRollResult) return { ok: false, error: "The original attack roll checkpoint was incomplete." };

  const targetEntries = [];
  for (const entry of checkpoint.targets || []) {
    if (checkpoint.stage === "save" && !matchesSaveTarget(entry.targetRef, checkpoint.saveTargetRef)) continue;
    const target = await resolveTargetRef(entry?.targetRef);
    if (!target) {
      return { ok: false, error: `Could not find ${entry?.targetRef?.targetName || entry?.targetLabel || "a target"}.` };
    }
    targetEntries.push({
      ...cloneData(entry),
      target,
      locationRoll: hydrateLocationRoll(entry.locationRoll),
      reflexSaveResult: checkpoint.stage === "save" && matchesSaveTarget(entry.targetRef, checkpoint.saveTargetRef)
        ? { toHit: rollResult.toHit, passed: !!rollResult.isSuccess, rollResult }
        : hydrateReflexSaveResult(entry.reflexSaveResult),
      defensePromptResult: updateReplayDefensePromptResult(entry, checkpoint, rollResult)
    });
  }
  const manifestRollTypes = Array.from(checkpoint.manifestRollTypes || [])
    .filter((rollType) => MANIFEST_SPELL_ROLL_TYPES.includes(rollType) && hasCombatDice(combat?.[rollType]));
  const isManifestSpellRoll = manifestRollTypes.length > 0;

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
        incomingHealResolution = await captureReplayTargetFailure(entry.target, () => resolveSuccessfulHealForTarget({
          actor,
          attackerToken,
          combat,
          target: entry.target,
          attackRoll: targetAttackRoll,
          edgeIndividualDieReplay,
          combatMods,
          onSaveReplayProgress
        }), onSaveReplayProgress);
        onSaveReplayProgress?.(incomingHealResolution);
      } else if (!isManifestSpellRoll) {
        incomingHitResolution = await captureReplayTargetFailure(entry.target, () => resolveSuccessfulAttackDamageForTarget({
          actor,
          attackerToken,
          combat,
          target: entry.target,
          attackRoll: targetAttackRoll,
          preDefenseRollResult: baseAttackRollResult,
          defensePromptResult: entry.defensePromptResult,
          appliedDamageType: checkpoint.resolvedDamageType || null,
          reflexSaveOverride: entry.reflexSaveResult,
          onSaveReplayProgress,
          edgeIndividualDieReplay,
          combatMods,
          replayArmorChargeResolution: entry.armorChargeResolution || null,
          replayLocationRoll: entry.locationRoll || null,
          replayShieldBlockChoice: entry.shieldBlockReplayChoice || null
        }), onSaveReplayProgress);
        onSaveReplayProgress?.(incomingHitResolution);
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
      incomingHealResolution = await captureReplayTargetFailure(entry.target, () => resolveSuccessfulHealForTarget({
        actor,
        attackerToken,
        combat,
        target: entry.target,
        attackRoll: singleRoll,
        edgeIndividualDieReplay,
        combatMods,
        onSaveReplayProgress
      }), onSaveReplayProgress);
      onSaveReplayProgress?.(incomingHealResolution);
    } else if (!isManifestSpellRoll) {
      incomingHitResolution = await captureReplayTargetFailure(entry.target, () => resolveSuccessfulAttackDamageForTarget({
        actor,
        attackerToken,
        combat,
        target: entry.target,
        attackRoll: singleRoll,
        preDefenseRollResult: baseAttackRollResult,
        defensePromptResult: entry.defensePromptResult,
        appliedDamageType: checkpoint.resolvedDamageType || null,
        reflexSaveOverride: entry.reflexSaveResult,
        onSaveReplayProgress,
        edgeIndividualDieReplay,
        combatMods,
        replayArmorChargeResolution: entry.armorChargeResolution || null,
        replayLocationRoll: entry.locationRoll || null,
        replayShieldBlockChoice: entry.shieldBlockReplayChoice || null
      }), onSaveReplayProgress);
      onSaveReplayProgress?.(incomingHitResolution);
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
      preDefenseRollResult: baseAttackRollResult,
      actorId: actor.id,
      combatIndex,
      combatName: combat.name || checkpoint.combatName || "Combat",
      multiTarget: false,
      incomingHitResolution,
      incomingHealResolution
    };

  if (isManifestSpellRoll) {
    const activeTargets = targetEntries.map((entry) => entry.target).filter(Boolean);
    const successfulActorKeys = getSuccessfulManifestActorKeys(activeTargets, replayOutcome);
    const manifestPreflights = manifestRollTypes.map((rollType) => (
      isSkillTagAutoEligible(combat, rollType, { success: true, hit: true })
        ? filterManifestPreflight(buildManifestSpellCastPreflight({ caster: actor, targets: activeTargets, rollType }), successfulActorKeys)
        : { ok: true, recipients: [], replacements: [] }
    ));
    const successfulPreflights = manifestPreflights.filter((preflight) => preflight?.recipients?.length);
    if (successfulPreflights.some((preflight) => !preflight?.ok)) {
      return { ok: false, error: "Manifest spell replacement was unavailable." };
    }
    replayOutcome.manifestRolls = await rollManifestSpellsForOutcome({
      actor,
      combat,
      combatIndex,
      manifestRollTypes,
      manifestPreflights,
      activeTargets,
      rollOutcome: replayOutcome,
      edgeIndividualDieReplay,
      usageContext: checkpoint.usageContext
    });
  }

  const postRollRecords = collectRollOutcomePostRollUndoRecords(replayOutcome);
  const replayCheckpoint = await attachNotableCombatEdgeIndividualDieCheckpoints(replayOutcome, {
    actor,
    combat,
    combatIndex,
    attackerToken,
    targetingType: checkpoint.targetingType,
    isHealRoll: checkpoint.isHealRoll,
    manifestRollTypes,
    resolvedDamageType: checkpoint.resolvedDamageType,
    postRollRecords,
    edgeChainContext: { chainId: checkpoint.chainId },
    replayCheckpoint: checkpoint
  });
  return {
    ok: true,
    rollOutcome: replayOutcome,
    checkpoint: replayCheckpoint,
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

async function finalizeNotableCombatRollMetadata(rollOutcome, {
  actor,
  combat,
  combatIndex,
  sheet,
  attackerToken,
  targetingType,
  isHealRoll,
  manifestRollTypes,
  resolvedDamageType,
  resourceCostUndoRecords,
  edgeChainContext,
  usageContext = null
} = {}) {
  const rollUse = await captureActorRollUndo(
    actor,
    `${combat.name || "Combat"} Use`,
    () => consumeNotableCombatRollUse(actor, combatIndex, sheet, usageContext),
    { entryCounterRefs: usageContext?.version === 1 ? [usageContext.ref] : [] }
  );
  rollOutcome.rollUseResult = rollUse.result;
  if (usageContext?.version === 1) rollOutcome.usageContext = cloneData(usageContext);

  const preRollRecords = collectRollUndoRecords(
    resourceCostUndoRecords,
    collectDefensePromptUndoRecords(rollOutcome?.defensePromptSummary),
    ...collectRollOutcomeChatMessages(rollOutcome)
      .filter(message => message.getFlag?.("peasant-core", "edgeIndividualDie")?.kind === "save")
      .map(message => message.getFlag?.("peasant-core", "rollUndo")?.records),
    rollUse.undoRecords
  );
  const postRollRecords = collectRollOutcomePostRollUndoRecords(rollOutcome);
  const undoRecords = collectRollUndoRecords(preRollRecords, postRollRecords);
  rollOutcome.undoRecords = undoRecords;
  rollOutcome.preRollRecords = preRollRecords;
  rollOutcome.postRollRecords = postRollRecords;
  await attachRollUndoToChatMessage(getRollOutcomeChatMessage(rollOutcome), undoRecords, {
    label: `Undo ${combat.name || "Combat"} Roll Effects`
  });
  await attachNotableCombatEdgeExplodeCheckpoints(rollOutcome, {
    actor,
    combat,
    combatIndex,
    attackerToken,
    targetingType,
    isHealRoll,
    manifestRollTypes,
    resolvedDamageType,
    preRollRecords,
    postRollRecords
  });
  await attachNotableCombatEdgeIndividualDieCheckpoints(rollOutcome, {
    actor,
    combat,
    combatIndex,
    attackerToken,
    targetingType,
    isHealRoll,
    manifestRollTypes,
    resolvedDamageType,
    preRollRecords,
    postRollRecords,
    edgeChainContext
  });
  await attachEdgeChainToChatMessages(
    collectRollOutcomeChatMessages(rollOutcome),
    edgeChainContext,
    undoRecords,
    {
      ...getRollOutcomeCriticalEdgeBlock(rollOutcome),
      preRollRecords,
      postRollRecords
    }
  );
  if (usageContext?.version === 1 && rollOutcome.rolled && !rollOutcome.chainCancelled) {
    const message = getRollOutcomeChatMessage(rollOutcome);
    const rolls = rollOutcome.multiTarget ? rollOutcome.targetRolls || [] : [rollOutcome];
    const targets = rolls.map(roll => ({
      actorUuid: roll.targetRef?.actorUuid || null,
      success: roll.rollResult?.isSuccess,
      hit: !isHealRoll && roll.rollResult?.isSuccess === true
    }));
    if (message) {
      try {
        await offerSkillEntryEffects({ actor, usageContext, message, targets });
      } catch (error) {
        pcLog.debug("Peasant Core | Could not attach Notable effect offers", error);
      }
    }
  }
  return rollOutcome;
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
  edgeExplodeReroll = null,
  usageContext = null,
  skipResourceCosts = false,
  mageBarrierAction = null,
  onSaveReplayProgress = null
} = {}) {
  let rollOutcome = null;
  let resourceCostUndoRecords = [];
  try {
    if (!actor) return false;

    const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
    const combat = usageContext?.version === 1 ? cloneData(usageContext.data) : combats[combatIndex] || null;
    if (!combat) return false;
    const targetingError = rejectDamageWithoutTargeting(combat);
    if (targetingError) return targetingError;
    const combatDefense = normalizeCombatDefense(combat.defense);
    const isMageBlockRoll = !!(combatDefense.block && combatDefense.blockType === "Mage");
    if (!edgeChainContext && usageContext?.version !== 1) await ensureNotableCombatEdgeChainIdentity(actor, combatIndex);
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
      rollMode,
      usageContext
    });
    const resolvedEdgeChainContext = withNotableCombatRerunAdjustments(baseEdgeChainContext, { toHitAdj, accuracyAdj });
    const paidDefense = baseEdgeChainContext.rerun?.fallDefenseAccuracy;
    const fallDefenseAccuracy = String(cardClass).split(/\s+/).includes("pc-defense-roll-card")
      && paidDefense?.actorUuid === actor.uuid
      && paidDefense.entryId
      && paidDefense.entryId === (usageContext?.ref?.entryId || combat.id)
      && paidDefense.usageId === (usageContext?.ref?.usageId || "base")
      ? (Number(paidDefense.accuracyBonus) || 0)
      : 0;
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
    const manifestRollTypes = requestedHealRoll ? [] : getManifestSpellRollTypes(combat);
    const isManifestSpellRoll = manifestRollTypes.length > 0;
    const isHealRoll = !isManifestSpellRoll && hasHealRoll && (requestedHealRoll || !hasDamageRoll);
    const manifestPreflights = manifestRollTypes.map((rollType) => (
      isSkillTagAutoEligible(combat, rollType, { success: true, hit: true })
        ? buildManifestSpellCastPreflight({ caster: actor, targets: activeTargets, rollType })
        : { ok: true, recipients: [], replacements: [] }
    ));
    if (
      isManifestSpellRoll
      && (
        manifestPreflights.some((preflight) => !preflight?.ok)
        || !(await confirmManifestSpellReplacements(...manifestPreflights))
      )
    ) {
      return {
        rolled: false,
        actorId: actor.id,
        combatIndex,
        combatName: combat.name || "Combat",
        chainCancelled: true,
        manifestPreflightCancelled: true
      };
    }
    let resolvedDamageType = normalizeAppliedDamageType(selectedDamageType, "");
    if (!isHealRoll && !isManifestSpellRoll && !resolvedDamageType) {
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

    for (const entry of defensePromptSummary?.promptResults || []) {
      onSaveReplayProgress?.({ rollResult: entry.result?.defenseRoll?.rollResult,
        application: { undoRecords: entry.result?.defenseRoll?.undoRecords } });
    }
    const combatMods = usageContext?.version === 1
      ? cloneData(usageContext.modifiers || {})
      : getEffectiveSkillCombatModifiers(actor);
    const usageCombatMods = usageContext?.version === 1 ? combatMods : null;
    const costModifiersByType = getCombatCostModifiers(combatMods);
    const paysMageBlockResourceCost = !isMageBlockRoll
      || ["create", "refresh"].includes(String(mageBarrierAction || "").trim().toLowerCase());

    if (!skipResourceCosts && paysMageBlockResourceCost && typeof actor.applyPeasantCombatResourceCosts === "function") {
      const resourceCosts = await captureActorRollUndo(
        actor,
        `${combat.name || "Combat"} Resource Costs`,
        () => actor.applyPeasantCombatResourceCosts(combat, costModifiersByType)
      );
      resourceCostUndoRecords = resourceCosts.undoRecords;
      onSaveReplayProgress?.({ application: { undoRecords: resourceCostUndoRecords } });
    }

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
        edgeExplodeReroll,
        combatMods
      });
      onSaveReplayProgress?.({ rollResult: sharedAttackRoll?.rollResult,
        application: { undoRecords: collectRollUndoRecords(sharedAttackRoll?.forcePassResult) } });
      if (isChainCancelledResult(sharedAttackRoll)) {
        const promptResultByTokenId = new Map(
          (defensePromptSummary?.promptResults || [])
            .map((entry) => [String(entry?.targetTokenId || ""), entry])
            .filter(([tokenId]) => !!tokenId)
        );
        const cancelledOutcome = {
          rolled: false,
          actorId: actor.id,
          combatIndex,
          combatName: combat.name || "Combat",
          multiTarget: true,
          targetRolls: activeTargets.map(target => ({
            ...sharedAttackRoll,
            targetTokenId: target.tokenId,
            targetActorId: target.actorId,
            targetName: target.targetName,
            targetRef: createTargetRef(target),
            defensePromptResult: promptResultByTokenId.get(String(target.tokenId || ""))?.result || null
          })),
          sharedAttackRoll,
          chainCancelled: true,
          defensePromptSummary
        };
        await finalizeNotableCombatRollMetadata(cancelledOutcome, {
          actor,
          combat,
          combatIndex,
          sheet,
          attackerToken,
          targetingType,
          isHealRoll,
          manifestRollTypes,
          resolvedDamageType,
          resourceCostUndoRecords,
          edgeChainContext: resolvedEdgeChainContext,
          usageContext
        });
        return cancelledOutcome;
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
          await consumeNotableCombatRollUse(actor, combatIndex, sheet, usageContext);
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
          incomingHealResolution = await captureReplayTargetFailure(target, () => resolveSuccessfulHealForTarget({
            actor,
            attackerToken,
            combat,
            target,
            attackRoll: targetRoll,
            combatMods: usageCombatMods,
            onSaveReplayProgress
          }), onSaveReplayProgress);
          onSaveReplayProgress?.(incomingHealResolution);
        } else if (!isManifestSpellRoll) {
          incomingHitResolution = await captureReplayTargetFailure(target, () => resolveSuccessfulAttackDamageForTarget({
            actor,
            attackerToken,
            combat,
            target,
            attackRoll: targetRoll,
            preDefenseRollResult: sharedAttackRoll?.rollResult || null,
            defensePromptResult: promptEntry?.result || null,
            appliedDamageType: resolvedDamageType || null,
            combatMods: usageCombatMods,
            onSaveReplayProgress
          }), onSaveReplayProgress);
          onSaveReplayProgress?.(incomingHitResolution);
          if (isChainCancelledResult(incomingHitResolution)) {
            await consumeNotableCombatRollUse(actor, combatIndex, sheet, usageContext);
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
        accuracyAdj: accuracyAdj + fallDefenseAccuracy,
        rollOverrides,
        defenseAccuracyPenalty: 0,
        defenseToHitPenalty: 0,
        targetLabel: resolvedTargetLabel,
        cardClass,
        edgeChainContext: resolvedEdgeChainContext,
        edgeExplodeReroll,
        combatMods
      });
      onSaveReplayProgress?.({ rollResult: singleRoll?.rollResult,
        application: { undoRecords: collectRollUndoRecords(singleRoll?.forcePassResult) } });
      if (isChainCancelledResult(singleRoll)) {
        const cancelledOutcome = {
          ...singleRoll,
          multiTarget: false,
          defensePromptSummary,
          targetTokenId: target?.tokenId || null,
          targetActorId: target?.actorId || null,
          targetName: target?.targetName || null,
          targetRef: createTargetRef(target),
          defensePromptResult,
          chainCancelled: true
        };
        await finalizeNotableCombatRollMetadata(cancelledOutcome, {
          actor,
          combat,
          combatIndex,
          sheet,
          attackerToken,
          targetingType,
          isHealRoll,
          manifestRollTypes,
          resolvedDamageType,
          resourceCostUndoRecords,
          edgeChainContext: resolvedEdgeChainContext,
          usageContext
        });
        return cancelledOutcome;
      }
      if (mageBarrierAction && isMageBlockRoll && typeof actor.applyPeasantMageBlockBarrierAction === "function") {
        const barrierAction = await captureActorRollUndo(
          actor,
          `${combat.name || "Mage Block"} Barrier`,
          () => actor.applyPeasantMageBlockBarrierAction({
            action: mageBarrierAction,
            selectedCombatId: combat.id || null,
            selectedCombatIndex: combatIndex,
            selectedUsageId: usageContext?.ref?.usageId || "base"
          }),
          { includeSpellEffects: true }
        );
        if (!barrierAction.result?.ok) {
          const refunded = await applyRollUndoRecords(resourceCostUndoRecords);
          if (!refunded.ok) throw new Error(refunded.error || "Could not refund failed Mage barrier resource costs.");
          return {
            ...singleRoll,
            rolled: false,
            chainCancelled: true,
            mageBarrierActionResult: barrierAction.result
          };
        }
        resourceCostUndoRecords = collectRollUndoRecords(resourceCostUndoRecords, barrierAction.undoRecords);
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
        incomingHealResolution = await captureReplayTargetFailure(target, () => resolveSuccessfulHealForTarget({
          actor,
          attackerToken,
          combat,
          target,
          attackRoll: singleRoll,
          combatMods: usageCombatMods,
          onSaveReplayProgress
        }), onSaveReplayProgress);
        onSaveReplayProgress?.(incomingHealResolution);
      } else if (!isManifestSpellRoll) {
        incomingHitResolution = await captureReplayTargetFailure(target, () => resolveSuccessfulAttackDamageForTarget({
          actor,
          attackerToken,
          combat,
          target,
          attackRoll: singleRoll,
          preDefenseRollResult,
          defensePromptResult,
          appliedDamageType: resolvedDamageType || null,
          combatMods: usageCombatMods,
          onSaveReplayProgress
        }), onSaveReplayProgress);
        onSaveReplayProgress?.(incomingHitResolution);
        if (isChainCancelledResult(incomingHitResolution)) {
          await consumeNotableCombatRollUse(actor, combatIndex, sheet, usageContext);
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

    if (isManifestSpellRoll) {
      rollOutcome.manifestRolls = await rollManifestSpellsForOutcome({
        actor,
        combat,
        combatIndex,
        manifestRollTypes,
        manifestPreflights,
        activeTargets,
        rollOutcome,
        edgeChainContext: resolvedEdgeChainContext,
        usageContext
      });
    }

    await finalizeNotableCombatRollMetadata(rollOutcome, {
      actor,
      combat,
      combatIndex,
      sheet,
      attackerToken,
      targetingType,
      isHealRoll,
      manifestRollTypes,
      resolvedDamageType,
      resourceCostUndoRecords,
      edgeChainContext: resolvedEdgeChainContext,
      usageContext
    });

    return rollOutcome;
  } catch (e) {
    console.error("Peasant Core | performNotableCombatRoll failed", e);
    const messages = collectRollOutcomeChatMessages(rollOutcome);
    for (const outcome of [rollOutcome, ...(rollOutcome?.targetRolls || [])]) {
      messages.push(...collectIncomingResolutionChatMessages(outcome?.incomingHitResolution),
        ...collectIncomingResolutionChatMessages(outcome?.incomingHealResolution));
    }
    return { rolled: false, error: e,
      undoRecords: collectRollOutcomeUndoRecords(rollOutcome, resourceCostUndoRecords, rollOutcome?.undoRecords),
      messageIds: messages.map(message => message.id)
    };
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
  edgeExplodeReroll = null,
  usageContext = null,
  skipResourceCosts = false,
  mageBarrierAction = null,
  onSaveReplayProgress = null
} = {}) {
  if (!actor) return false;

  const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
  const combat = usageContext?.version === 1 ? cloneData(usageContext.data) : combats[combatIndex] || null;
  if (!combat) return false;
  const targetingError = rejectDamageWithoutTargeting(combat);
  if (targetingError) return targetingError;
  if (!edgeChainContext && usageContext?.version !== 1) await ensureNotableCombatEdgeChainIdentity(actor, combatIndex);
  const resolvedEdgeChainContext = edgeChainContext || createNotableCombatEdgeChainContext({
    actor,
    combatIndex,
    promptForTargets,
    rollOverrides,
    targetLabel,
    selectedDamageType,
    cardClass,
    rollMode,
    usageContext
  });

  const hasRangeRate = hasRangeRateValue(combat.rangeRate);
  if (!hasRangeRate) {
    return await performNotableCombatRoll({ actor, combatIndex, sheet, promptForTargets, rollOverrides, targetLabel, selectedDamageType, cardClass, rollMode, edgeChainContext: resolvedEdgeChainContext, edgeExplodeReroll, usageContext, skipResourceCosts, mageBarrierAction, onSaveReplayProgress });
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
    usageContext,
    skipResourceCosts,
    mageBarrierAction,
    rollNotableCombat: options => performNotableCombatRoll({ ...options, onSaveReplayProgress })
  });
}
