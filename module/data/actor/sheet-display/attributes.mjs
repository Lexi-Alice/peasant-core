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
import { getArmorAdjustedAoeSaveTarget, getEquippedArmorEffects } from "../equipped-armor.mjs";
import { getWoundThresholdMultipliers } from "../targeted-damage.mjs";
import { applyDieRate, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";
import { computeBaseAttrToHits, computeBaseSaves } from "../attributes.mjs";

export function prepareActorAttributeContext(data, actor, { isEditMode = false, sourceSystem = null } = {}) {
  const editSystem = sourceSystem ?? actor.system;
  const saveCombatMods = actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 };
  const saveToHitMod = parseInt(saveCombatMods.toHit) || 0;
  const saveConfigModRaw = Number(actor?.getFlag?.("peasant-core", PC_SAVE_MODIFIER_FLAG));
  const saveConfigMod = Number.isFinite(saveConfigModRaw) ? Math.trunc(saveConfigModRaw) : 0;
  const totalSaveToHitMod = saveToHitMod + saveConfigMod;

  const baseSaves = computeBaseSaves(actor.system);

  const modifiedSaves = {};
  for (const [k, v] of Object.entries(baseSaves)) {
    const saveCalc = applyToHitFloor(v, totalSaveToHitMod, 2);
    modifiedSaves[k] = saveCalc.toHit;
  }

  const reflexAoeSaveEnabled = !!actor.system.reflexAoeSaveEnabled;
  const equippedArmor = getEquippedArmorEffects(actor);
  const reflexAoeValue = parseOptionalInteger(actor.system.reflexAoeSaveTarget, { min: 1 });
  const reflexAoeInputEnabled = !!editSystem.reflexAoeSaveEnabled;
  const reflexAoeInputBaseValue = parseOptionalInteger(editSystem.reflexAoeSaveTarget, { min: 1 });
  const reflexAoeInputValue = reflexAoeInputBaseValue === null
    ? null
    : getArmorAdjustedAoeSaveTarget(reflexAoeInputBaseValue, equippedArmor);
  const armorAoeActive = equippedArmor.aoeSaveModifier !== 0 || equippedArmor.aoeAutoFail;
  const reflexAoeSaveTn = reflexAoeValue === null
    ? (armorAoeActive ? getArmorAdjustedAoeSaveTarget(modifiedSaves.reflex, equippedArmor) : null)
    : getArmorAdjustedAoeSaveTarget(reflexAoeValue, equippedArmor);

  const toHitPenaltyTarget = actor.system.toHitPenaltyTarget || "";
  const attrToHits = computeBaseAttrToHits(actor.system);
  const attrCombatMods = actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
  const attrToHitMod = parseInt(attrCombatMods.toHit) || 0;
  const strToHitNum = applyToHitFloor(attrToHits.Strength, attrToHitMod, 2).toHit;
  const dexToHitNum = applyToHitFloor(attrToHits.Dexterity, attrToHitMod, 2).toHit;
  const mntToHitNum = applyToHitFloor(attrToHits.Mental, attrToHitMod, 2).toHit;
  const socToHitNum = applyToHitFloor(attrToHits.Social, attrToHitMod, 2).toHit;

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
  data.reflexAoeSaveEnabled = isEditMode ? reflexAoeInputEnabled : (reflexAoeSaveEnabled || armorAoeActive);
  data.reflexAoeSaveTarget = formatOptionalIntegerInput(isEditMode ? reflexAoeInputValue : reflexAoeValue);
  data.reflexAoeSaveAutoFail = equippedArmor.aoeAutoFail;
  data.reflexAoeSaveTn = equippedArmor.aoeAutoFail
    ? null
    : ((reflexAoeSaveEnabled || armorAoeActive) && Number.isFinite(reflexAoeSaveTn) ? reflexAoeSaveTn : null);
  data.reflexAoeSaveDisplay = equippedArmor.aoeAutoFail
    ? "CS"
    : ((reflexAoeSaveEnabled || armorAoeActive) && Number.isFinite(reflexAoeSaveTn) ? `${reflexAoeSaveTn}+` : "");
  data.toHitPenaltyTarget = toHitPenaltyTarget;
  data.isBlessed = {
    build: false,
    reflex: false,
    intuition: false,
    learn: actor.system.blessing?.type === "spring",
    charisma: false
  };
}
