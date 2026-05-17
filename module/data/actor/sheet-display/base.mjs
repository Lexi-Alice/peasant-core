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
import { getWoundThresholdMultipliers } from "../targeted-damage.mjs";
import { applyDieRate, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";

export function prepareActorSheetBaseContext(data, actor, { isEditable = true, isEditMode = false } = {}) {
  data.artPanelCollapsed = !!actor?.getFlag?.("peasant-core", PC_ART_PANEL_COLLAPSED_FLAG);
  data.editable = isEditable && isEditMode;
  data.peasantCoreSettingGroups = getPeasantCoreSettingGroups(actor, data.editable !== false);
  data.sirLocations = getSirLocationRows(actor);

  const bolsteredHpSafe = Math.max(0, Number(data?.actor?.system?.bolsteredHp) || 0);
  const runMultiplierRaw = Number(actor?.getFlag?.("peasant-core", PC_RUN_MULTIPLIER_FLAG));
  const runMultiplier = Number.isFinite(runMultiplierRaw) && runMultiplierRaw >= 1
    ? Math.floor(runMultiplierRaw)
    : PC_DEFAULT_RUN_MULTIPLIER;
  const sprintMultiplierRaw = Number(actor?.getFlag?.("peasant-core", PC_SPRINT_MULTIPLIER_FLAG));
  const sprintMultiplier = Number.isFinite(sprintMultiplierRaw) && sprintMultiplierRaw >= 1
    ? Math.floor(sprintMultiplierRaw)
    : PC_DEFAULT_SPRINT_MULTIPLIER;

  if (data?.actor?.system) {
    data.actor.system.bolsteredHp = bolsteredHpSafe;
    data.actor.system.haltValues = normalizeHaltSlashValue(data.actor.system.haltValues || "0/0/0/0");
    data.actor.system.naturalHaltValues = normalizeHaltSlashValue(data.actor.system.naturalHaltValues || "0/0/0/0");
    const rawCombatMods = data.actor.system.combatMods || {};
    const haltBuffs = sanitizeCombatHaltBuffs(rawCombatMods.haltBuffs);
    data.actor.system.combatMods = {
      ...rawCombatMods,
      toHit: Number(rawCombatMods.toHit) || 0,
      accuracy: Number(rawCombatMods.accuracy) || 0,
      diceRate: Number(rawCombatMods.diceRate) || 0,
      flatDamage: Number(rawCombatMods.flatDamage) || 0,
      costMod: Number(rawCombatMods.costMod) || 0,
      haltBuffs
    };
  }

  data.runMultiplier = runMultiplier;
  data.sprintMultiplier = sprintMultiplier;

  const portraitMovement = Math.max(0, Number(data?.actor?.system?.movement) || 0);
  const initiativeRaw = String(data?.actor?.system?.initiative ?? "").trim();
  const initiativeNumeric = Number(initiativeRaw);
  const initiativeDisplay = initiativeRaw === ""
    ? "+0"
    : Number.isFinite(initiativeNumeric)
      ? `${initiativeNumeric >= 0 ? "+" : ""}${initiativeNumeric}`
      : initiativeRaw;
  data.portraitStats = {
    movement: portraitMovement,
    run: portraitMovement * runMultiplier,
    sprint: portraitMovement * sprintMultiplier,
    initiative: initiativeDisplay
  };

  data.combatHaltBuffRows = buildCombatHaltBuffRows(data?.actor?.system?.combatMods?.haltBuffs);
}

export function prepareActorIdentityContext(data, actor, { isEditMode = false } = {}) {
  const raceSelection = resolveCustomSelect(actor?.system?.race, actor?.system?.customRace);
  const originSelection = resolveCustomSelect(actor?.system?.origin, actor?.system?.customOrigin);
  const specificOriginSelection = resolveCustomSelect(actor?.system?.specificOrigin, actor?.system?.customSpecificOrigin);
  data.customRaceSelected = raceSelection.isCustom;
  data.customOriginSelected = originSelection.isCustom;
  data.customSpecificOriginSelected = specificOriginSelection.isCustom;
  data.hasCustomIdentitySelection = !!isEditMode && (raceSelection.isCustom || originSelection.isCustom || specificOriginSelection.isCustom);
  data.originOptions = getNationalOriginOptions(actor?.system?.origin);
  data.displayRace = raceSelection.display || "Human";
  data.displayOrigin = originSelection.isCustom
    ? originSelection.display
    : resolveNationalOriginLabel(originSelection.display);
  if (!data.displayOrigin) data.displayOrigin = getDefaultNationalOriginLabel();
  data.displaySpecificOrigin = specificOriginSelection.display || "Soldier";
}

export function prepareActorEdgeContext(data, actor) {
  const defaultEdgeLabelMode = getDefaultEdgeLabelMode(actor);
  const edgeLabelMode = sanitizeEdgeLabelMode(actor?.system?.edgeLabelMode, defaultEdgeLabelMode);
  const edgeCustomLabel = String(actor?.system?.edgeCustomLabel ?? "");
  data.edgeLabelMode = edgeLabelMode;
  data.edgeLabelIsCustom = edgeLabelMode === EDGE_LABEL_MODE_CUSTOM;
  data.edgeCustomLabel = edgeCustomLabel;
  data.edgeDisplayLabel = resolveEdgeLabel(edgeLabelMode, edgeCustomLabel, defaultEdgeLabelMode);
  const edgeResourcesRaw = Array.isArray(actor?.system?.edgeResources) ? actor.system.edgeResources : [];
  data.edgeResources = edgeResourcesRaw.map((entry, index) => {
    const normalized = normalizeEdgeResourceEntry(entry, edgeLabelMode);
    return {
      ...normalized,
      index,
      isCustom: normalized.labelMode === EDGE_LABEL_MODE_CUSTOM,
      displayLabel: resolveEdgeLabel(normalized.labelMode, normalized.customLabel, edgeLabelMode)
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

function resolveCustomSelect(baseValue, customValue) {
  const normalizedBase = String(baseValue ?? "").trim();
  const isCustom = /^(custom|other)$/i.test(normalizedBase);
  const customText = String(customValue ?? "").trim();
  const display = isCustom ? (customText || "Custom") : normalizedBase;
  return { isCustom, display };
}
