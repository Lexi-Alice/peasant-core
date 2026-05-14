import {
  getCombatDefenseSummary,
  normalizeCombatDefense
} from "../combat-defense.mjs";
import { COMBAT_VIEW_TAG_TYPES, getCombatCustomTags } from "../combat-tags.mjs";
import {
  COMBAT_HALT_BUFF_TYPE_COST,
  COMBAT_HALT_BUFF_TYPE_CUSTOM,
  COMBAT_HALT_BUFF_TYPE_FLAT,
  COMBAT_HALT_BUFF_TYPE_HALT,
  COMBAT_HALT_BUFF_TYPE_NATURAL,
  getCombatCostModifiers,
  getCombatFlatDamageModifier,
  getCombatHaltBuffTotals,
  normalizeHaltSlashValue,
  parseHaltSlashValues,
  sanitizeCombatCostResourceType,
  sanitizeCombatHaltBuffs,
  sanitizeCombatHaltBuffType
} from "../combat-modifiers.mjs";
import {
  EDGE_LABEL_MODE_CUSTOM,
  getDefaultEdgeLabelMode,
  normalizeEdgeResourceEntry,
  resolveEdgeLabel,
  sanitizeEdgeLabelMode
} from "../edge-resources.mjs";
import { getActorBolsteredMax, getActorHealthMax, isSimplifiedHpActor } from "../helpers.mjs";
import {
  PC_ART_PANEL_COLLAPSED_FLAG,
  PC_DEFAULT_RUN_MULTIPLIER,
  PC_DEFAULT_SPRINT_MULTIPLIER,
  PC_RUN_MULTIPLIER_FLAG,
  PC_SAVE_MODIFIER_FLAG,
  PC_SPRINT_MULTIPLIER_FLAG,
  formatThresholdValue,
  getPeasantCoreSettingGroups
} from "../sheet-settings.mjs";
import { getWoundThresholdMultipliers } from "../targeted-damage.mjs";
import { applyDieRate, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";

export function prepareActorNotableCombatContext(data, actor) {
  const sourceNotableCombats = (actor.system.notableCombats || []);
  const combatMods = actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 };
  const toHitMod = parseInt(combatMods.toHit) || 0;
  const accuracyMod = parseInt(combatMods.accuracy) || 0;
  const diceRateMod = parseInt(combatMods.diceRate) || 0;
  const flatDamageMod = getCombatFlatDamageModifier(combatMods);
  const costModifiersByType = getCombatCostModifiers(combatMods);

  data.notableCombats = (sourceNotableCombats || []).map(combat => {
    const baseAccuracy = parseInt(combat.accuracy) || 0;
    const baseTohit = Number.isFinite(parseInt(combat.tohit)) ? parseInt(combat.tohit) : 7;
    const combatCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
    const accuracyNum = combatCalc.accuracy;
    const modifiedTohit = combatCalc.toHit;
    const isStandard = !combat.type || combat.type === "standard";
    const combatType = String(combat.type || "").trim();
    const combatTypeKey = combatType.toLowerCase();
    const noToHitTypes = new Set(["stance", "perk", "style", "cantrip", "tm"]);
    const allowToHitAcc = isStandard || !noToHitTypes.has(combatTypeKey);
    let isDisplayable = false;
    const specialGradeRaw = parseInt(combat.specialGrade);
    const specialGrade = Number.isFinite(specialGradeRaw) ? Math.max(0, specialGradeRaw) : 0;
    const hasSpecialGrade = Number.isFinite(specialGradeRaw) && specialGrade > 0;
    const rankStr = String(combat.rank ?? "").trim().toLowerCase();
    const isUntrainedRank = (rankStr === "u");
    const hasValidRank = isUntrainedRank || combat.rank === 0 || Number.isFinite(parseInt(combat.rank));

    if (isStandard) {
      isDisplayable = combat.class && hasValidRank && combat.name && combat.tohit;
    } else {
      isDisplayable = combat.name;
    }

    const descriptionRaw = combat.description || "";
    const descriptionText = descriptionRaw.replace(/<[^>]*>/g, "").trim();
    const hasDescription = descriptionText.length > 0;

    let classRankDisplay = undefined;
    if (isStandard) {
      const rankDisplay = isUntrainedRank ? "U" : (hasValidRank ? `R${combat.rank}` : "");
      classRankDisplay = `C${combat.class}${rankDisplay}`;
    }
    let specialTypeDisplay = combat.type || "";
    if (!isStandard) {
      if (combatTypeKey === "tm" || combatTypeKey === "perk") {
        specialTypeDisplay = hasSpecialGrade ? `Grade ${specialGrade} ${combatType}` : (combat.type || "");
      } else if (combatTypeKey === "spellcraft" || combatTypeKey === "gate") {
        specialTypeDisplay = hasSpecialGrade ? `C${specialGrade}` : "C";
      }
    }

    const hasStaminaCost = combat.staminaCost > 0;
    const hasAttunementCost = combat.attunementCost > 0;
    const hasResourceCosts = Array.isArray(combat.resourceCosts)
      && combat.resourceCosts.length > 0
      && combat.resourceCosts.some(rc => {
        const baseValue = Number.parseInt(rc?.value, 10) || 0;
        return !!rc?.type && baseValue > 0;
      });

    let resourceCostsDisplay = "";
    const resourceCostsList = [];
    if (hasResourceCosts) {
      for (const rc of combat.resourceCosts) {
        const baseValue = Number.parseInt(rc?.value, 10) || 0;
        if (!rc?.type || baseValue <= 0) continue;
        const rcType = sanitizeCombatCostResourceType(rc.type);
        let label = rcType;
        if (rcType === "HP" && rc.damageType) {
          label = `${rc.damageType} HP`;
        }
        const modifiedValue = Math.max(0, baseValue + (costModifiersByType[rcType] || 0));
        resourceCostsList.push({
          type: rcType,
          value: modifiedValue,
          baseValue,
          damageType: rc.damageType || "",
          label
        });
      }
      resourceCostsDisplay = resourceCostsList.map(rc => `${rc.label} ${rc.value}`).join(", ");
    }

    const hasSpeed = combat.speed && combat.speed.type;
    const isSplitSecond = hasSpeed && combat.speed.type === "Split Second";
    let speedDisplay = "";
    if (hasSpeed) {
      speedDisplay = combat.speed.type;
    }

    const hasRange = combat.range > 0;
    const hasRangeRate = !!combat.rangeRate && combat.rangeRate !== "///";
    const hasDamage = hasCombatDice(combat.damage);
    let damageDisplay = "";
    let modifiedDamageDice = 0;
    let modifiedDamageValue = 0;
    let modifiedDamageFlat = 0;
    if (hasDamage) {
      const damageResult = applyDieRate(
        combat.damage.diceCount,
        combat.damage.diceValue,
        combat.damage.flat || 0,
        diceRateMod,
        combat.damage.diceBonus || 0
      );
      modifiedDamageDice = damageResult.diceCount;
      modifiedDamageValue = damageResult.diceValue;
      modifiedDamageFlat = damageResult.flat + flatDamageMod;
      damageDisplay = `${modifiedDamageDice}d${modifiedDamageValue}`;
      if (modifiedDamageFlat !== 0) {
        damageDisplay += modifiedDamageFlat > 0 ? `+${modifiedDamageFlat}` : `${modifiedDamageFlat}`;
      }
      if (combat.damage.type) damageDisplay += ` ${combat.damage.type}`;
    }

    const hasHeal = hasCombatDice(combat.heal);
    let healDisplay = "";
    let modifiedHealDice = 0;
    let modifiedHealValue = 0;
    let modifiedHealFlat = 0;
    if (hasHeal) {
      const healResult = applyDieRate(
        combat.heal.diceCount,
        combat.heal.diceValue,
        combat.heal.flat || 0,
        diceRateMod,
        combat.heal.diceBonus || 0
      );
      modifiedHealDice = healResult.diceCount;
      modifiedHealValue = healResult.diceValue;
      modifiedHealFlat = healResult.flat + flatDamageMod;
      healDisplay = `${modifiedHealDice}d${modifiedHealValue}`;
      if (modifiedHealFlat !== 0) {
        healDisplay += modifiedHealFlat > 0 ? `+${modifiedHealFlat}` : `${modifiedHealFlat}`;
      }
      if (combat.heal.type) healDisplay += ` ${combat.heal.type}`;
    }

    const hasManifest = hasCombatDice(combat.manifest);
    let manifestDisplay = "";
    let modifiedManifestDice = 0;
    let modifiedManifestValue = 0;
    let modifiedManifestFlat = 0;
    if (hasManifest) {
      const manifestResult = applyDieRate(
        combat.manifest.diceCount,
        combat.manifest.diceValue,
        combat.manifest.flat || 0,
        diceRateMod,
        combat.manifest.diceBonus || 0
      );
      modifiedManifestDice = manifestResult.diceCount;
      modifiedManifestValue = manifestResult.diceValue;
      modifiedManifestFlat = manifestResult.flat + flatDamageMod;
      manifestDisplay = `${modifiedManifestDice}d${modifiedManifestValue}`;
      if (modifiedManifestFlat !== 0) {
        manifestDisplay += modifiedManifestFlat > 0 ? `+${modifiedManifestFlat}` : `${modifiedManifestFlat}`;
      }
    }

    const hasTagUses = combat.tagUses && combat.tagUses.max > 0;
    const hasSections = combat.sections && combat.sections.max > 0;
    const hasAoe = combat.aoe && combat.aoe.value > 0;
    let aoeDisplay = "";
    if (hasAoe) {
      aoeDisplay = `${combat.aoe.value}`;
      if (combat.aoe.type && combat.aoe.type !== "Area") {
        aoeDisplay += ` ${combat.aoe.type}`;
      }
    }

    const hasTargetingType = !!combat.targetingType;
    const defenseData = normalizeCombatDefense(combat.defense);
    const defenseSummary = getCombatDefenseSummary(defenseData);
    const hasDefense = defenseData.responses.length > 0;
    const hasReach = combat.reach > 0;
    const hasStability = !!combat.stability;
    const hasStrengthen = !!combat.stability && !!combat.strengthen;
    const customTags = getCombatCustomTags(combat);
    const hasCustom = customTags.length > 0;
    const rawTagOrder = Array.isArray(combat.tagOrder) ? combat.tagOrder : [];
    const hasCustomOrder = rawTagOrder.length > 0;
    let tagOrder = hasCustomOrder
      ? rawTagOrder.filter(t => COMBAT_VIEW_TAG_TYPES.includes(t))
      : [...COMBAT_VIEW_TAG_TYPES];

    for (const tagType of COMBAT_VIEW_TAG_TYPES) {
      if (!tagOrder.includes(tagType)) {
        tagOrder.push(tagType);
      }
    }

    const activeTags = [];
    const tagData = {
      resourceCosts: { has: hasResourceCosts, label: "Cost", value: resourceCostsDisplay, costsList: resourceCostsList },
      speed: { has: hasSpeed, label: "Speed", value: speedDisplay, isSplitSecond, splitSecondCurrent: combat.speed?.splitSecondCurrent || 0, splitSecondMax: combat.speed?.splitSecondMax || 0 },
      range: { has: hasRange, label: "Range", value: combat.range },
      rangeRate: { has: hasRangeRate, label: "Range-Rate", value: combat.rangeRate },
      damage: { has: hasDamage, label: "Damage", value: damageDisplay, rollable: true },
      heal: { has: hasHeal, label: "Heal", value: healDisplay, rollable: true },
      manifest: { has: hasManifest, label: "Manifest", value: manifestDisplay, rollable: true },
      tagUses: { has: hasTagUses, label: "Uses", current: combat.tagUses?.current || 0, max: combat.tagUses?.max || 0, isUses: true },
      sections: { has: hasSections, label: "Sections", current: combat.sections?.current || 0, max: combat.sections?.max || 0, isSections: true },
      aoe: { has: hasAoe, label: "AoE", value: aoeDisplay },
      targetingType: { has: hasTargetingType, label: "", value: combat.targetingType },
      defense: { has: hasDefense, label: "Defense", value: defenseSummary },
      reach: { has: hasReach, label: "Reach", value: combat.reach },
      stability: { has: hasStability, label: "Stability", value: "" },
      strengthen: { has: hasStrengthen, label: "Strengthen", value: "" },
      custom: { has: hasCustom, tags: customTags },
      self: { has: combat.self, label: "Self", value: "" }
    };

    for (const tagType of tagOrder) {
      if (!tagData[tagType] || !tagData[tagType].has) continue;
      if (tagType === "custom") {
        const tags = Array.isArray(tagData.custom?.tags) ? tagData.custom.tags : [];
        tags.forEach((tag, customIndex) => {
          activeTags.push({
            type: "custom",
            customIndex,
            label: tag.name,
            value: tag.value || ""
          });
        });
      } else {
        activeTags.push({ type: tagType, ...tagData[tagType] });
      }
    }

    return {
      ...combat,
      isStandard,
      allowToHitAcc,
      classRankDisplay,
      specialTypeDisplay,
      specialGrade,
      specialGradeInput: hasSpecialGrade ? specialGrade : "",
      accuracy: combat.accuracy || "",
      accuracyNum,
      hasToHit: allowToHitAcc && !!combat.tohit,
      hasAccuracy: allowToHitAcc && (accuracyNum !== 0 || baseAccuracy !== 0),
      accuracySign: accuracyNum >= 0 ? "+" : "",
      modifiedTohit,
      hasToHitMod: toHitMod !== 0,
      hasAccuracyMod: accuracyMod !== 0,
      hasDiceRateMod: diceRateMod !== 0,
      hasFlatDamageMod: flatDamageMod !== 0,
      modifiedDamageDice,
      modifiedDamageValue,
      modifiedDamageFlat,
      modifiedHealDice,
      modifiedHealValue,
      modifiedHealFlat,
      modifiedManifestDice,
      modifiedManifestValue,
      modifiedManifestFlat,
      usesMax: combat.usesMax || 0,
      usesCurrent: combat.usesCurrent || 0,
      hasDescription,
      isDisplayable,
      isUntrainedRank,
      hasStaminaCost,
      hasAttunementCost,
      hasRange,
      hasRangeRate,
      hasDamage,
      damageDisplay,
      hasHeal,
      healDisplay,
      hasManifest,
      manifestDisplay,
      hasTagUses,
      hasSections,
      hasAoe,
      aoeDisplay,
      hasTargetingType,
      hasDefense,
      defenseData,
      defenseSummary,
      hasStability,
      hasStrengthen,
      hasResourceCosts,
      resourceCostsDisplay,
      resourceCostsList,
      hasSpeed,
      speedDisplay,
      isSplitSecond,
      activeTags,
      customTags,
      tagOrder: combat.tagOrder || [],
      hasTags: hasResourceCosts || hasSpeed || hasRange || hasRangeRate || hasDamage || hasHeal || hasManifest || hasTagUses || hasSections || hasAoe || hasTargetingType || hasDefense || hasReach || hasStability || hasStrengthen || hasCustom || combat.self
    };
  });
}
