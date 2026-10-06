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
import { getFlexibleAdvantageDescription } from "../flexible-advantages.mjs";
import { applyDieRate, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";

export function prepareActorAdvantageContext(data, actor, { isEditMode = false, sourceSystem = null } = {}) {
  const system = isEditMode && sourceSystem ? sourceSystem : actor.system;
  const advantageNamesRaw = Array.isArray(system.flexibleAdvantages) ? system.flexibleAdvantages : [];
  const advantageDescriptionsRaw = Array.isArray(system.flexibleAdvantageDescriptions) ? system.flexibleAdvantageDescriptions : [];
  data.flexibleAdvantages = advantageNamesRaw.map((advantage, index) => {
    const name = (typeof advantage === "string")
      ? advantage
      : String(advantage?.name ?? "");
    const description = getFlexibleAdvantageDescription(advantageDescriptionsRaw[index] ?? advantage?.description);
    const descriptionText = description.replace(/<[^>]*>/g, "").trim();
    return {
      name,
      description,
      hasDescription: descriptionText.length > 0,
      index
    };
  });
}
