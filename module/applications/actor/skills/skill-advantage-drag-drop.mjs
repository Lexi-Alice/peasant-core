import { pcLog } from "../../../utils/logging.mjs";

export function setupSkillAdvantageDragDropControls(sheet, html, {
  sheetDocument,
  sheetBody,
  blurActiveEditableInSheet,
  collectAdvantagesFromDOM,
  enqueueSheetUpdate
} = {}) {
  const doc = sheetDocument ?? sheet?._getElementDocument?.(html?.[0]) ?? document;
  const body = sheetBody ?? doc?.body ?? document.body;

  setupSkillDragDropControls(sheet, html, doc);
  setupAdvantageDragDropControls(sheet, html, {
    sheetDocument: doc,
    sheetBody: body,
    blurActiveEditableInSheet,
    collectAdvantagesFromDOM,
    enqueueSheetUpdate
  });
}

function setupSkillDragDropControls(sheet, html, sheetDocument) {
  html.on("dragstart", ".skills-list .skill-item", (ev) => {
    try {
      const el = $(ev.currentTarget);
      let index = parseInt(el.attr("data-skill-index"));
      if (Number.isNaN(index)) index = el.index();
      if (Number.isNaN(index)) return;
      const dt = ev.originalEvent.dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", String(index));
      }
      el.addClass("dragging");
      try { el.css("opacity", "0.5"); } catch (e) {}

      try {
        if (sheet._skillDragState && sheet._skillDragState.placeholder) {
          try { sheet._skillDragState.placeholder.remove(); } catch (e) {}
          sheet._skillDragState = null;
        }
        const placeholder = $(`<div class="skill-placeholder" style="height: 8px; background: rgba(33,150,243,0.6); border-radius: 4px; margin: 6px 0; width: calc(100% - 12px);"></div>`);
        placeholder.css("pointer-events", "none");
        sheet._skillDragState = { fromIndex: index, placeholder, placeholderInserted: false };
        pcLog.debug("skill dragstart prepared placeholder at", index);
      } catch (phErr) {
        pcLog.debug("failed to prepare drag placeholder", phErr);
      }
    } catch (e) {
      pcLog.debug("skill dragstart failed", e);
    }
  });

  html.on("dragend", ".skills-list .skill-item", (ev) => {
    try {
      $(ev.currentTarget).removeClass("dragging");
      if (sheet._skillDragState && sheet._skillDragState.placeholder) {
        sheet._skillDragState.placeholder.remove();
        sheet._skillDragState = null;
      }
      try { $(ev.currentTarget).css("opacity", ""); } catch (e) {}
    } catch (e) {}
  });

  html.on("dragleave", ".skills-list", () => {
    try { getSheetJQ(sheet).find(".skills-list .skill-item").removeClass("drag-over-top drag-over-bottom"); } catch (e) {}
  });

  html.on("dragover", ".skills-list, .skills-list .skill-item", (ev) => {
    try {
      ev.preventDefault();
      const dt = ev.originalEvent.dataTransfer;
      if (dt) dt.dropEffect = "move";

      try {
        const x = ev.originalEvent.clientX;
        const y = ev.originalEvent.clientY;
        const el = sheetDocument.elementFromPoint(x, y);
        if (!el) return;
        const $closest = $(el).closest(".skills-list .skill-item");
        const items = getSheetJQ(sheet).find(".skills-list .skill-item");
        if (!sheet._skillDragState) return;
        let toIndex;
        if ($closest.length) {
          toIndex = parseInt($closest.attr("data-skill-index"));
          if (Number.isNaN(toIndex)) toIndex = $closest.index();
        } else {
          toIndex = items.length;
        }
        if (Number.isNaN(toIndex)) return;
        items.removeClass("drag-over-top drag-over-bottom");
        const fromIndex = Number.isFinite(parseInt(sheet._skillDragState.fromIndex)) ? parseInt(sheet._skillDragState.fromIndex) : null;
        if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) {
          return;
        }
        if (toIndex >= items.length) {
          if (items.length) items.last().addClass("drag-over-bottom");
        } else {
          items.eq(toIndex).addClass("drag-over-top");
        }
      } catch (mErr) {
        /* ignore */
      }
    } catch (e) {}
  });

  html.on("drop", ".skills-list, .skills-list .skill-item", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      const data = ev.originalEvent.dataTransfer.getData("text/plain");
      const fromIndex = Number.isFinite(parseInt(data)) ? parseInt(data) : null;
      if (fromIndex === null) return;

      const dropTarget = $(ev.target).closest(".skill-item");
      let toIndex = null;
      if (dropTarget.length) {
        toIndex = parseInt(dropTarget.attr("data-skill-index"));
        if (Number.isNaN(toIndex)) toIndex = dropTarget.index();
      } else {
        toIndex = html.find(".skills-list .skill-item").length - 1 + 1;
      }
      if (Number.isNaN(toIndex)) return;

      try {
        if (sheet._skillDragState && sheet._skillDragState.placeholder) {
          sheet._skillDragState.placeholder.remove();
          sheet._skillDragState = null;
        }
      } catch (e) {}
      await sheet.actor.reorderPeasantSkill?.(fromIndex, toIndex);
      sheet.render(true);
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

  html.on("dragstart", ".advantages-list .advantage-item", (ev) => {
    try {
      if (!sheet.isEditMode) return;
      const el = $(ev.currentTarget);
      let index = parseInt(el.attr("data-advantage-index"));
      if (Number.isNaN(index)) index = el.index();
      if (Number.isNaN(index)) return;
      const dt = ev.originalEvent.dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", `adv:${index}`);
      }
      el.addClass("dragging");
      sheet._advDragState = { fromIndex: index };
    } catch (e) {
      pcLog.debug("advantage dragstart failed", e);
    }
  });

  html.on("dragend", ".advantages-list .advantage-item", (ev) => {
    try {
      $(ev.currentTarget).removeClass("dragging");
      sheet._advDragState = null;
      getSheetJQ(sheet).find(".advantages-list .advantage-item").removeClass("drag-over-top drag-over-bottom");
    } catch (e) {}
  });

  html.on("dragover", ".advantages-list, .advantages-list .advantage-item", (ev) => {
    try {
      if (!sheet.isEditMode) return;
      ev.preventDefault();
      const dt = ev.originalEvent.dataTransfer;
      if (dt) dt.dropEffect = "move";

      const x = ev.originalEvent.clientX;
      const y = ev.originalEvent.clientY;
      const el = sheetDocument.elementFromPoint(x, y);
      if (!el) return;
      const $closest = $(el).closest(".advantages-list .advantage-item");
      const items = getSheetJQ(sheet).find(".advantages-list .advantage-item");
      items.removeClass("drag-over-top drag-over-bottom");

      if (!sheet._advDragState) return;
      let toIndex;
      if ($closest.length) {
        toIndex = parseInt($closest.attr("data-advantage-index"));
        if (Number.isNaN(toIndex)) toIndex = $closest.index();
      } else {
        toIndex = items.length;
      }
      if (Number.isNaN(toIndex)) return;

      const fromIndex = sheet._advDragState.fromIndex;
      if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) return;

      if (toIndex >= items.length) {
        if (items.length) items.last().addClass("drag-over-bottom");
      } else {
        items.eq(toIndex).addClass("drag-over-top");
      }
    } catch (e) {}
  });

  html.on("dragleave", ".advantages-list", () => {
    try { getSheetJQ(sheet).find(".advantages-list .advantage-item").removeClass("drag-over-top drag-over-bottom"); } catch (e) {}
  });

  html.on("drop", ".advantages-list, .advantages-list .advantage-item", async (ev) => {
    try {
      if (!sheet.isEditMode) return;
      ev.preventDefault();
      ev.stopPropagation();
      const data = ev.originalEvent.dataTransfer.getData("text/plain");
      if (!data.startsWith("adv:")) return;
      const fromIndex = parseInt(data.replace("adv:", ""));
      if (Number.isNaN(fromIndex)) return;

      const dropTarget = $(ev.target).closest(".advantage-item");
      let toIndex = null;
      if (dropTarget.length) {
        toIndex = parseInt(dropTarget.attr("data-advantage-index"));
        if (Number.isNaN(toIndex)) toIndex = dropTarget.index();
      } else {
        toIndex = html.find(".advantages-list .advantage-item").length;
      }
      if (Number.isNaN(toIndex)) return;

      await blurActiveEditableInSheet?.();
      await enqueue("_advantageSaveQueue", "Advantage reorder", async () => {
        const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
        sheet._advDragState = null;
        await sheet.actor.reorderPeasantFlexibleAdvantage?.(fromIndex, toIndex, adv.names, adv.descriptions);
      });
      sheet.render(true);
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

    html.on("pointerdown", ".advantage-drag-handle", (ev) => {
      try {
        if (!sheet?.isEditMode) return;
        ev.preventDefault();
        ev.stopPropagation();
        const handle = $(ev.currentTarget);
        const row = handle.closest(".advantage-item");
        let fromIndex = parseInt(row.attr("data-advantage-index"));
        if (Number.isNaN(fromIndex)) fromIndex = row.index();
        if (Number.isNaN(fromIndex)) return;

        row.addClass("dragging");

        const previousUserSelect = sheetBody.style.userSelect;
        sheetBody.style.userSelect = "none";

        advPointerDragState = { fromIndex, draggedEl: row, targetIndex: fromIndex, previousUserSelect };

        const onMove = (moveEv) => {
          try {
            const x = moveEv.clientX;
            const y = moveEv.clientY;
            const el = sheetDocument.elementFromPoint(x, y);
            if (!el) return;
            const $closest = $(el).closest(".advantages-list .advantage-item");
            const items = getSheetJQ(sheet).find(".advantages-list .advantage-item");

            items.removeClass("drag-over-top drag-over-bottom");

            let toIndex = null;
            if ($closest.length) {
              toIndex = parseInt($closest.attr("data-advantage-index"));
              if (Number.isNaN(toIndex)) toIndex = $closest.index();
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

            if (toIndex >= items.length) {
              if (items.length) items.last().addClass("drag-over-bottom");
            } else {
              items.eq(toIndex).addClass("drag-over-top");
            }
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
            dr.removeClass("dragging");
            getSheetJQ(sheet).find(".advantages-list .advantage-item").removeClass("drag-over-top drag-over-bottom");
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
            sheet.render(true);
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

function getSheetJQ(sheet) {
  try {
    const jq = sheet?._getSheetJQ?.();
    if (jq?.length) return jq;
  } catch (e) {
    /* ignore */
  }
  return sheet?.element ?? $();
}
