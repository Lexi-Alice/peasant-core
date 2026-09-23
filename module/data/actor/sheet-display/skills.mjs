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
  getEffectiveSkillCombatModifiers,
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
import { formatOptionalIntegerInput, hasOptionalInteger, parseOptionalInteger } from "../helpers.mjs";
import { getWoundThresholdMultipliers } from "../targeted-damage.mjs";
import { applyDieRate, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../../dice/roll-targets.mjs";
import {
  getFixedSkillTypeValue,
  getSkillTypeOptionsForCategory,
  isRollableSkillType,
  isSkillProgressionType,
  isSignatureSkillType,
  normalizeSkillTypeForCategory
} from "../skill-entry-types.mjs";
import { resolveSkillUsage } from "../skill-entries.mjs";

export function prepareActorSkillContext(data, actor, { logger = null, isEditMode = false, sourceSystem = null } = {}) {
  const sourceSkills = ((isEditMode ? sourceSystem : actor.system)?.skills || []);
  const skillCombatMods = getEffectiveSkillCombatModifiers(actor);
  const skillToHitMod = parseInt(skillCombatMods.toHit) || 0;
  const skillAccuracyMod = parseInt(skillCombatMods.accuracy) || 0;

  try { logger?.debug?.("PeasantActorSheet.getData: using actor.skills", sourceSkills.map(s => ({ name: s.name, type: s.type }))); } catch (e) {}
  data.skills = (sourceSkills || []).map(sourceSkill => {
    const resolved = resolveSkillUsage(sourceSkill);
    const skill = resolved.ok ? resolved.data : sourceSkill;
    const tohitValue = parseOptionalInteger(skill.tohit, { min: 1 });
    const accuracyValue = parseOptionalInteger(skill.accuracy, { allowSign: true });
    const apValue = parseOptionalInteger(skill.ap, { min: 0 });
    const spValue = parseOptionalInteger(skill.sp, { min: 0 });
    const hasBaseTohit = hasOptionalInteger(tohitValue);
    const hasBaseAccuracy = hasOptionalInteger(accuracyValue);
    const baseAccuracy = accuracyValue ?? 0;
    const baseTohit = hasBaseTohit ? tohitValue : 7;
    const skillCalc = applyToHitAccuracy(baseTohit, baseAccuracy, skillToHitMod, skillAccuracyMod, 2);
    const accuracyNum = skillCalc.accuracy;
    const modifiedTohit = skillCalc.toHit;
    const skillType = normalizeSkillTypeForCategory(skill.type, skill.category);
    const skillTypeKey = skillType.toLowerCase();
    const isSignature = isSignatureSkillType(skillType);
    const isSkillType = isSkillProgressionType(skillType);
    const typeIsCustom = !getFixedSkillTypeValue(skillType);
    const typeOptions = getSkillTypeOptionsForCategory(skill.category, { currentType: skillType }).map(option => ({
      ...option,
      value: option.value === "custom" && typeIsCustom ? skillType : option.value,
      selected: option.value === "custom" ? typeIsCustom : option.value === skillType
    }));
    const allowToHitAcc = isRollableSkillType(skillType);
    let isDisplayable = false;
    const specialGradeRaw = parseInt(skill.specialGrade);
    const specialGrade = Number.isFinite(specialGradeRaw) ? Math.max(0, specialGradeRaw) : 0;
    const hasSpecialGrade = Number.isFinite(specialGradeRaw) && specialGrade > 0;
    const rankStr = String(skill.rank ?? "").trim().toLowerCase();
    const isUntrainedRank = (rankStr === "u");
    const hasValidRank = isUntrainedRank || skill.rank === 0 || Number.isFinite(parseInt(skill.rank));

    if (isSkillType) {
      isDisplayable = skill.class && hasValidRank && skill.name && hasBaseTohit;
    } else {
      isDisplayable = skill.name;
    }

    const descriptionRaw = skill.description || "";
    const descriptionText = descriptionRaw.replace(/<[^>]*>/g, "").trim();
    const hasDescription = descriptionText.length > 0;

    let classRankDisplay = undefined;
    if (isSkillType) {
      const rankDisplay = isUntrainedRank ? "U" : (hasValidRank ? `R${skill.rank}` : "");
      classRankDisplay = `C${skill.class}${rankDisplay}`;
    }
    let specialTypeDisplay = skill.type || "";
    if (!isSkillType) {
      if (skillTypeKey === "tm" || skillTypeKey === "perk") {
        specialTypeDisplay = hasSpecialGrade ? `Grade ${specialGrade} ${skillType}` : (skill.type || "");
      } else if (skillTypeKey === "spellcraft" || skillTypeKey === "gate") {
        specialTypeDisplay = `C${skill.class}`;
      }
    }

    return {
      ...skill,
      usageId: resolved.ok ? resolved.usageId : "base",
      type: skillType,
      isSignature,
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
      accuracyNum,
      hasToHit: allowToHitAcc && hasBaseTohit,
      modifiedTohit,
      hasAccuracy: allowToHitAcc && (accuracyNum !== 0 || hasBaseAccuracy),
      accuracySign: accuracyNum >= 0 ? "+" : "",
      ap: formatOptionalIntegerInput(apValue),
      usesMax: skill.usesMax || 0,
      usesCurrent: skill.usesCurrent || 0,
      sp: formatOptionalIntegerInput(spValue),
      hasAp: hasOptionalInteger(apValue),
      hasSp: hasOptionalInteger(spValue),
      hasDescription,
      isDisplayable,
      isUntrainedRank
    };
  });
}
