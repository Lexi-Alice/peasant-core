import {
  getCombatDefenseSummary,
  normalizeCombatDefense
} from "../combat-defense.mjs";
import { COMBAT_VIEW_TAG_TYPES, getCombatCustomTags, getCombatMagnetismGrade, getCombatTargetingType } from "../combat-tags.mjs";
import {
  COMBAT_HALT_BUFF_TYPE_COST,
  COMBAT_HALT_BUFF_TYPE_CUSTOM,
  COMBAT_HALT_BUFF_TYPE_FLAT,
  COMBAT_HALT_BUFF_TYPE_HALT,
  COMBAT_HALT_BUFF_TYPE_NATURAL,
  getCombatCostModifiers,
  getCombatFlatDamageModifier,
  getCombatHaltBuffTotals,
  getEffectiveSkillCombatModifiers,
  normalizeHaltSlashValue,
  parseHaltSlashValues,
  sanitizeCombatCostResourceType,
  sanitizeCombatHaltBuffs,
  sanitizeCombatHaltBuffType
} from "../combat-modifiers.mjs";
import { getCombatDesperateDieRateModifier } from "../combat-damage.mjs";
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
import { formatRangeRateValue, hasRangeRateValue } from "../combat-tags.mjs";
import { formatOptionalIntegerInput, hasOptionalInteger, parseOptionalInteger } from "../helpers.mjs";
import { getWoundThresholdMultipliers } from "../targeted-damage.mjs";
import { applyDieRate, formatCombatDiceDisplay, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";
import { getNotableCombatImage } from "../notable-combat-image.mjs";
import { getNotableCombatTreeRows, isNotableCombatDisplayable } from "../notable-combat-tree.mjs";
import { SKILL_TYPE_OPTIONS, getFixedSkillTypeValue, getSkillTypeOptionsForCategory, isRollableSkillType, isSkillProgressionType, isSignatureSkillType, normalizeSkillTypeForCategory } from "../skill-entry-types.mjs";
import { resolveSkillUsage } from "../skill-entries.mjs";

export function prepareNotableCombatTree(combats, { includeHidden = false } = {}) {
  const prepared = combats.map(combat => ({ ...combat, treeDepth: 0, treeLanes: [], treeHasChildren: false }));
  const visibleRows = getNotableCombatTreeRows(prepared, { includeHidden });

  for (const [index, row] of visibleRows.entries()) {
    prepared[row.index].treeDepth = row.depth;
    prepared[row.index].treeHasChildren = (visibleRows[index + 1]?.depth ?? 0) > row.depth;
    if (row.depth === 0) continue;

    prepared[row.index].treeLanes = Array.from({ length: row.depth }, (_, lane) => {
      const laneDepth = lane + 1;
      const nextAtOrAbove = visibleRows.slice(index + 1).find(candidate => candidate.depth <= laneDepth);
      const continues = nextAtOrAbove?.depth === laneDepth;
      if (laneDepth === row.depth) return continues ? "branch" : "last";
      return continues ? "rail" : "blank";
    });
  }

  return prepared;
}

export function prepareActorNotableCombatContext(data, actor, { isEditMode = false, sourceSystem = null, collection = "notableCombats" } = {}) {
  const sourceNotableCombats = ((isEditMode ? sourceSystem : actor.system)?.[collection] || []);
  const combatMods = getEffectiveSkillCombatModifiers(actor);
  const toHitMod = parseInt(combatMods.toHit) || 0;
  const accuracyMod = parseInt(combatMods.accuracy) || 0;
  const diceRateMod = parseInt(combatMods.diceRate) || 0;
  const flatDamageMod = getCombatFlatDamageModifier(combatMods);
  const costModifiersByType = getCombatCostModifiers(combatMods);

  const notableCombats = (sourceNotableCombats || []).map(sourceCombat => {
    const resolved = resolveSkillUsage(sourceCombat);
    const combat = resolved.ok ? resolved.data : sourceCombat;
    const tohitValue = parseOptionalInteger(combat.tohit, { min: 1 });
    const accuracyValue = parseOptionalInteger(combat.accuracy, { allowSign: true });
    const apValue = parseOptionalInteger(combat.ap, { min: 0 });
    const spValue = parseOptionalInteger(combat.sp, { min: 0 });
    const hasBaseTohit = hasOptionalInteger(tohitValue);
    const hasBaseAccuracy = hasOptionalInteger(accuracyValue);
    const baseAccuracy = accuracyValue ?? 0;
    const baseTohit = hasBaseTohit ? tohitValue : 7;
    const combatCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
    const accuracyNum = combatCalc.accuracy;
    const modifiedTohit = combatCalc.toHit;
    const combatType = normalizeSkillTypeForCategory(combat.type, combat.category);
    const combatTypeKey = combatType.toLowerCase();
    const isSignature = isSignatureSkillType(combatType);
    const isSkillType = isSkillProgressionType(combatType);
    const typeIsCustom = !getFixedSkillTypeValue(combatType);
    const options = isSkillType
      ? getSkillTypeOptionsForCategory(combat.category, { currentType: combatType })
      : SKILL_TYPE_OPTIONS.filter(option => option.value === "skill"
        || (option.value !== "custom" && !isSkillProgressionType(option.value)));
    const typeOptions = options.map(option => ({
      ...option,
      value: option.value === "custom" && typeIsCustom ? combatType : option.value,
      selected: option.value === "custom" ? typeIsCustom : option.value === combatType
    }));
    const allowToHitAcc = isRollableSkillType(combatType);
    const isDisplayable = isNotableCombatDisplayable(combat);
    const specialGradeRaw = parseInt(combat.specialGrade);
    const specialGrade = Number.isFinite(specialGradeRaw) ? Math.max(0, specialGradeRaw) : 0;
    const hasSpecialGrade = Number.isFinite(specialGradeRaw) && specialGrade > 0;
    const rankStr = String(combat.rank ?? "").trim().toLowerCase();
    const isUntrainedRank = (rankStr === "u");
    const hasValidRank = isUntrainedRank || combat.rank === 0 || Number.isFinite(parseInt(combat.rank));

    const descriptionRaw = combat.description || "";
    const descriptionText = descriptionRaw.replace(/<[^>]*>/g, "").trim();
    const hasDescription = descriptionText.length > 0;

    let classRankDisplay = undefined;
    if (isSkillType) {
      const rankDisplay = isUntrainedRank ? "U" : (hasValidRank ? `R${combat.rank}` : "");
      classRankDisplay = `C${combat.class}${rankDisplay}`;
    }
    let specialTypeDisplay = combat.type || "";
    if (!isSkillType) {
      if (combatTypeKey === "tm" || combatTypeKey === "perk") {
        specialTypeDisplay = hasSpecialGrade ? `Grade ${specialGrade} ${combatType}` : (combat.type || "");
      } else if (combatTypeKey === "spellcraft" || combatTypeKey === "gate") {
        specialTypeDisplay = `C${combat.class}`;
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
    const hasRangeRate = hasRangeRateValue(combat.rangeRate);
    const rangeRateDisplay = formatRangeRateValue(combat.rangeRate);
    const hasDamage = hasCombatDice(combat.damage);
    const desperate = getCombatDesperateDieRateModifier(actor, combat);
    const damageDiceRateMod = diceRateMod + desperate.modifier;
    let damageDisplay = "";
    let modifiedDamageDice = 0;
    let modifiedDamageValue = 0;
    let modifiedDamageFlat = 0;
    if (hasDamage) {
      const damageResult = applyDieRate(
        combat.damage.diceCount,
        combat.damage.diceValue,
        combat.damage.flat || 0,
        damageDiceRateMod,
        combat.damage.diceBonus || 0
      );
      modifiedDamageDice = damageResult.diceCount;
      modifiedDamageValue = damageResult.diceValue;
      modifiedDamageFlat = damageResult.flat + flatDamageMod;
      damageDisplay = formatCombatDiceDisplay(modifiedDamageDice, modifiedDamageValue, modifiedDamageFlat);
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
      healDisplay = formatCombatDiceDisplay(modifiedHealDice, modifiedHealValue, modifiedHealFlat);
      if (combat.heal.type) healDisplay += ` ${combat.heal.type}`;
    }

    const hasManifest = hasCombatDice(combat.manifest);
    const hasManifestDome = hasCombatDice(combat.manifestDome);
    const hasManifestResistance = hasCombatDice(combat.manifestResistance);
    let manifestDisplay = "";
    let manifestDomeDisplay = "";
    let manifestResistanceDisplay = "";
    let modifiedManifestDice = 0;
    let modifiedManifestValue = 0;
    let modifiedManifestFlat = 0;
    const getModifiedManifest = (manifestData) => {
      const result = applyDieRate(
        manifestData.diceCount,
        manifestData.diceValue,
        manifestData.flat || 0,
        diceRateMod,
        manifestData.diceBonus || 0
      );
      const flat = result.flat + flatDamageMod;
      return {
        diceCount: result.diceCount,
        diceValue: result.diceValue,
        flat,
        display: formatCombatDiceDisplay(result.diceCount, result.diceValue, flat)
      };
    };
    if (hasManifest) {
      const manifestResult = getModifiedManifest(combat.manifest);
      modifiedManifestDice = manifestResult.diceCount;
      modifiedManifestValue = manifestResult.diceValue;
      modifiedManifestFlat = manifestResult.flat;
      manifestDisplay = manifestResult.display;
    }
    if (hasManifestDome) manifestDomeDisplay = getModifiedManifest(combat.manifestDome).display;
    if (hasManifestResistance) manifestResistanceDisplay = getModifiedManifest(combat.manifestResistance).display;

    const hasTagUses = combat.tagUses && combat.tagUses.max > 0;
    const hasSections = combat.sections && combat.sections.max > 0;
    const targetingTypeDisplay = getCombatTargetingType(combat);
    const hasTargetingType = !!targetingTypeDisplay;
    const defenseData = normalizeCombatDefense(combat.defense);
    const defenseSummary = getCombatDefenseSummary(defenseData);
    const hasDefense = defenseData.responses.length > 0;
    const hasReach = combat.reach > 0;
    const hasStability = !!combat.stability;
    const hasOverkill = !!combat.overkill;
    const tippingScales = Math.max(0, Number.parseInt(combat.tippingScales, 10) || 0);
    const magnetismGrade = getCombatMagnetismGrade(combat);
    const hasMagnetism = magnetismGrade > 0;
    const hasDesperate = desperate.value !== 0;
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
      rangeRate: { has: hasRangeRate, label: "Range-Rate", value: rangeRateDisplay },
      damage: { has: hasDamage, label: "Damage", value: damageDisplay, rollable: true },
      desperate: { has: hasDesperate, label: "Desperate", value: formatDesperateTagValue(desperate) },
      heal: { has: hasHeal, label: "Heal", value: healDisplay, rollable: true },
      manifest: { has: hasManifest, label: "Manifest", value: manifestDisplay, rollable: true },
      manifestDome: { has: hasManifestDome, label: "Manifest Dome", value: manifestDomeDisplay, rollable: true },
      manifestResistance: { has: hasManifestResistance, label: "Manifest Resistance", value: manifestResistanceDisplay, rollable: true },
      tagUses: { has: hasTagUses, label: "Uses", current: combat.tagUses?.current || 0, max: combat.tagUses?.max || 0, isUses: true },
      sections: { has: hasSections, label: "Sections", current: combat.sections?.current || 0, max: combat.sections?.max || 0, isSections: true },
      targetingType: { has: hasTargetingType, label: "", value: targetingTypeDisplay },
      defense: { has: hasDefense, label: "Defense", value: defenseSummary },
      reach: { has: hasReach, label: "Reach", value: combat.reach },
      stability: { has: hasStability, label: "Stability", value: "" },
      overkill: { has: hasOverkill, label: "Overkill", value: "" },
      magnetism: { has: hasMagnetism, label: "Magnetism", value: `Grade ${magnetismGrade}` },
      tippingScales: { has: tippingScales > 0, label: "Tipping Scales", value: tippingScales },
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
      isSkillEntry: collection === "skills",
      showInList: isEditMode || isDisplayable,
      usageId: resolved.ok ? resolved.usageId : "base",
      type: combatType,
      isSignature,
      imageSrc: getNotableCombatImage(combat),
      isSkillType,
      typeIsCustom,
      typeOptions,
      allowToHitAcc,
      classRankDisplay,
      specialTypeDisplay,
      specialGrade,
      specialGradeInput: hasSpecialGrade ? specialGrade : "",
      tohit: formatOptionalIntegerInput(tohitValue),
      accuracy: formatOptionalIntegerInput(accuracyValue, { showPlus: true }),
      ap: formatOptionalIntegerInput(apValue),
      sp: formatOptionalIntegerInput(spValue),
      hasAp: hasOptionalInteger(apValue),
      hasSp: hasOptionalInteger(spValue),
      accuracyNum,
      hasToHit: allowToHitAcc && hasBaseTohit,
      hasAccuracy: allowToHitAcc && (accuracyNum !== 0 || hasBaseAccuracy),
      accuracySign: accuracyNum >= 0 ? "+" : "",
      modifiedTohit,
      hasToHitMod: toHitMod !== 0,
      hasAccuracyMod: accuracyMod !== 0,
      hasDiceRateMod: diceRateMod !== 0,
      hasDesperateDieRateMod: desperate.modifier !== 0,
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
      rangeRate: rangeRateDisplay,
      hasDamage,
      damageDisplay,
      hasDesperate,
      desperate,
      hasHeal,
      healDisplay,
      hasManifest,
      manifestDisplay,
      hasManifestDome,
      manifestDomeDisplay,
      hasManifestResistance,
      manifestResistanceDisplay,
      hasTagUses,
      hasSections,
      hasAoe: false,
      aoeDisplay: "",
      hasTargetingType,
      hasDefense,
      defenseData,
      defenseSummary,
      hasStability,
      hasOverkill,
      hasMagnetism,
      magnetismGrade,
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
      hasTags: hasResourceCosts || hasSpeed || hasRange || hasRangeRate || hasDamage || hasDesperate || hasOverkill || hasMagnetism || tippingScales > 0 || hasHeal || hasManifest || hasManifestDome || hasManifestResistance || hasTagUses || hasSections || hasTargetingType || hasDefense || hasReach || hasStability || hasStrengthen || hasCustom || combat.self
    };
  });

  data[collection] = prepareNotableCombatTree(notableCombats, { includeHidden: isEditMode });
}

function formatDesperateTagValue(desperate) {
  const valueText = formatSignedInteger(desperate.value);
  if (desperate.filledRows <= 0) return `${valueText}/row`;
  return `${valueText}/row (${formatSignedInteger(desperate.modifier)})`;
}

function formatSignedInteger(value) {
  return value > 0 ? `+${value}` : String(value);
}
