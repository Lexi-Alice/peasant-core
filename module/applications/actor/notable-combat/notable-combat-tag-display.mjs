import { getCombatDefenseSummary } from "../../../data/actor/combat-defense.mjs";
import { COMBAT_FULL_TAG_ORDER, formatRangeRateValue, getCombatCustomTags, getCombatTargetingType, hasRangeRateValue } from "../../../data/actor/combat-tags.mjs";
import { formatCombatDiceDisplay, hasCombatDice } from "../../../dice/combat-dice.mjs";

export function getActiveNotableCombatEditorTags(combatData) {
  const rawTagOrder = Array.isArray(combatData?.tagOrder) ? combatData.tagOrder : [];
  const hasCustomOrder = rawTagOrder.length > 0;
  const tagOrder = hasCustomOrder
    ? rawTagOrder.filter((tagType) => COMBAT_FULL_TAG_ORDER.includes(tagType))
    : [...COMBAT_FULL_TAG_ORDER];

  for (const tagType of COMBAT_FULL_TAG_ORDER) {
    if (!tagOrder.includes(tagType)) tagOrder.push(tagType);
  }

  const activeTags = [];
  for (const tagType of tagOrder) {
    if (tagType === "description") continue;
    if (tagType === "custom") {
      const customTags = getCombatCustomTags(combatData);
      customTags.forEach((tag, customIndex) => {
        const customId = String(tag.id || customIndex);
        activeTags.push({
          kind: "tag",
          type: "custom",
          key: `custom:${customId}`,
          label: tag.name,
          summary: tag.value || "",
          display: tag.value ? `${tag.name}: ${tag.value}` : tag.name,
          customIndex,
          customId
        });
      });
      continue;
    }
    const display = formatNotableCombatEditorTagValue(tagType, combatData);
    if (display) {
      const label = getNotableCombatTagLabel(tagType);
      const prefix = `${label}: `;
      activeTags.push({
        kind: "tag",
        type: tagType,
        key: tagType,
        label,
        summary: display.startsWith(prefix) ? display.slice(prefix.length) : (display === label ? "" : display),
        display
      });
    }
  }

  const layout = Array.isArray(combatData?.layout)
    ? combatData.layout
    : (Array.isArray(combatData?.baseUsage?.layout) ? combatData.baseUsage.layout : []);
  if (!layout.length) return activeTags;

  const byKey = new Map(activeTags.map(tag => [tag.key, tag]));
  const rendered = [];
  for (const row of layout) {
    const tag = byKey.get(row?.key);
    if (!tag) continue;
    rendered.push(tag);
    byKey.delete(row.key);
  }
  rendered.push(...byKey.values());
  return rendered;
}

export function getNotableCombatTagLabel(tagType) {
  return ({
    resourceCosts: "Resource Costs",
    speed: "Speed",
    staminaCost: "Stamina Cost",
    attunementCost: "Attunement Cost",
    range: "Range",
    rangeRate: "Range-Rate",
    damage: "Damage",
    desperate: "Desperate",
    overkill: "Overkill",
    magnetism: "Magnetism",
    tippingScales: "Tipping Scales",
    heal: "Heal",
    manifest: "Manifest",
    manifestDome: "Manifest Dome",
    manifestResistance: "Manifest Resistance",
    tagUses: "Uses",
    sections: "Sections",
    targetingType: "Targeting",
    defense: "Defense",
    reach: "Reach",
    stability: "Stability",
    strengthen: "Strengthen",
    custom: "Custom",
    self: "Self"
  })[tagType] || tagType;
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
    case "desperate": {
      const value = Number.parseInt(combatData.desperate, 10) || 0;
      return value !== 0 ? `Desperate: ${formatSignedInteger(value)} per filled row` : null;
    }
    case "heal":
      if (hasCombatDice(combatData.heal)) {
        let str = `Heal: ${formatCombatDiceDisplay(combatData.heal.diceCount, combatData.heal.diceValue, combatData.heal.flat, combatData.heal.diceBonus)}`;
        if (combatData.heal.type) str += ` ${combatData.heal.type}`;
        return str;
      }
      return null;
    case "manifest":
    case "manifestDome":
    case "manifestResistance": {
      const manifestData = combatData[tagType];
      if (hasCombatDice(manifestData)) {
        const label = tagType === "manifestDome"
          ? "Manifest Dome"
          : (tagType === "manifestResistance" ? "Manifest Resistance" : "Manifest");
        const str = `${label}: ${formatCombatDiceDisplay(manifestData.diceCount, manifestData.diceValue, manifestData.flat, manifestData.diceBonus)}`;
        return str;
      }
      return null;
    }
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
    case "targetingType":
      return getCombatTargetingType(combatData) || null;
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
    case "tippingScales": {
      const penetration = Number.parseInt(combatData.tippingScales, 10) || 0;
      return penetration > 0 ? `Tipping Scales: ${penetration}` : null;
    }
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

function formatSignedInteger(value) {
  return value > 0 ? `+${value}` : String(value);
}
