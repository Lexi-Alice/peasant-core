export async function applyCombatStressDamageForActor(actor, stressType, amount) {
  const countField = `${stressType}StressCount`;
  const maxBoxes = actor?.system?.[countField] || 0;
  let remaining = amount;
  const updates = {};

  const stressState = [];
  for (let i = 0; i < maxBoxes; i++) {
    const fieldName = `${stressType}${i}`;
    stressState.push({ field: fieldName, value: actor.system?.[fieldName] || 0 });
  }

  for (let pass = 0; pass < 3 && remaining > 0; pass++) {
    const targetValue = pass;
    for (let i = 0; i < stressState.length && remaining > 0; i++) {
      if (stressState[i].value !== targetValue) continue;
      stressState[i].value = targetValue + 1;
      updates[`system.${stressState[i].field}`] = targetValue + 1;
      remaining--;
    }
  }

  if (Object.keys(updates).length > 0) {
    await actor.update(updates);
  }

  return remaining;
}

export function getStressTrackRemainingCapacity(actor, stressType) {
  if (!actor || !stressType) return 0;
  const countField = `${stressType}StressCount`;
  const maxBoxes = Math.max(0, Number(actor.system?.[countField]) || 0);
  let remainingCapacity = 0;
  for (let i = 0; i < maxBoxes; i += 1) {
    const fieldName = `${stressType}${i}`;
    const currentValue = Math.max(0, Number(actor.system?.[fieldName]) || 0);
    remainingCapacity += Math.max(0, 3 - currentValue);
  }
  return remainingCapacity;
}

export function getStressCapacityForSpendType(actor, spendType) {
  const normalized = String(spendType || "").trim().toLowerCase();
  if (normalized === "general") {
    return getStressTrackRemainingCapacity(actor, "general");
  }
  if (normalized === "physical" || normalized === "mental") {
    return getStressTrackRemainingCapacity(actor, normalized) + getStressTrackRemainingCapacity(actor, "general");
  }
  return 0;
}

export async function spendStressForForcePass(actor, spendType, amount) {
  const normalized = String(spendType || "").trim().toLowerCase();
  const stressAmount = Math.max(0, Number(amount) || 0);
  if (!actor || !stressAmount) {
    return { ok: false, spent: 0, overflow: stressAmount, spendType: normalized };
  }

  if (normalized === "general") {
    const overflow = await applyCombatStressDamageForActor(actor, "general", stressAmount);
    return { ok: overflow <= 0, spent: stressAmount - overflow, overflow, spendType: normalized };
  }

  if (normalized === "physical" || normalized === "mental") {
    let remaining = await applyCombatStressDamageForActor(actor, normalized, stressAmount);
    if (remaining > 0) {
      remaining = await applyCombatStressDamageForActor(actor, "general", remaining);
    }
    return { ok: remaining <= 0, spent: stressAmount - remaining, overflow: remaining, spendType: normalized };
  }

  return { ok: false, spent: 0, overflow: stressAmount, spendType: normalized };
}

export function getForcePassSpendTypeLabel(spendType) {
  switch (String(spendType || "").trim().toLowerCase()) {
    case "physical":
      return "Physical Stress";
    case "mental":
      return "Mental Stress";
    case "general":
    default:
      return "General Stress";
  }
}

export function getPreAccuracyMoSFromRollResult(rollResult) {
  if (!rollResult) return null;
  const baseMoS = Number.isFinite(Number(rollResult.baseMoS))
    ? Number(rollResult.baseMoS)
    : (
      Number.isFinite(Number(rollResult.initialTotal))
      && Number.isFinite(Number(rollResult.toHit))
    )
      ? (Number(rollResult.initialTotal) - Number(rollResult.toHit)) * 0.25
      : null;
  const criticalMoS = Number.isFinite(Number(rollResult.criticalMoS))
    ? Number(rollResult.criticalMoS)
    : 0;
  if (!Number.isFinite(baseMoS)) return null;
  return baseMoS + criticalMoS;
}

export function getForcePassStressCostFromRollResult(rollResult) {
  const preAccuracyMoS = getPreAccuracyMoSFromRollResult(rollResult);
  if (!Number.isFinite(preAccuracyMoS) || preAccuracyMoS >= 0) return 0;
  return Math.max(1, Math.round(Math.abs(preAccuracyMoS) / 0.25));
}
