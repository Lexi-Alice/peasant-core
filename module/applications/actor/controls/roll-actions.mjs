import { computeBaseAttrToHits, computeBaseSaves } from "../../../data/actor/attributes.mjs";
import { getCombatFlatDamageModifier } from "../../../data/actor/combat-modifiers.mjs";
import { PC_CONSCIOUSNESS_SAVE_FLAG, PC_SAVE_MODIFIER_FLAG } from "../../../data/actor/sheet-settings.mjs";
import { applyDieRate } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";
import { performConsciousnessCheck, performSavingRoll, performSkillRoll, performUntrainedSkillRoll } from "../../../dice/rolls.mjs";
import { applyMessageMode, escapeHtml } from "../../../utils/chat.mjs";
import { pcLog } from "../../../utils/logging.mjs";
import { startNotableCombatRoll } from "../../combat/notable-combat-workflow.mjs";

function getActionElement(sheet, event, target) {
  return sheet?._getActionTarget?.(event, target) ?? target ?? event?.currentTarget ?? null;
}

function dataKeyToAttribute(key) {
  return `data-${String(key).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function readDataValue(element, key) {
  if (!element) return undefined;
  if (element.dataset && element.dataset[key] !== undefined) return element.dataset[key];
  return element.getAttribute?.(dataKeyToAttribute(key));
}

function readDataInt(element, ...keys) {
  for (const key of keys) {
    const value = Number.parseInt(readDataValue(element, key), 10);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

export async function rollConsciousnessFromElement(sheet, event, target) {
  try {
    if (!sheet?._prepareSheetRollEvent?.(event, "consciousness-roll", target)) return;
    const el = getActionElement(sheet, event, target);
    const parsedTh = readDataInt(el, "th", "tn");
    const th = Number.isFinite(parsedTh) ? parsedTh : null;
    if (th === null) return;
    const asSave = !!sheet.actor?.getFlag?.("peasant-core", PC_CONSCIOUSNESS_SAVE_FLAG);
    await performConsciousnessCheck({
      tn: th,
      asSave,
      speaker: ChatMessage.getSpeaker({ actor: sheet.actor })
    });
  } catch (err) {
    console.warn("Consciousness TH click handler failed:", err);
  }
}

export async function rollInitiativeFromElement(sheet, event, target) {
  try {
    if (!sheet?._prepareSheetRollEvent?.(event, "initiative-roll", target)) return;
    if (sheet.isEditMode) return;

    pcLog.debug("PeasantActorSheet: initiative clicked for actor", sheet.actor.id, sheet.actor.name);

    let foundCombat = game?.combat || canvas?.combat || null;
    const canvasToken = (canvas?.tokens?.placeables || []).find(t => t.actor && (t.actor.id === sheet.actor.id || t.actor.uuid === sheet.actor.uuid));
    const canvasTokenId = canvasToken?.id;

    const matchesCombatant = (c) => {
      try {
        if (!c) return false;
        const actorIdFields = [c.actor?.id, c.actor?.uuid, c.actorId, c.actorId?.toString(), c.actor?.data?.id].filter(Boolean);
        const tokenActorId = c.token?.actor?.id || c.token?.actorId || c.token?.actor?.uuid || c.token?.actor?.data?.id;
        const tokenIdFields = [c.token?.id, c.tokenId, c.token?._id].filter(Boolean);

        if (actorIdFields.includes(sheet.actor.id) || actorIdFields.includes(sheet.actor.uuid)) return true;
        if (tokenActorId === sheet.actor.id || tokenActorId === sheet.actor.uuid) return true;
        if (tokenIdFields.includes(canvasTokenId)) return true;
        return c.actor?.name === sheet.actor.name;
      } catch (e) { return false; }
    };

    let foundCombatant = foundCombat?.combatants?.find?.(matchesCombatant) || null;

    if (!foundCombatant) {
      for (const c of (game.combats?.contents || [])) {
        const cb = c.combatants.find(matchesCombatant);
        if (cb) { foundCombat = c; foundCombatant = cb; break; }
      }
    }

    if (!foundCombat || !foundCombatant) {
      try {
        const summary = (game.combats?.contents || []).map(c => ({ id: c.id, scene: c.scene, combatants: c.combatants.map(cb => ({ id: cb.id, actorId: cb.actor?.id || cb.actorId || null, tokenId: cb.token?.id || cb.tokenId || null })) }));
        pcLog.debug("PeasantActorSheet: no combat found for actor", sheet.actor.id, { canvasTokenId, combats: summary });
      } catch (e) {
        pcLog.debug("PeasantActorSheet: no combat found and failed to enumerate combats", e);
      }
      return;
    }

    const targetCombatant = foundCombat.combatants.find(matchesCombatant);
    if (!targetCombatant) {
      pcLog.debug("PeasantActorSheet: matching combatant not present on foundCombat", { combatId: foundCombat.id });
      return;
    }

    pcLog.debug("PeasantActorSheet: delegating to Combat.rollInitiative", { combatId: foundCombat.id, combatantId: targetCombatant.id });
    await foundCombat.rollInitiative(targetCombatant.id);
  } catch (err) {
    console.warn("Initiative click handler failed:", err);
  }
}

export async function rollCombatFromElement(sheet, event, target) {
  try {
    if (!sheet?._prepareSheetRollEvent?.(event, "combat-roll", target)) return;
    const el = getActionElement(sheet, event, target);
    const idx = readDataInt(el, "index");
    if (Number.isNaN(idx)) return;
    pcLog.debug("Peasant Core | combat-roll-clickable clicked", {
      actor: sheet.actor?.name,
      combatIndex: idx
    });
    await startNotableCombatRoll({
      actor: sheet.actor,
      combatIndex: idx,
      sheet,
      promptForTargets: true
    });
  } catch (e) {
    console.error("combat-roll-clickable handler failed", e);
  }
}

export async function rollCombatTagFromElement(sheet, event, target) {
  if (!sheet?._isPrimaryPointerEvent?.(event)) return;

  try {
    if (!sheet._prepareSheetRollEvent(event, "combat-tag-roll", target)) return;
    const el = getActionElement(sheet, event, target);
    let idx = readDataInt(el, "combatIndex");
    if (Number.isNaN(idx)) {
      const container = el?.closest?.(".combat-tags-inline");
      idx = readDataInt(container, "combatIndex");
    }
    if (Number.isNaN(idx)) idx = readDataInt(el, "index");

    const rollType = readDataValue(el, "rollType");
    pcLog.debug("combat-tag-rollable action", { idx, rollType, el });

    if (Number.isNaN(idx) || !rollType) {
      pcLog.debug("combat-tag-rollable: invalid idx or rollType", { idx, rollType });
      return;
    }

    const combats = sheet.actor.system.notableCombats || [];
    const combat = combats[idx] || {};
    const combatName = combat.name || "Combat";
    const combatMods = sheet.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
    const diceRateMod = parseInt(combatMods.diceRate) || 0;
    const flatDamageMod = getCombatFlatDamageModifier(combatMods);

    let diceCount = 0;
    let diceValue = 0;
    let flat = 0;
    let rollLabel = "";
    let typeLabel = "";

    if (rollType === "damage" && combat.damage) {
      const result = applyDieRate(
        combat.damage.diceCount || 0,
        combat.damage.diceValue || 0,
        combat.damage.flat || 0,
        diceRateMod,
        combat.damage.diceBonus || 0
      );
      diceCount = result.diceCount;
      diceValue = result.diceValue;
      flat = result.flat + flatDamageMod;
      rollLabel = "Damage";
      typeLabel = combat.damage.type || "";
    } else if (rollType === "heal" && combat.heal) {
      const result = applyDieRate(
        combat.heal.diceCount || 0,
        combat.heal.diceValue || 0,
        combat.heal.flat || 0,
        diceRateMod,
        combat.heal.diceBonus || 0
      );
      diceCount = result.diceCount;
      diceValue = result.diceValue;
      flat = result.flat + flatDamageMod;
      rollLabel = "Heal";
      typeLabel = combat.heal.type || "";
    } else if (rollType === "manifest" && combat.manifest) {
      const result = applyDieRate(
        combat.manifest.diceCount || 0,
        combat.manifest.diceValue || 0,
        combat.manifest.flat || 0,
        diceRateMod,
        combat.manifest.diceBonus || 0
      );
      diceCount = result.diceCount;
      diceValue = result.diceValue;
      flat = result.flat + flatDamageMod;
      rollLabel = "Manifest";
    }

    const canRollDice = diceCount > 0 && diceValue > 0;
    const naturalDiceCount = canRollDice ? diceCount : 0;
    const useStability = canRollDice && !!combat.stability && (rollType === "damage" || rollType === "heal" || rollType === "manifest");
    const useStrengthen = useStability && !!combat.strengthen;
    const rolledDiceCount = useStability ? (naturalDiceCount * 2) : naturalDiceCount;
    const roll = await new Roll(canRollDice ? `${rolledDiceCount}d${diceValue}` : "0").evaluate();

    const diceResults = canRollDice ? roll.dice.map(d => d.results.map(r => r.result)) : [];
    const allDice = diceResults.flat();
    const diceBreakdown = allDice.join(", ");
    const diceSum = allDice.reduce((a, b) => a + b, 0);
    let adjustedDiceTotal = diceSum;
    let diceDetailLine = `<div>Dice: [${diceBreakdown}] = ${diceSum}</div>`;

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

    const total = adjustedDiceTotal + flat;
    const speaker = ChatMessage.getSpeaker({ actor: sheet.actor });
    const typeDisplay = typeLabel ? `<span style="color: #aaa; font-size: 11px; margin-left: 6px;">${typeLabel}</span>` : "";
    const rollId = `dice-roll-${Date.now()}`;
    const rollCardClass = rollType === "damage" ? " pc-damage-roll-card" : (rollType === "heal" ? " pc-heal-roll-card" : (rollType === "manifest" ? " pc-manifest-roll-card" : ""));
    const chatHtml = `<div class="skill-roll-card${rollCardClass}" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
  <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #555; color: #ffffff;">
    ${escapeHtml(combatName)}
  </div>
  <div style="display: flex; flex-direction: column; gap: 6px;">
    <div style="display: flex; gap: 6px;">
      <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: transparent; border-radius: 3px; border-left: 3px solid #555;">
        <span style="color: #ffffff; font-weight: bold; font-size: 11px;">${rollLabel}:</span>
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
</div>`;

    await ChatMessage.create(applyMessageMode({
      user: game.user.id,
      speaker,
      content: chatHtml,
      rolls: [roll]
    }));
  } catch (e) {
    console.error("combat-tag-rollable handler failed", e);
  }
}

export async function rollSkillFromElement(sheet, event, target) {
  try {
    if (!sheet?._prepareSheetRollEvent?.(event, "skill-roll", target)) return;
    const el = getActionElement(sheet, event, target);
    const idx = readDataInt(el, "index");
    if (Number.isNaN(idx)) return;
    const skills = sheet.actor.system.skills || [];
    const skill = skills[idx] || {};
    const combatMods = sheet.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
    const toHitMod = parseInt(combatMods.toHit) || 0;
    const accuracyMod = parseInt(combatMods.accuracy) || 0;
    const baseTohit = Number.isFinite(parseInt(skill.tohit)) ? parseInt(skill.tohit) : 7;
    const baseAccuracy = parseInt(skill.accuracy) || 0;
    const skillCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
    const tohit = skillCalc.toHit;
    const accuracy = skillCalc.accuracy;
    const skillName = `${skill.name || "Skill"} Skill Roll`;
    const isUntrained = String(skill.rank || "").trim().toLowerCase() === "u";

    const consumeSigUse = async () => {
      try {
        const result = await sheet.actor.consumePeasantSkillUse?.(idx);
        if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
        if (!result?.changed) return;
        sheet.render(false);
      } catch (err) {
        console.warn("Failed to consume SIG use after autoroll:", err);
      }
    };

    const accVal = accuracy !== 0 ? accuracy : undefined;
    if (isUntrained) {
      const untrainedSkillName = `${skill.name || "Skill"} Untrained Skill Roll`;
      await performUntrainedSkillRoll({ toHit: tohit, accuracy: 0, skillName: untrainedSkillName, speaker: ChatMessage.getSpeaker({ actor: sheet.actor }) });
    } else {
      await performSkillRoll({ toHit: tohit, accuracy: accVal, skillName, speaker: ChatMessage.getSpeaker({ actor: sheet.actor }) });
    }
    await consumeSigUse();
  } catch (err) {
    console.warn("Skill roll click failed:", err);
  }
}

export async function rollAttributeToHitFromElement(sheet, event, target) {
  try {
    if (!sheet?._prepareSheetRollEvent?.(event, "attr-tohit-roll", target)) return;
    const el = getActionElement(sheet, event, target);
    const characteristic = readDataValue(el, "characteristic") || "Untrained";
    const combatMods = sheet.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
    const toHitMod = parseInt(combatMods.toHit) || 0;
    const baseMap = computeBaseAttrToHits(sheet.actor.system);
    const baseTn = Number.isFinite(baseMap[characteristic]) ? baseMap[characteristic] : 7;
    const attrCalc = applyToHitAccuracy(baseTn, 0, toHitMod, 0, 2);
    const tn = attrCalc.toHit;
    const accOverflow = attrCalc.accuracy;
    const skillName = `Untrained ${characteristic} Skill Roll`;

    await performUntrainedSkillRoll({ toHit: tn, accuracy: accOverflow, skillName, speaker: ChatMessage.getSpeaker({ actor: sheet.actor }) });
  } catch (err) {
    console.warn("Attribute to-hit click failed:", err);
  }
}

export async function rollAttributeSaveFromElement(sheet, event, target) {
  try {
    if (!sheet?._prepareSheetRollEvent?.(event, "attr-save-roll", target)) return;
    const el = getActionElement(sheet, event, target);
    const saveKey = readDataValue(el, "save") || "";
    const explicitTnRaw = Number.parseInt(readDataValue(el, "tn"), 10);
    const hasExplicitTn = Number.isFinite(explicitTnRaw);

    let tn = 7;
    let skillName = "Saving Roll";
    if (hasExplicitTn) {
      tn = Math.max(2, explicitTnRaw);
      const customSkillName = String(readDataValue(el, "saveLabel") || "").trim();
      skillName = customSkillName || "AoE Reflex Save";
    } else {
      const combatMods = sheet.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
      const toHitMod = parseInt(combatMods.toHit) || 0;
      const saveConfigModRaw = Number(sheet.actor?.getFlag?.("peasant-core", PC_SAVE_MODIFIER_FLAG));
      const saveConfigMod = Number.isFinite(saveConfigModRaw) ? Math.trunc(saveConfigModRaw) : 0;
      const baseSaves = computeBaseSaves(sheet.actor.system);
      const baseTn = Number.isFinite(baseSaves[saveKey]) ? baseSaves[saveKey] : 7;
      const saveCalc = applyToHitFloor(baseTn, toHitMod + saveConfigMod, 2);
      tn = saveCalc.toHit;
      const pretty = saveKey.charAt(0).toUpperCase() + saveKey.slice(1);
      skillName = `${pretty} Save`;
    }

    await performSavingRoll({ toHit: tn, skillName, speaker: ChatMessage.getSpeaker({ actor: sheet.actor }) });
  } catch (err) {
    console.warn("Attribute save click failed:", err);
  }
}
