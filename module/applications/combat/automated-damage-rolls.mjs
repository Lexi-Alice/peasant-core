import { buildAutomatedCombatDamageData } from "../../data/actor/combat-damage.mjs";
import { getManifestSpellDefinition } from "../../data/active-effect/spell-effects.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";
import { getActorRollSpeaker } from "./actor-targets.mjs";
import { evaluateCombatValueDice } from "../../dice/combat-value-rolls.mjs";

function barrierNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

export function renderAutomatedDamageBarrierCard(kind, result) {
  const definition = getManifestSpellDefinition(kind);
  if (!definition || result?.applied !== true || barrierNumber(result.absorbed) <= 0) return "";

  const detailLabel = definition.manifestType === "dome" ? "Dome" : "Resistance";
  const duration = String(result?.remainingDuration || "").trim();
  const durationLine = !result.depleted && duration
    ? `<div>Remaining Duration: ${escapeHtml(duration)}</div>`
    : "";
  const rollId = `automated-${definition.manifestType}-result-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  return `<fieldset class="skill-roll-card pc-manifest-roll-card pc-manifest-barrier-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <legend>${escapeHtml(definition.label)}</legend>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; gap: 6px;">
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: transparent; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">${escapeHtml(definition.label)}:</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: #4ade80; border: 2px solid #22c55e;">${barrierNumber(result.remainingHp)}</button>
            <span style="color: #aaa; font-size: 11px;">Remaining HP</span>
          </div>
        </div>
      </div>
      <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
        <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">${detailLabel} Details:</div>
        <div>Absorbed: ${barrierNumber(result.absorbed)}</div>
        <div>Penetration: ${barrierNumber(result.penetration)}</div>
        ${durationLine}
      </div>
    </div>
  </fieldset>`;
}

export async function createAutomatedDamageBarrierMessages(damageRoll, updates = {}) {
  if (!damageRoll) return [];

  const messages = [];
  for (const kind of ["dome", "resistance"]) {
    if (!Object.hasOwn(updates, kind)) continue;
    const content = renderAutomatedDamageBarrierCard(kind, updates[kind]);
    if (!content) continue;
    const message = await ChatMessage.create(applyMessageMode({
      user: game.user.id,
      speaker: damageRoll.speaker,
      content
    }));
    if (message) messages.push(message);
  }
  damageRoll.barrierMessages = [...(damageRoll.barrierMessages || []), ...messages];
  return messages;
}

export async function publishAutomatedCombatDamageRoll(damageRoll) {
  if (!damageRoll || damageRoll.chatMessage) return damageRoll?.chatMessage || null;
  damageRoll.chatMessage = await ChatMessage.create(applyMessageMode({
    user: game.user.id,
    speaker: damageRoll.speaker,
    content: damageRoll.chatHtml,
    rolls: damageRoll.roll ? [damageRoll.roll] : undefined,
    sound: null
  }));
  return damageRoll.chatMessage;
}

export async function rollAutomatedCombatDamage(actor, combat, {
  targetLabel = "",
  attackerToken = null,
  appliedDamageType = null,
  aoeReflexSaveResult = null,
  halveDamageForGlance = false,
  deferChatMessage = false,
  diceOverride = null,
  chatMessage = null,
  combatMods = null
} = {}) {
  if (!actor || !combat?.damage) return null;

  const damageData = buildAutomatedCombatDamageData(actor, combat, { appliedDamageType, combatMods });
  const { combatName, diceCount, diceValue, flat, naturalDiceCount, rolledDiceCount, useStability, useStrengthen, typeLabel, normalizedType } = damageData;

  let roll = null;
  let allDice = [];
  let adjustedDiceTotal = 0;
  let diceDetailLine = `<div>Dice: [] = 0</div>`;

  if (diceCount > 0 && diceValue > 0) {
    const fixedDice = Array.isArray(diceOverride)
      ? diceOverride.map(Number).filter((value) => Number.isFinite(value) && value >= 1 && value <= diceValue)
      : [];
    if (fixedDice.length === rolledDiceCount) {
      allDice = fixedDice;
    } else {
      const formula = `${rolledDiceCount}d${diceValue}`;
      roll = await new Roll(formula).evaluate();
      allDice = roll.dice.flatMap((d) => d.results.map((r) => r.result));
    }
    const diceBreakdown = allDice.join(", ");
    const diceSum = allDice.reduce((a, b) => a + b, 0);
    const evaluation = evaluateCombatValueDice({
      dice: allDice,
      naturalDiceCount,
      useStability,
      useStrengthen
    });
    adjustedDiceTotal = evaluation.adjustedDiceTotal;
    diceDetailLine = `<div>Dice: [${diceBreakdown}] = ${diceSum}</div>`;

    if (useStrengthen) {
      const keepIndexSet = new Set(evaluation.keptIndices);
      const droppedDisplay = allDice
        .map((die, index) => keepIndexSet.has(index) ? `${die}` : `<span style="color: #888;">${die}</span>`)
        .join(", ");
      diceDetailLine = `<div>Strengthened Dice: [${droppedDisplay}] = ${adjustedDiceTotal}</div>`;
    } else if (useStability) {
      diceDetailLine = `<div>Stabilized Dice: [${diceBreakdown}] / 2 = ${adjustedDiceTotal}</div>`;
    }
  }

  const total = adjustedDiceTotal + flat;
  const reflexSaveResult = (aoeReflexSaveResult && typeof aoeReflexSaveResult === "object")
    ? aoeReflexSaveResult
    : null;
  const reflexSavePassed = !!reflexSaveResult?.passed;
  let displayTotal = total;
  if (halveDamageForGlance) displayTotal = Math.floor(displayTotal / 2);
  if (reflexSaveResult && reflexSavePassed) displayTotal = Math.floor(displayTotal / 2);
  const damageDetailsHtml = `${diceDetailLine}${flat !== 0 ? `
        <div>Flat Modifier: ${flat > 0 ? '+' : ''}${flat}</div>` : ''}${halveDamageForGlance ? `
        <div>Damage Halved Due to Glance</div>` : ''}${reflexSavePassed ? `
        <div>Damage Halved Enemy Passed AoE Reflex Save</div>` : ''}`;
  const speaker = getActorRollSpeaker(actor, attackerToken);
  const typeDisplay = typeLabel ? `<span style="color: #aaa; font-size: 11px; margin-left: 6px;">${escapeHtml(typeLabel)}</span>` : "";
  const rollTitle = targetLabel ? `${combatName} vs ${targetLabel}` : combatName;
  const rollId = `automated-damage-roll-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const chatHtml = `<fieldset class="skill-roll-card pc-damage-roll-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <legend>
      ${escapeHtml(rollTitle)}
    </legend>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; gap: 6px;">
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: transparent; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">Damage:</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: #4ade80; border: 2px solid #22c55e;">
              ${displayTotal}
            </button>${typeDisplay}
          </div>
        </div>
      </div>
      <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
        <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
        ${damageDetailsHtml}
      </div>
    </div>
  </fieldset>`;

  const damageRoll = {
    total,
    flat,
    diceCount,
    diceValue,
    typeLabel,
    normalizedType,
    roll,
    chatMessage,
    allDice,
    adjustedDiceTotal,
    displayTotal,
    chatHtml,
    speaker,
    barrierMessages: []
  };
  if (chatMessage?.update) await chatMessage.update({ content: chatHtml });
  else if (!deferChatMessage) await publishAutomatedCombatDamageRoll(damageRoll);
  return damageRoll;
}
