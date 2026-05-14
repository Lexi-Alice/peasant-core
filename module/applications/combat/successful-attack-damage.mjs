import { getCombatDefenseResponseKey, normalizeCombatDefense } from "../../data/actor/combat-defense.mjs";
import { getAutomatedCombatDamagePreview, getAutomatedCombatDamageTypeLabel } from "../../data/actor/combat-damage.mjs";
import { isMageDefenseDamageRedirect } from "../../data/actor/defense-results.mjs";
import {
  getLowestHaltDamageLocation,
  getTargetedDamageLocationDisplay,
  normalizeAppliedDamageType
} from "../../data/actor/targeted-damage.mjs";
import { resolveAttackLocationForTarget } from "./attack-locations.mjs";
import { rollAutomatedCombatDamage } from "./automated-damage-rolls.mjs";
import { requestIncomingHitApplicationForTarget, requestIncomingHitResolutionForTarget } from "./incoming-hit.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";

export async function resolveSuccessfulAttackDamageForTarget({
  actor = null,
  attackerToken = null,
  combat = null,
  target = null,
  attackRoll = null,
  defensePromptResult = null,
  appliedDamageType = null
} = {}) {
  if (!actor || !combat || !target) {
    return null;
  }

  const targetingKey = getCombatDefenseResponseKey(combat?.targetingType);
  if (targetingKey === "aoe") return null;
  if (!combat?.damage) return null;

  const mageBlockFailure = isMageDefenseDamageRedirect(attackRoll, defensePromptResult);
  if (!attackRoll?.rollResult?.isSuccess && !mageBlockFailure) {
    return null;
  }

  const targetLabel = target?.targetName || target?.actor?.name || "";
  if (mageBlockFailure) {
    const mageDefense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
    const location = getLowestHaltDamageLocation(target?.actor);
    const locationRoll = {
      rawText: getTargetedDamageLocationDisplay(location),
      location,
      locationDisplay: getTargetedDamageLocationDisplay(location),
      isAP: false,
      byMageBlock: true
    };

    const resolvedDamageType = normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt");

    const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
      targetLabel,
      attackerToken,
      appliedDamageType: resolvedDamageType
    });
    if (!damageRoll || !Number.isFinite(Number(damageRoll.total)) || Number(damageRoll.total) <= 0) {
      return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, mageBlockFailure: true };
    }

    const absorbedByMage = Math.max(0, Number(mageDefense.hp) || 0);
    const redirectedDamage = Math.max(0, (Number(damageRoll.total) || 0) - absorbedByMage);
    if (redirectedDamage <= 0) {
      return {
        handled: true,
        mageBlockFailure: true,
        locationRoll,
        damageRoll,
        absorbedByMage,
        redirectedDamage,
        application: { handled: true, applied: false, reason: "mageBlockAbsorbedAllDamage" }
      };
    }

    const application = await requestIncomingHitApplicationForTarget({
      target,
      attackerActor: actor,
      attackerToken,
      combat,
      damageRoll,
      locationRoll,
      incomingHitResolution: {
        useArmorCharge: false,
        appliedDamageType: resolvedDamageType
      },
      damageAmountOverride: redirectedDamage,
      ignoreHaltReduction: true
    });

    return {
      handled: true,
      mageBlockFailure: true,
      locationRoll,
      damageRoll,
      absorbedByMage,
      redirectedDamage,
      application
    };
  }

  const locationRoll = await resolveAttackLocationForTarget({
    actor,
    attackerToken,
    combat,
    target,
    attackRoll,
    defensePromptResult
  });
  if (isChainCancelledResult(locationRoll)) {
    return { handled: false, chainCancelled: true, reason: "locationPromptClosed" };
  }
  if (!locationRoll) return { handled: false, reason: "locationUnavailable" };

  const damagePreview = getAutomatedCombatDamagePreview(actor, combat, { appliedDamageType });
  const resolution = await requestIncomingHitResolutionForTarget({
    target,
    attackerActor: actor,
    attackerToken,
    combat,
    locationRoll,
    damagePreview,
    damageType: String(appliedDamageType || combat?.damage?.type || "").trim(),
    damageTypeLabel: getAutomatedCombatDamageTypeLabel(appliedDamageType || combat?.damage?.type)
  });
  if (isChainCancelledResult(resolution)) {
    return { handled: false, chainCancelled: true, reason: "incomingHitPromptClosed", locationRoll, resolution };
  }

  const resolvedDamageType = normalizeAppliedDamageType(resolution?.appliedDamageType || appliedDamageType || combat?.damage?.type, "blunt");

  const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
    targetLabel,
    attackerToken,
    appliedDamageType: resolvedDamageType
  });
  if (!damageRoll || !Number.isFinite(Number(damageRoll.total)) || Number(damageRoll.total) <= 0) {
    return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, resolution };
  }

  const application = await requestIncomingHitApplicationForTarget({
    target,
    attackerActor: actor,
    attackerToken,
    combat,
    damageRoll,
    locationRoll,
    incomingHitResolution: resolution
  });

  return {
    handled: true,
    locationRoll,
    damageRoll,
    resolution,
    application
  };
}
