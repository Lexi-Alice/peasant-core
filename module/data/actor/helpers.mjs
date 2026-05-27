const PC_CHARACTER_TYPES = Object.freeze(["character"]);
const PC_CHARACTER_TYPE_SET = new Set(PC_CHARACTER_TYPES);

export function isPeasantCharacterType(type) {
  return PC_CHARACTER_TYPE_SET.has(String(type ?? "").trim());
}

export function isSimplifiedHpActor(actor) {
  return !!actor?.getFlag?.("peasant-core", "simplifiedHp");
}

export function getActorHealthMax(actor) {
  const currentMax = Number(actor?.system?.health?.max);
  if (Number.isFinite(currentMax) && currentMax > 0) return currentMax;
  const rows = Number(actor?.system?.hp?.rows) || 0;
  const cols = Number(actor?.system?.hp?.cols) || 0;
  return rows * cols;
}

export function getActorBolsteredMax(actor) {
  if (isSimplifiedHpActor(actor)) return getActorHealthMax(actor);
  return Number(actor?.system?.hp?.cols) || 0;
}

export function parseOptionalInteger(value, { allowSign = false, min = null } = {}) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (!Number.isInteger(value)) return null;
    return Number.isFinite(min) && value < min ? null : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const pattern = allowSign ? /^[+-]?\d+$/ : /^\d+$/;
  if (!pattern.test(raw)) return null;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return Number.isFinite(min) && parsed < min ? null : parsed;
}

export function formatOptionalIntegerInput(value, { showPlus = false } = {}) {
  const parsed = parseOptionalInteger(value, { allowSign: true });
  if (parsed === null) return "";
  return showPlus && parsed > 0 ? `+${parsed}` : String(parsed);
}

export function sanitizeOptionalIntegerInputValue(value, { allowSign = false } = {}) {
  const raw = String(value ?? "");
  if (!allowSign) return raw.replace(/\D/g, "");

  const sign = /^[+-]/.test(raw) ? raw[0] : "";
  const digits = raw.slice(sign ? 1 : 0).replace(/\D/g, "");
  return `${sign}${digits}`;
}

export function hasOptionalInteger(value) {
  return parseOptionalInteger(value, { allowSign: true }) !== null;
}
