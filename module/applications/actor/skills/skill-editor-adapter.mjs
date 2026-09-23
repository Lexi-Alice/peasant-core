import { getActorSourceSystem } from "../../../data/actor/source-system.mjs";

const ENTRY_COLLECTIONS = new Set(["skills", "notableCombats"]);

function normalizeEntryRef(ref) {
  const collection = String(ref?.collection ?? "").trim();
  const entryId = String(ref?.entryId ?? "").trim();
  if (!ENTRY_COLLECTIONS.has(collection)) {
    throw new Error(`Unsupported Peasant entry collection: ${collection}`);
  }
  if (!entryId) throw new Error("A stable Peasant entry ID is required.");
  return Object.freeze({ collection, entryId });
}

function findEntry(system, ref) {
  const entries = Array.isArray(system?.[ref.collection]) ? system[ref.collection] : [];
  return entries.find(entry => String(entry?.id ?? "") === ref.entryId) ?? null;
}

export function createSkillEditorAdapter(sheet, rawRef) {
  const ref = normalizeEntryRef(rawRef);
  const actor = sheet?.actor;

  return Object.freeze({
    ref,
    readSource: () => findEntry(getActorSourceSystem(actor), ref),
    readEffective: () => findEntry(actor?.system, ref),
    update: (patch, options = {}) => actor?.updatePeasantEntry?.(ref, patch, options)
      ?? Promise.resolve({ ok: false, changed: false }),
    manageUsage: (action, options = {}) => actor?.managePeasantEntryUsage?.(ref, action, options)
      ?? Promise.resolve({ ok: false, changed: false }),
    manageEffectLink: (action, options = {}) => actor?.managePeasantEntryEffectLink?.(ref, action, options)
      ?? Promise.resolve({ ok: false, changed: false }),
    setTag: (tagType, tagData, options = {}) => actor?.setPeasantEntryTag?.(ref, tagType, tagData, options)
      ?? Promise.resolve({ ok: false, changed: false })
  });
}
