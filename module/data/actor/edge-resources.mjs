import { PC_WINTER_EDGE_FLAG } from "./sheet-settings.mjs";

export const EDGE_LABEL_MODE_EDGE = "edge";
export const EDGE_LABEL_MODE_WINTER = "winter";
export const EDGE_LABEL_MODE_DRAGON = "dragon";
export const EDGE_LABEL_MODE_CUSTOM = "custom";

const EDGE_LABEL_MODES = new Set([
  EDGE_LABEL_MODE_EDGE,
  EDGE_LABEL_MODE_WINTER,
  EDGE_LABEL_MODE_DRAGON,
  EDGE_LABEL_MODE_CUSTOM
]);

export function getDefaultEdgeLabelMode(source) {
  return source?.getFlag?.("peasant-core", PC_WINTER_EDGE_FLAG)
    ? EDGE_LABEL_MODE_WINTER
    : EDGE_LABEL_MODE_EDGE;
}

export function sanitizeEdgeLabelMode(value, fallback = EDGE_LABEL_MODE_EDGE) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (EDGE_LABEL_MODES.has(normalized)) return normalized;
  if (normalized.includes("winter")) return EDGE_LABEL_MODE_WINTER;
  if (normalized.includes("dragon")) return EDGE_LABEL_MODE_DRAGON;
  if (normalized.includes("custom")) return EDGE_LABEL_MODE_CUSTOM;
  if (normalized.includes("edge")) return EDGE_LABEL_MODE_EDGE;
  const fallbackNormalized = String(fallback ?? EDGE_LABEL_MODE_EDGE).trim().toLowerCase();
  return EDGE_LABEL_MODES.has(fallbackNormalized) ? fallbackNormalized : EDGE_LABEL_MODE_EDGE;
}

export function getEdgeLabelText(mode) {
  switch (mode) {
    case EDGE_LABEL_MODE_WINTER:
      return "Winter's Edge";
    case EDGE_LABEL_MODE_DRAGON:
      return "Dragon's Edge";
    case EDGE_LABEL_MODE_CUSTOM:
      return "Custom";
    case EDGE_LABEL_MODE_EDGE:
    default:
      return "Edge";
  }
}

export function resolveEdgeLabel(mode, customLabel, fallbackMode = EDGE_LABEL_MODE_EDGE) {
  const safeMode = sanitizeEdgeLabelMode(mode, fallbackMode);
  if (safeMode === EDGE_LABEL_MODE_CUSTOM) {
    const trimmed = String(customLabel ?? "").trim();
    return trimmed || "Custom";
  }
  return getEdgeLabelText(safeMode);
}

export function normalizeEdgeResourceEntry(entry, fallbackMode = EDGE_LABEL_MODE_EDGE) {
  const safe = (entry && typeof entry === "object") ? entry : {};
  const labelMode = sanitizeEdgeLabelMode(safe.labelMode, fallbackMode);
  const customLabel = String(safe.customLabel ?? "");
  const parsedMax = Number.parseInt(safe.max, 10);
  const max = Number.isFinite(parsedMax) ? Math.max(0, parsedMax) : 0;
  const parsedValue = Number.parseInt(safe.value, 10);
  const rawValue = Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0;
  const value = Math.min(rawValue, max);
  return { labelMode, customLabel, value, max };
}
