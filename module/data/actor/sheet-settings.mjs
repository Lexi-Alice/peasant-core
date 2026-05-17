import {
  PC_ARMOR_CHARGE_MULTIPLIER_FLAG,
  PC_DEFAULT_ARMOR_CHARGE_MULTIPLIER,
  PC_DEFAULT_WOUND_ARMS_MULTIPLIER,
  PC_DEFAULT_WOUND_HEAD_MULTIPLIER,
  PC_DEFAULT_WOUND_LEGS_MULTIPLIER,
  PC_DEFAULT_WOUND_TORSO_MULTIPLIER,
  PC_WOUND_ARMS_MULTIPLIER_FLAG,
  PC_WOUND_HEAD_MULTIPLIER_FLAG,
  PC_WOUND_LEGS_MULTIPLIER_FLAG,
  PC_WOUND_TORSO_MULTIPLIER_FLAG,
  sanitizePositiveMultiplier
} from "./targeted-damage.mjs";

export const PC_CONSCIOUSNESS_SAVE_FLAG = "rollConsciousnessAsSaves";
export const PC_INITIATIVE_SAVE_FLAG = "rollInitiativeAsSaves";
export const PC_SIMPLIFIED_HP_FLAG = "simplifiedHp";
export const PC_RUN_MULTIPLIER_FLAG = "runMultiplier";
export const PC_DEFAULT_RUN_MULTIPLIER = 2;
export const PC_SPRINT_MULTIPLIER_FLAG = "sprintMultiplier";
export const PC_DEFAULT_SPRINT_MULTIPLIER = 6;
export const PC_SAVE_MODIFIER_FLAG = "saveModifier";
export const PC_DEFAULT_SAVE_MODIFIER = 0;
export const PC_PRIMAL_EVASION_FLAG = "primalEvasion";
export const PC_DEFAULT_PRIMAL_EVASION = 0;
export const PC_DEFENSE_FAVORITES_FLAG = "defenseFavorites";
export const PC_ART_PANEL_COLLAPSED_FLAG = "artPanelCollapsed";
export const PC_WINTER_EDGE_FLAG = "winterEdge";

export const PC_ACTOR_SETTING_DEFINITIONS = Object.freeze([
  {
    group: "Rolls",
    label: "Roll consciousness checks as saves?",
    hint: "If checked, consciousness checks use 3d6 and keep the highest 2 dice.",
    type: "boolean",
    flagKey: PC_CONSCIOUSNESS_SAVE_FLAG
  },
  {
    group: "Rolls",
    label: "Roll initiative checks as saves?",
    hint: "If checked, initiative checks use 3d6 and keep the highest 2 dice.",
    type: "boolean",
    flagKey: PC_INITIATIVE_SAVE_FLAG
  },
  {
    group: "Health",
    label: "Simplified HP?",
    hint: "If checked, this actor uses current/max HP without the HP grid, wounds, or wound thresholds.",
    type: "boolean",
    flagKey: PC_SIMPLIFIED_HP_FLAG
  },
  {
    group: "Rolls",
    label: "Save modifiers?",
    hint: "Adds to save THs shown in the attribute table. Use positive or negative whole numbers.",
    type: "number",
    flagKey: PC_SAVE_MODIFIER_FLAG,
    defaultValue: PC_DEFAULT_SAVE_MODIFIER,
    allowNegative: true
  },
  {
    group: "Defenses",
    label: "Primal Evasion?",
    hint: "When 1 or higher, choosing None as the defensive reflex applies this as an Accuracy penalty to non-Smite attacks.",
    type: "number",
    flagKey: PC_PRIMAL_EVASION_FLAG,
    defaultValue: PC_DEFAULT_PRIMAL_EVASION,
    min: 0
  },
  {
    group: "Movement",
    label: "Run multiplier?",
    hint: "Adjusts the movement run value multiplier shown on this sheet.",
    type: "number",
    flagKey: PC_RUN_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_RUN_MULTIPLIER,
    min: 1
  },
  {
    group: "Movement",
    label: "Sprint multiplier?",
    hint: "Adjusts the movement sprint value multiplier shown on this sheet.",
    type: "number",
    flagKey: PC_SPRINT_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_SPRINT_MULTIPLIER,
    min: 1
  },
  {
    group: "Health",
    label: "Armor charge multiplier?",
    hint: "Adjusts how much armor HALT is multiplied by when Armor Charge is checked in Take Damage.",
    type: "number",
    flagKey: PC_ARMOR_CHARGE_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_ARMOR_CHARGE_MULTIPLIER,
    min: 0.1,
    allowDecimal: true
  },
  {
    group: "Wound Thresholds",
    label: "Wound head multiplier?",
    hint: "Head wound threshold multiplier.",
    type: "number",
    flagKey: PC_WOUND_HEAD_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_WOUND_HEAD_MULTIPLIER,
    min: 0.1,
    allowDecimal: true
  },
  {
    group: "Wound Thresholds",
    label: "Wound arms multiplier?",
    hint: "Arms wound threshold multiplier.",
    type: "number",
    flagKey: PC_WOUND_ARMS_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_WOUND_ARMS_MULTIPLIER,
    min: 0.1,
    allowDecimal: true
  },
  {
    group: "Wound Thresholds",
    label: "Wound legs multiplier?",
    hint: "Legs wound threshold multiplier.",
    type: "number",
    flagKey: PC_WOUND_LEGS_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_WOUND_LEGS_MULTIPLIER,
    min: 0.1,
    allowDecimal: true
  },
  {
    group: "Wound Thresholds",
    label: "Wound torso multiplier?",
    hint: "Torso wound threshold multiplier.",
    type: "number",
    flagKey: PC_WOUND_TORSO_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_WOUND_TORSO_MULTIPLIER,
    min: 0.1,
    allowDecimal: true
  },
  {
    group: "Miscellaneous",
    label: "Use Winter's Edge?",
    hint: "If checked, this actor's Edge resource is labeled Winter's Edge.",
    type: "boolean",
    flagKey: PC_WINTER_EDGE_FLAG
  }
]);

export function sanitizePeasantCoreSettingNumber(setting, value) {
  if (setting?.allowNegative) {
    const fallbackRaw = Number.parseInt(setting.defaultValue ?? 0, 10);
    const fallback = Number.isFinite(fallbackRaw) ? fallbackRaw : 0;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (setting?.allowDecimal) {
    return sanitizePositiveMultiplier(value, setting.defaultValue ?? 1, setting.min ?? 0.1);
  }

  const parsed = Math.floor(Number(value));
  const fallback = Math.floor(Number(setting?.defaultValue ?? 1));
  const min = Number.isFinite(Number(setting?.min)) ? Number(setting.min) : 1;
  return Number.isFinite(parsed) ? Math.max(min, parsed) : Math.max(min, Number.isFinite(fallback) ? fallback : 1);
}

export function getPeasantCoreSettingValue(actor, setting) {
  const raw = actor?.getFlag?.("peasant-core", setting.flagKey);
  if (setting.type === "boolean") return !!raw;
  return sanitizePeasantCoreSettingNumber(setting, raw);
}

export function getPeasantCoreSettingGroups(actor, editable = true) {
  const groupMap = new Map();

  for (const setting of PC_ACTOR_SETTING_DEFINITIONS) {
    const group = setting.group || "Settings";
    if (!groupMap.has(group)) groupMap.set(group, []);

    const value = getPeasantCoreSettingValue(actor, setting);
    const hasMin = Number.isFinite(Number(setting.min));
    groupMap.get(group).push({
      ...setting,
      id: `pc-setting-${setting.flagKey}`,
      isBoolean: setting.type === "boolean",
      checked: value === true,
      value,
      editable,
      step: setting.allowDecimal ? "0.1" : "1",
      inputMode: setting.allowDecimal ? "decimal" : "numeric",
      hasMin,
      min: hasMin ? setting.min : null
    });
  }

  return Array.from(groupMap, ([label, settings]) => ({ label, settings }));
}

export function formatThresholdValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n - Math.round(n)) < 0.00001) return String(Math.round(n));
  return String(Number(n.toFixed(2)));
}
