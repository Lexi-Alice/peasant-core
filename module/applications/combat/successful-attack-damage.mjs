import { getCombatDefenseResponseKey, normalizeCombatDefense } from "../../data/actor/combat-defense.mjs";
import { getAutomatedCombatDamagePreview, getAutomatedCombatDamageTypeLabel } from "../../data/actor/combat-damage.mjs";
import { getCombatMagnetismGrade, getCombatTargetingType } from "../../data/actor/combat-tags.mjs";
import {
  doesPromptResultCountAsActiveDefense,
  isMageDefenseDamageRedirect,
  isNarrowSuccessAttack,
  isShieldDefenseDamageBlock,
  isWeaponDefenseDamageBlock
} from "../../data/actor/defense-results.mjs";
import {
  getHighestHaltDamageLocation,
  getLowestHaltDamageLocation,
  getTargetedDamageLocationDisplay,
  normalizeAppliedDamageType
} from "../../data/actor/targeted-damage.mjs";
import { rollAoeReflexSaveForTarget } from "./aoe-reflex-save.mjs";
import { resolveAttackLocationForTarget } from "./attack-locations.mjs";
import { rollAutomatedCombatDamage } from "./automated-damage-rolls.mjs";
import { requestIncomingHitApplicationForTarget, requestIncomingHitResolutionForTarget } from "./incoming-hit.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";

function getWeaponMasteryMagnetismGrade(combat, defensePromptResult, { requireMelee = false } = {}) {
  const baseGrade = getCombatMagnetismGrade(combat);
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  const isMelee = getCombatDefenseResponseKey(getCombatTargetingType(combat)) === "melee";
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

function createAreaDamageLocationRoll(targetingType, location = "Torso") {
  const label = String(targetingType || "AoE").trim() || "AoE";
  return {
    rawText: label,
    location,
    locationDisplay: label,
    isAP: false,
    byAoe: true
  };
}

function isAreaDamageTargetingKey(targetingKey) {
  return ["aoe", "areaBlast", "tileBlast"].includes(targetingKey);
}

function getAreaDamageHaltLocation(targetActor, targetingKey) {
  if (targetingKey === "areaBlast") return getLowestHaltDamageLocation(targetActor);
  return getHighestHaltDamageLocation(targetActor);
}

function isGlancingSuccessAttack(attackRoll) {
  const rollResult = attackRoll?.rollResult;
  if (!rollResult || typeof rollResult !== "object") return false;
  if (String(rollResult.resultText || "").trim() === "Glancing Success") return true;

  const baseMoS = Number(rollResult.baseMoS);
  const totalMoS = Number(rollResult.totalMoS);
  return !!(
    rollResult.isSuccess
    && !String(rollResult.criticalType || "").trim()
    && Number.isFinite(baseMoS)
    && Number.isFinite(totalMoS)
    && baseMoS < 0
    && totalMoS >= 0
  );
}

function getAppliedDamageRollTotal(damageRoll) {
  const displayTotal = Number(damageRoll?.displayTotal);
  if (Number.isFinite(displayTotal)) return displayTotal;

  const total = Number(damageRoll?.total);
  return Number.isFinite(total) ? total : 0;
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

  const targetingType = getCombatTargetingType(combat);
  const targetingKey = getCombatDefenseResponseKey(targetingType);
  if (!combat?.damage) return null;

  const mageBlockFailure = isMageDefenseDamageRedirect(attackRoll, defensePromptResult);
  const shieldBlockFailure = isShieldDefenseDamageBlock(attackRoll, defensePromptResult);
  const weaponBlockFailure = isWeaponDefenseDamageBlock(attackRoll, defensePromptResult);
  const narrowSuccessWithoutDefense = isNarrowSuccessAttack(attackRoll)
    && !doesPromptResultCountAsActiveDefense(defensePromptResult);
  const halveDamageForGlance = isGlancingSuccessAttack(attackRoll);
  if (
    !attackRoll?.rollResult?.isSuccess
    && !narrowSuccessWithoutDefense
    && !mageBlockFailure
    && !shieldBlockFailure
    && !weaponBlockFailure
  ) {
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
      appliedDamageType: resolvedDamageType,
      halveDamageForGlance
    });
    const damageAmount = getAppliedDamageRollTotal(damageRoll);
    if (!damageRoll || damageAmount <= 0) {
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
      damageAmountOverride: damageAmount,
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
      appliedDamageType: resolvedDamageType,
      halveDamageForGlance
    });
    const damageAmount = getAppliedDamageRollTotal(damageRoll);
    if (!damageRoll || damageAmount <= 0) {
      return { handled: false, reason: "noDamageRolled", damageRoll, weaponBlockFailure: true };
    }

    const originalDamageAmount = damageAmount;
    const weaponHardness = Math.max(0, Number.parseInt(weaponDefense.hardness, 10) || 0);
    const weaponOverflowDamage = Math.max(0, originalDamageAmount - weaponHardness);
    let locationRoll = createWeaponBlockLocationRoll();

    if (weaponOverflowDamage > 0) {
      locationRoll = await resolveAttackLocationForTarget({
        actor,
        attackerToken,
        combat,
        target,
        attackRoll,
        defensePromptResult,
        magnetismGrade: getWeaponMasteryMagnetismGrade(combat, defensePromptResult)
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
      weaponHardness,
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
      appliedDamageType: resolvedDamageType,
      halveDamageForGlance
    });
    const damageAmount = getAppliedDamageRollTotal(damageRoll);
    if (!damageRoll || damageAmount <= 0) {
      return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, mageBlockFailure: true };
    }

    const absorbedByMage = Math.max(0, Number(mageDefense.hp) || 0);
    const redirectedDamage = Math.max(0, damageAmount - absorbedByMage);
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

  if (isAreaDamageTargetingKey(targetingKey)) {
    const areaDamageLocation = getAreaDamageHaltLocation(target?.actor || null, targetingKey);
    const locationRoll = createAreaDamageLocationRoll(targetingType, areaDamageLocation);
    const resolvedDamageType = normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt");
    const reflexSaveResult = targetingKey === "aoe"
      ? (defensePromptResult?.selection === "reflexSave" ? defensePromptResult.reflexSaveResult : null)
      : await rollAoeReflexSaveForTarget({ target, targetingType });
    const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
      targetLabel,
      attackerToken,
      appliedDamageType: resolvedDamageType,
      aoeReflexSaveResult: reflexSaveResult,
      halveDamageForGlance
    });
    if (!damageRoll || !Number.isFinite(Number(damageRoll.total)) || Number(damageRoll.total) <= 0) {
      return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, reflexSaveResult, aoe: true };
    }

    const baseDamageAmount = Number(damageRoll.total) || 0;
    const resolvedDamageAmount = getAppliedDamageRollTotal(damageRoll);
    if (resolvedDamageAmount <= 0) {
      const reducedDamageReason = reflexSaveResult?.passed
        ? "reflexSaveReducedDamageToZero"
        : (halveDamageForGlance ? "glanceReducedDamageToZero" : "damageReducedToZero");
      return {
        handled: true,
        aoe: true,
        locationRoll,
        damageRoll,
        reflexSaveResult,
        baseDamageAmount,
        resolvedDamageAmount,
        application: { handled: true, applied: false, reason: reducedDamageReason }
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
      damageAmountOverride: resolvedDamageAmount,
      ignoreHaltReduction: false,
      locationlessDamage: false,
      woundLocation: "Torso",
      suppressLocationBreaks: true
    });

    return {
      handled: true,
      aoe: true,
      locationRoll,
      damageRoll,
      reflexSaveResult,
      baseDamageAmount,
      resolvedDamageAmount,
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
    appliedDamageType: resolvedDamageType,
    halveDamageForGlance
  });
  const damageAmount = getAppliedDamageRollTotal(damageRoll);
  if (!damageRoll || damageAmount <= 0) {
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
    damageAmountOverride: damageAmount,
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
