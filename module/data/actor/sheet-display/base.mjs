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
  getDefaultNationalOriginLabel,
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
import { getWoundThresholdMultipliers } from "../targeted-damage.mjs";
import { applyDieRate, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";
import { addEquippedArmorHalt, getArmorAdjustedMovement, getEquippedArmorEffects } from "../equipped-armor.mjs";
import { getUntrainedArmorMovementPenalty } from "../active-armor.mjs";

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
  const armorMovementPenalty = getUntrainedArmorMovementPenalty(actor);
  data.haltValuesInput = normalizeHaltSlashValue(addEquippedArmorHalt(editSystem?.haltValues, equippedArmor));
  data.naturalHaltValuesInput = normalizeHaltSlashValue(editSystem?.naturalHaltValues || [0, 0, 0, 0]);
  data.combatModsInput = normalizeCombatModsForSheet(editSystem?.combatMods);

  data.runMultiplier = runMultiplier;
  data.sprintMultiplier = sprintMultiplier;

  const portraitMovement = getArmorAdjustedMovement(system?.movement, equippedArmor, armorMovementPenalty);
  const initiative = system?.initiative;
  const initiativeInput = editSystem?.initiative;
  const initiativeDisplay = hasOptionalInteger(initiative)
    ? formatOptionalIntegerInput(initiative, { showPlus: true })
    : "+0";
  data.initiativeInput = formatOptionalIntegerInput(initiativeInput, { showPlus: true });
  data.movementInput = getArmorAdjustedMovement(editSystem?.movement, equippedArmor, armorMovementPenalty);
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
  const editRaceSelection = resolveCustomSelect(editSystem?.race, editSystem?.customRace);
  const editOriginSelection = resolveCustomSelect(editSystem?.origin, editSystem?.customOrigin);
  const editSpecificOriginSelection = resolveCustomSelect(editSystem?.specificOrigin, editSystem?.customSpecificOrigin);
  const displayRaceSelection = resolveCustomSelect(system?.race, system?.customRace);
  const displayOriginSelection = resolveCustomSelect(system?.origin, system?.customOrigin);
  const displaySpecificOriginSelection = resolveCustomSelect(system?.specificOrigin, system?.customSpecificOrigin);
  data.customRaceSelected = editRaceSelection.isCustom;
  data.customOriginSelected = editOriginSelection.isCustom;
  data.customSpecificOriginSelected = editSpecificOriginSelection.isCustom;
  data.hasCustomIdentitySelection = !!isEditMode && (editRaceSelection.isCustom || editOriginSelection.isCustom || editSpecificOriginSelection.isCustom);
  data.originOptions = getNationalOriginOptions(editSystem?.origin);
  data.displayRace = displayRaceSelection.display || "Human";
  data.displayOrigin = displayOriginSelection.isCustom
    ? displayOriginSelection.display
    : resolveNationalOriginLabel(displayOriginSelection.display);
  if (!data.displayOrigin) data.displayOrigin = getDefaultNationalOriginLabel();
  data.displaySpecificOrigin = displaySpecificOriginSelection.display || "Soldier";
}

export function prepareActorEdgeContext(data, actor, { isEditMode = false, sourceSystem = null } = {}) {
  const system = actor?.system ?? {};
  const editSystem = sourceSystem ?? system;
  const defaultEdgeLabelMode = getDefaultEdgeLabelMode(actor);
  const edgeLabelMode = sanitizeEdgeLabelMode(system?.edgeLabelMode, defaultEdgeLabelMode);
  const edgeCustomLabel = String(system?.edgeCustomLabel ?? "");
  const editEdgeLabelMode = sanitizeEdgeLabelMode(editSystem?.edgeLabelMode, defaultEdgeLabelMode);
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
  const display = isCustom ? (customText || "Custom") : normalizedBase;
  return { isCustom, display };
}
