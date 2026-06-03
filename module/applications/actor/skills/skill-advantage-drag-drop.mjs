import { delegate, qsa, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

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

  setupSkillDragDropControls(sheet, root, doc);
  setupAdvantageDragDropControls(sheet, root, {
    sheetDocument: doc,
    sheetBody: body,
    blurActiveEditableInSheet,
    collectAdvantagesFromDOM,
    enqueueSheetUpdate
  });
}

function setupSkillDragDropControls(sheet, root, sheetDocument) {
  delegate(root, "dragstart", ".skills-list .skill-item", (ev, item) => {
    try {
      let index = resolveElementIndex(item, "data-skill-index");
      if (Number.isNaN(index)) return;
      const dt = ev.dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", String(index));
      }
      item.classList.add("dragging");
      item.style.opacity = "0.5";

      try {
        if (sheet._skillDragState && sheet._skillDragState.placeholder) {
          try { sheet._skillDragState.placeholder.remove(); } catch (e) {}
          sheet._skillDragState = null;
        }
        const placeholder = sheetDocument.createElement("div");
        placeholder.className = "skill-placeholder";
        placeholder.style.pointerEvents = "none";
        sheet._skillDragState = { fromIndex: index, placeholder, placeholderInserted: false };
        pcLog.debug("skill dragstart prepared placeholder at", index);
      } catch (phErr) {
        pcLog.debug("failed to prepare drag placeholder", phErr);
      }
    } catch (e) {
      pcLog.debug("skill dragstart failed", e);
    }
  });

  delegate(root, "dragend", ".skills-list .skill-item", (ev, item) => {
    try {
      item.classList.remove("dragging");
      if (sheet._skillDragState && sheet._skillDragState.placeholder) {
        sheet._skillDragState.placeholder.remove();
        sheet._skillDragState = null;
      }
      item.style.opacity = "";
    } catch (e) {}
  });

  delegate(root, "dragleave", ".skills-list", () => {
    try { clearDragMarkers(root, ".skills-list .skill-item"); } catch (e) {}
  });

  delegate(root, "dragover", ".skills-list, .skills-list .skill-item", (ev) => {
    try {
      ev.preventDefault();
      const dt = ev.dataTransfer;
      if (dt) dt.dropEffect = "move";

      try {
        const x = ev.clientX;
        const y = ev.clientY;
        const el = sheetDocument.elementFromPoint(x, y);
        if (!el) return;
        const closest = el.closest?.(".skills-list .skill-item");
        const items = getSkillItems(root);
        if (!sheet._skillDragState) return;
        let toIndex;
        if (closest) {
          toIndex = resolveElementIndex(closest, "data-skill-index");
        } else {
          toIndex = items.length;
        }
        if (Number.isNaN(toIndex)) return;
        clearDragMarkers(root, ".skills-list .skill-item");
        const fromIndex = Number.isFinite(Number.parseInt(sheet._skillDragState.fromIndex, 10)) ? Number.parseInt(sheet._skillDragState.fromIndex, 10) : null;
        if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) {
          return;
        }
        markDropTarget(items, toIndex);
      } catch (mErr) {
        /* ignore */
      }
    } catch (e) {}
  });

  delegate(root, "drop", ".skills-list, .skills-list .skill-item", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      const data = ev.dataTransfer?.getData("text/plain") ?? "";
      const fromIndex = Number.isFinite(Number.parseInt(data, 10)) ? Number.parseInt(data, 10) : null;
      if (fromIndex === null) return;

      const dropTarget = ev.target?.closest?.(".skill-item");
      let toIndex = null;
      if (dropTarget) {
        toIndex = resolveElementIndex(dropTarget, "data-skill-index");
      } else {
        toIndex = getSkillItems(root).length;
      }
      if (Number.isNaN(toIndex)) return;

      try {
        if (sheet._skillDragState && sheet._skillDragState.placeholder) {
          sheet._skillDragState.placeholder.remove();
          sheet._skillDragState = null;
        }
      } catch (e) {}
      await sheet.actor.reorderPeasantSkill?.(fromIndex, toIndex);
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
      let index = resolveElementIndex(item, "data-advantage-index");
      if (Number.isNaN(index)) return;
      const dt = ev.dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", `adv:${index}`);
      }
      item.classList.add("dragging");
      sheet._advDragState = { fromIndex: index };
    } catch (e) {
      pcLog.debug("advantage dragstart failed", e);
    }
  });

  delegate(html, "dragend", ".advantages-list .advantage-item", (ev, item) => {
    try {
      item.classList.remove("dragging");
      sheet._advDragState = null;
      clearDragMarkers(html, ".advantages-list .advantage-item");
    } catch (e) {}
  });

  delegate(html, "dragover", ".advantages-list, .advantages-list .advantage-item", (ev) => {
    try {
      if (!sheet.isEditMode) return;
      ev.preventDefault();
      const dt = ev.dataTransfer;
      if (dt) dt.dropEffect = "move";

      const x = ev.clientX;
      const y = ev.clientY;
      const el = sheetDocument.elementFromPoint(x, y);
      if (!el) return;
      const closest = el.closest?.(".advantages-list .advantage-item");
      const items = getAdvantageItems(html);
      clearDragMarkers(html, ".advantages-list .advantage-item");

      if (!sheet._advDragState) return;
      let toIndex;
      if (closest) {
        toIndex = resolveElementIndex(closest, "data-advantage-index");
      } else {
        toIndex = items.length;
      }
      if (Number.isNaN(toIndex)) return;

      const fromIndex = sheet._advDragState.fromIndex;
      if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) return;

      markDropTarget(items, toIndex);
    } catch (e) {}
  });

  delegate(html, "dragleave", ".advantages-list", () => {
    try { clearDragMarkers(html, ".advantages-list .advantage-item"); } catch (e) {}
  });

  delegate(html, "drop", ".advantages-list, .advantages-list .advantage-item", async (ev) => {
    try {
      if (!sheet.isEditMode) return;
      ev.preventDefault();
      ev.stopPropagation();
      const data = ev.dataTransfer?.getData("text/plain") ?? "";
      if (!data.startsWith("adv:")) return;
      const fromIndex = Number.parseInt(data.replace("adv:", ""), 10);
      if (Number.isNaN(fromIndex)) return;

      const dropTarget = ev.target?.closest?.(".advantage-item");
      let toIndex = null;
      if (dropTarget) {
        toIndex = resolveElementIndex(dropTarget, "data-advantage-index");
      } else {
        toIndex = getAdvantageItems(html).length;
      }
      if (Number.isNaN(toIndex)) return;

      await blurActiveEditableInSheet?.();
      await enqueue("_advantageSaveQueue", "Advantage reorder", async () => {
        const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
        sheet._advDragState = null;
        await sheet.actor.reorderPeasantFlexibleAdvantage?.(fromIndex, toIndex, adv.names, adv.descriptions);
      });
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

        row.classList.add("dragging");

        const previousUserSelect = sheetBody.style.userSelect;
        sheetBody.style.userSelect = "none";

        advPointerDragState = { fromIndex, draggedEl: row, targetIndex: fromIndex, previousUserSelect };

        const onMove = (moveEv) => {
          try {
            const x = moveEv.clientX;
            const y = moveEv.clientY;
            const el = sheetDocument.elementFromPoint(x, y);
            if (!el) return;
            const closest = el.closest?.(".advantages-list .advantage-item");
            const items = getAdvantageItems(html);

            clearDragMarkers(html, ".advantages-list .advantage-item");

            let toIndex = null;
            if (closest) {
              toIndex = resolveElementIndex(closest, "data-advantage-index");
            } else {
              toIndex = items.length;
            }
            if (Number.isNaN(toIndex)) return;

            const from = advPointerDragState.fromIndex;
            const isOriginalPos = (from !== null && (toIndex === from || toIndex === from + 1));

            if (isOriginalPos) {
              advPointerDragState.targetIndex = toIndex;
              return;
            }

            markDropTarget(items, toIndex);
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
            clearDragMarkers(html, ".advantages-list .advantage-item");
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

function getSkillItems(root) {
  return qsa(root, ".skills-list .skill-item");
}

function getAdvantageItems(root) {
  return qsa(root, ".advantages-list .advantage-item");
}

function clearDragMarkers(root, selector) {
  for (const item of qsa(root, selector)) item.classList.remove("drag-over-top", "drag-over-bottom");
}

function markDropTarget(items, toIndex) {
  if (!items.length) return;
  if (toIndex >= items.length) items[items.length - 1].classList.add("drag-over-bottom");
  else items[toIndex]?.classList.add("drag-over-top");
}

function resolveElementIndex(element, attr) {
  const el = toElement(element);
  let index = Number.parseInt(el?.getAttribute(attr), 10);
  if (Number.isNaN(index) && el?.parentElement) index = Array.from(el.parentElement.children).indexOf(el);
  return index;
}
