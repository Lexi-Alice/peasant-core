import { showReadonlyDescriptionDialog } from "../controls/description-dialogs.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export function setupNotableCombatControls(sheet, html, {
  blurActiveEditableInSheet,
  enqueueSheetUpdate,
  runQueuedInputUpdate
} = {}) {
  const enqueue = enqueueSheetUpdate ?? (async (_queueKey, _label, task) => task());
  const runQueued = runQueuedInputUpdate ?? (async (_input, _queueKey, _label, task) => task());

  html.on("click", ".add-combat-btn", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    await enqueue("_combatSaveQueue", "Combat add", async () => {
      await sheet.actor.addPeasantNotableCombat?.({ render: false });
    });
    sheet.render(true);
  });

  html.on("click", ".combat-toggle-type", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = $(ev.currentTarget).closest(".combat-item");
    const index = resolveRowIndex(row, "data-combat-index");
    if (Number.isNaN(index)) return;
    await enqueue("_combatSaveQueue", "Combat type toggle", async () => {
      await sheet.actor.setPeasantNotableCombatType?.(index, "Other", { clearStandardFields: true, render: false });
    });
    sheet.render(true);
  });

  html.on("change", ".combat-select", async (ev) => {
    if (!sheet.isEditMode) return;
    const select = $(ev.currentTarget);
    const newType = select.val() || "standard";
    const row = select.closest(".combat-item");
    const index = resolveRowIndex(row, "data-combat-index");
    if (Number.isNaN(index)) return;
    await enqueue("_combatSaveQueue", "Combat type select", async () => {
      await sheet.actor.setPeasantNotableCombatType?.(index, newType, { render: false });
    });
    sheet.render(true);
  });

  html.on("click", ".combat-delete", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = $(ev.currentTarget).closest(".combat-item");
    const index = resolveRowIndex(row, "data-combat-index");
    if (Number.isNaN(index)) return;
    await enqueue("_combatSaveQueue", "Combat delete", async () => {
      await sheet.actor.removePeasantNotableCombat?.(index, { render: false });
    });
    sheet.render(true);
  });

  html.on("click", ".combat-indent", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      await blurActiveEditableInSheet?.();
      const row = $(ev.currentTarget).closest(".combat-item");
      const index = resolveRowIndex(row, "data-combat-index");
      if (Number.isNaN(index)) return;
      await enqueue("_combatSaveQueue", "Combat indent", async () => {
        await sheet.actor.changePeasantNotableCombatIndent?.(index, 1, { render: false });
      });
      sheet.render(true);
    } catch (e) {
      pcLog.debug("combat indent failed", e);
    }
  });

  html.on("click", ".combat-outdent", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      await blurActiveEditableInSheet?.();
      const row = $(ev.currentTarget).closest(".combat-item");
      const index = resolveRowIndex(row, "data-combat-index");
      if (Number.isNaN(index)) return;
      await enqueue("_combatSaveQueue", "Combat outdent", async () => {
        await sheet.actor.changePeasantNotableCombatIndent?.(index, -1, { render: false });
      });
      sheet.render(true);
    } catch (e) {
      pcLog.debug("combat outdent failed", e);
    }
  });

  html.on("change", ".combat-sig-checkbox", async (ev) => {
    if (!sheet.isEditMode) return;
    try {
      await enqueue("_combatSaveQueue", "Combat sig change", async () => {
        const cb = $(ev.currentTarget);
        const index = resolveItemIndex(cb, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
        if (index < 0) return;

        await sheet.actor.setPeasantNotableCombatSig?.(index, cb.is(":checked"), { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat sig change:", err);
    }
  });

  html.on("change", ".combat-class, .combat-rank, .combat-name, .combat-tohit, .combat-accuracy, .combat-special-grade", async (ev) => {
    const input = $(ev.currentTarget);
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
    if (index < 0) return;
    const row = input.closest(".combat-item");

    try {
      await runQueued(input, "_combatSaveQueue", "Combat main field change", async () => {
        const classEl = row.find(".combat-class");
        const rankEl = row.find(".combat-rank");
        const nameEl = row.find(".combat-name");
        const tohitEl = row.find(".combat-tohit");
        const accuracyEl = row.find(".combat-accuracy");
        const specialGradeEl = row.find(".combat-special-grade");

        const fields = {};
        if (classEl.length) fields.class = classEl.val();
        if (rankEl.length) fields.rank = rankEl.val();
        if (nameEl.length) fields.name = nameEl.val();
        if (tohitEl.length) fields.tohit = tohitEl.val();
        if (accuracyEl.length) fields.accuracy = accuracyEl.val();
        if (specialGradeEl.length) fields.specialGrade = specialGradeEl.val();

        await sheet.actor.setPeasantNotableCombatMainFields?.(index, fields, { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat field change:", err);
    }
  });

  html.on("change", ".combat-uses-max", async (ev) => {
    const input = $(ev.currentTarget);
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
    if (index < 0) return;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat usesMax change", async () => {
        await sheet.actor.setPeasantNotableCombatUsesMax?.(index, input.val(), { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat usesMax change:", err);
    }
  });

  html.on("change", ".combat-uses-current", async (ev) => {
    const input = $(ev.currentTarget);

    const idx = resolveItemIndex(input, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
    if (idx < 0) return;

    const raw = parseInt(input.val()) || 0;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat usesCurrent change", async () => {
        await sheet.actor.setPeasantNotableCombatUsesCurrent?.(idx, raw, { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat usesCurrent change:", err);
    }
  });

  html.on("change", ".combat-tag-sections-current", async (ev) => {
    const input = $(ev.currentTarget);

    const idx = resolveCombatTagInputIndex(input);
    if (idx < 0) return;

    const raw = parseInt(input.val()) || 0;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat sections current change", async () => {
        await sheet.actor.setPeasantNotableCombatSectionsCurrent?.(idx, raw, { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat sections current change:", err);
    }
  });

  html.on("change", ".combat-tag-splitsecond-current", async (ev) => {
    const input = $(ev.currentTarget);

    const idx = resolveCombatTagInputIndex(input);
    if (idx < 0) return;

    const raw = parseInt(input.val()) || 0;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat split second current change", async () => {
        await sheet.actor.setPeasantNotableCombatSplitSecondCurrent?.(idx, raw, { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat split second current change:", err);
    }
  });

  html.on("change", ".combat-tag-uses-current", async (ev) => {
    const input = $(ev.currentTarget);
    try {
      ev.preventDefault();
      await runQueued(input, "_combatSaveQueue", "Combat tag uses current change", async () => {
        const index = Number(input.data("index"));
        if (Number.isNaN(index) || index < 0) return;

        const newVal = Math.max(0, parseInt(input.val()) || 0);
        await sheet.actor.setPeasantNotableCombatTagUsesCurrent?.(index, newVal, { render: false });
      });
    } catch (e) {
      pcLog.debug("combat-tag-uses-current change failed", e);
    }
  });

  html.on("click", ".combat-name-view.combat-has-desc", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      const $el = $(ev.currentTarget);
      const index = Number($el.data("index"));
      if (Number.isNaN(index)) return;

      const combats = sheet.actor.system.notableCombats || [];
      const combat = combats[index] || {};
      const description = combat.description || "";
      const combatName = combat.name || "Combat";

      await showReadonlyDescriptionDialog(sheet, {
        title: `${combatName} - Description`,
        description
      });
    } catch (e) {
      pcLog.debug("combat-name-view click failed", e);
    }
  });
}

function resolveRowIndex(row, attr) {
  let index = parseInt(row.attr(attr));
  if (Number.isNaN(index)) index = row.index();
  return index;
}

function resolveItemIndex($source, { dataKey = "index", rowSelector = null, rowAttr = null } = {}) {
  let index = Number.parseInt($source?.data?.(dataKey));
  if (Number.isNaN(index) && rowSelector) {
    const row = $source.closest(rowSelector);
    if (row?.length) {
      if (rowAttr) index = Number.parseInt(row.attr(rowAttr));
      if (Number.isNaN(index)) index = row.index();
    }
  }
  return Number.isNaN(index) ? -1 : index;
}

function resolveCombatTagInputIndex($input) {
  let idx = Number.parseInt($input.data("index"));
  if (Number.isNaN(idx)) {
    const container = $input.closest(".combat-tags-inline");
    idx = Number.parseInt(container.attr("data-combat-index"));
  }
  return Number.isNaN(idx) ? -1 : idx;
}
