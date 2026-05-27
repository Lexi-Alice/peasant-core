import { getCombatDefenseSummary } from "../../../data/actor/combat-defense.mjs";
import { COMBAT_EDITOR_TAG_TYPES, formatRangeRateValue, getCombatCustomTags, hasRangeRateValue } from "../../../data/actor/combat-tags.mjs";
import { formatCombatDiceDisplay, hasCombatDice } from "../../../dice/combat-dice.mjs";

export function getActiveNotableCombatEditorTags(combatData) {
  const rawTagOrder = Array.isArray(combatData?.tagOrder) ? combatData.tagOrder : [];
  const hasCustomOrder = rawTagOrder.length > 0;
  const tagOrder = hasCustomOrder ? [...rawTagOrder] : [...COMBAT_EDITOR_TAG_TYPES];

  for (const tagType of COMBAT_EDITOR_TAG_TYPES) {
    if (!tagOrder.includes(tagType)) tagOrder.push(tagType);
  }

  const activeTags = [];
  for (const tagType of tagOrder) {
    if (tagType === "custom") {
      const customTags = getCombatCustomTags(combatData);
      customTags.forEach((tag, customIndex) => {
        const display = tag.value ? `${tag.name}: ${tag.value}` : tag.name;
        activeTags.push({ type: "custom", display, customIndex });
      });
      continue;
    }
    const display = formatNotableCombatEditorTagValue(tagType, combatData);
    if (display) activeTags.push({ type: tagType, display });
  }
  return activeTags;
}

export function formatNotableCombatEditorTagValue(tagType, combatData = {}) {
  switch (tagType) {
    case "description": {
      const descText = (combatData.description || "").replace(/<[^>]*>/g, "").trim();
      return descText ? "Description" : null;
    }
    case "resourceCosts":
      if (Array.isArray(combatData.resourceCosts) && combatData.resourceCosts.length > 0) {
        const costs = combatData.resourceCosts.filter(rc => rc.type && rc.value > 0);
        if (costs.length > 0) {
          return "Resource Costs: " + costs.map(rc => {
            let label = rc.type;
            if (rc.type === "HP" && rc.damageType) label = `${rc.damageType} HP`;
            return `${label} ${rc.value}`;
          }).join(", ");
        }
      }
      return null;
    case "speed":
      if (combatData.speed && combatData.speed.type) {
        if (combatData.speed.type === "Split Second") {
          return `Speed: Split Second (${combatData.speed.splitSecondCurrent || 0}/${combatData.speed.splitSecondMax || 0})`;
        }
        return `Speed: ${combatData.speed.type}`;
      }
      return null;
    case "staminaCost":
      return combatData.staminaCost > 0 ? `Stamina Cost: ${combatData.staminaCost}` : null;
    case "attunementCost":
      return combatData.attunementCost > 0 ? `Attunement Cost: ${combatData.attunementCost}` : null;
    case "range":
      return combatData.range > 0 ? `Range: ${combatData.range}` : null;
    case "rangeRate":
      return hasRangeRateValue(combatData.rangeRate) ? `Range-Rate: ${formatRangeRateValue(combatData.rangeRate)}` : null;
    case "damage":
      if (hasCombatDice(combatData.damage)) {
        let str = `Damage: ${formatCombatDiceDisplay(combatData.damage.diceCount, combatData.damage.diceValue, combatData.damage.flat, combatData.damage.diceBonus)}`;
        if (combatData.damage.type) str += ` ${combatData.damage.type}`;
        return str;
      }
      return null;
    case "heal":
      if (hasCombatDice(combatData.heal)) {
        let str = `Heal: ${formatCombatDiceDisplay(combatData.heal.diceCount, combatData.heal.diceValue, combatData.heal.flat, combatData.heal.diceBonus)}`;
        if (combatData.heal.type) str += ` ${combatData.heal.type}`;
        return str;
      }
      return null;
    case "manifest":
      if (hasCombatDice(combatData.manifest)) {
        const str = `Manifest: ${formatCombatDiceDisplay(combatData.manifest.diceCount, combatData.manifest.diceValue, combatData.manifest.flat, combatData.manifest.diceBonus)}`;
        return str;
      }
      return null;
    case "tagUses":
      if (combatData.tagUses && combatData.tagUses.max > 0) {
        return `Uses: ${combatData.tagUses.current}/${combatData.tagUses.max}`;
      }
      return null;
    case "sections":
      if (combatData.sections && combatData.sections.max > 0) {
        return `Sections: ${combatData.sections.current}/${combatData.sections.max}`;
      }
      return null;
    case "aoe":
      if (combatData.aoe && combatData.aoe.value > 0) {
        let str = `AoE: ${combatData.aoe.value}`;
        if (combatData.aoe.type && combatData.aoe.type !== "Area") str += ` ${combatData.aoe.type}`;
        return str;
      }
      return null;
    case "targetingType":
      return combatData.targetingType ? `${combatData.targetingType}` : null;
    case "defense": {
      const summary = getCombatDefenseSummary(combatData.defense);
      return summary ? `Defense: ${summary}` : null;
    }
    case "reach":
      return combatData.reach > 0 ? `Reach: ${combatData.reach}` : null;
    case "stability":
      return combatData.stability ? "Stability" : null;
    case "overkill":
      return combatData.overkill ? "Overkill" : null;
    case "magnetism": {
      const grade = Number.parseInt(combatData.magnetism?.grade, 10) || 0;
      return grade > 0 ? `Magnetism: Grade ${grade}` : null;
    }
    case "strengthen":
      return combatData.strengthen ? "Strengthen" : null;
    case "custom":
      return null;
    case "self":
      return combatData.self ? "Self" : null;
    default:
      return null;
  }
}
