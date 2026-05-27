import { showReadonlyDescriptionDialog } from "../controls/description-dialogs.mjs";
import { formatOptionalIntegerInput, parseOptionalInteger, sanitizeOptionalIntegerInputValue } from "../../../data/actor/helpers.mjs";
import { delegate, qs, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export function setupNotableCombatControls(sheet, html, {
  blurActiveEditableInSheet,
  enqueueSheetUpdate,
  runQueuedInputUpdate
} = {}) {
  const root = toElement(html);
  if (!root) return;

  const enqueue = enqueueSheetUpdate ?? (async (_queueKey, _label, task) => task());
  const runQueued = runQueuedInputUpdate ?? (async (_input, _queueKey, _label, task) => task());

  delegate(root, "click", ".add-combat-btn", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    await enqueue("_combatSaveQueue", "Combat add", async () => {
      await sheet.actor.addPeasantNotableCombat?.({ render: false });
    });
    sheet.render(true);
  });

  delegate(root, "click", ".combat-toggle-type", async (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = target.closest(".combat-item");
    const index = resolveRowIndex(row, "data-combat-index");
    if (Number.isNaN(index)) return;
    await enqueue("_combatSaveQueue", "Combat type toggle", async () => {
      await sheet.actor.setPeasantNotableCombatType?.(index, "Other", { clearStandardFields: true, render: false });
    });
    sheet.render(true);
  });

  delegate(root, "change", ".combat-select", async (ev, select) => {
    if (!sheet.isEditMode) return;
    const newType = select.value || "standard";
    const row = select.closest(".combat-item");
    const index = resolveRowIndex(row, "data-combat-index");
    if (Number.isNaN(index)) return;
    await enqueue("_combatSaveQueue", "Combat type select", async () => {
      await sheet.actor.setPeasantNotableCombatType?.(index, newType, { render: false });
    });
    sheet.render(true);
  });

  delegate(root, "click", ".combat-delete", async (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = target.closest(".combat-item");
    const index = resolveRowIndex(row, "data-combat-index");
    if (Number.isNaN(index)) return;
    await enqueue("_combatSaveQueue", "Combat delete", async () => {
      await sheet.actor.removePeasantNotableCombat?.(index, { render: false });
    });
    sheet.render(true);
  });

  delegate(root, "click", ".combat-indent", async (ev, target) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      await blurActiveEditableInSheet?.();
      const row = target.closest(".combat-item");
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

  delegate(root, "click", ".combat-outdent", async (ev, target) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      await blurActiveEditableInSheet?.();
      const row = target.closest(".combat-item");
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

  delegate(root, "change", ".combat-sig-checkbox", async (ev, checkbox) => {
    if (!sheet.isEditMode) return;
    try {
      await enqueue("_combatSaveQueue", "Combat sig change", async () => {
        const index = resolveItemIndex(checkbox, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
        if (index < 0) return;

        await sheet.actor.setPeasantNotableCombatSig?.(index, !!checkbox.checked, { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat sig change:", err);
    }
  });

  delegate(root, "input", ".combat-tohit", (ev, input) => {
    if (!sheet.isEditMode) return;
    sanitizeOptionalIntegerInputElement(input);
  });

  delegate(root, "input", ".combat-accuracy", (ev, input) => {
    if (!sheet.isEditMode) return;
    sanitizeOptionalIntegerInputElement(input, { allowSign: true });
  });

  delegate(root, "change", ".combat-class, .combat-rank, .combat-name, .combat-tohit, .combat-accuracy, .combat-special-grade", async (ev, input) => {
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
    if (index < 0) return;
    const row = input.closest(".combat-item");

    try {
      await runQueued(input, "_combatSaveQueue", "Combat main field change", async () => {
        const classEl = qs(row, ".combat-class");
        const rankEl = qs(row, ".combat-rank");
        const nameEl = qs(row, ".combat-name");
        const tohitEl = qs(row, ".combat-tohit");
        const accuracyEl = qs(row, ".combat-accuracy");
        const specialGradeEl = qs(row, ".combat-special-grade");

        const fields = {};
        if (classEl) fields.class = classEl.value;
        if (rankEl) fields.rank = rankEl.value;
        if (nameEl) fields.name = nameEl.value;
        if (tohitEl) fields.tohit = tohitEl.value;
        if (accuracyEl) fields.accuracy = accuracyEl.value;
        if (specialGradeEl) fields.specialGrade = specialGradeEl.value;

        const result = await sheet.actor.setPeasantNotableCombatMainFields?.(index, fields, { render: false });
        const savedCombat = result?.combats?.[index] || {};
        if (tohitEl) tohitEl.value = formatOptionalIntegerInput(savedCombat.tohit ?? parseOptionalInteger(fields.tohit, { min: 1 }));
        if (accuracyEl) accuracyEl.value = formatOptionalIntegerInput(savedCombat.accuracy ?? parseOptionalInteger(fields.accuracy, { allowSign: true }), { showPlus: true });
      });
    } catch (err) {
      console.warn("Failed to persist combat field change:", err);
    }
  });

  delegate(root, "change", ".combat-uses-max", async (ev, input) => {
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
    if (index < 0) return;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat usesMax change", async () => {
        await sheet.actor.setPeasantNotableCombatUsesMax?.(index, input.value, { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat usesMax change:", err);
    }
  });

  delegate(root, "change", ".combat-uses-current", async (ev, input) => {
    const idx = resolveItemIndex(input, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
    if (idx < 0) return;

    const raw = Number.parseInt(input.value, 10) || 0;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat usesCurrent change", async () => {
        await sheet.actor.setPeasantNotableCombatUsesCurrent?.(idx, raw, { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat usesCurrent change:", err);
    }
  });

  delegate(root, "change", ".combat-tag-sections-current", async (ev, input) => {
    const idx = resolveCombatTagInputIndex(input);
    if (idx < 0) return;

    const raw = Number.parseInt(input.value, 10) || 0;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat sections current change", async () => {
        await sheet.actor.setPeasantNotableCombatSectionsCurrent?.(idx, raw, { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat sections current change:", err);
    }
  });

  delegate(root, "change", ".combat-tag-splitsecond-current", async (ev, input) => {
    const idx = resolveCombatTagInputIndex(input);
    if (idx < 0) return;

    const raw = Number.parseInt(input.value, 10) || 0;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat split second current change", async () => {
        await sheet.actor.setPeasantNotableCombatSplitSecondCurrent?.(idx, raw, { render: false });
      });
    } catch (err) {
      console.warn("Failed to persist combat split second current change:", err);
    }
  });

  delegate(root, "change", ".combat-tag-uses-current", async (ev, input) => {
    try {
      ev.preventDefault();
      await runQueued(input, "_combatSaveQueue", "Combat tag uses current change", async () => {
        const index = Number(input.dataset.index);
        if (Number.isNaN(index) || index < 0) return;

        const newVal = Math.max(0, Number.parseInt(input.value, 10) || 0);
        await sheet.actor.setPeasantNotableCombatTagUsesCurrent?.(index, newVal, { render: false });
      });
    } catch (e) {
      pcLog.debug("combat-tag-uses-current change failed", e);
    }
  });

  delegate(root, "click", ".combat-name-view.combat-has-desc", async (ev, element) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      const index = Number(element.dataset.index);
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
  const element = toElement(row);
  let index = Number.parseInt(element?.getAttribute(attr), 10);
  if (Number.isNaN(index) && element?.parentElement) index = Array.from(element.parentElement.children).indexOf(element);
  return index;
}

function resolveItemIndex(source, { dataKey = "index", rowSelector = null, rowAttr = null } = {}) {
  const element = toElement(source);
  let index = Number.parseInt(element?.dataset?.[dataKey], 10);
  if (Number.isNaN(index) && rowSelector) {
    const row = element?.closest?.(rowSelector);
    if (row) {
      if (rowAttr) index = Number.parseInt(row.getAttribute(rowAttr), 10);
      if (Number.isNaN(index) && row.parentElement) index = Array.from(row.parentElement.children).indexOf(row);
    }
  }
  return Number.isNaN(index) ? -1 : index;
}

function sanitizeOptionalIntegerInputElement(input, options = {}) {
  if (!input) return;
  const before = String(input.value ?? "");
  const normalized = sanitizeOptionalIntegerInputValue(before, options);
  if (normalized === before) return;

  const pos = input.selectionStart ?? before.length;
  const normalizedBeforeCursor = sanitizeOptionalIntegerInputValue(before.slice(0, pos), options);
  input.value = normalized;
  const nextPos = Math.max(0, Math.min(normalized.length, normalizedBeforeCursor.length));
  try { input.setSelectionRange(nextPos, nextPos); } catch (e) { /* ignore */ }
}

function resolveCombatTagInputIndex(input) {
  const element = toElement(input);
  let idx = Number.parseInt(element?.dataset?.index, 10);
  if (Number.isNaN(idx)) {
    const container = element?.closest?.(".combat-tags-inline");
    idx = Number.parseInt(container?.dataset?.combatIndex, 10);
  }
  return Number.isNaN(idx) ? -1 : idx;
}
