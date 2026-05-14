import {
  COMBAT_DEFENSE_RESPONSE_OPTIONS,
  createDefaultCombatDefense,
  normalizeCombatDefense,
  normalizeCombatDefenseBlockType,
  parseCombatDefenseMosPer
} from "../../../data/actor/combat-defense.mjs";
import { parseCombatDiceValue } from "../../../dice/combat-dice.mjs";

export function collectNotableCombatTagData($container, tagType, { combatData = {} } = {}) {
  switch (tagType) {
    case "resourceCosts": {
      const costs = [];
      $container.find(".resource-cost-row").each((_, row) => {
        const $row = $(row);
        const rcType = $row.find(".tag-rc-type").val();
        const rcValue = parseInt($row.find(".tag-rc-value").val()) || 0;
        const rcDmgType = $row.find(".tag-rc-dmgtype").val() || "";
        if (rcType && rcValue > 0) {
          costs.push({ type: rcType, value: rcValue, damageType: rcDmgType });
        }
      });
      return costs.length > 0 ? validTagData({ resourceCosts: costs }) : invalidTagData();
    }
    case "speed": {
      const speedType = $container.find(".tag-speed-type").val();
      if (!speedType) return invalidTagData();
      const speedData = { type: speedType, splitSecondCurrent: 0, splitSecondMax: 0 };
      if (speedType === "Split Second") {
        const maxUses = parseInt($container.find(".tag-speed-max").val()) || 1;
        speedData.splitSecondMax = maxUses;
        speedData.splitSecondCurrent = maxUses;
      }
      return validTagData({ speed: speedData });
    }
    case "staminaCost": {
      const staminaVal = parseInt($container.find(".tag-stamina-cost").val());
      return !Number.isNaN(staminaVal) && staminaVal > 0 ? validTagData({ staminaCost: staminaVal }) : invalidTagData();
    }
    case "attunementCost": {
      const attunementVal = parseInt($container.find(".tag-attunement-cost").val());
      return !Number.isNaN(attunementVal) && attunementVal > 0 ? validTagData({ attunementCost: attunementVal }) : invalidTagData();
    }
    case "range": {
      const rangeVal = parseInt($container.find(".tag-range").val());
      return !Number.isNaN(rangeVal) && rangeVal > 0 ? validTagData({ range: rangeVal }) : invalidTagData();
    }
    case "rangeRate": {
      const rr1 = $container.find(".tag-rr-1").val() || "";
      const rr2 = $container.find(".tag-rr-2").val() || "";
      const rr3 = $container.find(".tag-rr-3").val() || "";
      const rr4 = $container.find(".tag-rr-4").val() || "";
      const rrVal = `${rr1}/${rr2}/${rr3}/${rr4}`;
      return rrVal !== "///" ? validTagData({ rangeRate: rrVal }) : invalidTagData();
    }
    case "damage": {
      const dmgDice = parseInt($container.find(".tag-dmg-dice").val()) || 0;
      const dmgValueData = parseCombatDiceValue($container.find(".tag-dmg-value").val());
      const dmgValue = dmgValueData.diceValue;
      if (dmgDice <= 0 || dmgValue <= 0) return invalidTagData();
      return validTagData({
        damage: {
          diceCount: dmgDice,
          diceValue: dmgValue,
          diceBonus: dmgValueData.diceBonus,
          flat: parseInt($container.find(".tag-dmg-flat").val()) || 0,
          type: $container.find(".tag-dmg-type").val() || ""
        }
      });
    }
    case "heal": {
      const healDice = parseInt($container.find(".tag-heal-dice").val()) || 0;
      const healValueData = parseCombatDiceValue($container.find(".tag-heal-value").val());
      const healValue = healValueData.diceValue;
      if (healDice <= 0 || healValue <= 0) return invalidTagData();
      return validTagData({
        heal: {
          diceCount: healDice,
          diceValue: healValue,
          diceBonus: healValueData.diceBonus,
          flat: parseInt($container.find(".tag-heal-flat").val()) || 0,
          type: $container.find(".tag-heal-type").val() || ""
        }
      });
    }
    case "manifest": {
      const maniDice = parseInt($container.find(".tag-mani-dice").val()) || 0;
      const maniValueData = parseCombatDiceValue($container.find(".tag-mani-value").val());
      const maniValue = maniValueData.diceValue;
      if (maniDice <= 0 || maniValue <= 0) return invalidTagData();
      return validTagData({
        manifest: {
          diceCount: maniDice,
          diceValue: maniValue,
          diceBonus: maniValueData.diceBonus,
          flat: parseInt($container.find(".tag-mani-flat").val()) || 0
        }
      });
    }
    case "tagUses": {
      const maxUses = parseInt($container.find(".tag-uses-max").val()) || 0;
      return maxUses > 0 ? validTagData({ tagUses: { current: maxUses, max: maxUses } }) : invalidTagData();
    }
    case "sections": {
      const maxSections = parseInt($container.find(".tag-sections-max").val()) || 0;
      return maxSections > 0 ? validTagData({ sections: { current: maxSections, max: maxSections } }) : invalidTagData();
    }
    case "aoe": {
      const aoeVal = parseInt($container.find(".tag-aoe-value").val()) || 0;
      return aoeVal > 0 ? validTagData({ aoe: { value: aoeVal, type: $container.find(".tag-aoe-type").val() || "Area" } }) : invalidTagData();
    }
    case "targetingType": {
      const targetType = $container.find(".tag-targeting-type").val();
      return targetType ? validTagData({ targetingType: targetType }) : invalidTagData();
    }
    case "defense": {
      const selectedResponses = COMBAT_DEFENSE_RESPONSE_OPTIONS
        .filter((option) => $container.find(`.tag-defense-response[data-defense-key="${option.key}"]`).is(":checked"))
        .map((option) => option.label);

      if (selectedResponses.length === 0) {
        return invalidTagData("Defense requires at least one response type.");
      }

      const defense = createDefaultCombatDefense();
      defense.responses = selectedResponses;
      const isBlock = !!$container.find(".tag-defense-block").is(":checked");
      const appliesDebuff = !!$container.find(".tag-defense-applies-debuff").is(":checked");
      defense.block = isBlock;
      defense.blockType = isBlock ? normalizeCombatDefenseBlockType($container.find(".tag-defense-block-type").val()) : "Shield";
      defense.appliesDebuff = appliesDebuff;
      defense.debuffToHit = appliesDebuff ? (Number.parseInt($container.find(".tag-defense-debuff-tohit").val(), 10) || 0) : 0;
      defense.appliesBefore = appliesDebuff && !!$container.find(".tag-defense-applies-before").is(":checked");

      for (const option of COMBAT_DEFENSE_RESPONSE_OPTIONS) {
        if (!selectedResponses.includes(option.label)) continue;
        const $row = $container.find(`.defense-effectiveness-row[data-defense-key="${option.key}"]`);
        defense.effectiveness[option.key] = {
          mosPer: parseCombatDefenseMosPer($row.find(".tag-defense-mos-per").val()),
          accuracyPenalty: Number.parseInt($row.find(".tag-defense-accuracy-penalty").val(), 10) || 0
        };
      }

      if (isBlock) {
        if (defense.blockType !== "Mage") {
          defense.hardness = Math.max(0, Number.parseInt($container.find(".tag-defense-hardness").val(), 10) || 0);
        }
        defense.hp = Math.max(0, Number.parseInt($container.find(".tag-defense-hp").val(), 10) || 0);
      }

      return validTagData({ defense: normalizeCombatDefense(defense) });
    }
    case "reach": {
      const reachVal = parseInt($container.find(".tag-reach").val());
      return !Number.isNaN(reachVal) && reachVal > 0 ? validTagData({ reach: reachVal }) : invalidTagData();
    }
    case "stability":
      return validTagData({});
    case "strengthen":
      return combatData.stability
        ? validTagData({})
        : invalidTagData("Strengthen requires Stability on this notable entry.");
    case "custom": {
      const customName = ($container.find(".tag-custom-name").val() || "").trim();
      const customValue = ($container.find(".tag-custom-value").val() || "").trim();
      return customName ? validTagData({ name: customName, value: customValue || "" }) : invalidTagData();
    }
    case "self":
      return validTagData({});
    default:
      return invalidTagData();
  }
}

function validTagData(tagData) {
  return { tagAdded: true, tagData };
}

function invalidTagData(warning = "Please enter valid values for the tag.") {
  return { tagAdded: false, tagData: {}, warning };
}
