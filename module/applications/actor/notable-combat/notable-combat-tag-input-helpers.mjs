import { renderDefenseTagInputs } from "./notable-combat-defense-tag-inputs.mjs";
import {
  PC_TAG_INPUT_CLASS,
  PC_TAG_INTEGER_ATTRS
} from "./notable-combat-tag-form-controls.mjs";
import { renderStandardNotableCombatTagInputs } from "./notable-combat-standard-tag-inputs.mjs";

export function renderNotableCombatTagInputs($container, tagType, combatData, { tagEditorState } = {}) {
  const $area = $container.find(".tag-input-area");
  $area.empty();

  if (renderStandardNotableCombatTagInputs($area, tagType, combatData, { tagEditorState })) return;

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
        <div class="pc-tag-field-row">
          <label class="pc-tag-field-label">Stamina Cost:</label>
          <input type="number" class="tag-stamina-cost ${PC_TAG_INPUT_CLASS}" value="${combatData.staminaCost || ""}" min="0" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
          <span class="pc-tag-muted-note">(Legacy - use Resource Costs)</span>
        </div>
      `);
      break;
    case "attunementCost":
      $area.html(`
        <div class="pc-tag-field-row">
          <label class="pc-tag-field-label">Attunement Cost:</label>
          <input type="number" class="tag-attunement-cost ${PC_TAG_INPUT_CLASS}" value="${combatData.attunementCost || ""}" min="0" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
          <span class="pc-tag-muted-note">(Legacy - use Resource Costs)</span>
        </div>
      `);
      break;
    case "defense":
      renderDefenseTagInputs($area, combatData);
      break;
    default:
      $area.html(`<p class="pc-tag-muted-note" style="font-style:italic;">Select a tag type above.</p>`);
  }
}

export { renderResourceCostTagInputs } from "./notable-combat-resource-tag-inputs.mjs";
export { renderSpeedTagInputs } from "./notable-combat-speed-tag-inputs.mjs";
export { renderStandardNotableCombatTagInputs } from "./notable-combat-standard-tag-inputs.mjs";
