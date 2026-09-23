import { getCombatFlatDamageModifier } from "../../data/actor/combat-modifiers.mjs";
import { applyDieRate } from "../../dice/combat-dice.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";
import { getActorRollSpeaker } from "./actor-targets.mjs";
import { evaluateCombatValueDice } from "../../dice/combat-value-rolls.mjs";

export function normalizeAutomatedCombatHealType(rawType) {
  const type = String(rawType || "").trim().toLowerCase();
  if (type === "greater" || type === "special") return type;
  return "temporary";
}

export function getAutomatedCombatHealTypeLabel(rawType) {
  const type = normalizeAutomatedCombatHealType(rawType);
  return type === "greater" ? "Greater" : type === "special" ? "Special" : "Temporary";
}

export async function rollAutomatedCombatHeal(actor, combat, {
  targetLabel = "",
  attackerToken = null,
  diceOverride = null,
  chatMessage = null,
  combatMods = null,
  maximize = false
} = {}) {
  if (!actor || !combat?.heal) return null;

  const combatName = combat.name || "Combat";
  combatMods = combatMods || actor.system?.combatMods || { diceRate: 0, flatDamage: 0 };
  const diceRateMod = Number.parseInt(combatMods.diceRate, 10) || 0;
  const flatDamageMod = getCombatFlatDamageModifier(combatMods);
  const healResult = applyDieRate(
    combat.heal.diceCount || 0,
    combat.heal.diceValue || 0,
    combat.heal.flat || 0,
    diceRateMod,
    combat.heal.diceBonus || 0
  );

  const diceCount = Number(healResult.diceCount) || 0;
  const diceValue = Number(healResult.diceValue) || 0;
  const flat = (Number(healResult.flat) || 0) + flatDamageMod;
  const naturalDiceCount = diceCount;
  const useStability = diceCount > 0 && diceValue > 0 && !!combat.stability;
  const useStrengthen = useStability && !!combat.strengthen;
  const rolledDiceCount = useStability ? (naturalDiceCount * 2) : naturalDiceCount;

  let roll = null;
  let allDice = [];
  let adjustedDiceTotal = 0;
  let diceDetailLine = `<div>Dice: [] = 0</div>`;

  if (diceCount > 0 && diceValue > 0) {
    const fixedDice = Array.isArray(diceOverride)
      ? diceOverride.map(Number).filter((value) => Number.isFinite(value) && value >= 1 && value <= diceValue)
      : [];
    if (maximize) {
      allDice = Array.from({ length: rolledDiceCount }, () => diceValue);
    } else if (fixedDice.length === rolledDiceCount) {
      allDice = fixedDice;
    } else {
      roll = await new Roll(`${rolledDiceCount}d${diceValue}`).evaluate();
      allDice = roll.dice.flatMap((d) => d.results.map((r) => r.result));
    }
    const diceBreakdown = allDice.join(", ");
    const diceSum = allDice.reduce((sum, value) => sum + value, 0);
    const evaluation = evaluateCombatValueDice({
      dice: allDice,
      naturalDiceCount,
      useStability,
      useStrengthen
    });
    adjustedDiceTotal = evaluation.adjustedDiceTotal;
    diceDetailLine = `<div>${maximize ? "Maximized Dice" : "Dice"}: [${diceBreakdown}] = ${diceSum}</div>`;

    if (useStrengthen) {
      const keepIndexSet = new Set(evaluation.keptIndices);
      const droppedDisplay = allDice
        .map((die, index) => keepIndexSet.has(index) ? `${die}` : `<span style="color: #888;">${die}</span>`)
        .join(", ");
      diceDetailLine = `<div>${maximize ? "Maximized Strengthened Dice" : "Strengthened Dice"}: [${droppedDisplay}] = ${adjustedDiceTotal}</div>`;
    } else if (useStability) {
      diceDetailLine = `<div>${maximize ? "Maximized Stabilized Dice" : "Stabilized Dice"}: [${diceBreakdown}] / 2 = ${adjustedDiceTotal}</div>`;
    }
  }

  const total = adjustedDiceTotal + flat;
  const speaker = getActorRollSpeaker(actor, attackerToken);
  const typeLabel = getAutomatedCombatHealTypeLabel(combat.heal.type);
  const typeDisplay = typeLabel ? `<span style="color: #aaa; font-size: 11px; margin-left: 6px;">${escapeHtml(typeLabel)}</span>` : "";
  const rollTitle = targetLabel ? `${combatName} vs ${targetLabel}` : combatName;
  const rollId = `automated-heal-roll-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const chatHtml = `<fieldset class="skill-roll-card pc-heal-roll-card" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <legend>
      ${escapeHtml(rollTitle)}
    </legend>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; gap: 6px;">
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: transparent; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">Heal:</span>
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
        <div>Flat Modifier: ${flat > 0 ? "+" : ""}${flat}</div>` : ""}
      </div>
    </div>
  </fieldset>`;

  if (chatMessage?.update) {
    await chatMessage.update({ content: chatHtml });
  } else {
    chatMessage = await ChatMessage.create(applyMessageMode({
      user: game.user.id,
      speaker,
      content: chatHtml,
      rolls: roll ? [roll] : undefined,
      sound: null
    }));
  }

  return {
    total,
    flat,
    diceCount,
    diceValue,
    typeLabel,
    healType: normalizeAutomatedCombatHealType(combat.heal.type),
    roll,
    chatMessage,
    allDice,
    adjustedDiceTotal
  };
}
