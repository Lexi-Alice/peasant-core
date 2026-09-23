import {
  applyManifestSpellEffectToActor,
  absorbActorSpellEffect,
  collectManifestSpellRecipients,
  getManifestSpellDefinition,
  getManifestSpellEncounterData,
  getManifestSpellSlotAction
} from "../../data/active-effect/spell-effects.mjs";
import { escapeHtml } from "../../utils/chat.mjs";
import { normalizeHaltValues } from "../../data/actor/combat-modifiers.mjs";
import { captureActorRollUndo, collectRollUndoRecords } from "../chat-undo.mjs";
import { getPreferredDefensePromptRecipientUser, resolveDefensePromptActor } from "./actor-targets.mjs";

export function buildManifestSpellCastPreflight({ caster = null, targets = [], rollType = "" } = {}) {
  const definition = getManifestSpellDefinition(rollType);
  const collected = definition ? collectManifestSpellRecipients({ caster, targets }) : [];
  if (!definition || collected.length === 0) {
    return { ok: false, definition, recipients: [], replacements: [] };
  }

  const recipients = collected.map((recipient) => {
    const actor = recipient.actor;
    const slot = getManifestSpellSlotAction(actor, {
      manifestType: definition.manifestType,
      category: definition.category
    });
    return {
      ...recipient,
      slotAction: slot.action,
      occupantId: slot.effect?.id || slot.effect?._id || "",
      occupantName: slot.effect?.name || "",
      pending: getManifestSpellEncounterData(actor, definition.manifestType).pending
    };
  });
  const replacements = recipients
    .filter((recipient) => recipient.slotAction === "replace")
    .map((recipient) => ({
      actorName: recipient.actor?.name || recipient.targetName || "Actor",
      occupantId: recipient.occupantId,
      occupantName: recipient.occupantName || "Active Spell Effect",
      category: definition.category
    }));

  return { ok: true, definition, recipients, replacements };
}

export function buildManifestSpellApplicationPayload({
  recipient = null,
  definition = null,
  caster = null,
  rollTotal = 0,
  maximized = 0,
  duration = null,
  haltValues = null,
  expectedOccupantId = "",
  replacementApproved = false,
  img = ""
} = {}) {
  const targetActor = recipient?.actor || null;
  const tokenDocument = recipient?.tokenDocument || recipient?.token?.document || recipient?.token || null;
  return {
    targetSceneId: tokenDocument?.parent?.id || tokenDocument?.scene?.id || null,
    targetTokenId: tokenDocument?.id || null,
    targetTokenUuid: tokenDocument?.uuid || null,
    targetActorId: targetActor?.id || recipient?.actorId || null,
    targetActorUuid: targetActor?.uuid || null,
    targetName: recipient?.targetName || targetActor?.name || "Target",
    manifestType: definition?.manifestType || "",
    rollTotal: Number(rollTotal) || 0,
    maximized: Number(maximized) || 0,
    ...(definition?.manifestType === "dome" ? { duration: Math.max(1, Number.parseInt(duration, 10) || 3) } : {}),
    ...(definition?.manifestType === "resistance"
      ? { haltValues: normalizeHaltValues(haltValues ?? [1, 1, 1, 1]) }
      : {}),
    casterUuid: caster?.uuid || "",
    img: String(img || ""),
    expectedOccupantId: String(expectedOccupantId || ""),
    replacementApproved: !!replacementApproved
  };
}

export function renderManifestSpellRecipientRows(results = []) {
  if (!Array.isArray(results) || results.length === 0) return "";
  const result = results.find((entry) => entry?.applied === true);
  if (!result) return "";
  return `<div>Duration: ${escapeHtml(result.durationLabel || "Active")}</div>`;
}

export async function applyManifestSpellEffect(payload = {}) {
  const actor = await resolveDefensePromptActor(payload);
  if (!actor) return { handled: true, applied: false, reason: "Target actor was not found" };

  const capture = await captureActorRollUndo(
    actor,
    `${getManifestSpellDefinition(payload.manifestType)?.label || "Manifest Spell"} Cast`,
    () => applyManifestSpellEffectToActor(actor, payload),
    { includeSpellEffects: true }
  );
  return {
    ...capture.result,
    targetName: payload.targetName || actor.name || "Target",
    undoRecords: collectRollUndoRecords(capture.undoRecords, capture.result?.undoRecords)
  };
}

export async function requestManifestSpellApplicationForTarget({ recipient = null, payload = null } = {}) {
  const actor = recipient?.actor || null;
  const tokenDocument = recipient?.tokenDocument || recipient?.token?.document || recipient?.token || null;
  if (!actor || !payload) return { handled: true, applied: false, reason: "Target actor was not found" };

  let canApplyLocally = false;
  try {
    canApplyLocally = !!globalThis.game?.user?.isGM
      || (typeof actor.canUserModify === "function" && actor.canUserModify(globalThis.game?.user, "update"));
  } catch (_error) {}
  if (canApplyLocally) return applyManifestSpellEffect(payload);

  const recipientUser = getPreferredDefensePromptRecipientUser(actor, tokenDocument);
  const remote = globalThis.game?.peasantCore?.applyManifestSpellEffectForUser;
  if (!recipientUser?.id || typeof remote !== "function") {
    return { handled: true, applied: false, reason: "No owner or GM could apply the effect" };
  }
  const result = await remote(recipientUser.id, payload);
  if (!result || result.deferred || !result.handled) {
    return { handled: true, applied: false, reason: "Socket response unavailable" };
  }
  return result;
}

export async function applyManifestDomeAbsorption(payload = {}) {
  const actor = await resolveDefensePromptActor(payload);
  const damage = Math.max(0, Math.floor(Number(payload.damage) || 0));
  const damageType = String(payload.damageType || "");
  if (!actor) {
    return {
      handled: true,
      applied: false,
      reason: "Target actor was not found",
      absorbed: 0,
      penetration: damage,
      remainingHp: 0,
      depleted: false,
      damageType,
      magnetismGrade: 0,
      undoRecords: []
    };
  }

  const capture = await captureActorRollUndo(
    actor,
    "Manifest Dome Absorption",
    () => absorbActorSpellEffect(actor, { manifestType: "dome", damage, damageType }),
    { includeSpellEffects: true }
  );
  const result = capture.result || {};
  return {
    ...result,
    handled: true,
    damageType,
    magnetismGrade: result.applied && result.penetration > 0
      ? Math.max(0, Math.floor(Number(result.magnetismGrade) || 0))
      : 0,
    undoRecords: collectRollUndoRecords(capture.undoRecords, result.undoRecords)
  };
}

export async function requestManifestDomeAbsorptionForTarget({
  target = null,
  damage = 0,
  damageType = "",
  payload = null
} = {}) {
  const actor = target?.actor || null;
  const tokenDocument = target?.tokenDocument || target?.token?.document || target?.token || null;
  if (!actor) return { handled: true, applied: false, reason: "Target actor was not found" };

  const requestPayload = payload || {
    targetSceneId: tokenDocument?.parent?.id || tokenDocument?.scene?.id || null,
    targetTokenId: tokenDocument?.id || null,
    targetTokenUuid: tokenDocument?.uuid || null,
    targetActorId: actor.id || null,
    targetActorUuid: actor.uuid || null,
    targetName: target?.targetName || tokenDocument?.name || actor.name || "Target",
    damage: Math.max(0, Math.floor(Number(damage) || 0)),
    damageType: String(damageType || "")
  };

  let canApplyLocally = false;
  try {
    canApplyLocally = !!globalThis.game?.user?.isGM
      || (typeof actor.canUserModify === "function" && actor.canUserModify(globalThis.game?.user, "update"));
  } catch (_error) {}
  if (canApplyLocally) return applyManifestDomeAbsorption(requestPayload);

  const recipientUser = getPreferredDefensePromptRecipientUser(actor, tokenDocument);
  const remote = globalThis.game?.peasantCore?.absorbManifestDomeForUser;
  if (!recipientUser?.id || typeof remote !== "function") {
    return { handled: true, applied: false, reason: "No owner or GM could apply Manifest Dome" };
  }
  const result = await remote(recipientUser.id, requestPayload);
  if (!result || result.deferred || !result.handled) {
    return { handled: true, applied: false, reason: "Socket response unavailable" };
  }
  return result;
}
