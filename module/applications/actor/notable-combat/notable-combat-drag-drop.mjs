import { pcLog } from "../../../utils/logging.mjs";

export function setupNotableCombatDragDropControls(sheet, html, { sheetDocument } = {}) {
  const doc = sheetDocument ?? sheet?._getElementDocument?.(html?.[0]) ?? document;

  setupCombatTagDragDrop(sheet, html);
  setupCombatRowDragDrop(sheet, html, doc);
}

export function setupNotableCombatTagEditorDrag(sheet, $container, combatIndex, { onChanged } = {}) {
  const $list = $container.find(".current-tags-list");
  let draggedTag = null;

  $list.find(".editor-tag-draggable").each((_, el) => {
    const $el = $(el);

    $el.on("dragstart", (e) => {
      if ($el.attr("data-remove-pressed") === "true") {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if ($(e.target).closest(".remove-tag-btn").length) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      draggedTag = $el[0];
      $el.addClass("dragging");
      e.originalEvent.dataTransfer.effectAllowed = "move";
      e.originalEvent.dataTransfer.setData("text/plain", $el.data("tag-key") || $el.data("tag-type"));
    });

    $el.on("dragend", () => {
      $el.removeClass("dragging");
      $list.find(".editor-tag-draggable").removeClass("drag-over-left drag-over-right dragging");
      draggedTag = null;
    });

    $el.on("dragover", (e) => {
      e.preventDefault();
      e.originalEvent.dataTransfer.dropEffect = "move";
      if (draggedTag && draggedTag !== $el[0]) {
        const rect = $el[0].getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        if (e.originalEvent.clientX < midX) {
          $el.addClass("drag-over-left").removeClass("drag-over-right");
        } else {
          $el.addClass("drag-over-right").removeClass("drag-over-left");
        }
      }
    });

    $el.on("dragleave", () => {
      $el.removeClass("drag-over-left drag-over-right");
    });

    $el.on("drop", async (e) => {
      e.preventDefault();
      $el.removeClass("drag-over-left drag-over-right");

      if (!draggedTag || draggedTag === $el[0]) return;

      const draggedType = $(draggedTag).data("tag-type");
      const draggedKey = String($(draggedTag).data("tag-key") || draggedType || "");
      const draggedRawCustomIndex = $(draggedTag).data("custom-index");
      const draggedCustomIndex = Number.isInteger(draggedRawCustomIndex) ? draggedRawCustomIndex : parseInt(draggedRawCustomIndex, 10);
      const targetType = $el.data("tag-type");
      const targetKey = String($el.data("tag-key") || targetType || "");
      const targetRawCustomIndex = $el.data("custom-index");
      const targetCustomIndex = Number.isInteger(targetRawCustomIndex) ? targetRawCustomIndex : parseInt(targetRawCustomIndex, 10);
      if (!draggedType || !targetType || !draggedKey || !targetKey || draggedKey === targetKey) return;

      if (draggedType === "custom" && targetType === "custom" && !Number.isNaN(draggedCustomIndex) && !Number.isNaN(targetCustomIndex)) {
        const rect = $el[0].getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const result = await sheet.actor.reorderPeasantNotableCombatCustomTag?.(combatIndex, draggedCustomIndex, targetCustomIndex, {
          insertAfter: e.originalEvent.clientX >= midX
        });
        if (result?.changed) onChanged?.();
        return;
      }

      const rect = $el[0].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const result = await sheet.actor.reorderPeasantNotableCombatTag?.(combatIndex, draggedType, targetType, {
        insertAfter: e.originalEvent.clientX >= midX
      });
      if (result?.changed) onChanged?.();
    });
  });
}

function setupCombatTagDragDrop(sheet, html) {
  html.on("dragstart", ".combat-tag-draggable", (ev) => {
    try {
      const $el = $(ev.currentTarget);
      const tagType = $el.data("tag-type");
      const rawCustomIndex = $el.data("custom-index");
      const customIndex = Number.isInteger(rawCustomIndex) ? rawCustomIndex : parseInt(rawCustomIndex, 10);
      const tagKey = String($el.data("tag-key") || (tagType === "custom" && !Number.isNaN(customIndex) ? `custom:${customIndex}` : String(tagType || "")));
      const container = $el.closest(".combat-tags-inline");
      const combatIdx = parseInt(container.attr("data-combat-index"));

      if (!tagType || !tagKey || Number.isNaN(combatIdx)) return;

      $el.addClass("dragging");
      ev.originalEvent.dataTransfer.effectAllowed = "move";
      ev.originalEvent.dataTransfer.setData("text/plain", `tag:${combatIdx}:${tagKey}`);

      sheet._tagDragState = { combatIndex: combatIdx, tagType, tagKey, customIndex: Number.isNaN(customIndex) ? -1 : customIndex };
    } catch (e) {
      pcLog.debug("tag dragstart failed", e);
    }
  });

  html.on("dragend", ".combat-tag-draggable", (ev) => {
    try {
      $(ev.currentTarget).removeClass("dragging");
      html.find(".combat-tag-draggable").removeClass("drag-over-left drag-over-right");
      sheet._tagDragState = null;
    } catch (e) {}
  });

  html.on("dragover", ".combat-tag-draggable", (ev) => {
    try {
      ev.preventDefault();
      ev.originalEvent.dataTransfer.dropEffect = "move";

      if (!sheet._tagDragState) return;

      const $el = $(ev.currentTarget);
      const container = $el.closest(".combat-tags-inline");
      const combatIdx = parseInt(container.attr("data-combat-index"));

      if (combatIdx !== sheet._tagDragState.combatIndex) return;
      const targetRawCustomIndex = $el.data("custom-index");
      const targetCustomIndex = Number.isInteger(targetRawCustomIndex) ? targetRawCustomIndex : parseInt(targetRawCustomIndex, 10);
      const targetType = $el.data("tag-type");
      const targetKey = String($el.data("tag-key") || (targetType === "custom" && !Number.isNaN(targetCustomIndex) ? `custom:${targetCustomIndex}` : String(targetType || "")));
      if (targetKey === sheet._tagDragState.tagKey) return;

      const rect = ev.currentTarget.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      html.find(".combat-tag-draggable").removeClass("drag-over-left drag-over-right");

      if (ev.originalEvent.clientX < midX) {
        $el.addClass("drag-over-left");
      } else {
        $el.addClass("drag-over-right");
      }
    } catch (e) {}
  });

  html.on("dragleave", ".combat-tag-draggable", (ev) => {
    $(ev.currentTarget).removeClass("drag-over-left drag-over-right");
  });

  html.on("drop", ".combat-tag-draggable", async (ev) => {
    try {
      ev.preventDefault();
      html.find(".combat-tag-draggable").removeClass("drag-over-left drag-over-right");

      if (!sheet._tagDragState) return;

      const $el = $(ev.currentTarget);
      const container = $el.closest(".combat-tags-inline");
      const combatIdx = parseInt(container.attr("data-combat-index"));
      const targetType = $el.data("tag-type");
      const draggedType = sheet._tagDragState.tagType;
      const draggedKey = sheet._tagDragState.tagKey;
      const draggedCustomIndex = sheet._tagDragState.customIndex;
      const targetRawCustomIndex = $el.data("custom-index");
      const targetCustomIndex = Number.isInteger(targetRawCustomIndex) ? targetRawCustomIndex : parseInt(targetRawCustomIndex, 10);
      const targetKey = String($el.data("tag-key") || (targetType === "custom" && !Number.isNaN(targetCustomIndex) ? `custom:${targetCustomIndex}` : String(targetType || "")));

      if (combatIdx !== sheet._tagDragState.combatIndex) return;
      if (targetKey === draggedKey) return;

      if (draggedType === "custom" && targetType === "custom" && !Number.isNaN(draggedCustomIndex) && !Number.isNaN(targetCustomIndex)) {
        const rect = ev.currentTarget.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const result = await sheet.actor.reorderPeasantNotableCombatCustomTag?.(combatIdx, draggedCustomIndex, targetCustomIndex, {
          insertAfter: ev.originalEvent.clientX >= midX,
          render: false
        });
        if (result?.changed) {
          sheet.render(false);
        }
        sheet._tagDragState = null;
        return;
      }

      const rect = ev.currentTarget.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const result = await sheet.actor.reorderPeasantNotableCombatTag?.(combatIdx, draggedType, targetType, {
        insertAfter: ev.originalEvent.clientX >= midX,
        render: false
      });
      if (result?.changed) sheet.render(false);

      sheet._tagDragState = null;
    } catch (e) {
      pcLog.debug("tag drop failed", e);
    }
  });
}

function setupCombatRowDragDrop(sheet, html, sheetDocument) {
  html.on("dragstart", ".notable-combats-list .combat-item", (ev) => {
    try {
      const el = $(ev.currentTarget);
      let index = parseInt(el.attr("data-combat-index"));
      if (Number.isNaN(index)) index = el.index();
      if (Number.isNaN(index)) return;
      const dt = ev.originalEvent.dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", `combat:${index}`);
      }
      el.addClass("dragging");
      sheet._combatDragState = { fromIndex: index };
    } catch (e) {
      pcLog.debug("combat dragstart failed", e);
    }
  });

  html.on("dragend", ".notable-combats-list .combat-item", (ev) => {
    try {
      $(ev.currentTarget).removeClass("dragging");
      sheet._combatDragState = null;
      getSheetJQ(sheet).find(".notable-combats-list .combat-item").removeClass("drag-over-top drag-over-bottom");
    } catch (e) {}
  });

  html.on("dragover", ".notable-combats-list, .notable-combats-list .combat-item", (ev) => {
    try {
      ev.preventDefault();
      const dt = ev.originalEvent.dataTransfer;
      if (dt) dt.dropEffect = "move";

      const x = ev.originalEvent.clientX;
      const y = ev.originalEvent.clientY;
      const el = sheetDocument.elementFromPoint(x, y);
      if (!el) return;
      const $closest = $(el).closest(".notable-combats-list .combat-item");
      const items = getSheetJQ(sheet).find(".notable-combats-list .combat-item");
      items.removeClass("drag-over-top drag-over-bottom");

      if (!sheet._combatDragState) return;
      let toIndex;
      if ($closest.length) {
        toIndex = parseInt($closest.attr("data-combat-index"));
        if (Number.isNaN(toIndex)) toIndex = $closest.index();
      } else {
        toIndex = items.length;
      }
      if (Number.isNaN(toIndex)) return;

      const fromIndex = sheet._combatDragState.fromIndex;
      if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) return;

      if (toIndex >= items.length) {
        if (items.length) items.last().addClass("drag-over-bottom");
      } else {
        items.eq(toIndex).addClass("drag-over-top");
      }
    } catch (e) {}
  });

  html.on("dragleave", ".notable-combats-list", () => {
    try { getSheetJQ(sheet).find(".notable-combats-list .combat-item").removeClass("drag-over-top drag-over-bottom"); } catch (e) {}
  });

  html.on("drop", ".notable-combats-list, .notable-combats-list .combat-item", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      const data = ev.originalEvent.dataTransfer.getData("text/plain");
      if (!data.startsWith("combat:")) return;
      const fromIndex = parseInt(data.replace("combat:", ""));
      if (Number.isNaN(fromIndex)) return;

      const dropTarget = $(ev.target).closest(".combat-item");
      let toIndex = null;
      if (dropTarget.length) {
        toIndex = parseInt(dropTarget.attr("data-combat-index"));
        if (Number.isNaN(toIndex)) toIndex = dropTarget.index();
      } else {
        toIndex = html.find(".notable-combats-list .combat-item").length;
      }
      if (Number.isNaN(toIndex)) return;

      sheet._combatDragState = null;
      await sheet.actor.reorderPeasantNotableCombat?.(fromIndex, toIndex, { render: false });
      sheet.render(true);
    } catch (e) {
      console.warn("Failed to reorder combats via drag/drop:", e);
    }
  });
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
