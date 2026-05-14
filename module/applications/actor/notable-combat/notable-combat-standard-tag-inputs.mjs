import { getCombatCustomTags } from "../../../data/actor/combat-tags.mjs";
import { formatCombatDiceValue } from "../../../dice/combat-dice.mjs";
import { escapeHtml } from "../../../utils/chat.mjs";
import { renderResourceCostTagInputs } from "./notable-combat-resource-tag-inputs.mjs";
import { renderSpeedTagInputs } from "./notable-combat-speed-tag-inputs.mjs";

export function renderStandardNotableCombatTagInputs($area, tagType, combatData, { inputStyle, labelStyle, selectStyle, tagEditorState } = {}) {
  switch (tagType) {
    case "resourceCosts":
      renderResourceCostTagInputs($area, combatData, { inputStyle, selectStyle });
      return true;
    case "speed":
      renderSpeedTagInputs($area, combatData, { inputStyle, labelStyle, selectStyle });
      return true;
    case "range":
      $area.html(`
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="${labelStyle}">Range:</label>
          <input type="number" class="tag-range" value="${combatData.range || ""}" style="${inputStyle}" min="0" placeholder="#">
        </div>
      `);
      return true;
    case "rangeRate": {
      const rangeRateParts = String(combatData.rangeRate || "").split("/");
      $area.html(`
        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
          <label style="${labelStyle}">Range-Rate:</label>
          <input type="number" class="tag-rr-1" value="${rangeRateParts[0] || ""}" style="${inputStyle}width:45px;" placeholder="1st">
          <span style="color:#666;">/</span>
          <input type="number" class="tag-rr-2" value="${rangeRateParts[1] || ""}" style="${inputStyle}width:45px;" placeholder="2nd">
          <span style="color:#666;">/</span>
          <input type="number" class="tag-rr-3" value="${rangeRateParts[2] || ""}" style="${inputStyle}width:45px;" placeholder="3rd">
          <span style="color:#666;">/</span>
          <input type="number" class="tag-rr-4" value="${rangeRateParts[3] || ""}" style="${inputStyle}width:45px;" placeholder="4th">
        </div>
      `);
      return true;
    }
    case "damage": {
      const currentDamage = combatData.damage || {};
      $area.html(`
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <input type="number" class="tag-dmg-dice" value="${currentDamage.diceCount || ""}" style="${inputStyle}width:45px;" min="1" placeholder="#">
            <span style="color:#e0e0e0;">d</span>
            <input type="text" class="tag-dmg-value" value="${formatCombatDiceValue(currentDamage.diceValue, currentDamage.diceBonus)}" style="${inputStyle}width:58px;" placeholder="#">
            <span style="color:#e0e0e0;">+</span>
            <input type="number" class="tag-dmg-flat" value="${currentDamage.flat || ""}" style="${inputStyle}width:50px;" placeholder="flat">
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="${labelStyle}">Type:</label>
            <select class="tag-dmg-type" style="${selectStyle}">
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
    case "heal": {
      const currentHeal = combatData.heal || {};
      $area.html(`
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <input type="number" class="tag-heal-dice" value="${currentHeal.diceCount || ""}" style="${inputStyle}width:45px;" min="1" placeholder="#">
            <span style="color:#e0e0e0;">d</span>
            <input type="text" class="tag-heal-value" value="${formatCombatDiceValue(currentHeal.diceValue, currentHeal.diceBonus)}" style="${inputStyle}width:58px;" placeholder="#">
            <span style="color:#e0e0e0;">+</span>
            <input type="number" class="tag-heal-flat" value="${currentHeal.flat || ""}" style="${inputStyle}width:50px;" placeholder="flat">
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="${labelStyle}">Type:</label>
            <select class="tag-heal-type" style="${selectStyle}">
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
      $area.html(`
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input type="number" class="tag-mani-dice" value="${currentManifest.diceCount || ""}" style="${inputStyle}width:45px;" min="1" placeholder="#">
          <span style="color:#e0e0e0;">d</span>
          <input type="text" class="tag-mani-value" value="${formatCombatDiceValue(currentManifest.diceValue, currentManifest.diceBonus)}" style="${inputStyle}width:58px;" placeholder="#">
          <span style="color:#e0e0e0;">+</span>
          <input type="number" class="tag-mani-flat" value="${currentManifest.flat || ""}" style="${inputStyle}width:50px;" placeholder="flat">
        </div>
      `);
      return true;
    }
    case "tagUses":
      $area.html(`
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="${labelStyle}">Max Uses:</label>
          <input type="number" class="tag-uses-max" value="${combatData.tagUses?.max || ""}" style="${inputStyle}" min="1" placeholder="#">
        </div>
      `);
      return true;
    case "sections":
      $area.html(`
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="${labelStyle}">Max Sections:</label>
          <input type="number" class="tag-sections-max" value="${combatData.sections?.max || ""}" style="${inputStyle}" min="1" placeholder="#">
        </div>
      `);
      return true;
    case "aoe": {
      const currentAoe = combatData.aoe || {};
      $area.html(`
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <label style="${labelStyle}">AoE Value:</label>
          <input type="number" class="tag-aoe-value" value="${currentAoe.value || ""}" style="${inputStyle}" min="1" placeholder="#">
          <select class="tag-aoe-type" style="${selectStyle}">
            <option value="Area" ${currentAoe.type === "Area" || !currentAoe.type ? "selected" : ""}>Area</option>
            <option value="Blast" ${currentAoe.type === "Blast" ? "selected" : ""}>Blast</option>
            <option value="Tile" ${currentAoe.type === "Tile" ? "selected" : ""}>Tile</option>
          </select>
        </div>
      `);
      return true;
    }
    case "targetingType":
      $area.html(`
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="${labelStyle}">Targeting Type:</label>
          <select class="tag-targeting-type" style="${selectStyle}">
            <option value="">-- Select --</option>
            <option value="Melee" ${combatData.targetingType === "Melee" ? "selected" : ""}>Melee</option>
            <option value="Projectile" ${combatData.targetingType === "Projectile" ? "selected" : ""}>Projectile</option>
            <option value="Normal Targeting" ${combatData.targetingType === "Normal Targeting" ? "selected" : ""}>Normal Targeting</option>
            <option value="Smite" ${combatData.targetingType === "Smite" ? "selected" : ""}>Smite</option>
          </select>
        </div>
      `);
      return true;
    case "reach":
      $area.html(`
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="${labelStyle}">Reach:</label>
          <input type="number" class="tag-reach" value="${combatData.reach || ""}" style="${inputStyle}" min="0" placeholder="#">
        </div>
      `);
      return true;
    case "stability":
      $area.html(`
        <div style="color:#e0e0e0;padding:8px;text-align:center;background:#2a2a2a;border-radius:4px;">
          <p style="margin:0;">Click <strong>Add Tag</strong> to add the <em>Stability</em> tag.</p>
        </div>
      `);
      return true;
    case "strengthen":
      $area.html(`
        <div style="color:#e0e0e0;padding:8px;text-align:center;background:#2a2a2a;border-radius:4px;">
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
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="${labelStyle}">Name:</label>
            <input type="text" class="tag-custom-name" value="${escapeHtml(editingCustomTag.name)}" style="${inputStyle}flex:1;text-align:left;" placeholder="Name">
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="${labelStyle}">Value:</label>
            <input type="text" class="tag-custom-value" value="${escapeHtml(editingCustomTag.value)}" style="${inputStyle}flex:1;text-align:left;" placeholder="Value (optional)">
          </div>
        </div>
      `);
      return true;
    }
    case "self":
      $area.html(`
        <div style="color:#e0e0e0;padding:8px;text-align:center;background:#2a2a2a;border-radius:4px;">
          <p style="margin:0;">Click <strong>Add Tag</strong> to add the <em>Self</em> tag.</p>
        </div>
      `);
      return true;
    default:
      return false;
  }
}
