import { applyDieRate } from "../../dice/combat-dice.mjs";
import { getCombatFlatDamageModifier } from "./combat-modifiers.mjs";
import { normalizeAppliedDamageType } from "./targeted-damage.mjs";

export function getAutomatedCombatDamageTypeLabel(rawType) {
  const normalizedType = normalizeAppliedDamageType(rawType, "");
  switch (normalizedType) {
    case "blunt":
      return "Blunt";
    case "lethal":
      return "Lethal";
    case "critical":
      return "Critical";
    case "hybrid":
      return "Hybrid";
    case "flexible":
      return "Blunt or Lethal";
    default: {
      const fallback = String(rawType || "").trim();
      return fallback ? fallback.charAt(0).toUpperCase() + fallback.slice(1) : "";
    }
  }
}

export function countFilledHpDamageRows(actor) {
  const hp = actor?.system?.hp;
  const rows = Math.max(0, Number.parseInt(hp?.rows, 10) || 0);
  const cols = Math.max(0, Number.parseInt(hp?.cols, 10) || 0);
  const grid = Array.isArray(hp?.grid) ? hp.grid : [];
  if (rows <= 0 || cols <= 0 || grid.length === 0) return 0;

  let filledRows = 0;
  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    const row = Array.isArray(grid[rowIndex]) ? grid[rowIndex] : [];
    let filled = row.length >= cols;
    for (let colIndex = 0; colIndex < cols; colIndex++) {
      if ((Number.parseInt(row[colIndex], 10) || 0) <= 0) {
        filled = false;
        break;
      }
    }
    if (filled) filledRows += 1;
  }

  return filledRows;
}

export function getCombatDesperateDieRateModifier(actor, combat) {
  const value = Number.parseInt(combat?.desperate, 10) || 0;
  if (value === 0) return { value, filledRows: 0, modifier: 0 };

  const filledRows = countFilledHpDamageRows(actor);
  return {
    value,
    filledRows,
    modifier: value * filledRows
  };
}

export function buildAutomatedCombatDamageData(actor, combat, { appliedDamageType = null } = {}) {
  const combatName = combat.name || "Combat";
  const combatMods = actor.system?.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
  const baseDiceRateMod = Number.parseInt(combatMods.diceRate, 10) || 0;
  const desperate = getCombatDesperateDieRateModifier(actor, combat);
  const diceRateMod = baseDiceRateMod + desperate.modifier;
  const flatDamageMod = getCombatFlatDamageModifier(combatMods);

  const result = applyDieRate(
    combat.damage.diceCount || 0,
    combat.damage.diceValue || 0,
    combat.damage.flat || 0,
    diceRateMod,
    combat.damage.diceBonus || 0
  );

  let diceCount = Number(result.diceCount) || 0;
  let diceValue = Number(result.diceValue) || 0;
  let flat = (Number(result.flat) || 0) + flatDamageMod;
  const naturalDiceCount = diceCount;
  const useStability = !!combat.stability;
  const useStrengthen = useStability && !!combat.strengthen;
  const rolledDiceCount = useStability ? (naturalDiceCount * 2) : naturalDiceCount;

  let formula = "";
  if (rolledDiceCount > 0 && diceValue > 0) formula = `${rolledDiceCount}d${diceValue}`;
  if (flat !== 0 || !formula) {
    const flatText = `${flat}`;
    formula = formula
      ? `${formula}${flat >= 0 ? "+" : ""}${flatText}`
      : flatText;
  }

  let previewFormula = formula || "0";
  if (useStrengthen && naturalDiceCount > 0) previewFormula = `${previewFormula} keep highest ${naturalDiceCount}`;
  else if (useStability && naturalDiceCount > 0) previewFormula = `${previewFormula} / 2`;

  const resolvedTypeLabel = getAutomatedCombatDamageTypeLabel(appliedDamageType || combat?.damage?.type);

  return {
    combatName,
    combatMods,
    baseDiceRateMod,
    desperateValue: desperate.value,
    desperateFilledRows: desperate.filledRows,
    desperateDieRateMod: desperate.modifier,
    diceRateMod,
    flatDamageMod,
    diceCount,
    diceValue,
    flat,
    naturalDiceCount,
    rolledDiceCount,
    useStability,
    useStrengthen,
    previewFormula,
    previewText: resolvedTypeLabel ? `${previewFormula} ${resolvedTypeLabel}` : previewFormula,
    typeLabel: resolvedTypeLabel,
    normalizedType: normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt")
  };
}

export function getAutomatedCombatDamagePreview(actor, combat, { appliedDamageType = null } = {}) {
  if (!actor || !combat?.damage) return "";
  return buildAutomatedCombatDamageData(actor, combat, { appliedDamageType }).previewText;
}
