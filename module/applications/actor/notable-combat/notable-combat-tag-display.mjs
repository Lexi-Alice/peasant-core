import { getCombatDefenseSummary } from "../../../data/actor/combat-defense.mjs";
import { COMBAT_EDITOR_TAG_TYPES, getCombatCustomTags } from "../../../data/actor/combat-tags.mjs";
import { formatCombatDiceValue, hasCombatDice } from "../../../dice/combat-dice.mjs";

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
      return (combatData.rangeRate && combatData.rangeRate !== "///") ? `Range-Rate: ${combatData.rangeRate}` : null;
    case "damage":
      if (hasCombatDice(combatData.damage)) {
        let str = `Damage: ${combatData.damage.diceCount}d${formatCombatDiceValue(combatData.damage.diceValue, combatData.damage.diceBonus)}`;
        if (combatData.damage.flat) str += combatData.damage.flat > 0 ? `+${combatData.damage.flat}` : `${combatData.damage.flat}`;
        if (combatData.damage.type) str += ` ${combatData.damage.type}`;
        return str;
      }
      return null;
    case "heal":
      if (hasCombatDice(combatData.heal)) {
        let str = `Heal: ${combatData.heal.diceCount}d${formatCombatDiceValue(combatData.heal.diceValue, combatData.heal.diceBonus)}`;
        if (combatData.heal.flat) str += combatData.heal.flat > 0 ? `+${combatData.heal.flat}` : `${combatData.heal.flat}`;
        if (combatData.heal.type) str += ` ${combatData.heal.type}`;
        return str;
      }
      return null;
    case "manifest":
      if (hasCombatDice(combatData.manifest)) {
        let str = `Manifest: ${combatData.manifest.diceCount}d${formatCombatDiceValue(combatData.manifest.diceValue, combatData.manifest.diceBonus)}`;
        if (combatData.manifest.flat) str += combatData.manifest.flat > 0 ? `+${combatData.manifest.flat}` : `${combatData.manifest.flat}`;
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
