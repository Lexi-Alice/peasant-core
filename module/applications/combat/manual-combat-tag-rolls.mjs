import { getCombatDesperateDieRateModifier } from "../../data/actor/combat-damage.mjs";
import { getCombatFlatDamageModifier } from "../../data/actor/combat-modifiers.mjs";
import { applyDieRate } from "../../dice/combat-dice.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";
import {
  attachEdgeChainToChatMessage,
  createManualCombatTagEdgeChainContext,
  ensureNotableCombatEdgeChainIdentity
} from "./edge-chain-rolls.mjs";

function getManualCombatTagRollData(actor, combat, rollType) {
  const combatMods = actor?.system?.combatMods || { diceRate: 0, flatDamage: 0 };
  const diceRateMod = Number.parseInt(combatMods.diceRate, 10) || 0;
  const flatDamageMod = getCombatFlatDamageModifier(combatMods);
  const desperateDieRateMod = getCombatDesperateDieRateModifier(actor, combat).modifier;
  const normalizedRollType = String(rollType || "").trim();

  if (normalizedRollType === "damage" && combat?.damage) {
    const result = applyDieRate(
      combat.damage.diceCount || 0,
      combat.damage.diceValue || 0,
      combat.damage.flat || 0,
      diceRateMod + desperateDieRateMod,
      combat.damage.diceBonus || 0
    );
    return {
      diceCount: result.diceCount,
      diceValue: result.diceValue,
      flat: result.flat + flatDamageMod,
      rollLabel: "Damage",
      typeLabel: combat.damage.type || ""
    };
  }

  if (normalizedRollType === "heal" && combat?.heal) {
    const result = applyDieRate(
      combat.heal.diceCount || 0,
      combat.heal.diceValue || 0,
      combat.heal.flat || 0,
      diceRateMod,
      combat.heal.diceBonus || 0
    );
    return {
      diceCount: result.diceCount,
      diceValue: result.diceValue,
      flat: result.flat + flatDamageMod,
      rollLabel: "Heal",
      typeLabel: combat.heal.type || ""
    };
  }

  if (normalizedRollType === "manifest" && combat?.manifest) {
    const result = applyDieRate(
      combat.manifest.diceCount || 0,
      combat.manifest.diceValue || 0,
      combat.manifest.flat || 0,
      diceRateMod,
      combat.manifest.diceBonus || 0
    );
    return {
      diceCount: result.diceCount,
      diceValue: result.diceValue,
      flat: result.flat + flatDamageMod,
      rollLabel: "Manifest",
      typeLabel: ""
    };
  }

  return null;
}

export async function rollManualCombatTag({
  actor = null,
  combatIndex = null,
  rollType = "",
  speaker = null
} = {}) {
  const index = Number.parseInt(combatIndex, 10);
  if (!actor || !Number.isFinite(index)) return null;

  const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
  const combat = combats[index] || null;
  if (!combat) return null;
  await ensureNotableCombatEdgeChainIdentity(actor, index);

  const data = getManualCombatTagRollData(actor, combat, rollType);
  if (!data) return null;

  const canRollDice = data.diceCount > 0 && data.diceValue > 0;
  const naturalDiceCount = canRollDice ? data.diceCount : 0;
  const useStability = canRollDice && !!combat.stability && ["damage", "heal", "manifest"].includes(String(rollType || "").trim());
  const useStrengthen = useStability && !!combat.strengthen;
  const rolledDiceCount = useStability ? (naturalDiceCount * 2) : naturalDiceCount;
  const roll = await new Roll(canRollDice ? `${rolledDiceCount}d${data.diceValue}` : "0").evaluate();

  const diceResults = canRollDice ? roll.dice.map(d => d.results.map(r => r.result)) : [];
  const allDice = diceResults.flat();
  const diceBreakdown = allDice.join(", ");
  const diceSum = allDice.reduce((a, b) => a + b, 0);
  let adjustedDiceTotal = diceSum;
  let diceDetailLine = `<div>Dice: [${diceBreakdown}] = ${diceSum}</div>`;

  if (useStrengthen) {
    const indexed = allDice.map((value, dieIndex) => ({ value, index: dieIndex }));
    indexed.sort((a, b) => (b.value - a.value) || (a.index - b.index));
    const keepCount = Math.min(naturalDiceCount, allDice.length);
    const keepIndexSet = new Set(indexed.slice(0, keepCount).map((d) => d.index));
    adjustedDiceTotal = allDice.reduce((sum, value, dieIndex) => sum + (keepIndexSet.has(dieIndex) ? value : 0), 0);
    const droppedDisplay = allDice
      .map((die, dieIndex) => keepIndexSet.has(dieIndex) ? `${die}` : `<span style="color: #888;">${die}</span>`)
      .join(", ");
    diceDetailLine = `<div>Strengthened Dice: [${droppedDisplay}] = ${adjustedDiceTotal}</div>`;
  } else if (useStability) {
    adjustedDiceTotal = Math.floor(diceSum / 2);
    diceDetailLine = `<div>Stabilized Dice: [${diceBreakdown}] / 2 = ${adjustedDiceTotal}</div>`;
  }

  const total = adjustedDiceTotal + data.flat;
  const chatSpeaker = speaker || ChatMessage.getSpeaker({ actor });
  const typeDisplay = data.typeLabel ? `<span style="color: #aaa; font-size: 11px; margin-left: 6px;">${escapeHtml(data.typeLabel)}</span>` : "";
  const rollId = `dice-roll-${Date.now()}`;
  const normalizedRollType = String(rollType || "").trim();
  const rollCardClass = normalizedRollType === "damage"
    ? " pc-damage-roll-card"
    : (normalizedRollType === "heal" ? " pc-heal-roll-card" : (normalizedRollType === "manifest" ? " pc-manifest-roll-card" : ""));
  const chatHtml = `<fieldset class="skill-roll-card${rollCardClass}" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
  <legend>
    ${escapeHtml(combat.name || "Combat")}
  </legend>
  <div style="display: flex; flex-direction: column; gap: 6px;">
    <div style="display: flex; gap: 6px;">
      <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: transparent; border-radius: 3px; border-left: 3px solid #555;">
        <span style="color: #ffffff; font-weight: bold; font-size: 11px;">${data.rollLabel}:</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: #4ade80; border: 2px solid #22c55e;">
            ${total}
          </button>${typeDisplay}
        </div>
      </div>
    </div>
    <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
      <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
      ${diceDetailLine}${data.flat !== 0 ? `
      <div>Flat Modifier: ${data.flat > 0 ? "+" : ""}${data.flat}</div>` : ""}
    </div>
  </div>
</fieldset>`;

  const chatMessage = await ChatMessage.create(applyMessageMode({
    user: game.user.id,
    speaker: chatSpeaker,
    content: chatHtml,
    rolls: [roll]
  }));

  await attachEdgeChainToChatMessage(
    chatMessage,
    createManualCombatTagEdgeChainContext({ actor, combatIndex: index, rollType: normalizedRollType }),
    []
  );

  return {
    chatMessage,
    total,
    flat: data.flat,
    diceCount: data.diceCount,
    diceValue: data.diceValue,
    rollType: normalizedRollType,
    roll
  };
}
