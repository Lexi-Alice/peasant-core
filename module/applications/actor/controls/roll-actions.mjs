import { computeBaseAttrToHits, computeBaseSaves } from "../../../data/actor/attributes.mjs";
import { getDevastatingWoundAccuracyModifier } from "../../../data/actor/combat-modifiers.mjs";
import { hasOptionalInteger, parseOptionalInteger } from "../../../data/actor/helpers.mjs";
import { PC_CONSCIOUSNESS_SAVE_FLAG, PC_SAVE_MODIFIER_FLAG } from "../../../data/actor/sheet-settings.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";
import { performConsciousnessCheck, performSavingRoll, performUntrainedSkillRoll } from "../../../dice/rolls.mjs";
import { pcLog } from "../../../utils/logging.mjs";
import { attachRollUndoToChatMessage } from "../../chat-undo.mjs";
import { attachEdgeChainToChatMessage, createActorAttributeSkillEdgeChainContext } from "../../combat/edge-chain-rolls.mjs";
import { maybeForcePassFailedRoll } from "../../combat/force-pass.mjs";
import { rollManualCombatTag } from "../../combat/manual-combat-tag-rolls.mjs";
import { createPeasantEntryUsageContext, startPeasantEntryUse } from "../../combat/skill-entry-use.mjs";

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
    await rollActorConsciousnessCheck({ actor: sheet.actor, tn: th, asSave });
  } catch (err) {
    console.warn("Consciousness TH click handler failed:", err);
  }
}

export async function rollActorConsciousnessCheck({ actor = null, tn = 7, asSave = false } = {}) {
  if (!actor) return null;
  const rollResult = await performConsciousnessCheck({
    actor,
    tn,
    asSave,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { rollResult, forcePassResult: rollResult.forcePassResult };
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
    await sheet.actor.ensurePeasantEntryIds?.("notableCombats");
    const entryId = String(sheet.actor.system?.notableCombats?.[idx]?.id || "").trim();
    if (!entryId) return;
    return startPeasantEntryUse({
      actor: sheet.actor,
      ref: { collection: "notableCombats", entryId },
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

    await sheet.actor.ensurePeasantEntryIds?.("notableCombats");
    const combats = sheet.actor.system.notableCombats || [];
    const combat = combats[idx] || {};
    const entryId = String(combat.id || "").trim();
    if (!entryId) return;
    const { usageContext } = await createPeasantEntryUsageContext({
      actor: sheet.actor,
      ref: { collection: "notableCombats", entryId }
    });
    if (!usageContext) return;

    await rollManualCombatTag({
      actor: sheet.actor,
      combatIndex: idx,
      rollType,
      usageContext
    });
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
    await sheet.actor.ensurePeasantEntryIds?.("skills");
    const skill = sheet.actor.system?.skills?.[idx];
    const entryId = String(skill?.id || "").trim();
    if (!entryId) return;
    return startPeasantEntryUse({
      actor: sheet.actor,
      ref: { collection: "skills", entryId },
      sheet
    });
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
    const woundAccuracyModifier = getDevastatingWoundAccuracyModifier(sheet.actor);
    const attrCalc = applyToHitAccuracy(baseTn, 0, toHitMod, woundAccuracyModifier, 2);
    const tn = attrCalc.toHit;
    const accOverflow = attrCalc.accuracy;
    const skillName = `Untrained ${characteristic} Skill Roll`;
    const edgeChainContext = createActorAttributeSkillEdgeChainContext({
      actor: sheet.actor,
      characteristic,
      woundAccuracyModifier
    });

    const rollResult = await performUntrainedSkillRoll({
      toHit: tn,
      accuracy: accOverflow,
      skillName,
      speaker: ChatMessage.getSpeaker({ actor: sheet.actor }),
      edgeChainContext
    });
    const forcePassResult = await maybeForcePassFailedRoll({
      actor: sheet.actor,
      rollLabel: skillName,
      rollResult
    });
    await attachRollUndoToChatMessage(rollResult?.chatMessage, forcePassResult?.undoRecords, {
      label: `Undo ${characteristic} Roll Effects`
    });
    await attachEdgeChainToChatMessage(rollResult?.chatMessage, edgeChainContext, forcePassResult?.undoRecords, {
      preRollRecords: [],
      postRollRecords: forcePassResult?.undoRecords
    });
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

    await performSavingRoll({
      actor: sheet.actor,
      toHit: tn,
      skillName,
      speaker: ChatMessage.getSpeaker({ actor: sheet.actor })
    });
  } catch (err) {
    console.warn("Attribute save click failed:", err);
  }
}
