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

export function prepareActorSkillContext(data, actor, { logger = null } = {}) {
  const sourceSkills = (actor.system.skills || []);
  const skillCombatMods = actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
  const skillToHitMod = parseInt(skillCombatMods.toHit) || 0;
  const skillAccuracyMod = parseInt(skillCombatMods.accuracy) || 0;

  try { logger?.debug?.("PeasantActorSheet.getData: using actor.skills", sourceSkills.map(s => ({ name: s.name, sig: !!s.sig }))); } catch (e) {}
  data.skills = (sourceSkills || []).map(skill => {
    const baseAccuracy = parseInt(skill.accuracy) || 0;
    const baseTohit = Number.isFinite(parseInt(skill.tohit)) ? parseInt(skill.tohit) : 7;
    const skillCalc = applyToHitAccuracy(baseTohit, baseAccuracy, skillToHitMod, skillAccuracyMod, 2);
    const accuracyNum = skillCalc.accuracy;
    const modifiedTohit = skillCalc.toHit;
    const isStandard = !skill.type || skill.type === "standard";
    const skillType = String(skill.type || "").trim();
    const skillTypeKey = skillType.toLowerCase();
    const noToHitTypes = new Set(["stance", "perk", "style", "cantrip", "tm"]);
    const allowToHitAcc = isStandard || !noToHitTypes.has(skillTypeKey);
    let isDisplayable = false;
    const specialGradeRaw = parseInt(skill.specialGrade);
    const specialGrade = Number.isFinite(specialGradeRaw) ? Math.max(0, specialGradeRaw) : 0;
    const hasSpecialGrade = Number.isFinite(specialGradeRaw) && specialGrade > 0;
    const rankStr = String(skill.rank ?? "").trim().toLowerCase();
    const isUntrainedRank = (rankStr === "u");
    const hasValidRank = isUntrainedRank || skill.rank === 0 || Number.isFinite(parseInt(skill.rank));

    if (isStandard) {
      isDisplayable = skill.class && hasValidRank && skill.name && skill.tohit;
    } else {
      isDisplayable = skill.name;
    }

    const descriptionRaw = skill.description || "";
    const descriptionText = descriptionRaw.replace(/<[^>]*>/g, "").trim();
    const hasDescription = descriptionText.length > 0;

    let classRankDisplay = undefined;
    if (isStandard) {
      const rankDisplay = isUntrainedRank ? "U" : (hasValidRank ? `R${skill.rank}` : "");
      classRankDisplay = `C${skill.class}${rankDisplay}`;
    }
    let specialTypeDisplay = skill.type || "";
    if (!isStandard) {
      if (skillTypeKey === "tm" || skillTypeKey === "perk") {
        specialTypeDisplay = hasSpecialGrade ? `Grade ${specialGrade} ${skillType}` : (skill.type || "");
      } else if (skillTypeKey === "spellcraft" || skillTypeKey === "gate") {
        specialTypeDisplay = hasSpecialGrade ? `C${specialGrade}` : "C";
      }
    }

    return {
      ...skill,
      isStandard,
      allowToHitAcc,
      classRankDisplay,
      specialTypeDisplay,
      specialGrade,
      specialGradeInput: hasSpecialGrade ? specialGrade : "",
      accuracy: skill.accuracy || "",
      accuracyNum,
      hasToHit: allowToHitAcc && !!skill.tohit,
      modifiedTohit,
      hasAccuracy: allowToHitAcc && (accuracyNum !== 0 || baseAccuracy !== 0),
      accuracySign: accuracyNum >= 0 ? "+" : "",
      ap: skill.ap || "",
      usesMax: skill.usesMax || 0,
      usesCurrent: skill.usesCurrent || 0,
      sp: skill.sp || "",
      hasAp: !!skill.ap,
      hasSp: !!skill.sp,
      hasDescription,
      isDisplayable,
      isUntrainedRank
    };
  });
}
