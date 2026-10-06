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
import { addEquippedArmorHalt, getEquippedArmorEffects } from "../equipped-armor.mjs";
import { getEquippedArmorGrade } from "../active-armor.mjs";
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
import { getEffectiveWoundThresholds } from "../wounds.mjs";
import { applyDieRate, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";

export function prepareActorHealthResourceContext(data, actor, { isEditMode = false, sourceSystem = null } = {}) {
  const system = actor.system ?? {};
  const editSystem = sourceSystem ?? system;
  const numberInput = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
  };
  data.simplifiedHp = isSimplifiedHpActor(actor);
  data.bolsteredHpMax = getActorBolsteredMax(actor);

  if (data.simplifiedHp) {
    const maxHealth = getActorHealthMax(actor);
    const currentHealthRaw = Number(system?.health?.value);
    const currentHealth = Number.isFinite(currentHealthRaw)
      ? Math.max(0, Math.min(currentHealthRaw, maxHealth))
      : maxHealth;
    data.simplifiedHealth = { value: currentHealth, max: maxHealth };
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
    const hpGrid = system?.hp?.grid || [];
    data.hpWithLabels = hpGrid.map((row, index) => {
      return {
        cells: row,
        label: hpLabelData[index] || { value: null, text: "" }
      };
    });

    const isWounded = system.conditions?.wounded || false;
    const thresholds = getEffectiveWoundThresholds(actor);
    const thresholdKeys = ["head", "arms", "legs", "torso"];
    const formatThresholds = (key) => thresholdKeys
      .map((location) => formatThresholdValue(thresholds[location][key]))
      .join("/");
    const effectiveThresholds = formatThresholds("effective");
    const baseThresholds = formatThresholds("base");
    data.woundThresholds = effectiveThresholds;
    data.woundThresholdsReduced = thresholdKeys.some((location) => thresholds[location].effective !== thresholds[location].base);
    data.woundThresholdsTooltip = data.woundThresholdsReduced
      ? `Base thresholds H/A/L/T: ${baseThresholds}`
      : "";
    data.woundThresholdsAriaLabel = `Effective thresholds H/A/L/T: ${effectiveThresholds}`;
    data.isWounded = isWounded;
  }

  const healthMaxForBar = data.simplifiedHp
    ? data.simplifiedHealth.max
    : Math.max(0, Number(system?.health?.max) || getActorHealthMax(actor));
  const healthValueForBar = data.simplifiedHp
    ? data.simplifiedHealth.value
    : Math.max(0, Math.min(Number(system?.health?.value) || 0, healthMaxForBar));
  const tempHpValueForBar = Math.max(0, Number(system?.temporaryHp?.value) || 0);
  const tempHpMaxForBar = Math.max(0, Number(system?.temporaryHp?.max) || 0, tempHpValueForBar);
  const bolsteredHpValueForBar = Math.max(0, Number(system?.bolsteredHp) || 0);
  const bolsteredHpMaxForBar = Math.max(0, Number(data.bolsteredHpMax) || getActorBolsteredMax(actor));
  const pct = (value, max) => {
    if (!Number.isFinite(max) || max <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((value / max) * 1000) / 10));
  };
  data.hpBar = {
    healthValue: healthValueForBar,
    healthMax: healthMaxForBar,
    healthValueInput: numberInput(editSystem?.health?.value, healthValueForBar),
    healthMaxInput: numberInput(editSystem?.health?.max, healthMaxForBar),
    healthPct: pct(healthValueForBar, healthMaxForBar),
    tempValue: tempHpValueForBar,
    tempMax: tempHpMaxForBar,
    tempValueInput: numberInput(editSystem?.temporaryHp?.value, tempHpValueForBar),
    tempMaxInput: numberInput(editSystem?.temporaryHp?.max, tempHpMaxForBar),
    tempPct: pct(tempHpValueForBar, tempHpMaxForBar),
    bolsteredValue: bolsteredHpValueForBar,
    bolsteredMax: bolsteredHpMaxForBar,
    bolsteredValueInput: numberInput(editSystem?.bolsteredHp, bolsteredHpValueForBar),
    bolsteredPct: pct(bolsteredHpValueForBar, bolsteredHpMaxForBar)
  };

  const apMaxForBar = Math.max(0, Number(system?.ap?.max) || 0);
  const apValueForBar = Math.max(0, Math.min(Number(system?.ap?.value) || 0, apMaxForBar));
  data.apBar = {
    value: apValueForBar,
    max: apMaxForBar,
    valueInput: numberInput(editSystem?.ap?.value, apValueForBar),
    maxInput: numberInput(editSystem?.ap?.max, apMaxForBar),
    pct: pct(apValueForBar, apMaxForBar)
  };

  const showZeroResourceBars = !!isEditMode;
  const buildResourceBar = (key, label) => {
    const max = Math.max(0, Number(system?.[key]?.max) || 0);
    const value = Math.max(0, Math.min(Number(system?.[key]?.value) || 0, max));
    const maxInput = numberInput(editSystem?.[key]?.max, max);
    const valueInput = Math.max(0, Math.min(numberInput(editSystem?.[key]?.value, value), maxInput));
    return { key, label, value, max, valueInput, maxInput, pct: pct(value, max), show: showZeroResourceBars || max > 0 };
  };
  const staminaBar = buildResourceBar("stamina", "Stamina");
  const attunementBar = buildResourceBar("attunement", "Attunement");
  const capacityBar = buildResourceBar("capacity", "Capacity");
  const edgeBar = buildResourceBar("edge", data.edgeDisplayLabel || "Edge");
  const armorChargeBar = buildResourceBar("armorCharge", "Armor Charge");
  const armorGrade = getEquippedArmorGrade(actor);
  const armorGradeLabel = armorGrade ? `${armorGrade} armor` : "no physical armor";
  data.armorCharge = {
    ...armorChargeBar,
    tooltip: `Armor Charge ${armorChargeBar.value} / ${armorChargeBar.max}; ${armorGradeLabel}.`
  };
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

  const equippedArmor = getEquippedArmorEffects(actor);
  const haltParts = addEquippedArmorHalt(system.haltValues, equippedArmor);
  const hardLocations = [
    system.hardHead || equippedArmor.hardHead,
    system.hardArms || equippedArmor.hardArms,
    system.hardLegs || equippedArmor.hardLegs,
    system.hardTorso || equippedArmor.hardTorso
  ];
  [data.haltHardHead, data.haltHardArms, data.haltHardLegs, data.haltHardTorso] = hardLocations.map(Boolean);
  const combatHaltTotals = getCombatHaltBuffTotals(system?.combatMods?.haltBuffs);
  const armorHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_HALT] || [0, 0, 0, 0];

  data.haltDisplay = haltParts.map((val, index) => {
    return {
      value: String((Number.parseInt(val, 10) || 0) + (armorHaltBuffs[index] || 0)),
      isHard: hardLocations[index] || false
    };
  });

  const naturalHaltParts = parseHaltSlashValues(system.naturalHaltValues || "0/0/0/0");

  const naturalHardLocations = [
    system.naturalHardHead,
    system.naturalHardArms,
    system.naturalHardLegs,
    system.naturalHardTorso
  ];
  const naturalHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_NATURAL] || [0, 0, 0, 0];

  data.naturalHaltDisplay = naturalHaltParts.map((val, index) => {
    return {
      value: String((Number.parseInt(val, 10) || 0) + (naturalHaltBuffs[index] || 0)),
      isHard: naturalHardLocations[index] || false
    };
  });

  if (!data.simplifiedHp) {
    const conditions = system.conditions || {};
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
