import { renderDefenseTagInputs } from "./notable-combat-defense-tag-inputs.mjs";
import { renderStandardNotableCombatTagInputs } from "./notable-combat-standard-tag-inputs.mjs";

export function renderNotableCombatTagInputs($container, tagType, combatData, { tagEditorState } = {}) {
  const $area = $container.find(".tag-input-area");
  $area.empty();

  const inputStyle = "width:60px;padding:4px;background:#2a2a2a;border:1px solid #555;border-radius:3px;color:#e0e0e0;text-align:center;";
  const labelStyle = "color:#aaa;font-size:12px;margin-right:8px;";
  const selectStyle = "padding:4px;background:#2a2a2a;border:1px solid #555;border-radius:3px;color:#e0e0e0;";
  if (renderStandardNotableCombatTagInputs($area, tagType, combatData, { inputStyle, labelStyle, selectStyle, tagEditorState })) return;

  switch (tagType) {
    case "description":
      $area.html(`
        <div class="pc-tag-description-placeholder">
          <p>Click <strong>Add Tag</strong> to open the description editor.</p>
          <p class="pc-tag-description-placeholder-hint">This will open a rich text editor for the combat description.</p>
        </div>
      `);
      break;
    case "staminaCost":
      $area.html(`
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="${labelStyle}">Stamina Cost:</label>
          <input type="number" class="tag-stamina-cost" value="${combatData.staminaCost || ""}" style="${inputStyle}" min="0" placeholder="#">
          <span style="color:#888;font-size:11px;">(Legacy - use Resource Costs)</span>
        </div>
      `);
      break;
    case "attunementCost":
      $area.html(`
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="${labelStyle}">Attunement Cost:</label>
          <input type="number" class="tag-attunement-cost" value="${combatData.attunementCost || ""}" style="${inputStyle}" min="0" placeholder="#">
          <span style="color:#888;font-size:11px;">(Legacy - use Resource Costs)</span>
        </div>
      `);
      break;
    case "defense":
      renderDefenseTagInputs($area, combatData, { inputStyle, selectStyle });
      break;
    default:
      $area.html(`<p style="color:#666;font-style:italic;font-size:12px;">Select a tag type above.</p>`);
  }
}

export { renderResourceCostTagInputs } from "./notable-combat-resource-tag-inputs.mjs";
export { renderSpeedTagInputs } from "./notable-combat-speed-tag-inputs.mjs";
export { renderStandardNotableCombatTagInputs } from "./notable-combat-standard-tag-inputs.mjs";
