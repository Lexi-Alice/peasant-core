import { delegate, qsa, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export function setupNotableCombatDragDropControls(sheet, html, { sheetDocument } = {}) {
  const root = toElement(html);
  if (!root) return;

  const doc = sheetDocument ?? sheet?._getElementDocument?.(root) ?? root.ownerDocument ?? document;

  setupCombatTagDragDrop(sheet, root);
  setupCombatRowDragDrop(sheet, root, doc);
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

function setupCombatRowDragDrop(sheet, root, sheetDocument) {
  delegate(root, "dragstart", ".notable-combats-list .combat-item", (event, item) => {
    try {
      const index = resolveElementIndex(item, "data-combat-index");
      if (Number.isNaN(index)) return;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `combat:${index}`);
      }
      item.classList.add("dragging");
      sheet._combatDragState = { fromIndex: index };
    } catch (e) {
      pcLog.debug("combat dragstart failed", e);
    }
  });

  delegate(root, "dragend", ".notable-combats-list .combat-item", (event, item) => {
    try {
      item.classList.remove("dragging");
      sheet._combatDragState = null;
      clearDragMarkers(root, ".notable-combats-list .combat-item", "drag-over-top", "drag-over-bottom");
    } catch (e) {}
  });

  delegate(root, "dragover", ".notable-combats-list, .notable-combats-list .combat-item", (event) => {
    try {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

      const el = sheetDocument.elementFromPoint(event.clientX, event.clientY);
      if (!el) return;
      const closest = el.closest?.(".notable-combats-list .combat-item");
      const items = getCombatItems(root);
      clearDragMarkers(root, ".notable-combats-list .combat-item", "drag-over-top", "drag-over-bottom");

      if (!sheet._combatDragState) return;
      const toIndex = closest ? resolveElementIndex(closest, "data-combat-index") : items.length;
      if (Number.isNaN(toIndex)) return;

      const fromIndex = sheet._combatDragState.fromIndex;
      if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) return;

      markVerticalDropTarget(items, toIndex);
    } catch (e) {}
  });

  delegate(root, "dragleave", ".notable-combats-list", () => {
    try { clearDragMarkers(root, ".notable-combats-list .combat-item", "drag-over-top", "drag-over-bottom"); } catch (e) {}
  });

  delegate(root, "drop", ".notable-combats-list, .notable-combats-list .combat-item", async (event) => {
    try {
      event.preventDefault();
      event.stopPropagation();
      const data = event.dataTransfer?.getData("text/plain") ?? "";
      if (!data.startsWith("combat:")) return;
      const fromIndex = Number.parseInt(data.replace("combat:", ""), 10);
      if (Number.isNaN(fromIndex)) return;

      const dropTarget = event.target?.closest?.(".combat-item");
      const toIndex = dropTarget ? resolveElementIndex(dropTarget, "data-combat-index") : getCombatItems(root).length;
      if (Number.isNaN(toIndex)) return;

      sheet._combatDragState = null;
      await sheet.actor.reorderPeasantNotableCombat?.(fromIndex, toIndex);
    } catch (e) {
      console.warn("Failed to reorder combats via drag/drop:", e);
    }
  });
}

function getCombatItems(root) {
  return qsa(root, ".notable-combats-list .combat-item");
}

function clearDragMarkers(root, selector, ...classes) {
  for (const item of qsa(root, selector)) item.classList.remove(...classes);
}

function markVerticalDropTarget(items, toIndex) {
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
