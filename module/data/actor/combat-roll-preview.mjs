import { applyToHitAccuracy } from "../../dice/roll-targets.mjs";

export function getNotableCombatRollPreview(actor, combat) {
  if (!actor || !combat) {
    return {
      allowToHitAcc: false,
      hasToHit: false,
      hasAccuracy: false,
      modifiedTohit: "",
      accuracyNum: 0,
      accuracySign: "+"
    };
  }

  const combatMods = actor.system?.combatMods || { toHit: 0, accuracy: 0 };
  const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
  const accuracyMod = Number.parseInt(combatMods.accuracy, 10) || 0;
  const baseAccuracy = Number.parseInt(combat.accuracy, 10) || 0;
  const baseTohit = Number.isFinite(Number.parseInt(combat.tohit, 10))
    ? Number.parseInt(combat.tohit, 10)
    : 7;
  const combatCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
  const accuracyNum = combatCalc.accuracy;
  const modifiedTohit = combatCalc.toHit;
  const isStandard = !combat.type || combat.type === "standard";
  const combatTypeKey = String(combat.type || "").trim().toLowerCase();
  const noToHitTypes = new Set(["stance", "perk", "style", "cantrip", "tm"]);
  const allowToHitAcc = isStandard || !noToHitTypes.has(combatTypeKey);

  return {
    allowToHitAcc,
    hasToHit: allowToHitAcc && !!combat.tohit,
    hasAccuracy: allowToHitAcc && (accuracyNum !== 0 || baseAccuracy !== 0),
    modifiedTohit,
    accuracyNum,
    accuracySign: accuracyNum >= 0 ? "+" : ""
  };
}
