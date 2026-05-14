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
import { getWoundThresholdMultipliers } from "../targeted-damage.mjs";
import { applyDieRate, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";

export function prepareActorStressContext(data, actor, { isEditMode = false } = {}) {
  const physicalCountRaw = Number(actor.system.physicalStressCount);
  const mentalCountRaw = Number(actor.system.mentalStressCount);
  const generalCountRaw = Number(actor.system.generalStressCount);
  const physicalCount = Number.isFinite(physicalCountRaw) ? Math.max(0, Math.floor(physicalCountRaw)) : 4;
  const mentalCount = Number.isFinite(mentalCountRaw) ? Math.max(0, Math.floor(mentalCountRaw)) : 4;
  const generalCount = Number.isFinite(generalCountRaw) ? Math.max(0, Math.floor(generalCountRaw)) : 8;

  data.stress = {
    physical: [],
    mental: [],
    general: []
  };

  for (let i = 0; i < physicalCount; i++) {
    data.stress.physical.push(actor.system[`physical${i}`] || 0);
  }

  for (let i = 0; i < mentalCount; i++) {
    data.stress.mental.push(actor.system[`mental${i}`] || 0);
  }

  for (let i = 0; i < generalCount; i++) {
    data.stress.general.push(actor.system[`general${i}`] || 0);
  }

  const showZeroStressBars = !!isEditMode;
  const buildStressBar = (cells = []) => {
    const count = cells.length;
    const totalSeverity = cells.reduce((sum, value) => {
      const numeric = Math.max(0, Math.min(3, Number(value) || 0));
      return sum + numeric;
    }, 0);
    const sectionValue = (offset) => Math.max(0, Math.min(count, totalSeverity - offset));
    const sectionPct = (value) => count > 0 ? Math.round((value / count) * 1000) / 10 : 0;
    const segments = [
      { key: "blunt", label: "Blunt", value: sectionValue(0), max: count },
      { key: "lethal", label: "Lethal", value: sectionValue(count), max: count },
      { key: "critical", label: "Critical", value: sectionValue(count * 2), max: count }
    ];
    for (const segment of segments) segment.fillPct = sectionPct(segment.value);
    return { count, totalSeverity, maxSeverity: count * 3, segments, show: showZeroStressBars || count > 0 };
  };

  const physicalStressBar = buildStressBar(data.stress.physical);
  const mentalStressBar = buildStressBar(data.stress.mental);
  const generalStressBar = buildStressBar(data.stress.general);
  data.stressBars = {
    physical: physicalStressBar,
    mental: mentalStressBar,
    general: generalStressBar,
    firstRowVisible: physicalStressBar.show || mentalStressBar.show,
    firstRowSingle: physicalStressBar.show !== mentalStressBar.show,
    anyVisible: physicalStressBar.show || mentalStressBar.show || generalStressBar.show
  };
}
