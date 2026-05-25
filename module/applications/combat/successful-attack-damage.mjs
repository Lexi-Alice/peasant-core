import { getCombatDefenseResponseKey, normalizeCombatDefense } from "../../data/actor/combat-defense.mjs";
import { getAutomatedCombatDamagePreview, getAutomatedCombatDamageTypeLabel } from "../../data/actor/combat-damage.mjs";
import { getCombatMagnetismGrade } from "../../data/actor/combat-tags.mjs";
import { isMageDefenseDamageRedirect, isShieldDefenseDamageBlock, isWeaponDefenseDamageBlock } from "../../data/actor/defense-results.mjs";
import {
  getTargetedDamageLocationDisplay,
  normalizeAppliedDamageType
} from "../../data/actor/targeted-damage.mjs";
import { resolveAttackLocationForTarget } from "./attack-locations.mjs";
import { rollAutomatedCombatDamage } from "./automated-damage-rolls.mjs";
import { requestIncomingHitApplicationForTarget, requestIncomingHitResolutionForTarget } from "./incoming-hit.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";

function getWeaponMasteryMagnetismGrade(combat, defensePromptResult, { requireMelee = false } = {}) {
  const baseGrade = getCombatMagnetismGrade(combat);
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  const isMelee = getCombatDefenseResponseKey(combat?.targetingType) === "melee";
  const defensePassed = !!defensePromptResult?.defenseRoll?.rollResult?.isSuccess;
  const masteryApplies = !!(
    defensePromptResult?.selection === "defense"
    && defense.block
    && defense.blockType === "Weapon"
    && defense.masteryBonus
    && defensePassed
    && (!requireMelee || isMelee)
  );
  return masteryApplies ? Math.max(baseGrade, 1) : baseGrade;
}

function createWeaponBlockLocationRoll() {
  return {
    rawText: "Weapon Block",
    location: "",
    locationDisplay: "Weapon Block",
    isAP: false,
    byWeaponBlock: true
  };
}

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
  const shieldBlockFailure = isShieldDefenseDamageBlock(attackRoll, defensePromptResult);
  const weaponBlockFailure = isWeaponDefenseDamageBlock(attackRoll, defensePromptResult);
  if (!attackRoll?.rollResult?.isSuccess && !mageBlockFailure && !shieldBlockFailure && !weaponBlockFailure) {
    return null;
  }

  const targetLabel = target?.targetName || target?.actor?.name || "";
  if (shieldBlockFailure) {
    const shieldDefense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
    const locationRoll = {
      rawText: `${getTargetedDamageLocationDisplay(shieldDefense.shieldArm)} Shield Block`,
      location: shieldDefense.shieldArm,
      locationDisplay: getTargetedDamageLocationDisplay(shieldDefense.shieldArm),
      isAP: false,
      byShieldBlock: true
    };
    const resolvedDamageType = normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt");

    const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
      targetLabel,
      attackerToken,
      appliedDamageType: resolvedDamageType
    });
    if (!damageRoll || !Number.isFinite(Number(damageRoll.total)) || Number(damageRoll.total) <= 0) {
      return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, shieldBlockFailure: true };
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
      damageAmountOverride: Number(damageRoll.total) || 0,
      ignoreHaltReduction: true,
      shieldBlock: {
        selectedCombatIndex: defensePromptResult?.selectedCombatIndex,
        selectedDefense: shieldDefense,
        braced: !!defensePromptResult?.shieldBlockBraced
      }
    });

    return {
      handled: true,
      shieldBlockFailure: true,
      braced: !!defensePromptResult?.shieldBlockBraced,
      locationRoll,
      damageRoll,
      application
    };
  }

  if (weaponBlockFailure) {
    const weaponDefense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
    const resolvedDamageType = normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt");

    const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
      targetLabel,
      attackerToken,
      appliedDamageType: resolvedDamageType
    });
    if (!damageRoll || !Number.isFinite(Number(damageRoll.total)) || Number(damageRoll.total) <= 0) {
      return { handled: false, reason: "noDamageRolled", damageRoll, weaponBlockFailure: true };
    }

    const originalDamageAmount = Number(damageRoll.total) || 0;
    const weaponHp = Math.max(0, Number.parseInt(weaponDefense.hp, 10) || 0);
    const weaponOverflowDamage = Math.max(0, originalDamageAmount - weaponHp);
    let locationRoll = createWeaponBlockLocationRoll();

    if (weaponOverflowDamage > 0) {
      const preDefenseMoS = Number(attackRoll?.rollResult?.preDefenseTotalMoS);
      locationRoll = await resolveAttackLocationForTarget({
        actor,
        attackerToken,
        combat,
        target,
        attackRoll,
        defensePromptResult,
        magnetismGrade: getWeaponMasteryMagnetismGrade(combat, defensePromptResult),
        locationMoS: Number.isFinite(preDefenseMoS) ? preDefenseMoS : null
      });
      if (isChainCancelledResult(locationRoll)) {
        return { handled: false, chainCancelled: true, reason: "locationPromptClosed", damageRoll };
      }
      if (!locationRoll) return { handled: false, reason: "locationUnavailable", damageRoll };
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
      damageAmountOverride: weaponOverflowDamage,
      weaponBlock: {
        selectedCombatIndex: defensePromptResult?.selectedCombatIndex,
        selectedDefense: weaponDefense,
        originalDamageAmount,
        masteryBonus: !!weaponDefense.masteryBonus,
        magnetismGrade: getWeaponMasteryMagnetismGrade(combat, defensePromptResult)
      }
    });

    return {
      handled: true,
      weaponBlockFailure: true,
      damageRoll,
      locationRoll,
      originalDamageAmount,
      weaponHp,
      weaponOverflowDamage,
      application
    };
  }

  if (mageBlockFailure) {
    const mageDefense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
    const locationRoll = {
      rawText: "Mage Block Overflow",
      location: "",
      locationDisplay: "Mage Block Overflow",
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
      ignoreHaltReduction: true,
      locationlessDamage: true
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
    defensePromptResult,
    magnetismGrade: getWeaponMasteryMagnetismGrade(combat, defensePromptResult, { requireMelee: true })
  });
  if (isChainCancelledResult(locationRoll)) {
    return { handled: false, chainCancelled: true, reason: "locationPromptClosed" };
  }
  if (!locationRoll) return { handled: false, reason: "locationUnavailable" };

  const damagePreview = getAutomatedCombatDamagePreview(actor, combat, { appliedDamageType });
  const overkill = !!combat?.overkill;
  const resolution = overkill
    ? {
        handled: true,
        useArmorCharge: false,
        appliedDamageType: normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt"),
        overkill: true
      }
    : await requestIncomingHitResolutionForTarget({
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
    incomingHitResolution: resolution,
    ignoreHaltReduction: overkill
  });

  return {
    handled: true,
    locationRoll,
    damageRoll,
    resolution,
    application
  };
}
