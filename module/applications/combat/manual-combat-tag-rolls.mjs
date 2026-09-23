import { getCombatDesperateDieRateModifier } from "../../data/actor/combat-damage.mjs";
import { getNotableCombatEffectImage } from "../../data/actor/notable-combat-image.mjs";
import { getCombatFlatDamageModifier, normalizeHaltValues } from "../../data/actor/combat-modifiers.mjs";
import { getManifestMaximizedValue, getManifestSpellDefinition } from "../../data/active-effect/spell-effects.mjs";
import { applyDieRate } from "../../dice/combat-dice.mjs";
import { evaluateCombatValueDice } from "../../dice/combat-value-rolls.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";
import { attachRollUndoToChatMessage, collectRollUndoRecords } from "../chat-undo.mjs";
import { getActiveNotableCombatTargets } from "./actor-targets.mjs";
import {
  attachEdgeChainToChatMessage,
  attachEdgeIndividualDieToChatMessage,
  createManualCombatTagEdgeChainContext,
  createEdgeIndividualValueRollKey,
  getEdgeIndividualDiceOverride,
  ensureNotableCombatEdgeChainIdentity
} from "./edge-chain-rolls.mjs";
import {
  buildManifestSpellApplicationPayload,
  buildManifestSpellCastPreflight,
  renderManifestSpellRecipientRows,
  requestManifestSpellApplicationForTarget
} from "./manifest-spell-effects.mjs";

export function getManualCombatTagRollData(actor, combat, rollType, combatMods = null) {
  combatMods = combatMods || actor?.system?.combatMods || { diceRate: 0, flatDamage: 0 };
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

  const manifestSpell = getManifestSpellDefinition(normalizedRollType);
  const manifestData = manifestSpell ? combat?.[manifestSpell.rollType] : null;
  if (manifestSpell && manifestData) {
    const result = applyDieRate(
      manifestData.diceCount || 0,
      manifestData.diceValue || 0,
      manifestData.flat || 0,
      diceRateMod,
      manifestData.diceBonus || 0
    );
    const normalResult = applyDieRate(
      manifestData.diceCount || 0,
      manifestData.diceValue || 0,
      manifestData.flat || 0,
      0,
      manifestData.diceBonus || 0
    );
    const flat = result.flat + flatDamageMod;
    return {
      diceCount: result.diceCount,
      diceValue: result.diceValue,
      flat,
      maximized: getManifestMaximizedValue({
        diceCount: normalResult.diceCount,
        diceValue: normalResult.diceValue,
        flat: normalResult.flat
      }),
      ...(manifestSpell.manifestType === "dome"
        ? { duration: Math.max(1, Number.parseInt(manifestData.duration, 10) || 3) }
        : {}),
      ...(manifestSpell.manifestType === "resistance"
        ? { haltValues: normalizeHaltValues(manifestData.haltValues ?? [1, 1, 1, 1]) }
        : {}),
      rollLabel: manifestSpell.label,
      typeLabel: ""
    };
  }

  return null;
}

export async function confirmManifestSpellReplacements(...preflights) {
  const replacements = preflights.flatMap((preflight) => preflight?.replacements || []);
  if (!replacements.length) return true;
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.confirm !== "function") return false;
  const replacementRows = replacements
    .map((replacement) => `<li><strong>${escapeHtml(replacement.actorName)}</strong>: replace ${escapeHtml(replacement.occupantName)} (${escapeHtml(replacement.category)})</li>`)
    .join("");
  const labels = preflights
    .map((preflight) => preflight?.definition?.label)
    .filter(Boolean)
    .join(" and ");
  return !!(await DialogV2.confirm({
    window: { title: `Cast ${labels || "Manifest Spell"}` },
    content: `<p>The following active buffs will be replaced:</p><ul>${replacementRows}</ul>`,
    modal: true
  }));
}

export async function rollManualCombatTag({
  actor = null,
  combatIndex = null,
  rollType = "",
  speaker = null,
  approvedManifestPreflight = null,
  edgeChainContext = null,
  diceOverride = null,
  chatMessage = null,
  edgeIndividualDieReplay = null,
  usageContext = null
} = {}) {
  const index = Number.parseInt(combatIndex, 10);
  if (!actor || !Number.isFinite(index)) return null;

  const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
  const usageAware = usageContext?.version === 1;
  const combat = usageAware ? structuredClone(usageContext.data) : combats[index] || null;
  if (!combat) return null;

  const data = getManualCombatTagRollData(actor, combat, rollType, usageAware ? usageContext.modifiers : null);
  if (!data) return null;
  const normalizedRollType = String(rollType || "").trim();
  const manualRollKind = normalizedRollType === "damage" ? "damage" : (normalizedRollType === "heal" ? "heal" : "manifest");
  const manualRollKey = createEdgeIndividualValueRollKey(manualRollKind, {
    rollType: normalizedRollType,
    actorRef: { actorUuid: actor.uuid, actorId: actor.id },
    combatIndex: index
  });
  const manifestSpell = getManifestSpellDefinition(normalizedRollType);
  const manifestPreflight = approvedManifestPreflight || (manifestSpell
    ? buildManifestSpellCastPreflight({
      caster: actor,
      targets: getActiveNotableCombatTargets(),
      rollType: normalizedRollType
    })
    : null);
  if (
    manifestSpell
    && (
      !manifestPreflight?.ok
      || (!approvedManifestPreflight && !(await confirmManifestSpellReplacements(manifestPreflight)))
    )
  ) {
    return { cancelled: true };
  }
  if (manifestPreflight?.recipients?.some((recipient) => recipient.pending)) {
    const pendingNames = manifestPreflight.recipients
      .filter((recipient) => recipient.pending)
      .map((recipient) => recipient.targetName || recipient.actor?.name || "Actor")
      .join(", ");
    globalThis.ui?.notifications?.warn?.(
      `${manifestSpell.label} will be pending for ${pendingNames} until each actor enters active combat.`
    );
  }
  if (!usageAware) await ensureNotableCombatEdgeChainIdentity(actor, index);

  const canRollDice = data.diceCount > 0 && data.diceValue > 0;
  const naturalDiceCount = canRollDice ? data.diceCount : 0;
  const useStability = canRollDice && !!combat.stability && [
    "damage",
    "heal",
    "manifest",
    "manifestDome",
    "manifestResistance"
  ].includes(normalizedRollType);
  const useStrengthen = useStability && !!combat.strengthen;
  const rolledDiceCount = useStability ? (naturalDiceCount * 2) : naturalDiceCount;
  const replayDice = diceOverride || getEdgeIndividualDiceOverride(edgeIndividualDieReplay, manualRollKey);
  const fixedDice = Array.isArray(replayDice)
    ? replayDice.map(Number).filter((value) => Number.isFinite(value) && value >= 1 && value <= data.diceValue)
    : [];
  const roll = fixedDice.length === rolledDiceCount
    ? null
    : await new Roll(canRollDice ? `${rolledDiceCount}d${data.diceValue}` : "0").evaluate();
  const diceResults = canRollDice && roll ? roll.dice.map(d => d.results.map(r => r.result)) : [];
  const allDice = fixedDice.length === rolledDiceCount ? fixedDice : diceResults.flat();
  const diceBreakdown = allDice.join(", ");
  const diceSum = allDice.reduce((a, b) => a + b, 0);
  const evaluation = evaluateCombatValueDice({
    dice: allDice,
    naturalDiceCount,
    useStability,
    useStrengthen
  });
  let adjustedDiceTotal = evaluation.adjustedDiceTotal;
  let diceDetailLine = `<div>Dice: [${diceBreakdown}] = ${diceSum}</div>`;

  if (useStrengthen) {
    const keepIndexSet = new Set(evaluation.keptIndices);
    const droppedDisplay = allDice
      .map((die, dieIndex) => keepIndexSet.has(dieIndex) ? `${die}` : `<span style="color: #888;">${die}</span>`)
      .join(", ");
    diceDetailLine = `<div>Strengthened Dice: [${droppedDisplay}] = ${adjustedDiceTotal}</div>`;
  } else if (useStability) {
    diceDetailLine = `<div>Stabilized Dice: [${diceBreakdown}] / 2 = ${adjustedDiceTotal}</div>`;
  }

  const total = adjustedDiceTotal + data.flat;
  const chatSpeaker = speaker || ChatMessage.getSpeaker({ actor });
  const typeDisplay = data.typeLabel ? `<span style="color: #aaa; font-size: 11px; margin-left: 6px;">${escapeHtml(data.typeLabel)}</span>` : "";
  const rollId = `dice-roll-${Date.now()}`;
  const rollCardClass = normalizedRollType === "damage"
    ? " pc-damage-roll-card"
    : (normalizedRollType === "heal" ? " pc-heal-roll-card" : (["manifest", "manifestDome", "manifestResistance"].includes(normalizedRollType) ? " pc-manifest-roll-card" : ""));
  const buildChatHtml = (manifestDetailsHtml = "") => `<fieldset class="skill-roll-card${rollCardClass}" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
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
      ${diceDetailLine}${manifestDetailsHtml}${data.flat !== 0 ? `
      <div>Flat Modifier: ${data.flat > 0 ? "+" : ""}${data.flat}</div>` : ""}
    </div>
  </div>
</fieldset>`;
  let chatHtml = buildChatHtml();

  if (chatMessage?.update) {
    await chatMessage.update({ content: chatHtml });
  } else {
    chatMessage = await ChatMessage.create(applyMessageMode({
      user: game.user.id,
      speaker: chatSpeaker,
      content: chatHtml,
      rolls: roll ? [roll] : undefined,
      sound: null
    }));
  }

  let manifestResults = [];
  if (manifestPreflight) {
    if (total <= 0) {
      manifestResults = manifestPreflight.recipients.map((recipient) => ({
        targetName: recipient.targetName || recipient.actor?.name || "Target",
        applied: false,
        reason: "Roll total was not positive"
      }));
    } else {
      for (const recipient of manifestPreflight.recipients) {
        const replacing = recipient.slotAction === "replace";
        const payload = buildManifestSpellApplicationPayload({
          recipient,
          definition: manifestPreflight.definition,
          caster: actor,
          rollTotal: total,
          maximized: data.maximized,
          duration: data.duration,
          haltValues: data.haltValues,
          expectedOccupantId: replacing ? recipient.occupantId : "",
          replacementApproved: replacing,
          img: getNotableCombatEffectImage(actor, combat)
        });
        try {
          const result = await requestManifestSpellApplicationForTarget({ recipient, payload });
          manifestResults.push({
            ...result,
            targetName: recipient.targetName || recipient.actor?.name || "Target",
            durationLabel: manifestPreflight.definition.manifestType === "dome"
              ? `${data.duration} ${data.duration === 1 ? "Round" : "Rounds"}`
              : manifestPreflight.definition.durationLabel
          });
        } catch (error) {
          manifestResults.push({
            targetName: recipient.targetName || recipient.actor?.name || "Target",
            applied: false,
            reason: error?.message || "Application failed"
          });
        }
      }
    }

    const resultsHtml = renderManifestSpellRecipientRows(manifestResults);
    if (resultsHtml && typeof chatMessage?.update === "function") {
      chatHtml = buildChatHtml(resultsHtml);
      await chatMessage.update({ content: chatHtml });
    }
    await attachRollUndoToChatMessage(
      chatMessage,
      collectRollUndoRecords(...manifestResults),
      { label: `Undo ${manifestPreflight.definition.label} Cast` }
    );
  }

  await attachEdgeChainToChatMessage(
    chatMessage,
    edgeChainContext || createManualCombatTagEdgeChainContext({
      actor,
      combatIndex: index,
      rollType: normalizedRollType,
      usageContext
    }),
    []
  );
  await attachEdgeIndividualDieToChatMessage(chatMessage, { allDice }, {
    kind: manualRollKind,
    label: combat.name || "Combat",
    diceFaces: data.diceValue,
    naturalDiceCount,
    useStability,
    useStrengthen,
    flat: data.flat,
    rollType: normalizedRollType,
    checkpoint: {
      version: 1,
      type: "manualCombatValue",
      actorId: actor.id || null,
      actorUuid: actor.uuid || null,
      combatIndex: index,
      rollType: normalizedRollType,
      ...(usageAware ? { usageContext: structuredClone(usageContext) } : {})
    },
    rollKey: manualRollKey,
    chainId: edgeChainContext?.chainId
  });

  return {
    chatMessage,
    total,
    flat: data.flat,
    diceCount: data.diceCount,
    diceValue: data.diceValue,
    rollType: normalizedRollType,
    roll,
    allDice,
    adjustedDiceTotal,
    ...(manifestPreflight ? { recipients: manifestResults } : {})
  };
}
