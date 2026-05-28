import { escapeHtml } from "../../utils/chat.mjs";

function buildDamageTakenChatCard({
  damageAmount = 0,
  haltUsed = 0,
  tempHpUsed = 0,
  bolsteredHpUsed = 0,
  locationDisplay = "Torso",
  damageToGrid = 0,
  normalizedType = "blunt",
  isHybrid = false,
  events = []
} = {}) {
  const headline = String(events?.[events.length - 1] || "Damage Taken").trim() || "Damage Taken";
  const haltLine = haltUsed > 0 ? `-${haltUsed}` : "0";
  const hpGridText = `${damageToGrid} (${normalizedType}${isHybrid ? " - Hybrid" : ""})`;

  return `<fieldset class="skill-roll-card pc-damage-taken-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <legend>
      ${escapeHtml(headline)}
    </legend>
    <div class="roll-details" style="display: block; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 12px; line-height: 1.55;">
      <div>Damage: ${damageAmount}</div>
      <div>Location: ${escapeHtml(locationDisplay)}</div>
      <div>HALT Reduction: ${haltLine}</div>
      <div>Damage to HP Grid: ${hpGridText}</div>
      ${tempHpUsed > 0 ? `<div>Temporary HP Absorbed: ${tempHpUsed}</div>` : ""}
      ${bolsteredHpUsed > 0 ? `<div>Bolstered HP Absorbed: ${bolsteredHpUsed}</div>` : ""}
    </div>
  </fieldset>`;
}

export async function applyTargetedDamageWorkflow(actor, {
  amount,
  type,
  location = "Torso",
  isAP = false,
  useArmorCharge = false,
  ignoreHaltReduction = false,
  woundLocation = null,
  suppressLocationBreaks = false,
  chatSpeaker = null
} = {}) {
  if (!actor) return { ok: false, message: "Actor not found." };

  const result = typeof actor.applyPeasantTargetedDamage === "function"
    ? await actor.applyPeasantTargetedDamage({ amount, type, location, isAP, useArmorCharge, ignoreHaltReduction, woundLocation, suppressLocationBreaks })
    : { ok: false, message: "Peasant Core targeted damage workflow is not available for this actor." };

  if (result?.damageToGrid > 0 && result?.events?.length > 0) {
    const speaker = chatSpeaker || ChatMessage.getSpeaker({ actor });
    const chatContent = buildDamageTakenChatCard({
      damageAmount: Number(amount),
      haltUsed: result.haltUsed,
      tempHpUsed: result.tempHpUsed,
      bolsteredHpUsed: result.bolsteredHpUsed,
      locationDisplay: result.locationDisplay,
      damageToGrid: result.damageToGrid,
      normalizedType: result.normalizedType,
      isHybrid: result.isHybrid,
      events: result.events
    });
    await ChatMessage.create({ user: game.user.id, speaker, content: chatContent });
  }

  return result;
}
