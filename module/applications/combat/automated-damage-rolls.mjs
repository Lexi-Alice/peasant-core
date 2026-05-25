import { buildAutomatedCombatDamageData } from "../../data/actor/combat-damage.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";
import { getActorRollSpeaker } from "./actor-targets.mjs";

export async function rollAutomatedCombatDamage(actor, combat, { targetLabel = "", attackerToken = null, appliedDamageType = null } = {}) {
  if (!actor || !combat?.damage) return null;

  const damageData = buildAutomatedCombatDamageData(actor, combat, { appliedDamageType });
  const { combatName, diceCount, diceValue, flat, naturalDiceCount, rolledDiceCount, useStability, useStrengthen, typeLabel, normalizedType } = damageData;

  let roll = null;
  let allDice = [];
  let adjustedDiceTotal = 0;
  let diceDetailLine = `<div>Dice: [] = 0</div>`;

  if (diceCount > 0 && diceValue > 0) {
    const formula = `${rolledDiceCount}d${diceValue}`;
    roll = await new Roll(formula).evaluate();
    allDice = roll.dice.flatMap((d) => d.results.map((r) => r.result));
    const diceBreakdown = allDice.join(", ");
    const diceSum = allDice.reduce((a, b) => a + b, 0);
    adjustedDiceTotal = diceSum;
    diceDetailLine = `<div>Dice: [${diceBreakdown}] = ${diceSum}</div>`;

    if (useStrengthen) {
      const indexed = allDice.map((value, index) => ({ value, index }));
      indexed.sort((a, b) => (b.value - a.value) || (a.index - b.index));
      const keepCount = Math.min(naturalDiceCount, allDice.length);
      const keepIndexSet = new Set(indexed.slice(0, keepCount).map((d) => d.index));
      adjustedDiceTotal = allDice.reduce((sum, value, index) => sum + (keepIndexSet.has(index) ? value : 0), 0);
      const droppedDisplay = allDice
        .map((die, index) => keepIndexSet.has(index) ? `${die}` : `<span style="color: #888;">${die}</span>`)
        .join(", ");
      diceDetailLine = `<div>Strengthened Dice: [${droppedDisplay}] = ${adjustedDiceTotal}</div>`;
    } else if (useStability) {
      adjustedDiceTotal = Math.floor(diceSum / 2);
      diceDetailLine = `<div>Stabilized Dice: [${diceBreakdown}] / 2 = ${adjustedDiceTotal}</div>`;
    }
  }

  const total = adjustedDiceTotal + flat;
  const speaker = getActorRollSpeaker(actor, attackerToken);
  const typeDisplay = typeLabel ? `<span style="color: #aaa; font-size: 11px; margin-left: 6px;">${escapeHtml(typeLabel)}</span>` : "";
  const rollTitle = targetLabel ? `${combatName} vs ${targetLabel}` : combatName;
  const rollId = `automated-damage-roll-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const chatHtml = `<div class="skill-roll-card pc-damage-roll-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #555; color: #ffffff;">
      ${escapeHtml(rollTitle)}
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; gap: 6px;">
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: transparent; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">Damage:</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: #4ade80; border: 2px solid #22c55e;">
              ${total}
            </button>${typeDisplay}
          </div>
        </div>
      </div>
      <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
        <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
        ${diceDetailLine}${flat !== 0 ? `
        <div>Flat Modifier: ${flat > 0 ? '+' : ''}${flat}</div>` : ''}
      </div>
    </div>
  </div>`;

  await ChatMessage.create(applyMessageMode({
    user: game.user.id,
    speaker,
    content: chatHtml,
    rolls: roll ? [roll] : undefined
  }));

  return {
    total,
    flat,
    diceCount,
    diceValue,
    typeLabel,
    normalizedType,
    roll,
    allDice,
    adjustedDiceTotal
  };
}
