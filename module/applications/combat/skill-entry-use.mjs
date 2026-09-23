import { hasOptionalInteger, parseOptionalInteger } from "../../data/actor/helpers.mjs";
import { getEffectiveSkillCombatModifiers } from "../../data/actor/combat-modifiers.mjs";
import { normalizeSkillEntry, resolveSkillUsage } from "../../data/actor/skill-entries.mjs";
import { isSignatureSkillType } from "../../data/actor/skill-entry-types.mjs";
import { applyToHitAccuracy } from "../../dice/roll-targets.mjs";
import { performSkillRoll, performUntrainedSkillRoll } from "../../dice/rolls.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";
import { getActiveNotableCombatEditorTags } from "../actor/notable-combat/notable-combat-tag-display.mjs";
import { attachRollUndoToChatMessage, captureActorRollUndo, collectRollUndoRecords } from "../chat-undo.mjs";
import { attachEdgeChainToChatMessage, createActorSkillEdgeChainContext } from "./edge-chain-rolls.mjs";
import { maybeForcePassFailedRoll } from "./force-pass.mjs";
import { startNotableCombatRoll } from "./notable-combat-workflow.mjs";
import { offerSkillEntryEffects } from "./skill-entry-effects.mjs";

const ENTRY_COLLECTIONS = new Set(["skills", "notableCombats"]);

function cloneData(value) {
  if (value === undefined) return undefined;
  return foundry?.utils?.deepClone ? foundry.utils.deepClone(value) : structuredClone(value);
}

function normalizeRef(ref) {
  const collection = String(ref?.collection || "").trim();
  const entryId = String(ref?.entryId || "").trim();
  return ENTRY_COLLECTIONS.has(collection) && entryId ? { collection, entryId } : null;
}

function getSourceSystem(actor) {
  return actor?.system?._source ?? actor?._source?.system ?? actor?.system ?? {};
}

function hasStoredUsageContext(actor, usageContext) {
  const ref = normalizeRef(usageContext?.ref);
  if (!ref) return false;
  const entry = getSourceSystem(actor)?.[ref.collection]?.find(
    (candidate) => String(candidate?.id || "").trim() === ref.entryId
  );
  if (!entry) return false;
  const usageId = String(usageContext.ref?.usageId || "base").trim() || "base";
  return usageId === "base" || entry.usages?.some((usage) => String(usage?.id || "").trim() === usageId);
}

export async function createPeasantEntryUsageContext({ actor, ref, usageId = null, pool = null } = {}) {
  const normalizedRef = normalizeRef(ref);
  if (!actor || !normalizedRef) return { ok: false, error: "The selected entry was unavailable." };
  await actor.ensurePeasantEntryIds?.(normalizedRef.collection);
  const sourceSystem = getSourceSystem(actor);
  const sourceEntry = sourceSystem[normalizedRef.collection]?.find(
    (entry) => String(entry?.id || "").trim() === normalizedRef.entryId
  );
  if (!sourceEntry) return { ok: false, error: "The selected entry was unavailable." };

  const entry = normalizeSkillEntry(sourceEntry, {
    collection: normalizedRef.collection,
    createId: () => foundry?.utils?.randomID?.(16)
  });
  const resolved = resolveSkillUsage(entry, usageId ?? entry.defaultUsageId ?? "base");
  if (!resolved.ok) return resolved;
  const resolution = resolved.usage?.resolution === "legacy"
    ? (normalizedRef.collection === "skills" ? "check" : "targeted")
    : resolved.usage?.resolution;
  const rawModifiers = actor.system?.combatMods || {};
  const modifiers = getEffectiveSkillCombatModifiers(actor, rawModifiers);
  const rawAccuracy = Number(rawModifiers.accuracy);
  return {
    ok: true,
    usageContext: {
      version: 1,
      ref: { ...normalizedRef, usageId: resolved.usageId },
      data: cloneData(resolved.data),
      modifiers: cloneData(modifiers),
      woundAccuracyModifier: modifiers.accuracy - (Number.isFinite(rawAccuracy) ? rawAccuracy : 0),
      signaturePool: ["primary", "duress"].includes(pool) ? pool : null,
      usageName: String(resolved.usage?.name || (resolved.usageId === "base" ? "Default" : "Usage")).trim(),
      resolution: resolution || "reference"
    }
  };
}

async function postPeasantEntryReference({ actor, usageContext }) {
  const data = usageContext.data || {};
  const tags = getActiveNotableCombatEditorTags(data);
  const description = String(data.description || "").trim();
  const TextEditor = globalThis.foundry?.applications?.ux?.TextEditor?.implementation;
  const descriptionHtml = description && typeof TextEditor?.enrichHTML === "function"
    ? await TextEditor.enrichHTML(description, { async: true })
    : (description ? `<div>${escapeHtml(description)}</div>` : "");
  const tagsHtml = tags.length
    ? `<ul>${tags.map((tag) => `<li><strong>${escapeHtml(tag.label)}</strong>${tag.summary ? `: ${escapeHtml(tag.summary)}` : ""}</li>`).join("")}</ul>`
    : "";
  const content = `<fieldset class="skill-roll-card pc-skill-reference-card">
    <legend>${escapeHtml(data.name || "Entry")}</legend>
    <div><strong>Usage:</strong> ${escapeHtml(usageContext.usageName || "Default")}</div>
    ${descriptionHtml}
    ${tagsHtml}
  </fieldset>`;
  const chatMessage = await ChatMessage.create(applyMessageMode({
    user: game.user?.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  }));
  return { rolled: false, referenced: true, usageContext: cloneData(usageContext), chatMessage };
}

function isBaseArmorSkillUsage(usageContext) {
  const skill = usageContext?.data;
  return usageContext?.ref?.collection === "skills"
    && String(usageContext.ref.usageId || "base").trim() === "base"
    && String(skill?.category || "").trim().toLowerCase() === "martial"
    && String(skill?.type || "").trim().toLowerCase() === "defense"
    && String(skill?.defenseType || "").trim().toLowerCase() === "armor";
}

async function rechargePeasantArmorSkill({ actor, usageContext }) {
  const name = String(usageContext?.data?.name || "Armor").trim();
  const captured = await captureActorRollUndo(
    actor,
    `${name} Armor Recharge`,
    () => actor.rechargePeasantArmorCharges?.()
  );
  const result = captured.result || { ok: false, changed: false };
  const content = result.ok
    ? `<p>${escapeHtml(name)} restored Armor Charge to ${Number(result.value) || 0} / ${Number(result.capacity) || 0}. Spent 2 Stamina.</p>`
    : `<p>${escapeHtml(name)} could not recharge Armor Charge${result.alreadyFull ? "; the pool is already full." : "."}</p>`;
  const chatMessage = await ChatMessage.create(applyMessageMode({
    user: game.user?.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<fieldset class="skill-roll-card pc-armor-recharge-card"><legend>${escapeHtml(name)}</legend>${content}</fieldset>`
  }));
  const undoRecords = result.changed ? collectRollUndoRecords(captured.undoRecords) : [];
  await attachRollUndoToChatMessage(chatMessage, undoRecords, { label: `Undo ${name} Armor Recharge` });
  return {
    rolled: false,
    armorRecharge: true,
    result,
    usageContext: cloneData(usageContext),
    undoRecords,
    chatMessage
  };
}

async function chooseSignaturePool(usageContext) {
  if (!isSignatureSkillType(usageContext?.data?.type)) return "primary";
  const primaryConfigured = Number(usageContext.data.usesMax) > 0;
  const duressConfigured = !!usageContext.data.signatureUsage?.duressUses
    && Number(usageContext.data.signatureUsage?.duressMax) > 0;
  if (!duressConfigured) return "primary";
  if (!primaryConfigured) return "duress";

  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== "function") return "primary";
  const choice = await DialogV2.wait({
    window: { title: `Choose Uses: ${usageContext.data.name || "Signature"}` },
    position: { width: 360 },
    content: "<p>Choose which Signature pool this use spends.</p>",
    buttons: [
      { action: "primary", label: "Primary Uses", icon: "fa-solid fa-bolt", default: true, callback: () => "primary" },
      { action: "duress", label: "Duress Uses", icon: "fa-solid fa-heart-crack", callback: () => "duress" },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark", callback: () => "cancel" }
    ],
    close: () => "cancel"
  });
  return ["primary", "duress"].includes(choice) ? choice : null;
}

export async function performPeasantSkillCheck({
  actor,
  usageContext,
  sheet = null,
  edgeExplodeReroll = null
} = {}) {
  const skill = usageContext?.data;
  const ref = normalizeRef(usageContext?.ref);
  if (!actor || !skill || !ref) return { rolled: false, error: "The selected skill was unavailable." };

  const modifiers = usageContext.modifiers || {};
  const skillToHit = parseOptionalInteger(skill.tohit, { min: 1 });
  const skillAccuracy = parseOptionalInteger(skill.accuracy, { allowSign: true });
  const rollTarget = applyToHitAccuracy(
    hasOptionalInteger(skillToHit) ? skillToHit : 7,
    skillAccuracy ?? 0,
    Number.parseInt(modifiers.toHit, 10) || 0,
    Number.parseInt(modifiers.accuracy, 10) || 0,
    2
  );
  const isUntrained = String(skill.rank || "").trim().toLowerCase() === "u";
  const rollLabel = isUntrained
    ? `${skill.name || "Skill"} Untrained Skill Roll`
    : `${skill.name || "Skill"} Skill Roll`;
  const edgeChainContext = createActorSkillEdgeChainContext({
    actor,
    skillName: skill.name || "Skill",
    untrained: isUntrained,
    usageContext
  });
  const rollResult = await (isUntrained ? performUntrainedSkillRoll : performSkillRoll)({
    toHit: rollTarget.toHit,
    accuracy: isUntrained
      ? (Number(usageContext.woundAccuracyModifier) || 0)
      : (rollTarget.accuracy !== 0 ? rollTarget.accuracy : undefined),
    skillName: rollLabel,
    speaker: ChatMessage.getSpeaker({ actor }),
    imageSrc: skill.img || "",
    edgeChainContext,
    edgeExplodeReroll
  });
  const forcePassResult = await maybeForcePassFailedRoll({ actor, rollLabel, rollResult });
  const useResult = await captureActorRollUndo(
    actor,
    `${skill.name || "Skill"} Skill Use`,
    () => actor.consumePeasantEntryUses?.(ref, {
      usageId: usageContext.ref.usageId,
      pool: usageContext.signaturePool,
      spendSignature: isSignatureSkillType(skill.type)
    }),
    { entryCounterRefs: [usageContext.ref] }
  );
  if (sheet) sheet._lastSkillsSnapshot = cloneData(actor.system?.skills || []);
  const undoRecords = collectRollUndoRecords(useResult.undoRecords, forcePassResult);
  await attachRollUndoToChatMessage(rollResult?.chatMessage, undoRecords, {
    label: `Undo ${skill.name || "Skill"} Roll Effects`
  });
  await attachEdgeChainToChatMessage(rollResult?.chatMessage, edgeChainContext, undoRecords, {
    preRollRecords: useResult.undoRecords,
    postRollRecords: forcePassResult?.undoRecords
  });
  if (!forcePassResult?.chainCancelled && rollResult?.chatMessage) {
    try {
      await offerSkillEntryEffects({
        actor,
        usageContext,
        message: rollResult.chatMessage,
        targets: [{ actorUuid: actor.uuid, success: rollResult.isSuccess, hit: false }]
      });
    } catch (error) {
      console.warn("Peasant Core | Could not attach Skill effect offers", error);
    }
  }
  return {
    rolled: !!rollResult,
    usageContext: cloneData(usageContext),
    rollResult,
    forcePassResult,
    undoRecords,
    chainCancelled: !!forcePassResult?.chainCancelled
  };
}

export async function startPeasantEntryUse({
  actor,
  ref = null,
  usageId = null,
  pool = null,
  sheet = null,
  promptForTargets = true,
  replayContext = null,
  edgeExplodeReroll = null,
  rollOverrides = null,
  toHitAdj = 0,
  accuracyAdj = 0,
  targetLabel = "",
  selectedDamageType = null,
  cardClass = "",
  rollMode = ""
} = {}) {
  const usageContext = replayContext?.version === 1
    ? cloneData(replayContext)
    : (await createPeasantEntryUsageContext({ actor, ref, usageId, pool })).usageContext;
  if (!usageContext) return false;
  if (!hasStoredUsageContext(actor, usageContext)) return false;
  if (isBaseArmorSkillUsage(usageContext)) return rechargePeasantArmorSkill({ actor, usageContext });
  if (usageContext.resolution === "reference") return postPeasantEntryReference({ actor, usageContext });
  if (!usageContext.signaturePool) {
    usageContext.signaturePool = await chooseSignaturePool(usageContext);
    if (!usageContext.signaturePool) return false;
  }
  if (usageContext.resolution === "check") {
    return performPeasantSkillCheck({ actor, usageContext, sheet, edgeExplodeReroll });
  }

  if (usageContext.resolution !== "targeted") return false;
  const entries = Array.isArray(actor?.system?.[usageContext.ref.collection])
    ? actor.system[usageContext.ref.collection]
    : [];
  const combatIndex = entries.findIndex(
    (entry) => String(entry?.id || "").trim() === usageContext.ref.entryId
  );
  if (combatIndex < 0) return false;
  return startNotableCombatRoll({
    actor,
    combatIndex,
    sheet,
    promptForTargets,
    usageContext,
    edgeExplodeReroll,
    rollOverrides,
    toHitAdj,
    accuracyAdj,
    targetLabel,
    selectedDamageType,
    cardClass,
    rollMode
  });
}
