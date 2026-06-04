export function cloneActorList(source, { normalizeEntry = null } = {}) {
  const list = JSON.parse(JSON.stringify(Array.isArray(source) ? source : []));
  return typeof normalizeEntry === "function" ? list.map(entry => normalizeEntry(entry)) : list;
}

export function cloneActorListForUpdate(actor, property, options = {}) {
  return cloneActorList(actor?.system?.[property], options);
}

export function parseActorListIndex(index) {
  const numericIndex = Number.parseInt(index, 10);
  return Number.isFinite(numericIndex) && numericIndex >= 0 ? numericIndex : null;
}

export function ensureActorListEntryAt(list, index, createEntry) {
  const numericIndex = parseActorListIndex(index);
  if (numericIndex === null || !Array.isArray(list) || typeof createEntry !== "function") return null;
  while (list.length <= numericIndex) list.push(createEntry());
  list[numericIndex] = createEntry(list[numericIndex]);
  return list[numericIndex];
}

export function removeActorListEntry(list, index) {
  const numericIndex = parseActorListIndex(index);
  if (numericIndex === null || !Array.isArray(list) || numericIndex >= list.length) {
    return { ok: false, changed: false };
  }
  list.splice(numericIndex, 1);
  return { ok: true, changed: true, list };
}

export function reorderActorListEntry(list, fromIndex, toIndex) {
  const from = parseActorListIndex(fromIndex);
  let to = parseActorListIndex(toIndex);
  if (from === null || to === null || !Array.isArray(list) || from >= list.length) {
    return { ok: false, changed: false };
  }

  const [moved] = list.splice(from, 1);
  if (from < to) to--;
  to = Math.max(0, Math.min(to, list.length));
  list.splice(to, 0, moved);
  return { ok: true, changed: true, list };
}

export function patchActorListEntry(list, index, patch, createEntry) {
  const entry = ensureActorListEntryAt(list, index, createEntry);
  if (!entry) return { ok: false, changed: false };
  Object.assign(entry, patch && typeof patch === "object" ? patch : {});
  return { ok: true, changed: true, list, entry };
}
