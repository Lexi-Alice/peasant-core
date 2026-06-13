import { delegate, qsa, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

const SKILL_DRAG_PREFIX = "peasant-core.skill-sort";
const ADVANTAGE_DRAG_PREFIX = "peasant-core.flexible-advantage-sort";
const SKILL_DRAG_BLOCK_SELECTOR = "button, input, select, textarea, a, .skill-actions";
const ADVANTAGE_DRAG_BLOCK_SELECTOR = "button, input, select, textarea, a";

export function setupSkillAdvantageDragDropControls(sheet, html, {
  sheetDocument,
  sheetBody,
  blurActiveEditableInSheet,
  collectAdvantagesFromDOM,
  enqueueSheetUpdate
} = {}) {
  const root = toElement(html);
  if (!root) return;

  const doc = sheetDocument ?? sheet?._getElementDocument?.(root) ?? root.ownerDocument ?? document;
  const body = sheetBody ?? doc?.body ?? document.body;

  setupSkillDragDropControls(sheet, root);
  setupAdvantageDragDropControls(sheet, root, {
    sheetDocument: doc,
    sheetBody: body,
    blurActiveEditableInSheet,
    collectAdvantagesFromDOM,
    enqueueSheetUpdate
  });
}

function setupSkillDragDropControls(sheet, root) {
  delegate(root, "dragstart", ".skills-list .skill-item", (ev, item) => {
    try {
      if (ev.target?.closest?.(SKILL_DRAG_BLOCK_SELECTOR)) {
        ev.preventDefault();
        return;
      }

      let index = resolveElementIndex(item, "data-skill-index");
      if (Number.isNaN(index)) return;
      const list = item.closest(".skills-list");
      if (!list) return;

      item.classList.add("dragging");
      sheet._skillDragState = {
        actorUuid: sheet.actor?.uuid,
        fromIndex: index,
        list
      };

      const dt = ev.dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", `${SKILL_DRAG_PREFIX}:${sheet.actor?.uuid ?? ""}:${index}`);
        const box = item.getBoundingClientRect();
        dt.setDragImage(item, Math.min(box.width - 6, 48), box.height / 2);
      }
    } catch (e) {
      pcLog.debug("skill dragstart failed", e);
    }
  });

  delegate(root, "dragend", ".skills-list .skill-item", (ev, item) => {
    try {
      item.classList.remove("dragging");
      sheet._skillDragState = null;
      clearSkillDragMarkers(root);
    } catch (e) {}
  });

  delegate(root, "dragleave", ".skills-list", () => {
    try { clearSkillDragMarkers(root); } catch (e) {}
  });

  delegate(root, "dragover", ".skills-list, .skills-list .skill-item", (ev, target) => {
    try {
      if (!sheet._skillDragState) return;

      const list = target.closest?.(".skills-list");
      if (!list || list !== sheet._skillDragState.list) return;

      ev.preventDefault();
      ev.stopImmediatePropagation();
      const dt = ev.dataTransfer;
      if (dt) dt.dropEffect = "move";
      clearSkillDragMarkers(root);

      const targetRow = getSkillDropTargetRow(ev.target, list);
      if (!targetRow) return;
      const targetIndex = resolveElementIndex(targetRow, "data-skill-index");
      if (Number.isNaN(targetIndex)) return;
      const dropAfter = isVerticalDropAfter(targetRow, ev.clientY);
      const toIndex = targetIndex + (dropAfter ? 1 : 0);
      const fromIndex = Number.isFinite(Number.parseInt(sheet._skillDragState.fromIndex, 10)) ? Number.parseInt(sheet._skillDragState.fromIndex, 10) : null;
      if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) return;

      targetRow.classList.toggle("drag-over-bottom", dropAfter);
      targetRow.classList.toggle("drag-over-top", !dropAfter);
    } catch (e) {}
  });

  delegate(root, "drop", ".skills-list, .skills-list .skill-item", async (ev, target) => {
    try {
      const dragData = getSkillSortDragData(ev);
      if (!sheet._skillDragState || dragData?.actorUuid !== sheet.actor?.uuid) return;

      const list = target.closest?.(".skills-list");
      if (!list || list !== sheet._skillDragState.list) return;

      ev.preventDefault();
      ev.stopImmediatePropagation();
      clearSkillDragMarkers(root);

      try {
        const fromIndex = dragData.fromIndex;
        if (Number.isNaN(fromIndex)) return;

        const dropTarget = getSkillDropTargetRow(ev.target, list);
        if (!dropTarget) return;

        const targetIndex = resolveElementIndex(dropTarget, "data-skill-index");
        const toIndex = targetIndex + (isVerticalDropAfter(dropTarget, ev.clientY) ? 1 : 0);
        if (Number.isNaN(toIndex)) return;
        if (toIndex === fromIndex || toIndex === fromIndex + 1) return;

        await sheet.actor.reorderPeasantSkill?.(fromIndex, toIndex);
      } finally {
        sheet._skillDragState = null;
      }
    } catch (e) {
      console.warn("Failed to reorder skills via drag/drop:", e);
    }
  });
}

function setupAdvantageDragDropControls(sheet, html, {
  sheetDocument,
  sheetBody,
  blurActiveEditableInSheet,
  collectAdvantagesFromDOM,
  enqueueSheetUpdate
} = {}) {
  const enqueue = enqueueSheetUpdate ?? (async (_queueKey, _label, task) => task());

  delegate(html, "dragstart", ".advantages-list .advantage-item", (ev, item) => {
    try {
      if (!sheet.isEditMode) return;
      if (ev.target?.closest?.(ADVANTAGE_DRAG_BLOCK_SELECTOR)) {
        ev.preventDefault();
        return;
      }

      let index = resolveElementIndex(item, "data-advantage-index");
      if (Number.isNaN(index)) return;
      const list = item.closest(".advantages-list");
      if (!list) return;

      item.classList.add("dragging");
      sheet._advDragState = {
        actorUuid: sheet.actor?.uuid,
        fromIndex: index,
        list
      };

      const dt = ev.dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", `${ADVANTAGE_DRAG_PREFIX}:${sheet.actor?.uuid ?? ""}:${index}`);
        const box = item.getBoundingClientRect();
        dt.setDragImage(item, Math.min(box.width - 6, 48), box.height / 2);
      }
    } catch (e) {
      pcLog.debug("advantage dragstart failed", e);
    }
  });

  delegate(html, "dragend", ".advantages-list .advantage-item", (ev, item) => {
    try {
      item.classList.remove("dragging");
      sheet._advDragState = null;
      clearAdvantageDragMarkers(html);
    } catch (e) {}
  });

  delegate(html, "dragover", ".advantages-list, .advantages-list .advantage-item", (ev, target) => {
    try {
      if (!sheet.isEditMode) return;
      if (!sheet._advDragState) return;

      const list = target.closest?.(".advantages-list");
      if (!list || list !== sheet._advDragState.list) return;

      ev.preventDefault();
      ev.stopImmediatePropagation();
      const dt = ev.dataTransfer;
      if (dt) dt.dropEffect = "move";
      clearAdvantageDragMarkers(html);

      const targetRow = getAdvantageDropTargetRow(ev.target, list);
      if (!targetRow) return;
      const targetIndex = resolveElementIndex(targetRow, "data-advantage-index");
      if (Number.isNaN(targetIndex)) return;
      const dropAfter = isVerticalDropAfter(targetRow, ev.clientY);
      const toIndex = targetIndex + (dropAfter ? 1 : 0);
      const fromIndex = sheet._advDragState.fromIndex;
      if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) return;

      targetRow.classList.toggle("drag-over-bottom", dropAfter);
      targetRow.classList.toggle("drag-over-top", !dropAfter);
    } catch (e) {}
  });

  delegate(html, "dragleave", ".advantages-list", () => {
    try { clearAdvantageDragMarkers(html); } catch (e) {}
  });

  delegate(html, "drop", ".advantages-list, .advantages-list .advantage-item", async (ev, target) => {
    try {
      if (!sheet.isEditMode) return;
      const dragData = getAdvantageSortDragData(ev);
      if (!sheet._advDragState || dragData?.actorUuid !== sheet.actor?.uuid) return;

      const list = target.closest?.(".advantages-list");
      if (!list || list !== sheet._advDragState.list) return;

      ev.preventDefault();
      ev.stopImmediatePropagation();
      clearAdvantageDragMarkers(html);

      try {
        const fromIndex = dragData.fromIndex;
        if (Number.isNaN(fromIndex)) return;

        const dropTarget = getAdvantageDropTargetRow(ev.target, list);
        if (!dropTarget) return;

        const targetIndex = resolveElementIndex(dropTarget, "data-advantage-index");
        const toIndex = targetIndex + (isVerticalDropAfter(dropTarget, ev.clientY) ? 1 : 0);
        if (Number.isNaN(toIndex)) return;
        if (toIndex === fromIndex || toIndex === fromIndex + 1) return;

        await blurActiveEditableInSheet?.();
        await enqueue("_advantageSaveQueue", "Advantage reorder", async () => {
          const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
          await sheet.actor.reorderPeasantFlexibleAdvantage?.(fromIndex, toIndex, adv.names, adv.descriptions);
        });
      } finally {
        sheet._advDragState = null;
      }
    } catch (e) {
      console.warn("Failed to reorder advantages via drag/drop:", e);
    }
  });

  setupAdvantagePointerDragControls(sheet, html, {
    sheetDocument,
    sheetBody,
    blurActiveEditableInSheet,
    collectAdvantagesFromDOM,
    enqueue
  });
}

function setupAdvantagePointerDragControls(sheet, html, {
  sheetDocument,
  sheetBody,
  blurActiveEditableInSheet,
  collectAdvantagesFromDOM,
  enqueue
} = {}) {
  try {
    let advPointerDragState = null;

    delegate(html, "pointerdown", ".advantage-drag-handle", (ev, handle) => {
      try {
        if (!sheet?.isEditMode) return;
        ev.preventDefault();
        ev.stopPropagation();
        const row = handle.closest(".advantage-item");
        let fromIndex = resolveElementIndex(row, "data-advantage-index");
        if (Number.isNaN(fromIndex)) return;
        const list = row.closest(".advantages-list");
        if (!list) return;

        row.classList.add("dragging");

        const previousUserSelect = sheetBody.style.userSelect;
        sheetBody.style.userSelect = "none";

        advPointerDragState = { fromIndex, draggedEl: row, list, targetIndex: fromIndex, previousUserSelect };

        const onMove = (moveEv) => {
          try {
            const x = moveEv.clientX;
            const y = moveEv.clientY;
            const el = sheetDocument.elementFromPoint(x, y);
            if (!el) return;
            clearAdvantageDragMarkers(html);
            if (!advPointerDragState?.list?.contains?.(el)) return;

            const targetRow = getAdvantageDropTargetRow(el, advPointerDragState.list);
            if (!targetRow) return;
            const targetIndex = resolveElementIndex(targetRow, "data-advantage-index");
            const dropAfter = isVerticalDropAfter(targetRow, moveEv.clientY);
            const toIndex = targetIndex + (dropAfter ? 1 : 0);
            if (Number.isNaN(toIndex)) return;

            const from = advPointerDragState.fromIndex;
            const isOriginalPos = (from !== null && (toIndex === from || toIndex === from + 1));

            if (isOriginalPos) {
              advPointerDragState.targetIndex = toIndex;
              return;
            }

            targetRow.classList.toggle("drag-over-bottom", dropAfter);
            targetRow.classList.toggle("drag-over-top", !dropAfter);
            advPointerDragState.targetIndex = toIndex;
          } catch (e) {
            /* ignore */
          }
        };

        const onUp = async () => {
          try {
            sheetDocument.removeEventListener("mousemove", onMove);
            sheetDocument.removeEventListener("mouseup", onUp);
            if (!advPointerDragState) return;
            const { fromIndex: f, targetIndex: t, draggedEl: dr, previousUserSelect: prev } = advPointerDragState;
            dr.classList.remove("dragging");
            clearAdvantageDragMarkers(html);
            advPointerDragState = null;
            sheetBody.style.userSelect = prev || "";

            const toIndex = Math.max(0, Number.parseInt(t, 10) || 0);
            const effectiveIndex = f < toIndex ? toIndex - 1 : toIndex;
            if (f === effectiveIndex) return;

            await blurActiveEditableInSheet?.();
            await enqueue("_advantageSaveQueue", "Advantage pointer reorder", async () => {
              const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
              await sheet.actor.reorderPeasantFlexibleAdvantage?.(f, toIndex, adv.names, adv.descriptions);
            });
          } catch (e) {
            console.warn("Pointer drag reorder for advantages failed", e);
          }
        };

        sheetDocument.addEventListener("mousemove", onMove);
        sheetDocument.addEventListener("mouseup", onUp);
      } catch (e) {
        pcLog.debug("advantage drag mousedown failed", e);
      }
    });
  } catch (e) {
    /* ignore */
  }
}

function clearSkillDragMarkers(root) {
  clearDragMarkers(root, ".skills-list .skill-item");
}

function clearAdvantageDragMarkers(root) {
  clearDragMarkers(root, ".advantages-list .advantage-item");
}

function getSkillRowsInList(list) {
  return qsa(list, ".skill-item:not([hidden])");
}

function getAdvantageRowsInList(list) {
  return qsa(list, ".advantage-item:not([hidden])");
}

function getSkillDropTargetRow(target, list) {
  return target?.closest?.(".skill-item") ?? getSkillRowsInList(list).at(-1) ?? null;
}

function getAdvantageDropTargetRow(target, list) {
  return target?.closest?.(".advantage-item") ?? getAdvantageRowsInList(list).at(-1) ?? null;
}

function getSkillSortDragData(event) {
  const raw = event?.dataTransfer?.getData?.("text/plain") ?? "";
  const [, actorUuid, fromIndex] = raw.match(/^peasant-core\.skill-sort:(.+):(\d+)$/) ?? [];
  return actorUuid ? { actorUuid, fromIndex: Number.parseInt(fromIndex, 10) } : null;
}

function getAdvantageSortDragData(event) {
  const raw = event?.dataTransfer?.getData?.("text/plain") ?? "";
  const [, actorUuid, fromIndex] = raw.match(/^peasant-core\.flexible-advantage-sort:(.+):(\d+)$/) ?? [];
  return actorUuid ? { actorUuid, fromIndex: Number.parseInt(fromIndex, 10) } : null;
}

function clearDragMarkers(root, selector) {
  for (const item of qsa(root, selector)) item.classList.remove("drag-over-top", "drag-over-bottom");
}

function isVerticalDropAfter(row, clientY) {
  const rect = row.getBoundingClientRect();
  return clientY >= rect.top + (rect.height / 2);
}

function resolveElementIndex(element, attr) {
  const el = toElement(element);
  let index = Number.parseInt(el?.getAttribute(attr), 10);
  if (Number.isNaN(index) && el?.parentElement) index = Array.from(el.parentElement.children).indexOf(el);
  return index;
}
