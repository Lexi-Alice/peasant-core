export function parseCombatDiceValue(rawDiceValue, rawDiceBonus = 0) {
  const text = String(rawDiceValue ?? "").trim();
  const match = text.match(/^(\d+)(?:\s*\+\s*(\d+))?$/);
  const diceValue = match
    ? (Number.parseInt(match[1], 10) || 0)
    : (Number.parseInt(rawDiceValue, 10) || 0);
  const embeddedBonus = match?.[2] ? (Number.parseInt(match[2], 10) || 0) : 0;
  const explicitBonus = Number.parseInt(rawDiceBonus, 10) || 0;
  return { diceValue, diceBonus: explicitBonus || embeddedBonus };
}

export function formatCombatDiceValue(rawDiceValue, rawDiceBonus = 0) {
  const { diceValue, diceBonus } = parseCombatDiceValue(rawDiceValue, rawDiceBonus);
  if (diceValue <= 0) return "";
  return diceBonus > 0 ? `${diceValue}+${diceBonus}` : `${diceValue}`;
}

export function hasCombatDice(rollData) {
  if (!rollData) return false;
  const diceCount = Number.parseInt(rollData.diceCount, 10) || 0;
  const { diceValue } = parseCombatDiceValue(rollData.diceValue, rollData.diceBonus);
  return diceCount > 0 && diceValue > 0;
}

/**
 * Die-rate progression: 1d6, 1d8, 1d10, 1d10+1, 2d6, 2d8, 2d10,
 * 2d10+1, 2d10+2, 4d6, 4d8, 4d10, 4d10+1, and so on.
 */
export function applyDieRate(baseDiceCount, baseDiceValue, baseFlat, dieRateMod, baseDiceBonus = 0) {
  const parsedDiceCount = Number.parseInt(baseDiceCount, 10) || 0;
  const { diceValue: parsedDiceValue, diceBonus: parsedDiceBonus } = parseCombatDiceValue(baseDiceValue, baseDiceBonus);
  const flat = Number.parseInt(baseFlat, 10) || 0;
  const rateMod = Number.parseInt(dieRateMod, 10) || 0;
  if (rateMod === 0 || parsedDiceCount <= 0 || parsedDiceValue <= 0) {
    return { diceCount: parsedDiceCount, diceValue: parsedDiceValue, flat: flat + parsedDiceBonus };
  }

  const diceCount = Math.max(1, parsedDiceCount);
  const diceValue = parsedDiceValue;
  const diceValueToStep = { 6: 0, 8: 1, 10: 2 };
  const stepToDiceValue = { 0: 6, 1: 8, 2: 10 };

  let bandDiceCount = 1;
  let bandIndex = 0;
  while (bandDiceCount * 2 <= diceCount) {
    bandDiceCount *= 2;
    bandIndex += 1;
  }

  let progressionFlat = 0;
  let extraFlat = flat + parsedDiceBonus;
  if (diceValue === 10 && parsedDiceBonus > 0) {
    progressionFlat = Math.min(parsedDiceBonus, bandDiceCount);
    extraFlat = flat + Math.max(0, parsedDiceBonus - progressionFlat);
  }

  const baseStep = (diceValueToStep[diceValue] ?? 0) + progressionFlat;
  let absolutePosition = (bandDiceCount - 1) + (bandIndex * 3) + baseStep + rateMod;
  if (absolutePosition < 0) absolutePosition = 0;

  let newDiceCount = 1;
  let remainingPosition = absolutePosition;
  while (remainingPosition >= newDiceCount + 3) {
    remainingPosition -= newDiceCount + 3;
    newDiceCount *= 2;
  }

  let newDiceValue;
  let newProgressionFlat = 0;
  if (remainingPosition <= 2) {
    newDiceValue = stepToDiceValue[remainingPosition];
  } else {
    newDiceValue = 10;
    newProgressionFlat = remainingPosition - 2;
  }

  return { diceCount: newDiceCount, diceValue: newDiceValue, flat: extraFlat + newProgressionFlat };
}
