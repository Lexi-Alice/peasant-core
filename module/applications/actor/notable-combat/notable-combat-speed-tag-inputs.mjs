import {
  PC_TAG_INPUT_CLASS,
  PC_TAG_INTEGER_ATTRS,
  PC_TAG_SELECT_CLASS
} from "./notable-combat-tag-form-controls.mjs";
import { delegate, qs, toElement } from "../../dom.mjs";

const speedTagControllers = new WeakMap();

export function renderSpeedTagInputs(area, combatData) {
  const root = toElement(area);
  if (!root) return;

  const currentSpeed = combatData.speed || {};
  root.innerHTML = `
    <div class="pc-tag-field-stack">
      <div class="pc-tag-field-row">
        <label class="pc-tag-field-label">Speed:</label>
        <select class="tag-speed-type ${PC_TAG_SELECT_CLASS}">
          <option value="">-- Select --</option>
          <option value="Full Round" ${currentSpeed.type === "Full Round" ? "selected" : ""}>Full Round</option>
          <option value="Standard" ${currentSpeed.type === "Standard" ? "selected" : ""}>Standard</option>
          <option value="Movement" ${currentSpeed.type === "Movement" ? "selected" : ""}>Movement</option>
          <option value="Reflex" ${currentSpeed.type === "Reflex" ? "selected" : ""}>Reflex</option>
          <option value="Instant" ${currentSpeed.type === "Instant" ? "selected" : ""}>Instant</option>
          <option value="Split Second" ${currentSpeed.type === "Split Second" ? "selected" : ""}>Split Second</option>
        </select>
      </div>
      <div class="split-second-uses" style="display:${currentSpeed.type === "Split Second" ? "flex" : "none"};align-items:center;gap:8px;">
        <label class="pc-tag-field-label">Max Uses:</label>
        <input type="number" class="tag-speed-max ${PC_TAG_INPUT_CLASS}" value="${currentSpeed.splitSecondMax || ""}" min="1" placeholder="#" ${PC_TAG_INTEGER_ATTRS}>
      </div>
    </div>
  `;

  speedTagControllers.get(root)?.abort();
  const controller = new AbortController();
  speedTagControllers.set(root, controller);

  delegate(root, "change", ".tag-speed-type", (event, select) => {
    const splitUses = qs(root, ".split-second-uses");
    if (splitUses) splitUses.style.display = select.value === "Split Second" ? "flex" : "none";
  }, { signal: controller.signal });
}
