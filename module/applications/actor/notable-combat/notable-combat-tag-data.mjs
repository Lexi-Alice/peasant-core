import {
  COMBAT_DEFENSE_RESPONSE_OPTIONS,
  createDefaultCombatDefense,
  normalizeCombatDefense,
  normalizeCombatDefenseBlockType,
  normalizeCombatDefenseShieldArm,
  parseCombatDefenseMosPer
} from "../../../data/actor/combat-defense.mjs";
import { hasRangeRateValue, normalizeCombatTargetingType, normalizeRangeRateValue } from "../../../data/actor/combat-tags.mjs";
import { parseCombatDiceValue } from "../../../dice/combat-dice.mjs";
import { qs, qsa, toElement } from "../../dom.mjs";

export function collectNotableCombatTagData(container, tagType, { combatData = {} } = {}) {
  const root = toElement(container);

  switch (tagType) {
    case "resourceCosts": {
      const costs = [];
      for (const row of qsa(root, ".resource-cost-row")) {
        const rcType = fieldValue(row, ".tag-rc-type");
        const rcValue = fieldInt(row, ".tag-rc-value");
        const rcDmgType = fieldValue(row, ".tag-rc-dmgtype");
        if (rcType && rcValue > 0) {
          costs.push({ type: rcType, value: rcValue, damageType: rcDmgType });
        }
      }
      return costs.length > 0 ? validTagData({ resourceCosts: costs }) : invalidTagData();
    }
    case "speed": {
      const speedType = fieldValue(root, ".tag-speed-type");
      if (!speedType) return invalidTagData();
      const speedData = { type: speedType, splitSecondCurrent: 0, splitSecondMax: 0 };
      if (speedType === "Split Second") {
        const maxUses = fieldInt(root, ".tag-speed-max", 1);
        speedData.splitSecondMax = maxUses;
        speedData.splitSecondCurrent = maxUses;
      }
      return validTagData({ speed: speedData });
    }
    case "staminaCost": {
      const staminaVal = fieldInt(root, ".tag-stamina-cost", Number.NaN);
      return !Number.isNaN(staminaVal) && staminaVal > 0 ? validTagData({ staminaCost: staminaVal }) : invalidTagData();
    }
    case "attunementCost": {
      const attunementVal = fieldInt(root, ".tag-attunement-cost", Number.NaN);
      return !Number.isNaN(attunementVal) && attunementVal > 0 ? validTagData({ attunementCost: attunementVal }) : invalidTagData();
    }
    case "range": {
      const rangeVal = fieldInt(root, ".tag-range", Number.NaN);
      return !Number.isNaN(rangeVal) && rangeVal > 0 ? validTagData({ range: rangeVal }) : invalidTagData();
    }
    case "rangeRate": {
      const rr1 = fieldValue(root, ".tag-rr-1");
      const rr2 = fieldValue(root, ".tag-rr-2");
      const rr3 = fieldValue(root, ".tag-rr-3");
      const rr4 = fieldValue(root, ".tag-rr-4");
      const rangeRate = normalizeRangeRateValue([rr1, rr2, rr3, rr4]);
      return hasRangeRateValue(rangeRate) ? validTagData({ rangeRate }) : invalidTagData();
    }
    case "damage": {
      const dmgDice = fieldInt(root, ".tag-dmg-dice", Number.NaN);
      const dmgValueData = fieldCombatDiceValue(root, ".tag-dmg-value");
      const dmgValue = dmgValueData.diceValue;
      if (!Number.isFinite(dmgDice) || dmgDice < 0 || !Number.isFinite(dmgValue) || dmgValue < 0) return invalidTagData();
      return validTagData({
        damage: {
          diceCount: dmgDice,
          diceValue: dmgValue,
          diceBonus: dmgValueData.diceBonus,
          flat: fieldInt(root, ".tag-dmg-flat"),
          type: fieldValue(root, ".tag-dmg-type")
        }
      });
    }
    case "desperate": {
      const value = fieldInt(root, ".tag-desperate", Number.NaN);
      return Number.isFinite(value) && value !== 0
        ? validTagData({ desperate: value })
        : invalidTagData("Desperate requires a nonzero positive or negative integer.");
    }
    case "heal": {
      const healDice = fieldInt(root, ".tag-heal-dice", Number.NaN);
      const healValueData = fieldCombatDiceValue(root, ".tag-heal-value");
      const healValue = healValueData.diceValue;
      if (!Number.isFinite(healDice) || healDice < 0 || !Number.isFinite(healValue) || healValue < 0) return invalidTagData();
      return validTagData({
        heal: {
          diceCount: healDice,
          diceValue: healValue,
          diceBonus: healValueData.diceBonus,
          flat: fieldInt(root, ".tag-heal-flat"),
          type: fieldValue(root, ".tag-heal-type")
        }
      });
    }
    case "manifest": {
      const maniDice = fieldInt(root, ".tag-mani-dice", Number.NaN);
      const maniValueData = fieldCombatDiceValue(root, ".tag-mani-value");
      const maniValue = maniValueData.diceValue;
      if (!Number.isFinite(maniDice) || maniDice < 0 || !Number.isFinite(maniValue) || maniValue < 0) return invalidTagData();
      return validTagData({
        manifest: {
          diceCount: maniDice,
          diceValue: maniValue,
          diceBonus: maniValueData.diceBonus,
          flat: fieldInt(root, ".tag-mani-flat")
        }
      });
    }
    case "tagUses": {
      const maxUses = fieldInt(root, ".tag-uses-max");
      return maxUses > 0 ? validTagData({ tagUses: { current: maxUses, max: maxUses } }) : invalidTagData();
    }
    case "sections": {
      const maxSections = fieldInt(root, ".tag-sections-max");
      return maxSections > 0 ? validTagData({ sections: { current: maxSections, max: maxSections } }) : invalidTagData();
    }
    case "targetingType": {
      const targetType = normalizeCombatTargetingType(fieldValue(root, ".tag-targeting-type"));
      return targetType ? validTagData({ targetingType: targetType }) : invalidTagData();
    }
    case "defense": {
      const selectedResponses = COMBAT_DEFENSE_RESPONSE_OPTIONS
        .filter((option) => fieldChecked(root, `.tag-defense-response[data-defense-key="${option.key}"]`))
        .map((option) => option.label);

      if (selectedResponses.length === 0) {
        return invalidTagData("Defense requires at least one response type.");
      }

      const defense = createDefaultCombatDefense();
      defense.responses = selectedResponses;
      const isBlock = fieldChecked(root, ".tag-defense-block");
      const appliesDebuff = fieldChecked(root, ".tag-defense-applies-debuff");
      defense.block = isBlock;
      defense.blockType = isBlock ? normalizeCombatDefenseBlockType(fieldValue(root, ".tag-defense-block-type")) : "Shield";
      defense.shieldArm = defense.blockType === "Shield"
        ? normalizeCombatDefenseShieldArm(fieldValue(root, ".tag-defense-shield-arm"))
        : "LeftArm";
      defense.appliesDebuff = appliesDebuff;
      defense.debuffToHit = appliesDebuff ? fieldInt(root, ".tag-defense-debuff-tohit") : 0;
      defense.appliesBefore = appliesDebuff && fieldChecked(root, ".tag-defense-applies-before");

      for (const option of COMBAT_DEFENSE_RESPONSE_OPTIONS) {
        if (!selectedResponses.includes(option.label)) continue;
        const row = qs(root, `.defense-effectiveness-row[data-defense-key="${option.key}"]`);
        defense.effectiveness[option.key] = {
          mosPer: parseCombatDefenseMosPer(fieldValue(row, ".tag-defense-mos-per")),
          accuracyPenalty: fieldInt(row, ".tag-defense-accuracy-penalty")
        };
      }

      if (isBlock) {
        if (defense.blockType === "Shield" || defense.blockType === "Weapon") {
          defense.hardness = Math.max(0, fieldInt(root, ".tag-defense-hardness"));
        }
        defense.hp = defense.blockType === "Weapon" ? 0 : Math.max(0, fieldInt(root, ".tag-defense-hp"));
        defense.masteryBonus = defense.blockType === "Weapon" && fieldChecked(root, ".tag-defense-mastery-bonus");
      }

      return validTagData({ defense: normalizeCombatDefense(defense) });
    }
    case "reach": {
      const reachVal = fieldInt(root, ".tag-reach", Number.NaN);
      return !Number.isNaN(reachVal) && reachVal > 0 ? validTagData({ reach: reachVal }) : invalidTagData();
    }
    case "stability":
      return validTagData({});
    case "overkill":
      return validTagData({});
    case "magnetism": {
      const grade = fieldInt(root, ".tag-magnetism-grade", Number.NaN);
      return Number.isFinite(grade) && grade > 0
        ? validTagData({ magnetism: { grade } })
        : invalidTagData("Magnetism requires a grade of 1 or higher.");
    }
    case "strengthen":
      return combatData.stability
        ? validTagData({})
        : invalidTagData("Strengthen requires Stability on this notable entry.");
    case "custom": {
      const customName = fieldValue(root, ".tag-custom-name").trim();
      const customValue = fieldValue(root, ".tag-custom-value").trim();
      return customName ? validTagData({ name: customName, value: customValue || "" }) : invalidTagData();
    }
    case "self":
      return validTagData({});
    default:
      return invalidTagData();
  }
}

function fieldValue(root, selector, fallback = "") {
  return String(qs(root, selector)?.value ?? fallback);
}

function fieldInt(root, selector, fallback = 0) {
  const value = Number.parseInt(fieldValue(root, selector, ""), 10);
  return Number.isNaN(value) ? fallback : value;
}

function fieldCombatDiceValue(root, selector) {
  const rawValue = fieldValue(root, selector).trim();
  if (!rawValue || Number.isNaN(Number.parseInt(rawValue, 10))) {
    return { diceValue: Number.NaN, diceBonus: 0 };
  }
  return parseCombatDiceValue(rawValue);
}

function fieldChecked(root, selector) {
  return !!qs(root, selector)?.checked;
}

function validTagData(tagData) {
  return { tagAdded: true, tagData };
}

function invalidTagData(warning = "Please enter valid values for the tag.") {
  return { tagAdded: false, tagData: {}, warning };
}
