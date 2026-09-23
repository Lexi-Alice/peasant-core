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

export function applyPeasantGridHealthMaxChanges(currentColumns, changes = []) {
  let columns = clampPeasantInteger(currentColumns, { min: 1 });
  const orderedChanges = [...changes].sort((left, right) =>
    (Number(left?.priority) || 0) - (Number(right?.priority) || 0)
  );
  for (const change of orderedChanges) {
    if (String(change?.key ?? "").trim() !== "system.health.max") continue;
    columns = clampPeasantInteger(
      applyPeasantNumericActiveEffectChange(columns, change?.value, change?.mode),
      { min: 1 }
    );
  }
  return columns;
}

export function mergePeasantGridHealthEffectUpdate(
  sourceGrid,
  changedGrid,
  { rows, sourceColumns, effectColumns }
) {
  const safeRows = clampPeasantInteger(rows, { min: 1 });
  const safeSourceColumns = clampPeasantInteger(sourceColumns, { min: 1 });
  const safeEffectColumns = clampPeasantInteger(effectColumns, { min: 1 });
  const storedColumns = Math.max(safeSourceColumns, safeEffectColumns);

  return Array.from({ length: safeRows }, (_, rowIndex) =>
    Array.from({ length: storedColumns }, (_, columnIndex) => {
      const grid = columnIndex < safeEffectColumns ? changedGrid : sourceGrid;
      return clampPeasantInteger(grid?.[rowIndex]?.[columnIndex], { min: 0, max: 3 });
    })
  );
}
