export const SKILL_TYPE_OPTIONS = Object.freeze([
  { value: "skill", label: "Skill" },
  { value: "Weapon", label: "Weapon" },
  { value: "Defense", label: "Defense" },
  { value: "Combat Trick", label: "Combat Trick" },
  { value: "Signature", label: "Signature" },
  { value: "Stance", label: "Stance" },
  { value: "Perk", label: "Perk" },
  { value: "Style", label: "Style" },
  { value: "Cantrip", label: "Cantrip" },
  { value: "Historic", label: "Historic" },
  { value: "TM", label: "TM" },
  { value: "Spellcraft", label: "Spellcraft" },
  { value: "Gate", label: "Gate" },
  { value: "Spell", label: "Spell" },
  { value: "Subskill", label: "Subskill" },
  { value: "custom", label: "Custom" }
]);

const FIXED_SKILL_TYPE_OPTIONS = SKILL_TYPE_OPTIONS.slice(0, -1);
const CATEGORY_TYPE_VALUES = Object.freeze({
  martial: ["Weapon", "Defense", "Combat Trick", "Signature", "Stance", "Perk"],
  magic: ["Spellcraft", "Gate", "TM", "Cantrip", "Historic", "Spell", "Subskill"],
  tradewrite: ["skill", "Signature"],
  mundane: ["skill", "Signature"],
  "": ["skill"]
});
const CATEGORY_DEFAULT_TYPES = Object.freeze({
  martial: "Weapon",
  magic: "Spellcraft",
  tradewrite: "skill",
  mundane: "skill",
  "": "skill"
});

function categoryKey(category) {
  const key = String(category ?? "").trim().toLowerCase();
  return Object.hasOwn(CATEGORY_TYPE_VALUES, key) ? key : "";
}

export function getFixedSkillTypeValue(type) {
  const key = String(type ?? "").trim().toLowerCase();
  return FIXED_SKILL_TYPE_OPTIONS.find(option => option.value.toLowerCase() === key)?.value ?? "";
}

export function isSignatureSkillType(type) {
  return getFixedSkillTypeValue(type) === "Signature";
}

export function isSkillProgressionType(type) {
  return ["skill", "Weapon", "Defense", "Combat Trick", "Signature", "Spell"].includes(getFixedSkillTypeValue(type));
}

export function isRollableSkillType(type) {
  return !["stance", "perk", "style", "cantrip", "tm", "subskill"].includes(
    String(type ?? "").trim().toLowerCase()
  );
}

export function getSkillTypeOptionsForCategory(category, { currentType = "" } = {}) {
  const key = categoryKey(category);
  const values = [...CATEGORY_TYPE_VALUES[key]];
  if (String(category ?? "").trim() === "" && isSignatureSkillType(currentType)) values.splice(1, 0, "Signature");
  return [
    ...values.map(value => SKILL_TYPE_OPTIONS.find(option => option.value === value)),
    SKILL_TYPE_OPTIONS.at(-1)
  ];
}

export function normalizeSkillTypeForCategory(type, category) {
  const value = String(type ?? "").trim() || "skill";
  const fixedValue = getFixedSkillTypeValue(value);
  if (!fixedValue) return value;
  const key = categoryKey(category);
  if (String(category ?? "").trim() === "" && fixedValue === "Signature") return fixedValue;
  if (key === "martial" && fixedValue === "skill") return "Weapon";
  if (["tradewrite", "mundane", ""].includes(key) && fixedValue === "Weapon") return "skill";
  if (key === "magic" && ["skill", "Weapon"].includes(fixedValue)) return "Spell";
  return CATEGORY_TYPE_VALUES[key].includes(fixedValue) ? fixedValue : CATEGORY_DEFAULT_TYPES[key];
}
