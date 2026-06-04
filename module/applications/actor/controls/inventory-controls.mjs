import { delegate, qs, qsa } from "../../dom.mjs";

const PC_ITEM_TYPES = Object.freeze(["weapon", "equipment", "tool", "consumable", "loot"]);
const PC_ITEM_TYPE_SET = new Set(PC_ITEM_TYPES);
const INVENTORY_DRAG_PREFIX = "peasant-core.inventory-sort";
const INVENTORY_DRAG_BLOCK_SELECTOR = "input, select, textarea, a, [data-pc-inventory-menu], [data-pc-inventory-equipped-marker], [data-pc-inventory-quantity-step]";
const INVENTORY_SORT_MODES = Object.freeze({
  manual: {
    next: "alpha",
    label: "Sort Manually",
    icon: "fa-solid fa-arrow-down-short-wide"
  },
  alpha: {
    next: "manual",
    label: "Sort Alphabetically",
    icon: "fa-solid fa-arrow-down-a-z"
  }
});

function getItemFromElement(sheet, element) {
  const id = element?.closest?.("[data-pc-inventory-item]")?.dataset?.itemId;
  return id ? sheet.actor?.items?.get?.(id) : null;
}

function sanitizeIntegerInput(input) {
  if (!input) return;
  const normalized = String(input.value ?? "").replace(/[^\d]/g, "");
  if (input.value !== normalized) input.value = normalized;
}

function readNonNegativeInteger(input, fallback = 0) {
  const value = Number.parseInt(input?.value, 10);
  return Math.max(0, Number.isFinite(value) ? value : fallback);
}

function setInputValue(input, value) {
  if (input) input.value = String(Math.max(0, Number.parseInt(value, 10) || 0));
}

function isInventoryGroupedByCategory(sheet) {
  if (sheet._pcInventoryGroupedByCategory === undefined) sheet._pcInventoryGroupedByCategory = true;
  return !!sheet._pcInventoryGroupedByCategory;
}

function getInventorySortMode(sheet) {
  if (!INVENTORY_SORT_MODES[sheet._pcInventorySortMode]) sheet._pcInventorySortMode = "manual";
  return sheet._pcInventorySortMode;
}

function canReorderInventory(sheet) {
  return !!sheet?.canModifyActor && getInventorySortMode(sheet) === "manual";
}

function openItemSheet(item, { edit = false } = {}) {
  const sheet = item?.sheet;
  if (!sheet || typeof sheet.render !== "function") return;
  if (edit) {
    const mode = sheet.constructor?.MODES?.EDIT;
    if (mode !== undefined) return sheet.render({ force: true, mode });
  }
  return sheet.render({ force: true });
}

function sortInventoryRows(root, sheet) {
  const browser = qs(root, "[data-pc-inventory-browser]");
  if (!browser) return;

  const mode = getInventorySortMode(sheet);
  for (const list of qsa(browser, ".pc-inventory-items")) {
    const rows = qsa(list, "[data-pc-inventory-item]");
    rows.sort((left, right) => {
      if (mode === "alpha") {
        const byName = String(left.dataset.sortAlpha ?? "").localeCompare(String(right.dataset.sortAlpha ?? ""));
        if (byName !== 0) return byName;
      }
      const byManual = (Number(left.dataset.sortManual) || 0) - (Number(right.dataset.sortManual) || 0);
      if (byManual !== 0) return byManual;
      return String(left.dataset.sortAlpha ?? "").localeCompare(String(right.dataset.sortAlpha ?? ""));
    });
    list.append(...rows);
  }
}

function syncInventorySortToggle(root, sheet) {
  const toggle = qs(root, "[data-pc-inventory-sort-toggle]");
  if (!toggle) return;

  const mode = getInventorySortMode(sheet);
  const config = INVENTORY_SORT_MODES[mode];
  toggle.classList.add("active");
  toggle.dataset.sortMode = mode;
  toggle.setAttribute("aria-pressed", "true");
  toggle.dataset.tooltip = config.label;
  toggle.setAttribute("aria-label", config.label);
  qs(toggle, "i")?.setAttribute("class", config.icon);
}

function syncInventoryDragState(root, sheet) {
  const browser = qs(root, "[data-pc-inventory-browser]");
  if (!browser) return;

  const enabled = canReorderInventory(sheet);
  browser.dataset.pcInventorySortMode = getInventorySortMode(sheet);
  browser.classList.toggle("pc-inventory-manual-sort", enabled);
  for (const row of qsa(browser, "[data-pc-inventory-item]")) {
    row.draggable = enabled;
    row.classList.toggle("pc-inventory-sortable", enabled);
    if (!enabled) row.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
  }
}

function applyInventorySearch(root) {
  const browser = qs(root, "[data-pc-inventory-browser]");
  if (!browser) return;

  const input = qs(browser, "[data-pc-inventory-search]");
  const clear = qs(browser, "[data-pc-inventory-clear-search]");
  const query = String(input?.value ?? "").trim().toLowerCase();
  const activeView = qs(browser, "[data-pc-inventory-view]:not([hidden])") ?? browser;
  let matchingRows = 0;
  let totalRows = 0;

  for (const section of qsa(activeView, "[data-pc-inventory-section]")) {
    const rows = qsa(section, "[data-pc-inventory-item]");
    let sectionMatches = 0;
    for (const row of rows) {
      totalRows += 1;
      const matches = !query || String(row.dataset.search ?? "").includes(query);
      row.hidden = !matches;
      if (matches) {
        sectionMatches += 1;
        matchingRows += 1;
      }
    }
    section.hidden = !!query && sectionMatches === 0;
  }

  if (clear) clear.hidden = !query;
  const empty = qs(browser, ".pc-inventory-search-empty");
  if (empty) empty.hidden = !query || totalRows === 0 || matchingRows > 0;
}

function applyInventoryGroupMode(root, sheet) {
  const browser = qs(root, "[data-pc-inventory-browser]");
  if (!browser) return;

  const grouped = isInventoryGroupedByCategory(sheet);
  const activeView = grouped ? "grouped" : "flat";
  browser.dataset.pcInventoryGrouped = grouped ? "true" : "false";

  for (const view of qsa(browser, "[data-pc-inventory-view]")) {
    view.hidden = view.dataset.pcInventoryView !== activeView;
  }

  const toggle = qs(browser, "[data-pc-inventory-group-toggle]");
  if (toggle) {
    toggle.classList.toggle("active", grouped);
    toggle.setAttribute("aria-pressed", grouped ? "true" : "false");
    const label = "Group by Category";
    toggle.dataset.tooltip = label;
    toggle.setAttribute("aria-label", label);
  }

  sortInventoryRows(root, sheet);
  syncInventorySortToggle(root, sheet);
  syncInventoryDragState(root, sheet);
  applyInventorySearch(root);
}

async function confirmDelete(item) {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  const escapedName = foundry.utils.escapeHTML?.(item.name ?? "this item")
    ?? String(item.name ?? "this item").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  if (typeof DialogV2?.prompt === "function") {
    return !!await DialogV2.prompt({
      window: { title: "Delete Item" },
      position: { width: 320 },
      content: `<p>Delete <strong>${escapedName}</strong> from this actor?</p>`,
      ok: { label: "Delete", icon: "fa-solid fa-trash", callback: () => true },
      rejectClose: false
    });
  }
  return window.confirm(`Delete ${item.name ?? "this item"} from this actor?`);
}

async function updateItemField(sheet, input, item, field, value, { runQueuedInputUpdate = null } = {}) {
  if (!item || !field) return;
  const update = async () => item.update({ [field]: value });
  if (typeof runQueuedInputUpdate === "function" && input) {
    await runQueuedInputUpdate(input, "_inventorySaveQueue", "Inventory", update);
  } else {
    await update();
  }
}

function normalizeDropData(event) {
  const text = event?.dataTransfer?.getData?.("application/json") || event?.dataTransfer?.getData?.("text/plain");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function isItemDocument(document, ItemClass) {
  return document?.documentName === "Item" || (!!ItemClass && document instanceof ItemClass);
}

async function resolveDroppedItem(data) {
  if (!data) return null;
  const ItemClass = globalThis.Item;
  if (typeof ItemClass?.fromDropData === "function") {
    try {
      const item = await ItemClass.fromDropData(data);
      if (isItemDocument(item, ItemClass)) return item;
    } catch (err) {
      /* Fall back to UUID resolution. */
    }
  }

  const uuid = data.uuid || data.documentUuid;
  if (!uuid || typeof fromUuid !== "function") return null;
  const document = await fromUuid(uuid);
  return isItemDocument(document, ItemClass) ? document : null;
}

function toEmbeddedItemData(item) {
  const data = item?.toObject?.() ?? item?._source ?? null;
  if (!data || !PC_ITEM_TYPE_SET.has(String(data.type ?? ""))) return null;
  const clone = foundry.utils.deepClone(data);
  delete clone._id;
  delete clone.folder;
  return clone;
}

async function handleInventoryDrop(sheet, event) {
  if (!sheet.canModifyActor || !sheet.isEditMode) return;
  event.preventDefault();
  event.stopPropagation();

  const item = await resolveDroppedItem(normalizeDropData(event));
  const itemData = toEmbeddedItemData(item);
  if (!itemData) return;

  await sheet.actor.createEmbeddedDocuments("Item", [itemData]);
}

function getInventorySortDragData(event) {
  const raw = event?.dataTransfer?.getData?.("text/plain") ?? "";
  if (!raw.startsWith(`${INVENTORY_DRAG_PREFIX}:`)) return null;
  const [, actorUuid, itemId] = raw.match(/^peasant-core\.inventory-sort:(.+):([^:]+)$/) ?? [];
  return actorUuid && itemId ? { actorUuid, itemId } : null;
}

function clearInventoryDragMarkers(root) {
  for (const row of qsa(root, "[data-pc-inventory-item]")) {
    row.classList.remove("drag-over-top", "drag-over-bottom");
  }
}

function isInventoryDropAfter(row, clientY) {
  const rect = row.getBoundingClientRect();
  return clientY >= rect.top + (rect.height / 2);
}

function getInventoryRowsInList(list) {
  return qsa(list, "[data-pc-inventory-item]:not([hidden])");
}

function getInventoryDropTargetRow(target, list) {
  return target?.closest?.("[data-pc-inventory-item]") ?? getInventoryRowsInList(list).at(-1) ?? null;
}

async function reorderInventoryItem(sheet, sourceItem, targetRow, { sortBefore = false } = {}) {
  const targetItem = getItemFromElement(sheet, targetRow);
  if (!sourceItem || !targetItem || sourceItem.id === targetItem.id) return;

  const list = targetRow?.closest?.(".pc-inventory-items");
  if (!list) return;

  const siblings = [];
  for (const row of getInventoryRowsInList(list)) {
    const sibling = getItemFromElement(sheet, row);
    if (sibling && sibling.id !== sourceItem.id) siblings.push(sibling);
  }

  const sortUpdates = foundry.utils.performIntegerSort?.(sourceItem, {
    target: targetItem,
    siblings,
    sortBefore
  });
  if (!sortUpdates?.length) return;

  const updateData = sortUpdates.map(({ target, update }) => ({
    ...update,
    _id: target.id ?? target._id
  }));
  await sheet.actor.updateEmbeddedDocuments("Item", updateData);
}

async function openCreateInventoryItemDialog(sheet) {
  if (!sheet?.canModifyActor || !sheet.isEditMode) return;
  const ItemClass = globalThis.Item?.implementation ?? globalThis.Item;
  if (typeof ItemClass?.createDialog !== "function") {
    ui.notifications?.warn?.("Unable to open the item creation dialog.");
    return;
  }

  await ItemClass.createDialog(
    {},
    { parent: sheet.actor },
    { types: [...PC_ITEM_TYPES] }
  );
}

function getContextMenuClass() {
  return foundry?.applications?.ux?.ContextMenu?.implementation
    ?? globalThis.ContextMenu?.implementation
    ?? globalThis.ContextMenu
    ?? null;
}

function getInventoryContextMenuEntries(sheet) {
  return [
    {
      label: "Edit",
      icon: "fa-solid fa-pen-to-square",
      onClick: (_event, target) => {
        const item = getItemFromElement(sheet, target);
        openItemSheet(item, { edit: true });
      }
    },
    {
      label: "Delete",
      icon: "fa-solid fa-trash",
      onClick: async (_event, target) => {
        const item = getItemFromElement(sheet, target);
        if (!item || !await confirmDelete(item)) return;
        await item.delete();
      }
    }
  ];
}

function setupInventoryContextMenu(sheet, browser) {
  const ContextMenuClass = getContextMenuClass();
  if (!ContextMenuClass) return;

  new ContextMenuClass(browser, "[data-pc-inventory-menu]", [], {
    eventName: "click",
    fixed: true,
    jQuery: false,
    relative: "target",
    onOpen: () => {
      ui.context.menuItems = getInventoryContextMenuEntries(sheet);
    }
  });
}

function setupInventoryManualSortControls(sheet, root, browser) {
  delegate(browser, "dragstart", "[data-pc-inventory-item]", (event, row) => {
    if (!canReorderInventory(sheet) || event.target?.closest?.(INVENTORY_DRAG_BLOCK_SELECTOR)) {
      event.preventDefault();
      return;
    }

    const item = getItemFromElement(sheet, row);
    const list = row.closest(".pc-inventory-items");
    if (!item || !list) {
      event.preventDefault();
      return;
    }

    row.classList.add("dragging");
    sheet._pcInventoryDragState = {
      actorUuid: sheet.actor?.uuid,
      itemId: item.id,
      list
    };

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `${INVENTORY_DRAG_PREFIX}:${sheet.actor.uuid}:${item.id}`);
      const dragImage = qs(row, ".pc-inventory-item-row") ?? row;
      const box = dragImage.getBoundingClientRect();
      event.dataTransfer.setDragImage(dragImage, Math.min(box.width - 6, 48), box.height / 2);
    }
  });

  delegate(browser, "dragend", "[data-pc-inventory-item]", (_event, row) => {
    row.classList.remove("dragging");
    clearInventoryDragMarkers(root);
    sheet._pcInventoryDragState = null;
  });

  delegate(browser, "dragover", ".pc-inventory-items, [data-pc-inventory-item]", (event, target) => {
    if (!canReorderInventory(sheet) || !sheet._pcInventoryDragState) return;

    const list = target.closest?.(".pc-inventory-items");
    if (!list || list !== sheet._pcInventoryDragState.list) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    clearInventoryDragMarkers(root);

    const targetRow = getInventoryDropTargetRow(event.target, list);
    if (!targetRow || targetRow.dataset.itemId === sheet._pcInventoryDragState.itemId) return;
    targetRow.classList.toggle("drag-over-bottom", isInventoryDropAfter(targetRow, event.clientY));
    targetRow.classList.toggle("drag-over-top", !isInventoryDropAfter(targetRow, event.clientY));
  });

  delegate(browser, "dragleave", ".pc-inventory-items", () => {
    clearInventoryDragMarkers(root);
  });

  delegate(browser, "drop", ".pc-inventory-items, [data-pc-inventory-item]", async (event, target) => {
    const dragData = getInventorySortDragData(event);
    if (!canReorderInventory(sheet) || !sheet._pcInventoryDragState || dragData?.actorUuid !== sheet.actor?.uuid) return;

    const list = target.closest?.(".pc-inventory-items");
    if (!list || list !== sheet._pcInventoryDragState.list) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    clearInventoryDragMarkers(root);

    const sourceItem = sheet.actor?.items?.get?.(dragData.itemId);
    const targetRow = getInventoryDropTargetRow(event.target, list);
    if (!sourceItem || !targetRow || targetRow.dataset.itemId === sourceItem.id) {
      sheet._pcInventoryDragState = null;
      return;
    }

    try {
      await reorderInventoryItem(sheet, sourceItem, targetRow, {
        sortBefore: !isInventoryDropAfter(targetRow, event.clientY)
      });
    } finally {
      sheet._pcInventoryDragState = null;
    }
  });
}

export function setupInventoryControls(sheet, html, { runQueuedInputUpdate = null, readOnly = false } = {}) {
  const root = html?.[0] ?? html;
  const browser = qs(root, "[data-pc-inventory-browser]");
  if (!browser) return;

  const search = qs(browser, "[data-pc-inventory-search]");
  search?.addEventListener("input", () => applyInventorySearch(root));
  qs(browser, "[data-pc-inventory-clear-search]")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (search) search.value = "";
    applyInventorySearch(root);
  });

  qs(browser, "[data-pc-inventory-group-toggle]")?.addEventListener("click", (event) => {
    event.preventDefault();
    sheet._pcInventoryGroupedByCategory = !isInventoryGroupedByCategory(sheet);
    applyInventoryGroupMode(root, sheet);
  });

  qs(browser, "[data-pc-inventory-sort-toggle]")?.addEventListener("click", (event) => {
    event.preventDefault();
    const mode = getInventorySortMode(sheet);
    sheet._pcInventorySortMode = INVENTORY_SORT_MODES[mode].next;
    sortInventoryRows(root, sheet);
    syncInventorySortToggle(root, sheet);
    syncInventoryDragState(root, sheet);
    applyInventorySearch(root);
  });
  applyInventoryGroupMode(root, sheet);

  delegate(browser, "click", "[data-pc-inventory-add-item]", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await openCreateInventoryItemDialog(sheet);
  });

  delegate(browser, "click", "[data-pc-inventory-open-item]", (event, control) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    event.preventDefault();
    const item = getItemFromElement(sheet, control);
    openItemSheet(item);
  });

  if (readOnly) return;

  setupInventoryContextMenu(sheet, browser);
  setupInventoryManualSortControls(sheet, root, browser);

  delegate(browser, "input", "[data-pc-inventory-quantity], [data-pc-inventory-resource-current]", (event, input) => {
    sanitizeIntegerInput(input);
  });

  delegate(browser, "change", "[data-pc-inventory-quantity]", async (event, input) => {
    const item = getItemFromElement(sheet, input);
    const value = readNonNegativeInteger(input, item?.system?.quantity ?? 0);
    setInputValue(input, value);
    await updateItemField(sheet, input, item, "system.quantity", value, { runQueuedInputUpdate });
  });

  delegate(browser, "change", "[data-pc-inventory-resource-current]", async (event, input) => {
    const item = getItemFromElement(sheet, input);
    const kind = input.dataset.resourceKind;
    const field = kind === "uses" ? "system.uses.value" : kind === "sunder" ? "system.sunder.current" : "";
    const fallback = kind === "uses" ? item?.system?.uses?.value : item?.system?.sunder?.current;
    const value = readNonNegativeInteger(input, fallback ?? 0);
    setInputValue(input, value);
    await updateItemField(sheet, input, item, field, value, { runQueuedInputUpdate });
  });

  delegate(browser, "click", "[data-pc-inventory-quantity-step]", async (event, button) => {
    event.preventDefault();
    const item = getItemFromElement(sheet, button);
    if (!item) return;
    const input = qs(button.closest("[data-pc-inventory-item]"), "[data-pc-inventory-quantity]");
    const current = readNonNegativeInteger(input, item.system?.quantity ?? 0);
    const step = Number.parseInt(button.dataset.pcInventoryQuantityStep, 10) || 0;
    const value = Math.max(0, current + step);
    setInputValue(input, value);
    await updateItemField(sheet, input, item, "system.quantity", value, { runQueuedInputUpdate });
  });

  delegate(browser, "click", "[data-pc-inventory-equipped-marker]", async (event, button) => {
    event.preventDefault();
    event.stopPropagation();
    if (!sheet?.canModifyActor) return;
    const item = getItemFromElement(sheet, button);
    if (!item) return;
    try {
      await item.update({ "system.equipped": !item.system?.equipped });
    } catch (err) {
      console.warn("Failed to update inventory equipped state:", err);
      ui.notifications?.error?.("Failed to update equipped state. See console for details.");
    }
  });

  if (sheet.isEditMode) {
    browser.addEventListener("dragover", (event) => {
      event.preventDefault();
      browser.classList.add("drag-over");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    browser.addEventListener("dragleave", (event) => {
      if (!browser.contains(event.relatedTarget)) browser.classList.remove("drag-over");
    });
    browser.addEventListener("drop", async (event) => {
      browser.classList.remove("drag-over");
      await handleInventoryDrop(sheet, event);
    });
  }
}
