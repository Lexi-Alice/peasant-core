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

export function buildAutomatedCombatDamageData(actor, combat, { appliedDamageType = null } = {}) {
  const combatName = combat.name || "Combat";
  const combatMods = actor.system?.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
  const diceRateMod = Number.parseInt(combatMods.diceRate, 10) || 0;
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
