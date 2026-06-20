export const PC_LOCATION_ROLL_FLAG = "locationRoll";

export const LOCATION_ROLL_SOURCE_STANDALONE = "standalone";
export const LOCATION_ROLL_SOURCE_WORKFLOW = "workflow";

export const LOCATION_ROLL_STATUS_CURRENT = "current";
export const LOCATION_ROLL_STATUS_PROCESSING = "processing";
export const LOCATION_ROLL_STATUS_SUPERSEDED = "superseded";

const LOCATION_ROLL_SOURCES = new Set([
  LOCATION_ROLL_SOURCE_STANDALONE,
  LOCATION_ROLL_SOURCE_WORKFLOW
]);

const LOCATION_ROLL_STATUSES = new Set([
  LOCATION_ROLL_STATUS_CURRENT,
  LOCATION_ROLL_STATUS_PROCESSING,
  LOCATION_ROLL_STATUS_SUPERSEDED
]);

function cloneData(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  } catch (_) {}
  return JSON.parse(JSON.stringify(value));
}

function createFallbackId() {
  try {
    const id = foundry?.utils?.randomID?.(16);
    if (id) return id;
  } catch (_) {}
  return `location-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeSource(source) {
  const safeSource = String(source || "").trim();
  return LOCATION_ROLL_SOURCES.has(safeSource) ? safeSource : LOCATION_ROLL_SOURCE_STANDALONE;
}

function sanitizeStatus(status, fallback = LOCATION_ROLL_STATUS_CURRENT) {
  const safeStatus = String(status || "").trim();
  return LOCATION_ROLL_STATUSES.has(safeStatus) ? safeStatus : fallback;
}

function sanitizeMessageId(messageId) {
  return String(messageId || "").trim() || null;
}

export function cloneLocationRollData(value) {
  return cloneData(value);
}

export function normalizeLocationRollResult(result = {}) {
  const safe = (result && typeof result === "object") ? result : {};
  const location = String(safe.location || "Torso").trim() || "Torso";
  const locationDisplay = String(safe.locationDisplay || safe.rawText || location).trim() || location;
  const rawText = String(safe.rawText || locationDisplay).trim() || locationDisplay;
  return {
    rawText,
    location,
    locationDisplay,
    isAP: !!safe.isAP
  };
}

export function createLocationRollFlag({
  source = LOCATION_ROLL_SOURCE_STANDALONE,
  status = LOCATION_ROLL_STATUS_CURRENT,
  result = null,
  workflowId = "",
  revision = 0,
  replacementOfMessageId = null,
  replacedByMessageId = null,
  supersededReason = "",
  workflow = null,
  processing = false,
  processingUserId = null,
  createdBy = null,
  createdAt = null
} = {}) {
  const safeRevision = Number.parseInt(revision, 10);
  const safeWorkflow = (workflow && typeof workflow === "object") ? cloneData(workflow) : null;
  return {
    version: 1,
    source: sanitizeSource(source),
    status: sanitizeStatus(status),
    result: normalizeLocationRollResult(result),
    workflowId: String(workflowId || "").trim() || createFallbackId(),
    revision: Number.isFinite(safeRevision) ? Math.max(0, safeRevision) : 0,
    replacementOfMessageId: sanitizeMessageId(replacementOfMessageId),
    replacedByMessageId: sanitizeMessageId(replacedByMessageId),
    supersededReason: String(supersededReason || "").trim(),
    workflow: safeWorkflow,
    processing: !!processing,
    processingUserId: sanitizeMessageId(processingUserId),
    createdBy: sanitizeMessageId(createdBy),
    createdAt: Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now()
  };
}

export function normalizeLocationRollFlag(rawFlag) {
  if (!rawFlag || typeof rawFlag !== "object") return null;
  const source = sanitizeSource(rawFlag.source);
  const workflow = (rawFlag.workflow && typeof rawFlag.workflow === "object")
    ? cloneData(rawFlag.workflow)
    : null;

  return createLocationRollFlag({
    source,
    status: sanitizeStatus(rawFlag.status),
    result: rawFlag.result,
    workflowId: rawFlag.workflowId,
    revision: rawFlag.revision,
    replacementOfMessageId: rawFlag.replacementOfMessageId,
    replacedByMessageId: rawFlag.replacedByMessageId,
    supersededReason: rawFlag.supersededReason,
    workflow,
    processing: !!rawFlag.processing,
    processingUserId: rawFlag.processingUserId,
    createdBy: rawFlag.createdBy,
    createdAt: rawFlag.createdAt
  });
}

export function canEdgeRerollLocationRollFlag(rawFlag) {
  const flag = normalizeLocationRollFlag(rawFlag);
  if (!flag || flag.status !== LOCATION_ROLL_STATUS_CURRENT || flag.processing) return false;
  if (flag.source === LOCATION_ROLL_SOURCE_STANDALONE) return true;

  const workflow = flag.workflow || {};
  return !!(
    flag.source === LOCATION_ROLL_SOURCE_WORKFLOW
    && workflow.applicationPayload
    && typeof workflow.applicationPayload === "object"
    && Array.isArray(workflow.undoRecords)
  );
}

export function buildProcessingLocationRollFlag(rawFlag, {
  processingUserId = null
} = {}) {
  const flag = normalizeLocationRollFlag(rawFlag);
  if (!flag) return null;
  return {
    ...flag,
    status: LOCATION_ROLL_STATUS_PROCESSING,
    processing: true,
    processingUserId: sanitizeMessageId(processingUserId)
  };
}

export function buildSupersededLocationRollFlag(rawFlag, {
  replacedByMessageId = null,
  supersededReason = "edge"
} = {}) {
  const flag = normalizeLocationRollFlag(rawFlag);
  if (!flag) return null;
  return {
    ...flag,
    status: LOCATION_ROLL_STATUS_SUPERSEDED,
    processing: false,
    processingUserId: null,
    replacedByMessageId: sanitizeMessageId(replacedByMessageId),
    supersededReason: String(supersededReason || "").trim()
  };
}

export function mergeLocationRollWorkflow(rawFlag, workflowPatch = {}) {
  const flag = normalizeLocationRollFlag(rawFlag);
  if (!flag) return null;
  const currentWorkflow = (flag.workflow && typeof flag.workflow === "object") ? flag.workflow : {};
  return {
    ...flag,
    workflow: {
      ...cloneData(currentWorkflow),
      ...cloneData(workflowPatch)
    }
  };
}
