import { getDefaultEdgeLabelMode, sanitizeEdgeLabelMode } from "../../../data/actor/edge-resources.mjs";
import { delegate, qsa } from "../../dom.mjs";

const TRACKED_RESOURCES = new Set(["stamina", "attunement", "capacity", "edge", "armorCharge"]);

export function setupResourceControls(sheet, html, { runQueuedInputUpdate } = {}) {
  setupResourceValueControls(sheet, html);
  setupPortraitResourceControls(sheet, html);
  setupEdgeResourceControls(sheet, html, { runQueuedInputUpdate });
  setupResourceRefreshControls(sheet, html);
}

function setupResourceValueControls(sheet, html) {
  const maxSelector = "input[name='system.stamina.max'], input[name='system.attunement.max'], input[name='system.capacity.max'], input[name='system.edge.max']";
  for (const input of qsa(html, maxSelector)) {
    input.addEventListener("change", async () => {
      const resourceName = input.name?.split(".")?.[1];
      const newMaxValue = Number.parseInt(input.value, 10) || 0;
      await sheet.actor.setPeasantResourceMax?.(resourceName, newMaxValue, { fillOnlyWhenEmpty: true });
    });
  }

  const valueSelector = "input[name='system.stamina.value'], input[name='system.attunement.value'], input[name='system.capacity.value'], input[name='system.edge.value']";
  for (const input of qsa(html, valueSelector)) {
    input.addEventListener("input", () => {
      const resourceName = input.name?.split(".")?.[1];
      const maxValue = sheet.actor.system[resourceName]?.max;
      const newValue = Number.parseInt(input.value, 10) || 0;
      if (newValue > maxValue) input.value = String(maxValue);
    });

    input.addEventListener("change", async () => {
      const resourceName = input.name?.split(".")?.[1];
      const newCurrentValue = Number.parseInt(input.value, 10) || 0;
      const maxValue = sheet.actor.system[resourceName]?.max;
      if (newCurrentValue > maxValue) {
        await sheet.actor.setPeasantResourceValue?.(resourceName, maxValue);
      }
    });
  }
}

function setupPortraitResourceControls(sheet, html) {
  for (const input of qsa(html, ".pc-portrait-resource-max-input")) {
    input.addEventListener("change", async () => {
      const resourceName = String(input.dataset.resource || "").trim();
      if (!TRACKED_RESOURCES.has(resourceName)) return;

      const newMaxValue = Math.max(0, Number.parseInt(input.value, 10) || 0);
      input.value = String(newMaxValue);
      await sheet.actor.setPeasantResourceMax?.(resourceName, newMaxValue);
    });
  }

  for (const input of qsa(html, ".pc-portrait-resource-value-input")) {
    input.addEventListener("input", () => {
      const resourceName = String(input.dataset.resource || "").trim();
      if (!TRACKED_RESOURCES.has(resourceName)) return;
      const maxValue = Math.max(0, Number(sheet.actor.system?.[resourceName]?.max) || 0);
      const newValue = Math.max(0, Number.parseInt(input.value, 10) || 0);
      if (newValue > maxValue) input.value = String(maxValue);
    });

    input.addEventListener("change", async () => {
      const resourceName = String(input.dataset.resource || "").trim();
      if (!TRACKED_RESOURCES.has(resourceName)) return;
      const maxValue = Math.max(0, Number(sheet.actor.system?.[resourceName]?.max) || 0);
      const newValue = Math.max(0, Math.min(Number.parseInt(input.value, 10) || 0, maxValue));
      input.value = String(newValue);
      await sheet.actor.setPeasantResourceValue?.(resourceName, newValue);
    });
  }

  for (const bar of qsa(html, ".pc-portrait-resource-bar, .pc-portrait-armor-charge-field")) {
    bar.addEventListener("click", (ev) => {
      if (ev.target?.closest?.("input, button, select, textarea, a")) return;
      togglePortraitResourceBarInput(bar, true);
    });
  }

  for (const input of qsa(html, ".pc-portrait-resource-value-input, .pc-portrait-resource-max-input")) {
    input.addEventListener("blur", (ev) => {
      const bar = ev.currentTarget.closest(".pc-portrait-resource-bar, .pc-portrait-armor-charge-field");
      if (bar) togglePortraitResourceBarInput(bar, false);
    });

    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      ev.currentTarget.blur();
    });
  }
}

function togglePortraitResourceBarInput(bar, edit) {
  const label = bar.querySelector(":scope > .pc-portrait-resource-bar-label");
  const input = bar.querySelector(":scope > .pc-portrait-resource-value-input, :scope > .pc-portrait-resource-max-input");
  if (!label || !input) return;
  label.hidden = edit;
  input.hidden = !edit;
  if (edit) {
    input.focus();
    if (!bar.classList.contains("pc-portrait-armor-charge-field")) input.select?.();
  }
}

function setupEdgeResourceControls(sheet, html, { runQueuedInputUpdate } = {}) {
  const defaultEdgeLabelMode = getDefaultEdgeLabelMode(sheet.actor);
  const getEdgeResourceAt = (index) => sheet.actor.getPeasantEdgeResource?.(index) ?? null;

  delegate(html, "click", ".add-edge-resource-btn", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await sheet.actor.addPeasantEdgeResource?.();
  });

  delegate(html, "click", ".remove-edge-resource-btn", async (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    const index = Number.parseInt(target.dataset.resourceIndex, 10);
    if (!Number.isFinite(index) || index < 0) return;
    await sheet.actor.removePeasantEdgeResource?.(index);
  });

  delegate(html, "change", ".edge-base-label-mode", async (ev, target) => {
    if (!sheet.isEditMode) return;
    const selected = sanitizeEdgeLabelMode(target.value, defaultEdgeLabelMode);
    await sheet.actor.setPeasantEdgeLabelMode?.(selected);
  });

  delegate(html, "change", ".edge-base-custom-label", async (ev, target) => {
    if (!sheet.isEditMode) return;
    const customLabel = String(target.value ?? "").trim();
    await sheet.actor.setPeasantEdgeCustomLabel?.(customLabel);
  });

  delegate(html, "change", ".edge-resource-label-mode", async (ev, input) => {
    if (!sheet.isEditMode) return;
    const index = Number.parseInt(input.dataset.resourceIndex, 10);
    if (!Number.isFinite(index) || index < 0) return;
    await runQueuedInputUpdate?.(input, "_edgeResourceSaveQueue", "Edge resource label mode change", async () => {
      await sheet.actor.setPeasantEdgeResourceLabelMode?.(index, input.value);
    });
  });

  delegate(html, "change", ".edge-resource-custom-label", async (ev, input) => {
    if (!sheet.isEditMode) return;
    const index = Number.parseInt(input.dataset.resourceIndex, 10);
    if (!Number.isFinite(index) || index < 0) return;
    await runQueuedInputUpdate?.(input, "_edgeResourceSaveQueue", "Edge resource custom label change", async () => {
      await sheet.actor.setPeasantEdgeResourceCustomLabel?.(index, input.value);
    });
  });

  delegate(html, "input", ".edge-resource-custom-label", (ev) => {
    if (!sheet.isEditMode) return;
    sheet._scheduleEditAutosaveChange(ev.currentTarget, 260);
  });

  delegate(html, "input", ".edge-resource-current, .edge-resource-max", (ev, input) => {
    const index = Number.parseInt(input.dataset.resourceIndex, 10);
    if (!Number.isFinite(index) || index < 0) return;
    const isMax = input.classList.contains("edge-resource-max");
    if (isMax) {
      const maxValue = Math.max(0, Number.parseInt(input.value, 10) || 0);
      input.value = String(maxValue);
    } else {
      const entry = getEdgeResourceAt(index);
      if (!entry) return;
      const maxValue = Math.max(0, Number.parseInt(entry.max, 10) || 0);
      const value = Math.max(0, Number.parseInt(input.value, 10) || 0);
      if (value > maxValue) input.value = String(maxValue);
    }
    sheet._scheduleEditAutosaveChange(ev.currentTarget, 240);
  });

  delegate(html, "change", ".edge-resource-current, .edge-resource-max", async (ev, input) => {
    const index = Number.parseInt(input.dataset.resourceIndex, 10);
    if (!Number.isFinite(index) || index < 0) return;
    const isMax = input.classList.contains("edge-resource-max");
    await runQueuedInputUpdate?.(
      input,
      "_edgeResourceSaveQueue",
      isMax ? "Edge resource max change" : "Edge resource current change",
      async () => {
        if (isMax) {
          const maxValue = Math.max(0, Number.parseInt(input.value, 10) || 0);
          input.value = String(maxValue);
          await sheet.actor.setPeasantEdgeResourceMax?.(index, maxValue);
        } else {
          const entry = getEdgeResourceAt(index);
          const maxValue = Math.max(0, Number.parseInt(entry?.max, 10) || 0);
          const value = Math.max(0, Number.parseInt(input.value, 10) || 0);
          const nextValue = Math.min(value, maxValue);
          input.value = String(nextValue);
          await sheet.actor.setPeasantEdgeResourceValue?.(index, nextValue);
        }
      }
    );
  });
}

function setupResourceRefreshControls(sheet, html) {
  delegate(html, "click", ".resource-refresh", async (ev, target) => {
    const resourceName = target.dataset.resource;
    await sheet.actor.refreshPeasantResource?.(resourceName);
  });
}
