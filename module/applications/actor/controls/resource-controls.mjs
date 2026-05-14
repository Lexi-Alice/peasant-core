import { getDefaultEdgeLabelMode, sanitizeEdgeLabelMode } from "../../../data/actor/edge-resources.mjs";

const TRACKED_RESOURCES = new Set(["stamina", "attunement", "capacity", "edge"]);

export function setupResourceControls(sheet, html, { runQueuedInputUpdate } = {}) {
  setupResourceValueControls(sheet, html);
  setupPortraitResourceControls(sheet, html);
  setupEdgeResourceControls(sheet, html, { runQueuedInputUpdate });
  setupResourceRefreshControls(sheet, html);
}

function setupResourceValueControls(sheet, html) {
  html.find("input[name='system.stamina.max'], input[name='system.attunement.max'], input[name='system.capacity.max'], input[name='system.edge.max']").change(async (ev) => {
    const input = $(ev.currentTarget);
    const fieldName = input.attr("name");
    const newMaxValue = parseInt(input.val()) || 0;
    const resourceName = fieldName.split(".")[1];
    await sheet.actor.setPeasantResourceMax?.(resourceName, newMaxValue, { fillOnlyWhenEmpty: true });
  });

  const resourceInputs = html.find("input[name='system.stamina.value'], input[name='system.attunement.value'], input[name='system.capacity.value'], input[name='system.edge.value']");
  resourceInputs.on("input", (ev) => {
    const input = $(ev.currentTarget);
    const fieldName = input.attr("name");
    const resourceName = fieldName.split(".")[1];
    const maxValue = sheet.actor.system[resourceName].max;
    const newValue = parseInt(input.val()) || 0;
    if (newValue > maxValue) input.val(maxValue);
  });

  resourceInputs.on("change", async (ev) => {
    const input = $(ev.currentTarget);
    const fieldName = input.attr("name");
    const newCurrentValue = parseInt(input.val()) || 0;
    const resourceName = fieldName.split(".")[1];
    const maxValue = sheet.actor.system[resourceName].max;
    if (newCurrentValue > maxValue) {
      await sheet.actor.setPeasantResourceValue?.(resourceName, maxValue);
    }
  });
}

function setupPortraitResourceControls(sheet, html) {
  html.find(".pc-portrait-resource-max-input").off("change.peasantPortraitResourceMax").on("change.peasantPortraitResourceMax", async (ev) => {
    const input = $(ev.currentTarget);
    const resourceName = String(input.data("resource") || "").trim();
    if (!TRACKED_RESOURCES.has(resourceName)) return;

    const newMaxValue = Math.max(0, parseInt(input.val(), 10) || 0);
    input.val(newMaxValue);
    await sheet.actor.setPeasantResourceMax?.(resourceName, newMaxValue);
  });

  html.find(".pc-portrait-resource-value-input").off("input.peasantPortraitResourceValue change.peasantPortraitResourceValue").on("input.peasantPortraitResourceValue", (ev) => {
    const input = $(ev.currentTarget);
    const resourceName = String(input.data("resource") || "").trim();
    if (!TRACKED_RESOURCES.has(resourceName)) return;
    const maxValue = Math.max(0, Number(sheet.actor.system?.[resourceName]?.max) || 0);
    const newValue = Math.max(0, parseInt(input.val(), 10) || 0);
    if (newValue > maxValue) input.val(maxValue);
  }).on("change.peasantPortraitResourceValue", async (ev) => {
    const input = $(ev.currentTarget);
    const resourceName = String(input.data("resource") || "").trim();
    if (!TRACKED_RESOURCES.has(resourceName)) return;
    const maxValue = Math.max(0, Number(sheet.actor.system?.[resourceName]?.max) || 0);
    const newValue = Math.max(0, Math.min(parseInt(input.val(), 10) || 0, maxValue));
    input.val(newValue);
    await sheet.actor.setPeasantResourceValue?.(resourceName, newValue);
  });

  html.find(".pc-portrait-resource-bar").off("click.peasantPortraitResourceBar").on("click.peasantPortraitResourceBar", (ev) => {
    if ($(ev.target).is("input, button, select, textarea, a")) return;
    togglePortraitResourceBarInput(ev.currentTarget, true);
  });

  html.find(".pc-portrait-resource-value-input, .pc-portrait-resource-max-input")
    .off("blur.peasantPortraitResourceBar keydown.peasantPortraitResourceBar")
    .on("blur.peasantPortraitResourceBar", (ev) => {
      const bar = ev.currentTarget.closest(".pc-portrait-resource-bar");
      if (bar) togglePortraitResourceBarInput(bar, false);
    })
    .on("keydown.peasantPortraitResourceBar", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      ev.currentTarget.blur();
    });
}

function togglePortraitResourceBarInput(bar, edit) {
  const label = bar.querySelector(":scope > .pc-portrait-resource-bar-label");
  const input = bar.querySelector(":scope > .pc-portrait-resource-value-input, :scope > .pc-portrait-resource-max-input");
  if (!label || !input) return;
  label.hidden = edit;
  input.hidden = !edit;
  if (edit) {
    input.focus();
    input.select?.();
  }
}

function setupEdgeResourceControls(sheet, html, { runQueuedInputUpdate } = {}) {
  const defaultEdgeLabelMode = getDefaultEdgeLabelMode(sheet.actor);
  const getEdgeResourceAt = (index) => sheet.actor.getPeasantEdgeResource?.(index) ?? null;

  html.on("click", ".add-edge-resource-btn", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await sheet.actor.addPeasantEdgeResource?.();
  });

  html.on("click", ".remove-edge-resource-btn", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    const index = Number.parseInt($(ev.currentTarget).data("resourceIndex"), 10);
    if (!Number.isFinite(index) || index < 0) return;
    await sheet.actor.removePeasantEdgeResource?.(index);
  });

  html.on("change", ".edge-base-label-mode", async (ev) => {
    if (!sheet.isEditMode) return;
    const selected = sanitizeEdgeLabelMode($(ev.currentTarget).val(), defaultEdgeLabelMode);
    await sheet.actor.setPeasantEdgeLabelMode?.(selected);
    sheet.render(false);
  });

  html.on("change", ".edge-base-custom-label", async (ev) => {
    if (!sheet.isEditMode) return;
    const customLabel = String($(ev.currentTarget).val() ?? "").trim();
    await sheet.actor.setPeasantEdgeCustomLabel?.(customLabel);
  });

  html.on("change", ".edge-resource-label-mode", async (ev) => {
    if (!sheet.isEditMode) return;
    const input = $(ev.currentTarget);
    const index = Number.parseInt(input.data("resourceIndex"), 10);
    if (!Number.isFinite(index) || index < 0) return;
    await runQueuedInputUpdate?.(input, "_edgeResourceSaveQueue", "Edge resource label mode change", async () => {
      await sheet.actor.setPeasantEdgeResourceLabelMode?.(index, input.val(), { render: false });
    });
    sheet.render(false);
  });

  html.on("change", ".edge-resource-custom-label", async (ev) => {
    if (!sheet.isEditMode) return;
    const input = $(ev.currentTarget);
    const index = Number.parseInt(input.data("resourceIndex"), 10);
    if (!Number.isFinite(index) || index < 0) return;
    await runQueuedInputUpdate?.(input, "_edgeResourceSaveQueue", "Edge resource custom label change", async () => {
      await sheet.actor.setPeasantEdgeResourceCustomLabel?.(index, input.val(), { render: false });
    });
  });

  html.on("input", ".edge-resource-custom-label", (ev) => {
    if (!sheet.isEditMode) return;
    sheet._scheduleEditAutosaveChange(ev.currentTarget, 260);
  });

  html.on("input", ".edge-resource-current, .edge-resource-max", (ev) => {
    const input = $(ev.currentTarget);
    const index = Number.parseInt(input.data("resourceIndex"), 10);
    if (!Number.isFinite(index) || index < 0) return;
    const isMax = input.hasClass("edge-resource-max");
    if (isMax) {
      const maxValue = Math.max(0, Number.parseInt(input.val(), 10) || 0);
      input.val(maxValue);
    } else {
      const entry = getEdgeResourceAt(index);
      if (!entry) return;
      const maxValue = Math.max(0, Number.parseInt(entry.max, 10) || 0);
      const value = Math.max(0, Number.parseInt(input.val(), 10) || 0);
      if (value > maxValue) input.val(maxValue);
    }
    sheet._scheduleEditAutosaveChange(ev.currentTarget, 240);
  });

  html.on("change", ".edge-resource-current, .edge-resource-max", async (ev) => {
    const input = $(ev.currentTarget);
    const index = Number.parseInt(input.data("resourceIndex"), 10);
    if (!Number.isFinite(index) || index < 0) return;
    const isMax = input.hasClass("edge-resource-max");
    await runQueuedInputUpdate?.(
      input,
      "_edgeResourceSaveQueue",
      isMax ? "Edge resource max change" : "Edge resource current change",
      async () => {
        if (isMax) {
          const maxValue = Math.max(0, Number.parseInt(input.val(), 10) || 0);
          input.val(maxValue);
          await sheet.actor.setPeasantEdgeResourceMax?.(index, maxValue, { render: false });
        } else {
          const entry = getEdgeResourceAt(index);
          const maxValue = Math.max(0, Number.parseInt(entry?.max, 10) || 0);
          const value = Math.max(0, Number.parseInt(input.val(), 10) || 0);
          const nextValue = Math.min(value, maxValue);
          input.val(nextValue);
          await sheet.actor.setPeasantEdgeResourceValue?.(index, nextValue, { render: false });
        }
      }
    );
  });
}

function setupResourceRefreshControls(sheet, html) {
  html.find(".resource-refresh").click(async (ev) => {
    const resourceName = $(ev.currentTarget).data("resource");
    await sheet.actor.refreshPeasantResource?.(resourceName);
  });
}
