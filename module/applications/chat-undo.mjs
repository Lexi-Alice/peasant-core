import { isOverchargedEffect } from "../data/active-effect/overcharged.mjs";

const PC_SYSTEM_ID = "peasant-core";
const PC_ROLL_UNDO_FLAG = "rollUndo";
const PC_EDGE_CHAIN_FLAG = "edgeChain";
const ENTRY_COLLECTIONS = new Set(["skills", "notableCombats"]);
const ENTRY_COUNTER_PATHS = Object.freeze([
  "usesCurrent",
  "signatureUsage.duressCurrent",
  "tagUses.current",
  "sections.current",
  "speed.splitSecondCurrent"
]);

function cloneData(value) {
  if (value === undefined) return undefined;
  if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getActorSystemSource(actor) {
  return cloneData(actor?.system?._source ?? actor?._source?.system ?? actor?.system ?? {});
}

function getActorSpellEffectSources(actor) {
  return Array.from(actor?.effects || [])
    .filter((effect) => (
      effect?.type === "spellEffect"
      || isOverchargedEffect(effect)
      || effect?.flags?.["peasant-core"]?.guardBroken === true
      || effect?.getFlag?.("peasant-core", "guardBroken") === true
    ))
    .map((effect) => cloneData(effect.toObject?.() ?? effect._source ?? {}))
    .filter((source) => !!String(source?._id || "").trim())
    .sort((left, right) => String(left._id).localeCompare(String(right._id)));
}

function getActorSkillEffectSources(actor) {
  return Array.from(actor?.effects || [])
    .filter(effect => effect?.type === "skill" && !!(
      effect?.flags?.[PC_SYSTEM_ID]?.skillUseOrigin
      || effect?._source?.flags?.[PC_SYSTEM_ID]?.skillUseOrigin
    ))
    .map(effect => cloneData(effect.toObject?.() ?? effect._source ?? {}))
    .filter(source => !!String(source?._id || "").trim())
    .sort((left, right) => String(left._id).localeCompare(String(right._id)));
}

function getPathValue(root, path) {
  if (!path) return root;
  const parts = String(path).split(".").filter(Boolean);
  let current = root;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function normalizeEntryCounterRef(ref) {
  const collection = String(ref?.collection || "").trim();
  const entryId = String(ref?.entryId || "").trim();
  const usageId = String(ref?.usageId || "base").trim() || "base";
  return ENTRY_COLLECTIONS.has(collection) && entryId ? { collection, entryId, usageId } : null;
}

function resolveEntryCounter(system, ref, path) {
  const normalizedRef = normalizeEntryCounterRef(ref);
  if (!normalizedRef || !ENTRY_COUNTER_PATHS.includes(path)) return null;
  const entries = Array.isArray(system?.[normalizedRef.collection]) ? system[normalizedRef.collection] : [];
  const entryIndex = entries.findIndex((candidate) => String(candidate?.id || "").trim() === normalizedRef.entryId);
  const entry = entries[entryIndex];
  if (!entry) return null;

  let owner = entry;
  let ownerPath = `${normalizedRef.collection}.${entryIndex}`;
  let usageId = "base";
  if (normalizedRef.usageId !== "base" && !path.startsWith("usesCurrent") && !path.startsWith("signatureUsage.")) {
    const usageIndex = Array.isArray(entry.usages)
      ? entry.usages.findIndex((candidate) => String(candidate?.id || "").trim() === normalizedRef.usageId)
      : -1;
    const usage = usageIndex >= 0 ? entry.usages[usageIndex] : null;
    if (!usage) return null;
    const tagType = path.split(".")[0];
    const sharedCounter = ["tagUses", "sections"].includes(tagType)
      && usage.counterScopes?.[tagType] !== "local";
    if (!sharedCounter) {
      owner = usage.mechanics || {};
      ownerPath = `${normalizedRef.collection}.${entryIndex}.usages.${usageIndex}.mechanics`;
      usageId = normalizedRef.usageId;
    }
  }

  const value = Number(getPathValue(owner, path));
  const maxPath = path === "usesCurrent"
    ? "usesMax"
    : path === "signatureUsage.duressCurrent"
      ? "signatureUsage.duressMax"
      : path.replace(/Current$/, "Max").replace(/\.current$/, ".max");
  const max = Number(getPathValue(owner, maxPath));
  return {
    collection: normalizedRef.collection,
    entryId: normalizedRef.entryId,
    usageId,
    path,
    value: Number.isFinite(value) ? value : 0,
    max: Number.isFinite(max) ? Math.max(0, max) : 0,
    updatePath: `system.${ownerPath}.${path}`
  };
}

function collectEntryCounterSnapshots(system, refs = []) {
  const snapshots = new Map();
  for (const rawRef of refs) {
    for (const path of ENTRY_COUNTER_PATHS) {
      const counter = resolveEntryCounter(system, rawRef, path);
      if (!counter) continue;
      const key = [counter.collection, counter.entryId, counter.usageId, counter.path].join(":");
      snapshots.set(key, counter);
    }
  }
  return snapshots;
}

function collectChangedEntryCounters(before, after) {
  const counters = [];
  for (const [key, beforeCounter] of before) {
    const afterCounter = after.get(key);
    if (!afterCounter || beforeCounter.value === afterCounter.value) continue;
    counters.push({
      collection: beforeCounter.collection,
      entryId: beforeCounter.entryId,
      usageId: beforeCounter.usageId,
      path: beforeCounter.path,
      before: beforeCounter.value,
      after: afterCounter.value
    });
  }
  return counters;
}

function collectChangedSystemPaths(before, after, path = "", changes = []) {
  if (valuesEqual(before, after)) return changes;

  if (Array.isArray(before) || Array.isArray(after)) {
    changes.push(path);
    return changes;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key;
      collectChangedSystemPaths(before[key], after[key], nextPath, changes);
    }
    return changes;
  }

  changes.push(path);
  return changes;
}

function getChangedSpellEffectSources(beforeEffects = [], afterEffects = []) {
  const beforeById = new Map(beforeEffects.map((source) => [String(source._id), source]));
  const afterById = new Map(afterEffects.map((source) => [String(source._id), source]));
  const changedIds = new Set([...beforeById.keys(), ...afterById.keys()]);
  for (const id of Array.from(changedIds)) {
    if (valuesEqual(beforeById.get(id), afterById.get(id))) changedIds.delete(id);
  }
  return {
    before: Array.from(changedIds).map((id) => cloneData(beforeById.get(id))).filter(Boolean),
    after: Array.from(changedIds).map((id) => cloneData(afterById.get(id))).filter(Boolean)
  };
}

function createActorUndoRecord(actor, label, beforeSystem, afterSystem, beforeEffects = [], afterEffects = [], {
  entryCounters = [],
  excludedSystemPaths = [],
  beforeSkillEffects = [],
  afterSkillEffects = []
} = {}) {
  const changedPaths = collectChangedSystemPaths(beforeSystem, afterSystem)
    .filter(path => path && !path.startsWith("_") && !excludedSystemPaths.includes(path));
  const spellEffects = getChangedSpellEffectSources(beforeEffects, afterEffects);
  const skillEffects = getChangedSpellEffectSources(beforeSkillEffects, afterSkillEffects);
  if (!changedPaths.length && !spellEffects.before.length && !spellEffects.after.length
    && !skillEffects.before.length && !skillEffects.after.length && !entryCounters.length) return null;

  const before = {};
  const after = {};
  for (const path of changedPaths) {
    before[`system.${path}`] = cloneData(getPathValue(beforeSystem, path));
    after[`system.${path}`] = cloneData(getPathValue(afterSystem, path));
  }

  return {
    id: foundry?.utils?.randomID?.(16) ?? `undo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    actorId: actor?.id || null,
    actorUuid: actor?.uuid || null,
    actorName: actor?.name || "Actor",
    label: String(label || "Roll Effects").trim() || "Roll Effects",
    before,
    after,
    ...(entryCounters.length ? { entryCounters: cloneData(entryCounters) } : {}),
    ...(spellEffects.before.length || spellEffects.after.length ? { spellEffects } : {}),
    ...(skillEffects.before.length || skillEffects.after.length ? { skillEffects } : {})
  };
}

async function resolveUndoActor(record) {
  const actorUuid = String(record?.actorUuid || "").trim();
  if (actorUuid && typeof fromUuid === "function") {
    try {
      const actor = await fromUuid(actorUuid);
      if (actor) return actor;
    } catch (e) {}
  }

  const actorId = String(record?.actorId || "").trim();
  return actorId ? game.actors?.get(actorId) || null : null;
}

export function canUndoRecord(record) {
  if (!record || !isPlainObject(record.before)) return false;
  if (Object.keys(record.before).length > 0) return true;
  if (Array.isArray(record.entryCounters) && record.entryCounters.length > 0) return true;
  return !!(
    Array.isArray(record?.spellEffects?.before)
    && Array.isArray(record?.spellEffects?.after)
    && (record.spellEffects.before.length > 0 || record.spellEffects.after.length > 0)
  ) || !!(
    Array.isArray(record?.skillEffects?.before)
    && Array.isArray(record?.skillEffects?.after)
    && (record.skillEffects.before.length > 0 || record.skillEffects.after.length > 0)
  );
}

function getMessageFromContextElement(element) {
  const root = element?.closest?.("[data-message-id]") || element;
  const messageId = root?.dataset?.messageId || element?.dataset?.messageId || "";
  return messageId ? game.messages?.get(messageId) || null : null;
}

function getRollUndoFlag(message) {
  const flag = message?.getFlag?.(PC_SYSTEM_ID, PC_ROLL_UNDO_FLAG);
  return flag && typeof flag === "object" ? flag : null;
}

export function getAvailableRollUndoRecords(message) {
  const flag = getRollUndoFlag(message);
  if (!flag || flag.status === "undone") return [];
  return Array.isArray(flag.records) ? flag.records.filter(canUndoRecord) : [];
}

function userCanUndoMessage(message) {
  if (!message) return false;
  if (game.user?.isGM) return true;
  try {
    return typeof message.canUserModify === "function" && message.canUserModify(game.user, "update");
  } catch (e) {
    return false;
  }
}

async function prepareUndoRecord(record) {
  const actor = await resolveUndoActor(record);
  if (!actor) {
    return { ok: false, message: `Could not find ${record?.actorName || "actor"}.` };
  }
  if (!game.user?.isGM) {
    try {
      if (typeof actor.canUserModify !== "function" || !actor.canUserModify(game.user, "update")) {
        return { ok: false, message: `You cannot update ${actor.name || record.actorName || "actor"}.` };
      }
    } catch (e) {
      return { ok: false, message: `You cannot update ${actor.name || record.actorName || "actor"}.` };
    }
  }

  return { ok: true, actor, record };
}

export async function captureActorRollUndo(actor, label, operation, {
  includeSpellEffects = false,
  includeSkillEffects = false,
  entryCounterRefs = []
} = {}) {
  const beforeSystem = getActorSystemSource(actor);
  const beforeEffects = includeSpellEffects ? getActorSpellEffectSources(actor) : [];
  const beforeSkillEffects = includeSkillEffects ? getActorSkillEffectSources(actor) : [];
  const normalizedCounterRefs = entryCounterRefs.map(normalizeEntryCounterRef).filter(Boolean);
  const beforeCounters = collectEntryCounterSnapshots(beforeSystem, normalizedCounterRefs);
  const result = await operation();
  const afterSystem = getActorSystemSource(actor);
  const afterEffects = includeSpellEffects ? getActorSpellEffectSources(actor) : [];
  const afterSkillEffects = includeSkillEffects ? getActorSkillEffectSources(actor) : [];
  const entryCounters = collectChangedEntryCounters(
    beforeCounters,
    collectEntryCounterSnapshots(afterSystem, normalizedCounterRefs)
  );
  const excludedSystemPaths = [...new Set(entryCounters.map((counter) => counter.collection))];
  const record = actor
    ? createActorUndoRecord(actor, label, beforeSystem, afterSystem, beforeEffects, afterEffects, {
        entryCounters,
        excludedSystemPaths,
        beforeSkillEffects,
        afterSkillEffects
      })
    : null;
  return {
    result,
    undoRecords: record ? [record] : []
  };
}

async function applyEntryCounterUndo(actor, counter) {
  const system = getActorSystemSource(actor);
  const current = resolveEntryCounter(system, counter, counter.path);
  if (!current) return false;
  const list = cloneData(system[current.collection]);
  const parts = current.updatePath.split(".");
  let owner = { system: { [current.collection]: list } };
  for (const part of parts.slice(0, -1)) owner = owner[part];
  owner[parts.at(-1)] = Number(counter.before);
  const patch = { [`system.${current.collection}`]: list };
  if (typeof actor.updatePeasantStateData === "function") {
    await actor.updatePeasantStateData(patch);
  } else {
    await actor.update(patch);
  }
  return true;
}

function validateEntryCounterUndo(prepared) {
  const simulated = new Map();
  for (const { actor, record } of prepared) {
    for (const counter of record.entryCounters || []) {
      const current = resolveEntryCounter(getActorSystemSource(actor), counter, counter.path);
      if (!current) {
        return `Could not find the recorded ${counter.path || "entry counter"} on ${actor.name || record.actorName || "actor"}.`;
      }
      const key = [actor?.uuid || actor?.id || "", current.collection, current.entryId, current.usageId, current.path].join(":");
      const currentValue = simulated.has(key) ? simulated.get(key) : current.value;
      const expectedAfter = Number(counter.after);
      const restoreBefore = Number(counter.before);
      if (!Number.isFinite(expectedAfter) || !Number.isFinite(restoreBefore) || currentValue !== expectedAfter) {
        return `The recorded ${counter.path} on ${actor.name || record.actorName || "actor"} has changed since the roll.`;
      }
      if (restoreBefore < 0 || restoreBefore > current.max) {
        return `The recorded ${counter.path} on ${actor.name || record.actorName || "actor"} no longer fits its maximum.`;
      }
      simulated.set(key, restoreBefore);
    }
  }
  return "";
}

export function collectRollUndoRecords(...values) {
  const records = [];
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      records.push(...value.filter(canUndoRecord));
    } else if (Array.isArray(value.undoRecords)) {
      records.push(...value.undoRecords.filter(canUndoRecord));
    }
  }
  return records;
}

export async function attachRollUndoToChatMessage(message, records, { label = "Undo Roll Effects" } = {}) {
  const nextRecords = collectRollUndoRecords(records);
  if (!message?.setFlag || nextRecords.length <= 0) return;

  const existing = getRollUndoFlag(message);
  const existingRecords = Array.isArray(existing?.records) ? existing.records.filter(canUndoRecord) : [];
  await message.setFlag(PC_SYSTEM_ID, PC_ROLL_UNDO_FLAG, {
    label,
    status: "available",
    records: [...existingRecords, ...nextRecords],
    createdAt: Date.now(),
    undoneAt: null,
    undoneBy: null
  });
}

async function applyPreparedUndoRecord({ actor, record }) {
  for (const key of ["spellEffects", "skillEffects"]) {
    const beforeEffects = Array.isArray(record?.[key]?.before) ? record[key].before : [];
    const afterEffects = Array.isArray(record?.[key]?.after) ? record[key].after : [];
    if (!beforeEffects.length && !afterEffects.length) continue;
    const beforeById = new Map(beforeEffects.map((source) => [String(source._id), source]));
    const afterById = new Map(afterEffects.map((source) => [String(source._id), source]));
    const currentById = new Map(Array.from(actor?.effects || []).map((effect) => [String(effect?.id || effect?._id || ""), effect]));
    const createdIds = Array.from(afterById.keys()).filter((id) => !beforeById.has(id) && currentById.has(id));
    if (createdIds.length) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", createdIds, key === "spellEffects" ? { peasantCoreSpellEffectWrite: true } : {});
    }

    const updateSources = beforeEffects.filter((source) => currentById.has(String(source._id)));
    if (updateSources.length) {
      await actor.updateEmbeddedDocuments("ActiveEffect", updateSources, {
        ...(key === "spellEffects" ? { peasantCoreSpellEffectWrite: true } : {}),
        diff: false,
        recursive: false
      });
    }

    const recreateSources = beforeEffects.filter((source) => !currentById.has(String(source._id)));
    if (recreateSources.length) {
      await actor.createEmbeddedDocuments("ActiveEffect", recreateSources, {
        keepId: true,
        ...(key === "spellEffects" ? { peasantCoreSpellEffectWrite: true } : {})
      });
    }
  }

  if (Object.keys(record.before).length) await actor.update(record.before);
  for (const counter of record.entryCounters || []) await applyEntryCounterUndo(actor, counter);
}

function invertPreparedUndoRecord({ actor, record }) {
  return { actor, record: {
    ...record,
    before: cloneData(record.after),
    after: cloneData(record.before),
    ...(record.entryCounters ? { entryCounters: record.entryCounters.map(counter => ({
      ...counter, before: counter.after, after: counter.before
    })) } : {}),
    ...(record.spellEffects ? { spellEffects: {
      before: cloneData(record.spellEffects.after), after: cloneData(record.spellEffects.before)
    } } : {}),
    ...(record.skillEffects ? { skillEffects: {
      before: cloneData(record.skillEffects.after), after: cloneData(record.skillEffects.before)
    } } : {})
  } };
}

export async function applyRollUndoRecords(records = []) {
  const undoRecords = Array.isArray(records) ? records.filter(canUndoRecord) : [];
  if (!undoRecords.length) return { ok: true, applied: false };
  const prepared = [];
  const failures = [];
  for (const record of [...undoRecords].reverse()) {
    const result = await prepareUndoRecord(record);
    if (!result.ok) failures.push(result.message);
    else prepared.push(result);
  }

  if (failures.length > 0) return { ok: false, error: failures[0] };
  const counterFailure = validateEntryCounterUndo(prepared);
  if (counterFailure) return { ok: false, error: counterFailure };

  const attempted = [];
  try {
    for (const item of prepared) {
      attempted.push(item);
      await applyPreparedUndoRecord(item);
    }
  } catch (error) {
    for (const item of attempted.reverse()) {
      try { await applyPreparedUndoRecord(invertPreparedUndoRecord(item)); }
      catch (rollbackError) { console.error("Peasant Core | Could not restore a partially undone roll", rollbackError); }
    }
    throw error;
  }

  return { ok: true, applied: prepared.length > 0 };
}

export async function markRollUndoChatMessageEffectsUndone(message, {
  undoneBy = game.user?.id || null,
  undoneAt = Date.now()
} = {}) {
  const flag = getRollUndoFlag(message);
  if (!message?.setFlag) return null;
  if (flag) await message.setFlag(PC_SYSTEM_ID, PC_ROLL_UNDO_FLAG, {
    ...flag, status: "undone", undoneAt, undoneBy
  });
  const offers = message.getFlag?.(PC_SYSTEM_ID, "skillEffectOffers");
  if (offers?.offers?.length) await message.setFlag(PC_SYSTEM_ID, "skillEffectOffers", {
    ...offers,
    offers: offers.offers.map(offer => ({ ...offer, status: "retired", retiredAt: undoneAt }))
  });
  return !!flag || !!offers?.offers?.length;
}

async function markRelatedEdgeChainUndone(message) {
  const sourceFlag = message?.getFlag?.(PC_SYSTEM_ID, PC_EDGE_CHAIN_FLAG);
  const chainId = String(sourceFlag?.chainId || "").trim();
  if (!chainId) return;

  const messages = Array.from(game.messages || []);
  for (const relatedMessage of messages) {
    const edgeFlag = relatedMessage?.getFlag?.(PC_SYSTEM_ID, PC_EDGE_CHAIN_FLAG);
    if (String(edgeFlag?.chainId || "").trim() !== chainId) continue;
    await markRollUndoChatMessageEffectsUndone(relatedMessage);
    if (relatedMessage?.setFlag) {
      await relatedMessage.setFlag(PC_SYSTEM_ID, PC_EDGE_CHAIN_FLAG, {
        ...edgeFlag,
        status: "undone",
        processing: false,
        processingUserId: null,
        undoneAt: Date.now(),
        undoneBy: game.user?.id || null
      });
    }
  }
}

export async function undoRollChatMessageEffects(message) {
  const records = getAvailableRollUndoRecords(message);
  if (!records.length) return false;

  const undoResult = await applyRollUndoRecords(records);
  if (!undoResult.ok) {
    ui.notifications?.warn?.(undoResult.error || "Could not undo roll effects.");
    return false;
  }

  await markRollUndoChatMessageEffectsUndone(message);
  await markRelatedEdgeChainUndone(message);
  ui.notifications?.info?.("Peasant Core roll effects undone.");
  return true;
}

export function configureRollUndoChatContext() {
  Hooks.on("getChatMessageContextOptions", (_application, menuItems) => {
    menuItems.push({
      name: "Undo Roll Effects",
      icon: '<i class="fas fa-rotate-left"></i>',
      condition: element => {
        const message = getMessageFromContextElement(element);
        return userCanUndoMessage(message) && getAvailableRollUndoRecords(message).length > 0;
      },
      callback: async element => {
        const message = getMessageFromContextElement(element);
        if (message) await undoRollChatMessageEffects(message);
      }
    });
  });
}
