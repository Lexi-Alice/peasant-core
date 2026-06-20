import {
  applyRollUndoRecords,
  attachRollUndoToChatMessage,
  canUndoRecord,
  collectRollUndoRecords,
  captureActorRollUndo,
  markRollUndoChatMessageEffectsUndone
} from "../chat-undo.mjs";
import { hasOptionalInteger, parseOptionalInteger } from "../../data/actor/helpers.mjs";
import { withPeasantActorSourceWriteContext } from "../../data/actor/source-system.mjs";
import { rollPeasantCriticalExplosion } from "../../dice/exploding.mjs";
import { applyToHitAccuracy } from "../../dice/roll-targets.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";
import { pcLog } from "../../utils/logging.mjs";
import {
  actorHasCurrentEdge,
  getActorUpdatePermissionError,
  refundActorEdge,
  resolveActorFromUuidOrId,
  resolveEdgeLocationRollSpender,
  spendActorEdge
} from "./edge-location-rolls.mjs";
import { updateSkillRollChatCardFromResult } from "./roll-chat-updates.mjs";

const PC_SYSTEM_ID = "peasant-core";
export const PC_EDGE_CHAIN_FLAG = "edgeChain";
export const PC_EDGE_EXPLODE_FLAG = "edgeExplode";

const EDGE_CHAIN_STATUS_CURRENT = "current";
const EDGE_CHAIN_STATUS_PROCESSING = "processing";
const EDGE_CHAIN_STATUS_SUPERSEDED = "superseded";
const EDGE_CHAIN_STATUS_UNDONE = "undone";
const EDGE_EXPLODE_STATUS_CURRENT = "current";
const EDGE_EXPLODE_STATUS_PROCESSING = "processing";
const EDGE_EXPLODE_STATUS_SUPERSEDED = "superseded";

const EDGE_CHAIN_STATUSES = new Set([
  EDGE_CHAIN_STATUS_CURRENT,
  EDGE_CHAIN_STATUS_PROCESSING,
  EDGE_CHAIN_STATUS_SUPERSEDED,
  EDGE_CHAIN_STATUS_UNDONE
]);

const EDGE_CHAIN_BLOCK_CRITICAL = "critical-roll";

const EDGE_EXPLODE_STATUSES = new Set([
  EDGE_EXPLODE_STATUS_CURRENT,
  EDGE_EXPLODE_STATUS_PROCESSING,
  EDGE_EXPLODE_STATUS_SUPERSEDED
]);

function cloneData(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  } catch (_) {}
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix = "edge-chain") {
  try {
    const id = foundry?.utils?.randomID?.(16);
    if (id) return `${prefix}-${id}`;
  } catch (_) {}
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeStatus(status, fallback = EDGE_CHAIN_STATUS_CURRENT) {
  const normalized = String(status || "").trim();
  return EDGE_CHAIN_STATUSES.has(normalized) ? normalized : fallback;
}

function sanitizeEdgeExplodeStatus(status, fallback = EDGE_EXPLODE_STATUS_CURRENT) {
  const normalized = String(status || "").trim();
  return EDGE_EXPLODE_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeEdgeBlockOptions(options = {}, fallbackFlag = null) {
  const edgeBlockedReason = String(options?.edgeBlockedReason || fallbackFlag?.edgeBlockedReason || "").trim();
  return {
    edgeBlockedReason,
    edgeBlockedLabel: edgeBlockedReason
      ? String(options?.edgeBlockedLabel || fallbackFlag?.edgeBlockedLabel || "").trim()
      : ""
  };
}

function getMessageFromContextElement(element) {
  const candidate = element?.currentTarget || element?.target || element?.element?.[0] || element?.element || element?.[0] || element;
  const root = candidate?.closest?.("[data-message-id]") || candidate;
  const messageId = root?.dataset?.messageId || candidate?.dataset?.messageId || "";
  return messageId ? game.messages?.get(messageId) || null : null;
}

function getAllChatMessages() {
  if (Array.isArray(game.messages?.contents)) return game.messages.contents;
  return Array.from(game.messages || [])
    .map((entry) => Array.isArray(entry) ? entry[1] : entry)
    .filter(Boolean);
}

export function getEdgeChainFlag(message) {
  return normalizeEdgeChainFlag(message?.getFlag?.(PC_SYSTEM_ID, PC_EDGE_CHAIN_FLAG));
}

export function getEdgeExplodeFlag(message) {
  return normalizeEdgeExplodeFlag(message?.getFlag?.(PC_SYSTEM_ID, PC_EDGE_EXPLODE_FLAG));
}

export function normalizeEdgeChainFlag(rawFlag) {
  if (!rawFlag || typeof rawFlag !== "object") return null;
  const rerun = (rawFlag.rerun && typeof rawFlag.rerun === "object") ? cloneData(rawFlag.rerun) : null;
  const chainId = String(rawFlag.chainId || "").trim() || createId();
  const preRollRecords = Array.isArray(rawFlag.preRollRecords) ? rawFlag.preRollRecords.filter(canUndoRecord).map(cloneData) : [];
  const postRollRecords = Array.isArray(rawFlag.postRollRecords) ? rawFlag.postRollRecords.filter(canUndoRecord).map(cloneData) : [];
  return {
    version: Number.isFinite(Number(rawFlag.version)) ? Number(rawFlag.version) : 1,
    status: sanitizeStatus(rawFlag.status),
    processing: !!rawFlag.processing,
    processingUserId: String(rawFlag.processingUserId || "").trim() || null,
    chainId,
    kind: String(rawFlag.kind || rerun?.type || "roll").trim() || "roll",
    label: String(rawFlag.label || "Roll").trim() || "Roll",
    rerun,
    undoRecords: Array.isArray(rawFlag.undoRecords) ? rawFlag.undoRecords.filter(canUndoRecord).map(cloneData) : [],
    preRollRecords,
    postRollRecords,
    createdAt: Number.isFinite(Number(rawFlag.createdAt)) ? Number(rawFlag.createdAt) : Date.now(),
    createdBy: String(rawFlag.createdBy || "").trim() || null,
    edgedAt: Number.isFinite(Number(rawFlag.edgedAt)) ? Number(rawFlag.edgedAt) : null,
    edgedBy: String(rawFlag.edgedBy || "").trim() || null,
    edgeSpentByActorUuid: String(rawFlag.edgeSpentByActorUuid || "").trim() || null,
    replacedByMessageId: String(rawFlag.replacedByMessageId || "").trim() || null,
    summaryMessageId: String(rawFlag.summaryMessageId || "").trim() || null,
    edgeBlockedReason: String(rawFlag.edgeBlockedReason || "").trim(),
    edgeBlockedLabel: String(rawFlag.edgeBlockedLabel || "").trim()
  };
}

export function getCriticalEdgeBlockFromRollResult(rollResult) {
  const criticalType = String(rollResult?.criticalType || "").trim();
  const resultText = String(rollResult?.resultText || "").trim();
  const criticalText = `${criticalType} ${resultText}`.toLowerCase();
  if (criticalText.includes("critical success")) {
    return { edgeBlockedReason: EDGE_CHAIN_BLOCK_CRITICAL, edgeBlockedLabel: "Critical Success" };
  }
  if (criticalText.includes("critical failure")) {
    return { edgeBlockedReason: EDGE_CHAIN_BLOCK_CRITICAL, edgeBlockedLabel: "Critical Failure" };
  }

  const criticalMoS = Number(rollResult?.criticalMoS);
  if (Number.isFinite(criticalMoS) && criticalMoS > 0) {
    return { edgeBlockedReason: EDGE_CHAIN_BLOCK_CRITICAL, edgeBlockedLabel: "Critical Success" };
  }
  if (Number.isFinite(criticalMoS) && criticalMoS < 0) {
    return { edgeBlockedReason: EDGE_CHAIN_BLOCK_CRITICAL, edgeBlockedLabel: "Critical Failure" };
  }

  return {};
}

function normalizeDiceArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => Number.parseInt(entry, 10)).filter((entry) => Number.isFinite(entry))
    : [];
}

function normalizeRollRef(rawRef) {
  const ref = rawRef && typeof rawRef === "object" ? rawRef : {};
  return {
    trained: ref.trained === false ? false : true,
    skillName: String(ref.skillName || "").trim(),
    cardClass: String(ref.cardClass || "").trim(),
    speakerActorId: String(ref.speakerActorId || "").trim(),
    speakerTokenId: String(ref.speakerTokenId || "").trim(),
    speakerSceneId: String(ref.speakerSceneId || "").trim()
  };
}

export function normalizeEdgeExplodeFlag(rawFlag) {
  if (!rawFlag || typeof rawFlag !== "object") return null;
  return {
    version: Number.isFinite(Number(rawFlag.version)) ? Number(rawFlag.version) : 1,
    status: sanitizeEdgeExplodeStatus(rawFlag.status),
    processing: !!rawFlag.processing,
    processingUserId: String(rawFlag.processingUserId || "").trim() || null,
    stage: String(rawFlag.stage || rawFlag.rollStage || "").trim(),
    trained: rawFlag.trained === false ? false : true,
    rollRef: normalizeRollRef(rawFlag.rollRef),
    initialDice: normalizeDiceArray(rawFlag.initialDice),
    allDice: normalizeDiceArray(rawFlag.allDice),
    keptDice: normalizeDiceArray(rawFlag.keptDice),
    explosionDice: normalizeDiceArray(rawFlag.explosionDice),
    toHit: Number.isFinite(Number(rawFlag.toHit)) ? Number(rawFlag.toHit) : null,
    accuracy: Number.isFinite(Number(rawFlag.accuracy)) ? Number(rawFlag.accuracy) : null,
    criticalType: String(rawFlag.criticalType || "").trim(),
    criticalMoS: Number.isFinite(Number(rawFlag.criticalMoS)) ? Number(rawFlag.criticalMoS) : 0,
    checkpoint: rawFlag.checkpoint && typeof rawFlag.checkpoint === "object" ? cloneData(rawFlag.checkpoint) : null,
    preRollRecords: Array.isArray(rawFlag.preRollRecords) ? rawFlag.preRollRecords.filter(canUndoRecord).map(cloneData) : [],
    postRollRecords: Array.isArray(rawFlag.postRollRecords) ? rawFlag.postRollRecords.filter(canUndoRecord).map(cloneData) : [],
    createdAt: Number.isFinite(Number(rawFlag.createdAt)) ? Number(rawFlag.createdAt) : Date.now(),
    createdBy: String(rawFlag.createdBy || "").trim() || null,
    explodedAt: Number.isFinite(Number(rawFlag.explodedAt)) ? Number(rawFlag.explodedAt) : null,
    explodedBy: String(rawFlag.explodedBy || "").trim() || null,
    edgeSpentByActorUuid: String(rawFlag.edgeSpentByActorUuid || "").trim() || null,
    summaryMessageId: String(rawFlag.summaryMessageId || "").trim() || null
  };
}

function getSpeakerRollRef(speaker = {}) {
  return {
    speakerActorId: String(speaker?.actor || "").trim(),
    speakerTokenId: String(speaker?.token || "").trim(),
    speakerSceneId: String(speaker?.scene || "").trim()
  };
}

function createSkillRollRef({ trained = true, skillName = "", cardClass = "", speaker = null } = {}) {
  return normalizeRollRef({
    trained: !!trained,
    skillName,
    cardClass,
    ...getSpeakerRollRef(speaker)
  });
}

function rollRefMatches(storedRef, candidateRef) {
  const stored = normalizeRollRef(storedRef);
  const candidate = normalizeRollRef(candidateRef);
  if (stored.trained !== candidate.trained) return false;
  if (stored.skillName && candidate.skillName && stored.skillName !== candidate.skillName) return false;
  if (stored.cardClass && candidate.cardClass && stored.cardClass !== candidate.cardClass) return false;
  if (stored.speakerActorId && candidate.speakerActorId && stored.speakerActorId !== candidate.speakerActorId) return false;
  if (stored.speakerTokenId && candidate.speakerTokenId && stored.speakerTokenId !== candidate.speakerTokenId) return false;
  if (stored.speakerSceneId && candidate.speakerSceneId && stored.speakerSceneId !== candidate.speakerSceneId) return false;
  return true;
}

export function getMatchingEdgeExplodeReroll(edgeExplodeReroll, {
  trained = true,
  skillName = "",
  cardClass = "",
  speaker = null
} = {}) {
  const flag = normalizeEdgeExplodeFlag(edgeExplodeReroll);
  if (!flag || flag.status !== EDGE_EXPLODE_STATUS_CURRENT) return null;
  const rollRef = createSkillRollRef({ trained, skillName, cardClass, speaker });
  if (!rollRefMatches(flag.rollRef, rollRef)) return null;
  if (trained) {
    return flag.initialDice.length >= 2 ? { initialDice: flag.initialDice.slice(0, 2) } : null;
  }
  return flag.allDice.length >= 3 ? { allDice: flag.allDice.slice(0, 3) } : null;
}

function getEdgeExplodeBaseDice(flag) {
  if (!flag) return [];
  if (flag.trained) return flag.initialDice.slice(0, 2);
  if (flag.keptDice.length >= 2) return flag.keptDice.slice(0, 2);
  if (flag.allDice.length >= 3) {
    const maxValue = Math.max(...flag.allDice);
    const maxIndex = flag.allDice.indexOf(maxValue);
    return flag.allDice.filter((_, index) => index !== maxIndex).slice(0, 2);
  }
  return [];
}

function getEdgeExplodeDisplayTotal(flag, baseDice, critical) {
  const baseTotal = baseDice.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const criticalTotal = Number(critical?.total) || 0;
  return flag?.trained ? baseTotal + criticalTotal : baseTotal;
}

function createRollResultFromEdgeExplodeFlag(message, flag, critical) {
  const baseDice = getEdgeExplodeBaseDice(flag);
  const initialTotal = baseDice.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const toHit = Number.isFinite(Number(flag?.toHit)) ? Number(flag.toHit) : 7;
  const accuracy = Number.isFinite(Number(flag?.accuracy)) ? Number(flag.accuracy) : null;
  const baseMoS = (initialTotal - toHit) * 0.25;
  const accuracyMoS = accuracy === null ? 0 : accuracy * 0.25;
  const criticalMoS = Number(critical?.mos) || 0;
  const totalMoS = baseMoS + accuracyMoS + criticalMoS;
  const isSuccess = totalMoS >= 0;
  const baseIsSuccess = baseMoS >= 0;
  let resultText = String(critical?.label || "").trim();
  if (!resultText && isSuccess && !baseIsSuccess) resultText = "Glancing Success";
  if (!resultText && !isSuccess && baseIsSuccess) resultText = "Narrow Success";
  if (!resultText) resultText = isSuccess ? "Success" : "Failure";

  return {
    chatMessage: message,
    toHit,
    accuracy,
    initialDice: flag?.trained ? baseDice : [],
    allDice: flag?.trained ? [] : flag.allDice.slice(0, 3),
    keptDice: flag?.trained ? [] : baseDice,
    additionalDice: normalizeDiceArray(critical?.dice),
    initialTotal,
    total: getEdgeExplodeDisplayTotal(flag, baseDice, critical),
    baseMoS,
    accuracyMoS,
    criticalMoS,
    totalMoS,
    isSuccess,
    resultText,
    criticalType: String(critical?.label || "").trim()
  };
}

async function rerollEdgeExplosionForMessage(message, flag, { updateChat = true } = {}) {
  const baseDice = getEdgeExplodeBaseDice(flag);
  if (baseDice.length < 2) throw new Error("Original base dice were unavailable.");

  const critical = await rollPeasantCriticalExplosion(baseDice);
  if (!critical?.isCritical) throw new Error("Original base dice are not a critical roll.");

  const rollResult = createRollResultFromEdgeExplodeFlag(message, flag, critical);
  if (updateChat) await updateSkillRollChatCardFromResult(rollResult, { label: rollResult.resultText });
  return rollResult;
}

function createEdgeChainContext({ chainId = "", kind = "roll", label = "Roll", rerun = null } = {}) {
  return {
    chainId: String(chainId || "").trim() || createId(),
    kind: String(kind || "roll").trim() || "roll",
    label: String(label || "Roll").trim() || "Roll",
    rerun: cloneData(rerun)
  };
}

function getActorRef(actor) {
  return {
    actorId: actor?.id || null,
    actorUuid: actor?.uuid || null
  };
}

function getActorNotableCombats(actor) {
  return Array.isArray(actor?.system?.notableCombats) ? actor.system.notableCombats : [];
}

function getCombatRef(actor, combatIndex) {
  const index = Number.parseInt(combatIndex, 10);
  const combats = getActorNotableCombats(actor);
  const combat = Number.isInteger(index) ? combats[index] || null : null;
  return {
    combatIndex: Number.isInteger(index) ? index : null,
    combatId: String(combat?.id || "").trim(),
    combatName: String(combat?.name || "").trim()
  };
}

function createNotableCombatId(actor) {
  return actor?.constructor?.createPeasantNotableCombatId?.()
    || foundry?.utils?.randomID?.(16)
    || `combat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function ensureNotableCombatEdgeChainIdentity(actor, combatIndex) {
  const index = Number.parseInt(combatIndex, 10);
  const combats = getActorNotableCombats(actor);
  const combat = Number.isInteger(index) ? combats[index] || null : null;
  const currentId = String(combat?.id || "").trim();
  if (currentId) return currentId;
  if (!actor || !combat || !Number.isInteger(index)) return "";

  try {
    if (typeof actor.canUserModify === "function" && !actor.canUserModify(game.user, "update")) return "";
  } catch (_) {
    return "";
  }

  const nextCombats = cloneData(combats);
  const id = createNotableCombatId(actor);
  nextCombats[index] = { ...nextCombats[index], id };

  try {
    if (typeof actor.setPeasantNotableCombats === "function") {
      await actor.setPeasantNotableCombats(nextCombats, { render: false });
    } else if (typeof actor.update === "function") {
      await actor.update({ "system.notableCombats": nextCombats }, withPeasantActorSourceWriteContext({ render: false }));
    }
  } catch (error) {
    pcLog.debug("Peasant Core | Failed to assign notable combat id for Edge chain", error);
    return "";
  }

  return id;
}

function resolveNotableCombatIndex(actor, {
  combatId = "",
  combatName = "",
  combatIndex = null
} = {}) {
  const combats = getActorNotableCombats(actor);
  const id = String(combatId || "").trim();
  if (id) {
    const index = combats.findIndex((combat) => String(combat?.id || "").trim() === id);
    if (index >= 0) return index;
  }

  const name = String(combatName || "").trim();
  if (name) {
    const matchingIndexes = combats
      .map((combat, index) => ({ combat, index }))
      .filter(({ combat }) => String(combat?.name || "").trim() === name)
      .map(({ index }) => index);
    if (matchingIndexes.length === 1) return matchingIndexes[0];
  }

  const index = Number.parseInt(combatIndex, 10);
  return Number.isInteger(index) && index >= 0 && index < combats.length ? index : -1;
}

function getUnresolvedCombatError(rerun, fallback = "combat") {
  const name = String(rerun?.combatName || "").trim();
  if (name) return `The original ${fallback} "${name}" was not found.`;
  return `The original ${fallback} was not found.`;
}

export function createNotableCombatEdgeChainContext({
  actor = null,
  combatIndex = null,
  promptForTargets = true,
  rollOverrides = null,
  toHitAdj = 0,
  accuracyAdj = 0,
  targetLabel = "",
  selectedDamageType = null,
  cardClass = "",
  rollMode = ""
} = {}) {
  const combats = Array.isArray(actor?.system?.notableCombats) ? actor.system.notableCombats : [];
  const combat = combats[combatIndex] || null;
  const combatRef = getCombatRef(actor, combatIndex);
  const normalizedRollMode = String(rollMode || "").trim();
  const cardClasses = String(cardClass || "").split(/\s+/);
  const isDefense = cardClasses.includes("pc-defense-roll-card");
  const kind = normalizedRollMode === "heal" ? "heal" : (isDefense ? "defense" : "attack");
  const label = combat?.name || (kind === "heal" ? "Heal" : (kind === "defense" ? "Defense" : "Attack"));
  return createEdgeChainContext({
    kind,
    label,
    rerun: {
      type: "notableCombat",
      ...getActorRef(actor),
      ...combatRef,
      promptForTargets: !!promptForTargets,
      rollOverrides: cloneData(rollOverrides),
      toHitAdj: Number.parseInt(toHitAdj, 10) || 0,
      accuracyAdj: Number.parseInt(accuracyAdj, 10) || 0,
      targetLabel: String(targetLabel || "").trim(),
      selectedDamageType: selectedDamageType ?? null,
      cardClass: String(cardClass || ""),
      rollMode: normalizedRollMode
    }
  });
}

export function createSkillEdgeChainContext({
  trained = true,
  toHit = 7,
  accuracy = undefined,
  skillName = "Skill Roll",
  speaker = null,
  style = null,
  cardClass = ""
} = {}) {
  return createEdgeChainContext({
    kind: trained ? "skill" : "untrainedSkill",
    label: skillName,
    rerun: {
      type: trained ? "skillRoll" : "untrainedSkillRoll",
      toHit,
      accuracy,
      skillName,
      speaker: cloneData(speaker),
      style,
      cardClass: String(cardClass || "")
    }
  });
}

export function createActorSkillEdgeChainContext({
  actor = null,
  skillIndex = null,
  skillName = "Skill"
} = {}) {
  const index = Number.parseInt(skillIndex, 10);
  return createEdgeChainContext({
    kind: "skill",
    label: `${skillName || "Skill"} Skill Roll`,
    rerun: {
      type: "actorSkillRoll",
      ...getActorRef(actor),
      skillIndex: Number.isFinite(index) ? index : null
    }
  });
}

export function createManualCombatTagEdgeChainContext({
  actor = null,
  combatIndex = null,
  rollType = ""
} = {}) {
  const combats = Array.isArray(actor?.system?.notableCombats) ? actor.system.notableCombats : [];
  const combat = combats[combatIndex] || null;
  const combatRef = getCombatRef(actor, combatIndex);
  const normalizedRollType = String(rollType || "").trim();
  return createEdgeChainContext({
    kind: normalizedRollType || "combatTag",
    label: combat?.name || normalizedRollType || "Combat",
    rerun: {
      type: "manualCombatTag",
      ...getActorRef(actor),
      ...combatRef,
      rollType: normalizedRollType
    }
  });
}

export async function attachEdgeChainToChatMessage(message, context, records = [], options = {}) {
  if (!message?.setFlag || !context?.rerun) return null;
  const undoRecords = collectRollUndoRecords(records);
  const preRollRecords = collectRollUndoRecords(options?.preRollRecords);
  const postRollRecords = collectRollUndoRecords(options?.postRollRecords);
  const existingFlag = getEdgeChainFlag(message);
  const edgeBlock = normalizeEdgeBlockOptions(options, existingFlag);
  const flag = {
    version: 2,
    status: EDGE_CHAIN_STATUS_CURRENT,
    processing: false,
    processingUserId: null,
    chainId: String(context.chainId || "").trim() || createId(),
    kind: String(context.kind || context.rerun?.type || "roll").trim() || "roll",
    label: String(context.label || "Roll").trim() || "Roll",
    rerun: cloneData(context.rerun),
    undoRecords: undoRecords.map(cloneData),
    preRollRecords: preRollRecords.map(cloneData),
    postRollRecords: postRollRecords.map(cloneData),
    createdAt: Date.now(),
    createdBy: game.user?.id || null,
    edgedAt: null,
    edgedBy: null,
    edgeSpentByActorUuid: null,
    replacedByMessageId: null,
    summaryMessageId: null,
    edgeBlockedReason: edgeBlock.edgeBlockedReason,
    edgeBlockedLabel: edgeBlock.edgeBlockedLabel
  };
  await message.setFlag(PC_SYSTEM_ID, PC_EDGE_CHAIN_FLAG, flag);
  return flag;
}

export async function attachEdgeChainToChatMessages(messages = [], context, records = [], options = {}) {
  const seen = new Set();
  for (const message of messages) {
    if (!message?.id || seen.has(message.id)) continue;
    seen.add(message.id);
    await attachEdgeChainToChatMessage(message, context, records, options);
  }
}

export async function attachEdgeExplodeToChatMessage(message, rollResult, {
  trained = true,
  skillName = "",
  cardClass = "",
  speaker = null,
  stage = "",
  checkpoint = null,
  preRollRecords = [],
  postRollRecords = []
} = {}) {
  if (!message?.setFlag) return null;
  const edgeBlock = getCriticalEdgeBlockFromRollResult(rollResult);
  if (!edgeBlock?.edgeBlockedReason) return null;
  const existingFlag = getEdgeExplodeFlag(message);
  const normalizedPreRollRecords = collectRollUndoRecords(preRollRecords);
  const normalizedPostRollRecords = collectRollUndoRecords(postRollRecords);
  const rollInitialDice = normalizeDiceArray(rollResult?.initialDice);
  const rollAllDice = normalizeDiceArray(rollResult?.allDice);
  const rollKeptDice = normalizeDiceArray(rollResult?.keptDice);
  const rollExplosionDice = normalizeDiceArray(rollResult?.additionalDice);

  const flag = {
    version: 2,
    status: EDGE_EXPLODE_STATUS_CURRENT,
    processing: false,
    processingUserId: null,
    trained: !!trained,
    rollRef: (skillName || cardClass || speaker)
      ? createSkillRollRef({ trained, skillName, cardClass, speaker })
      : cloneData(existingFlag?.rollRef || createSkillRollRef({ trained, skillName, cardClass, speaker })),
    stage: String(stage || existingFlag?.stage || "").trim(),
    initialDice: rollInitialDice.length ? rollInitialDice : normalizeDiceArray(existingFlag?.initialDice),
    allDice: rollAllDice.length ? rollAllDice : normalizeDiceArray(existingFlag?.allDice),
    keptDice: rollKeptDice.length ? rollKeptDice : normalizeDiceArray(existingFlag?.keptDice),
    explosionDice: rollExplosionDice.length ? rollExplosionDice : normalizeDiceArray(existingFlag?.explosionDice),
    toHit: Number.isFinite(Number(rollResult?.toHit)) ? Number(rollResult.toHit) : existingFlag?.toHit ?? null,
    accuracy: Number.isFinite(Number(rollResult?.accuracy)) ? Number(rollResult.accuracy) : existingFlag?.accuracy ?? null,
    criticalType: String(rollResult?.criticalType || edgeBlock.edgeBlockedLabel || "").trim(),
    criticalMoS: Number.isFinite(Number(rollResult?.criticalMoS)) ? Number(rollResult.criticalMoS) : 0,
    checkpoint: checkpoint && typeof checkpoint === "object" ? cloneData(checkpoint) : cloneData(existingFlag?.checkpoint || null),
    preRollRecords: normalizedPreRollRecords.length ? normalizedPreRollRecords.map(cloneData) : (existingFlag?.preRollRecords || []).map(cloneData),
    postRollRecords: normalizedPostRollRecords.length ? normalizedPostRollRecords.map(cloneData) : (existingFlag?.postRollRecords || []).map(cloneData),
    createdAt: existingFlag?.createdAt || Date.now(),
    createdBy: existingFlag?.createdBy || game.user?.id || null,
    explodedAt: existingFlag?.explodedAt || null,
    explodedBy: existingFlag?.explodedBy || null,
    edgeSpentByActorUuid: existingFlag?.edgeSpentByActorUuid || null,
    summaryMessageId: existingFlag?.summaryMessageId || null
  };
  if (flag.trained && flag.initialDice.length < 2) return null;
  if (!flag.trained && flag.allDice.length < 3) return null;

  await message.setFlag(PC_SYSTEM_ID, PC_EDGE_EXPLODE_FLAG, flag);
  return flag;
}

function canUserUpdateMessage(user, message) {
  if (!message) return false;
  if (user?.isGM) return true;
  try {
    return typeof message.canUserModify === "function" && message.canUserModify(user, "update");
  } catch (_) {
    return false;
  }
}

function resolveUndoRecordActorSync(record) {
  const actorId = String(record?.actorId || "").trim();
  if (actorId) return game.actors?.get(actorId) || null;

  const actorUuid = String(record?.actorUuid || "").trim();
  if (actorUuid && typeof fromUuidSync === "function") {
    try {
      const resolved = fromUuidSync(actorUuid);
      if (resolved?.documentName === "Actor" || String(resolved?.collectionName || "").toLowerCase() === "actors") {
        return resolved;
      }
      if (resolved?.actor) return resolved.actor;
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to synchronously resolve Edge chain actor UUID", e);
    }
  }

  return null;
}

function getUndoPermissionError(user, records = []) {
  if (user?.isGM) return "";
  for (const record of records) {
    const actor = resolveUndoRecordActorSync(record);
    if (!actor) return `Could not confirm update permission for ${record?.actorName || "an affected actor"}.`;
    try {
      if (typeof actor.canUserModify !== "function" || !actor.canUserModify(user, "update")) {
        return `You cannot update ${actor.name || record.actorName || "an affected actor"}.`;
      }
    } catch (_) {
      return `You cannot update ${actor.name || record.actorName || "an affected actor"}.`;
    }
  }
  return "";
}

function canEdgeChainFlag(flag) {
  return !!(
    flag
    && flag.status === EDGE_CHAIN_STATUS_CURRENT
    && !flag.processing
    && !flag.edgeBlockedReason
    && flag.rerun
    && typeof flag.rerun === "object"
  );
}

function canEdgeExplodeFlag(flag) {
  return !!(
    flag
    && flag.version >= 2
    && flag.status === EDGE_EXPLODE_STATUS_CURRENT
    && !flag.processing
    && (
      (flag.trained && flag.initialDice.length >= 2)
      || (!flag.trained && flag.allDice.length >= 3)
    )
  );
}

function canRerunChainForEdgeExplode(flag) {
  return !!(
    flag
    && flag.status === EDGE_CHAIN_STATUS_CURRENT
    && !flag.processing
    && flag.rerun
    && typeof flag.rerun === "object"
  );
}

function getEdgeChainBlockedError(flag) {
  if (!flag?.edgeBlockedReason) return "";
  if (flag.edgeBlockedReason === EDGE_CHAIN_BLOCK_CRITICAL) {
    const label = flag.edgeBlockedLabel || "Critical result";
    return `${label} roll chains cannot be edged.`;
  }
  return "This roll chain cannot be edged.";
}

function canOfferEdgeChain(message) {
  const flag = getEdgeChainFlag(message);
  if (!canEdgeChainFlag(flag)) return false;

  const rollUndoFlag = message?.getFlag?.(PC_SYSTEM_ID, "rollUndo");
  if (rollUndoFlag?.status === "undone") return false;
  return true;
}

function canOfferEdgeExplode(message) {
  const explodeFlag = getEdgeExplodeFlag(message);
  if (!canEdgeExplodeFlag(explodeFlag)) return false;

  const chainFlag = getEdgeChainFlag(message);
  if (!canRerunChainForEdgeExplode(chainFlag)) return false;
  if (String(chainFlag?.rerun?.type || "").trim() === "notableCombat" && explodeFlag?.checkpoint?.version !== 2) return false;

  const rollUndoFlag = message?.getFlag?.(PC_SYSTEM_ID, "rollUndo");
  if (rollUndoFlag?.status === "undone") return false;
  return true;
}

async function setEdgeChainFlagOnMessage(message, flagPatch = {}) {
  if (!message?.setFlag) return null;
  const flag = getEdgeChainFlag(message);
  if (!flag) return null;
  const nextFlag = {
    ...flag,
    ...cloneData(flagPatch)
  };
  await message.setFlag(PC_SYSTEM_ID, PC_EDGE_CHAIN_FLAG, nextFlag);
  return nextFlag;
}

async function setEdgeExplodeFlagOnMessage(message, flagPatch = {}) {
  if (!message?.setFlag) return null;
  const flag = getEdgeExplodeFlag(message);
  if (!flag) return null;
  const nextFlag = {
    ...flag,
    ...cloneData(flagPatch)
  };
  await message.setFlag(PC_SYSTEM_ID, PC_EDGE_EXPLODE_FLAG, nextFlag);
  return nextFlag;
}

function getMessagesForChain(chainId) {
  const id = String(chainId || "").trim();
  if (!id) return [];
  return getAllChatMessages().filter((message) => {
    const flag = getEdgeChainFlag(message);
    return String(flag?.chainId || "").trim() === id;
  });
}

async function markEdgeChainMessagesProcessing(messages, processingUserId) {
  for (const message of messages) {
    await setEdgeChainFlagOnMessage(message, {
      status: EDGE_CHAIN_STATUS_PROCESSING,
      processing: true,
      processingUserId: processingUserId || null
    });
  }
}

async function markEdgeExplodeProcessing(message, processingUserId) {
  await setEdgeExplodeFlagOnMessage(message, {
    status: EDGE_EXPLODE_STATUS_PROCESSING,
    processing: true,
    processingUserId: processingUserId || null
  });
}

async function restoreEdgeExplodeCurrent(message) {
  await setEdgeExplodeFlagOnMessage(message, {
    status: EDGE_EXPLODE_STATUS_CURRENT,
    processing: false,
    processingUserId: null
  });
}

async function markEdgeExplodeSuperseded(message, {
  summaryMessageId = null,
  explodedBy = game.user?.id || null,
  edgeSpentByActorUuid = null
} = {}) {
  await setEdgeExplodeFlagOnMessage(message, {
    status: EDGE_EXPLODE_STATUS_SUPERSEDED,
    processing: false,
    processingUserId: null,
    explodedAt: Date.now(),
    explodedBy,
    edgeSpentByActorUuid,
    summaryMessageId
  });
}

async function restoreEdgeChainMessagesCurrent(messages) {
  for (const message of messages) {
    await setEdgeChainFlagOnMessage(message, {
      status: EDGE_CHAIN_STATUS_CURRENT,
      processing: false,
      processingUserId: null
    });
  }
}

async function markEdgeChainMessagesSuperseded(messages, {
  summaryMessageId = null,
  edgedBy = game.user?.id || null,
  edgeSpentByActorUuid = null
} = {}) {
  const edgedAt = Date.now();
  for (const message of messages) {
    await markRollUndoChatMessageEffectsUndone(message, { undoneAt: edgedAt, undoneBy: edgedBy });
    await setEdgeChainFlagOnMessage(message, {
      status: EDGE_CHAIN_STATUS_SUPERSEDED,
      processing: false,
      processingUserId: null,
      edgedAt,
      edgedBy,
      edgeSpentByActorUuid,
      summaryMessageId
    });
  }
}

function getEdgeExplodePostRollRecords(chainFlag, explodeFlag) {
  const chainRecords = collectRollUndoRecords(chainFlag?.postRollRecords);
  if (chainRecords.length) return dedupeUndoRecords(chainRecords);

  const explodeRecords = collectRollUndoRecords(explodeFlag?.postRollRecords);
  if (explodeRecords.length) return dedupeUndoRecords(explodeRecords);
  return [];
}

function getEdgeExplodePreRollRecords(chainFlag, explodeFlag) {
  const explicitRecords = collectRollUndoRecords(chainFlag?.preRollRecords, explodeFlag?.preRollRecords);
  if (explicitRecords.length) return dedupeUndoRecords(explicitRecords);

  const rerunType = String(chainFlag?.rerun?.type || "").trim();
  if (rerunType === "skillRoll" || rerunType === "untrainedSkillRoll" || rerunType === "actorSkillRoll") {
    return dedupeUndoRecords(chainFlag?.undoRecords);
  }

  return [];
}

function dedupeUndoRecords(records = []) {
  const seen = new Set();
  const deduped = [];
  for (const record of collectRollUndoRecords(records)) {
    const key = String(record?.id || JSON.stringify(record)).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }
  return deduped;
}

function createEdgeChainContextFromFlag(flag) {
  return createEdgeChainContext({
    chainId: flag?.chainId,
    kind: flag?.kind,
    label: flag?.label,
    rerun: cloneData(flag?.rerun)
  });
}

function getMessagesByIds(messageIds = []) {
  const seen = new Set();
  const messages = [];
  for (const messageId of messageIds) {
    const id = String(messageId || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const message = game.messages?.get(id) || null;
    if (message) messages.push(message);
  }
  return messages;
}

function getRollUndoRecordsFromMessage(message) {
  const flag = message?.getFlag?.(PC_SYSTEM_ID, "rollUndo");
  return Array.isArray(flag?.records) ? flag.records.filter(canUndoRecord) : [];
}

async function markPostRollUndoMessagesUndone(messages, postRollRecords, {
  undoneAt = Date.now(),
  undoneBy = game.user?.id || null
} = {}) {
  const postRecordIds = new Set(
    collectRollUndoRecords(postRollRecords)
      .map((record) => String(record?.id || "").trim())
      .filter(Boolean)
  );
  if (!postRecordIds.size) return;

  for (const message of messages) {
    const records = getRollUndoRecordsFromMessage(message);
    if (!records.length) continue;
    const recordIds = records.map((record) => String(record?.id || "").trim()).filter(Boolean);
    if (!recordIds.length) continue;
    if (recordIds.every((id) => postRecordIds.has(id))) {
      await markRollUndoChatMessageEffectsUndone(message, { undoneAt, undoneBy });
    }
  }
}

async function refreshEdgeChainMessagesForEdgeExplode({
  chainFlag = null,
  originalMessages = [],
  replayMessageIds = [],
  preRollRecords = [],
  postRollRecords = [],
  summaryMessageId = null
} = {}) {
  const allMessages = [
    ...originalMessages,
    ...getMessagesByIds(replayMessageIds)
  ];
  const context = createEdgeChainContextFromFlag(chainFlag);
  const undoRecords = dedupeUndoRecords(collectRollUndoRecords(preRollRecords, postRollRecords));
  await attachEdgeChainToChatMessages(allMessages, context, undoRecords, {
    preRollRecords,
    postRollRecords,
    edgeBlockedReason: chainFlag?.edgeBlockedReason || "",
    edgeBlockedLabel: chainFlag?.edgeBlockedLabel || "",
    summaryMessageId
  });
}

async function prepareRerun(flag, { edgeExplodeReroll = null } = {}) {
  const rerun = flag?.rerun || {};
  if (rerun.type === "notableCombat") {
    const actor = await resolveActorFromUuidOrId({
      actorUuid: rerun.actorUuid,
      actorId: rerun.actorId
    });
    const handler = edgeExplodeReroll
      ? game.peasantCore?.performNotableCombatRoll
      : game.peasantCore?.startNotableCombatRoll;
    if (!actor) return { ok: false, error: "The original roll actor was not found." };
    if (typeof handler !== "function") return { ok: false, error: "Notable combat roll workflow is unavailable." };
    const rerunRef = { ...rerun, combatName: rerun.combatName || flag?.label };
    const combatIndex = resolveNotableCombatIndex(actor, rerunRef);
    if (combatIndex < 0) return { ok: false, error: getUnresolvedCombatError(rerunRef, "combat") };
    return {
      ok: true,
      run: () => handler({
        actor,
        combatIndex,
        toHitAdj: Number.parseInt(rerun.toHitAdj, 10) || 0,
        accuracyAdj: Number.parseInt(rerun.accuracyAdj, 10) || 0,
        promptForTargets: rerun.promptForTargets,
        rollOverrides: cloneData(rerun.rollOverrides),
        targetLabel: rerun.targetLabel,
        selectedDamageType: rerun.selectedDamageType,
        cardClass: rerun.cardClass,
        rollMode: rerun.rollMode,
        edgeExplodeReroll
      })
    };
  }

  if (rerun.type === "skillRoll" || rerun.type === "untrainedSkillRoll") {
    const handler = rerun.type === "untrainedSkillRoll"
      ? game.peasantCore?.performUntrainedSkillRoll
      : game.peasantCore?.performSkillRoll;
    if (typeof handler !== "function") return { ok: false, error: "Skill roll workflow is unavailable." };
    return {
      ok: true,
      run: () => handler({
        toHit: rerun.toHit,
        accuracy: rerun.accuracy,
        skillName: rerun.skillName,
        speaker: cloneData(rerun.speaker) || ChatMessage.getSpeaker(),
        style: rerun.style ?? CONST.CHAT_MESSAGE_STYLES.OTHER,
        cardClass: rerun.cardClass,
        edgeExplodeReroll
      })
    };
  }

  if (rerun.type === "actorSkillRoll") {
    const actor = await resolveActorFromUuidOrId({
      actorUuid: rerun.actorUuid,
      actorId: rerun.actorId
    });
    if (!actor) return { ok: false, error: "The original skill actor was not found." };
    return {
      ok: true,
      run: () => rerunActorSkillRoll(actor, rerun.skillIndex, { edgeExplodeReroll })
    };
  }

  if (rerun.type === "manualCombatTag") {
    const actor = await resolveActorFromUuidOrId({
      actorUuid: rerun.actorUuid,
      actorId: rerun.actorId
    });
    const handler = game.peasantCore?.rollManualCombatTag;
    if (!actor) return { ok: false, error: "The original roll actor was not found." };
    if (typeof handler !== "function") return { ok: false, error: "Combat tag roll workflow is unavailable." };
    const rerunRef = { ...rerun, combatName: rerun.combatName || flag?.label };
    const combatIndex = resolveNotableCombatIndex(actor, rerunRef);
    if (combatIndex < 0) return { ok: false, error: getUnresolvedCombatError(rerunRef, "combat tag") };
    return {
      ok: true,
      run: () => handler({
        actor,
        combatIndex,
        rollType: rerun.rollType
      })
    };
  }

  return { ok: false, error: "This roll chain cannot be rerun with Edge." };
}

async function rerunActorSkillRoll(actor, skillIndex, { edgeExplodeReroll = null } = {}) {
  const index = Number.parseInt(skillIndex, 10);
  if (!actor || !Number.isFinite(index)) return { rolled: false, error: "Skill actor or index was unavailable." };

  const skills = Array.isArray(actor.system?.skills) ? actor.system.skills : [];
  const skill = skills[index] || null;
  if (!skill) return { rolled: false, error: "The original skill was not found." };

  const combatMods = actor.system?.combatMods || { toHit: 0, accuracy: 0 };
  const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
  const accuracyMod = Number.parseInt(combatMods.accuracy, 10) || 0;
  const skillTohit = parseOptionalInteger(skill.tohit, { min: 1 });
  const skillAccuracy = parseOptionalInteger(skill.accuracy, { allowSign: true });
  const baseTohit = hasOptionalInteger(skillTohit) ? skillTohit : 7;
  const baseAccuracy = skillAccuracy ?? 0;
  const skillCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
  const toHit = skillCalc.toHit;
  const accuracy = skillCalc.accuracy;
  const isUntrained = String(skill.rank || "").trim().toLowerCase() === "u";
  const skillName = isUntrained
    ? `${skill.name || "Skill"} Untrained Skill Roll`
    : `${skill.name || "Skill"} Skill Roll`;
  const edgeChainContext = createActorSkillEdgeChainContext({
    actor,
    skillIndex: index,
    skillName: skill.name || "Skill"
  });

  const handler = isUntrained
    ? game.peasantCore?.performUntrainedSkillRoll
    : game.peasantCore?.performSkillRoll;
  if (typeof handler !== "function") return { rolled: false, error: "Skill roll workflow is unavailable." };

  const rollResult = await handler({
    toHit,
    accuracy: isUntrained ? 0 : (accuracy !== 0 ? accuracy : undefined),
    skillName,
    speaker: ChatMessage.getSpeaker({ actor }),
    edgeChainContext,
    edgeExplodeReroll
  });

  const useResult = await captureActorRollUndo(
    actor,
    `${skill.name || "Skill"} Skill Use`,
    () => actor.consumePeasantSkillUse?.(index)
  );
  await attachRollUndoToChatMessage(rollResult?.chatMessage, useResult.undoRecords, {
    label: `Undo ${skill.name || "Skill"} Roll Effects`
  });
  await attachEdgeChainToChatMessage(rollResult?.chatMessage, edgeChainContext, useResult.undoRecords, {
    preRollRecords: useResult.undoRecords,
    postRollRecords: []
  });

  return {
    rolled: !!rollResult,
    rollResult,
    undoRecords: useResult.undoRecords
  };
}

async function createEdgeChainSummary({
  flag = null,
  spenderActor = null,
  rerunResult = null
} = {}) {
  const speaker = spenderActor ? ChatMessage.getSpeaker({ actor: spenderActor }) : ChatMessage.getSpeaker();
  const cancelled = !!(rerunResult?.chainCancelled || rerunResult?.cancelled);
  const content = `<fieldset class="skill-roll-card pc-edge-chain-roll-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <legend>Edge Entire Chain</legend>
    <div class="roll-details" style="display: block; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 12px; line-height: 1.55;">
      <div>${escapeHtml(spenderActor?.name || "Actor")} spent 1 Edge.</div>
      <div>Rerolled: ${escapeHtml(flag?.label || "Roll Chain")}</div>
      ${cancelled ? `<div>Result: ${escapeHtml("Rerun cancelled")}</div>` : ""}
    </div>
  </fieldset>`;
  return ChatMessage.create(applyMessageMode({ user: game.user?.id, speaker, content }));
}

async function createEdgeExplodeSummary({
  chainFlag = null,
  explodeFlag = null,
  spenderActor = null,
  rerunResult = null,
  rollResult = null,
  replayPlan = null
} = {}) {
  const speaker = spenderActor ? ChatMessage.getSpeaker({ actor: spenderActor }) : ChatMessage.getSpeaker();
  const oldDice = explodeFlag?.explosionDice?.length ? explodeFlag.explosionDice.join(", ") : "unknown";
  const newDice = rollResult?.additionalDice?.length ? rollResult.additionalDice.join(", ") : "";
  const criticalType = explodeFlag?.criticalType || "Critical Roll";
  const cancelled = !!(rerunResult?.chainCancelled || rerunResult?.cancelled);
  const content = `<fieldset class="skill-roll-card pc-edge-explode-roll-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <legend>Edge Explode</legend>
    <div class="roll-details" style="display: block; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 12px; line-height: 1.55;">
      <div>${escapeHtml(spenderActor?.name || "Actor")} spent 1 Edge.</div>
      <div>Rerolled: ${escapeHtml(chainFlag?.label || criticalType)}</div>
      <div>Original Explosion Dice: ${escapeHtml(oldDice)}</div>
      ${newDice ? `<div>New Explosion Dice: ${escapeHtml(newDice)}</div>` : ""}
      ${cancelled ? `<div>Result: ${escapeHtml("Rerun cancelled")}</div>` : ""}
    </div>
  </fieldset>`;
  return ChatMessage.create(applyMessageMode({ user: game.user?.id, speaker, content }));
}

function getResultError(error) {
  return String(error?.message || error || "Edge Entire Chain failed.");
}

export async function applyEdgeChainRoll(payload = {}) {
  const messageId = String(payload.messageId || "").trim();
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) return { ok: false, error: "Roll message was not found." };

  const flag = getEdgeChainFlag(message);
  const blockedError = getEdgeChainBlockedError(flag);
  if (blockedError) {
    return { ok: false, error: blockedError };
  }
  if (!canEdgeChainFlag(flag)) {
    return { ok: false, error: "This roll chain cannot be edged." };
  }

  const requester = game.users?.get(payload.requesterUserId || payload.userId) || game.user;
  if (!canUserUpdateMessage(requester, message)) {
    return { ok: false, error: "You cannot update this chat message." };
  }

  const spenderActor = await resolveActorFromUuidOrId({
    actorUuid: payload.spenderActorUuid,
    actorId: payload.spenderActorId,
    tokenUuid: payload.spenderTokenUuid
  });
  const permissionError = getActorUpdatePermissionError(requester, spenderActor);
  if (permissionError) return { ok: false, error: permissionError };
  if (!actorHasCurrentEdge(spenderActor)) {
    return { ok: false, error: `${spenderActor?.name || "Actor"} has no current Edge.` };
  }

  const undoPermissionError = getUndoPermissionError(requester, flag.undoRecords);
  if (undoPermissionError) return { ok: false, error: undoPermissionError };

  const preparedRerun = await prepareRerun(flag);
  if (!preparedRerun.ok) return preparedRerun;

  const originalChainMessages = getMessagesForChain(flag.chainId);
  await markEdgeChainMessagesProcessing(originalChainMessages, requester?.id || null);

  let edgeSpend = null;
  let rerunResult = null;
  let summaryMessage = null;
  try {
    const undoResult = await applyRollUndoRecords(flag.undoRecords);
    if (!undoResult.ok) throw new Error(undoResult.error || "Could not undo the original roll chain.");

    edgeSpend = await spendActorEdge(spenderActor);
    if (!edgeSpend.ok) throw new Error(edgeSpend.error || "Could not spend Edge.");

    rerunResult = await preparedRerun.run();
    summaryMessage = await createEdgeChainSummary({ flag, spenderActor, rerunResult });
    await markEdgeChainMessagesSuperseded(originalChainMessages, {
      summaryMessageId: summaryMessage?.id || null,
      edgedBy: requester?.id || null,
      edgeSpentByActorUuid: spenderActor?.uuid || null
    });
  } catch (error) {
    await refundActorEdge(spenderActor, edgeSpend);
    await restoreEdgeChainMessagesCurrent(originalChainMessages);
    console.error("Peasant Core | Edge Entire Chain failed", error);
    return { ok: false, error: getResultError(error) };
  }

  return {
    ok: true,
    messageId: message.id,
    chainId: flag.chainId,
    summaryMessageId: summaryMessage?.id || null,
    rerunResult
  };
}

export async function applyEdgeExplodeRoll(payload = {}) {
  const messageId = String(payload.messageId || "").trim();
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) return { ok: false, error: "Roll message was not found." };

  const explodeFlag = getEdgeExplodeFlag(message);
  if (!canEdgeExplodeFlag(explodeFlag)) {
    return { ok: false, error: "This roll's explosion dice cannot be edged." };
  }

  const chainFlag = getEdgeChainFlag(message);
  if (!canRerunChainForEdgeExplode(chainFlag)) {
    return { ok: false, error: "This roll chain cannot be rerun for Edge Explode." };
  }
  const isNotableCombat = String(chainFlag?.rerun?.type || "").trim() === "notableCombat";
  if (isNotableCombat && explodeFlag?.checkpoint?.version !== 2) {
    return { ok: false, error: "This combat roll does not have the v2 Edge Explode checkpoint data." };
  }

  const requester = game.users?.get(payload.requesterUserId || payload.userId) || game.user;
  if (!canUserUpdateMessage(requester, message)) {
    return { ok: false, error: "You cannot update this chat message." };
  }

  const spenderActor = await resolveActorFromUuidOrId({
    actorUuid: payload.spenderActorUuid,
    actorId: payload.spenderActorId,
    tokenUuid: payload.spenderTokenUuid
  });
  const permissionError = getActorUpdatePermissionError(requester, spenderActor);
  if (permissionError) return { ok: false, error: permissionError };
  if (!actorHasCurrentEdge(spenderActor)) {
    return { ok: false, error: `${spenderActor?.name || "Actor"} has no current Edge.` };
  }

  const originalChainMessages = getMessagesForChain(chainFlag.chainId);
  await markEdgeChainMessagesProcessing(originalChainMessages, requester?.id || null);
  await markEdgeExplodeProcessing(message, requester?.id || null);

  let edgeSpend = null;
  let rollResult = null;
  let replayPlan = null;
  let replayResult = null;
  let summaryMessage = null;
  try {
    const postRollRecords = getEdgeExplodePostRollRecords(chainFlag, explodeFlag);
    rollResult = await rerollEdgeExplosionForMessage(message, explodeFlag, { updateChat: false });

    let replayRequired = false;
    if (isNotableCombat) {
      const planReplay = game.peasantCore?.planNotableCombatEdgeExplodeReplay;
      if (typeof planReplay !== "function") throw new Error("Notable combat Edge Explode planner is unavailable.");
      replayPlan = await planReplay({
        checkpoint: explodeFlag.checkpoint,
        rollResult
      });
      if (!replayPlan?.ok) throw new Error(replayPlan?.error || "Could not evaluate downstream Edge Explode effects.");
      replayRequired = !!replayPlan.replayRequired;
    }

    if (replayRequired) {
      const undoPermissionError = getUndoPermissionError(requester, postRollRecords);
      if (undoPermissionError) throw new Error(undoPermissionError);

      const undoResult = await applyRollUndoRecords(postRollRecords);
      if (!undoResult.ok) throw new Error(undoResult.error || "Could not undo the original post-roll effects.");
      await markPostRollUndoMessagesUndone(originalChainMessages, postRollRecords, {
        undoneBy: requester?.id || null
      });
    }

    edgeSpend = await spendActorEdge(spenderActor);
    if (!edgeSpend.ok) throw new Error(edgeSpend.error || "Could not spend Edge.");

    if (replayRequired) {
      const replay = game.peasantCore?.replayNotableCombatPostRollEffects;
      if (typeof replay !== "function") throw new Error("Notable combat Edge Explode replay is unavailable.");
      replayResult = await replay({
        checkpoint: explodeFlag.checkpoint,
        rollResult
      });
      if (!replayResult?.ok) throw new Error(replayResult?.error || "Could not replay downstream roll effects.");
    }

    const replayUpdatedClickedAttackCard = !!(
      replayRequired
      && isNotableCombat
      && explodeFlag?.checkpoint?.stage === "attack"
      && !explodeFlag?.checkpoint?.multiTarget
    );
    if (!replayUpdatedClickedAttackCard) {
      await updateSkillRollChatCardFromResult(rollResult, { label: rollResult.resultText });
    }

    const nextPostRollRecords = replayRequired
      ? dedupeUndoRecords(replayResult?.postRollRecords)
      : postRollRecords;
    const nextPreRollRecords = getEdgeExplodePreRollRecords(chainFlag, explodeFlag);
    summaryMessage = await createEdgeExplodeSummary({ chainFlag, explodeFlag, spenderActor, rerunResult: replayResult, rollResult, replayPlan });
    await refreshEdgeChainMessagesForEdgeExplode({
      chainFlag,
      originalMessages: originalChainMessages,
      replayMessageIds: replayResult?.messageIds || [],
      preRollRecords: nextPreRollRecords,
      postRollRecords: nextPostRollRecords,
      summaryMessageId: summaryMessage?.id || null
    });
    await setEdgeExplodeFlagOnMessage(message, {
      status: EDGE_EXPLODE_STATUS_CURRENT,
      processing: false,
      processingUserId: null,
      initialDice: normalizeDiceArray(rollResult.initialDice),
      allDice: normalizeDiceArray(rollResult.allDice),
      keptDice: normalizeDiceArray(rollResult.keptDice),
      explosionDice: normalizeDiceArray(rollResult.additionalDice),
      toHit: Number.isFinite(Number(rollResult.toHit)) ? Number(rollResult.toHit) : null,
      accuracy: Number.isFinite(Number(rollResult.accuracy)) ? Number(rollResult.accuracy) : null,
      criticalType: String(rollResult.criticalType || "").trim(),
      criticalMoS: Number.isFinite(Number(rollResult.criticalMoS)) ? Number(rollResult.criticalMoS) : 0,
      preRollRecords: nextPreRollRecords,
      postRollRecords: nextPostRollRecords,
      summaryMessageId: summaryMessage?.id || null,
      explodedBy: requester?.id || null,
      explodedAt: Date.now(),
      edgeSpentByActorUuid: spenderActor?.uuid || null
    });
  } catch (error) {
    await refundActorEdge(spenderActor, edgeSpend);
    await restoreEdgeChainMessagesCurrent(originalChainMessages);
    await restoreEdgeExplodeCurrent(message);
    console.error("Peasant Core | Edge Explode failed", error);
    return { ok: false, error: getResultError(error) };
  }

  return {
    ok: true,
    messageId: message.id,
    chainId: chainFlag.chainId,
    summaryMessageId: summaryMessage?.id || null,
    rollResult,
    replayPlan,
    replayResult
  };
}

export async function edgeChainRollFromMessage(messageId) {
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) {
    ui.notifications?.warn?.("Roll message was not found.");
    return false;
  }

  const flag = getEdgeChainFlag(message);
  const blockedError = getEdgeChainBlockedError(flag);
  if (blockedError) {
    ui.notifications?.warn?.(blockedError);
    return false;
  }
  if (!canEdgeChainFlag(flag)) {
    ui.notifications?.warn?.("This roll chain cannot be edged.");
    return false;
  }

  const permissionError = getUndoPermissionError(game.user, flag.undoRecords);
  if (permissionError) {
    ui.notifications?.warn?.(permissionError);
    return false;
  }

  const spender = resolveEdgeLocationRollSpender({ warn: true, label: "Edge Entire Chain" });
  if (!spender.ok) return false;

  const selectedToken = Array.from(canvas?.tokens?.controlled || [])
    .find(token => token?.actor?.uuid === spender.actor?.uuid) || null;
  const tokenDocument = selectedToken?.document ?? selectedToken ?? null;
  const payload = {
    requesterUserId: game.user?.id || null,
    messageId: message.id,
    spenderActorId: spender.actor?.id || null,
    spenderActorUuid: spender.actor?.uuid || null,
    spenderTokenUuid: tokenDocument?.uuid || null
  };

  const result = await applyEdgeChainRoll(payload);
  if (!result?.ok) {
    ui.notifications?.warn?.(result?.error || "Edge Entire Chain failed.");
    return false;
  }

  return true;
}

export async function edgeExplodeRollFromMessage(messageId) {
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) {
    ui.notifications?.warn?.("Roll message was not found.");
    return false;
  }

  const explodeFlag = getEdgeExplodeFlag(message);
  if (!canEdgeExplodeFlag(explodeFlag)) {
    ui.notifications?.warn?.("This roll's explosion dice cannot be edged.");
    return false;
  }

  const chainFlag = getEdgeChainFlag(message);
  if (!canRerunChainForEdgeExplode(chainFlag)) {
    ui.notifications?.warn?.("This roll chain cannot be rerun for Edge Explode.");
    return false;
  }

  const permissionError = getUndoPermissionError(game.user, chainFlag.undoRecords);
  if (permissionError) {
    ui.notifications?.warn?.(permissionError);
    return false;
  }

  const spender = resolveEdgeLocationRollSpender({ warn: true, label: "Edge Explode" });
  if (!spender.ok) return false;

  const selectedToken = Array.from(canvas?.tokens?.controlled || [])
    .find(token => token?.actor?.uuid === spender.actor?.uuid) || null;
  const tokenDocument = selectedToken?.document ?? selectedToken ?? null;
  const payload = {
    requesterUserId: game.user?.id || null,
    messageId: message.id,
    spenderActorId: spender.actor?.id || null,
    spenderActorUuid: spender.actor?.uuid || null,
    spenderTokenUuid: tokenDocument?.uuid || null
  };

  const result = await applyEdgeExplodeRoll(payload);
  if (!result?.ok) {
    ui.notifications?.warn?.(result?.error || "Edge Explode failed.");
    return false;
  }

  return true;
}

export function configureEdgeChainRollChatContext() {
  Hooks.on("getChatMessageContextOptions", (_application, menuItems) => {
    menuItems.push({
      name: "Edge Entire Chain",
      icon: '<i class="fas fa-dice-d20"></i>',
      condition: element => canOfferEdgeChain(getMessageFromContextElement(element)),
      callback: async element => {
        const message = getMessageFromContextElement(element);
        if (message) await edgeChainRollFromMessage(message.id);
      }
    });
  });
}

export function configureEdgeExplodeRollChatContext() {
  Hooks.on("getChatMessageContextOptions", (_application, menuItems) => {
    menuItems.push({
      name: "Edge Explode",
      icon: '<i class="fas fa-bolt"></i>',
      condition: element => canOfferEdgeExplode(getMessageFromContextElement(element)),
      callback: async element => {
        const message = getMessageFromContextElement(element);
        if (message) await edgeExplodeRollFromMessage(message.id);
      }
    });
  });
}
