export const COMBAT_DEFENSE_RESPONSE_OPTIONS = Object.freeze([
  { key: "melee", label: "Melee" },
  { key: "projectile", label: "Projectile" },
  { key: "normal", label: "Normal" },
  { key: "smite", label: "Smite" },
  { key: "aoe", label: "AoE" }
]);

export const COMBAT_DEFENSE_BLOCK_TYPES = Object.freeze([
  "Shield",
  "Weapon",
  "Mage"
]);

export function getCombatDefenseResponseOption(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return null;
  return COMBAT_DEFENSE_RESPONSE_OPTIONS.find((option) => {
    if (option.key === normalized) return true;
    if (option.label.toLowerCase().replace(/[\s_-]+/g, "") === normalized) return true;
    return option.key === "normal" && normalized === "normaltargeting";
  }) || null;
}

export function getCombatDefenseResponseKey(value) {
  return getCombatDefenseResponseOption(value)?.key || "";
}

export function normalizeCombatDefenseResponses(rawResponses) {
  const list = Array.isArray(rawResponses) ? rawResponses : [];
  return COMBAT_DEFENSE_RESPONSE_OPTIONS
    .filter((option) => list.some((entry) => getCombatDefenseResponseKey(entry) === option.key))
    .map((option) => option.label);
}

export function createDefaultCombatDefenseEffectivenessEntry() {
  return { mosPer: 0, accuracyPenalty: 0 };
}

export function parseCombatDefenseMosPer(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

export function createDefaultCombatDefense() {
  return {
    responses: [],
    effectiveness: {
      melee: createDefaultCombatDefenseEffectivenessEntry(),
      projectile: createDefaultCombatDefenseEffectivenessEntry(),
      normal: createDefaultCombatDefenseEffectivenessEntry(),
      smite: createDefaultCombatDefenseEffectivenessEntry(),
      aoe: createDefaultCombatDefenseEffectivenessEntry()
    },
    block: false,
    blockType: "Shield",
    hardness: 0,
    hp: 0,
    appliesDebuff: false,
    debuffToHit: 0,
    appliesBefore: false
  };
}

export function normalizeCombatDefenseBlockType(rawType) {
  const raw = String(rawType || "").trim().toLowerCase();
  if (raw === "weapon") return "Weapon";
  if (raw === "mage") return "Mage";
  return "Shield";
}

export function normalizeCombatDefenseEffectivenessEntry(entry) {
  return {
    mosPer: parseCombatDefenseMosPer(entry?.mosPer),
    accuracyPenalty: Number.parseInt(entry?.accuracyPenalty, 10) || 0
  };
}

export function normalizeCombatDefense(rawDefense) {
  const defaults = createDefaultCombatDefense();
  const safe = (rawDefense && typeof rawDefense === "object") ? rawDefense : {};
  const effectivenessRaw = (safe.effectiveness && typeof safe.effectiveness === "object") ? safe.effectiveness : {};
  const effectiveness = {};

  for (const option of COMBAT_DEFENSE_RESPONSE_OPTIONS) {
    effectiveness[option.key] = normalizeCombatDefenseEffectivenessEntry(effectivenessRaw[option.key]);
  }

  const hasExplicitBlock = typeof safe.block === "boolean";
  const hasLegacyContactless = typeof safe.contactless === "boolean";
  const legacyContactless = !!safe.contactless;
  const block = hasExplicitBlock ? !!safe.block : (hasLegacyContactless ? !legacyContactless : false);
  const blockType = normalizeCombatDefenseBlockType(safe.blockType);
  const hardnessRaw = Number.parseInt(safe.hardness, 10);
  const hpRaw = Number.parseInt(safe.hp, 10);
  const debuffToHitRaw = Number.parseInt(safe.debuffToHit, 10) || 0;
  const appliesDebuff = typeof safe.appliesDebuff === "boolean"
    ? !!safe.appliesDebuff
    : (!!safe.appliesBefore || debuffToHitRaw !== 0);

  return {
    ...defaults,
    responses: normalizeCombatDefenseResponses(safe.responses),
    effectiveness,
    block,
    blockType,
    hardness: block && blockType !== "Mage" ? Math.max(0, Number.isFinite(hardnessRaw) ? hardnessRaw : 0) : 0,
    hp: block ? Math.max(0, Number.isFinite(hpRaw) ? hpRaw : 0) : 0,
    appliesDebuff,
    debuffToHit: appliesDebuff ? debuffToHitRaw : 0,
    appliesBefore: appliesDebuff ? !!safe.appliesBefore : false
  };
}

export function getCombatDefenseSummary(rawDefense) {
  const defense = normalizeCombatDefense(rawDefense);
  return defense.responses.join("/");
}
