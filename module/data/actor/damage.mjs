export const PC_DAMAGE_RESISTANCE_BLUNT_MULTIPLIER_FLAG = "damageResistanceBluntMultiplier";
export const PC_DAMAGE_RESISTANCE_LETHAL_MULTIPLIER_FLAG = "damageResistanceLethalMultiplier";
export const PC_DAMAGE_RESISTANCE_CRITICAL_MULTIPLIER_FLAG = "damageResistanceCriticalMultiplier";
export const PC_DEFAULT_DAMAGE_RESISTANCE_MULTIPLIER = 1;

export function normalizeScaleRating(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

export function getDamageScaleResult(amount, actor, attackScale = 0) {
  const originalDamage = Math.max(0, Number(amount) || 0);
  const targetScale = normalizeScaleRating(actor?.system?.scale);
  const penetration = normalizeScaleRating(attackScale);
  const missingScale = Math.max(0, targetScale - penetration);
  return {
    originalDamage, targetScale, attackScale: penetration, missingScale,
    damage: missingScale > 0 ? Math.floor(originalDamage / (2 ** missingScale)) : originalDamage
  };
}

export const PC_DAMAGE_RESISTANCE_MULTIPLIER_FLAGS = Object.freeze({
  blunt: PC_DAMAGE_RESISTANCE_BLUNT_MULTIPLIER_FLAG,
  lethal: PC_DAMAGE_RESISTANCE_LETHAL_MULTIPLIER_FLAG,
  critical: PC_DAMAGE_RESISTANCE_CRITICAL_MULTIPLIER_FLAG
});

export function splitDamageCounts(amount, type) {
  const total = Math.max(0, Number(amount) || 0);
  const counts = { critical: 0, lethal: 0, blunt: 0 };
  switch (type) {
    case "critical":
      counts.critical = total;
      break;
    case "lethal":
      counts.lethal = total;
      break;
    case "blunt":
      counts.blunt = total;
      break;
    case "hybrid": {
      const lethal = Math.ceil(total / 2);
      const blunt = Math.floor(total / 2);
      counts.lethal = lethal;
      counts.blunt = blunt;
      break;
    }
    default:
      counts.lethal = total;
      break;
  }
  return counts;
}

export function sanitizeDamageResistanceMultiplier(value, fallback = PC_DEFAULT_DAMAGE_RESISTANCE_MULTIPLIER, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, fallback);
  return Math.max(min, parsed);
}

export function getDamageResistanceMultipliers(actor) {
  return {
    blunt: sanitizeDamageResistanceMultiplier(
      actor?.getFlag?.("peasant-core", PC_DAMAGE_RESISTANCE_BLUNT_MULTIPLIER_FLAG),
      PC_DEFAULT_DAMAGE_RESISTANCE_MULTIPLIER
    ),
    lethal: sanitizeDamageResistanceMultiplier(
      actor?.getFlag?.("peasant-core", PC_DAMAGE_RESISTANCE_LETHAL_MULTIPLIER_FLAG),
      PC_DEFAULT_DAMAGE_RESISTANCE_MULTIPLIER
    ),
    critical: sanitizeDamageResistanceMultiplier(
      actor?.getFlag?.("peasant-core", PC_DAMAGE_RESISTANCE_CRITICAL_MULTIPLIER_FLAG),
      PC_DEFAULT_DAMAGE_RESISTANCE_MULTIPLIER
    )
  };
}

export function applyDamageResistanceToCounts(counts, actor) {
  const multipliers = getDamageResistanceMultipliers(actor);
  const resist = (type) => {
    const count = Math.max(0, Number(counts?.[type]) || 0);
    return count > 0 && multipliers[type] > 0 ? Math.max(1, Math.floor(count * multipliers[type])) : 0;
  };
  return {
    critical: resist("critical"),
    lethal: resist("lethal"),
    blunt: resist("blunt")
  };
}

export function toSimplifiedHpDamageFromCounts(counts, hardLocation = false) {
  counts = {
    blunt: Math.max(0, Math.floor(Number(counts?.blunt) || 0)),
    lethal: Math.max(0, Math.floor(Number(counts?.lethal) || 0)),
    critical: Math.max(0, Math.floor(Number(counts?.critical) || 0))
  };
  if (hardLocation && counts.lethal > 0) {
    const convertedToBlunt = Math.floor(counts.lethal / 2);
    counts.lethal -= convertedToBlunt;
    counts.blunt += convertedToBlunt;
  }

  return (counts.blunt || 0) + ((counts.lethal || 0) * 2) + ((counts.critical || 0) * 4);
}

export function toSimplifiedHpDamageFromCountsWithResistance(counts, actor, hardLocation = false) {
  return toSimplifiedHpDamageFromCounts(applyDamageResistanceToCounts(counts, actor), hardLocation);
}

export function toSimplifiedHpDamage(amount, type, hardLocation = false) {
  const raw = Math.max(0, Number(amount) || 0);
  if (raw <= 0) return 0;
  return toSimplifiedHpDamageFromCounts(splitDamageCounts(raw, String(type || "").toLowerCase()), hardLocation);
}

export function toSimplifiedHpDamageWithResistance(amount, type, actor, hardLocation = false) {
  const raw = Math.max(0, Number(amount) || 0);
  if (raw <= 0) return 0;
  return toSimplifiedHpDamageFromCountsWithResistance(
    splitDamageCounts(raw, String(type || "").toLowerCase()),
    actor,
    hardLocation
  );
}

export function sumDamageCounts(counts) {
  return (counts?.critical || 0) + (counts?.lethal || 0) + (counts?.blunt || 0);
}

export function absorbTempHpFromCounts(counts, tempHp) {
  let remaining = { ...counts };
  let tempRemaining = Math.max(0, Number(tempHp) || 0);
  let tempUsed = 0;

  const absorb = (type, cost) => {
    if (tempRemaining <= 0 || remaining[type] <= 0) return;
    const canAbsorb = Math.min(remaining[type], Math.floor(tempRemaining / cost));
    if (canAbsorb > 0) {
      remaining[type] -= canAbsorb;
      tempRemaining -= canAbsorb * cost;
      tempUsed += canAbsorb * cost;
    }
    if (remaining[type] > 0 && tempRemaining > 0 && tempRemaining < cost) {
      remaining[type] -= 1;
      tempUsed += tempRemaining;
      tempRemaining = 0;
    }
  };

  absorb("critical", 4);
  absorb("lethal", 2);
  absorb("blunt", 1);

  return { remaining, tempRemaining, tempUsed };
}

export function absorbBolsteredFromCounts(counts, bolsteredHp) {
  let remaining = { ...counts };
  let bolsteredRemaining = Math.max(0, Number(bolsteredHp) || 0);
  let bolsteredUsed = 0;

  const absorb = (type) => {
    if (bolsteredRemaining <= 0 || remaining[type] <= 0) return;
    const use = Math.min(remaining[type], bolsteredRemaining);
    if (use > 0) {
      remaining[type] -= use;
      bolsteredRemaining -= use;
      bolsteredUsed += use;
    }
  };

  absorb("critical");
  absorb("lethal");
  absorb("blunt");

  return { remaining, bolsteredRemaining, bolsteredUsed };
}
