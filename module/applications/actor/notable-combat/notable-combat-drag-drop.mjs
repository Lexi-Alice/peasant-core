import { delegate, qsa, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

const COMBAT_ROW_DRAG_BLOCK_SELECTOR = "button, input, select, textarea, a, .combat-tag-draggable, .combat-roll-clickable, .combat-actions";
const COMBAT_HOTBAR_DRAG_TYPE = "peasant-core.notableCombat";
const COMBAT_ROW_DRAG_PREFIX = "peasant-core.notable-combat-sort";

export function setupNotableCombatDragDropControls(sheet, html) {
  const root = toElement(html);
  if (!root) return;

  setupCombatTagDragDrop(sheet, root);
  setupCombatHotbarDrag(sheet, root);
  setupCombatRowDragDrop(sheet, root);
}

export function setupNotableCombatTagEditorDrag(sheet, container, combatIndex, { onChanged } = {}) {
  const root = toElement(container);
  const list = root?.querySelector(".current-tags-list");
  if (!list) return;

  let draggedTag = null;

  for (const tag of qsa(list, ".editor-tag-draggable")) {
    tag.addEventListener("dragstart", (event) => {
      if (tag.dataset.removePressed === "true") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target?.closest?.(".remove-tag-btn")) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      draggedTag = tag;
      tag.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", tag.dataset.tagKey || tag.dataset.tagType || "");
      }
    });

    tag.addEventListener("dragend", () => {
      tag.classList.remove("dragging");
      clearDragMarkers(list, ".editor-tag-draggable", "drag-over-left", "drag-over-right", "dragging");
      draggedTag = null;
    });

    tag.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      if (!draggedTag || draggedTag === tag) return;

      const rect = tag.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      clearDragMarkers(list, ".editor-tag-draggable", "drag-over-left", "drag-over-right");
      tag.classList.toggle("drag-over-left", event.clientX < midX);
      tag.classList.toggle("drag-over-right", event.clientX >= midX);
    });

    tag.addEventListener("dragleave", () => {
      tag.classList.remove("drag-over-left", "drag-over-right");
    });

    tag.addEventListener("drop", async (event) => {
      event.preventDefault();
      tag.classList.remove("drag-over-left", "drag-over-right");

      if (!draggedTag || draggedTag === tag) return;

      const dragged = getTagDescriptor(draggedTag);
      const target = getTagDescriptor(tag);
      if (!dragged.type || !target.type || !dragged.key || !target.key || dragged.key === target.key) return;

      const insertAfter = isDropAfter(tag, event.clientX);
      if (dragged.type === "custom" && target.type === "custom" && !Number.isNaN(dragged.customIndex) && !Number.isNaN(target.customIndex)) {
        const result = await sheet.actor.reorderPeasantNotableCombatCustomTag?.(combatIndex, dragged.customIndex, target.customIndex, { insertAfter });
        if (result?.changed) onChanged?.();
        return;
      }

      const result = await sheet.actor.reorderPeasantNotableCombatTag?.(combatIndex, dragged.type, target.type, { insertAfter });
      if (result?.changed) onChanged?.();
    });
  }
}

function setupCombatTagDragDrop(sheet, root) {
  delegate(root, "dragstart", ".combat-tag-draggable", (event, tag) => {
    try {
      const tagData = getTagDescriptor(tag);
      const container = tag.closest(".combat-tags-inline");
      const combatIndex = Number.parseInt(container?.dataset.combatIndex, 10);

      if (!tagData.type || !tagData.key || Number.isNaN(combatIndex)) return;

      tag.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `tag:${combatIndex}:${tagData.key}`);
      }

      sheet._tagDragState = {
        combatIndex,
        tagType: tagData.type,
        tagKey: tagData.key,
        customIndex: Number.isNaN(tagData.customIndex) ? -1 : tagData.customIndex
      };
    } catch (e) {
      pcLog.debug("tag dragstart failed", e);
    }
  });

  delegate(root, "dragend", ".combat-tag-draggable", (event, tag) => {
    try {
      tag.classList.remove("dragging");
      clearDragMarkers(root, ".combat-tag-draggable", "drag-over-left", "drag-over-right");
      sheet._tagDragState = null;
    } catch (e) {}
  });

  delegate(root, "dragover", ".combat-tag-draggable", (event, tag) => {
    try {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      if (!sheet._tagDragState) return;

      const container = tag.closest(".combat-tags-inline");
      const combatIndex = Number.parseInt(container?.dataset.combatIndex, 10);
      if (combatIndex !== sheet._tagDragState.combatIndex) return;

      const target = getTagDescriptor(tag);
      if (target.key === sheet._tagDragState.tagKey) return;

      clearDragMarkers(root, ".combat-tag-draggable", "drag-over-left", "drag-over-right");
      tag.classList.toggle("drag-over-left", !isDropAfter(tag, event.clientX));
      tag.classList.toggle("drag-over-right", isDropAfter(tag, event.clientX));
    } catch (e) {}
  });

  delegate(root, "dragleave", ".combat-tag-draggable", (event, tag) => {
    tag.classList.remove("drag-over-left", "drag-over-right");
  });

  delegate(root, "drop", ".combat-tag-draggable", async (event, tag) => {
    try {
      event.preventDefault();
      clearDragMarkers(root, ".combat-tag-draggable", "drag-over-left", "drag-over-right");

      if (!sheet._tagDragState) return;

      const container = tag.closest(".combat-tags-inline");
      const combatIndex = Number.parseInt(container?.dataset.combatIndex, 10);
      const target = getTagDescriptor(tag);
      const { tagType: draggedType, tagKey: draggedKey, customIndex: draggedCustomIndex } = sheet._tagDragState;

      if (combatIndex !== sheet._tagDragState.combatIndex) return;
      if (target.key === draggedKey) return;

      const insertAfter = isDropAfter(tag, event.clientX);
      if (draggedType === "custom" && target.type === "custom" && !Number.isNaN(draggedCustomIndex) && !Number.isNaN(target.customIndex)) {
        await sheet.actor.reorderPeasantNotableCombatCustomTag?.(combatIndex, draggedCustomIndex, target.customIndex, {
          insertAfter
        });
        sheet._tagDragState = null;
        return;
      }

      await sheet.actor.reorderPeasantNotableCombatTag?.(combatIndex, draggedType, target.type, {
        insertAfter
      });

      sheet._tagDragState = null;
    } catch (e) {
      pcLog.debug("tag drop failed", e);
    }
  });
}

function setupCombatRowDragDrop(sheet, root) {
  delegate(root, "dragstart", ".notable-combats-list .combat-item", (event, item) => {
    try {
      if (event.target?.closest?.(COMBAT_ROW_DRAG_BLOCK_SELECTOR)) return;

      const index = resolveElementIndex(item, "data-combat-index");
      if (Number.isNaN(index)) return;
      const list = item.closest(".notable-combats-list");
      if (!list) return;

      item.classList.add("dragging");
      sheet._combatDragState = {
        actorUuid: sheet.actor?.uuid,
        fromIndex: index,
        list
      };

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `${COMBAT_ROW_DRAG_PREFIX}:${sheet.actor?.uuid ?? ""}:${index}`);
        const dragImage = item.querySelector(".combat-view-line") ?? item;
        const box = dragImage.getBoundingClientRect();
        event.dataTransfer.setDragImage(dragImage, Math.min(box.width - 6, 48), box.height / 2);
      }
    } catch (e) {
      pcLog.debug("combat dragstart failed", e);
    }
  });

  delegate(root, "dragend", ".notable-combats-list .combat-item", (event, item) => {
    try {
      item.classList.remove("dragging");
      sheet._combatDragState = null;
      clearCombatRowDragMarkers(root);
    } catch (e) {}
  });

  delegate(root, "dragover", ".notable-combats-list, .notable-combats-list .combat-item", (event, target) => {
    try {
      if (!sheet._combatDragState) return;

      const list = target.closest?.(".notable-combats-list");
      if (!list || list !== sheet._combatDragState.list) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearCombatRowDragMarkers(root);

      const targetRow = getCombatDropTargetRow(event.target, list);
      if (!targetRow) return;
      const targetIndex = resolveElementIndex(targetRow, "data-combat-index");
      if (Number.isNaN(targetIndex)) return;
      const dropAfter = isCombatDropAfter(targetRow, event.clientY);
      const toIndex = targetIndex + (dropAfter ? 1 : 0);
      if (Number.isNaN(toIndex)) return;

      const fromIndex = sheet._combatDragState.fromIndex;
      if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) return;

      targetRow.classList.toggle("drag-over-bottom", dropAfter);
      targetRow.classList.toggle("drag-over-top", !dropAfter);
    } catch (e) {}
  });

  delegate(root, "dragleave", ".notable-combats-list", () => {
    try { clearCombatRowDragMarkers(root); } catch (e) {}
  });

  delegate(root, "drop", ".notable-combats-list, .notable-combats-list .combat-item", async (event, target) => {
    try {
      const dragData = getCombatSortDragData(event);
      if (!sheet._combatDragState || dragData?.actorUuid !== sheet.actor?.uuid) return;

      const list = target.closest?.(".notable-combats-list");
      if (!list || list !== sheet._combatDragState.list) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      clearCombatRowDragMarkers(root);

      try {
        const fromIndex = dragData.fromIndex;
        if (Number.isNaN(fromIndex)) return;

        const dropTarget = getCombatDropTargetRow(event.target, list);
        if (!dropTarget) return;

        const targetIndex = resolveElementIndex(dropTarget, "data-combat-index");
        const toIndex = targetIndex + (isCombatDropAfter(dropTarget, event.clientY) ? 1 : 0);
        if (Number.isNaN(toIndex)) return;
        if (toIndex === fromIndex || toIndex === fromIndex + 1) return;

        await sheet.actor.reorderPeasantNotableCombat?.(fromIndex, toIndex);
      } finally {
        sheet._combatDragState = null;
      }
    } catch (e) {
      console.warn("Failed to reorder combats via drag/drop:", e);
    }
  });
}

function setupCombatHotbarDrag(sheet, root) {
  delegate(root, "dragstart", ".pc-notable-combat-hotbar-drag", (event, item) => {
    try {
      if (event.target?.closest?.(COMBAT_ROW_DRAG_BLOCK_SELECTOR)) return;

      const combatIndex = resolveElementIndex(item, "data-combat-index");
      if (Number.isNaN(combatIndex)) return;

      const combat = sheet.actor?.system?.notableCombats?.[combatIndex] || null;
      const combatId = String(item.dataset.combatId || combat?.id || "").trim();
      const actorUuid = sheet.actor?.uuid || "";
      if (!actorUuid) return;

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", JSON.stringify({
          type: COMBAT_HOTBAR_DRAG_TYPE,
          actorUuid,
          combatId,
          combatIndex
        }));
      }
      item.classList.add("dragging");
    } catch (e) {
      pcLog.debug("combat hotbar dragstart failed", e);
    }
  });

  delegate(root, "dragend", ".pc-notable-combat-hotbar-drag", (event, item) => {
    try {
      item.classList.remove("dragging");
    } catch (e) {}
  });
}

function clearCombatRowDragMarkers(root) {
  clearDragMarkers(root, ".notable-combats-list .combat-item", "drag-over-top", "drag-over-bottom");
}

function getCombatRowsInList(list) {
  return qsa(list, ".combat-item:not([hidden])");
}

function getCombatDropTargetRow(target, list) {
  return target?.closest?.(".combat-item") ?? getCombatRowsInList(list).at(-1) ?? null;
}

function getCombatSortDragData(event) {
  const raw = event?.dataTransfer?.getData?.("text/plain") ?? "";
  const [, actorUuid, fromIndex] = raw.match(/^peasant-core\.notable-combat-sort:(.+):(\d+)$/) ?? [];
  return actorUuid ? { actorUuid, fromIndex: Number.parseInt(fromIndex, 10) } : null;
}

function isCombatDropAfter(row, clientY) {
  const rect = row.getBoundingClientRect();
  return clientY >= rect.top + (rect.height / 2);
}

function clearDragMarkers(root, selector, ...classes) {
  for (const item of qsa(root, selector)) item.classList.remove(...classes);
}

function resolveElementIndex(element, attr) {
  const el = toElement(element);
  let index = Number.parseInt(el?.getAttribute(attr), 10);
  if (Number.isNaN(index) && el?.parentElement) index = Array.from(el.parentElement.children).indexOf(el);
  return index;
}

function getTagDescriptor(tag) {
  const type = tag?.dataset?.tagType;
  const rawCustomIndex = tag?.dataset?.customIndex;
  const customIndex = Number.isInteger(rawCustomIndex) ? rawCustomIndex : Number.parseInt(rawCustomIndex, 10);
  const key = String(tag?.dataset?.tagKey || (type === "custom" && !Number.isNaN(customIndex) ? `custom:${customIndex}` : String(type || "")));
  return { type, key, customIndex };
}

function isDropAfter(element, clientX) {
  const rect = element.getBoundingClientRect();
  const midX = rect.left + rect.width / 2;
  return clientX >= midX;
}
