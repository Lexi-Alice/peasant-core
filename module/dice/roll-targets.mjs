// Clamp to-hit to a minimum, converting overflow from penalties into accuracy.
export function applyToHitFloor(baseToHit, toHitMod, minToHit = 2) {
  const base = Number.isFinite(baseToHit) ? baseToHit : 0;
  const mod = Number.isFinite(toHitMod) ? toHitMod : 0;
  const raw = base + mod;
  if (raw < minToHit) {
    return { toHit: minToHit, overflow: minToHit - raw };
  }
  return { toHit: raw, overflow: 0 };
}

export function applyToHitAccuracy(baseToHit, baseAccuracy, toHitMod, accuracyMod, minToHit = 2) {
  const baseAcc = Number.isFinite(baseAccuracy) ? baseAccuracy : 0;
  const accMod = Number.isFinite(accuracyMod) ? accuracyMod : 0;
  const { toHit, overflow } = applyToHitFloor(baseToHit, toHitMod, minToHit);
  return { toHit, accuracy: baseAcc + accMod + overflow, overflow };
}
