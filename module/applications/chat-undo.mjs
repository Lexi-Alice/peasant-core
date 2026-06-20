const PC_SYSTEM_ID = "peasant-core";
const PC_ROLL_UNDO_FLAG = "rollUndo";
const PC_EDGE_CHAIN_FLAG = "edgeChain";

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

function createActorUndoRecord(actor, label, beforeSystem, afterSystem) {
  const changedPaths = collectChangedSystemPaths(beforeSystem, afterSystem)
    .filter(path => path && !path.startsWith("_"));
  if (!changedPaths.length) return null;

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
    after
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
  return !!record && isPlainObject(record.before) && Object.keys(record.before).length > 0;
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

export async function captureActorRollUndo(actor, label, operation) {
  const beforeSystem = getActorSystemSource(actor);
  const result = await operation();
  const afterSystem = getActorSystemSource(actor);
  const record = actor ? createActorUndoRecord(actor, label, beforeSystem, afterSystem) : null;
  return {
    result,
    undoRecords: record ? [record] : []
  };
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

export async function applyRollUndoRecords(records = []) {
  const undoRecords = Array.isArray(records) ? records.filter(canUndoRecord) : [];
  if (!undoRecords.length) return { ok: true, applied: false };
  const prepared = [];
  const failures = [];
  for (const record of [...undoRecords].reverse()) {
    const result = await prepareUndoRecord(record);
    if (!result.ok) {
      failures.push(result.message);
    } else {
      prepared.push(result);
    }
  }

  if (failures.length > 0) {
    return { ok: false, error: failures[0] };
  }

  for (const { actor, record } of prepared) {
    await actor.update(record.before);
  }

  return { ok: true, applied: prepared.length > 0 };
}

export async function markRollUndoChatMessageEffectsUndone(message, {
  undoneBy = game.user?.id || null,
  undoneAt = Date.now()
} = {}) {
  const flag = getRollUndoFlag(message);
  if (!flag || !message?.setFlag) return null;
  await message.setFlag(PC_SYSTEM_ID, PC_ROLL_UNDO_FLAG, {
    ...flag,
    status: "undone",
    undoneAt,
    undoneBy
  });
  return true;
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
