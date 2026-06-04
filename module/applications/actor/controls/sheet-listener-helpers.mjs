import { sanitizeOptionalIntegerInputValue } from "../../../data/actor/helpers.mjs";
import { qsa, qs, toElement } from "../../dom.mjs";

export function resolveRowIndex(row, attr) {
  const element = toElement(row);
  let index = Number.parseInt(element?.getAttribute(attr), 10);
  if (Number.isNaN(index) && element?.parentElement) index = Array.from(element.parentElement.children).indexOf(element);
  return index;
}

export function resolveItemIndex(source, { dataKey = "index", rowSelector = null, rowAttr = null } = {}) {
  const element = toElement(source);
  let index = Number.parseInt(element?.dataset?.[dataKey], 10);
  if (!Number.isNaN(index)) return index;

  if (rowSelector) {
    const row = element?.closest?.(rowSelector);
    if (row) {
      if (rowAttr) {
        index = Number.parseInt(row.getAttribute(rowAttr), 10);
        if (!Number.isNaN(index)) return index;
      }
      index = row.parentElement ? Array.from(row.parentElement.children).indexOf(row) : -1;
      if (!Number.isNaN(index)) return index;
    }
  }

  return -1;
}

export function sanitizeOptionalIntegerInputElement(input, options = {}) {
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

export function initializeSheetSaveQueues(sheet) {
  if (sheet._skillsSaveQueue === undefined) sheet._skillsSaveQueue = Promise.resolve();
  if (sheet._combatSaveQueue === undefined) sheet._combatSaveQueue = Promise.resolve();
  if (sheet._advantageSaveQueue === undefined) sheet._advantageSaveQueue = Promise.resolve();
  if (sheet._edgeResourceSaveQueue === undefined) sheet._edgeResourceSaveQueue = Promise.resolve();
  if (sheet._portraitLozengeSaveQueue === undefined) sheet._portraitLozengeSaveQueue = Promise.resolve();
  if (sheet._inventorySaveQueue === undefined) sheet._inventorySaveQueue = Promise.resolve();
}

export function createSheetUpdateQueue(sheet) {
  return (queueKey, label, task) => {
    if (sheet[queueKey] === undefined) sheet[queueKey] = Promise.resolve();

    const queued = sheet[queueKey]
      .catch(() => {})
      .then(async () => {
        try {
          return await task();
        } catch (err) {
          console.warn(`${label} queued update failed:`, err);
          throw err;
        }
      });

    sheet[queueKey] = queued.catch(() => {});
    return queued;
  };
}

export function collectAdvantagesFromSheet(sheet) {
  const root = sheet._getSheetJQ?.()?.[0] ?? sheet.element ?? null;
  const items = qsa(root, ".advantages-list .advantage-item");
  const actorNames = (JSON.parse(JSON.stringify(sheet.actor.system.flexibleAdvantages || [])) || []).map(entry => {
    if (typeof entry === "string") return entry;
    return String(entry?.name ?? "");
  });
  const actorDescriptions = JSON.parse(JSON.stringify(sheet.actor.system.flexibleAdvantageDescriptions || []));
  if (items.length === 0) {
    return {
      names: actorNames,
      descriptions: actorDescriptions
    };
  }

  const names = [];
  const descriptions = [];
  for (const el of items) {
    const nameValue = qs(el, ".advantage-input")?.value;
    const descValue = qs(el, ".advantage-description-hidden")?.value;
    names.push(nameValue == null ? "" : String(nameValue));
    descriptions.push(descValue == null ? "" : String(descValue));
  }
  return { names, descriptions };
}

export async function blurActiveEditableInSheet(sheet) {
  const sheetRoot = sheet._getSheetJQ()?.[0] || sheet.element || null;
  const active = sheet._getElementDocument(sheetRoot)?.activeElement;
  if (!sheetRoot || !active || !sheetRoot.contains(active)) return;

  const tag = String(active.tagName || "").toUpperCase();
  const editable = active.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (!editable || typeof active.blur !== "function") return;

  try { active.blur(); } catch (e) { /* ignore */ }
  await new Promise(resolve => setTimeout(resolve, 0));
}

export async function runQueuedInputUpdate(sheet, input, queueKey, label, task, { enqueueSheetUpdate = null } = {}) {
  const inputEl = toElement(input);
  const ownerDocument = sheet._getElementDocument(inputEl);
  const hadFocus = !!(inputEl && ownerDocument?.activeElement === inputEl);
  const canTrackSelection = !!(inputEl && typeof inputEl.selectionStart === "number");
  const valueBeforeUpdate = inputEl ? String(inputEl.value ?? "") : null;
  const selStart = canTrackSelection ? inputEl.selectionStart : null;
  const selEnd = canTrackSelection ? inputEl.selectionEnd : null;
  const selDir = canTrackSelection ? inputEl.selectionDirection : null;

  if (!hadFocus) {
    try { if (inputEl) inputEl.disabled = true; } catch (e) { /* ignore */ }
  }

  try {
    const enqueue = enqueueSheetUpdate ?? createSheetUpdateQueue(sheet);
    await enqueue(queueKey, label, task);
  } finally {
    if (!hadFocus) {
      try { if (inputEl) inputEl.disabled = false; } catch (e) { /* ignore */ }
      return;
    }

    try {
      const valueUnchanged = inputEl && String(inputEl.value ?? "") === valueBeforeUpdate;
      if (!valueUnchanged) return;
      if (inputEl && inputEl.isConnected && ownerDocument?.activeElement !== inputEl) {
        inputEl.focus({ preventScroll: true });
      }
      if (inputEl && inputEl.isConnected && ownerDocument?.activeElement === inputEl && canTrackSelection && selStart !== null && selEnd !== null && typeof inputEl.setSelectionRange === "function") {
        inputEl.setSelectionRange(selStart, selEnd, selDir || "none");
      }
    } catch (e) { /* ignore */ }
  }
}
