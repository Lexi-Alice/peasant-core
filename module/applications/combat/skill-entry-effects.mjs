import { isPeasantActiveEffectStateKey } from "../../data/active-effect/key-policy.mjs";
import { isSkillEditorDefinition, isSkillRuleEligible, skillEffectNeedsReview } from "../../data/actor/skill-entry-conditions.mjs";
import { attachRollUndoToChatMessage, captureActorRollUndo, getAvailableRollUndoRecords } from "../chat-undo.mjs";
import { toElement } from "../dom.mjs";
import { requestSkillEffectOfferApplication } from "../../socket/remote-prompts.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";

const SYSTEM_ID = "peasant-core";
const OFFER_FLAG = "skillEffectOffers";
const OFFER_CARD_FLAG = "skillEffectOfferCard";
const inFlightApplications = new Map();
const targetQueues = new Map();
const automaticDispatches = new Set();

export function hasUnsettledAutomaticSkillEffects(messages = []) {
  for (const message of Array.isArray(messages) ? messages : [messages]) {
    if (!message?.id) continue;
    if ([...automaticDispatches].some(key => key.startsWith(`${message.id}:`))) return true;
    const offers = message.getFlag?.(SYSTEM_ID, OFFER_FLAG)?.offers;
    if (Array.isArray(offers) && offers.some(offer => offer.application === "automatic"
      && (offer.status === "processing" || (offer.status === "pending" && !offer.automaticError)))) return true;
  }
  return false;
}

function cloneData(value) {
  return globalThis.foundry?.utils?.deepClone ? foundry.utils.deepClone(value) : structuredClone(value);
}

function getLinkConditions(link, rules) {
  return [link.when, ...rules.filter(rule => rule?.effectLinkIds?.includes(link.id)
    || (link.tagKey && rule?.tagKeys?.includes(link.tagKey))).map(rule => rule.when)];
}

export function prepareSkillEntryEffectOffers({ actor, usageContext, targets = [] } = {}) {
  const data = usageContext?.data;
  if (!actor || !data) return [];
  const usageId = String(usageContext.ref?.usageId || "base");
  const usage = usageId === "base" ? data.baseUsage : data;
  const links = Array.isArray(usage?.effectLinks) ? usage.effectLinks : [];
  const rules = Array.isArray(usage?.rules) ? usage.rules : [];
  const offers = [];

  for (const link of links) {
    if (!["automatic", "manual", "offer"].includes(link.application) || !["self", "target"].includes(link.recipient)) continue;
    const definition = actor.effects?.get?.(link.effectId);
    if (!definition || definition.type !== "skill" || !isSkillEditorDefinition(definition)) continue;
    const template = cloneData(definition.toObject?.() ?? definition._source);
    if (!template || template.changes?.some(change => isPeasantActiveEffectStateKey(change?.key))) continue;
    const conditions = getLinkConditions(link, rules);
    const application = skillEffectNeedsReview(link, rules) || link.application === "manual"
      ? "offer" : link.application;
    const resolvedTargets = targets.filter(target => typeof target?.success === "boolean");
    const recipients = link.recipient === "self"
      ? (resolvedTargets.length ? [{
        actorUuid: actor.uuid,
        success: resolvedTargets.some(target => target.success === true),
        failed: resolvedTargets.some(target => target.success === false),
        hit: resolvedTargets.some(target => target.hit === true)
      }] : [])
      : resolvedTargets.map(target => ({ ...target, failed: target.success === false }));
    for (const target of recipients) {
      const targetUuid = String(target?.actorUuid || "").trim();
      if (!targetUuid) continue;
      const outcome = {
        success: target.success === true,
        failed: target.failed === true,
        hit: target.hit === true,
        manual: application === "offer"
      };
      if (!conditions.every(when => isSkillRuleEligible(when, outcome))) continue;
      offers.push({
        operationId: globalThis.foundry?.utils?.randomID?.(16) ?? crypto.randomUUID(),
        status: "pending",
        targetUuid,
        outcome: { success: outcome.success, failed: outcome.failed, hit: outcome.hit },
        conditions,
        origin: {
          actorUuid: actor.uuid,
          collection: usageContext.ref?.collection,
          entryId: usageContext.ref?.entryId,
          usageId,
          linkId: link.id
        },
        application,
        template: cloneData(template)
      });
    }
  }
  return offers;
}

export async function offerSkillEntryEffects({ actor, usageContext, targets, message } = {}) {
  if (!message?.setFlag) return [];
  const offers = prepareSkillEntryEffectOffers({ actor, usageContext, targets });
  const automaticOffers = offers.filter(offer => offer.application === "automatic");
  for (const offer of automaticOffers) automaticDispatches.add(`${message.id}:${offer.operationId}`);
  const usage = usageContext?.ref?.usageId === "base"
    ? usageContext?.data?.baseUsage
    : usageContext?.data;
  const manualNotes = (usage?.rules ?? []).filter(rule => String(rule?.note || "").trim())
    .flatMap(rule => (rule.tagKeys?.length ? rule.tagKeys : [""])
      .map(tagKey => ({ tagKey, note: String(rule.note).trim() })));
  if (offers.length || manualNotes.length || message.getFlag?.(SYSTEM_ID, OFFER_FLAG)) {
    try {
      await message.setFlag(SYSTEM_ID, OFFER_FLAG, { version: 1, offers, manualNotes });
    } catch (error) {
      for (const offer of automaticOffers) automaticDispatches.delete(`${message.id}:${offer.operationId}`);
      globalThis.ui?.notifications?.error?.(error?.message || "Could not save usage effect operations.");
      throw error;
    }
  }
  for (const offer of automaticOffers) {
    let refreshChat = false;
    try {
      let result;
      try {
        result = await requestSkillEffectOfferApplication({ messageId: message.id, operationId: offer.operationId });
      } catch (error) {
        result = { ok: false, error: error?.message || "Automatic effect application failed." };
      }
      if (!result?.ok) {
        const error = result?.error || "Automatic effect application failed.";
        try { await markAutomaticError(message, offer.operationId, error); }
        catch (saveError) {
          refreshChat = true;
          console.warn("Peasant Core | Could not save automatic effect error", saveError);
        }
        globalThis.ui?.notifications?.error?.(error);
      }
    } finally {
      automaticDispatches.delete(`${message.id}:${offer.operationId}`);
      if (refreshChat) {
        try {
          const card = getSkillEffectOfferCard(message.id);
          if (card) await globalThis.ui?.chat?.updateMessage?.(card);
        }
        catch (renderError) { console.warn("Peasant Core | Could not refresh automatic effect retry", renderError); }
      }
    }
  }
  await createSkillEffectOfferCard({ actor, usageContext, message });
  return offers;
}

async function createSkillEffectOfferCard({ actor, usageContext, message }) {
  if (typeof globalThis.ChatMessage?.create !== "function") return;
  const flag = message.getFlag?.(SYSTEM_ID, OFFER_FLAG);
  const existing = getSkillEffectOfferCard(message.id);
  if (existing) return;
  if (!flag?.manualNotes?.length && !flag?.offers?.some(offer => offer.status === "pending" || offer.status === "processing")) return;
  const title = usageContext?.data?.name || "Usage";
  const content = `<fieldset class="skill-roll-card pc-skill-effect-offer-card"><legend>${escapeHtml(title)} Effect Offers</legend><div class="pc-skill-effect-offer-list"></div></fieldset>`;
  try {
    const data = applyMessageMode({
      user: game.user?.id,
      speaker: message.speaker ?? ChatMessage.getSpeaker({ actor }),
      content,
      flags: { [SYSTEM_ID]: { [OFFER_CARD_FLAG]: { sourceMessageId: message.id } } }
    });
    if (message.whisper !== undefined) data.whisper = message.whisper;
    if (message.blind !== undefined) data.blind = message.blind;
    await ChatMessage.create(data);
  } catch (error) {
    console.warn("Peasant Core | Could not create or refresh effect offer card", error);
  }
}

function getSkillEffectOfferCard(sourceMessageId) {
  return (game.messages?.contents ?? Array.from(game.messages || []))
    .find(candidate => candidate.getFlag?.(SYSTEM_ID, OFFER_CARD_FLAG)?.sourceMessageId === sourceMessageId);
}

async function markAutomaticError(message, operationId, error) {
  const flag = message.getFlag?.(SYSTEM_ID, OFFER_FLAG);
  if (!flag?.offers?.some(offer => offer.operationId === operationId
    && ["pending", "processing"].includes(offer.status))) return;
  const offers = flag.offers.map(offer => offer.operationId === operationId
    ? { ...offer, automaticError: error } : offer);
  await message.setFlag(SYSTEM_ID, OFFER_FLAG, { ...flag, offers });
}

function getOfferEffect(actor, messageId, operationId) {
  return Array.from(actor?.effects || []).find(effect => {
    const origin = effect?.flags?.[SYSTEM_ID]?.skillUseOrigin
      ?? effect?._source?.flags?.[SYSTEM_ID]?.skillUseOrigin;
    return origin?.messageId === messageId && origin?.operationId === operationId;
  }) || null;
}

function isOfferMessageRetired(message) {
  if (message.getFlag?.(SYSTEM_ID, "rollUndo")?.status === "undone") return true;
  return ["edgeChain", "edgeExplode", "edgeIndividualDie"].some(key => {
    const status = message.getFlag?.(SYSTEM_ID, key)?.status;
    return status && status !== "current";
  });
}

function getCurrentOfferFlag(message, operationId) {
  if (isOfferMessageRetired(message)) return null;
  const flag = message.getFlag?.(SYSTEM_ID, OFFER_FLAG);
  return flag?.offers?.some(candidate => candidate.operationId === operationId
    && ["pending", "processing", "applied"].includes(candidate.status)) ? flag : null;
}

async function saveOfferStatus(message, offer, status, extra = {}) {
  const current = getCurrentOfferFlag(message, offer.operationId);
  if (!current) throw new Error("This effect operation was superseded.");
  const next = { ...current, offers: current.offers.map(candidate => candidate.operationId === offer.operationId
    ? { ...candidate, status, ...extra }
    : candidate) };
  await message.setFlag(SYSTEM_ID, OFFER_FLAG, next);
  return next;
}

async function ensureOfferUndo(message, target, effect) {
  const effectId = String(effect?.id || effect?._id || "");
  if (!effectId) return;
  let record = getAvailableRollUndoRecords(message).find(candidate => candidate.skillEffects?.after?.some(source => source._id === effectId));
  if (!record) {
    record = {
      id: globalThis.foundry?.utils?.randomID?.(16) ?? crypto.randomUUID(),
      actorId: target.id,
      actorUuid: target.uuid,
      actorName: target.name,
      label: "Skill Effect Offer",
      before: {},
      after: {},
      skillEffects: { before: [], after: [cloneData(effect.toObject?.() ?? effect._source)] }
    };
    await attachRollUndoToChatMessage(message, [record], { label: "Undo Skill Effect Offer" });
  }
  const chainId = message.getFlag?.(SYSTEM_ID, "edgeChain")?.chainId;
  const related = chainId
    ? Array.from(game.messages || []).filter(candidate => candidate.getFlag?.(SYSTEM_ID, "edgeChain")?.chainId === chainId)
    : [message];
  for (const relatedMessage of related) {
    for (const flagKey of ["edgeChain", "edgeExplode"]) {
      const flag = relatedMessage.getFlag?.(SYSTEM_ID, flagKey);
      if (!flag || !relatedMessage.setFlag) continue;
      const postRollRecords = Array.isArray(flag.postRollRecords) ? flag.postRollRecords : [];
      if (postRollRecords.some(candidate => candidate.id === record.id)) continue;
      await relatedMessage.setFlag(SYSTEM_ID, flagKey, {
        ...flag,
        postRollRecords: [...postRollRecords, record],
        ...(flagKey === "edgeChain" ? {
          undoRecords: [...(flag.undoRecords || []), record]
        } : {})
      });
    }
  }
}

async function applyOfferAsAuthority({ message, operationId, requesterUserId }) {
  const requester = game.users?.get?.(requesterUserId);
  if (!requester) return { ok: false, error: "The requesting user is unavailable." };
  if (!requester.isGM && !message?.canUserModify?.(requester, "update")) {
    return { ok: false, error: "You cannot update this chat message." };
  }
  if (isOfferMessageRetired(message)) {
    return { ok: false, error: "This roll has been undone or superseded." };
  }
  const flag = message.getFlag?.(SYSTEM_ID, OFFER_FLAG);
  const offer = flag?.offers?.find(candidate => candidate.operationId === operationId);
  if (!offer || !["pending", "processing", "applied"].includes(offer.status)) {
    return { ok: false, error: "This effect offer is unavailable." };
  }
  if (!Array.isArray(offer.conditions) || !offer.conditions.every(when => isSkillRuleEligible(when, {
    success: offer.outcome?.success === true,
    failed: offer.outcome?.failed === true,
    hit: offer.outcome?.hit === true,
    manual: offer.application !== "automatic"
  }))) return { ok: false, error: "The saved result does not satisfy this effect's conditions." };
  const target = await fromUuid(offer.targetUuid);
  if (!target || typeof target.createEmbeddedDocuments !== "function") {
    return { ok: false, error: "The eligible target is unavailable." };
  }
  if (!requester.isGM && !target.canUserModify?.(requester, "update")) {
    return { ok: false, error: `You cannot update ${target.name || "the target"}.` };
  }
  if (!getCurrentOfferFlag(message, operationId)) return { ok: false, error: "This effect operation was superseded." };
  const existing = getOfferEffect(target, message.id, operationId);
  if (existing) {
    await ensureOfferUndo(message, target, existing);
    if (offer.status !== "applied") await saveOfferStatus(message, offer, "applied", { effectId: existing.id });
    return { ok: true, effectId: existing.id, alreadyApplied: true };
  }
  if (offer.status === "applied") return { ok: false, error: "The applied effect is no longer present." };
  if (offer.status === "processing" && Date.now() - (Number(offer.processingAt) || 0) < 30000) {
    return { ok: false, error: "This offer is already processing." };
  }
  const template = cloneData(offer.template);
  if (template?.type !== "skill" || !isSkillEditorDefinition(template)
    || template.changes?.some(change => isPeasantActiveEffectStateKey(change?.key))) {
    return { ok: false, error: "The saved effect template is not safe to apply." };
  }
  await saveOfferStatus(message, offer, "processing", {
    processingAt: Date.now(), processingUserId: requesterUserId
  });
  delete template._id;
  template.disabled = false;
  delete template.flags?.[SYSTEM_ID]?.skillEditorDefinition;
  template.flags ??= {};
  template.flags[SYSTEM_ID] ??= {};
  template.flags[SYSTEM_ID].skillUseOrigin = {
    ...cloneData(offer.origin),
    messageId: message.id,
    operationId
  };
  const ActiveEffectClass = globalThis.ActiveEffect?.implementation ?? globalThis.ActiveEffect;
  template.start = ActiveEffectClass?.getEffectStart?.(game.combat || null) ?? {
    combat: game.combat?.id || null,
    round: game.combat?.round ?? null,
    turn: game.combat?.turn ?? null,
    time: Number(game.time?.worldTime) || 0
  };
  let effect;
  try {
    const captured = await captureActorRollUndo(target, "Skill Effect Offer", async () => {
      const created = await target.createEmbeddedDocuments("ActiveEffect", [template]);
      return created?.[0] || null;
    }, { includeSkillEffects: true });
    effect = captured.result;
    if (!effect) throw new Error("The effect could not be created.");
    if (!getCurrentOfferFlag(message, operationId)) throw new Error("This effect operation was superseded.");
    await attachRollUndoToChatMessage(message, captured.undoRecords, { label: "Undo Skill Effect Offer" });
    await ensureOfferUndo(message, target, effect);
    await saveOfferStatus(message, offer, "applied", { effectId: effect.id });
    return { ok: true, effectId: effect.id, alreadyApplied: false };
  } catch (error) {
    if (!getCurrentOfferFlag(message, operationId)) {
      const staleCopy = effect ?? getOfferEffect(target, message.id, operationId);
      if (staleCopy && target.effects?.get?.(staleCopy.id)) {
        try { await target.deleteEmbeddedDocuments("ActiveEffect", [staleCopy.id]); }
        catch (cleanupError) {
          return { ok: false, error: "The roll changed, but its stale effect could not be removed; remove it manually." };
        }
      }
      return { ok: false, error: "This effect operation was superseded." };
    }
    if (effect || getOfferEffect(target, message.id, operationId)) {
      return { ok: false, error: "Effect created, but chat confirmation failed; retry to recover it." };
    }
    try { await saveOfferStatus(message, offer, "pending", { processingAt: null, processingUserId: null }); } catch (_) {}
    return { ok: false, error: error?.message || "The effect could not be applied." };
  }
}

export async function applySkillEffectOffer({ message, operationId, requesterUserId = game.user?.id } = {}) {
  const key = `${message?.id || ""}:${operationId || ""}:${requesterUserId || ""}`;
  if (!message?.id || !operationId) return { ok: false, error: "The effect offer is unavailable." };
  if (inFlightApplications.has(key)) return inFlightApplications.get(key);
  const targetUuid = message.getFlag?.(SYSTEM_ID, OFFER_FLAG)?.offers?.find(offer => offer.operationId === operationId)?.targetUuid;
  if (!targetUuid) return { ok: false, error: "The effect offer is unavailable." };
  const previous = targetQueues.get(targetUuid) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => applyOfferAsAuthority({ message, operationId, requesterUserId }))
    .catch(error => ({ ok: false, error: error?.message || "The effect offer could not be applied." }));
  inFlightApplications.set(key, operation);
  targetQueues.set(targetUuid, operation);
  try { return await operation; } finally {
    inFlightApplications.delete(key);
    if (targetQueues.get(targetUuid) === operation) targetQueues.delete(targetUuid);
  }
}

export function configureSkillEffectOfferChatContext() {
  Hooks.on("updateChatMessage", message => {
    if (!message?.getFlag?.(SYSTEM_ID, OFFER_FLAG)) return;
    const card = getSkillEffectOfferCard(message.id);
    if (card) void globalThis.ui?.chat?.updateMessage?.(card);
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = toElement(html);
    const cardLink = message?.getFlag?.(SYSTEM_ID, OFFER_CARD_FLAG);
    if (!cardLink) return;
    const source = game.messages?.get?.(cardLink.sourceMessageId);
    const list = root?.querySelector?.(".pc-skill-effect-offer-list");
    if (!list) return;
    const flag = source?.getFlag?.(SYSTEM_ID, OFFER_FLAG);
    const offers = flag?.offers;
    if (!Array.isArray(offers)) {
      const status = document.createElement("p");
      status.textContent = "The original roll is unavailable.";
      list.append(status);
      return;
    }
    if (isOfferMessageRetired(source)) {
      const status = document.createElement("p");
      status.textContent = "This roll was undone or superseded.";
      list.append(status);
      return;
    }
    const section = list;
    let hasVisibleContent = false;
    for (const guidance of flag.manualNotes ?? []) {
      const note = document.createElement("p");
      note.className = "pc-skill-effect-offer-note";
      note.textContent = `${guidance.tagKey || "Manual"}: ${guidance.note}`;
      section.append(note);
      hasVisibleContent = true;
    }
    for (const offer of offers) {
      let target = null;
      try { target = globalThis.fromUuidSync?.(offer.targetUuid) || null; } catch (_) {}
      if (!game.user?.isGM && (!source.canUserModify?.(game.user, "update")
        || !target?.canUserModify?.(game.user, "update"))) continue;
      if (offer.status === "applied") {
        if (offer.application !== "automatic" || offer.automaticError) {
          const status = document.createElement("p");
          status.className = "pc-skill-effect-offer-status";
          status.textContent = `Applied ${offer.template?.name || "Effect"} → ${target?.name || "Target"}`;
          section.append(status);
          hasVisibleContent = true;
        }
        continue;
      }
      if (offer.status !== "pending" && offer.status !== "processing") continue;
      if (offer.application === "automatic" && !offer.automaticError
        && automaticDispatches.has(`${source.id}:${offer.operationId}`)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pc-skill-effect-offer-button";
      button.disabled = offer.status === "processing" && offer.application !== "automatic";
      const action = offer.application === "automatic" ? "Retry"
        : offer.application === "manual" ? "Apply" : "Accept";
      button.textContent = `${action} ${offer.template?.name || "Effect"} → ${target?.name || "Target"}`;
      button.addEventListener("click", async event => {
        event.preventDefault();
        button.disabled = true;
        const result = await requestSkillEffectOfferApplication({ messageId: source.id, operationId: offer.operationId });
        if (result?.ok) button.remove();
        else {
          button.disabled = false;
          ui.notifications?.warn?.(result?.error || "The effect offer could not be applied.");
        }
      });
      section.append(button);
      hasVisibleContent = true;
    }
    if (!hasVisibleContent) {
      const status = document.createElement("p");
      status.textContent = "No effect offers are available for this result.";
      section.append(status);
    }
  });
}
