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

export function prepareActorHealthResourceContext(data, actor, { isEditMode = false } = {}) {
  data.simplifiedHp = isSimplifiedHpActor(actor);
  data.bolsteredHpMax = getActorBolsteredMax(actor);

  if (data.simplifiedHp) {
    const maxHealth = getActorHealthMax(actor);
    const currentHealthRaw = Number(actor.system?.health?.value);
    const currentHealth = Number.isFinite(currentHealthRaw)
      ? Math.max(0, Math.min(currentHealthRaw, maxHealth))
      : maxHealth;
    data.actor.system.health = { ...(data.actor.system.health || {}), value: currentHealth, max: maxHealth };
    data.hpWithLabels = [];
    data.woundThresholds = "";
    data.woundThresholdsReduced = false;
    data.isWounded = false;
    data.activeConditions = [];
    data.hasConditions = false;
  } else {
    const hpLabelData = [
      { value: 3, text: "Good" },
      { value: 5, text: "Fair" },
      { value: 7, text: "Poor" },
      { value: 10, text: "Terrible" },
      { value: 11, text: "Critical" }
    ];
    const hpGrid = actor.system?.hp?.grid || [];
    const hpCols = Number(actor.system?.hp?.cols) || 0;
    data.hpWithLabels = hpGrid.map((row, index) => {
      return {
        cells: row,
        label: hpLabelData[index] || { value: null, text: "" }
      };
    });

    const isWounded = actor.system.conditions?.wounded || false;
    const woundMult = getWoundThresholdMultipliers(actor);
    const headThreshold = hpCols * woundMult.head;
    const armsThreshold = hpCols * woundMult.arms;
    const legsThreshold = hpCols * woundMult.legs;
    const torsoThreshold = hpCols * woundMult.torso;

    if (isWounded) {
      const reducedArms = headThreshold;
      const reducedLegs = legsThreshold;
      const reducedTorso = hpCols * Math.max(woundMult.head, woundMult.torso - 1);
      data.woundThresholds = [
        formatThresholdValue(headThreshold),
        formatThresholdValue(reducedArms),
        formatThresholdValue(reducedLegs),
        formatThresholdValue(reducedTorso)
      ].join("/");
      data.woundThresholdsReduced = true;
    } else {
      data.woundThresholds = [
        formatThresholdValue(headThreshold),
        formatThresholdValue(armsThreshold),
        formatThresholdValue(legsThreshold),
        formatThresholdValue(torsoThreshold)
      ].join("/");
      data.woundThresholdsReduced = false;
    }
    data.isWounded = isWounded;
  }

  const healthMaxForBar = Math.max(0, Number(data.actor.system?.health?.max) || getActorHealthMax(actor));
  const healthValueForBar = Math.max(0, Math.min(Number(data.actor.system?.health?.value) || 0, healthMaxForBar));
  const tempHpValueForBar = Math.max(0, Number(data.actor.system?.temporaryHp?.value) || 0);
  const tempHpMaxForBar = Math.max(0, Number(data.actor.system?.temporaryHp?.max) || 0, tempHpValueForBar);
  const bolsteredHpValueForBar = Math.max(0, Number(data.actor.system?.bolsteredHp) || 0);
  const bolsteredHpMaxForBar = Math.max(0, Number(data.bolsteredHpMax) || getActorBolsteredMax(actor));
  const pct = (value, max) => {
    if (!Number.isFinite(max) || max <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((value / max) * 1000) / 10));
  };
  data.hpBar = {
    healthValue: healthValueForBar,
    healthMax: healthMaxForBar,
    healthPct: pct(healthValueForBar, healthMaxForBar),
    tempValue: tempHpValueForBar,
    tempMax: tempHpMaxForBar,
    tempPct: pct(tempHpValueForBar, tempHpMaxForBar),
    bolsteredValue: bolsteredHpValueForBar,
    bolsteredMax: bolsteredHpMaxForBar,
    bolsteredPct: pct(bolsteredHpValueForBar, bolsteredHpMaxForBar)
  };

  const apMaxForBar = Math.max(0, Number(data.actor.system?.ap?.max) || 0);
  const apValueForBar = Math.max(0, Math.min(Number(data.actor.system?.ap?.value) || 0, apMaxForBar));
  data.apBar = {
    value: apValueForBar,
    max: apMaxForBar,
    pct: pct(apValueForBar, apMaxForBar)
  };

  const showZeroResourceBars = !!isEditMode;
  const buildResourceBar = (key, label) => {
    const max = Math.max(0, Number(data.actor.system?.[key]?.max) || 0);
    const value = Math.max(0, Math.min(Number(data.actor.system?.[key]?.value) || 0, max));
    return { key, label, value, max, pct: pct(value, max), show: showZeroResourceBars || max > 0 };
  };
  const staminaBar = buildResourceBar("stamina", "Stamina");
  const attunementBar = buildResourceBar("attunement", "Attunement");
  const capacityBar = buildResourceBar("capacity", "Capacity");
  const edgeBar = buildResourceBar("edge", data.edgeDisplayLabel || "Edge");
  data.armorCharge = buildResourceBar("armorCharge", "Armor Charge");
  data.resourceBars = {
    stamina: staminaBar,
    attunement: attunementBar,
    capacity: capacityBar,
    edge: edgeBar,
    firstRowVisible: staminaBar.show || attunementBar.show,
    firstRowSingle: staminaBar.show !== attunementBar.show,
    secondRowVisible: capacityBar.show || edgeBar.show,
    secondRowSingle: capacityBar.show !== edgeBar.show,
    anyVisible: staminaBar.show || attunementBar.show || capacityBar.show || edgeBar.show
  };

  const haltParts = parseHaltSlashValues(actor.system.haltValues || "0/0/0/0");
  const hardLocations = [
    actor.system.hardHead,
    actor.system.hardArms,
    actor.system.hardLegs,
    actor.system.hardTorso
  ];
  const combatHaltTotals = getCombatHaltBuffTotals(actor.system?.combatMods?.haltBuffs);
  const armorHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_HALT] || [0, 0, 0, 0];

  data.haltDisplay = haltParts.map((val, index) => {
    return {
      value: String((Number.parseInt(val, 10) || 0) + (armorHaltBuffs[index] || 0)),
      isHard: hardLocations[index] || false
    };
  });

  const naturalHaltParts = parseHaltSlashValues(actor.system.naturalHaltValues || "0/0/0/0");

  const naturalHardLocations = [
    actor.system.naturalHardHead,
    actor.system.naturalHardArms,
    actor.system.naturalHardLegs,
    actor.system.naturalHardTorso
  ];
  const naturalHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_NATURAL] || [0, 0, 0, 0];

  data.naturalHaltDisplay = naturalHaltParts.map((val, index) => {
    return {
      value: String((Number.parseInt(val, 10) || 0) + (naturalHaltBuffs[index] || 0)),
      isHard: naturalHardLocations[index] || false
    };
  });

  if (!data.simplifiedHp) {
    const conditions = actor.system.conditions || {};
    data.activeConditions = [];
    data.hasConditions = false;

    if (conditions.wounded) {
      data.hasConditions = true;
    }

    const locMappings = [
      { key: "head", label: "Head" },
      { key: "rightArm", label: "Right Arm" },
      { key: "leftArm", label: "Left Arm" },
      { key: "rightLeg", label: "Right Leg" },
      { key: "leftLeg", label: "Left Leg" },
      { key: "torso", label: "Torso" },
      { key: "arms", label: "Arms" },
      { key: "legs", label: "Legs" }
    ];
    for (const loc of locMappings) {
      if (conditions[loc.key]) {
        data.activeConditions.push({
          key: loc.key,
          label: `${conditions[loc.key].charAt(0).toUpperCase() + conditions[loc.key].slice(1)} ${loc.label}`
        });
        data.hasConditions = true;
      }
    }
  }
}
