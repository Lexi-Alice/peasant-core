function getActiveEffectModes() {
  return globalThis.CONST?.ACTIVE_EFFECT_MODES ?? {};
}

export function parsePeasantActiveEffectNumber(rawValue, fallback = 0) {
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

export function applyPeasantNumericActiveEffectChange(current, rawValue, mode) {
  const modes = getActiveEffectModes();
  const currentValue = parsePeasantActiveEffectNumber(current);
  const changeValue = parsePeasantActiveEffectNumber(rawValue);
  const changeMode = Number(mode);

  switch (changeMode) {
    case modes.MULTIPLY ?? 1:
      return currentValue * changeValue;
    case modes.ADD ?? 2:
      return currentValue + changeValue;
    case modes.DOWNGRADE ?? 3:
      return Math.min(currentValue, changeValue);
    case modes.UPGRADE ?? 4:
      return Math.max(currentValue, changeValue);
    case modes.OVERRIDE ?? 5:
    case modes.CUSTOM ?? 0:
    default:
      return changeValue;
  }
}

export function clampPeasantInteger(value, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.floor(parsed) : 0;
  return Math.max(min, Math.min(number, max));
}
