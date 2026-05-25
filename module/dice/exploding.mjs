export async function rollExplodingD6() {
  const roll = await new Roll("1d6").evaluate();
  const value = Number(roll.dice?.[0]?.results?.[0]?.result ?? roll.total ?? 0);
  if (value === 6) return [value, ...await rollExplodingD6()];
  return [value];
}

export async function rollPeasantCriticalExplosion(dice) {
  const first = Number(dice?.[0]);
  const second = Number(dice?.[1]);
  const isCriticalSuccess = first === 6 && second === 6;
  const isCriticalFailure = first === 1 && second === 1;
  if (!isCriticalSuccess && !isCriticalFailure) {
    return {
      isCritical: false,
      type: null,
      label: null,
      sign: 0,
      dice: [],
      total: 0,
      mos: 0
    };
  }

  const extraDice = await rollExplodingD6();
  const sign = isCriticalSuccess ? 1 : -1;
  const total = extraDice.reduce((sum, value) => sum + value, 0);
  return {
    isCritical: true,
    type: isCriticalSuccess ? "success" : "failure",
    label: isCriticalSuccess ? "Critical Success" : "Critical Failure",
    sign,
    dice: extraDice,
    total,
    mos: sign * total * 0.25
  };
}
