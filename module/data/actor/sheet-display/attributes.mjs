import {
  getCombatDefenseSummary,
  normalizeCombatDefense
} from "../combat-defense.mjs";
import { COMBAT_VIEW_TAG_TYPES, getCombatCustomTags } from "../combat-tags.mjs";
import {
  COMBAT_HALT_BUFF_TYPE_COST,
  COMBAT_HALT_BUFF_TYPE_CUSTOM,
  COMBAT_HALT_BUFF_TYPE_FLAT,
  COMBAT_HALT_BUFF_TYPE_HALT,
  COMBAT_HALT_BUFF_TYPE_NATURAL,
  getCombatCostModifiers,
  getCombatFlatDamageModifier,
  getCombatHaltBuffTotals,
  normalizeHaltSlashValue,
  parseHaltSlashValues,
  sanitizeCombatCostResourceType,
  sanitizeCombatHaltBuffs,
  sanitizeCombatHaltBuffType
} from "../combat-modifiers.mjs";
import {
  EDGE_LABEL_MODE_CUSTOM,
  getDefaultEdgeLabelMode,
  normalizeEdgeResourceEntry,
  resolveEdgeLabel,
  sanitizeEdgeLabelMode
} from "../edge-resources.mjs";
import { getActorBolsteredMax, getActorHealthMax, isSimplifiedHpActor } from "../helpers.mjs";
import {
  PC_ART_PANEL_COLLAPSED_FLAG,
  PC_DEFAULT_RUN_MULTIPLIER,
  PC_DEFAULT_SPRINT_MULTIPLIER,
  PC_RUN_MULTIPLIER_FLAG,
  PC_SAVE_MODIFIER_FLAG,
  PC_SPRINT_MULTIPLIER_FLAG,
  formatThresholdValue,
  getPeasantCoreSettingGroups
} from "../sheet-settings.mjs";
import { formatOptionalIntegerInput, parseOptionalInteger } from "../helpers.mjs";
import { getWoundThresholdMultipliers } from "../targeted-damage.mjs";
import { applyDieRate, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";

export function prepareActorAttributeContext(data, actor) {
  const build = actor.system.build || 0;
  const reflex = actor.system.reflex || 0;
  const intuition = actor.system.intuition || 0;
  const learn = actor.system.learn || 0;
  const charisma = actor.system.charisma || 0;
  const blessing = actor.system.blessing || { type: null, target: null };
  const attrVals = { build, reflex, intuition, learn, charisma };
  const saveCombatMods = actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 };
  const saveToHitMod = parseInt(saveCombatMods.toHit) || 0;
  const saveConfigModRaw = Number(actor?.getFlag?.("peasant-core", PC_SAVE_MODIFIER_FLAG));
  const saveConfigMod = Number.isFinite(saveConfigModRaw) ? Math.trunc(saveConfigModRaw) : 0;
  const totalSaveToHitMod = saveToHitMod + saveConfigMod;

  const baseSaves = {};
  for (const [k, v] of Object.entries(attrVals)) {
    baseSaves[k] = 18 - (v * 2);
  }

  if (blessing.type === "spring" && blessing.target) {
    const t = blessing.target;
    if (baseSaves[t] !== undefined) baseSaves[t] = 16 - (attrVals[t] * 2);
  }

  if (blessing.type === "fall" && blessing.target) {
    const t = blessing.target;
    const otherSaves = Object.entries(baseSaves).filter(([k]) => k !== t).map(([, v]) => v);
    if (otherSaves.length > 0) baseSaves[t] = Math.min(...otherSaves);
  }

  const modifiedSaves = {};
  for (const [k, v] of Object.entries(baseSaves)) {
    const saveCalc = applyToHitFloor(v, totalSaveToHitMod, 2);
    modifiedSaves[k] = saveCalc.toHit;
  }

  const reflexAoeSaveEnabled = !!actor.system.reflexAoeSaveEnabled;
  const reflexAoeValue = parseOptionalInteger(actor.system.reflexAoeSaveTarget, { min: 1 });
  const reflexAoeSaveTn = reflexAoeValue !== null ? Math.max(2, reflexAoeValue) : null;

  const isSummer = blessing.type === "summer" && blessing.target;
  const blessedValue = isSummer ? (attrVals[blessing.target] || 0) : 0;
  const strToHitNumBase = isSummer ? (22 - build - reflex - blessedValue) : (18 - build - reflex);
  const dexToHitNumBase = isSummer ? (22 - reflex - intuition - blessedValue) : (18 - reflex - intuition);
  const mntToHitNumBase = isSummer ? (22 - intuition - learn - blessedValue) : (18 - intuition - learn);
  const socToHitNumBase = isSummer ? (22 - intuition - charisma - blessedValue) : (18 - intuition - charisma);
  const toHitPenaltyTarget = actor.system.toHitPenaltyTarget || "";
  const strToHitNumPenalized = (toHitPenaltyTarget === "Strength") ? (strToHitNumBase - 1) : strToHitNumBase;
  const dexToHitNumPenalized = (toHitPenaltyTarget === "Dexterity") ? (dexToHitNumBase - 1) : dexToHitNumBase;
  const mntToHitNumPenalized = (toHitPenaltyTarget === "Mental") ? (mntToHitNumBase - 1) : mntToHitNumBase;
  const socToHitNumPenalized = (toHitPenaltyTarget === "Social") ? (socToHitNumBase - 1) : socToHitNumBase;
  const attrCombatMods = actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
  const attrToHitMod = parseInt(attrCombatMods.toHit) || 0;
  const strToHitNum = applyToHitFloor(strToHitNumPenalized, attrToHitMod, 2).toHit;
  const dexToHitNum = applyToHitFloor(dexToHitNumPenalized, attrToHitMod, 2).toHit;
  const mntToHitNum = applyToHitFloor(mntToHitNumPenalized, attrToHitMod, 2).toHit;
  const socToHitNum = applyToHitFloor(socToHitNumPenalized, attrToHitMod, 2).toHit;

  data.attributes = {
    buildSave: `${modifiedSaves.build}+`,
    reflexSave: `${modifiedSaves.reflex}+`,
    intuitionSave: `${modifiedSaves.intuition}+`,
    learnSave: `${modifiedSaves.learn}+`,
    charismaSave: `${modifiedSaves.charisma}+`,
    strToHit: `${strToHitNum}+`,
    dexToHit: `${dexToHitNum}+`,
    mntToHit: `${mntToHitNum}+`,
    socToHit: `${socToHitNum}+`
  };
  data.reflexAoeSaveEnabled = reflexAoeSaveEnabled;
  data.reflexAoeSaveTarget = formatOptionalIntegerInput(reflexAoeValue);
  data.reflexAoeSaveTn = reflexAoeSaveEnabled && Number.isFinite(reflexAoeSaveTn) ? reflexAoeSaveTn : null;
  data.reflexAoeSaveDisplay = reflexAoeSaveEnabled && Number.isFinite(reflexAoeSaveTn) ? `${reflexAoeSaveTn}+` : "";
  data.blessing = blessing;
  data.toHitPenaltyTarget = toHitPenaltyTarget;
  data.isBlessed = {
    build: !!blessing.type && blessing.target === "build",
    reflex: !!blessing.type && blessing.target === "reflex",
    intuition: !!blessing.type && blessing.target === "intuition",
    learn: !!blessing.type && blessing.target === "learn",
    charisma: !!blessing.type && blessing.target === "charisma"
  };
}
