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
  getActorEdgeLabelMode,
  getDefaultEdgeLabelMode,
  normalizeEdgeResourceEntry,
  resolveEdgeLabel,
  sanitizeEdgeLabelMode
} from "../edge-resources.mjs";
import { getActorBolsteredMax, getActorHealthMax, isSimplifiedHpActor } from "../helpers.mjs";
import {
  getDefaultNationalOriginLabel,
  getFinalHeraldryOptions,
  getHeraldryOptionGroups,
  getNationalOriginOptions,
  getSirLocationRows,
  resolveNationalOriginLabel
} from "../identity-options.mjs";
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
import { formatOptionalIntegerInput, hasOptionalInteger } from "../helpers.mjs";
import { normalizeScaleRating } from "../damage.mjs";
import { getWoundThresholdMultipliers } from "../targeted-damage.mjs";
import { applyDieRate, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";
import { addEquippedArmorHalt, getArmorAdjustedMovement, getEquippedArmorEffects } from "../equipped-armor.mjs";

export function prepareActorSheetBaseContext(data, actor, { isEditable = true, isEditMode = false, sourceSystem = null } = {}) {
  const system = actor?.system ?? {};
  const editSystem = sourceSystem ?? system;
  const sirSystem = isEditMode && sourceSystem ? sourceSystem : system;
  data.artPanelCollapsed = !!actor?.getFlag?.("peasant-core", PC_ART_PANEL_COLLAPSED_FLAG);
  data.editable = isEditable && isEditMode;
  data.peasantCoreSettingGroups = getPeasantCoreSettingGroups(actor, data.editable !== false);
  data.sirLocations = getSirLocationRows(actor, { system: sirSystem });

  data.bolsteredHpValue = Math.max(0, Number(system?.bolsteredHp) || 0);
  const runMultiplierRaw = Number(actor?.getFlag?.("peasant-core", PC_RUN_MULTIPLIER_FLAG));
  const runMultiplier = Number.isFinite(runMultiplierRaw) && runMultiplierRaw >= 1
    ? Math.floor(runMultiplierRaw)
    : PC_DEFAULT_RUN_MULTIPLIER;
  const sprintMultiplierRaw = Number(actor?.getFlag?.("peasant-core", PC_SPRINT_MULTIPLIER_FLAG));
  const sprintMultiplier = Number.isFinite(sprintMultiplierRaw) && sprintMultiplierRaw >= 1
    ? Math.floor(sprintMultiplierRaw)
    : PC_DEFAULT_SPRINT_MULTIPLIER;

  const equippedArmor = getEquippedArmorEffects(actor);
  data.haltValuesInput = normalizeHaltSlashValue(addEquippedArmorHalt(editSystem?.haltValues, equippedArmor));
  data.naturalHaltValuesInput = normalizeHaltSlashValue(editSystem?.naturalHaltValues || [0, 0, 0, 0]);
  data.combatModsInput = normalizeCombatModsForSheet(editSystem?.combatMods);
  data.scaleInput = normalizeScaleRating(editSystem?.scale);
  data.scaleDisplay = normalizeScaleRating(system?.scale);

  data.runMultiplier = runMultiplier;
  data.sprintMultiplier = sprintMultiplier;

  const portraitMovement = getArmorAdjustedMovement(system?.movement, equippedArmor);
  const initiative = system?.initiative;
  const initiativeInput = editSystem?.initiative;
  const initiativeDisplay = hasOptionalInteger(initiative)
    ? formatOptionalIntegerInput(initiative, { showPlus: true })
    : "+0";
  data.initiativeInput = formatOptionalIntegerInput(initiativeInput, { showPlus: true });
  data.movementInput = getArmorAdjustedMovement(editSystem?.movement, equippedArmor);
  data.portraitStats = {
    movement: portraitMovement,
    run: portraitMovement * runMultiplier,
    sprint: portraitMovement * sprintMultiplier,
    initiative: initiativeDisplay
  };

  data.combatHaltBuffRows = buildCombatHaltBuffRows(editSystem?.combatMods?.haltBuffs);
}

export function prepareActorIdentityContext(data, actor, { isEditMode = false, sourceSystem = null } = {}) {
  const system = actor?.system ?? {};
  const editSystem = sourceSystem ?? system;
  const editMajorHeraldry = resolveCustomSelect(editSystem?.majorHeraldry, editSystem?.customMajorHeraldry);
  const editMinorHeraldry = resolveCustomSelect(editSystem?.minorHeraldry, editSystem?.customMinorHeraldry);
  const editFinalHeraldry = resolveCustomSelect(editSystem?.finalHeraldry, editSystem?.customFinalHeraldry);
  const editOriginSelection = resolveCustomSelect(editSystem?.origin, editSystem?.customOrigin);
  const editSpecificOriginSelection = resolveCustomSelect(editSystem?.specificOrigin, editSystem?.customSpecificOrigin);
  const displayMajorHeraldry = resolveCustomSelect(system?.majorHeraldry, system?.customMajorHeraldry);
  const displayMinorHeraldry = resolveCustomSelect(system?.minorHeraldry, system?.customMinorHeraldry);
  const displayFinalHeraldry = resolveCustomSelect(system?.finalHeraldry, system?.customFinalHeraldry);
  const displayOriginSelection = resolveCustomSelect(system?.origin, system?.customOrigin);
  const displaySpecificOriginSelection = resolveCustomSelect(system?.specificOrigin, system?.customSpecificOrigin);
  data.customMajorHeraldrySelected = editMajorHeraldry.isCustom;
  data.customMinorHeraldrySelected = editMinorHeraldry.isCustom;
  data.customFinalHeraldrySelected = editFinalHeraldry.isCustom;
  data.customOriginSelected = editOriginSelection.isCustom;
  data.customSpecificOriginSelected = editSpecificOriginSelection.isCustom;
  data.hasCustomIdentitySelection = !!isEditMode && (editMajorHeraldry.isCustom || editMinorHeraldry.isCustom || editFinalHeraldry.isCustom || editOriginSelection.isCustom || editSpecificOriginSelection.isCustom);
  data.majorHeraldryGroups = getHeraldryOptionGroups("major", editSystem?.majorHeraldry);
  data.minorHeraldryGroups = getHeraldryOptionGroups("minor", editSystem?.minorHeraldry);
  data.finalHeraldryOptions = getFinalHeraldryOptions(editSystem?.finalHeraldry || "Human");
  data.originOptions = getNationalOriginOptions(editSystem?.origin);
  data.displayMajorHeraldry = displayMajorHeraldry.display || (displayMajorHeraldry.isCustom ? "" : "Major Heraldry");
  data.displayMinorHeraldry = displayMinorHeraldry.display || (displayMinorHeraldry.isCustom ? "" : "Minor Heraldry");
  data.displayFinalHeraldry = displayFinalHeraldry.display || (displayFinalHeraldry.isCustom ? "" : "Human");
  data.displayOrigin = displayOriginSelection.isCustom
    ? displayOriginSelection.display
    : resolveNationalOriginLabel(displayOriginSelection.display);
  if (!data.displayOrigin && !displayOriginSelection.isCustom) data.displayOrigin = getDefaultNationalOriginLabel();
  data.displaySpecificOrigin = displaySpecificOriginSelection.display || (displaySpecificOriginSelection.isCustom ? "" : "Soldier");
}

export function prepareActorEdgeContext(data, actor, { isEditMode = false, sourceSystem = null } = {}) {
  const system = actor?.system ?? {};
  const editSystem = sourceSystem ?? system;
  const defaultEdgeLabelMode = getDefaultEdgeLabelMode(actor);
  const edgeLabelMode = getActorEdgeLabelMode(actor);
  const edgeCustomLabel = String(system?.edgeCustomLabel ?? "");
  const editEdgeLabelMode = getActorEdgeLabelMode(actor, editSystem?.edgeLabelMode);
  const editEdgeCustomLabel = String(editSystem?.edgeCustomLabel ?? "");
  data.edgeLabelMode = edgeLabelMode;
  data.edgeLabelModeInput = editEdgeLabelMode;
  data.edgeLabelIsCustom = edgeLabelMode === EDGE_LABEL_MODE_CUSTOM;
  data.edgeLabelInputIsCustom = editEdgeLabelMode === EDGE_LABEL_MODE_CUSTOM;
  data.edgeCustomLabel = edgeCustomLabel;
  data.edgeCustomLabelInput = editEdgeCustomLabel;
  data.edgeDisplayLabel = resolveEdgeLabel(edgeLabelMode, edgeCustomLabel, defaultEdgeLabelMode);
  const edgeResourcesRaw = Array.isArray((isEditMode ? editSystem : system)?.edgeResources)
    ? (isEditMode ? editSystem : system).edgeResources
    : [];
  data.edgeResources = edgeResourcesRaw.map((entry, index) => {
    const normalized = normalizeEdgeResourceEntry(entry, editEdgeLabelMode);
    return {
      ...normalized,
      index,
      isCustom: normalized.labelMode === EDGE_LABEL_MODE_CUSTOM,
      displayLabel: resolveEdgeLabel(normalized.labelMode, normalized.customLabel, editEdgeLabelMode)
    };
  });
}

function buildCombatHaltBuffRows(haltBuffs) {
  return sanitizeCombatHaltBuffs(haltBuffs).map((buff, index) => {
    const type = sanitizeCombatHaltBuffType(buff.type);
    const row = {
      index,
      type,
      values: normalizeHaltSlashValue(buff.values),
      value: Number.parseInt(buff.value, 10) || 0,
      resourceType: sanitizeCombatCostResourceType(buff.resourceType),
      customName: String(buff.customName ?? "").trim(),
      isHaltLike: false,
      isFlat: false,
      isCustom: false,
      isCost: false,
      label: "HALT:"
    };

    if (type === COMBAT_HALT_BUFF_TYPE_NATURAL) {
      row.label = "Nat HALT:";
      row.isHaltLike = true;
    } else if (type === COMBAT_HALT_BUFF_TYPE_HALT) {
      row.label = "HALT:";
      row.isHaltLike = true;
    } else if (type === COMBAT_HALT_BUFF_TYPE_FLAT) {
      row.label = "Flat:";
      row.isFlat = true;
    } else if (type === COMBAT_HALT_BUFF_TYPE_COST) {
      row.label = "Cost:";
      row.isCost = true;
    } else if (type === COMBAT_HALT_BUFF_TYPE_CUSTOM) {
      row.label = row.customName || "Custom";
      row.isCustom = true;
    }

    return row;
  });
}

function normalizeCombatModsForSheet(combatMods) {
  const raw = combatMods || {};
  return {
    ...raw,
    toHit: Number(raw.toHit) || 0,
    accuracy: Number(raw.accuracy) || 0,
    diceRate: Number(raw.diceRate) || 0,
    flatDamage: Number(raw.flatDamage) || 0,
    costMod: Number(raw.costMod) || 0,
    haltBuffs: sanitizeCombatHaltBuffs(raw.haltBuffs)
  };
}

function resolveCustomSelect(baseValue, customValue) {
  const normalizedBase = String(baseValue ?? "").trim();
  const isCustom = /^(custom|other)$/i.test(normalizedBase);
  const customText = String(customValue ?? "").trim();
  const display = isCustom ? customText : normalizedBase;
  return { isCustom, display };
}
