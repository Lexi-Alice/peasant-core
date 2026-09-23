export function evaluateCombatValueDice({
  dice = [],
  naturalDiceCount = 0,
  useStability = false,
  useStrengthen = false
} = {}) {
  const values = Array.isArray(dice) ? dice.map(Number).filter(Number.isFinite) : [];
  const allIndices = values.map((_, index) => index);
  if (!useStability) {
    return {
      adjustedDiceTotal: values.reduce((sum, value) => sum + value, 0),
      keptIndices: allIndices
    };
  }

  if (!useStrengthen) {
    return {
      adjustedDiceTotal: Math.floor(values.reduce((sum, value) => sum + value, 0) / 2),
      keptIndices: allIndices
    };
  }

  const keepCount = Math.min(Math.max(0, Number(naturalDiceCount) || 0), values.length);
  const keptIndices = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (b.value - a.value) || (a.index - b.index))
    .slice(0, keepCount)
    .map(({ index }) => index)
    .sort((a, b) => a - b);
  const keptIndexSet = new Set(keptIndices);
  return {
    adjustedDiceTotal: values.reduce((sum, value, index) => sum + (keptIndexSet.has(index) ? value : 0), 0),
    keptIndices
  };
}
