export const COMBAT_HALT_BUFF_TYPE_HALT = "halt";
export const COMBAT_HALT_BUFF_TYPE_NATURAL = "natural";
export const COMBAT_HALT_BUFF_TYPE_FLAT = "flat";
export const COMBAT_HALT_BUFF_TYPE_COST = "cost";
export const COMBAT_HALT_BUFF_TYPE_CUSTOM = "custom";

export const COMBAT_COST_RESOURCE_TYPES = Object.freeze([
  "Stamina",
  "Attunement",
  "HP",
  "Physical Stress",
  "Mental Stress"
]);

export function normalizeHaltValues(raw) {
  const parts = Array.isArray(raw) ? raw.slice(0, 4) : String(raw || "").split("/").slice(0, 4);
  while (parts.length < 4) parts.push(0);
  return parts.map(value => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  });
}

export function normalizeHaltSlashValue(raw) {
  if (Array.isArray(raw)) return normalizeHaltValues(raw).join("/");
  const cleaned = String(raw || "").replace(/[^\d/]/g, "");
  let parts = cleaned.split("/").map(part => {
    const digits = part.replace(/\D/g, "");
    return digits === "" ? "0" : digits;
  });
  if (parts.length > 4) parts = parts.slice(0, 4);
  while (parts.length < 4) parts.push("0");
  return parts.join("/");
}

export function normalizeHaltSlashValueEditable(raw) {
  if (Array.isArray(raw)) return normalizeHaltSlashValue(raw);
  const cleaned = String(raw || "").replace(/[^\d/]/g, "");
  let parts = cleaned.split("/").map(part => part.replace(/\D/g, ""));
  if (parts.length > 4) parts = parts.slice(0, 4);
  while (parts.length < 4) parts.push("");
  return parts.join("/");
}

export function parseHaltSlashValues(raw) {
  return normalizeHaltValues(raw);
}

export function sanitizeCombatHaltBuffType(rawType) {
  const normalized = String(rawType ?? "").trim().toLowerCase();
  const compact = normalized.replace(/[\s:_-]+/g, "");
  if (
    normalized === COMBAT_HALT_BUFF_TYPE_NATURAL ||
    compact === "nathalt" ||
    compact === "naturalhalt" ||
    compact === "natural"
  ) {
    return COMBAT_HALT_BUFF_TYPE_NATURAL;
  }
  if (
    normalized === COMBAT_HALT_BUFF_TYPE_FLAT ||
    compact === "flatdamage" ||
    compact === "flat"
  ) {
    return COMBAT_HALT_BUFF_TYPE_FLAT;
  }
  if (
    normalized === COMBAT_HALT_BUFF_TYPE_COST ||
    compact === "resourcecost" ||
    compact === "resourcecosts" ||
    compact === "cost"
  ) {
    return COMBAT_HALT_BUFF_TYPE_COST;
  }
  if (normalized === COMBAT_HALT_BUFF_TYPE_CUSTOM || compact === "custom") {
    return COMBAT_HALT_BUFF_TYPE_CUSTOM;
  }
  if (normalized === COMBAT_HALT_BUFF_TYPE_HALT || compact === "halt" || compact === "armorhalt") {
    return COMBAT_HALT_BUFF_TYPE_HALT;
  }
  return COMBAT_HALT_BUFF_TYPE_HALT;
}

export function sanitizeCombatCostResourceType(rawType, fallback = COMBAT_COST_RESOURCE_TYPES[0]) {
  const fallbackSafe = COMBAT_COST_RESOURCE_TYPES.includes(fallback) ? fallback : COMBAT_COST_RESOURCE_TYPES[0];
  const normalized = String(rawType ?? "").trim().toLowerCase().replace(/\s+/g, "");
  for (const type of COMBAT_COST_RESOURCE_TYPES) {
    if (type.toLowerCase().replace(/\s+/g, "") === normalized) return type;
  }
  return fallbackSafe;
}

export function sanitizeCombatHaltBuffEntry(entry) {
  const safe = (entry && typeof entry === "object") ? entry : {};
  const type = sanitizeCombatHaltBuffType(safe.type);
  const value = Number.parseInt(safe.value, 10) || 0;
  const resourceType = sanitizeCombatCostResourceType(safe.resourceType);
  const customName = String(safe.customName ?? "").trim();
  return {
    type,
    values: normalizeHaltValues(safe.values ?? [0, 0, 0, 0]),
    value,
    resourceType: type === COMBAT_HALT_BUFF_TYPE_COST ? resourceType : "",
    customName: type === COMBAT_HALT_BUFF_TYPE_CUSTOM ? customName : ""
  };
}

export function sanitizeCombatHaltBuffs(rawBuffs) {
  if (!Array.isArray(rawBuffs)) return [];
  return rawBuffs.map(buff => sanitizeCombatHaltBuffEntry(buff));
}

export function getCombatHaltBuffTotals(rawBuffs) {
  const buffs = sanitizeCombatHaltBuffs(rawBuffs);
  const totals = {
    [COMBAT_HALT_BUFF_TYPE_HALT]: [0, 0, 0, 0],
    [COMBAT_HALT_BUFF_TYPE_NATURAL]: [0, 0, 0, 0]
  };

  for (const buff of buffs) {
    const type = sanitizeCombatHaltBuffType(buff.type);
    if (type !== COMBAT_HALT_BUFF_TYPE_HALT && type !== COMBAT_HALT_BUFF_TYPE_NATURAL) continue;
    const parts = parseHaltSlashValues(buff.values);
    for (let i = 0; i < 4; i++) totals[type][i] += parts[i] || 0;
  }

  return totals;
}

export function getCombatFlatDamageModifier(rawCombatMods) {
  const legacy = Number.parseInt(rawCombatMods?.flatDamage, 10) || 0;
  const buffs = sanitizeCombatHaltBuffs(rawCombatMods?.haltBuffs);
  const buffTotal = buffs.reduce((sum, buff) => {
    if (sanitizeCombatHaltBuffType(buff.type) !== COMBAT_HALT_BUFF_TYPE_FLAT) return sum;
    return sum + (Number.parseInt(buff.value, 10) || 0);
  }, 0);
  return legacy + buffTotal;
}

export function getCombatCostModifiers(rawCombatMods) {
  const totals = {};
  const legacy = Number.parseInt(rawCombatMods?.costMod, 10) || 0;
  for (const resourceType of COMBAT_COST_RESOURCE_TYPES) totals[resourceType] = legacy;

  const buffs = sanitizeCombatHaltBuffs(rawCombatMods?.haltBuffs);
  for (const buff of buffs) {
    if (sanitizeCombatHaltBuffType(buff.type) !== COMBAT_HALT_BUFF_TYPE_COST) continue;
    const resourceType = sanitizeCombatCostResourceType(buff.resourceType);
    totals[resourceType] = (totals[resourceType] || 0) + (Number.parseInt(buff.value, 10) || 0);
  }

  return totals;
}
