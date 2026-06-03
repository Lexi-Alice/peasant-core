import { COMBAT_TARGETING_TYPE_OPTIONS, getCombatCustomTags, getCombatTargetingType } from "../../../data/actor/combat-tags.mjs";
import { getRangeRatePartInputValue } from "../../../data/actor/combat-tags.mjs";
import { formatCombatDiceValue, hasCombatDice } from "../../../dice/combat-dice.mjs";
import { escapeHtml } from "../../../utils/chat.mjs";
import { renderResourceCostTagInputs } from "./notable-combat-resource-tag-inputs.mjs";
import { renderSpeedTagInputs } from "./notable-combat-speed-tag-inputs.mjs";
import {
  PC_TAG_INPUT_CLASS,
  PC_TAG_INTEGER_ATTRS,
  PC_TAG_SELECT_CLASS
} from "./notable-combat-tag-form-controls.mjs";

export function renderStandardNotableCombatTagInputs($area, tagType, combatData, { tagEditorState } = {}) {
  switch (tagType) {
    case "resourceCosts":
      renderResourceCostTagInputs($area, combatData);
      return true;
    case "speed":
      renderSpeedTagInputs($area, combatData);
      return true;
    case "range":
      $area.html(`
        <div class="pc-tag-field-row">
          <label class="pc-tag-field-label">Range:</label>
          <input type="number" class="tag-range ${PC_TAG_INPUT_CLASS}" value="${combatData.range || ""}" min="0" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
        </div>
      `);
      return true;
    case "rangeRate": {
      $area.html(`
        <div class="pc-tag-field-row" style="gap:4px;">
          <label class="pc-tag-field-label">Range-Rate:</label>
          <input type="number" class="tag-rr-1 ${PC_TAG_INPUT_CLASS} pc-tag-input-xs" value="${getRangeRatePartInputValue(combatData.rangeRate, 0)}" placeholder="1st" ${PC_TAG_INTEGER_ATTRS}>
          <span class="pc-tag-separator">/</span>
          <input type="number" class="tag-rr-2 ${PC_TAG_INPUT_CLASS} pc-tag-input-xs" value="${getRangeRatePartInputValue(combatData.rangeRate, 1)}" placeholder="2nd" ${PC_TAG_INTEGER_ATTRS}>
          <span class="pc-tag-separator">/</span>
          <input type="number" class="tag-rr-3 ${PC_TAG_INPUT_CLASS} pc-tag-input-xs" value="${getRangeRatePartInputValue(combatData.rangeRate, 2)}" placeholder="3rd" ${PC_TAG_INTEGER_ATTRS}>
          <span class="pc-tag-separator">/</span>
          <input type="number" class="tag-rr-4 ${PC_TAG_INPUT_CLASS} pc-tag-input-xs" value="${getRangeRatePartInputValue(combatData.rangeRate, 3)}" placeholder="4th" ${PC_TAG_INTEGER_ATTRS}>
        </div>
      `);
      return true;
    }
    case "damage": {
      const currentDamage = combatData.damage || {};
      const hasCurrentDamage = hasCombatDice(currentDamage);
      $area.html(`
        <div class="pc-tag-field-stack">
          <div class="pc-tag-field-row">
            <input type="number" class="tag-dmg-dice ${PC_TAG_INPUT_CLASS} pc-tag-input-xs" value="${combatDiceIntegerInputValue(currentDamage, "diceCount", hasCurrentDamage)}" min="0" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
            <span style="color:#e0e0e0;">d</span>
            <input type="text" class="tag-dmg-value ${PC_TAG_INPUT_CLASS} pc-tag-input-md" value="${formatCombatDiceValue(currentDamage.diceValue, currentDamage.diceBonus, { allowZero: hasCurrentDamage })}" placeholder="#">
            <span style="color:#e0e0e0;">+</span>
            <input type="number" class="tag-dmg-flat ${PC_TAG_INPUT_CLASS} pc-tag-input-sm" value="${currentDamage.flat || ""}" placeholder="flat" ${PC_TAG_INTEGER_ATTRS}>
          </div>
          <div class="pc-tag-field-row">
            <label class="pc-tag-field-label">Type:</label>
            <select class="tag-dmg-type ${PC_TAG_SELECT_CLASS}">
              <option value="">-- Select --</option>
              <option value="Blunt" ${currentDamage.type === "Blunt" ? "selected" : ""}>Blunt</option>
              <option value="Lethal" ${currentDamage.type === "Lethal" ? "selected" : ""}>Lethal</option>
              <option value="Hybrid" ${currentDamage.type === "Hybrid" ? "selected" : ""}>Hybrid</option>
              <option value="Flexible" ${currentDamage.type === "Flexible" ? "selected" : ""}>Flexible</option>
              <option value="Crit" ${currentDamage.type === "Crit" ? "selected" : ""}>Crit</option>
            </select>
          </div>
        </div>
      `);
      return true;
    }
    case "desperate":
      $area.html(`
        <div class="pc-tag-field-row">
          <label class="pc-tag-field-label">Die-Rate per filled HP row:</label>
          <input type="number" class="tag-desperate ${PC_TAG_INPUT_CLASS}" value="${signedIntegerInputValue(combatData.desperate)}" step="1" placeholder="+1" ${PC_TAG_INTEGER_ATTRS}>
        </div>
      `);
      return true;
    case "heal": {
      const currentHeal = combatData.heal || {};
      const hasCurrentHeal = hasCombatDice(currentHeal);
      $area.html(`
        <div class="pc-tag-field-stack">
          <div class="pc-tag-field-row">
            <input type="number" class="tag-heal-dice ${PC_TAG_INPUT_CLASS} pc-tag-input-xs" value="${combatDiceIntegerInputValue(currentHeal, "diceCount", hasCurrentHeal)}" min="0" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
            <span style="color:#e0e0e0;">d</span>
            <input type="text" class="tag-heal-value ${PC_TAG_INPUT_CLASS} pc-tag-input-md" value="${formatCombatDiceValue(currentHeal.diceValue, currentHeal.diceBonus, { allowZero: hasCurrentHeal })}" placeholder="#">
            <span style="color:#e0e0e0;">+</span>
            <input type="number" class="tag-heal-flat ${PC_TAG_INPUT_CLASS} pc-tag-input-sm" value="${currentHeal.flat || ""}" placeholder="flat" ${PC_TAG_INTEGER_ATTRS}>
          </div>
          <div class="pc-tag-field-row">
            <label class="pc-tag-field-label">Type:</label>
            <select class="tag-heal-type ${PC_TAG_SELECT_CLASS}">
              <option value="">-- Select --</option>
              <option value="Temporary" ${currentHeal.type === "Temporary" ? "selected" : ""}>Temporary</option>
              <option value="Greater" ${currentHeal.type === "Greater" ? "selected" : ""}>Greater</option>
            </select>
          </div>
        </div>
      `);
      return true;
    }
    case "manifest": {
      const currentManifest = combatData.manifest || {};
      const hasCurrentManifest = hasCombatDice(currentManifest);
      $area.html(`
        <div class="pc-tag-field-row">
          <input type="number" class="tag-mani-dice ${PC_TAG_INPUT_CLASS} pc-tag-input-xs" value="${combatDiceIntegerInputValue(currentManifest, "diceCount", hasCurrentManifest)}" min="0" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
          <span style="color:#e0e0e0;">d</span>
          <input type="text" class="tag-mani-value ${PC_TAG_INPUT_CLASS} pc-tag-input-md" value="${formatCombatDiceValue(currentManifest.diceValue, currentManifest.diceBonus, { allowZero: hasCurrentManifest })}" placeholder="#">
          <span style="color:#e0e0e0;">+</span>
          <input type="number" class="tag-mani-flat ${PC_TAG_INPUT_CLASS} pc-tag-input-sm" value="${currentManifest.flat || ""}" placeholder="flat" ${PC_TAG_INTEGER_ATTRS}>
        </div>
      `);
      return true;
    }
    case "tagUses":
      $area.html(`
        <div class="pc-tag-field-row">
          <label class="pc-tag-field-label">Max Uses:</label>
          <input type="number" class="tag-uses-max ${PC_TAG_INPUT_CLASS}" value="${combatData.tagUses?.max || ""}" min="1" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
        </div>
      `);
      return true;
    case "sections":
      $area.html(`
        <div class="pc-tag-field-row">
          <label class="pc-tag-field-label">Max Sections:</label>
          <input type="number" class="tag-sections-max ${PC_TAG_INPUT_CLASS}" value="${combatData.sections?.max || ""}" min="1" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
        </div>
      `);
      return true;
    case "targetingType": {
      const currentTargetingType = getCombatTargetingType(combatData);
      const targetingOptions = COMBAT_TARGETING_TYPE_OPTIONS.map((option) => (
        `<option value="${escapeHtml(option)}" ${currentTargetingType === option ? "selected" : ""}>${escapeHtml(option)}</option>`
      )).join("");
      $area.html(`
        <div class="pc-tag-field-row">
          <label class="pc-tag-field-label">Targeting Type:</label>
          <select class="tag-targeting-type ${PC_TAG_SELECT_CLASS}">
            <option value="">-- Select --</option>
            ${targetingOptions}
          </select>
        </div>
      `);
      return true;
    }
    case "reach":
      $area.html(`
        <div class="pc-tag-field-row">
          <label class="pc-tag-field-label">Reach:</label>
          <input type="number" class="tag-reach ${PC_TAG_INPUT_CLASS}" value="${combatData.reach || ""}" min="0" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
        </div>
      `);
      return true;
    case "stability":
      $area.html(`
        <div class="pc-tag-message">
          <p style="margin:0;">Click <strong>Add Tag</strong> to add the <em>Stability</em> tag.</p>
        </div>
      `);
      return true;
    case "overkill":
      $area.html(`
        <div class="pc-tag-message">
          <p style="margin:0;">Click <strong>Add Tag</strong> to add the <em>Overkill</em> tag.</p>
        </div>
      `);
      return true;
    case "magnetism":
      $area.html(`
        <div class="pc-tag-field-row">
          <label class="pc-tag-field-label">Grade:</label>
          <input type="text" class="tag-magnetism-grade ${PC_TAG_INPUT_CLASS}" value="${combatData.magnetism?.grade || ""}" placeholder="1">
        </div>
      `);
      return true;
    case "strengthen":
      $area.html(`
        <div class="pc-tag-message">
          <p style="margin:0 0 6px 0;">Requires <strong>Stability</strong>.</p>
          <p style="margin:0;">Click <strong>Add Tag</strong> to add the <em>Strengthen</em> tag.</p>
        </div>
      `);
      return true;
    case "custom": {
      const isEditingThisType = tagEditorState?.mode === "edit" && tagEditorState?.tagType === tagType;
      const editingCustomTag = isEditingThisType
        ? (getCombatCustomTags(combatData)[tagEditorState.customIndex] || { name: "", value: "" })
        : { name: "", value: "" };
      $area.html(`
        <div class="pc-tag-field-stack">
          <div class="pc-tag-field-row">
            <label class="pc-tag-field-label">Name:</label>
            <input type="text" class="tag-custom-name ${PC_TAG_INPUT_CLASS} pc-tag-input-fill" value="${escapeHtml(editingCustomTag.name)}" placeholder="Name">
          </div>
          <div class="pc-tag-field-row">
            <label class="pc-tag-field-label">Value:</label>
            <input type="text" class="tag-custom-value ${PC_TAG_INPUT_CLASS} pc-tag-input-fill" value="${escapeHtml(editingCustomTag.value)}" placeholder="Value (optional)">
          </div>
        </div>
      `);
      return true;
    }
    case "self":
      $area.html(`
        <div class="pc-tag-message">
          <p style="margin:0;">Click <strong>Add Tag</strong> to add the <em>Self</em> tag.</p>
        </div>
      `);
      return true;
    default:
      return false;
  }
}

function combatDiceIntegerInputValue(rollData, field, hasRollData) {
  if (!hasRollData) return "";
  const value = Number.parseInt(rollData?.[field], 10);
  return Number.isFinite(value) ? String(value) : "0";
}

function signedIntegerInputValue(rawValue) {
  const value = Number.parseInt(rawValue, 10) || 0;
  if (value === 0) return "";
  return String(value);
}
