import { formatOptionalIntegerInput, parseOptionalInteger } from "../../../data/actor/helpers.mjs";
import {
  SKILL_TYPE_OPTIONS,
  getFixedSkillTypeValue,
  getSkillTypeOptionsForCategory,
  isRollableSkillType,
  isSkillProgressionType,
  isSignatureSkillType,
  normalizeSkillTypeForCategory
} from "../../../data/actor/skill-entry-types.mjs";
import { resolveSkillUsage } from "../../../data/actor/skill-entries.mjs";

export const SKILL_EDITOR_CATEGORIES = Object.freeze([
  { value: "", label: "", disabled: true, hidden: true },
  { value: "martial", label: "Martial" },
  { value: "magic", label: "Magic" },
  { value: "tradewrite", label: "Tradewrite" },
  { value: "mundane", label: "Mundane" }
]);

export const SKILL_EDITOR_CHARACTERISTICS = Object.freeze(["Strength", "Dexterity", "Mental", "Social"]);

const SKILL_EDITOR_WEAPON_TYPES = Object.freeze([
  "Unarmed", "Gauntlet", "Dagger", "Short Sword", "Longsword", "Great Sword", "Club", "Mace", "Warhammer",
  "Hand Axe", "Battle Axe", "Great Axe", "Short Spear", "Long Spear", "Staff", "Halberd", "Throwing Dagger",
  "Throwing Axe", "Short Bow", "Longbow", "Crossbow"
]);

const SKILL_EDITOR_GATE_TYPES = Object.freeze([
  "Raw", "Earth", "Water", "Fire", "Lightning", "Frost", "Impact", "Air", "Barrier", "Nature", "Light",
  "Shadow", "Crystal", "Aether", "Nether", "Chromatic", "Gravity", "Dispel", "Dislocation", "Cure", "Arcane",
  "Luck", "Limited Time", "Solaris", "Lunaris"
]);
const SKILL_EDITOR_DEFENSE_TYPES = Object.freeze(["Block", "Parry", "Dodge", "Armor"]);
const SKILL_EDITOR_COMBINED_MARTIAL_TYPES = Object.freeze([
  ...SKILL_EDITOR_WEAPON_TYPES,
  ...SKILL_EDITOR_DEFENSE_TYPES
]);

export const SKILL_EDITOR_TYPES = SKILL_TYPE_OPTIONS;

const NO_PROGRESSION_TYPES = new Set(["stance", "style", "cantrip", "historic", "subskill"]);
const CLASS_ONLY_TYPES = new Set(["spellcraft", "gate"]);
const GRADE_TYPES = new Set(["perk", "tm"]);

function selectedOptions(options, current) {
  return options.map(option => ({ ...option, selected: option.value === current }));
}

export function normalizeSkillEditorUsageSelection(entry = {}, requestedUsageId) {
  const usageIds = new Set(["base", ...(Array.isArray(entry.usages) ? entry.usages.map(usage => usage?.id) : [])]);
  if (requestedUsageId !== undefined && requestedUsageId !== null && requestedUsageId !== "") {
    return usageIds.has(requestedUsageId) ? requestedUsageId : "base";
  }
  return usageIds.has(entry.defaultUsageId) ? entry.defaultUsageId : "base";
}

function normalizeCharacteristicMode(characteristics, mode) {
  if (new Set(Array.isArray(characteristics) ? characteristics : []).size < 2) return "single";
  return String(mode ?? "").toLowerCase() === "advantaged" ? "advantaged" : "mixed";
}

function integer(raw, fallback = 0, { min = 0 } = {}) {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? Math.max(min, value) : fallback;
}

function rankValue(raw) {
  const value = String(raw ?? "").trim();
  return value.toLowerCase() === "u" ? "U" : String(integer(value, 0));
}

function typedOptions(values, current) {
  const selectedValue = values.includes(current) ? current : (current ? "custom" : "");
  return selectedOptions([
    { value: "", label: "", disabled: true, hidden: true },
    ...values.map(value => ({ value, label: value })),
    { value: "custom", label: "Custom" }
  ], selectedValue);
}

export function resolveSkillEditorTypedValue(selected, customValue, previousValue) {
  if (selected === undefined) return previousValue;
  if (selected !== "custom") return selected;
  return String(customValue ?? "").trim() || previousValue;
}

export function prepareSkillEditorIdentity(entry = {}, {
  collection = "notableCombats",
  effectiveEntry = null,
  selectedUsageId: requestedUsageId,
  editable = false
} = {}) {
  const selectedUsageId = normalizeSkillEditorUsageSelection(entry, requestedUsageId);
  const resolvedUsage = resolveSkillUsage(entry, selectedUsageId);
  const rollEntry = resolvedUsage.ok ? resolvedUsage.data : entry;
  const selectedUsage = selectedUsageId === "base"
    ? entry.baseUsage ?? {}
    : entry.usages?.find(usage => usage.id === selectedUsageId) ?? {};
  const category = String(entry.category ?? "");
  const type = normalizeSkillTypeForCategory(entry.type, category);
  const typeKey = type.toLowerCase();
  const isSignature = isSignatureSkillType(type);
  const isSkillType = isSkillProgressionType(type);
  const typeOptions = getSkillTypeOptionsForCategory(category, { currentType: type });
  const fixedTypeValue = getFixedSkillTypeValue(type);
  const typeIsCustom = typeKey === "custom" || !fixedTypeValue;
  const characteristics = new Set(Array.isArray(rollEntry.characteristics) ? rollEntry.characteristics : []);
  const hasAllCharacteristics = SKILL_EDITOR_CHARACTERISTICS.every(value => characteristics.has(value));
  const characteristicMode = normalizeCharacteristicMode([...characteristics], rollEntry.characteristicMode);
  const signatureUsage = entry.signatureUsage ?? {};
  const weaponType = String(entry.weaponType ?? "").trim();
  const defenseType = String(entry.defenseType ?? "").trim();
  const trickType = String(entry.trickType ?? "").trim();
  const signatureType = String(entry.signatureType ?? "").trim();
  const gateType = String(entry.gateType ?? "").trim();
  const weaponTypeIsCustom = !!weaponType && !SKILL_EDITOR_WEAPON_TYPES.includes(weaponType);
  const defenseTypeIsCustom = !!defenseType && !SKILL_EDITOR_DEFENSE_TYPES.includes(defenseType);
  const trickTypeIsCustom = !!trickType && !SKILL_EDITOR_COMBINED_MARTIAL_TYPES.includes(trickType);
  const signatureTypeIsCustom = !!signatureType && !SKILL_EDITOR_COMBINED_MARTIAL_TYPES.includes(signatureType);
  const gateTypeIsCustom = !!gateType && !SKILL_EDITOR_GATE_TYPES.includes(gateType);
  const usageOptions = [
    { value: "base", label: String(entry.baseUsage?.name || "Default") },
    ...(Array.isArray(entry.usages) ? entry.usages : []).map(usage => ({ value: usage.id, label: usage.name || "Untitled Usage" }))
  ].map(option => ({
    ...option,
    selected: option.value === selectedUsageId,
    isDefault: option.value === (entry.defaultUsageId || "base")
  }));
  const selectedUsageLabel = usageOptions.find(option => option.selected)?.label ?? "Default";
  const entryUseName = selectedUsageId === "base"
    ? String(entry.name || (collection === "skills" ? "Skill" : "Notable"))
    : selectedUsageLabel;
  const rollOverrides = selectedUsageId === "base" ? {} : selectedUsage.rollOverrides ?? {};
  const rollOverrideState = Object.fromEntries(
    ["characteristics", "characteristicMode", "tohit", "accuracy"].map(key => [key, Object.prototype.hasOwnProperty.call(rollOverrides, key)])
  );
  const specialGrade = Number.parseInt(entry.specialGrade, 10);
  const showSpecialGradeInput = GRADE_TYPES.has(typeKey);
  const showClassInput = !NO_PROGRESSION_TYPES.has(typeKey) && !showSpecialGradeInput;
  const showRankInput = showClassInput && !CLASS_ONLY_TYPES.has(typeKey);

  return {
    entryName: String(entry.name ?? ""),
    entryClassInput: integer(entry.class, 1, { min: 1 }),
    entryRankInput: String(entry.rank ?? "0"),
    entryToHitInput: formatOptionalIntegerInput(rollEntry.tohit),
    entryAccuracyInput: formatOptionalIntegerInput(rollEntry.accuracy, { showPlus: true }),
    effectiveToHit: effectiveEntry?.tohit,
    effectiveAccuracy: effectiveEntry?.accuracy,
    entryType: type,
    entryTypeOptions: selectedOptions(typeOptions, typeIsCustom ? "custom" : fixedTypeValue),
    typeIsCustom,
    typeCustomValue: typeIsCustom && typeKey !== "custom" ? type : "",
    category,
    categoryOptions: selectedOptions(SKILL_EDITOR_CATEGORIES, category),
    showWeaponType: category === "martial" && typeKey === "weapon",
    weaponTypeOptions: typedOptions(SKILL_EDITOR_WEAPON_TYPES, weaponType),
    weaponTypeIsCustom,
    weaponTypeCustomValue: weaponTypeIsCustom ? weaponType : "",
    showDefenseType: category === "martial" && typeKey === "defense",
    defenseTypeOptions: typedOptions(SKILL_EDITOR_DEFENSE_TYPES, defenseType),
    defenseTypeIsCustom,
    defenseTypeCustomValue: defenseTypeIsCustom ? defenseType : "",
    showTrickType: category === "martial" && typeKey === "combat trick",
    trickTypeOptions: typedOptions(SKILL_EDITOR_COMBINED_MARTIAL_TYPES, trickType),
    trickTypeIsCustom,
    trickTypeCustomValue: trickTypeIsCustom ? trickType : "",
    showSignatureType: category === "martial" && isSignature,
    signatureTypeOptions: typedOptions(SKILL_EDITOR_COMBINED_MARTIAL_TYPES, signatureType),
    signatureTypeIsCustom,
    signatureTypeCustomValue: signatureTypeIsCustom ? signatureType : "",
    showGateType: category === "magic" && ["gate", "spell"].includes(typeKey),
    gateTypeOptions: typedOptions(SKILL_EDITOR_GATE_TYPES, gateType),
    gateTypeIsCustom,
    gateTypeCustomValue: gateTypeIsCustom ? gateType : "",
    characteristicOptions: SKILL_EDITOR_CHARACTERISTICS.map(value => ({ value, selected: characteristics.has(value) })),
    characteristicMode,
    characteristicModeOptions: selectedOptions([
      { value: "mixed", label: hasAllCharacteristics ? "Omni Worst" : "Mixed" },
      { value: "advantaged", label: hasAllCharacteristics ? "Omni Best" : "Advantaged" }
    ], characteristicMode),
    showCharacteristicMode: characteristics.size > 1,
    allowToHitAcc: isRollableSkillType(type),
    isSkillType,
    isSignature,
    signatureCurrent: integer(entry.usesCurrent),
    signatureMax: integer(entry.usesMax),
    showDuressUses: !!signatureUsage.duressUses,
    duressCurrent: integer(signatureUsage.duressCurrent),
    duressMax: integer(signatureUsage.duressMax),
    specialGradeLabel: showSpecialGradeInput ? "Grade" : "",
    showClassInput,
    showRankInput,
    showSpecialGradeInput,
    showProgressionInputs: showClassInput || showRankInput || showSpecialGradeInput,
    specialGradeInput: Number.isFinite(specialGrade) && specialGrade > 0 ? specialGrade : "",
    isSkill: collection === "skills",
    isNotable: collection === "notableCombats",
    apInput: formatOptionalIntegerInput(entry.ap),
    spInput: formatOptionalIntegerInput(entry.sp),
    usageOptions,
    showUsageSelector: usageOptions.length > 1 || editable,
    selectedUsageId,
    selectedUsageLabel,
    entryUseLabel: `Use ${entryUseName}`,
    canActivateEntry: editable,
    selectedUsageIsBase: selectedUsageId === "base",
    selectedUsageIsDefault: selectedUsageId === (entry.defaultUsageId || "base"),
    rollOverrideScope: collection === "skills" && selectedUsageId !== "base",
    characteristicsCustomized: rollOverrideState.characteristics,
    characteristicModeCustomized: rollOverrideState.characteristicMode,
    tohitCustomized: rollOverrideState.tohit,
    accuracyCustomized: rollOverrideState.accuracy,
    rollOverrideFields: ["characteristics", "characteristicMode", "tohit", "accuracy"].map(key => ({
      key,
      customized: selectedUsageId !== "base" && rollOverrideState[key]
    }))
  };
}

export function buildSkillEditorPatch(values = {}, { collection = "notableCombats", previous = {} } = {}) {
  const rawMax = integer(values.usesMax, integer(previous.usesMax));
  const rawCurrent = integer(values.usesCurrent, integer(previous.usesCurrent));
  const duressMax = integer(values.duressMax, integer(previous.signatureUsage?.duressMax));
  const duressCurrent = integer(values.duressCurrent, integer(previous.signatureUsage?.duressCurrent));
  const category = String(values.category ?? previous.category ?? "");
  const type = normalizeSkillTypeForCategory(values.type ?? previous.type, category);
  const characteristics = Array.isArray(values.characteristics) ? [...values.characteristics] : [...(previous.characteristics ?? [])];
  const patch = {
    name: String(values.name ?? previous.name ?? ""),
    category,
    weaponType: String(values.weaponType ?? previous.weaponType ?? "").trim(),
    defenseType: String(values.defenseType ?? previous.defenseType ?? "").trim(),
    trickType: String(values.trickType ?? previous.trickType ?? "").trim(),
    signatureType: String(values.signatureType ?? previous.signatureType ?? "").trim(),
    gateType: String(values.gateType ?? previous.gateType ?? "").trim(),
    type,
    specialGrade: integer(values.specialGrade, integer(previous.specialGrade)),
    class: integer(values.class, integer(previous.class, 1), { min: 1 }),
    rank: rankValue(values.rank ?? previous.rank),
    characteristics,
    characteristicMode: normalizeCharacteristicMode(characteristics, values.characteristicMode ?? previous.characteristicMode),
    tohit: parseOptionalInteger(values.tohit, { min: 1 }),
    accuracy: parseOptionalInteger(values.accuracy, { allowSign: true }),
    usesCurrent: Math.min(rawMax, rawCurrent),
    usesMax: rawMax,
    signatureUsage: {
      duressUses: !!values.duressUses,
      duressCurrent: Math.min(duressMax, duressCurrent),
      duressMax
    }
  };
  if (collection === "skills") {
    patch.ap = parseOptionalInteger(values.ap, { min: 0 });
    patch.sp = parseOptionalInteger(values.sp, { min: 0 });
  }
  return patch;
}

export function buildSkillEditorFieldPatch(patch = {}, field = "") {
  if (field === "category") return { category: patch.category, type: patch.type };
  if (field === "type") return { type: patch.type };
  if (field === "characteristics") return {
    characteristics: patch.characteristics,
    characteristicMode: patch.characteristicMode
  };
  if ([
    "name", "weaponType", "defenseType", "trickType", "signatureType", "gateType", "specialGrade", "class", "rank",
    "characteristicMode", "tohit", "accuracy", "ap", "sp"
  ].includes(field)) {
    return { [field]: patch[field] };
  }
  const signatureField = { duressUses: "duressUses" }[field];
  return signatureField ? { signatureUsage: { [signatureField]: patch.signatureUsage?.[signatureField] } } : {};
}

export async function openSkillEditor(sheet, ref, options = {}) {
  const { openPeasantSkillEditor } = await import("../notable-combat/notable-combat-tag-editor.mjs");
  return openPeasantSkillEditor(sheet, ref, options);
}
