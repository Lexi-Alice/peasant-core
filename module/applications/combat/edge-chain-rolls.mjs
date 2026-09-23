import {
  applyRollUndoRecords,
  attachRollUndoToChatMessage,
  canUndoRecord,
  collectRollUndoRecords,
  captureActorRollUndo,
  markRollUndoChatMessageEffectsUndone
} from "../chat-undo.mjs";
import { computeBaseAttrToHits } from "../../data/actor/attributes.mjs";
import { getDevastatingWoundAccuracyModifier, getEffectiveSkillCombatModifiers } from "../../data/actor/combat-modifiers.mjs";
import { hasOptionalInteger, parseOptionalInteger } from "../../data/actor/helpers.mjs";
import { withPeasantActorSourceWriteContext } from "../../data/actor/source-system.mjs";
import { rollPeasantCriticalExplosion } from "../../dice/exploding.mjs";
import { applyToHitAccuracy } from "../../dice/roll-targets.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { renderDialogV2 } from "../dialogs.mjs";
import { qs, qsa, toElement } from "../dom.mjs";
import {
  actorHasCurrentEdge,
  getActorUpdatePermissionError,
  refundActorEdge,
  resolveActorFromUuidOrId,
  resolveEdgeLocationRollSpender,
  spendActorEdge
} from "./edge-location-rolls.mjs";
import { maybeForcePassFailedRoll, PC_STRESS_ROLL_FLAG } from "./force-pass.mjs";
import { hasUnsettledAutomaticSkillEffects, offerSkillEntryEffects } from "./skill-entry-effects.mjs";
import { updateSkillRollChatCardFromResult } from "./roll-chat-updates.mjs";

const PC_SYSTEM_ID = "peasant-core";
export const PC_EDGE_CHAIN_FLAG = "edgeChain";
export const PC_EDGE_EXPLODE_FLAG = "edgeExplode";
export const PC_EDGE_INDIVIDUAL_DIE_FLAG = "edgeIndividualDie";

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
const FALL_BLESSING_UNDO_LABEL = "Blessing of Fall Accuracy Uses";

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
    edgeBlockedLabel: String(rawFlag.edgeBlockedLabel || "").trim(),
    fallAccuracyApplied: rawFlag.fallAccuracyApplied === true,
    fallAccuracyUsesSpent: Math.max(0, Number.parseInt(rawFlag.fallAccuracyUsesSpent, 10) || 0),
    fallAccuracyBonus: Math.max(0, Number.parseInt(rawFlag.fallAccuracyBonus, 10) || 0)
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

function normalizeEdgeIndividualKind(kind) {
  const normalized = String(kind || "skill").trim();
  return ["damage", "heal", "manifest", "skill", "save", "check"].includes(normalized) ? normalized : "skill";
}

export function createEdgeIndividualDieFlag({
  chainId = "",
  kind = "skill",
  label = "Roll",
  diceFaces = 6,
  dice = [],
  trained = true,
  toHit = null,
  accuracy = null,
  naturalDiceCount = 0,
  useStability = false,
  useStrengthen = false,
  flat = 0,
  rollType = "",
  checkpoint = null,
  rollKey = ""
} = {}) {
  return {
    version: 1,
    status: EDGE_CHAIN_STATUS_CURRENT,
    processing: false,
    processingUserId: null,
    chainId: String(chainId || "").trim(),
    kind: normalizeEdgeIndividualKind(kind),
    label: String(label || "Roll").trim() || "Roll",
    diceFaces: Math.max(1, Number.parseInt(diceFaces, 10) || 6),
    dice: normalizeDiceArray(dice),
    trained: trained !== false,
    toHit: Number.isFinite(Number(toHit)) ? Number(toHit) : null,
    accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
    naturalDiceCount: Math.max(0, Number.parseInt(naturalDiceCount, 10) || 0),
    useStability: !!useStability,
    useStrengthen: !!useStrengthen,
    flat: Number.isFinite(Number(flat)) ? Number(flat) : 0,
    rollType: String(rollType || "").trim(),
    checkpoint: checkpoint && typeof checkpoint === "object" ? cloneData(checkpoint) : null,
    rollKey: String(rollKey || "").trim(),
    edgedAt: null,
    edgedBy: null,
    edgeSpentByActorUuid: null,
    summaryMessageId: null
  };
}

export function normalizeEdgeIndividualDieFlag(rawFlag) {
  if (!rawFlag || typeof rawFlag !== "object") return null;
  return {
    ...createEdgeIndividualDieFlag(rawFlag),
    version: Number.isFinite(Number(rawFlag.version)) ? Number(rawFlag.version) : 1,
    status: sanitizeStatus(rawFlag.status),
    processing: !!rawFlag.processing,
    processingUserId: String(rawFlag.processingUserId || "").trim() || null,
    edgedAt: Number.isFinite(Number(rawFlag.edgedAt)) ? Number(rawFlag.edgedAt) : null,
    edgedBy: String(rawFlag.edgedBy || "").trim() || null,
    edgeSpentByActorUuid: String(rawFlag.edgeSpentByActorUuid || "").trim() || null,
    summaryMessageId: String(rawFlag.summaryMessageId || "").trim() || null
  };
}

export function getEdgeIndividualDieFlag(message) {
  return normalizeEdgeIndividualDieFlag(message?.getFlag?.(PC_SYSTEM_ID, PC_EDGE_INDIVIDUAL_DIE_FLAG));
}

export function getEdgeIndividualDieTitle(flag) {
  const normalized = normalizeEdgeIndividualDieFlag(flag) || createEdgeIndividualDieFlag();
  const suffix = normalized.kind === "damage"
    ? " Damage Value"
    : (normalized.kind === "heal" ? " Healing Value" : (normalized.kind === "manifest" ? " Manifest Value" : ""));
  return `Edge Individual Die On ${normalized.label}${suffix}`;
}

export function createEdgeIndividualValueRollKey(kind, {
  targetRef = null,
  rollType = "",
  actorRef = null,
  combatIndex = null
} = {}) {
  const normalizedKind = normalizeEdgeIndividualKind(kind);
  const targetKey = String(
    targetRef?.tokenUuid
    || targetRef?.tokenId
    || targetRef?.actorUuid
    || targetRef?.actorId
    || ""
  ).trim();
  const actorKey = String(actorRef?.actorUuid || actorRef?.actorId || "").trim();
  return [normalizedKind, String(rollType || "").trim(), targetKey || actorKey, combatIndex ?? ""]
    .join(":");
}

export function getEdgeIndividualDiceOverride(replay, rollKey) {
  const key = String(rollKey || "").trim();
  if (!key || !Array.isArray(replay?.values)) return null;
  const entry = replay.values.find((candidate) => String(candidate?.rollKey || "").trim() === key);
  const dice = normalizeDiceArray(entry?.dice);
  return dice.length ? dice : null;
}

export function replaceEdgeIndividualDie(flag, dieIndex, newValue) {
  const normalized = normalizeEdgeIndividualDieFlag(flag);
  const index = Number.parseInt(dieIndex, 10);
  if (!normalized || !Number.isInteger(index) || index < 0 || index >= normalized.dice.length) {
    throw new Error("The selected die was unavailable.");
  }
  const replacement = Number.parseInt(newValue, 10);
  if (!Number.isFinite(replacement) || replacement < 1 || replacement > normalized.diceFaces) {
    throw new Error("The new die result was invalid.");
  }
  const dice = normalized.dice.slice();
  const originalDie = dice[index];
  dice[index] = replacement;
  return { dice, originalDie, newDie: replacement, dieIndex: index };
}

export function createSkillResultFromIndividualDice({
  trained = true,
  dice = [],
  toHit = 7,
  accuracy = null,
  critical = null
} = {}) {
  const allDice = normalizeDiceArray(dice);
  let initialDice = allDice.slice(0, 2);
  let keptDice = [];
  if (!trained) {
    const maxValue = Math.max(...allDice);
    const maxIndex = allDice.indexOf(maxValue);
    keptDice = allDice.filter((_, index) => index !== maxIndex).slice(0, 2);
    initialDice = keptDice;
  }
  const additionalDice = normalizeDiceArray(critical?.dice);
  const initialTotal = initialDice.reduce((sum, value) => sum + value, 0);
  const baseMoS = (initialTotal - (Number(toHit) || 7)) * 0.25;
  const accuracyValue = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;
  const accuracyMoS = accuracyValue === null ? 0 : accuracyValue * 0.25;
  const criticalMoS = Number(critical?.mos) || 0;
  const totalMoS = baseMoS + accuracyMoS + criticalMoS;
  const isSuccess = totalMoS >= 0;
  const baseIsSuccess = baseMoS >= 0;
  const criticalType = String(critical?.label || "").trim();
  let resultText = criticalType;
  if (!resultText && isSuccess && !baseIsSuccess) resultText = "Glancing Success";
  if (!resultText && !isSuccess && baseIsSuccess) resultText = "Narrow Success";
  if (!resultText) resultText = isSuccess ? "Success" : "Failure";
  return {
    toHit: Number(toHit) || 7,
    accuracy: accuracyValue,
    initialDice: trained ? initialDice : [],
    allDice: trained ? [] : allDice.slice(0, 3),
    keptDice: trained ? [] : keptDice,
    additionalDice,
    initialTotal,
    total: trained ? initialTotal + additionalDice.reduce((sum, value) => sum + value, 0) : initialTotal,
    baseMoS,
    accuracyMoS,
    criticalMoS,
    totalMoS,
    isSuccess,
    resultText,
    criticalType
  };
}

export async function showEdgeIndividualDiePrompt(flag) {
  const normalized = normalizeEdgeIndividualDieFlag(flag);
  if (!normalized?.dice.length) return { dieIndex: null, cancelled: true };
  const optionsHtml = normalized.dice
    .map((die, index) => `<option value="${index}">Die ${index + 1}: ${escapeHtml(die)}</option>`)
    .join("");
  const content = `
    <form class="pc-edge-individual-die-form">
      <div class="form-group" style="margin-bottom: 10px;">
        <label style="display:block; margin-bottom:5px; color:#b0b0b0;">Select Die:</label>
        <select class="pc-defense-prompt-select pc-select pc-dialog-field-full" name="edgeIndividualDieChoice">
          ${optionsHtml}
        </select>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;
    const finalize = (result) => {
      if (settled) return result;
      settled = true;
      if (closeWatcher) globalThis.window?.clearInterval?.(closeWatcher);
      resolve(result);
      return result;
    };

    renderDialogV2({
      title: getEdgeIndividualDieTitle(normalized),
      content,
      buttons: {
        select: {
          label: "Select",
          callback: async (html) => {
            const dieIndex = Number.parseInt(qs(html, '[name="edgeIndividualDieChoice"]')?.value, 10);
            if (!Number.isInteger(dieIndex) || dieIndex < 0 || dieIndex >= normalized.dice.length) return false;
            finalize({ dieIndex, cancelled: false });
            return true;
          }
        }
      },
      default: "select",
      render: (html) => {
        const dialogElement = toElement(html);
        if (!dialogElement) return;
        const viewportWidth = Number(globalThis.window?.innerWidth) || 480;
        const stableDialogWidth = Math.max(340, Math.min(400, viewportWidth - 32));
        dialogElement.style.width = `${stableDialogWidth}px`;
        dialogElement.style.minWidth = `${stableDialogWidth}px`;
        dialogElement.style.maxWidth = `${Math.max(320, viewportWidth - 32)}px`;
        for (const contentEl of qsa(dialogElement, ".window-content, .dialog-content")) {
          contentEl.style.overflowX = "hidden";
        }

        renderedWindow = dialogElement.closest(".application, dialog") || dialogElement;
        for (const closeButton of qsa(renderedWindow, '.header-control, [data-action="close"], [data-button="close"]')) {
          closeButton.addEventListener("click", () => finalize({ dieIndex: null, cancelled: true }));
        }
        if (!closeWatcher && globalThis.window?.setInterval) {
          closeWatcher = globalThis.window.setInterval(() => {
            if (!settled && renderedWindow && !renderedWindow.isConnected) {
              finalize({ dieIndex: null, cancelled: true });
            }
          }, 150);
        }
      }
    }, { classes: ["pc-edge-individual-die-dialog", "peasant-macro-dialog-force"] });
  });
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

function createEdgeChainContext({
  chainId = "",
  kind = "roll",
  label = "Roll",
  rerun = null,
  fallAccuracyApplied = false,
  fallAccuracyUsesSpent = 0,
  fallAccuracyBonus = 0,
  fallAccuracyUndoRecords = []
} = {}) {
  return {
    chainId: String(chainId || "").trim() || createId(),
    kind: String(kind || "roll").trim() || "roll",
    label: String(label || "Roll").trim() || "Roll",
    rerun: cloneData(rerun),
    fallAccuracyApplied: fallAccuracyApplied === true,
    fallAccuracyUsesSpent: Math.max(0, Number.parseInt(fallAccuracyUsesSpent, 10) || 0),
    fallAccuracyBonus: Math.max(0, Number.parseInt(fallAccuracyBonus, 10) || 0),
    fallAccuracyUndoRecords: collectRollUndoRecords(fallAccuracyUndoRecords)
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

function resolveUsageContextEntryIndex(actor, usageContext) {
  if (usageContext?.version !== 1) return -1;
  const collection = String(usageContext.ref?.collection || "").trim();
  if (!["skills", "notableCombats"].includes(collection)) return -1;
  const entryId = String(usageContext.ref?.entryId || "").trim();
  if (!entryId) return -1;
  const entries = Array.isArray(actor?.system?.[collection]) ? actor.system[collection] : [];
  const entryIndex = entries.findIndex((entry) => String(entry?.id || "").trim() === entryId);
  if (entryIndex < 0) return -1;
  const usageId = String(usageContext.ref?.usageId || "base").trim() || "base";
  if (usageId === "base") return entryIndex;
  return entries[entryIndex]?.usages?.some((usage) => String(usage?.id || "").trim() === usageId)
    ? entryIndex
    : -1;
}

async function validateReplayUsageContext(actorRef, usageContext) {
  if (usageContext?.version !== 1) return { ok: true };
  const actor = await resolveActorFromUuidOrId(actorRef);
  return actor && resolveUsageContextEntryIndex(actor, usageContext) >= 0
    ? { ok: true }
    : { ok: false, error: "The original entry usage was not found." };
}

async function refreshSkillEntryOffers(message, chainFlag, checkpoint, rollResult, replayResult = null, replayPlan = null) {
  const rerun = chainFlag?.rerun?.type === "peasantEntryUse" ? chainFlag.rerun : null;
  const usageContext = rerun?.usageContext?.version === 1
    ? rerun.usageContext
    : checkpoint?.usageContext;
  if (usageContext?.version !== 1) return;
  const actor = await resolveActorFromUuidOrId(rerun || checkpoint?.actor || checkpoint);
  if (usageContext.resolution === "targeted" && (replayResult?.rollOutcome || replayPlan?.offerTargets)) {
    const outcome = replayResult?.rollOutcome;
    const rolls = outcome?.multiTarget ? outcome.targetRolls || [] : outcome ? [outcome] : [];
    const targets = outcome ? rolls.map(roll => ({
      actorUuid: roll.targetRef?.actorUuid || null,
      success: roll.rollResult?.isSuccess,
      hit: checkpoint?.isHealRoll !== true && roll.rollResult?.isSuccess === true
    })) : replayPlan.offerTargets;
    const offerMessage = outcome?.sharedAttackRoll?.rollResult?.chatMessage || outcome?.rollResult?.chatMessage || message;
    const undoFlag = offerMessage.getFlag?.(PC_SYSTEM_ID, "rollUndo");
    const currentChain = getEdgeChainFlag(offerMessage);
    if (undoFlag?.status === "undone" && currentChain?.status === EDGE_CHAIN_STATUS_CURRENT) {
      await replaceRollUndoRecords(offerMessage,
        collectRollUndoRecords(currentChain.preRollRecords, currentChain.postRollRecords),
        undoFlag.label || "Undo Roll Effects");
    }
    await offerSkillEntryEffects({ actor, usageContext, message: offerMessage, targets });
    return;
  }
  if (usageContext.resolution !== "check" || !rollResult) return;
  await offerSkillEntryEffects({
    actor,
    usageContext,
    message,
    targets: [{ actorUuid: actor?.uuid, success: rollResult.isSuccess, hit: false }]
  });
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
  rollMode = "",
  usageContext = null
} = {}) {
  const combats = Array.isArray(actor?.system?.notableCombats) ? actor.system.notableCombats : [];
  const combat = combats[combatIndex] || null;
  const combatRef = getCombatRef(actor, combatIndex);
  const normalizedRollMode = String(rollMode || "").trim();
  const cardClasses = String(cardClass || "").split(/\s+/);
  const isDefense = cardClasses.includes("pc-defense-roll-card");
  const kind = normalizedRollMode === "heal" ? "heal" : (isDefense ? "defense" : "attack");
  const usageAware = usageContext?.version === 1;
  const label = usageAware
    ? (usageContext.data?.name || (kind === "heal" ? "Heal" : (kind === "defense" ? "Defense" : "Attack")))
    : (combat?.name || (kind === "heal" ? "Heal" : (kind === "defense" ? "Defense" : "Attack")));
  return createEdgeChainContext({
    kind,
    label,
    rerun: usageAware
      ? {
        type: "peasantEntryUse",
        ...getActorRef(actor),
        usageContext: cloneData(usageContext),
        promptForTargets: !!promptForTargets,
        rollOverrides: cloneData(rollOverrides),
        toHitAdj: Number.parseInt(toHitAdj, 10) || 0,
        accuracyAdj: Number.parseInt(accuracyAdj, 10) || 0,
        targetLabel: String(targetLabel || "").trim(),
        selectedDamageType: selectedDamageType ?? null,
        cardClass: String(cardClass || ""),
        rollMode: normalizedRollMode
      }
      : {
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
  cardClass = "",
  imageSrc = ""
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
      cardClass: String(cardClass || ""),
      imageSrc: String(imageSrc || "").trim()
    }
  });
}

export function createActorSkillEdgeChainContext({
  actor = null,
  skillIndex = null,
  skillName = "Skill",
  untrained = false,
  usageContext = null
} = {}) {
  const index = Number.parseInt(skillIndex, 10);
  return createEdgeChainContext({
    kind: "skill",
    label: `${skillName || "Skill"}${untrained ? " Untrained" : ""} Skill Roll`,
    rerun: usageContext?.version === 1
      ? {
          type: "peasantEntryUse",
          ...getActorRef(actor),
          usageContext: cloneData(usageContext)
        }
      : {
          type: "actorSkillRoll",
          ...getActorRef(actor),
          skillIndex: Number.isFinite(index) ? index : null
        }
  });
}

export async function finishSaveCheckRoll(rollResult, { kind, actor, asSave, skillName, speaker, style, onRollResult, allowPostRollActions = true }) {
  onRollResult?.(rollResult);
  if (!allowPostRollActions) return rollResult;

  const context = createEdgeChainContext({
    kind,
    label: skillName,
    rerun: {
      type: kind === "save" ? "savingRoll" : "consciousnessCheck",
      ...getActorRef(actor),
      toHit: rollResult.toHit,
      asSave,
      skillName,
      speaker: cloneData(speaker),
      style
    }
  });
  rollResult.forcePassResult = await maybeForcePassFailedRoll({
    actor,
    rollLabel: skillName,
    rollResult,
    kind,
    stressCostMultiplier: 2,
    fixedSpendType: "general"
  });
  const records = collectRollUndoRecords(rollResult.forcePassResult);
  await attachRollUndoToChatMessage(rollResult.chatMessage, records, { label: `Undo ${skillName} Effects` });
  await attachEdgeChainToChatMessage(rollResult.chatMessage, context, records, { postRollRecords: records });
  await attachEdgeIndividualDieToChatMessage(rollResult.chatMessage, rollResult, { kind, label: skillName });
  return rollResult;
}

function getEdgeEntireTitle(flag) {
  return flag?.kind === "save" ? "Edge Entire Save" : (flag?.kind === "check" ? "Edge Entire Check" : "Edge Entire Chain");
}

export function createActorAttributeSkillEdgeChainContext({
  actor = null,
  characteristic = "Untrained",
  woundAccuracyModifier = getDevastatingWoundAccuracyModifier(actor)
} = {}) {
  const label = String(characteristic || "Untrained").trim() || "Untrained";
  return createEdgeChainContext({
    kind: "untrainedSkill",
    label: `Untrained ${label} Skill Roll`,
    rerun: {
      type: "actorAttributeSkillRoll",
      ...getActorRef(actor),
      characteristic: label,
      woundAccuracyModifier
    }
  });
}

export function createManualCombatTagEdgeChainContext({
  actor = null,
  combatIndex = null,
  rollType = "",
  usageContext = null
} = {}) {
  const combats = Array.isArray(actor?.system?.notableCombats) ? actor.system.notableCombats : [];
  const combat = combats[combatIndex] || null;
  const combatRef = getCombatRef(actor, combatIndex);
  const normalizedRollType = String(rollType || "").trim();
  const usageAware = usageContext?.version === 1;
  return createEdgeChainContext({
    kind: normalizedRollType || "combatTag",
    label: (usageAware ? usageContext.data?.name : combat?.name) || normalizedRollType || "Combat",
    rerun: usageAware
      ? {
        type: "manualCombatTag",
        ...getActorRef(actor),
        usageContext: cloneData(usageContext),
        rollType: normalizedRollType
      }
      : {
        type: "manualCombatTag",
        ...getActorRef(actor),
        ...combatRef,
        rollType: normalizedRollType
      }
  });
}

export async function attachEdgeChainToChatMessage(message, context, records = [], options = {}) {
  if (!message?.setFlag || !context?.rerun) return null;
  const fallAccuracyUndoRecords = collectRollUndoRecords(context?.fallAccuracyUndoRecords);
  const undoRecords = collectRollUndoRecords(records, fallAccuracyUndoRecords);
  const preRollRecords = collectRollUndoRecords(options?.preRollRecords, fallAccuracyUndoRecords);
  const postRollRecords = collectRollUndoRecords(options?.postRollRecords);
  const existingFlag = getEdgeChainFlag(message);
  const saveContext = existingFlag?.kind === "save" || existingFlag?.kind === "check";
  if (saveContext && context.kind !== "save" && context.kind !== "check") {
    context = { ...context, kind: existingFlag.kind, label: existingFlag.label, rerun: existingFlag.rerun };
    options = { ...options, edgeBlockedReason: "", edgeBlockedLabel: "" };
  }
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
    edgeBlockedLabel: edgeBlock.edgeBlockedLabel,
    fallAccuracyApplied: context.fallAccuracyApplied === true,
    fallAccuracyUsesSpent: Math.max(0, Number.parseInt(context.fallAccuracyUsesSpent, 10) || 0),
    fallAccuracyBonus: Math.max(0, Number.parseInt(context.fallAccuracyBonus, 10) || 0)
  };
  await message.setFlag(PC_SYSTEM_ID, PC_EDGE_CHAIN_FLAG, flag);
  if (fallAccuracyUndoRecords.length) {
    const existingUndoFlag = message.getFlag?.(PC_SYSTEM_ID, "rollUndo") || {};
    const existingIds = new Set((existingUndoFlag.records || []).map(record => String(record?.id || "")).filter(Boolean));
    const missingFallRecords = fallAccuracyUndoRecords.filter(record => !existingIds.has(String(record.id || "")));
    if (missingFallRecords.length) {
      await attachRollUndoToChatMessage(message, missingFallRecords, {
        label: existingUndoFlag.label || `Undo ${flag.label} Effects`
      });
    }
  }
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

export async function attachEdgeIndividualDieToChatMessage(message, rollResult, {
  kind = "skill",
  label = "Roll",
  diceFaces = 6,
  trained = true,
  naturalDiceCount = 0,
  useStability = false,
  useStrengthen = false,
  flat = 0,
  rollType = "",
  checkpoint = null,
  rollKey = "",
  chainId = ""
} = {}) {
  if (!message?.setFlag) return null;
  const chainFlag = getEdgeChainFlag(message);
  if (chainFlag?.edgeBlockedReason) return null;

  const dice = kind === "skill"
    ? normalizeDiceArray(trained ? rollResult?.initialDice : rollResult?.allDice)
    : normalizeDiceArray(rollResult?.allDice);
  if (!dice.length) return null;

  const flag = createEdgeIndividualDieFlag({
    chainId: String(chainId || chainFlag?.chainId || "").trim(),
    kind,
    label,
    diceFaces,
    dice,
    trained,
    toHit: rollResult?.toHit,
    accuracy: rollResult?.accuracy,
    naturalDiceCount,
    useStability,
    useStrengthen,
    flat,
    rollType,
    checkpoint,
    rollKey
  });
  await message.setFlag(PC_SYSTEM_ID, PC_EDGE_INDIVIDUAL_DIE_FLAG, flag);
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

async function canUserRerollMessage(user, message, chainFlag) {
  if (canUserUpdateMessage(user, message)) return true;
  if (chainFlag?.kind !== "save" && chainFlag?.kind !== "check") return false;
  const actor = await resolveActorFromUuidOrId({
    actorUuid: chainFlag.rerun?.actorUuid,
    actorId: chainFlag.rerun?.actorId || chainFlag.rerun?.speaker?.actor
  });
  return !!actor && !getActorUpdatePermissionError(user, actor);
}

function getSaveCheckUndoRecords(message, chainFlag) {
  const checkpoint = getEdgeIndividualDieFlag(message)?.checkpoint;
  return checkpoint?.stage === "save"
    ? dedupeUndoRecords(collectRollUndoRecords(checkpoint.savePostRollRecords, getRollUndoRecordsFromMessage(message)))
    : chainFlag.undoRecords;
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

function isNotableCombatRerun(flag) {
  const rerun = flag?.rerun;
  return rerun?.type === "notableCombat"
    || (rerun?.type === "peasantEntryUse" && rerun.usageContext?.resolution === "targeted");
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
  if (message?.getFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG)?.processing) return false;
  const flag = getEdgeChainFlag(message);
  if (!canEdgeChainFlag(flag)) return false;

  const rollUndoFlag = message?.getFlag?.(PC_SYSTEM_ID, "rollUndo");
  if (rollUndoFlag?.status === "undone") return false;
  return true;
}

function canOfferStressRoll(message, kind) {
  const flag = message?.getFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG);
  if (!flag || flag.status !== "available" || flag.processing) return false;
  if (String(flag.kind || "roll").trim() !== kind) return false;

  const rollUndoFlag = message?.getFlag?.(PC_SYSTEM_ID, "rollUndo");
  if (rollUndoFlag?.status === "undone") return false;
  const chainFlag = getEdgeChainFlag(message);
  if (chainFlag && (chainFlag.status !== EDGE_CHAIN_STATUS_CURRENT || chainFlag.processing)) return false;

  let actor = flag.actorId ? game.actors?.get(flag.actorId) || null : null;
  if (!actor && flag.actorUuid && typeof fromUuidSync === "function") {
    try { actor = fromUuidSync(flag.actorUuid); } catch (_) {}
  }
  if (getActorUpdatePermissionError(game.user, actor)) return false;

  const checkpoint = message?.getFlag?.(PC_SYSTEM_ID, PC_EDGE_INDIVIDUAL_DIE_FLAG)?.checkpoint;
  const gmRoutedSave = ["save", "check"].includes(kind)
    && checkpoint?.version === 2
    && checkpoint?.type === "notableCombatPostRoll"
    && checkpoint?.stage === "save";
  return gmRoutedSave || canUserUpdateMessage(game.user, message);
}

function getStressRollFlag(message) {
  const flag = message?.getFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG);
  return flag && typeof flag === "object" ? cloneData(flag) : null;
}

async function setStressRollFlagOnMessage(message, flagPatch = {}) {
  if (!message?.setFlag) return null;
  const flag = getStressRollFlag(message);
  if (!flag) return null;
  const nextFlag = { ...flag, ...cloneData(flagPatch) };
  await message.setFlag(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG, nextFlag);
  return nextFlag;
}

async function clearStressRollRetry(message) {
  const flag = getStressRollFlag(message);
  if (!flag || flag.status !== "available") return;
  if (typeof message?.unsetFlag === "function") {
    await message.unsetFlag(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG);
    return;
  }
  await setStressRollFlagOnMessage(message, {
    status: "superseded",
    processing: false,
    processingUserId: null
  });
}

export function canEdgeIndividualDieMessage(message) {
  if (message?.getFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG)?.processing) return false;
  const flag = getEdgeIndividualDieFlag(message);
  if (!flag || flag.status !== EDGE_CHAIN_STATUS_CURRENT || flag.processing || flag.dice.length === 0) return false;

  const chainFlag = getEdgeChainFlag(message);
  if (!canEdgeChainFlag(chainFlag)) return false;
  if (flag.chainId && chainFlag.chainId && flag.chainId !== chainFlag.chainId) return false;

  const rollUndoFlag = message?.getFlag?.(PC_SYSTEM_ID, "rollUndo");
  return rollUndoFlag?.status !== "undone";
}

function canOfferEdgeExplode(message) {
  if (message?.getFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG)?.processing) return false;
  const explodeFlag = getEdgeExplodeFlag(message);
  if (!canEdgeExplodeFlag(explodeFlag)) return false;

  const chainFlag = getEdgeChainFlag(message);
  if (!canRerunChainForEdgeExplode(chainFlag)) return false;
  if (isNotableCombatRerun(chainFlag) && explodeFlag?.checkpoint?.version !== 2) return false;

  const rollUndoFlag = message?.getFlag?.(PC_SYSTEM_ID, "rollUndo");
  if (rollUndoFlag?.status === "undone") return false;
  return true;
}

function resolveFallBlessingActorSync(chainFlag) {
  const rerun = chainFlag?.rerun || {};
  const actorUuid = String(rerun.actorUuid || "").trim();
  if (actorUuid && typeof fromUuidSync === "function") {
    try {
      const resolved = fromUuidSync(actorUuid);
      if (resolved?.documentName === "Actor" || String(resolved?.collectionName || "").toLowerCase() === "actors") return resolved;
      if (resolved?.actor) return resolved.actor;
    } catch (_) {}
  }
  const actorId = String(rerun.actorId || rerun.speaker?.actor || "").trim();
  if (actorId) {
    const actor = game.actors?.get(actorId) || null;
    if (actor) return actor;
  }
  return null;
}

function isFallEligibleSkillChain(chainFlag) {
  const rerun = chainFlag?.rerun || {};
  if (["skill", "untrainedSkill"].includes(chainFlag?.kind)) {
    return ["skillRoll", "untrainedSkillRoll", "actorSkillRoll", "actorAttributeSkillRoll", "peasantEntryUse"].includes(rerun.type);
  }
  if (["attack", "defense", "heal"].includes(chainFlag?.kind)) {
    return rerun.type === "notableCombat"
      || (rerun.type === "peasantEntryUse" && rerun.usageContext?.resolution === "targeted");
  }
  return false;
}

function getFallBlessingEligibility(message, { user = game.user } = {}) {
  if (message?.getFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG)?.processing) return { ok: false };
  const chainFlag = getEdgeChainFlag(message);
  const rollFlag = getEdgeIndividualDieFlag(message);
  if (
    !chainFlag
    || chainFlag.status !== EDGE_CHAIN_STATUS_CURRENT
    || chainFlag.processing
    || chainFlag.fallAccuracyApplied
    || !isFallEligibleSkillChain(chainFlag)
    || rollFlag?.kind !== "skill"
    || rollFlag.status !== EDGE_CHAIN_STATUS_CURRENT
    || rollFlag.processing
    || !rollFlag.dice.length
    || (rollFlag.chainId && chainFlag.chainId && rollFlag.chainId !== chainFlag.chainId)
  ) return { ok: false };

  const rollUndoFlag = message?.getFlag?.(PC_SYSTEM_ID, "rollUndo");
  if (rollUndoFlag?.status === "undone") return { ok: false };

  const actor = resolveFallBlessingActorSync(chainFlag);
  const currentUses = Number(actor?.system?.fallBlessingUses?.value);
  if (
    !actor
    || String(actor.system?.blessing?.type || "").trim().toLowerCase() !== "fall"
    || !Number.isInteger(currentUses)
    || currentUses < 1
    || getActorUpdatePermissionError(user, actor)
  ) return { ok: false };

  return { ok: true, actor, currentUses, chainFlag, rollFlag, explodeFlag: getEdgeExplodeFlag(message) };
}

function canOfferFallBlessingAccuracy(message) {
  return getFallBlessingEligibility(message).ok;
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

async function setEdgeIndividualDieFlagOnMessage(message, flagPatch = {}) {
  if (!message?.setFlag) return null;
  const flag = getEdgeIndividualDieFlag(message);
  if (!flag) return null;
  const nextFlag = {
    ...flag,
    ...cloneData(flagPatch)
  };
  await message.setFlag(PC_SYSTEM_ID, PC_EDGE_INDIVIDUAL_DIE_FLAG, nextFlag);
  return nextFlag;
}

function getMessagesForChain(chainId) {
  const id = String(chainId || "").trim();
  if (!id) return [];
  return getAllChatMessages().filter((message) => {
    const flag = getEdgeChainFlag(message);
    return String(flag?.chainId || "").trim() === id && flag?.status === EDGE_CHAIN_STATUS_CURRENT;
  });
}

function getAutomaticEffectReplayBlock(message, chainFlag) {
  const related = getMessagesForChain(chainFlag?.chainId);
  return hasUnsettledAutomaticSkillEffects([message, ...related])
    ? { ok: false, error: "Automatic usage effects are still processing; retry this replay after they settle." }
    : null;
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

async function restoreEdgeIndividualDieCurrent(message) {
  await setEdgeIndividualDieFlagOnMessage(message, {
    status: EDGE_CHAIN_STATUS_CURRENT,
    processing: false,
    processingUserId: null
  });
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

function isFallBlessingAccuracyUndoRecord(record) {
  return record?.label === FALL_BLESSING_UNDO_LABEL
    && Object.keys(record?.before || {}).length === 1
    && Object.hasOwn(record?.before || {}, "system.fallBlessingUses.value");
}

function getFallBlessingAccuracyUndoRecords(...sources) {
  return dedupeUndoRecords(collectRollUndoRecords(...sources).filter(isFallBlessingAccuracyUndoRecord));
}

function invertUndoRecords(records = []) {
  return [...collectRollUndoRecords(records)].reverse().map(record => ({
    ...record,
    before: cloneData(record.after),
    after: cloneData(record.before),
    ...(record.entryCounters ? {
      entryCounters: record.entryCounters.map((counter) => ({
        ...cloneData(counter),
        before: counter.after,
        after: counter.before
      }))
    } : {}),
    ...(record.spellEffects ? {
      spellEffects: {
        before: cloneData(record.spellEffects.after),
        after: cloneData(record.spellEffects.before)
      }
    } : {}),
    ...(record.skillEffects ? {
      skillEffects: {
        before: cloneData(record.skillEffects.after),
        after: cloneData(record.skillEffects.before)
      }
    } : {})
  }));
}

async function replaceRollUndoRecords(message, records, label = "Undo Roll Effects") {
  if (!message?.setFlag) return;
  const nextRecords = dedupeUndoRecords(records);
  const existing = message.getFlag?.(PC_SYSTEM_ID, "rollUndo") || {};
  await message.setFlag(PC_SYSTEM_ID, "rollUndo", {
    ...existing,
    label,
    status: "available",
    records: nextRecords,
    createdAt: Date.now(),
    undoneAt: null,
    undoneBy: null
  });
}

function createEdgeChainContextFromFlag(flag) {
  return createEdgeChainContext({
    chainId: flag?.chainId,
    kind: flag?.kind,
    label: flag?.label,
    rerun: cloneData(flag?.rerun),
    fallAccuracyApplied: flag?.fallAccuracyApplied,
    fallAccuracyUsesSpent: flag?.fallAccuracyUsesSpent,
    fallAccuracyBonus: flag?.fallAccuracyBonus,
    fallAccuracyUndoRecords: collectRollUndoRecords(flag?.preRollRecords, flag?.undoRecords)
      .filter(isFallBlessingAccuracyUndoRecord)
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
  const fallEdgeChainContext = flag?.fallAccuracyApplied ? createEdgeChainContextFromFlag(flag) : null;
  if (rerun.type === "savingRoll" || rerun.type === "consciousnessCheck") {
    const handler = rerun.type === "savingRoll" ? game.peasantCore?.performSavingRoll : game.peasantCore?.performConsciousnessCheck;
    if (typeof handler !== "function") return { ok: false, error: "Save/check roll workflow is unavailable." };
    const actor = await resolveActorFromUuidOrId(rerun);
    if ((rerun.actorId || rerun.actorUuid) && !actor) return { ok: false, error: "The original roll actor was not found." };
    return {
      ok: true,
      run: (options = {}) => handler({
        actor,
        toHit: rerun.toHit,
        tn: rerun.toHit,
        asSave: rerun.asSave,
        skillName: rerun.skillName,
        speaker: cloneData(rerun.speaker),
        style: rerun.style,
        ...options
      })
    };
  }
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
        usageContext: cloneData(rerun.usageContext),
        ...(fallEdgeChainContext ? { edgeChainContext: fallEdgeChainContext } : {}),
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
        imageSrc: rerun.imageSrc,
        ...(fallEdgeChainContext ? { edgeChainContext: fallEdgeChainContext } : {}),
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
      run: () => rerunActorSkillRoll(actor, rerun.skillIndex, {
        edgeExplodeReroll,
        accuracyAdj: Number.parseInt(rerun.accuracyAdj, 10) || 0,
        edgeChainContext: fallEdgeChainContext
      })
    };
  }

  if (rerun.type === "peasantEntryUse") {
    const actor = await resolveActorFromUuidOrId({
      actorUuid: rerun.actorUuid,
      actorId: rerun.actorId
    });
    const handler = game.peasantCore?.startPeasantEntryUse;
    if (!actor) return { ok: false, error: "The original skill actor was not found." };
    if (typeof handler !== "function") return { ok: false, error: "Skill usage workflow is unavailable." };
    if (rerun.usageContext?.version !== 1) return { ok: false, error: "The original skill usage was unavailable." };
    const usageValidation = await validateReplayUsageContext(rerun, rerun.usageContext);
    if (!usageValidation.ok) return usageValidation;
    return {
      ok: true,
      run: () => handler({
        actor,
        replayContext: cloneData(rerun.usageContext),
        promptForTargets: rerun.promptForTargets,
        rollOverrides: cloneData(rerun.rollOverrides),
        toHitAdj: rerun.toHitAdj,
        accuracyAdj: rerun.accuracyAdj,
        targetLabel: rerun.targetLabel,
        selectedDamageType: rerun.selectedDamageType,
        cardClass: rerun.cardClass,
        rollMode: rerun.rollMode,
        ...(fallEdgeChainContext ? { edgeChainContext: fallEdgeChainContext } : {}),
        edgeExplodeReroll
      })
    };
  }

  if (rerun.type === "actorAttributeSkillRoll") {
    const actor = await resolveActorFromUuidOrId({
      actorUuid: rerun.actorUuid,
      actorId: rerun.actorId
    });
    if (!actor) return { ok: false, error: "The original skill actor was not found." };
    return {
      ok: true,
      run: () => rerunActorAttributeSkillRoll(actor, rerun.characteristic, {
        edgeExplodeReroll,
        accuracyAdj: Number.parseInt(rerun.accuracyAdj, 10) || 0,
        woundAccuracyModifier: Number.isFinite(rerun.woundAccuracyModifier) ? rerun.woundAccuracyModifier : undefined,
        edgeChainContext: fallEdgeChainContext
      })
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
    const usageAware = rerun.usageContext?.version === 1;
    const rerunRef = { ...rerun, combatName: rerun.combatName || flag?.label };
    const combatIndex = usageAware
      ? resolveUsageContextEntryIndex(actor, rerun.usageContext)
      : resolveNotableCombatIndex(actor, rerunRef);
    if (combatIndex < 0) {
      return {
        ok: false,
        error: usageAware ? "The original entry usage was not found." : getUnresolvedCombatError(rerunRef, "combat tag")
      };
    }
    return {
      ok: true,
      run: () => handler({
        actor,
        combatIndex,
        rollType: rerun.rollType,
        ...(usageAware ? { usageContext: cloneData(rerun.usageContext) } : {})
      })
    };
  }

  return { ok: false, error: "This roll chain cannot be rerun with Edge." };
}

async function rerunActorSkillRoll(actor, skillIndex, { edgeExplodeReroll = null, accuracyAdj = 0, edgeChainContext = null } = {}) {
  const index = Number.parseInt(skillIndex, 10);
  if (!actor || !Number.isFinite(index)) return { rolled: false, error: "Skill actor or index was unavailable." };

  const skills = Array.isArray(actor.system?.skills) ? actor.system.skills : [];
  const skill = skills[index] || null;
  if (!skill) return { rolled: false, error: "The original skill was not found." };

  const combatMods = getEffectiveSkillCombatModifiers(actor);
  const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
  const accuracyMod = Number.parseInt(combatMods.accuracy, 10) || 0;
  const skillTohit = parseOptionalInteger(skill.tohit, { min: 1 });
  const skillAccuracy = parseOptionalInteger(skill.accuracy, { allowSign: true });
  const baseTohit = hasOptionalInteger(skillTohit) ? skillTohit : 7;
  const baseAccuracy = skillAccuracy ?? 0;
  const skillCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
  const toHit = skillCalc.toHit;
  const accuracy = (Number(skillCalc.accuracy) || 0) + (Number.parseInt(accuracyAdj, 10) || 0);
  const isUntrained = String(skill.rank || "").trim().toLowerCase() === "u";
  const skillName = isUntrained
    ? `${skill.name || "Skill"} Untrained Skill Roll`
    : `${skill.name || "Skill"} Skill Roll`;
  const resolvedEdgeChainContext = edgeChainContext || createActorSkillEdgeChainContext({
    actor,
    skillIndex: index,
    skillName: skill.name || "Skill",
    untrained: isUntrained
  });

  const handler = isUntrained
    ? game.peasantCore?.performUntrainedSkillRoll
    : game.peasantCore?.performSkillRoll;
  if (typeof handler !== "function") return { rolled: false, error: "Skill roll workflow is unavailable." };

  const rollResult = await handler({
    toHit,
    accuracy: isUntrained
      ? getDevastatingWoundAccuracyModifier(actor) + (Number.parseInt(accuracyAdj, 10) || 0)
      : (accuracy !== 0 ? accuracy : undefined),
    skillName,
    speaker: ChatMessage.getSpeaker({ actor }),
    edgeChainContext: resolvedEdgeChainContext,
    edgeExplodeReroll
  });
  const forcePassResult = await maybeForcePassFailedRoll({
    actor,
    rollLabel: skillName,
    rollResult
  });

  const useResult = await captureActorRollUndo(
    actor,
    `${skill.name || "Skill"} Skill Use`,
    () => actor.consumePeasantSkillUse?.(index)
  );
  const undoRecords = collectRollUndoRecords(useResult.undoRecords, forcePassResult);
  await attachRollUndoToChatMessage(rollResult?.chatMessage, undoRecords, {
    label: `Undo ${skill.name || "Skill"} Roll Effects`
  });
  await attachEdgeChainToChatMessage(rollResult?.chatMessage, resolvedEdgeChainContext, undoRecords, {
    preRollRecords: useResult.undoRecords,
    postRollRecords: forcePassResult?.undoRecords
  });

  return {
    rolled: !!rollResult,
    rollResult,
    forcePassResult,
    undoRecords,
    chainCancelled: !!forcePassResult?.chainCancelled
  };
}

async function rerunActorAttributeSkillRoll(actor, characteristic, {
  edgeExplodeReroll = null,
  accuracyAdj = 0,
  woundAccuracyModifier = getDevastatingWoundAccuracyModifier(actor),
  edgeChainContext = null
} = {}) {
  const label = String(characteristic || "Untrained").trim() || "Untrained";
  const combatMods = actor.system?.combatMods || { toHit: 0 };
  const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
  const baseMap = computeBaseAttrToHits(actor.system || {});
  const baseToHit = Number.isFinite(baseMap[label]) ? baseMap[label] : 7;
  const rollTarget = applyToHitAccuracy(baseToHit, 0, toHitMod, woundAccuracyModifier, 2);
  const accuracy = (Number(rollTarget.accuracy) || 0) + (Number.parseInt(accuracyAdj, 10) || 0);
  const skillName = `Untrained ${label} Skill Roll`;
  const resolvedEdgeChainContext = edgeChainContext || createActorAttributeSkillEdgeChainContext({
    actor,
    characteristic: label,
    woundAccuracyModifier
  });
  const handler = game.peasantCore?.performUntrainedSkillRoll;
  if (typeof handler !== "function") return { rolled: false, error: "Skill roll workflow is unavailable." };

  const rollResult = await handler({
    toHit: rollTarget.toHit,
    accuracy: accuracy !== 0 ? accuracy : undefined,
    skillName,
    speaker: ChatMessage.getSpeaker({ actor }),
    edgeChainContext: resolvedEdgeChainContext,
    edgeExplodeReroll
  });
  const forcePassResult = await maybeForcePassFailedRoll({
    actor,
    rollLabel: skillName,
    rollResult
  });
  const undoRecords = collectRollUndoRecords(forcePassResult);
  await attachRollUndoToChatMessage(rollResult?.chatMessage, undoRecords, {
    label: `Undo ${label} Roll Effects`
  });
  await attachEdgeChainToChatMessage(rollResult?.chatMessage, resolvedEdgeChainContext, undoRecords, {
    preRollRecords: [],
    postRollRecords: forcePassResult?.undoRecords
  });

  return {
    rolled: !!rollResult,
    rollResult,
    forcePassResult,
    undoRecords,
    chainCancelled: !!forcePassResult?.chainCancelled
  };
}

function renderEdgeChainSummary({
  flag = null,
  rerunResult = null
} = {}) {
  const cancelled = !!(rerunResult?.chainCancelled || rerunResult?.cancelled);
  return `<fieldset class="skill-roll-card pc-edge-chain-roll-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <legend>${getEdgeEntireTitle(flag)}</legend>
    <div class="roll-details" style="display: block; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 12px; line-height: 1.55;">
      <div>Rerolled: ${escapeHtml(flag?.label || "Roll Chain")}</div>
      ${cancelled ? `<div>Result: ${escapeHtml("Rerun cancelled")}</div>` : ""}
    </div>
  </fieldset>`;
}

async function createEdgeChainSummary(options = {}) {
  const speaker = options.spenderActor ? ChatMessage.getSpeaker({ actor: options.spenderActor }) : ChatMessage.getSpeaker();
  const content = renderEdgeChainSummary(options);
  return ChatMessage.create(applyMessageMode({
    user: game.user?.id,
    speaker,
    content,
    ...(options.flag?.rerun?.type === "manualCombatTag"
      ? { sound: globalThis.CONFIG?.sounds?.dice ?? null }
      : {})
  }));
}

function renderFallBlessingSummary({ rollLabel = "Roll", originalMoS = 0, newMoS = 0 } = {}) {
  return `<fieldset class="skill-roll-card pc-fall-blessing-roll-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <legend>Blessing of Fall On ${escapeHtml(rollLabel || "Roll")}</legend>
    <div class="roll-details" style="display: block; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 12px; line-height: 1.55;">
      <div>Original MoS: ${originalMoS >= 0 ? "+" : ""}${originalMoS.toFixed(2)}</div>
      <div>New MoS: ${newMoS >= 0 ? "+" : ""}${newMoS.toFixed(2)}</div>
    </div>
  </fieldset>`;
}

async function createFallBlessingSummary({ actor, rollLabel, originalMoS, newMoS }) {
  return ChatMessage.create(applyMessageMode({
    user: game.user?.id,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
    content: renderFallBlessingSummary({ rollLabel, originalMoS, newMoS })
  }));
}

export function renderEdgeIndividualDieSummary({
  flag = null,
  originalDie = null,
  newDie = null
} = {}) {
  return `<fieldset class="skill-roll-card pc-edge-individual-die-roll-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <legend>${escapeHtml(getEdgeIndividualDieTitle(flag))}</legend>
    <div class="roll-details" style="display: block; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 12px; line-height: 1.55;">
      <div>Original Die: ${escapeHtml(originalDie)}</div>
      <div>New Die: ${escapeHtml(newDie)}</div>
    </div>
  </fieldset>`;
}

async function createEdgeIndividualDieSummary(options = {}) {
  const speaker = options.spenderActor ? ChatMessage.getSpeaker({ actor: options.spenderActor }) : ChatMessage.getSpeaker();
  return ChatMessage.create(applyMessageMode({
    user: game.user?.id,
    speaker,
    content: renderEdgeIndividualDieSummary(options),
    sound: globalThis.CONFIG?.sounds?.dice ?? null
  }));
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
      <div>Rerolled: ${escapeHtml(chainFlag?.label || criticalType)}</div>
      <div>Original Explosion Dice: ${escapeHtml(oldDice)}</div>
      ${newDice ? `<div>New Explosion Dice: ${escapeHtml(newDice)}</div>` : ""}
      ${cancelled ? `<div>Result: ${escapeHtml("Rerun cancelled")}</div>` : ""}
    </div>
  </fieldset>`;
  return ChatMessage.create(applyMessageMode({
    user: game.user?.id,
    speaker,
    content,
    sound: globalThis.CONFIG?.sounds?.dice ?? null
  }));
}

function getResultError(error) {
  return String(error?.message || error || "Edge Entire Chain failed.");
}

async function rollEdgeIndividualDie(faces) {
  const roll = await new Roll(`1d${Math.max(1, Number.parseInt(faces, 10) || 6)}`).evaluate();
  const value = Number(roll?.dice?.[0]?.results?.[0]?.result ?? roll?.total);
  if (!Number.isFinite(value)) throw new Error("The individual die could not be rerolled.");
  return Math.floor(value);
}

async function createIndividualSkillRollResult(message, flag, dice) {
  const trained = flag?.trained !== false;
  let criticalDice = dice.slice(0, 2);
  if (!trained) {
    const maxValue = Math.max(...dice);
    const maxIndex = dice.indexOf(maxValue);
    criticalDice = dice.filter((_, index) => index !== maxIndex).slice(0, 2);
  }
  const critical = await rollPeasantCriticalExplosion(criticalDice);
  return {
    ...createSkillResultFromIndividualDice({
      trained,
      dice,
      toHit: flag?.toHit ?? 7,
      accuracy: flag?.accuracy,
      critical
    }),
    chatMessage: message
  };
}

function createEdgeIndividualValueReplay(messages, selectedFlag, selectedDice) {
  const valuesByKey = new Map();
  for (const candidate of messages) {
    const candidateFlag = getEdgeIndividualDieFlag(candidate);
    const rollKey = String(candidateFlag?.rollKey || "").trim();
    if (!candidateFlag || candidateFlag.kind === "skill" || !rollKey) continue;
    valuesByKey.set(rollKey, candidateFlag.dice.slice());
  }
  if (selectedFlag?.kind !== "skill" && selectedFlag?.rollKey) {
    valuesByKey.set(selectedFlag.rollKey, normalizeDiceArray(selectedDice));
  }
  return {
    values: Array.from(valuesByKey, ([rollKey, dice]) => ({ rollKey, dice }))
  };
}

function findEdgeIndividualValueReplacement(message, flag, replayMessageIds = []) {
  const rollKey = String(flag?.rollKey || "").trim();
  return getMessagesByIds(replayMessageIds).find((candidate) => {
    if (candidate?.id === message?.id) return false;
    const candidateFlag = getEdgeIndividualDieFlag(candidate);
    return candidateFlag?.kind === flag?.kind && String(candidateFlag?.rollKey || "").trim() === rollKey;
  }) || null;
}

async function reconcileEdgeIndividualValueMessage(message, replacementMessage) {
  if (!message?.update || !replacementMessage) throw new Error("The replacement roll card was unavailable.");
  await message.update({ content: String(replacementMessage.content || "") });

  const rollUndoFlag = replacementMessage.getFlag?.(PC_SYSTEM_ID, "rollUndo");
  if (rollUndoFlag && message.setFlag) {
    await message.setFlag(PC_SYSTEM_ID, "rollUndo", cloneData(rollUndoFlag));
  }
  const individualFlag = replacementMessage.getFlag?.(PC_SYSTEM_ID, PC_EDGE_INDIVIDUAL_DIE_FLAG);
  if (individualFlag && message.setFlag) {
    await message.setFlag(PC_SYSTEM_ID, PC_EDGE_INDIVIDUAL_DIE_FLAG, cloneData(individualFlag));
  }
  await replacementMessage.delete?.();
}

async function replayManualEdgeIndividualValue({ flag, chainFlag, replacement }) {
  const checkpoint = flag?.checkpoint || {};
  const actor = await resolveActorFromUuidOrId({
    actorUuid: checkpoint.actorUuid,
    actorId: checkpoint.actorId
  });
  const handler = game.peasantCore?.rollManualCombatTag;
  if (!actor) throw new Error("The original roll actor was not found.");
  if (typeof handler !== "function") throw new Error("Combat tag roll workflow is unavailable.");
  const usageContext = checkpoint.usageContext?.version === 1 ? checkpoint.usageContext : null;
  const combatIndex = usageContext
    ? resolveUsageContextEntryIndex(actor, usageContext)
    : checkpoint.combatIndex;
  if (combatIndex < 0) throw new Error("The original entry usage was not found.");
  const result = await handler({
    actor,
    combatIndex,
    rollType: checkpoint.rollType || flag.rollType,
    diceOverride: replacement.dice,
    edgeChainContext: createEdgeChainContextFromFlag(chainFlag),
    ...(usageContext ? { usageContext: cloneData(usageContext) } : {})
  });
  if (!result?.chatMessage || result?.cancelled) throw new Error("The replacement roll was cancelled.");
  return {
    ok: true,
    rollOutcome: result,
    postRollRecords: getRollUndoRecordsFromMessage(result.chatMessage),
    messageIds: [result.chatMessage.id]
  };
}

async function applyEdgeSaveCheckRoll({ message, chainFlag, spenderActor, requester, dieIndex = null }) {
  const flag = getEdgeIndividualDieFlag(message);
  const individual = dieIndex !== null;
  const prepared = await prepareRerun(chainFlag);
  if (!prepared.ok) return prepared;
  let replacement = null;
  try {
    if (individual) {
      replaceEdgeIndividualDie(flag, dieIndex, flag?.dice?.[dieIndex]);
      replacement = replaceEdgeIndividualDie(flag, dieIndex, await rollEdgeIndividualDie(6));
    }
  } catch (error) {
    return { ok: false, error: getResultError(error) };
  }
  const checkpoint = flag?.checkpoint;
  const combatSave = checkpoint?.stage === "save" && checkpoint?.type === "notableCombatPostRoll";
  const parentFlag = combatSave ? getEdgeChainFlag(game.messages?.get(checkpoint.attackMessageId)) : null;
  const records = getSaveCheckUndoRecords(message, chainFlag);
  const permissionError = getUndoPermissionError(requester, records);
  if (permissionError) return { ok: false, error: permissionError };
  const snapshots = getMessagesForChain(chainFlag.chainId).map(candidate => ({
    message: candidate,
    content: candidate.content,
    flags: Object.fromEntries([PC_STRESS_ROLL_FLAG, PC_EDGE_CHAIN_FLAG, PC_EDGE_INDIVIDUAL_DIE_FLAG, PC_EDGE_EXPLODE_FLAG, "rollUndo"].map(key => [key, cloneData(candidate.getFlag?.(PC_SYSTEM_ID, key))]))
  }));
  const originalIds = new Set(snapshots.map(entry => entry.message.id));
  let edgeSpend = null;
  let undone = false;
  let rollResult = null;
  let summary = null;
  let replayResult = null;
  let replayUndoRecords = [];
  const replayProgress = [];
  try {
    await markEdgeChainMessagesProcessing(snapshots.map(entry => entry.message), requester?.id);
    if (individual) await clearStressRollRetry(message);
    const undo = await applyRollUndoRecords(records);
    if (!undo.ok) throw new Error(undo.error);
    undone = true;
    edgeSpend = await spendActorEdge(spenderActor);
    if (!edgeSpend.ok) throw new Error(edgeSpend.error);
    summary = individual
      ? await createEdgeIndividualDieSummary({ flag, spenderActor, ...replacement })
      : await createEdgeChainSummary({ flag: chainFlag, spenderActor });
    if (individual) await message.setFlag(PC_SYSTEM_ID, "rollUndo", { status: "available", records: [] });
    rollResult = await prepared.run({
      diceOverride: replacement?.dice || null,
      chatMessage: individual ? message : null,
      onRollResult: result => { rollResult = result; }
    });
    if (combatSave) {
      await setEdgeIndividualDieFlagOnMessage(rollResult.chatMessage, { checkpoint, chainId: chainFlag.chainId });
      const replay = game.peasantCore?.replayNotableCombatPostRollEffects;
      if (typeof replay !== "function") throw new Error("Combat save replay is unavailable.");
      const targetActor = await resolveActorFromUuidOrId(checkpoint.saveTargetRef);
      if (!targetActor) throw new Error("The original save target was not found.");
      const capturedReplay = await captureActorRollUndo(targetActor, "Save Reroll Effects", async () => {
        try {
          return await replay({
            checkpoint,
            rollResult,
            edgeIndividualDieReplay: createEdgeIndividualValueReplay(snapshots.map(entry => entry.message), flag, rollResult.allDice),
            onSaveReplayProgress: resolution => { replayProgress.push(resolution); }
          });
        } catch (error) {
          return { ok: false, error: getResultError(error) };
        }
      }, { includeSpellEffects: true });
      replayResult = capturedReplay.result;
      replayUndoRecords = capturedReplay.undoRecords;
      if (!replayResult?.ok) throw new Error(replayResult?.error || "Could not replay save effects.");
      const replacedRecordIds = new Set(records.map(record => record.id));
      const preRollRecords = dedupeUndoRecords(collectRollUndoRecords(
        (parentFlag?.preRollRecords || []).filter(record => !replacedRecordIds.has(record.id)),
        rollResult.forcePassResult
      ));
      const postRollRecords = dedupeUndoRecords(collectRollUndoRecords(
        (parentFlag?.postRollRecords || []).filter(record => !replacedRecordIds.has(record.id)),
        replayResult.postRollRecords
      ));
      const retiredMessages = snapshots.map(entry => entry.message).filter(candidate => (
        checkpoint.savePostMessageIds?.includes(candidate.id)
        && !replayResult.messageIds?.includes(candidate.id)
      ));
      await refreshEdgeChainMessagesForEdgeExplode({
        chainFlag: parentFlag || chainFlag,
        originalMessages: [...snapshots.map(entry => entry.message).filter(candidate => !retiredMessages.includes(candidate)), rollResult.chatMessage],
        replayMessageIds: replayResult.messageIds,
        preRollRecords,
        postRollRecords,
        summaryMessageId: summary.id
      });
      await markEdgeChainMessagesSuperseded(retiredMessages, { summaryMessageId: summary.id, edgedBy: requester?.id });
      const nextTargets = getEdgeIndividualDieFlag(rollResult.chatMessage)?.checkpoint?.targets;
      if (nextTargets) {
        for (const candidate of getMessagesForChain(chainFlag.chainId)) {
          const candidateFlag = getEdgeIndividualDieFlag(candidate);
          if (candidateFlag?.checkpoint?.type !== "notableCombatPostRoll") continue;
          await setEdgeIndividualDieFlagOnMessage(candidate, { checkpoint: { ...candidateFlag.checkpoint, targets: cloneData(nextTargets) } });
          const explodeFlag = getEdgeExplodeFlag(candidate);
          if (explodeFlag?.checkpoint?.type === "notableCombatPostRoll") {
            await candidate.setFlag(PC_SYSTEM_ID, PC_EDGE_EXPLODE_FLAG, { ...explodeFlag, checkpoint: { ...explodeFlag.checkpoint, targets: cloneData(nextTargets) } });
          }
        }
      }
      const attackMessage = game.messages?.get(checkpoint.attackMessageId);
      if (attackMessage?.setFlag) {
        await attackMessage.setFlag(PC_SYSTEM_ID, "rollUndo", {
          ...(attackMessage.getFlag(PC_SYSTEM_ID, "rollUndo") || {}),
          status: "available",
          records: dedupeUndoRecords(collectRollUndoRecords(preRollRecords, postRollRecords))
        });
      }
      if (!individual) await markEdgeChainMessagesSuperseded([message], { summaryMessageId: summary.id, edgedBy: requester?.id });
    } else if (individual) {
      const nextRecords = collectRollUndoRecords(rollResult.forcePassResult);
      await attachEdgeChainToChatMessage(message, chainFlag, nextRecords, { postRollRecords: nextRecords });
      await setEdgeIndividualDieFlagOnMessage(message, {
        chainId: chainFlag.chainId,
        summaryMessageId: summary.id,
        edgedBy: requester?.id,
        edgedAt: Date.now(),
        edgeSpentByActorUuid: spenderActor.uuid
      });
    } else {
      await markEdgeChainMessagesSuperseded(snapshots.map(entry => entry.message), {
        summaryMessageId: summary.id,
        edgedBy: requester?.id,
        edgeSpentByActorUuid: spenderActor.uuid
      });
    }
    return { ok: true, messageId: message.id, summaryMessageId: summary.id, rollResult, ...replacement };
  } catch (error) {
    await applyRollUndoRecords(collectRollUndoRecords(rollResult?.forcePassResult, replayUndoRecords));
    if (undone) {
      await applyRollUndoRecords(invertUndoRecords(records));
    }
    await refundActorEdge(spenderActor, edgeSpend);
    for (const snapshot of snapshots) {
      await snapshot.message.update({ content: snapshot.content });
      for (const [key, value] of Object.entries(snapshot.flags)) {
        if (value === undefined) await snapshot.message.unsetFlag?.(PC_SYSTEM_ID, key);
        else await snapshot.message.setFlag(PC_SYSTEM_ID, key, value);
      }
    }
    const partialMessages = replayProgress.flatMap(resolution => [
      resolution?.damageRoll?.chatMessage,
      ...(resolution?.damageRoll?.barrierMessages || []),
      resolution?.application?.applyResult?.chatMessage
    ]);
    for (const candidate of new Set([summary, rollResult?.chatMessage, ...getMessagesByIds(replayResult?.messageIds), ...partialMessages])) {
      if (candidate && !originalIds.has(candidate.id)) await candidate.delete?.();
    }
    return { ok: false, error: getResultError(error) };
  }
}

export async function applyEdgeIndividualDieRoll(payload = {}) {
  const messageId = String(payload.messageId || "").trim();
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) return { ok: false, error: "Roll message was not found." };
  if (!canEdgeIndividualDieMessage(message)) {
    return { ok: false, error: "This roll cannot use Edge Individual Die." };
  }

  const flag = getEdgeIndividualDieFlag(message);
  const chainFlag = getEdgeChainFlag(message);
  const requester = game.users?.get(payload.requesterUserId || payload.userId) || game.user;
  if (!await canUserRerollMessage(requester, message, chainFlag)) {
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
  const automaticBlock = getAutomaticEffectReplayBlock(message, chainFlag);
  if (automaticBlock) return automaticBlock;

  const rerunUsageContext = chainFlag?.rerun?.type === "peasantEntryUse"
    ? chainFlag.rerun.usageContext
    : null;
  const checkpointUsageContext = flag.checkpoint?.usageContext?.version === 1
    ? flag.checkpoint.usageContext
    : null;
  const usageContext = rerunUsageContext?.version === 1 ? rerunUsageContext : checkpointUsageContext;
  const usageActorRef = rerunUsageContext?.version === 1
    ? chainFlag.rerun
    : (flag.checkpoint?.actor || flag.checkpoint);
  const usageValidation = await validateReplayUsageContext(usageActorRef, usageContext);
  if (!usageValidation.ok) return usageValidation;

  if (flag.kind === "save" || flag.kind === "check") {
    if (!Number.isInteger(Number.parseInt(payload.dieIndex, 10))) return { ok: false, error: "The selected die was unavailable." };
    if (!game.user?.isGM && flag.checkpoint?.stage === "save") {
      const request = game.peasantCore?.requestEdgeSaveCheckRollFromGM;
      return typeof request === "function"
        ? request({ ...payload, individual: true })
        : { ok: false, error: "Combat save rerolls require an active GM connection." };
    }
    return applyEdgeSaveCheckRoll({ message, chainFlag, spenderActor, requester, dieIndex: payload.dieIndex });
  }

  let replacement;
  let rollResult = null;
  try {
    const newDie = await rollEdgeIndividualDie(flag.diceFaces);
    replacement = replaceEdgeIndividualDie(flag, payload.dieIndex, newDie);
    if (flag.kind === "skill") {
      rollResult = await createIndividualSkillRollResult(message, flag, replacement.dice);
    } else if (
      flag.checkpoint?.type !== "notableCombatPostRoll"
      && flag.checkpoint?.type !== "manualCombatValue"
    ) {
      throw new Error("This roll value does not have replay data.");
    }
  } catch (error) {
    return { ok: false, error: getResultError(error) };
  }

  const originalChainMessages = getMessagesForChain(chainFlag.chainId);
  const originalOfferFlags = originalChainMessages.map(candidate => ({
    message: candidate,
    offers: cloneData(candidate.getFlag?.(PC_SYSTEM_ID, "skillEffectOffers")),
    rollUndo: cloneData(candidate.getFlag?.(PC_SYSTEM_ID, "rollUndo"))
  }));
  const originalStressFlag = getStressRollFlag(message);
  const edgeIndividualDieReplay = createEdgeIndividualValueReplay(
    originalChainMessages,
    flag,
    replacement.dice
  );
  await markEdgeChainMessagesProcessing(originalChainMessages, requester?.id || null);
  await setEdgeIndividualDieFlagOnMessage(message, {
    status: EDGE_CHAIN_STATUS_PROCESSING,
    processing: true,
    processingUserId: requester?.id || null
  });

  const oldContent = String(message.content || "");
  let edgeSpend = null;
  let replayPlan = null;
  let replayResult = null;
  let summaryMessage = null;
  let replayMessageIds = [];
  let undoneRecords = [];
  try {
    await clearStressRollRetry(message);
    const checkpoint = flag.checkpoint;
    let replayRequired = false;
    if (flag.kind === "skill" && checkpoint?.version === 2) {
      const planReplay = game.peasantCore?.planNotableCombatEdgeExplodeReplay;
      if (typeof planReplay !== "function") throw new Error("Notable combat Edge replay planner is unavailable.");
      replayPlan = await planReplay({ checkpoint, rollResult });
      if (!replayPlan?.ok) throw new Error(replayPlan?.error || "Could not evaluate downstream Edge effects.");
      replayRequired = !!replayPlan.replayRequired;
    } else if (flag.kind !== "skill") {
      replayRequired = replacement.newDie !== replacement.originalDie;
    }

    const postRollRecords = checkpoint?.type === "manualCombatValue"
      ? chainFlag.undoRecords
      : getEdgeExplodePostRollRecords(chainFlag, flag);
    const appliedOfferRecords = postRollRecords.filter(record => record.skillEffects);
    const recordsToUndo = replayRequired ? postRollRecords : appliedOfferRecords;
    if (recordsToUndo.length) {
      const undoPermissionError = getUndoPermissionError(requester, recordsToUndo);
      if (undoPermissionError) throw new Error(undoPermissionError);
      const undoResult = await applyRollUndoRecords(recordsToUndo);
      if (!undoResult.ok) throw new Error(undoResult.error || "Could not undo the original post-roll effects.");
      undoneRecords = recordsToUndo;
      if (replayRequired) await markPostRollUndoMessagesUndone(originalChainMessages, postRollRecords, {
        undoneBy: requester?.id || null
      });
    }

    edgeSpend = await spendActorEdge(spenderActor);
    if (!edgeSpend.ok) throw new Error(edgeSpend.error || "Could not spend Edge.");

    summaryMessage = await createEdgeIndividualDieSummary({
      flag,
      spenderActor,
      originalDie: replacement.originalDie,
      newDie: replacement.newDie
    });
    if (flag.kind === "skill") {
      await updateSkillRollChatCardFromResult(rollResult, { label: rollResult.resultText });
    }

    if (replayRequired) {
      if (checkpoint?.type === "manualCombatValue") {
        replayResult = await replayManualEdgeIndividualValue({ flag, chainFlag, replacement });
      } else {
        const replay = game.peasantCore?.replayNotableCombatPostRollEffects;
        if (typeof replay !== "function") throw new Error("Notable combat Edge replay is unavailable.");
        replayResult = await replay({ checkpoint, rollResult, edgeIndividualDieReplay });
      }
      if (!replayResult?.ok) throw new Error(replayResult?.error || "Could not replay downstream roll effects.");
      replayMessageIds = Array.from(replayResult?.messageIds || []);

      if (flag.kind !== "skill") {
        const replacementMessage = findEdgeIndividualValueReplacement(message, flag, replayMessageIds);
        if (!replacementMessage) throw new Error("The replacement roll card was unavailable.");
        await reconcileEdgeIndividualValueMessage(message, replacementMessage);
        replayMessageIds = replayMessageIds.filter((messageId) => messageId !== replacementMessage.id);
      }
    }

    const nextPostRollRecords = replayRequired
      ? dedupeUndoRecords(replayResult?.postRollRecords)
      : postRollRecords.filter(record => !appliedOfferRecords.includes(record));
    const nextPreRollRecords = getEdgeExplodePreRollRecords(chainFlag, flag);
    const nextEdgeBlock = getCriticalEdgeBlockFromRollResult(rollResult);
    if (chainFlag.fallAccuracyApplied && replayRequired) {
      const existingUndo = message.getFlag?.(PC_SYSTEM_ID, "rollUndo") || {};
      await replaceRollUndoRecords(message, collectRollUndoRecords(nextPreRollRecords, nextPostRollRecords), existingUndo.label || "Undo Roll Effects");
    }
    await refreshEdgeChainMessagesForEdgeExplode({
      chainFlag: { ...chainFlag, ...nextEdgeBlock },
      originalMessages: originalChainMessages,
      replayMessageIds,
      preRollRecords: nextPreRollRecords,
      postRollRecords: nextPostRollRecords,
      summaryMessageId: summaryMessage?.id || null
    });
    if (appliedOfferRecords.length && !replayRequired) {
      await replaceRollUndoRecords(message, collectRollUndoRecords(nextPreRollRecords, nextPostRollRecords));
    }
    await setEdgeIndividualDieFlagOnMessage(message, {
      status: EDGE_CHAIN_STATUS_CURRENT,
      processing: false,
      processingUserId: null,
      dice: replacement.dice,
      summaryMessageId: summaryMessage?.id || null,
      edgedBy: requester?.id || null,
      edgedAt: Date.now(),
      edgeSpentByActorUuid: spenderActor?.uuid || null
    });
    if (flag.kind === "skill") {
      await attachEdgeExplodeToChatMessage(message, rollResult, {
        trained: flag.trained,
        skillName: flag.label,
        stage: flag.checkpoint?.stage || "",
        checkpoint: flag.checkpoint,
        preRollRecords: nextPreRollRecords,
        postRollRecords: nextPostRollRecords
      });
    }
    await refreshSkillEntryOffers(message, chainFlag, flag.checkpoint, rollResult, replayResult, replayPlan);
  } catch (error) {
    if (replayResult?.postRollRecords?.length) await applyRollUndoRecords(replayResult.postRollRecords);
    if (undoneRecords.length) await applyRollUndoRecords(invertUndoRecords(undoneRecords));
    await refundActorEdge(spenderActor, edgeSpend);
    await restoreEdgeChainMessagesCurrent(originalChainMessages);
    await restoreEdgeIndividualDieCurrent(message);
    for (const snapshot of originalOfferFlags) {
      for (const [key, value] of [["skillEffectOffers", snapshot.offers], ["rollUndo", snapshot.rollUndo]]) {
        if (value === undefined) await snapshot.message.unsetFlag?.(PC_SYSTEM_ID, key);
        else await snapshot.message.setFlag?.(PC_SYSTEM_ID, key, value);
      }
    }
    if (originalStressFlag) await message.setFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG, originalStressFlag);
    if (oldContent && message?.update) {
      try { await message.update({ content: oldContent }); } catch (_) {}
    }
    try { await summaryMessage?.delete?.(); } catch (_) {}
    for (const candidate of getMessagesByIds(replayMessageIds)) {
      if (!originalChainMessages.some(original => original.id === candidate.id)) await candidate.delete?.();
    }
    console.error("Peasant Core | Edge Individual Die failed", error);
    return { ok: false, error: getResultError(error) };
  }

  return {
    ok: true,
    messageId: message.id,
    chainId: chainFlag.chainId,
    summaryMessageId: summaryMessage?.id || null,
    originalDie: replacement.originalDie,
    newDie: replacement.newDie,
    rollResult,
    replayPlan,
    replayResult
  };
}

export async function applyEdgeChainRoll(payload = {}) {
  const messageId = String(payload.messageId || "").trim();
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) return { ok: false, error: "Roll message was not found." };
  if (message.getFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG)?.processing) {
    return { ok: false, error: "This roll is currently processing Stress." };
  }

  const flag = getEdgeChainFlag(message);
  const blockedError = getEdgeChainBlockedError(flag);
  if (blockedError) {
    return { ok: false, error: blockedError };
  }
  if (!canEdgeChainFlag(flag)) {
    return { ok: false, error: "This roll chain cannot be edged." };
  }

  const requester = game.users?.get(payload.requesterUserId || payload.userId) || game.user;
  if (!await canUserRerollMessage(requester, message, flag)) {
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
  const automaticBlock = getAutomaticEffectReplayBlock(message, flag);
  if (automaticBlock) return automaticBlock;

  if (flag.kind === "save" || flag.kind === "check") {
    if (!game.user?.isGM && getEdgeIndividualDieFlag(message)?.checkpoint?.stage === "save") {
      const request = game.peasantCore?.requestEdgeSaveCheckRollFromGM;
      return typeof request === "function"
        ? request({ ...payload, individual: false })
        : { ok: false, error: "Combat save rerolls require an active GM connection." };
    }
    return applyEdgeSaveCheckRoll({ message, chainFlag: flag, spenderActor, requester });
  }

  const undoPermissionError = getUndoPermissionError(requester, flag.undoRecords);
  if (undoPermissionError) return { ok: false, error: undoPermissionError };

  const rerunUndoRecords = flag.fallAccuracyApplied
    ? dedupeUndoRecords(flag.undoRecords.filter(record => !isFallBlessingAccuracyUndoRecord(record)))
    : flag.undoRecords;

  const preparedRerun = await prepareRerun(flag);
  if (!preparedRerun.ok) return preparedRerun;

  const originalChainMessages = getMessagesForChain(flag.chainId);
  const originalOfferFlags = originalChainMessages.map(candidate => ({
    message: candidate,
    offers: cloneData(candidate.getFlag?.(PC_SYSTEM_ID, "skillEffectOffers")),
    rollUndo: cloneData(candidate.getFlag?.(PC_SYSTEM_ID, "rollUndo"))
  }));
  await markEdgeChainMessagesProcessing(originalChainMessages, requester?.id || null);

  let edgeSpend = null;
  let originalUndone = false;
  let rerunResult = null;
  let summaryMessage = null;
  try {
    const undoResult = await applyRollUndoRecords(rerunUndoRecords);
    if (!undoResult.ok) throw new Error(undoResult.error || "Could not undo the original roll chain.");
    originalUndone = true;

    edgeSpend = await spendActorEdge(spenderActor);
    if (!edgeSpend.ok) throw new Error(edgeSpend.error || "Could not spend Edge.");

    summaryMessage = await createEdgeChainSummary({ flag, spenderActor });
    rerunResult = await preparedRerun.run();
    if (rerunResult?.chainCancelled || rerunResult?.cancelled) {
      await summaryMessage?.update?.({ content: renderEdgeChainSummary({ flag, spenderActor, rerunResult }) });
    }
    await markEdgeChainMessagesSuperseded(originalChainMessages, {
      summaryMessageId: summaryMessage?.id || null,
      edgedBy: requester?.id || null,
      edgeSpentByActorUuid: spenderActor?.uuid || null
    });
  } catch (error) {
    await refundActorEdge(spenderActor, edgeSpend);
    if (originalUndone) await applyRollUndoRecords(invertUndoRecords(rerunUndoRecords));
    await restoreEdgeChainMessagesCurrent(originalChainMessages);
    for (const snapshot of originalOfferFlags) {
      for (const [key, value] of [["skillEffectOffers", snapshot.offers], ["rollUndo", snapshot.rollUndo]]) {
        if (value === undefined) await snapshot.message.unsetFlag?.(PC_SYSTEM_ID, key);
        else await snapshot.message.setFlag?.(PC_SYSTEM_ID, key, value);
      }
    }
    try {
      await summaryMessage?.delete?.();
    } catch (summaryError) {
      console.error("Peasant Core | Failed to remove Edge Entire Chain summary after rerun failure", summaryError);
    }
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
  if (message.getFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG)?.processing) {
    return { ok: false, error: "This roll is currently processing Stress." };
  }

  const explodeFlag = getEdgeExplodeFlag(message);
  if (!canEdgeExplodeFlag(explodeFlag)) {
    return { ok: false, error: "This roll's explosion dice cannot be edged." };
  }

  const chainFlag = getEdgeChainFlag(message);
  if (!canRerunChainForEdgeExplode(chainFlag)) {
    return { ok: false, error: "This roll chain cannot be rerun for Edge Explode." };
  }
  const isNotableCombat = isNotableCombatRerun(chainFlag);
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
  const automaticBlock = getAutomaticEffectReplayBlock(message, chainFlag);
  if (automaticBlock) return automaticBlock;

  const originalChainMessages = getMessagesForChain(chainFlag.chainId);
  const originalOfferFlags = originalChainMessages.map(candidate => ({
    message: candidate,
    offers: cloneData(candidate.getFlag?.(PC_SYSTEM_ID, "skillEffectOffers")),
    rollUndo: cloneData(candidate.getFlag?.(PC_SYSTEM_ID, "rollUndo"))
  }));
  const originalStressFlag = getStressRollFlag(message);
  await markEdgeChainMessagesProcessing(originalChainMessages, requester?.id || null);
  await markEdgeExplodeProcessing(message, requester?.id || null);

  let edgeSpend = null;
  let rollResult = null;
  let replayPlan = null;
  let replayResult = null;
  let summaryMessage = null;
  let undoneRecords = [];
  try {
    await clearStressRollRetry(message);
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

    const appliedOfferRecords = postRollRecords.filter(record => record.skillEffects);
    const recordsToUndo = replayRequired ? postRollRecords : appliedOfferRecords;
    if (recordsToUndo.length) {
      const undoPermissionError = getUndoPermissionError(requester, recordsToUndo);
      if (undoPermissionError) throw new Error(undoPermissionError);

      const undoResult = await applyRollUndoRecords(recordsToUndo);
      if (!undoResult.ok) throw new Error(undoResult.error || "Could not undo the original post-roll effects.");
      undoneRecords = recordsToUndo;
      if (replayRequired) await markPostRollUndoMessagesUndone(originalChainMessages, postRollRecords, {
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
      : postRollRecords.filter(record => !appliedOfferRecords.includes(record));
    const nextPreRollRecords = getEdgeExplodePreRollRecords(chainFlag, explodeFlag);
    if (chainFlag.fallAccuracyApplied && replayRequired) {
      const existingUndo = message.getFlag?.(PC_SYSTEM_ID, "rollUndo") || {};
      await replaceRollUndoRecords(message, collectRollUndoRecords(nextPreRollRecords, nextPostRollRecords), existingUndo.label || "Undo Roll Effects");
    }
    summaryMessage = await createEdgeExplodeSummary({ chainFlag, explodeFlag, spenderActor, rerunResult: replayResult, rollResult, replayPlan });
    await refreshEdgeChainMessagesForEdgeExplode({
      chainFlag,
      originalMessages: originalChainMessages,
      replayMessageIds: replayResult?.messageIds || [],
      preRollRecords: nextPreRollRecords,
      postRollRecords: nextPostRollRecords,
      summaryMessageId: summaryMessage?.id || null
    });
    if (appliedOfferRecords.length && !replayRequired) {
      await replaceRollUndoRecords(message, collectRollUndoRecords(nextPreRollRecords, nextPostRollRecords));
    }
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
    await refreshSkillEntryOffers(message, chainFlag, explodeFlag.checkpoint, rollResult, replayResult, replayPlan);
  } catch (error) {
    if (replayResult?.postRollRecords?.length) await applyRollUndoRecords(replayResult.postRollRecords);
    if (undoneRecords.length) await applyRollUndoRecords(invertUndoRecords(undoneRecords));
    await refundActorEdge(spenderActor, edgeSpend);
    await restoreEdgeChainMessagesCurrent(originalChainMessages);
    await restoreEdgeExplodeCurrent(message);
    for (const snapshot of originalOfferFlags) {
      for (const [key, value] of [["skillEffectOffers", snapshot.offers], ["rollUndo", snapshot.rollUndo]]) {
        if (value === undefined) await snapshot.message.unsetFlag?.(PC_SYSTEM_ID, key);
        else await snapshot.message.setFlag?.(PC_SYSTEM_ID, key, value);
      }
    }
    if (originalStressFlag) await message.setFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG, originalStressFlag);
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

  const permissionError = getUndoPermissionError(game.user,
    flag.kind === "save" || flag.kind === "check" ? getSaveCheckUndoRecords(message, flag) : flag.undoRecords);
  if (permissionError) {
    ui.notifications?.warn?.(permissionError);
    return false;
  }

  const spender = resolveEdgeLocationRollSpender({ warn: true, label: getEdgeEntireTitle(flag) });
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
    ui.notifications?.warn?.(result?.error || `${getEdgeEntireTitle(flag)} failed.`);
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

export async function edgeIndividualDieRollFromMessage(messageId) {
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) {
    ui.notifications?.warn?.("Roll message was not found.");
    return false;
  }
  if (!canEdgeIndividualDieMessage(message)) {
    ui.notifications?.warn?.("This roll cannot use Edge Individual Die.");
    return false;
  }

  const flag = getEdgeIndividualDieFlag(message);
  const spender = resolveEdgeLocationRollSpender({ warn: true, label: "Edge Individual Die" });
  if (!spender.ok) return false;
  const selection = await showEdgeIndividualDiePrompt(flag);
  if (selection?.cancelled || !Number.isInteger(selection?.dieIndex)) return false;

  const selectedToken = Array.from(canvas?.tokens?.controlled || [])
    .find(token => token?.actor?.uuid === spender.actor?.uuid) || null;
  const tokenDocument = selectedToken?.document ?? selectedToken ?? null;
  const result = await applyEdgeIndividualDieRoll({
    requesterUserId: game.user?.id || null,
    messageId: message.id,
    spenderActorId: spender.actor?.id || null,
    spenderActorUuid: spender.actor?.uuid || null,
    spenderTokenUuid: tokenDocument?.uuid || null,
    dieIndex: selection.dieIndex
  });
  if (!result?.ok) {
    ui.notifications?.warn?.(result?.error || "Edge Individual Die failed.");
    return false;
  }
  return true;
}

export async function applyStressRoll(payload = {}) {
  const messageId = String(payload.messageId || "").trim();
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) return { ok: false, error: "Roll message was not found." };

  const flag = getStressRollFlag(message);
  if (!flag || flag.status !== "available" || flag.processing) {
    return { ok: false, error: "This roll cannot be stressed." };
  }
  const originalStressFlag = cloneData(flag);
  if (message?.getFlag?.(PC_SYSTEM_ID, "rollUndo")?.status === "undone") {
    return { ok: false, error: "This roll has already been undone." };
  }

  const chainFlag = getEdgeChainFlag(message);
  if (chainFlag && (chainFlag.status !== EDGE_CHAIN_STATUS_CURRENT || chainFlag.processing)) {
    return { ok: false, error: "This roll can no longer be stressed." };
  }
  const requester = game.users?.get(payload.requesterUserId || payload.userId) || game.user;
  const actor = await resolveActorFromUuidOrId({ actorUuid: flag.actorUuid, actorId: flag.actorId });
  const permissionError = getActorUpdatePermissionError(requester, actor);
  if (permissionError) return { ok: false, error: permissionError };
  if (!await canUserRerollMessage(requester, message, chainFlag)) {
    return { ok: false, error: "You cannot update this chat message." };
  }
  const automaticBlock = getAutomaticEffectReplayBlock(message, chainFlag);
  if (automaticBlock) return automaticBlock;

  const individualFlag = getEdgeIndividualDieFlag(message);
  const checkpoint = individualFlag?.checkpoint;
  const rerunUsageContext = chainFlag?.rerun?.type === "peasantEntryUse"
    ? chainFlag.rerun.usageContext
    : null;
  const checkpointUsageContext = checkpoint?.usageContext?.version === 1
    ? checkpoint.usageContext
    : null;
  const usageContext = rerunUsageContext?.version === 1 ? rerunUsageContext : checkpointUsageContext;
  const usageActorRef = rerunUsageContext?.version === 1 ? chainFlag.rerun : checkpoint?.actor;
  const usageValidation = await validateReplayUsageContext(usageActorRef, usageContext);
  if (!usageValidation.ok) return usageValidation;
  const replayRequired = checkpoint?.version === 2 && checkpoint?.type === "notableCombatPostRoll";
  const parentChainFlag = replayRequired && checkpoint.stage === "save"
    ? getEdgeChainFlag(game.messages?.get(checkpoint.attackMessageId)) || chainFlag
    : chainFlag;
  const originalChainMessages = chainFlag ? getMessagesForChain(chainFlag.chainId) : [message];
  const snapshots = originalChainMessages.map(candidate => ({
    message: candidate,
    content: String(candidate.content || ""),
    flags: Object.fromEntries([PC_STRESS_ROLL_FLAG, PC_EDGE_CHAIN_FLAG, PC_EDGE_INDIVIDUAL_DIE_FLAG, PC_EDGE_EXPLODE_FLAG, "rollUndo", "skillEffectOffers"]
      .map(key => [key, cloneData(candidate.getFlag?.(PC_SYSTEM_ID, key))]))
  }));
  const originalIds = new Set(originalChainMessages.map(candidate => candidate.id));
  const appliedOfferRecords = dedupeUndoRecords(originalChainMessages.flatMap(candidate =>
    collectRollUndoRecords(getEdgeChainFlag(candidate)?.postRollRecords).filter(record => record.skillEffects)));
  const replacedPostRollRecords = replayRequired
    ? (checkpoint.stage === "save"
      ? dedupeUndoRecords(collectRollUndoRecords(getSaveCheckUndoRecords(message, chainFlag), appliedOfferRecords))
      : dedupeUndoRecords(collectRollUndoRecords(getEdgeExplodePostRollRecords(chainFlag, individualFlag), appliedOfferRecords)))
    : appliedOfferRecords;
  const rollResult = { ...cloneData(flag.rollResult), chatMessage: message };
  let forcePassResult = null;
  let replayResult = null;
  let replayUndoRecords = [];
  const replayProgress = [];
  let downstreamUndone = false;

  try {
    await setStressRollFlagOnMessage(message, {
      status: "processing",
      processing: true,
      processingUserId: requester?.id || null
    });
    forcePassResult = await maybeForcePassFailedRoll({
      actor,
      rollLabel: flag.rollLabel,
      rollResult,
      kind: flag.kind,
      stressCostMultiplier: flag.stressCostMultiplier,
      fixedSpendType: flag.fixedSpendType
    });
    if (!forcePassResult?.forced) {
      await message.setFlag(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG, originalStressFlag);
      return { ok: false, cancelled: !!forcePassResult?.chainCancelled, error: forcePassResult?.reason || "Stress was not spent." };
    }

    const stressRecords = collectRollUndoRecords(forcePassResult);
    let preRollRecords = dedupeUndoRecords(chainFlag?.preRollRecords);
    let postRollRecords = dedupeUndoRecords(collectRollUndoRecords(chainFlag?.postRollRecords, stressRecords));
    if (replacedPostRollRecords.length) {
      const undoPermissionError = getUndoPermissionError(requester, replacedPostRollRecords);
      if (undoPermissionError) throw new Error(undoPermissionError);
      const undoResult = await applyRollUndoRecords(replacedPostRollRecords);
      if (!undoResult.ok) throw new Error(undoResult.error || "Could not undo the original post-roll effects.");
      downstreamUndone = true;
      await markPostRollUndoMessagesUndone(originalChainMessages, replacedPostRollRecords, {
        undoneBy: requester?.id || null
      });
      if (!replayRequired) {
        const removedIds = new Set(appliedOfferRecords.map(record => record.id));
        postRollRecords = postRollRecords.filter(record => !removedIds.has(record.id));
      }
    }

    if (replayRequired) {
      const replay = game.peasantCore?.replayNotableCombatPostRollEffects;
      if (typeof replay !== "function") throw new Error("Notable combat stress replay is unavailable.");
      if (checkpoint.stage === "save") {
        const targetActor = await resolveActorFromUuidOrId(checkpoint.saveTargetRef);
        if (!targetActor) throw new Error("The original save target was not found.");
        const capturedReplay = await captureActorRollUndo(targetActor, "Stress Save Replay Effects", async () => {
          try {
            return await replay({
              checkpoint,
              rollResult,
              onSaveReplayProgress: resolution => { replayProgress.push(resolution); }
            });
          } catch (error) {
            return { ok: false, error: getResultError(error) };
          }
        }, { includeSpellEffects: true });
        replayResult = capturedReplay.result;
        replayUndoRecords = capturedReplay.undoRecords;
      } else {
        replayResult = await replay({
          checkpoint,
          rollResult,
          onSaveReplayProgress: resolution => { replayProgress.push(resolution); }
        });
      }
      if (!replayResult?.ok) throw new Error(replayResult?.error || "Could not replay downstream roll effects.");
      const replacedRecordIds = new Set(replacedPostRollRecords.map(record => String(record.id || "")).filter(Boolean));
      if (checkpoint.stage === "save") {
        preRollRecords = dedupeUndoRecords(collectRollUndoRecords(
          (parentChainFlag?.preRollRecords || []).filter(record => !replacedRecordIds.has(String(record.id || ""))),
          stressRecords
        ));
        postRollRecords = dedupeUndoRecords(collectRollUndoRecords(
          (parentChainFlag?.postRollRecords || []).filter(record => !replacedRecordIds.has(String(record.id || ""))),
          replayResult.postRollRecords
        ));
      } else {
        preRollRecords = dedupeUndoRecords(parentChainFlag?.preRollRecords);
        postRollRecords = dedupeUndoRecords(collectRollUndoRecords(stressRecords, replayResult.postRollRecords));
      }

      const replayIds = new Set(replayResult.messageIds || []);
      const retiredMessages = checkpoint.stage === "save"
        ? originalChainMessages.filter(candidate => checkpoint.savePostMessageIds?.includes(candidate.id) && !replayIds.has(candidate.id))
        : [];
      await refreshEdgeChainMessagesForEdgeExplode({
        chainFlag: parentChainFlag,
        originalMessages: originalChainMessages.filter(candidate => !retiredMessages.includes(candidate)),
        replayMessageIds: replayResult.messageIds || [],
        preRollRecords,
        postRollRecords
      });
      await markEdgeChainMessagesSuperseded(retiredMessages, { edgedBy: requester?.id || null });
    } else if (chainFlag) {
      await attachEdgeChainToChatMessage(
        message,
        chainFlag,
        dedupeUndoRecords(collectRollUndoRecords(
          chainFlag.undoRecords.filter(record => !appliedOfferRecords.some(applied => applied.id === record.id)), stressRecords
        )),
        { preRollRecords, postRollRecords }
      );
    }
    await replaceRollUndoRecords(
      message,
      replayRequired && checkpoint.stage === "save"
        ? stressRecords
        : collectRollUndoRecords(preRollRecords, postRollRecords),
      `Undo ${flag.rollLabel || "Roll"} Effects`
    );
    if (replayRequired && checkpoint.attackMessageId) {
      await replaceRollUndoRecords(
        game.messages?.get(checkpoint.attackMessageId),
        collectRollUndoRecords(preRollRecords, postRollRecords),
        `Undo ${flag.rollLabel || "Roll"} Effects`
      );
    }
    await setStressRollFlagOnMessage(message, {
      status: "completed",
      processing: false,
      processingUserId: null,
      completedAt: Date.now(),
      completedBy: requester?.id || null
    });
    await refreshSkillEntryOffers(message, chainFlag, checkpoint, rollResult, replayResult);
    return { ok: true, messageId: message.id, rollResult, forcePassResult, replayResult };
  } catch (error) {
    await applyRollUndoRecords(collectRollUndoRecords(
      checkpoint?.stage === "save" ? replayUndoRecords : replayResult?.postRollRecords
    ));
    await applyRollUndoRecords(collectRollUndoRecords(forcePassResult));
    if (downstreamUndone) await applyRollUndoRecords(invertUndoRecords(replacedPostRollRecords));
    for (const snapshot of snapshots) {
      if (snapshot.message.update) await snapshot.message.update({ content: snapshot.content });
      for (const [key, value] of Object.entries(snapshot.flags)) {
        if (value === undefined) await snapshot.message.unsetFlag?.(PC_SYSTEM_ID, key);
        else await snapshot.message.setFlag?.(PC_SYSTEM_ID, key, value);
      }
    }
    const partialMessages = replayProgress.flatMap(resolution => [
      resolution?.damageRoll?.chatMessage,
      ...(resolution?.damageRoll?.barrierMessages || []),
      resolution?.application?.applyResult?.chatMessage
    ]);
    for (const candidate of new Set([...getMessagesByIds(replayResult?.messageIds), ...partialMessages])) {
      if (!originalIds.has(candidate.id)) await candidate.delete?.();
    }
    return { ok: false, error: getResultError(error) };
  }
}

function hasCurrentFallExplosionDice(rollFlag, explodeFlag) {
  if (explodeFlag?.status !== EDGE_EXPLODE_STATUS_CURRENT) return false;
  let baseDice = rollFlag.dice.slice(0, 2);
  if (!rollFlag.trained) {
    const maxIndex = rollFlag.dice.indexOf(Math.max(...rollFlag.dice));
    baseDice = rollFlag.dice.filter((_die, index) => index !== maxIndex).slice(0, 2);
  }
  const storedDice = rollFlag.trained ? explodeFlag.initialDice : explodeFlag.keptDice;
  return baseDice.length === storedDice.length
    && baseDice.every((die, index) => die === storedDice[index]);
}

function createFallAccuracyRollResult(message, eligibility, accuracyBonus) {
  const { rollFlag, explodeFlag } = eligibility;
  const hasCurrentExplosion = hasCurrentFallExplosionDice(rollFlag, explodeFlag);
  const critical = hasCurrentExplosion
    ? {
      dice: explodeFlag.explosionDice,
      mos: explodeFlag.criticalMoS,
      label: explodeFlag.criticalType
    }
    : null;
  const storedAccuracy = hasCurrentExplosion && Number.isFinite(Number(explodeFlag?.accuracy))
    ? Number(explodeFlag.accuracy)
    : (Number.isFinite(Number(rollFlag.accuracy)) ? Number(rollFlag.accuracy) : 0);
  return {
    ...createSkillResultFromIndividualDice({
      trained: rollFlag.trained,
      dice: rollFlag.dice,
      toHit: rollFlag.toHit ?? 7,
      accuracy: storedAccuracy + accuracyBonus,
      critical
    }),
    chatMessage: message
  };
}

function addFallAccuracyToRerun(rerun, accuracyBonus) {
  const next = cloneData(rerun || {});
  if (["skillRoll", "untrainedSkillRoll"].includes(next.type)) {
    next.accuracy = (Number(next.accuracy) || 0) + accuracyBonus;
  } else {
    next.accuracyAdj = (Number.parseInt(next.accuracyAdj, 10) || 0) + accuracyBonus;
  }
  return next;
}

function isForcePassUndoRecord(record) {
  return /Force Pass Stress$/.test(String(record?.label || ""));
}

function snapshotFallMessageState(messages) {
  return messages.map(message => ({
    message,
    content: String(message.content || ""),
    flags: Object.fromEntries([PC_STRESS_ROLL_FLAG, PC_EDGE_CHAIN_FLAG, PC_EDGE_INDIVIDUAL_DIE_FLAG, PC_EDGE_EXPLODE_FLAG, "rollUndo", "skillEffectOffers"]
      .map(key => [key, cloneData(message.getFlag?.(PC_SYSTEM_ID, key))]))
  }));
}

async function restoreFallMessageState(snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot.message.update) await snapshot.message.update({ content: snapshot.content });
    for (const [key, value] of Object.entries(snapshot.flags)) {
      if (value === undefined) await snapshot.message.unsetFlag?.(PC_SYSTEM_ID, key);
      else await snapshot.message.setFlag?.(PC_SYSTEM_ID, key, value);
    }
  }
}

export async function applyFallBlessingAccuracy(payload = {}) {
  const messageId = String(payload.messageId || "").trim();
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) return { ok: false, error: "Roll message was not found." };

  const requester = game.users?.get(payload.requesterUserId || payload.userId) || game.user;
  const eligibility = getFallBlessingEligibility(message, { user: requester });
  if (!eligibility.ok) return { ok: false, error: "This roll cannot use Blessing of Fall." };
  if (!canUserUpdateMessage(game.user, message)) return { ok: false, error: "You cannot update this chat message." };
  const automaticBlock = getAutomaticEffectReplayBlock(message, eligibility.chainFlag);
  if (automaticBlock) return automaticBlock;

  const usesSpent = payload.usesSpent;
  if (!Number.isSafeInteger(usesSpent) || usesSpent < 1 || usesSpent > eligibility.currentUses) {
    return { ok: false, error: "Choose a whole number of Fall uses from 1 through the remaining uses." };
  }

  const { actor, chainFlag, explodeFlag } = eligibility;
  const checkpoint = eligibility.rollFlag.checkpoint;
  const notableReplay = isNotableCombatRerun(chainFlag);
  if (notableReplay && (checkpoint?.version !== 2 || checkpoint?.type !== "notableCombatPostRoll")) {
    return { ok: false, error: "This combat roll does not have the v2 replay checkpoint data." };
  }

  const accuracyBonus = usesSpent * 4;
  const originalMoS = createFallAccuracyRollResult(message, eligibility, 0).totalMoS;
  const rollResult = createFallAccuracyRollResult(message, eligibility, accuracyBonus);
  const originalChainMessages = getMessagesForChain(chainFlag.chainId);
  const snapshots = snapshotFallMessageState(originalChainMessages.length ? originalChainMessages : [message]);
  const originalIds = new Set(snapshots.map(snapshot => snapshot.message.id));
  const originalStressFlag = getStressRollFlag(message);
  const originalPostRollRecords = getEdgeExplodePostRollRecords(chainFlag, explodeFlag);
  const forcePassRecords = originalPostRollRecords.filter(isForcePassUndoRecord);
  const appliedOfferRecords = originalPostRollRecords.filter(record => record.skillEffects);
  const oldResultNoLongerNeedsStress = !!rollResult.isSuccess;
  let replayPlan = null;
  let replayResult = null;
  let summaryMessage = null;
  let fallUseCapture = null;
  let recordsUndone = [];
  let downstreamUndone = false;
  const replayProgress = [];

  await markEdgeChainMessagesProcessing(snapshots.map(snapshot => snapshot.message), requester?.id || null);
  await setEdgeIndividualDieFlagOnMessage(message, {
    status: EDGE_CHAIN_STATUS_PROCESSING,
    processing: true,
    processingUserId: requester?.id || null
  });
  if (explodeFlag) await markEdgeExplodeProcessing(message, requester?.id || null);

  try {
    let replayRequired = false;
    if (notableReplay) {
      const planner = game.peasantCore?.planNotableCombatEdgeExplodeReplay;
      if (typeof planner !== "function") throw new Error("Notable combat replay planner is unavailable.");
      replayPlan = await planner({ checkpoint, rollResult });
      if (!replayPlan?.ok) throw new Error(replayPlan?.error || "Could not evaluate downstream Fall effects.");
      replayRequired = !!replayPlan.replayRequired;
    }

    recordsUndone = replayRequired
      ? originalPostRollRecords
      : dedupeUndoRecords(collectRollUndoRecords(oldResultNoLongerNeedsStress ? forcePassRecords : [], appliedOfferRecords));
    const undoPermissionError = getUndoPermissionError(game.user, recordsUndone);
    if (undoPermissionError) throw new Error(undoPermissionError);
    if (recordsUndone.length) {
      const undoResult = await applyRollUndoRecords(recordsUndone);
      if (!undoResult.ok) throw new Error(undoResult.error || "Could not undo the original post-roll effects.");
      downstreamUndone = true;
      await markPostRollUndoMessagesUndone(snapshots.map(snapshot => snapshot.message), recordsUndone, {
        undoneBy: requester?.id || null
      });
    }

    fallUseCapture = await captureActorRollUndo(
      actor,
      FALL_BLESSING_UNDO_LABEL,
      () => actor.spendPeasantFallBlessingUses?.(usesSpent)
    );
    if (!fallUseCapture.result?.ok || fallUseCapture.undoRecords.length !== 1) {
      throw new Error("Could not spend the selected Fall uses.");
    }

    summaryMessage = await createFallBlessingSummary({
      actor,
      rollLabel: chainFlag.label,
      originalMoS,
      newMoS: rollResult.totalMoS
    });

    if (oldResultNoLongerNeedsStress && originalStressFlag) await clearStressRollRetry(message);

    if (replayRequired) {
      const replay = game.peasantCore?.replayNotableCombatPostRollEffects;
      if (typeof replay !== "function") throw new Error("Notable combat replay is unavailable.");
      replayResult = await replay({
        checkpoint,
        rollResult,
        onSaveReplayProgress: resolution => { replayProgress.push(resolution); }
      });
      if (!replayResult?.ok) throw new Error(replayResult?.error || "Could not replay downstream Fall effects.");
    }

    const nextPostRollRecords = replayRequired
      ? dedupeUndoRecords(replayResult?.postRollRecords)
      : dedupeUndoRecords(originalPostRollRecords.filter(record => !recordsUndone.some(undone => undone.id === record.id)));
    const fallUseRecords = fallUseCapture.undoRecords;
    const nextPreRollRecords = dedupeUndoRecords(collectRollUndoRecords(
      getEdgeExplodePreRollRecords(chainFlag, explodeFlag),
      fallUseRecords
    ));
    const nextChainFlag = {
      ...chainFlag,
      rerun: addFallAccuracyToRerun(chainFlag.rerun, accuracyBonus),
      preRollRecords: nextPreRollRecords,
      postRollRecords: nextPostRollRecords,
      undoRecords: dedupeUndoRecords(collectRollUndoRecords(nextPreRollRecords, nextPostRollRecords)),
      fallAccuracyApplied: true,
      fallAccuracyUsesSpent: usesSpent,
      fallAccuracyBonus: accuracyBonus
    };

    if (oldResultNoLongerNeedsStress && !forcePassRecords.length) await clearStressRollRetry(message);

    const replayUpdatedClickedAttackCard = !!(
      replayRequired
      && checkpoint?.stage === "attack"
      && !checkpoint?.multiTarget
    );
    if (!replayUpdatedClickedAttackCard || (oldResultNoLongerNeedsStress && forcePassRecords.length)) {
      if (forcePassRecords.length && oldResultNoLongerNeedsStress) rollResult.clearForcePassNote = true;
      await updateSkillRollChatCardFromResult(rollResult, { label: rollResult.resultText });
    }

    const replayMessageIds = replayRequired ? (replayResult?.messageIds || []) : [];
    await refreshEdgeChainMessagesForEdgeExplode({
      chainFlag: nextChainFlag,
      originalMessages: snapshots.map(snapshot => snapshot.message),
      replayMessageIds,
      preRollRecords: nextPreRollRecords,
      postRollRecords: nextPostRollRecords
    });
    await replaceRollUndoRecords(
      message,
      collectRollUndoRecords(nextPreRollRecords, nextPostRollRecords),
      `Undo ${chainFlag.label || "Roll"} Effects`
    );
    await setEdgeIndividualDieFlagOnMessage(message, {
      status: EDGE_CHAIN_STATUS_CURRENT,
      processing: false,
      processingUserId: null,
      accuracy: rollResult.accuracy
    });
    if (hasCurrentFallExplosionDice(eligibility.rollFlag, explodeFlag)) {
      await setEdgeExplodeFlagOnMessage(message, {
        status: EDGE_EXPLODE_STATUS_CURRENT,
        processing: false,
        processingUserId: null,
        accuracy: rollResult.accuracy
      });
    } else if (explodeFlag) {
      await setEdgeExplodeFlagOnMessage(message, {
        status: EDGE_EXPLODE_STATUS_SUPERSEDED,
        processing: false,
        processingUserId: null
      });
    }
    await refreshSkillEntryOffers(message, nextChainFlag, checkpoint, rollResult, replayResult, replayPlan);

    return {
      ok: true,
      messageId: message.id,
      summaryMessageId: summaryMessage?.id || null,
      usesSpent,
      accuracyBonus,
      rollResult,
      replayPlan,
      replayResult
    };
  } catch (error) {
    const newReplayRecords = collectRollUndoRecords(
      replayResult?.postRollRecords,
      ...replayProgress.map(resolution => resolution?.application?.undoRecords)
    );
    if (newReplayRecords.length) await applyRollUndoRecords(newReplayRecords);
    if (fallUseCapture?.undoRecords?.length) await applyRollUndoRecords(fallUseCapture.undoRecords);
    else if (Number(actor.system?.fallBlessingUses?.value) < eligibility.currentUses) {
      await actor.updatePeasantStateData?.({ "system.fallBlessingUses.value": eligibility.currentUses });
    }
    if (downstreamUndone) await applyRollUndoRecords(invertUndoRecords(recordsUndone));
    await restoreFallMessageState(snapshots);
    for (const candidate of getMessagesByIds(replayResult?.messageIds || [])) {
      if (!originalIds.has(candidate.id)) await candidate.delete?.();
    }
    const partialMessages = replayProgress.flatMap(resolution => [
      resolution?.damageRoll?.chatMessage,
      ...(resolution?.damageRoll?.barrierMessages || []),
      resolution?.application?.chatMessage,
      resolution?.application?.applyResult?.chatMessage
    ]);
    for (const candidate of new Set(partialMessages.filter(Boolean))) {
      if (!originalIds.has(candidate.id)) await candidate.delete?.();
    }
    if (originalStressFlag && message.getFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG) === undefined) {
      await message.setFlag?.(PC_SYSTEM_ID, PC_STRESS_ROLL_FLAG, originalStressFlag);
    }
    try {
      await summaryMessage?.delete?.();
    } catch (summaryError) {
      console.error("Peasant Core | Failed to remove Blessing of Fall summary after replay failure", summaryError);
    }
    console.error("Peasant Core | Blessing of Fall Accuracy failed", error);
    return { ok: false, error: getResultError(error) };
  }
}

async function showFallBlessingUsesPrompt(currentUses) {
  return await new Promise(resolve => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;
    const finalize = result => {
      if (settled) return result;
      settled = true;
      if (closeWatcher) globalThis.window?.clearInterval?.(closeWatcher);
      resolve(result);
      return result;
    };
    const content = `<form class="pc-fall-blessing-form"><div class="form-group"><label>Fall Accuracy Uses</label><input type="number" name="fallBlessingUsesSpent" min="1" max="${currentUses}" step="1" value="1"></div></form>`;
    renderDialogV2({
      title: "Blessing of Fall",
      content,
      buttons: {
        apply: {
          label: "Apply",
          callback: async html => {
            const usesSpent = Number(qs(html, '[name="fallBlessingUsesSpent"]')?.value);
            if (!Number.isSafeInteger(usesSpent) || usesSpent < 1 || usesSpent > currentUses) return false;
            finalize({ usesSpent, cancelled: false });
            return true;
          }
        },
        cancel: { label: "Cancel", callback: () => finalize({ cancelled: true }) }
      },
      default: "apply",
      render: html => {
        const dialogElement = toElement(html);
        if (!dialogElement) return;
        renderedWindow = dialogElement.closest?.(".application, dialog") || dialogElement;
        for (const closeButton of qsa(renderedWindow, '.header-control, [data-action="close"], [data-button="close"]')) {
          closeButton.addEventListener("click", () => finalize({ cancelled: true }));
        }
        if (!closeWatcher && globalThis.window?.setInterval) {
          closeWatcher = globalThis.window.setInterval(() => {
            if (!settled && renderedWindow && !renderedWindow.isConnected) finalize({ cancelled: true });
          }, 150);
        }
      }
    }, { classes: ["pc-fall-blessing-dialog", "peasant-macro-dialog-force"] });
  });
}

export async function fallBlessingAccuracyFromMessage(messageId) {
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) {
    ui.notifications?.warn?.("Roll message was not found.");
    return false;
  }
  const eligibility = getFallBlessingEligibility(message);
  if (!eligibility.ok) {
    ui.notifications?.warn?.("This roll cannot use Blessing of Fall.");
    return false;
  }

  let usesSpent = 1;
  if (eligibility.currentUses > 1) {
    const selection = await showFallBlessingUsesPrompt(eligibility.currentUses);
    if (selection?.cancelled || !Number.isSafeInteger(selection?.usesSpent)) return false;
    usesSpent = selection.usesSpent;
  }

  const requester = game.user;
  const chainFlag = eligibility.chainFlag;
  const postRollRecords = getEdgeExplodePostRollRecords(chainFlag, eligibility.explodeFlag);
  const resultCandidate = createFallAccuracyRollResult(message, eligibility, usesSpent * 4);
  let replayRequired = false;
  if (isNotableCombatRerun(chainFlag)) {
    const planner = game.peasantCore?.planNotableCombatEdgeExplodeReplay;
    if (typeof planner !== "function") {
      ui.notifications?.warn?.("Notable combat replay planner is unavailable.");
      return false;
    }
    const plan = await planner({ checkpoint: eligibility.rollFlag.checkpoint, rollResult: resultCandidate });
    if (!plan?.ok) {
      ui.notifications?.warn?.(plan?.error || "Could not evaluate downstream Fall effects.");
      return false;
    }
    replayRequired = !!plan.replayRequired;
  }

  const targetRecordsNeedGM = replayRequired && !!getUndoPermissionError(requester, postRollRecords);
  if (targetRecordsNeedGM || !canUserUpdateMessage(requester, message)) {
    const request = game.peasantCore?.requestEdgeLocationRollFromGM;
    const remoteResult = typeof request === "function"
      ? await request({
        edgeRollMode: "fallBlessing",
        messageId: message.id,
        usesSpent,
        actorId: eligibility.actor.id,
        actorUuid: eligibility.actor.uuid
      })
      : { ok: false, error: "Fall Accuracy replay requires an active GM connection." };
    if (!remoteResult?.ok) ui.notifications?.warn?.(remoteResult?.error || "Blessing of Fall failed.");
    return !!remoteResult?.ok;
  }

  const result = await applyFallBlessingAccuracy({
    messageId: message.id,
    usesSpent,
    requesterUserId: requester?.id || null
  });
  if (!result?.ok) ui.notifications?.warn?.(result?.error || "Blessing of Fall failed.");
  return !!result?.ok;
}

export async function stressRollFromMessage(messageId) {
  const message = messageId ? game.messages?.get(messageId) || null : null;
  const flag = getStressRollFlag(message);
  const checkpoint = getEdgeIndividualDieFlag(message)?.checkpoint;
  if (
    !game.user?.isGM
    && ["save", "check"].includes(flag?.kind)
    && checkpoint?.version === 2
    && checkpoint?.type === "notableCombatPostRoll"
    && checkpoint?.stage === "save"
  ) {
    const request = game.peasantCore?.requestStressRollFromGM;
    const remoteResult = typeof request === "function"
      ? await request({ messageId })
      : { ok: false, error: "Combat stress replay requires an active GM connection." };
    if (!remoteResult?.ok) ui.notifications?.warn?.(remoteResult?.error || "Stress Save failed.");
    return !!remoteResult?.ok;
  }

  const result = await applyStressRoll({
    messageId,
    requesterUserId: game.user?.id || null
  });
  if (!result?.ok && !result?.cancelled) {
    ui.notifications?.warn?.(result?.error || "Stress Roll failed.");
  }
  return !!result?.ok;
}

export function configureStressRollChatContext() {
  Hooks.on("getChatMessageContextOptions", (_application, menuItems) => {
    for (const [kind, name] of [["roll", "Stress Roll"], ["save", "Stress Save"], ["check", "Stress Check"]]) {
      menuItems.push({
        name,
        icon: '<i class="fas fa-bolt"></i>',
        condition: element => canOfferStressRoll(getMessageFromContextElement(element), kind),
        callback: async element => {
          const message = getMessageFromContextElement(element);
          if (message) await stressRollFromMessage(message.id);
        }
      });
    }
  });
}

export function configureFallBlessingRollChatContext() {
  Hooks.on("getChatMessageContextOptions", (_application, menuItems) => {
    const option = {
      name: "Blessing of Fall",
      icon: '<i class="fas fa-leaf"></i>',
      condition: element => {
        const message = getMessageFromContextElement(element);
        const eligibility = getFallBlessingEligibility(message);
        return eligibility.ok;
      },
      callback: async element => {
        const message = getMessageFromContextElement(element);
        if (message) await fallBlessingAccuracyFromMessage(message.id);
      }
    };
    menuItems.push(option);
  });
}

export function configureEdgeChainRollChatContext() {
  Hooks.on("getChatMessageContextOptions", (_application, menuItems) => {
    for (const name of ["Edge Entire Chain", "Edge Entire Save", "Edge Entire Check"]) {
      menuItems.push({
        name,
        icon: '<i class="fas fa-dice-d20"></i>',
        condition: element => {
          const message = getMessageFromContextElement(element);
          return canOfferEdgeChain(message) && getEdgeEntireTitle(getEdgeChainFlag(message)) === name;
        },
        callback: async element => {
          const message = getMessageFromContextElement(element);
          if (message) await edgeChainRollFromMessage(message.id);
        }
      });
    }
  });
}

export function configureEdgeIndividualDieRollChatContext() {
  Hooks.on("getChatMessageContextOptions", (_application, menuItems) => {
    menuItems.push({
      name: "Edge Individual Die",
      icon: '<i class="fas fa-dice-one"></i>',
      condition: element => canEdgeIndividualDieMessage(getMessageFromContextElement(element)),
      callback: async element => {
        const message = getMessageFromContextElement(element);
        if (message) await edgeIndividualDieRollFromMessage(message.id);
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
