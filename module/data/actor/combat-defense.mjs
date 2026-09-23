export const COMBAT_DEFENSE_RESPONSE_OPTIONS = Object.freeze([
  { key: "melee", label: "Melee" },
  { key: "projectile", label: "Projectile" },
  { key: "normal", label: "Normal" },
  { key: "smite", label: "Smite" },
  { key: "aoe", label: "AoE" },
  { key: "areaBlast", label: "Area Blast" },
  { key: "tileBlast", label: "Tile Blast" }
]);

export const COMBAT_DEFENSE_BLOCK_TYPES = Object.freeze([
  "Shield",
  "Weapon",
  "Mage"
]);

export const COMBAT_DEFENSE_SHIELD_ARM_OPTIONS = Object.freeze([
  { key: "LeftArm", label: "Left Arm" },
  { key: "RightArm", label: "Right Arm" }
]);

export function getCombatDefenseResponseOption(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return null;
  if (["aoe", "area"].includes(normalized)) {
    return COMBAT_DEFENSE_RESPONSE_OPTIONS.find((option) => option.key === "aoe") || null;
  }
  if (["blast", "areablast"].includes(normalized)) {
    return COMBAT_DEFENSE_RESPONSE_OPTIONS.find((option) => option.key === "areaBlast") || null;
  }
  if (["tile", "tileblast"].includes(normalized)) {
    return COMBAT_DEFENSE_RESPONSE_OPTIONS.find((option) => option.key === "tileBlast") || null;
  }
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
      aoe: createDefaultCombatDefenseEffectivenessEntry(),
      areaBlast: createDefaultCombatDefenseEffectivenessEntry(),
      tileBlast: createDefaultCombatDefenseEffectivenessEntry()
    },
    block: false,
    blockType: "Shield",
    shieldArm: "LeftArm",
    hardness: 0,
    hp: 0,
    masteryBonus: false,
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

export function normalizeCombatDefenseShieldArm(rawArm) {
  const raw = String(rawArm || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (raw === "right" || raw === "rightarm") return "RightArm";
  return "LeftArm";
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
  const maxHpRaw = Number.parseInt(safe.maxHp, 10);
  const maxHp = blockType === "Mage"
    ? (Number.isFinite(maxHpRaw) && maxHpRaw > 0
      ? maxHpRaw
      : Number.isFinite(hpRaw) && hpRaw > 0 ? hpRaw : 40)
    : null;
  const weaponLegacyHardness = blockType === "Weapon" && Number.isFinite(hpRaw) && !Number.isFinite(hardnessRaw)
    ? hpRaw
    : hardnessRaw;
  const debuffToHitRaw = Number.parseInt(safe.debuffToHit, 10) || 0;
  const appliesDebuff = typeof safe.appliesDebuff === "boolean"
    ? !!safe.appliesDebuff
    : (!!safe.appliesBefore || debuffToHitRaw !== 0);

  const normalized = {
    ...defaults,
    responses: normalizeCombatDefenseResponses(safe.responses),
    effectiveness,
    block,
    blockType,
    shieldArm: normalizeCombatDefenseShieldArm(safe.shieldArm),
    hardness: block && (blockType === "Shield" || blockType === "Weapon")
      ? Math.max(0, Number.isFinite(weaponLegacyHardness) ? weaponLegacyHardness : 0)
      : 0,
    hp: block && blockType === "Shield"
      ? Math.min(maxHp ?? Number.POSITIVE_INFINITY, Math.max(0, Number.isFinite(hpRaw) ? hpRaw : 0))
      : 0,
    masteryBonus: block && blockType === "Weapon" ? !!safe.masteryBonus : false,
    appliesDebuff,
    debuffToHit: appliesDebuff ? debuffToHitRaw : 0,
    appliesBefore: appliesDebuff ? !!safe.appliesBefore : false
  };
  if (blockType === "Mage") {
    normalized.maxHp = maxHp;
  }
  return normalized;
}

export function normalizeShieldDurability(rawShield) {
  return {
    hp: Math.max(0, Number.parseInt(rawShield?.hp, 10) || 0),
    hardness: Math.max(0, Number.parseInt(rawShield?.hardness, 10) || 0)
  };
}

export function getShieldDurabilityEffectiveHardness(rawShield) {
  const shield = normalizeShieldDurability(rawShield);
  return Math.min(shield.hardness, shield.hp);
}

export function applyShieldDurabilityDamage(rawShield, hpDamage) {
  const shield = normalizeShieldDurability(rawShield);
  const damage = Math.max(0, Number.parseInt(hpDamage, 10) || 0);
  const hpAfter = Math.max(0, shield.hp - damage);

  if (hpAfter <= 0) {
    return { hp: 0, hardness: 0 };
  }

  const hardnessDamage = Math.max(0, Math.min(shield.hp, shield.hardness) - hpAfter);
  const hardnessAfter = Math.max(0, shield.hardness - hardnessDamage);
  return { hp: hpAfter, hardness: hardnessAfter };
}

export function getShieldBlockEffectiveHardness(rawDefense) {
  const defense = normalizeCombatDefense(rawDefense);
  if (!defense.block || defense.blockType !== "Shield") return 0;
  return getShieldDurabilityEffectiveHardness(defense);
}

export function resolveShieldBlockDamage(rawDefense, damage, { braced = false } = {}) {
  const defense = normalizeCombatDefense({ ...rawDefense, block: true, blockType: "Shield" });
  const damageAmount = Math.max(0, Number(damage) || 0);
  const hardnessApplied = Math.min(
    damageAmount,
    getShieldBlockEffectiveHardness(defense) * (braced ? 2 : 1)
  );
  const damageAfterHardness = Math.max(0, damageAmount - hardnessApplied);
  const shieldDamage = braced ? damageAfterHardness : Math.ceil(damageAfterHardness / 2);
  let armDamage = braced ? 0 : Math.floor(damageAfterHardness / 2);
  const shieldDamageApplied = Math.min(defense.hp, shieldDamage);
  const shieldOverflowDamage = Math.max(0, shieldDamage - shieldDamageApplied);
  armDamage += shieldOverflowDamage;
  const shieldAfter = applyShieldDurabilityDamage(defense, shieldDamageApplied);

  return {
    hardnessApplied,
    damageAfterHardness,
    shieldDamage,
    shieldDamageApplied,
    shieldOverflowDamage,
    shieldHpAfter: shieldAfter.hp,
    shieldHardnessAfter: shieldAfter.hardness,
    armDamage,
    overkill: braced && shieldOverflowDamage > 0
  };
}

export function resolveMageBlockDamage(rawDefense, damage) {
  const defense = normalizeCombatDefense({ ...rawDefense, block: true, blockType: "Mage" });
  const damageAmount = Math.max(0, Number(damage) || 0);
  const rawHp = Number.parseInt(rawDefense?.hp, 10);
  const hpBefore = Math.min(defense.maxHp, Math.max(0, Number.isFinite(rawHp) ? rawHp : 0));
  const absorbed = Math.min(hpBefore, damageAmount);
  const hpAfter = hpBefore - absorbed;
  const overflow = Math.max(0, damageAmount - absorbed);

  return {
    hpBefore,
    hpAfter,
    absorbed,
    overflow,
    cleanHit: overflow > 0
  };
}

export function getCombatDefenseSummary(rawDefense) {
  const defense = normalizeCombatDefense(rawDefense);
  return defense.responses.join("/");
}
