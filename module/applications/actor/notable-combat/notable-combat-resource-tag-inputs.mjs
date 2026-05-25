import {
  PC_TAG_INPUT_CLASS,
  PC_TAG_INTEGER_ATTRS,
  PC_TAG_SELECT_CLASS
} from "./notable-combat-tag-form-controls.mjs";
import { delegate, qs, toElement } from "../../dom.mjs";

const resourceCostControllers = new WeakMap();

export function renderResourceCostTagInputs(area, combatData) {
  const root = toElement(area);
  if (!root) return;

  const existingCosts = combatData.resourceCosts || [];
  let costsHtml = `<div class="resource-costs-container" style="display:flex;flex-direction:column;gap:8px;">`;
  costsHtml += `<div class="resource-costs-list" style="display:flex;flex-direction:column;gap:6px;">`;

  const costsToRender = existingCosts.length > 0 ? existingCosts : [{ type: "", value: 0, damageType: "" }];
  costsToRender.forEach((cost, idx) => {
    costsHtml += `
      <div class="resource-cost-row" data-cost-index="${idx}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <select class="tag-rc-type ${PC_TAG_SELECT_CLASS}">
          <option value="">-- Type --</option>
          <option value="Stamina" ${cost.type === "Stamina" ? "selected" : ""}>Stamina</option>
          <option value="Attunement" ${cost.type === "Attunement" ? "selected" : ""}>Attunement</option>
          <option value="HP" ${cost.type === "HP" ? "selected" : ""}>HP</option>
          <option value="Physical Stress" ${cost.type === "Physical Stress" ? "selected" : ""}>Physical Stress</option>
          <option value="Mental Stress" ${cost.type === "Mental Stress" ? "selected" : ""}>Mental Stress</option>
        </select>
        <input type="number" class="tag-rc-value ${PC_TAG_INPUT_CLASS} pc-tag-input-sm" value="${cost.value || ""}" min="0" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
        <select class="tag-rc-dmgtype ${PC_TAG_SELECT_CLASS}" style="display:${cost.type === "HP" ? "inline-block" : "none"};">
          <option value="">-- Dmg Type --</option>
          <option value="Blunt" ${cost.damageType === "Blunt" ? "selected" : ""}>Blunt</option>
          <option value="Lethal" ${cost.damageType === "Lethal" ? "selected" : ""}>Lethal</option>
          <option value="Critical" ${cost.damageType === "Critical" ? "selected" : ""}>Critical</option>
        </select>
        <button type="button" class="remove-cost-row peasant-tag-cancel" title="Remove cost row">-</button>
      </div>
    `;
  });

  costsHtml += `</div>`;
  costsHtml += `<button type="button" class="add-cost-row peasant-tag-add">+ Add Cost</button>`;
  costsHtml += `</div>`;
  root.innerHTML = costsHtml;

  resourceCostControllers.get(root)?.abort();
  const controller = new AbortController();
  resourceCostControllers.set(root, controller);
  const { signal } = controller;

  delegate(root, "change", ".tag-rc-type", (event, select) => {
    const row = select.closest(".resource-cost-row");
    const damageType = qs(row, ".tag-rc-dmgtype");
    if (!damageType) return;
    if (select.value === "HP") {
      damageType.style.display = "inline-block";
    } else {
      damageType.style.display = "none";
      damageType.value = "";
    }
  }, { signal });

  delegate(root, "click", ".add-cost-row", () => {
    const list = qs(root, ".resource-costs-list");
    if (!list) return;
    const newIdx = list.querySelectorAll(".resource-cost-row").length;
    list.insertAdjacentHTML("beforeend", `
      <div class="resource-cost-row" data-cost-index="${newIdx}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <select class="tag-rc-type ${PC_TAG_SELECT_CLASS}">
          <option value="">-- Type --</option>
          <option value="Stamina">Stamina</option>
          <option value="Attunement">Attunement</option>
          <option value="HP">HP</option>
          <option value="Physical Stress">Physical Stress</option>
          <option value="Mental Stress">Mental Stress</option>
        </select>
        <input type="number" class="tag-rc-value ${PC_TAG_INPUT_CLASS} pc-tag-input-sm" value="" min="0" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
        <select class="tag-rc-dmgtype ${PC_TAG_SELECT_CLASS}" style="display:none;">
          <option value="">-- Dmg Type --</option>
          <option value="Blunt">Blunt</option>
          <option value="Lethal">Lethal</option>
          <option value="Critical">Critical</option>
        </select>
        <button type="button" class="remove-cost-row peasant-tag-cancel" title="Remove cost row">-</button>
      </div>
    `);
  }, { signal });

  delegate(root, "click", ".remove-cost-row", (event, button) => {
    button.closest(".resource-cost-row")?.remove();
  }, { signal });
}
