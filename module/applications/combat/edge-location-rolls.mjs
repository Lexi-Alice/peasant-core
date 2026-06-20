import {
  LOCATION_ROLL_SOURCE_WORKFLOW,
  PC_LOCATION_ROLL_FLAG,
  buildProcessingLocationRollFlag,
  buildSupersededLocationRollFlag,
  canEdgeRerollLocationRollFlag,
  cloneLocationRollData,
  mergeLocationRollWorkflow,
  normalizeLocationRollFlag
} from "../../data/location-rolls.mjs";
import { isArmorPenLocationLike } from "../../data/actor/targeted-damage.mjs";
import { withPeasantActorStateWriteContext } from "../../data/actor/source-system.mjs";
import { escapeHtml } from "../../utils/chat.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { drawLocationTableLikeMacro } from "../actor/location-table.mjs";
import { applyIncomingHit } from "./incoming-hit.mjs";
import { userOwnsActorOrToken } from "./actor-targets.mjs";

const PC_SYSTEM_ID = "peasant-core";

function createRequestId() {
  try {
    const id = foundry?.utils?.randomID?.(16);
    if (id) return id;
  } catch (_) {}
  return `edge-location-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getMessageFromContextElement(element) {
  const candidate = element?.currentTarget || element?.target || element?.element?.[0] || element?.element || element?.[0] || element;
  const root = candidate?.closest?.("[data-message-id]") || candidate;
  const messageId = root?.dataset?.messageId || candidate?.dataset?.messageId || "";
  return messageId ? game.messages?.get(messageId) || null : null;
}

function getLocationRollFlagFromMessage(message) {
  return normalizeLocationRollFlag(message?.getFlag?.(PC_SYSTEM_ID, PC_LOCATION_ROLL_FLAG));
}

function getControlledTokenEntries() {
  return Array.from(canvas?.tokens?.controlled || [])
    .map((token) => {
      const tokenDocument = token?.document ?? token ?? null;
      const actor = token?.actor || tokenDocument?.actor || null;
      return actor ? { token, tokenDocument, actor } : null;
    })
    .filter(Boolean);
}

export function chooseEdgeLocationRollSpender({
  selectedActors = [],
  hasSelectedTokens = false,
  assignedActor = null
} = {}) {
  const selected = selectedActors.filter(Boolean);
  if (hasSelectedTokens) {
    if (selected.length > 1) return { ok: false, reason: "multiple-selected" };
    if (selected.length === 1) return { ok: true, actor: selected[0], source: "selected-token" };
    return { ok: false, reason: "no-owned-selected" };
  }
  if (assignedActor) return { ok: true, actor: assignedActor, source: "assigned-character" };
  return { ok: false, reason: "no-assigned-character" };
}

export function getActorCurrentEdge(actor) {
  const edge = Number.parseInt(actor?.system?.edge?.value, 10);
  return Number.isFinite(edge) ? Math.max(0, edge) : 0;
}

export function actorHasCurrentEdge(actor) {
  return getActorCurrentEdge(actor) > 0;
}

function getOwnedSelectedTokenEntries(user = game.user) {
  return getControlledTokenEntries()
    .filter(({ actor, tokenDocument }) => userOwnsActorOrToken(user, actor, tokenDocument));
}

export function resolveEdgeLocationRollSpender({ warn = false, label = "Edge Location Roll" } = {}) {
  const selectedTokens = getControlledTokenEntries();
  const ownedSelectedTokens = getOwnedSelectedTokenEntries(game.user);
  const decision = chooseEdgeLocationRollSpender({
    selectedActors: ownedSelectedTokens.map(entry => entry.actor),
    hasSelectedTokens: selectedTokens.length > 0,
    assignedActor: game.user?.character || null
  });

  if (!decision.ok) {
    if (warn) {
      if (decision.reason === "multiple-selected") {
        ui.notifications?.warn?.(`Select only one owned token before using ${label}.`);
      } else if (decision.reason === "no-owned-selected") {
        ui.notifications?.warn?.("Select one owned token, or deselect tokens to use your assigned character.");
      } else {
        ui.notifications?.warn?.(`No assigned character found for ${label}.`);
      }
    }
    return decision;
  }

  if (!actorHasCurrentEdge(decision.actor)) {
    if (warn) ui.notifications?.warn?.(`${decision.actor?.name || "Actor"} has no current Edge.`);
    return { ok: false, reason: "no-edge", actor: decision.actor };
  }

  return decision;
}

function canOfferEdgeLocationRoll(message) {
  const flag = getLocationRollFlagFromMessage(message);
  return canEdgeRerollLocationRollFlag(flag);
}

export function getActorUpdatePermissionError(user, actor) {
  if (!actor) return "Edge spender actor was not found.";
  if (userOwnsActorOrToken(user, actor)) return "";
  return `You do not own ${actor.name || "that actor"}.`;
}

export async function resolveActorFromUuidOrId({ actorUuid = "", actorId = "", tokenUuid = "" } = {}) {
  const uuid = String(actorUuid || "").trim();
  if (uuid && typeof fromUuid === "function") {
    try {
      const resolved = await fromUuid(uuid);
      if (resolved?.documentName === "Actor" || String(resolved?.collectionName || "").toLowerCase() === "actors") {
        return resolved;
      }
      if (resolved?.actor) return resolved.actor;
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to resolve Edge spender actor UUID", e);
    }
  }

  const tokenId = String(tokenUuid || "").trim();
  if (tokenId && typeof fromUuid === "function") {
    try {
      const tokenDocument = await fromUuid(tokenId);
      if (tokenDocument?.actor) return tokenDocument.actor;
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to resolve Edge spender token UUID", e);
    }
  }

  const id = String(actorId || "").trim();
  return id ? game.actors?.get(id) || null : null;
}

export async function spendActorEdge(actor) {
  const before = getActorCurrentEdge(actor);
  if (before <= 0) return { ok: false, error: `${actor?.name || "Actor"} has no current Edge.` };
  if (typeof actor.updatePeasantStateData === "function") await actor.updatePeasantStateData({ "system.edge.value": before - 1 });
  else await actor.update({ "system.edge.value": before - 1 }, withPeasantActorStateWriteContext());
  return { ok: true, before, after: before - 1 };
}

export async function refundActorEdge(actor, edgeSpend) {
  if (!edgeSpend?.ok || !actor?.update) return;
  try {
    if (typeof actor.updatePeasantStateData === "function") await actor.updatePeasantStateData({ "system.edge.value": edgeSpend.before });
    else await actor.update({ "system.edge.value": edgeSpend.before }, withPeasantActorStateWriteContext());
  } catch (e) {
    console.error("Peasant Core | Failed to refund Edge after location reroll failure", e);
  }
}

async function resolveUndoActor(record) {
  const actorUuid = String(record?.actorUuid || "").trim();
  if (actorUuid && typeof fromUuid === "function") {
    try {
      const actor = await fromUuid(actorUuid);
      if (actor) return actor;
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to resolve Edge location undo actor UUID", e);
    }
  }

  const actorId = String(record?.actorId || "").trim();
  return actorId ? game.actors?.get(actorId) || null : null;
}

async function applyUndoRecords(records = []) {
  const undoRecords = Array.isArray(records) ? records : [];
  for (const record of [...undoRecords].reverse()) {
    if (!record?.before || typeof record.before !== "object") continue;
    const actor = await resolveUndoActor(record);
    if (!actor?.update) {
      return { ok: false, error: `Could not find ${record?.actorName || "actor"} for location reroll undo.` };
    }
    await actor.update(record.before);
  }
  return { ok: true };
}

function buildReplacementWorkflow(flag) {
  const workflow = flag?.workflow || {};
  return {
    attackCombatName: String(workflow.attackCombatName || "").trim(),
    targetLabel: String(workflow.targetLabel || "").trim(),
    targetActorUuid: String(workflow.targetActorUuid || "").trim(),
    targetTokenUuid: String(workflow.targetTokenUuid || "").trim(),
    defendedByReflex: !!workflow.defendedByReflex,
    applicationPayload: null,
    undoRecords: []
  };
}

async function markLocationMessageSuperseded(message, {
  replacedByMessageId = null,
  supersededReason = "edge"
} = {}) {
  const flag = getLocationRollFlagFromMessage(message);
  if (!flag) return null;
  const nextFlag = buildSupersededLocationRollFlag(flag, { replacedByMessageId, supersededReason });
  await message.setFlag(PC_SYSTEM_ID, PC_LOCATION_ROLL_FLAG, nextFlag);
  return nextFlag;
}

async function drawReplacementLocation(flag, originalMessageId) {
  const nextRevision = Number(flag?.revision || 0) + 1;
  const drawOptions = {
    source: flag.source,
    workflowId: flag.workflowId,
    revision: nextRevision,
    replacementOfMessageId: originalMessageId,
    workflow: flag.source === LOCATION_ROLL_SOURCE_WORKFLOW ? buildReplacementWorkflow(flag) : null
  };

  let locationRoll = await drawLocationTableLikeMacro(drawOptions);
  if (
    flag.source === LOCATION_ROLL_SOURCE_WORKFLOW
    && flag.workflow?.defendedByReflex
    && locationRoll?.location === "Head"
  ) {
    ui.notifications?.info?.("Head deflected by the defensive reflex. Rerolling location.");
    if (locationRoll?.chatMessage) {
      await markLocationMessageSuperseded(locationRoll.chatMessage, {
        supersededReason: "reflex-deflection"
      });
    }
    locationRoll = await drawLocationTableLikeMacro(drawOptions);
  }

  return locationRoll;
}

export function buildEdgeRerolledIncomingHitPayload(sourcePayload = {}, locationRoll = {}) {
  const payload = cloneLocationRollData(sourcePayload) || {};
  const location = String(locationRoll.location || "Torso").trim() || "Torso";
  const locationDisplay = String(locationRoll.locationDisplay || locationRoll.rawText || location).trim() || location;
  const rawText = String(locationRoll.rawText || locationDisplay).trim() || locationDisplay;
  const armorPenHit = isArmorPenLocationLike({
    isAP: locationRoll.isAP,
    rawText,
    locationResultText: locationDisplay,
    label: location
  });

  return {
    ...payload,
    location,
    locationDisplay,
    locationResultText: rawText,
    isAP: armorPenHit
  };
}

async function updateReplacementWorkflowMessage(message, sourceFlag, {
  applicationPayload = null,
  application = null,
  spenderActor = null,
  requesterUserId = null
} = {}) {
  const replacementFlag = getLocationRollFlagFromMessage(message);
  if (!replacementFlag) return null;
  const workflow = {
    ...buildReplacementWorkflow(sourceFlag),
    applicationPayload: cloneLocationRollData(applicationPayload),
    undoRecords: Array.isArray(application?.undoRecords) ? cloneLocationRollData(application.undoRecords) : [],
    edgeSpentByActorUuid: spenderActor?.uuid || null,
    edgeSpentByActorName: spenderActor?.name || null,
    edgeRequesterUserId: requesterUserId || null
  };
  const nextFlag = mergeLocationRollWorkflow(replacementFlag, workflow);
  await message.setFlag(PC_SYSTEM_ID, PC_LOCATION_ROLL_FLAG, nextFlag);
  return nextFlag;
}

async function applyWorkflowLocationReroll(flag, replacementRoll) {
  const workflow = flag.workflow || {};
  const oldPayload = workflow.applicationPayload;
  if (!oldPayload || typeof oldPayload !== "object") {
    return { ok: false, error: "Location workflow application payload is unavailable." };
  }

  const undoResult = await applyUndoRecords(workflow.undoRecords);
  if (!undoResult.ok) return undoResult;

  const nextPayload = buildEdgeRerolledIncomingHitPayload(oldPayload, replacementRoll);
  const application = await applyIncomingHit(nextPayload);
  if (!application?.handled || !application?.applied) {
    try {
      await applyIncomingHit(oldPayload);
    } catch (e) {
      console.error("Peasant Core | Failed to restore original damage after Edge location reroll failure", e);
    }
    return { ok: false, error: application?.reason || "Could not reapply damage to the new location." };
  }

  return {
    ok: true,
    application,
    applicationPayload: nextPayload
  };
}

async function createEdgeLocationRollSummary({
  spenderActor = null,
  oldResult = null,
  newResult = null
} = {}) {
  const oldLabel = oldResult?.rawText || oldResult?.locationDisplay || oldResult?.location || "Unknown";
  const newLabel = newResult?.rawText || newResult?.locationDisplay || newResult?.location || "Unknown";
  const speaker = spenderActor ? ChatMessage.getSpeaker({ actor: spenderActor }) : ChatMessage.getSpeaker();
  const content = `<fieldset class="skill-roll-card pc-edge-location-roll-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <legend>Edge Location Roll</legend>
    <div class="roll-details" style="display: block; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 12px; line-height: 1.55;">
      <div>${escapeHtml(spenderActor?.name || "Actor")} spent 1 Edge.</div>
      <div>Old Location: ${escapeHtml(oldLabel)}</div>
      <div>New Location: ${escapeHtml(newLabel)}</div>
    </div>
  </fieldset>`;
  await ChatMessage.create({ user: game.user?.id, speaker, content });
}

function getResultError(error) {
  return String(error?.message || error || "Edge Location Roll failed.");
}

export async function applyEdgeLocationRoll(payload = {}) {
  const messageId = String(payload.messageId || "").trim();
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) return { ok: false, error: "Location message was not found." };

  const flag = getLocationRollFlagFromMessage(message);
  if (!canEdgeRerollLocationRollFlag(flag)) {
    return { ok: false, error: "This location roll cannot be rerolled with Edge." };
  }

  const requester = game.users?.get(payload.requesterUserId || payload.userId) || game.user;
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

  const processingFlag = buildProcessingLocationRollFlag(flag, { processingUserId: requester?.id || null });
  try {
    await message.setFlag(PC_SYSTEM_ID, PC_LOCATION_ROLL_FLAG, processingFlag);
  } catch (error) {
    pcLog.debug("Peasant Core | Failed to lock location message for Edge reroll", error);
    return { ok: false, error: "Could not update the location message." };
  }

  let replacementRoll = null;
  let edgeSpend = null;
  let workflowResult = null;
  try {
    replacementRoll = await drawReplacementLocation(flag, message.id);
    if (!replacementRoll?.chatMessage) throw new Error("Could not create replacement location message.");

    edgeSpend = await spendActorEdge(spenderActor);
    if (!edgeSpend.ok) throw new Error(edgeSpend.error || "Could not spend Edge.");

    if (flag.source === LOCATION_ROLL_SOURCE_WORKFLOW) {
      workflowResult = await applyWorkflowLocationReroll(flag, replacementRoll);
      if (!workflowResult.ok) throw new Error(workflowResult.error);
      await updateReplacementWorkflowMessage(replacementRoll.chatMessage, flag, {
        applicationPayload: workflowResult.applicationPayload,
        application: workflowResult.application,
        spenderActor,
        requesterUserId: requester?.id || null
      });
    }

    await markLocationMessageSuperseded(message, {
      replacedByMessageId: replacementRoll.chatMessage.id,
      supersededReason: "edge"
    });
  } catch (error) {
    if (replacementRoll?.chatMessage) {
      try {
        await markLocationMessageSuperseded(replacementRoll.chatMessage, { supersededReason: "edge-failed" });
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to mark failed Edge replacement location superseded", e);
      }
    }
    await refundActorEdge(spenderActor, edgeSpend);
    try {
      await message.setFlag(PC_SYSTEM_ID, PC_LOCATION_ROLL_FLAG, flag);
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to restore location roll flag after Edge failure", e);
    }
    console.error("Peasant Core | Edge Location Roll failed", error);
    return { ok: false, error: getResultError(error) };
  }

  try {
    await createEdgeLocationRollSummary({
      spenderActor,
      oldResult: flag.result,
      newResult: replacementRoll
    });
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to create Edge Location Roll summary", e);
  }

  return {
    ok: true,
    messageId: message.id,
    replacementMessageId: replacementRoll.chatMessage.id,
    oldLocation: flag.result,
    newLocation: replacementRoll,
    workflowApplied: !!workflowResult?.ok
  };
}

export async function edgeLocationRollFromMessage(messageId) {
  const message = messageId ? game.messages?.get(messageId) || null : null;
  if (!message) {
    ui.notifications?.warn?.("Location message was not found.");
    return false;
  }

  const flag = getLocationRollFlagFromMessage(message);
  if (!canEdgeRerollLocationRollFlag(flag)) {
    ui.notifications?.warn?.("This location roll cannot be rerolled with Edge.");
    return false;
  }

  const spender = resolveEdgeLocationRollSpender({ warn: true });
  if (!spender.ok) return false;

  const tokenEntry = getOwnedSelectedTokenEntries(game.user).find(entry => entry.actor?.uuid === spender.actor?.uuid) || null;
  const requestPayload = {
    requestId: createRequestId(),
    requesterUserId: game.user?.id || null,
    messageId: message.id,
    spenderActorId: spender.actor?.id || null,
    spenderActorUuid: spender.actor?.uuid || null,
    spenderTokenUuid: tokenEntry?.tokenDocument?.uuid || null
  };

  let result = null;
  try {
    if (game.user?.isGM) {
      result = await applyEdgeLocationRoll(requestPayload);
    } else if (typeof game.peasantCore?.requestEdgeLocationRollFromGM === "function") {
      result = await game.peasantCore.requestEdgeLocationRollFromGM(requestPayload);
    } else {
      result = await applyEdgeLocationRoll(requestPayload);
    }
  } catch (error) {
    console.error("Peasant Core | Edge Location Roll request failed", error);
    result = { ok: false, error: getResultError(error) };
  }

  if (!result?.ok) {
    ui.notifications?.warn?.(result?.error || "Edge Location Roll failed.");
    return false;
  }

  return true;
}

export function configureEdgeLocationRollChatContext() {
  Hooks.on("getChatMessageContextOptions", (_application, menuItems) => {
    menuItems.push({
      name: "Edge Location Roll",
      icon: '<i class="fas fa-dice-d20"></i>',
      condition: element => canOfferEdgeLocationRoll(getMessageFromContextElement(element)),
      callback: async element => {
        const message = getMessageFromContextElement(element);
        if (message) await edgeLocationRollFromMessage(message.id);
      }
    });
  });
}

export async function attachLocationRollWorkflowData(locationRoll, {
  application = null,
  target = null,
  attackerActor = null,
  attackerToken = null,
  combat = null,
  defendedByReflex = false
} = {}) {
  const message = locationRoll?.chatMessage || null;
  if (!message?.setFlag) return null;

  const flag = getLocationRollFlagFromMessage(message);
  if (!flag || flag.source !== LOCATION_ROLL_SOURCE_WORKFLOW) return null;
  if (!application?.handled || !application?.applied) return null;

  const applicationPayload = application?.requestPayload;
  if (!applicationPayload || typeof applicationPayload !== "object") return null;

  const targetTokenDocument = target?.tokenDocument || target?.token?.document || target?.token || null;
  const attackerTokenDocument = attackerToken?.document ?? attackerToken ?? null;
  const nextFlag = mergeLocationRollWorkflow(flag, {
    attackCombatName: String(combat?.name || flag.workflow?.attackCombatName || "Combat").trim() || "Combat",
    targetLabel: String(target?.targetName || flag.workflow?.targetLabel || "").trim(),
    targetActorUuid: target?.actor?.uuid || applicationPayload.targetActorUuid || null,
    targetTokenUuid: targetTokenDocument?.uuid || applicationPayload.targetTokenUuid || null,
    attackerActorUuid: attackerActor?.uuid || applicationPayload.attackerActorUuid || null,
    attackerTokenUuid: attackerTokenDocument?.uuid || applicationPayload.attackerTokenUuid || null,
    defendedByReflex: !!defendedByReflex,
    applicationPayload: cloneLocationRollData(applicationPayload),
    undoRecords: Array.isArray(application?.undoRecords) ? cloneLocationRollData(application.undoRecords) : []
  });
  await message.setFlag(PC_SYSTEM_ID, PC_LOCATION_ROLL_FLAG, nextFlag);
  return nextFlag;
}
