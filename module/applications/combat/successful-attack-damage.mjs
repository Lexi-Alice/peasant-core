import { getCombatDefenseResponseKey, normalizeCombatDefense } from "../../data/actor/combat-defense.mjs";
import { getAutomatedCombatDamagePreview, getAutomatedCombatDamageTypeLabel } from "../../data/actor/combat-damage.mjs";
import { getCombatTargetingType } from "../../data/actor/combat-tags.mjs";
import { hasCombatDice } from "../../dice/combat-dice.mjs";
import { isSkillTagAutoEligible } from "../../data/actor/skill-entry-conditions.mjs";
import { getManifestSpellEffectState } from "../../data/active-effect/spell-effect-change-keys.mjs";
import { findActiveSpellEffectInCategory } from "../../data/active-effect/spell-effects.mjs";
import {
  doesAttackReachManifestDome,
  doesPromptResultCountAsActiveDefense,
  getPostDomeMagnetismGrade,
  getWeaponMasteryMagnetismGrade,
  isConfirmedManifestDomeResult,
  isMageDefenseDamageRedirect,
  isNarrowSuccessAttack,
  isShieldDefenseDamageBlock,
  isWeaponDefenseDamageBlock,
  shouldContinueAfterManifestDome
} from "../../data/actor/defense-results.mjs";
import {
  getHighestHaltDamageLocation,
  getLowestHaltDamageLocation,
  getTargetedDamageLocationDisplay,
  normalizeAppliedDamageType
} from "../../data/actor/targeted-damage.mjs";
import { attachRollUndoToChatMessage, collectRollUndoRecords } from "../chat-undo.mjs";
import { getLocationBySkillOptions } from "../actor/location-table.mjs";
import { rollAoeReflexSaveForTarget } from "./aoe-reflex-save.mjs";
import { resolveAttackLocationForTarget } from "./attack-locations.mjs";
import {
  createAutomatedDamageBarrierMessages,
  publishAutomatedCombatDamageRoll,
  rollAutomatedCombatDamage
} from "./automated-damage-rolls.mjs";
import { attachLocationRollWorkflowData } from "./edge-location-rolls.mjs";
import { requestIncomingHitApplicationForTarget, requestIncomingHitResolutionForTarget } from "./incoming-hit.mjs";
import { requestManifestDomeAbsorptionForTarget } from "./manifest-spell-effects.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";
import { createEdgeIndividualValueRollKey, getEdgeIndividualDiceOverride } from "./edge-chain-rolls.mjs";

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
  if (rollResult.forcedPass || rollResult.glancingSuccessUpgraded) return false;
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

async function attachDamageRollUndo(damageRoll, application) {
  await attachRollUndoToChatMessage(damageRoll?.chatMessage, application?.undoRecords, {
    label: "Undo Damage Effects"
  });
}

function targetHasActiveManifestDome(target) {
  const effect = findActiveSpellEffectInCategory(target?.actor, "aura");
  return getManifestSpellEffectState(effect).manifestType === "dome";
}

async function resolveManifestDomeStage({
  target = null,
  damageRoll = null,
  damageType = "",
  attackRoll = null,
  defensePromptResult = null
} = {}) {
  const damageAmount = getAppliedDamageRollTotal(damageRoll);
  if (!damageRoll || damageAmount <= 0) {
    return {
      active: true,
      confirmed: true,
      domeResult: { handled: true, applied: false, reason: "noDamageRolled", penetration: 0 },
      penetration: 0,
      continueAttack: false
    };
  }

  const domeResult = await requestManifestDomeAbsorptionForTarget({
    target,
    damage: damageAmount,
    damageType
  });
  const confirmed = isConfirmedManifestDomeResult(domeResult);
  return {
    active: true,
    confirmed,
    domeResult,
    penetration: confirmed ? Math.max(0, Number(domeResult.penetration)) : 0,
    continueAttack: shouldContinueAfterManifestDome({ attackRoll, defensePromptResult, domeResult })
  };
}

async function publishDomeDamageRoll(damageRoll, domeStage) {
  await publishAutomatedCombatDamageRoll(damageRoll);
  await attachDamageRollUndo(damageRoll, domeStage?.domeResult);
}

async function finalizeDamageApplication(damageRoll, domeStage, application, onSaveReplayProgress) {
  onSaveReplayProgress?.({ damageRoll, application });
  await publishAutomatedCombatDamageRoll(damageRoll);
  await attachDamageRollUndo(damageRoll, application);
  await createAutomatedDamageBarrierMessages(damageRoll, {
    dome: domeStage?.domeResult || null,
    resistance: application?.resistance || application?.applyResult?.resistance || null
  });
  if (!application || !domeStage?.active) return application;
  return {
    ...application,
    undoRecords: collectRollUndoRecords(domeStage.domeResult?.undoRecords, application.undoRecords)
  };
}

export function applyArmorChargeLocationEffects(locationRoll, resolution) {
  if (!locationRoll) return locationRoll;
  if (
    resolution?.useArmorCharge
    && resolution?.preventByLuckPenetration
    && !locationRoll.bySkill
    && locationRoll.isAP
  ) {
    return { ...locationRoll, originalIsAP: locationRoll.originalIsAP ?? locationRoll.isAP, isAP: false };
  }
  return locationRoll;
}

function canReuseReplayLocationRoll(locationRoll, { attackRoll, magnetismGrade = 0, armorCharge = null } = {}) {
  if (!locationRoll?.location || locationRoll.byMageBlock || locationRoll.byShieldBlock
    || locationRoll.byWeaponBlock || locationRoll.byAoe) return false;
  if (locationRoll.bySkill) {
    const mos = Number(attackRoll?.rollResult?.totalMoS) || 0;
    return getLocationBySkillOptions(mos, { armorCharge }).some((option) => (
      option.location === locationRoll.location
      && !!option.isAP === !!locationRoll.isAP
    ));
  }
  return (locationRoll.byMagnetism === true) === (Number(magnetismGrade) > 0);
}

function preserveDomeMagnetismGrade(locationRoll, domeMagnetismGrade) {
  const grade = Number(domeMagnetismGrade);
  if (!locationRoll || !(grade > 0) || Number(locationRoll.domeMagnetismGrade) > 0) return locationRoll;
  return { ...locationRoll, domeMagnetismGrade: grade };
}

export async function resolveArmorChargeAndLocationForTarget({
  actor = null,
  attackerToken = null,
  combat = null,
  target = null,
  attackRoll = null,
  defensePromptResult = null,
  magnetismGrade = 0,
  domeMagnetismGrade = 0,
  damagePreview = "",
  damageType = "",
  damageTypeLabel = "",
  armorChargeResolution = null,
  replayLocationRoll = null,
  requestArmorCharge = requestIncomingHitResolutionForTarget,
  resolveLocation = resolveAttackLocationForTarget
} = {}) {
  const resolution = armorChargeResolution || await requestArmorCharge({
    target,
    attackerActor: actor,
    attackerToken,
    combat,
    attackRoll,
    defensePromptResult,
    damagePreview,
    damageType,
    damageTypeLabel
  });
  if (isChainCancelledResult(resolution)) return { chainCancelled: true, stage: "armorCharge", resolution };

  const armorCharge = resolution?.useArmorCharge
    ? {
        grade: resolution.armorGrade,
        bySkillPenetrationMosAdjustment: resolution.bySkillPenetrationMosAdjustment
      }
    : null;
  const locationRoll = canReuseReplayLocationRoll(replayLocationRoll, { attackRoll, magnetismGrade, armorCharge })
    ? replayLocationRoll
    : await resolveLocation({
        actor,
        attackerToken,
        combat,
        target,
        attackRoll,
        defensePromptResult,
        magnetismGrade,
        armorCharge
      });
  if (isChainCancelledResult(locationRoll)) return { chainCancelled: true, stage: "location", locationRoll };
  const resolvedLocationRoll = preserveDomeMagnetismGrade(locationRoll, domeMagnetismGrade);
  return {
    resolution,
    locationRoll: applyArmorChargeLocationEffects(resolvedLocationRoll, resolution)
  };
}

async function createDomeStoppedResolution(domeStage, damageRoll, extras = {}) {
  await publishDomeDamageRoll(damageRoll, domeStage);
  await createAutomatedDamageBarrierMessages(damageRoll, { dome: domeStage?.domeResult || null });
  const unavailable = domeStage?.confirmed === false;
  return {
    handled: !unavailable,
    reason: unavailable ? "manifestDomeResolutionUnavailable" : undefined,
    damageRoll,
    dome: domeStage?.domeResult || null,
    application: {
      handled: !unavailable,
      applied: false,
      reason: unavailable
        ? (domeStage?.domeResult?.reason || "Manifest Dome resolution was unavailable")
        : (domeStage?.penetration > 0 ? "attackStoppedAfterDome" : "domeAbsorbedAllDamage"),
      undoRecords: collectRollUndoRecords(domeStage?.domeResult?.undoRecords)
    },
    ...extras
  };
}

export async function resolveSuccessfulAttackDamageForTarget({
  actor = null,
  attackerToken = null,
  combat = null,
  target = null,
  attackRoll = null,
  preDefenseRollResult = null,
  defensePromptResult = null,
  appliedDamageType = null,
  reflexSaveOverride = null,
  onSaveReplayProgress = null,
  edgeIndividualDieReplay = null,
  combatMods = null,
  replayArmorChargeResolution = null,
  replayLocationRoll = null,
  replayShieldBlockChoice = null,
  workflowDependencies = {}
} = {}) {
  if (!actor || !combat || !target) {
    return null;
  }

  const targetingType = getCombatTargetingType(combat);
  const targetingKey = getCombatDefenseResponseKey(targetingType);
  if (!hasCombatDice(combat?.damage)) return null;

  const isSmiteAttack = targetingKey === "smite";
  const activeDome = !isSmiteAttack && targetHasActiveManifestDome(target);
  const domeAlreadyResolved = activeDome || isSmiteAttack;
  const attackReachesDome = activeDome && doesAttackReachManifestDome({
    attackRoll,
    preDefenseRollResult,
    defensePromptResult
  });
  if (activeDome && !attackReachesDome) return null;

  const mageBlockRedirect = isMageDefenseDamageRedirect(defensePromptResult);
  const shieldBlockFailure = isShieldDefenseDamageBlock(attackRoll, defensePromptResult);
  const weaponBlockFailure = isWeaponDefenseDamageBlock(attackRoll, defensePromptResult);
  const narrowSuccessWithoutDefense = isNarrowSuccessAttack(attackRoll)
    && !doesPromptResultCountAsActiveDefense(defensePromptResult);
  const halveDamageForGlance = isGlancingSuccessAttack(attackRoll);
  if (
    !attackRoll?.rollResult?.isSuccess
    && !narrowSuccessWithoutDefense
    && !mageBlockRedirect
    && !shieldBlockFailure
    && !weaponBlockFailure
    && !attackReachesDome
  ) {
    return null;
  }
  if (!isSkillTagAutoEligible(combat, "damage", {
    success: attackRoll?.rollResult?.isSuccess === true,
    hit: attackRoll?.rollResult?.isSuccess === true
  })) return { handled: false, reason: "manualCondition" };

  const targetLabel = target?.targetName || target?.actor?.name || "";
  const targetActor = target?.actor || null;
  const attackScale = isSkillTagAutoEligible(combat, "tippingScales", {
    success: attackRoll?.rollResult?.isSuccess === true,
    hit: attackRoll?.rollResult?.isSuccess === true
  }) ? combat.tippingScales : 0;
  const targetTokenDocument = target?.tokenDocument || target?.token?.document || target?.token || null;
  const damageRollKey = createEdgeIndividualValueRollKey("damage", {
    targetRef: {
      tokenUuid: targetTokenDocument?.uuid || null,
      tokenId: targetTokenDocument?.id || target?.tokenId || null,
      actorUuid: targetActor?.uuid || null,
      actorId: targetActor?.id || null
    }
  });
  const individualDamageDice = getEdgeIndividualDiceOverride(edgeIndividualDieReplay, damageRollKey);
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
      targetActor,
      attackScale,
      targetLabel,
      attackerToken,
      appliedDamageType: resolvedDamageType,
      halveDamageForGlance,
      deferChatMessage: activeDome,
      diceOverride: individualDamageDice,
      combatMods
    });
    onSaveReplayProgress?.({ damageRoll });
    const damageAmount = getAppliedDamageRollTotal(damageRoll);
    if (!damageRoll || damageAmount <= 0) {
      await publishAutomatedCombatDamageRoll(damageRoll);
      return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, shieldBlockFailure: true };
    }

    let domeStage = null;
    let resolvedDamageAmount = damageAmount;
    if (activeDome) {
      domeStage = await resolveManifestDomeStage({
        target,
        damageRoll,
        damageType: resolvedDamageType,
        attackRoll,
        defensePromptResult
      });
      if (!domeStage.continueAttack) {
        return createDomeStoppedResolution(domeStage, damageRoll, { locationRoll, shieldBlockFailure: true });
      }
      resolvedDamageAmount = domeStage.penetration;
      await publishDomeDamageRoll(damageRoll, domeStage);
    }

    let application = await requestIncomingHitApplicationForTarget({
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
      ignoreHaltReduction: true,
      domeAlreadyResolved,
      shieldBlock: {
        selectedCombatId: defensePromptResult?.selectedCombatId || null,
        selectedCombatIndex: defensePromptResult?.selectedCombatIndex,
        selectedUsageId: defensePromptResult?.selectedUsageId || "base",
        ...(replayShieldBlockChoice === "normal" || replayShieldBlockChoice === "braced"
          ? { replayBraceChoice: replayShieldBlockChoice }
          : {})
      }
    });
    application = await finalizeDamageApplication(damageRoll, domeStage, application, onSaveReplayProgress);

    return {
      handled: !application?.chainCancelled,
      chainCancelled: !!application?.chainCancelled,
      shieldBlockFailure: true,
      locationRoll,
      damageRoll,
      dome: domeStage?.domeResult || null,
      application
    };
  }

  if (weaponBlockFailure) {
    const weaponDefense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
    const resolvedDamageType = normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt");

    const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
      targetActor,
      attackScale,
      targetLabel,
      attackerToken,
      appliedDamageType: resolvedDamageType,
      halveDamageForGlance,
      deferChatMessage: activeDome,
      diceOverride: individualDamageDice,
      combatMods
    });
    onSaveReplayProgress?.({ damageRoll });
    const damageAmount = getAppliedDamageRollTotal(damageRoll);
    if (!damageRoll || damageAmount <= 0) {
      await publishAutomatedCombatDamageRoll(damageRoll);
      return { handled: false, reason: "noDamageRolled", damageRoll, weaponBlockFailure: true };
    }

    let domeStage = null;
    let originalDamageAmount = damageAmount;
    if (activeDome) {
      domeStage = await resolveManifestDomeStage({
        target,
        damageRoll,
        damageType: resolvedDamageType,
        attackRoll,
        defensePromptResult
      });
      if (!domeStage.continueAttack) {
        return createDomeStoppedResolution(domeStage, damageRoll, { weaponBlockFailure: true });
      }
      originalDamageAmount = domeStage.penetration;
    }
    const weaponHardness = Math.max(0, Number.parseInt(weaponDefense.hardness, 10) || 0);
    const weaponOverflowDamage = Math.max(0, originalDamageAmount - weaponHardness);
    const weaponMagnetismGrade = getWeaponMasteryMagnetismGrade(combat, defensePromptResult);
    const magnetismGrade = getPostDomeMagnetismGrade(
      weaponMagnetismGrade,
      domeStage?.domeResult
    );
    const domeMagnetismGrade = magnetismGrade - weaponMagnetismGrade;
    let locationRoll = createWeaponBlockLocationRoll();

    if (weaponOverflowDamage > 0) {
      locationRoll = canReuseReplayLocationRoll(replayLocationRoll, { attackRoll, magnetismGrade })
        ? replayLocationRoll
        : await resolveAttackLocationForTarget({
            actor,
            attackerToken,
            combat,
            target,
            attackRoll,
            defensePromptResult,
            magnetismGrade
          });
      onSaveReplayProgress?.({ damageRoll, locationRoll });
      if (isChainCancelledResult(locationRoll)) {
        await publishDomeDamageRoll(damageRoll, domeStage);
        await createAutomatedDamageBarrierMessages(damageRoll, { dome: domeStage?.domeResult || null });
        return { handled: false, chainCancelled: true, reason: "locationPromptClosed", damageRoll };
      }
      if (!locationRoll) {
        await publishDomeDamageRoll(damageRoll, domeStage);
        await createAutomatedDamageBarrierMessages(damageRoll, { dome: domeStage?.domeResult || null });
        return { handled: false, reason: "locationUnavailable", damageRoll };
      }
      locationRoll = preserveDomeMagnetismGrade(locationRoll, domeMagnetismGrade);
    }

    if (activeDome) await publishDomeDamageRoll(damageRoll, domeStage);

    let application = await requestIncomingHitApplicationForTarget({
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
      domeAlreadyResolved,
      weaponBlock: {
        selectedCombatId: defensePromptResult?.selectedCombatId || null,
        selectedCombatIndex: defensePromptResult?.selectedCombatIndex,
        selectedUsageId: defensePromptResult?.selectedUsageId || "base",
        selectedDefense: weaponDefense,
        originalDamageAmount,
        masteryBonus: !!weaponDefense.masteryBonus,
        magnetismGrade
      }
    });
    application = await finalizeDamageApplication(damageRoll, domeStage, application, onSaveReplayProgress);
    await attachLocationRollWorkflowData(locationRoll, {
      application,
      target,
      attackerActor: actor,
      attackerToken,
      combat,
      defendedByReflex: doesPromptResultCountAsActiveDefense(defensePromptResult)
    });

    return {
      handled: true,
      weaponBlockFailure: true,
      damageRoll,
      locationRoll,
      dome: domeStage?.domeResult || null,
      originalDamageAmount,
      weaponHardness,
      weaponOverflowDamage,
      application
    };
  }

  if (mageBlockRedirect) {
    const locationRoll = {
      rawText: "Mage Block Overflow",
      location: "",
      locationDisplay: "Mage Block Overflow",
      isAP: false,
      byMageBlock: true
    };

    const resolvedDamageType = normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt");

    const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
      targetActor,
      attackScale,
      targetLabel,
      attackerToken,
      appliedDamageType: resolvedDamageType,
      halveDamageForGlance,
      deferChatMessage: activeDome,
      diceOverride: individualDamageDice,
      combatMods
    });
    onSaveReplayProgress?.({ damageRoll });
    const damageAmount = getAppliedDamageRollTotal(damageRoll);
    if (!damageRoll || damageAmount <= 0) {
      await publishAutomatedCombatDamageRoll(damageRoll);
      return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, mageBlockFailure: true };
    }

    let domeStage = null;
    let resolvedDamageAmount = damageAmount;
    if (activeDome) {
      domeStage = await resolveManifestDomeStage({
        target,
        damageRoll,
        damageType: resolvedDamageType,
        attackRoll,
        defensePromptResult
      });
      if (!domeStage.continueAttack) {
        return createDomeStoppedResolution(domeStage, damageRoll, { locationRoll, mageBlockFailure: true });
      }
      resolvedDamageAmount = domeStage.penetration;
      await publishDomeDamageRoll(damageRoll, domeStage);
    }

    if (resolvedDamageAmount <= 0) {
      await createAutomatedDamageBarrierMessages(damageRoll, { dome: domeStage?.domeResult || null });
      return {
        handled: true,
        mageBlockFailure: true,
        locationRoll,
        damageRoll,
        dome: domeStage?.domeResult || null,
        absorbedByMage: 0,
        redirectedDamage: 0,
        application: {
          handled: true,
          applied: false,
          reason: "domeAbsorbedAllDamage",
          undoRecords: collectRollUndoRecords(domeStage?.domeResult?.undoRecords)
        }
      };
    }

    let application = await requestIncomingHitApplicationForTarget({
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
      ignoreHaltReduction: true,
      mageBlock: {
        selectedCombatId: defensePromptResult?.selectedCombatId || null,
        selectedCombatIndex: defensePromptResult?.selectedCombatIndex ?? null,
        selectedUsageId: defensePromptResult?.selectedUsageId || "base",
        mageBarrierAction: defensePromptResult?.mageBarrierAction || null
      },
      domeAlreadyResolved: true
    });
    application = await finalizeDamageApplication(damageRoll, domeStage, application, onSaveReplayProgress);
    const mageBlockResult = application?.mageBlockResult || application || {};
    const absorbedByMage = Math.max(0, Number(mageBlockResult.absorbed) || 0);
    const redirectedDamage = Math.max(0, Number(mageBlockResult.overflow) || 0);

    return {
      handled: true,
      mageBlockFailure: true,
      locationRoll,
      damageRoll,
      dome: domeStage?.domeResult || null,
      absorbedByMage,
      redirectedDamage,
      application
    };
  }

  if (isAreaDamageTargetingKey(targetingKey)) {
    const areaDamageLocation = getAreaDamageHaltLocation(target?.actor || null, targetingKey);
    const locationRoll = createAreaDamageLocationRoll(targetingType, areaDamageLocation);
    const resolvedDamageType = normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt");
    const reflexSaveResult = reflexSaveOverride || (targetingKey === "aoe"
      ? (defensePromptResult?.selection === "reflexSave" ? defensePromptResult.reflexSaveResult : null)
      : await rollAoeReflexSaveForTarget({ target, targetingType }));
    const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
      targetActor,
      attackScale,
      targetLabel,
      attackerToken,
      appliedDamageType: resolvedDamageType,
      aoeReflexSaveResult: reflexSaveResult,
      halveDamageForGlance,
      deferChatMessage: activeDome,
      diceOverride: individualDamageDice,
      combatMods
    });
    onSaveReplayProgress?.({ damageRoll, reflexSaveResult });
    if (!damageRoll || !Number.isFinite(Number(damageRoll.total)) || Number(damageRoll.total) <= 0) {
      await publishAutomatedCombatDamageRoll(damageRoll);
      return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, reflexSaveResult, aoe: true };
    }

    const baseDamageAmount = Number(damageRoll.total) || 0;
    let resolvedDamageAmount = getAppliedDamageRollTotal(damageRoll);
    if (resolvedDamageAmount <= 0) {
      const reducedDamageReason = reflexSaveResult?.passed
        ? "reflexSaveReducedDamageToZero"
        : (halveDamageForGlance ? "glanceReducedDamageToZero" : "damageReducedToZero");
      await publishAutomatedCombatDamageRoll(damageRoll);
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

    let domeStage = null;
    if (activeDome) {
      domeStage = await resolveManifestDomeStage({
        target,
        damageRoll,
        damageType: resolvedDamageType,
        attackRoll,
        defensePromptResult
      });
      if (!domeStage.continueAttack) {
        return createDomeStoppedResolution(domeStage, damageRoll, {
          locationRoll,
          reflexSaveResult,
          baseDamageAmount,
          resolvedDamageAmount,
          aoe: true
        });
      }
      resolvedDamageAmount = domeStage.penetration;
      await publishDomeDamageRoll(damageRoll, domeStage);
    }

    let application = await requestIncomingHitApplicationForTarget({
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
      suppressLocationBreaks: true,
      domeAlreadyResolved
    });
    onSaveReplayProgress?.({ damageRoll, reflexSaveResult, application });
    application = await finalizeDamageApplication(damageRoll, domeStage, application, onSaveReplayProgress);

    return {
      handled: true,
      aoe: true,
      locationRoll,
      damageRoll,
      dome: domeStage?.domeResult || null,
      reflexSaveResult,
      baseDamageAmount,
      resolvedDamageAmount,
      application
    };
  }

  if (activeDome) {
    let resolvedDamageType = normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt");
    if (resolvedDamageType === "flexible") resolvedDamageType = "blunt";
    const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
      targetActor,
      attackScale,
      targetLabel,
      attackerToken,
      appliedDamageType: resolvedDamageType,
      halveDamageForGlance,
      deferChatMessage: true,
      diceOverride: individualDamageDice,
      combatMods
    });
    onSaveReplayProgress?.({ damageRoll });
    const damageAmount = getAppliedDamageRollTotal(damageRoll);
    if (!damageRoll || damageAmount <= 0) {
      await publishAutomatedCombatDamageRoll(damageRoll);
      return { handled: false, reason: "noDamageRolled", damageRoll };
    }

    const domeStage = await resolveManifestDomeStage({
      target,
      damageRoll,
      damageType: resolvedDamageType,
      attackRoll,
      defensePromptResult
    });
    if (!domeStage.continueAttack) return createDomeStoppedResolution(domeStage, damageRoll);

    const weaponMagnetismGrade = getWeaponMasteryMagnetismGrade(combat, defensePromptResult);
    const magnetismGrade = getPostDomeMagnetismGrade(
      weaponMagnetismGrade,
      domeStage.domeResult
    );
    const damagePreview = getAutomatedCombatDamagePreview(actor, combat, { appliedDamageType: resolvedDamageType, combatMods });
    const overkill = !!combat?.overkill;
    const armorChargeLocation = await resolveArmorChargeAndLocationForTarget({
      actor,
      attackerToken,
      combat,
      target,
      attackRoll,
      defensePromptResult,
      magnetismGrade,
      domeMagnetismGrade: magnetismGrade - weaponMagnetismGrade,
      damagePreview,
      damageType: resolvedDamageType,
      damageTypeLabel: getAutomatedCombatDamageTypeLabel(resolvedDamageType),
      armorChargeResolution: replayArmorChargeResolution || (overkill ? {
        handled: true,
        useArmorCharge: false,
        appliedDamageType: resolvedDamageType,
        armorGrade: "",
        preventByLuckPenetration: false,
        bySkillPenetrationMosAdjustment: 0
      } : null),
      replayLocationRoll,
      requestArmorCharge: workflowDependencies.requestArmorCharge || requestIncomingHitResolutionForTarget,
      resolveLocation: workflowDependencies.resolveLocation || resolveAttackLocationForTarget
    });
    const { locationRoll, resolution } = armorChargeLocation || {};
    onSaveReplayProgress?.({ damageRoll, locationRoll });
    if (isChainCancelledResult(armorChargeLocation)) {
      await publishDomeDamageRoll(damageRoll, domeStage);
      await createAutomatedDamageBarrierMessages(damageRoll, { dome: domeStage.domeResult });
      return {
        handled: false,
        chainCancelled: true,
        reason: armorChargeLocation.stage === "armorCharge" ? "incomingHitPromptClosed" : "locationPromptClosed",
        damageRoll,
        dome: domeStage.domeResult,
        resolution: armorChargeLocation.resolution || null
      };
    }
    if (isChainCancelledResult(locationRoll)) {
      await publishDomeDamageRoll(damageRoll, domeStage);
      await createAutomatedDamageBarrierMessages(damageRoll, { dome: domeStage.domeResult });
      return { handled: false, chainCancelled: true, reason: "locationPromptClosed", damageRoll, dome: domeStage.domeResult };
    }
    if (!locationRoll) {
      await publishDomeDamageRoll(damageRoll, domeStage);
      await createAutomatedDamageBarrierMessages(damageRoll, { dome: domeStage.domeResult });
      return { handled: false, reason: "locationUnavailable", damageRoll, dome: domeStage.domeResult };
    }

    await publishDomeDamageRoll(damageRoll, domeStage);

    resolvedDamageType = normalizeAppliedDamageType(resolution?.appliedDamageType || resolvedDamageType, "blunt");
    let application = await (workflowDependencies.requestIncomingHitApplication || requestIncomingHitApplicationForTarget)({
      target,
      attackerActor: actor,
      attackerToken,
      combat,
      damageRoll,
      locationRoll,
      incomingHitResolution: resolution,
      damageAmountOverride: domeStage.penetration,
      ignoreHaltReduction: overkill,
      domeAlreadyResolved: true
    });
    application = await finalizeDamageApplication(damageRoll, domeStage, application, onSaveReplayProgress);
    await attachLocationRollWorkflowData(locationRoll, {
      application,
      target,
      attackerActor: actor,
      attackerToken,
      combat,
      defendedByReflex: doesPromptResultCountAsActiveDefense(defensePromptResult)
    });

    return {
      handled: true,
      locationRoll,
      damageRoll,
      dome: domeStage.domeResult,
      resolution,
      application
    };
  }

  const damagePreview = getAutomatedCombatDamagePreview(actor, combat, { appliedDamageType, combatMods });
  const overkill = !!combat?.overkill;
  const armorChargeLocation = await resolveArmorChargeAndLocationForTarget({
    actor,
    attackerToken,
    combat,
    target,
    attackRoll,
    defensePromptResult,
    magnetismGrade: getWeaponMasteryMagnetismGrade(combat, defensePromptResult),
    damagePreview,
    damageType: String(appliedDamageType || combat?.damage?.type || "").trim(),
    damageTypeLabel: getAutomatedCombatDamageTypeLabel(appliedDamageType || combat?.damage?.type),
    armorChargeResolution: replayArmorChargeResolution || (overkill ? {
      handled: true,
      useArmorCharge: false,
      appliedDamageType: normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt"),
      armorGrade: "",
      preventByLuckPenetration: false,
      bySkillPenetrationMosAdjustment: 0
    } : null),
    replayLocationRoll,
    requestArmorCharge: workflowDependencies.requestArmorCharge || requestIncomingHitResolutionForTarget,
    resolveLocation: workflowDependencies.resolveLocation || resolveAttackLocationForTarget
  });
  if (isChainCancelledResult(armorChargeLocation)) {
    return {
      handled: false,
      chainCancelled: true,
      reason: armorChargeLocation.stage === "armorCharge" ? "incomingHitPromptClosed" : "locationPromptClosed",
      resolution: armorChargeLocation.resolution || null
    };
  }
  const { locationRoll, resolution } = armorChargeLocation || {};
  onSaveReplayProgress?.({ locationRoll });
  if (!locationRoll) return { handled: false, reason: "locationUnavailable" };

  const resolvedDamageType = normalizeAppliedDamageType(resolution?.appliedDamageType || appliedDamageType || combat?.damage?.type, "blunt");

  const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
    targetActor,
    attackScale,
    targetLabel,
    attackerToken,
    appliedDamageType: resolvedDamageType,
    halveDamageForGlance,
    diceOverride: individualDamageDice,
    combatMods
  });
  onSaveReplayProgress?.({ damageRoll });
  const damageAmount = getAppliedDamageRollTotal(damageRoll);
  if (!damageRoll || damageAmount <= 0) {
    return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, resolution };
  }

  let application = await (workflowDependencies.requestIncomingHitApplication || requestIncomingHitApplicationForTarget)({
    target,
    attackerActor: actor,
    attackerToken,
    combat,
    damageRoll,
    locationRoll,
    incomingHitResolution: resolution,
    damageAmountOverride: damageAmount,
    ignoreHaltReduction: overkill,
    domeAlreadyResolved
  });
  application = await finalizeDamageApplication(damageRoll, null, application, onSaveReplayProgress);
  await attachLocationRollWorkflowData(locationRoll, {
    application,
    target,
    attackerActor: actor,
    attackerToken,
    combat,
    defendedByReflex: doesPromptResultCountAsActiveDefense(defensePromptResult)
  });

  return {
    handled: true,
    locationRoll,
    damageRoll,
    resolution,
    application
  };
}
