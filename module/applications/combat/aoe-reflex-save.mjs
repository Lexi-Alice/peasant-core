import { computeBaseSaves } from "../../data/actor/attributes.mjs";
import { parseOptionalInteger } from "../../data/actor/helpers.mjs";
import { PC_SAVE_MODIFIER_FLAG } from "../../data/actor/sheet-settings.mjs";
import { applyToHitFloor } from "../../dice/roll-targets.mjs";
import { performSavingRoll } from "../../dice/rolls.mjs";
import { getArmorAdjustedAoeSaveTarget, getEquippedArmorEffects } from "../../data/actor/equipped-armor.mjs";
import { getActorRollSpeaker } from "./actor-targets.mjs";

export function getActorAoeReflexSaveTn(actor) {
  const equippedArmor = getEquippedArmorEffects(actor);
  const aoeSaveTarget = parseOptionalInteger(actor?.system?.reflexAoeSaveTarget, { min: 1 });
  if (actor?.system?.reflexAoeSaveEnabled && aoeSaveTarget !== null) {
    return getArmorAdjustedAoeSaveTarget(aoeSaveTarget, equippedArmor);
  }

  const combatMods = actor?.system?.combatMods || { toHit: 0 };
  const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
  const saveConfigModRaw = Number(actor?.getFlag?.("peasant-core", PC_SAVE_MODIFIER_FLAG));
  const saveConfigMod = Number.isFinite(saveConfigModRaw) ? Math.trunc(saveConfigModRaw) : 0;
  const baseSaves = computeBaseSaves(actor?.system || {});
  const baseTn = Number.isFinite(baseSaves.reflex) ? baseSaves.reflex : 7;
  const reflexSaveTarget = applyToHitFloor(baseTn, toHitMod + saveConfigMod, 2).toHit;
  return getArmorAdjustedAoeSaveTarget(reflexSaveTarget, equippedArmor);
}

export async function rollAoeReflexSaveForTarget({
  target = null,
  targetActor = null,
  targetToken = null,
  targetingType = "AoE"
} = {}) {
  const actor = targetActor || target?.actor || null;
  if (!actor) return null;
  if (getEquippedArmorEffects(actor).aoeAutoFail) {
    return { toHit: null, rollResult: null, passed: false, automaticFailure: true };
  }

  const token = targetToken || target?.token || target?.tokenDocument || null;
  const toHit = getActorAoeReflexSaveTn(actor);
  const label = String(targetingType || "AoE").trim() || "AoE";
  const rollResult = await performSavingRoll({
    actor,
    toHit,
    skillName: `${label} Reflex Save`,
    speaker: getActorRollSpeaker(actor, token)
  });

  return {
    toHit,
    rollResult,
    passed: !!rollResult?.isSuccess
  };
}
