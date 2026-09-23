import { createDefaultCombatDefense, normalizeCombatDefense } from "./combat-defense.mjs";
import {
  getCombatCustomTags,
  normalizeCombatMagnetism,
  normalizeCombatTargetingType,
  normalizeRangeRateValue,
  syncCombatCustomTags
} from "./combat-tags.mjs";
import { normalizeHaltValues } from "./combat-modifiers.mjs";
import { normalizeSkillTypeForCategory } from "./skill-entry-types.mjs";

const COLLECTIONS = new Set(["skills", "notableCombats"]);
const ROLL_OVERRIDE_KEYS = Object.freeze(["characteristics", "characteristicMode", "tohit", "accuracy"]);

export const SKILL_MECHANIC_DEFAULTS = Object.freeze({
  staminaCost: 0,
  attunementCost: 0,
  resourceCosts: [],
  speed: { type: "", splitSecondCurrent: 0, splitSecondMax: 0 },
  range: 0,
  rangeRate: [null, null, null, null],
  damage: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" },
  desperate: 0,
  overkill: false,
  magnetism: { grade: 0 },
  heal: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" },
  manifest: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0 },
  manifestDome: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, duration: 3 },
  manifestResistance: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, haltValues: [1, 1, 1, 1] },
  tagUses: { current: 0, max: 0 },
  sections: { current: 0, max: 0 },
  aoe: { value: 0, type: "" },
  customTag: { id: "", name: "", value: "" },
  customTags: [],
  targetingType: "",
  defense: {
    responses: [],
    effectiveness: {
      melee: { mosPer: 0, accuracyPenalty: 0 },
      projectile: { mosPer: 0, accuracyPenalty: 0 },
      normal: { mosPer: 0, accuracyPenalty: 0 },
      smite: { mosPer: 0, accuracyPenalty: 0 },
      aoe: { mosPer: 0, accuracyPenalty: 0 },
      areaBlast: { mosPer: 0, accuracyPenalty: 0 },
      tileBlast: { mosPer: 0, accuracyPenalty: 0 }
    },
    block: false,
    contactless: false,
    blockType: "Shield",
    shieldArm: "LeftArm",
    hardness: 0,
    hp: 0,
    maxHp: 40,
    masteryBonus: false,
    alwaysBraced: false,
    appliesDebuff: false,
    debuffToHit: 0,
    appliesBefore: false
  },
  reach: 0,
  stability: false,
  strengthen: false,
  self: false,
  tagOrder: []
});

function clone(value) {
  if (value === undefined) return undefined;
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (error) {
    return false;
  }
}

function nextId(createId, fallbackPrefix = "entry") {
  const id = String(createId?.() ?? "").trim();
  return id || `${fallbackPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function withDefaults(value, defaults) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? clone(value) : {};
  for (const [key, fallback] of Object.entries(defaults)) {
    if (!hasOwn(source, key)) source[key] = clone(fallback);
  }
  return source;
}

function normalizeCustomTags(value, createId) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((tag) => {
    const normalized = withDefaults(tag, { id: "", name: "", value: "" });
    let id = String(normalized.id ?? "").trim();
    if (!id || seen.has(id)) id = nextId(createId, "custom");
    seen.add(id);
    return {
      ...normalized,
      id,
      name: String(normalized.name ?? "").trim(),
      value: String(normalized.value ?? "").trim()
    };
  }).filter((tag) => !!tag.name);
}

function normalizeMechanics(value, createId) {
  const mechanics = withDefaults(value, SKILL_MECHANIC_DEFAULTS);
  mechanics.customTags = normalizeCustomTags(mechanics.customTags, createId);
  const first = mechanics.customTags[0];
  mechanics.customTag = first ? { ...first } : withDefaults(mechanics.customTag, SKILL_MECHANIC_DEFAULTS.customTag);
  return mechanics;
}

function normalizeLayout(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row?.kind !== "group").map((row) => {
    const normalized = withDefaults(row, { kind: "tag", id: "", key: "" });
    delete normalized.label;
    delete normalized.note;
    return normalized;
  });
}

function normalizeRules(value) {
  if (!Array.isArray(value)) return [];
  return value.map((rule) => withDefaults(rule, {
    id: "", label: "", when: "always", tagKeys: [], effectLinkIds: [], note: ""
  }));
}

function normalizeEffectLinks(value) {
  if (!Array.isArray(value)) return [];
  return value.map(link => withDefaults(normalizeLegacySkillEffectLink(link), {
    id: "", effectId: "", tagKey: "", when: "always", recipient: "self", application: "automatic"
  }));
}

export function normalizeLegacySkillEffectLink(link) {
  const result = clone(link ?? {});
  const when = result.when ?? "always";
  const application = result.application ?? "manual";
  if (when === "passive") return { ...result, recipient: "self", application: "automatic" };
  if (when === "manual") return { ...result, when: "always", application: "offer" };
  if (application === "manual") return {
    ...result,
    when: when === "always" ? "success" : when,
    application: "automatic"
  };
  return result;
}

function normalizeRollOverrides(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const overrides = {};
  for (const key of ROLL_OVERRIDE_KEYS) {
    if (hasOwn(source, key)) overrides[key] = clone(source[key]);
  }
  return overrides;
}

function normalizeUsage(value, { createId, seenIds }) {
  const usage = withDefaults(value, {
    id: "",
    name: "",
    resolution: "legacy",
    mechanics: {},
    rollOverrides: {},
    counterScopes: { tagUses: "shared", sections: "shared" },
    layout: [],
    rules: [],
    effectLinks: []
  });
  let id = String(usage.id ?? "").trim();
  if (!id || id === "base" || seenIds.has(id)) {
    const candidate = nextId(createId, "usage");
    id = candidate;
    let suffix = 2;
    while (!id || id === "base" || seenIds.has(id)) id = `${candidate}-${suffix++}`;
  }
  seenIds.add(id);
  usage.id = id;
  usage.name = String(usage.name ?? "").trim();
  delete usage.description;
  usage.mechanics = normalizeMechanics(usage.mechanics, createId);
  usage.rollOverrides = normalizeRollOverrides(usage.rollOverrides);
  delete usage.replaceSharedTagTypes;
  usage.counterScopes = withDefaults(usage.counterScopes, { tagUses: "shared", sections: "shared" });
  for (const pool of ["tagUses", "sections"]) {
    usage.counterScopes[pool] = usage.counterScopes[pool] === "local" ? "local" : "shared";
  }
  usage.layout = normalizeLayout(usage.layout);
  usage.rules = normalizeRules(usage.rules);
  usage.effectLinks = normalizeEffectLinks(usage.effectLinks);
  delete usage.bindings;
  return usage;
}

export function normalizeSkillEntry(value, { collection = "skills", createId } = {}) {
  if (!COLLECTIONS.has(collection)) throw new Error(`Unsupported Peasant entry collection: ${collection}`);
  const entry = withDefaults(value, {
    id: "",
    type: "skill",
    specialGrade: 0,
    class: 1,
    rank: "0",
    usesMax: 0,
    usesCurrent: 0,
    name: "",
    img: "",
    effectIds: [],
    tohit: null,
    accuracy: null,
    indent: 0,
    description: "",
    category: "",
    weaponType: "",
    defenseType: "",
    trickType: "",
    signatureType: "",
    gateType: "",
    characteristics: [],
    characteristicMode: "single",
    signatureUsage: { duressUses: false, duressCurrent: 0, duressMax: 0 },
    defaultUsageId: "base",
    baseUsage: {
      name: "Default", resolution: "legacy", layout: [], rules: [], effectLinks: []
    },
    usages: []
  });

  entry.id = String(entry.id ?? "").trim() || nextId(createId, collection === "skills" ? "skill" : "combat");
  entry.type = normalizeSkillTypeForCategory(entry.type, entry.category);
  delete entry.sig;
  Object.assign(entry, normalizeMechanics(entry, createId));
  entry.effectIds = Array.isArray(entry.effectIds) ? [...entry.effectIds] : [];
  entry.weaponType = String(entry.weaponType ?? "").trim();
  entry.defenseType = String(entry.defenseType ?? "").trim();
  entry.trickType = String(entry.trickType ?? "").trim();
  entry.signatureType = String(entry.signatureType ?? "").trim();
  entry.gateType = String(entry.gateType ?? "").trim();
  delete entry.source;
  delete entry.sourceProperties;
  entry.characteristics = Array.isArray(entry.characteristics) ? [...entry.characteristics] : [];
  const signatureUsage = entry.signatureUsage;
  entry.signatureUsage = withDefaults(signatureUsage, {
    duressUses: !!signatureUsage?.duressEnabled, duressCurrent: 0, duressMax: 0
  });
  delete entry.signatureUsage.duressEnabled;
  delete entry.signatureUsage.label;
  delete entry.signatureUsage.note;
  if (Array.isArray(entry.layout)) entry.layout = normalizeLayout(entry.layout);
  delete entry.sharedTagTypes;
  entry.baseUsage = withDefaults(entry.baseUsage, {
    name: "Default", resolution: "legacy", layout: [], rules: [], effectLinks: []
  });
  entry.baseUsage.name = String(entry.baseUsage.name ?? "").trim();
  delete entry.baseUsage.description;
  entry.baseUsage.layout = normalizeLayout(entry.baseUsage.layout);
  entry.baseUsage.rules = normalizeRules(entry.baseUsage.rules);
  entry.baseUsage.effectLinks = normalizeEffectLinks(entry.baseUsage.effectLinks);
  delete entry.baseUsage.bindings;

  const seenIds = new Set(["base"]);
  entry.usages = Array.isArray(entry.usages)
    ? entry.usages.map((usage) => normalizeUsage(usage, { createId, seenIds }))
    : [];
  entry.defaultUsageId = String(entry.defaultUsageId ?? "base").trim() || "base";
  if (entry.defaultUsageId !== "base" && !entry.usages.some((usage) => usage.id === entry.defaultUsageId)) {
    entry.defaultUsageId = "base";
  }
  return entry;
}

export function resolveSkillUsage(value, requestedUsageId) {
  const entry = clone(value);
  const usageId = requestedUsageId ?? entry.defaultUsageId ?? "base";
  if (usageId === "base") {
    return {
      ok: true,
      usageId: "base",
      usage: { id: "base", ...clone(entry.baseUsage ?? {}) },
      data: entry
    };
  }

  const usage = entry.usages?.find((candidate) => candidate.id === usageId);
  if (!usage) return { ok: false, error: `Usage ${usageId} is unavailable.` };

  const data = normalizeMechanics(usage.mechanics);
  for (const key of ROLL_OVERRIDE_KEYS) {
    data[key] = hasOwn(usage.rollOverrides, key) ? clone(usage.rollOverrides[key]) : clone(entry[key]);
  }
  for (const key of [
    "id", "type", "specialGrade", "class", "rank", "usesMax", "usesCurrent", "name", "img",
    "effectIds", "indent", "description", "category", "weaponType", "defenseType", "trickType", "signatureType",
    "gateType", "signatureUsage"
  ]) {
    data[key] = clone(entry[key]);
  }
  data.resolution = usage.resolution;
  data.layout = clone(usage.layout);
  data.rules = clone(usage.rules);
  data.effectLinks = clone(usage.effectLinks);
  if (usage.counterScopes?.tagUses !== "local") data.tagUses = clone(entry.tagUses);
  if (usage.counterScopes?.sections !== "local") data.sections = clone(entry.sections);
  return { ok: true, usageId, usage: clone(usage), data };
}

function remapUsageIds(usage, createId) {
  const freshId = (prefix, seen) => {
    const candidate = nextId(createId, prefix);
    let id = candidate;
    let suffix = 2;
    while (seen.has(id)) id = `${candidate}-${suffix++}`;
    seen.add(id);
    return id;
  };
  const customIds = new Set(usage.mechanics.customTags.map(tag => tag.id).filter(Boolean));
  const customMap = new Map();
  usage.mechanics.customTags = usage.mechanics.customTags.map((tag) => {
    const id = freshId("custom", customIds);
    customMap.set(tag.id, id);
    return { ...tag, id };
  });
  usage.mechanics.customTag = usage.mechanics.customTags[0]
    ? { ...usage.mechanics.customTags[0] }
    : clone(SKILL_MECHANIC_DEFAULTS.customTag);

  const linkIds = new Set(usage.effectLinks.map(link => link.id).filter(Boolean));
  const linkMap = new Map();
  usage.effectLinks = usage.effectLinks.map((link) => {
    const id = freshId("link", linkIds);
    linkMap.set(link.id, id);
    const customTagId = link.tagKey?.startsWith("custom:") ? link.tagKey.slice(7) : "";
    return { ...link, id, tagKey: customMap.has(customTagId) ? `custom:${customMap.get(customTagId)}` : link.tagKey };
  });
  usage.layout = usage.layout.map((row) => ({
    ...row,
    key: row.key?.startsWith("custom:") ? `custom:${customMap.get(row.key.slice(7)) ?? row.key.slice(7)}` : row.key
  }));
  const ruleIds = new Set(usage.rules.map(rule => rule.id).filter(Boolean));
  usage.rules = usage.rules.map((rule) => ({
    ...rule,
    id: freshId("rule", ruleIds),
    tagKeys: rule.tagKeys.map((key) => key.startsWith("custom:") ? `custom:${customMap.get(key.slice(7)) ?? key.slice(7)}` : key),
    ...(rule.editorTagKey?.startsWith("custom:") ? {
      editorTagKey: `custom:${customMap.get(rule.editorTagKey.slice(7)) ?? rule.editorTagKey.slice(7)}`
    } : {}),
    effectLinkIds: rule.effectLinkIds.map((id) => linkMap.get(id) ?? id)
  }));
  return usage;
}

export function duplicateSkillUsage(value, usageId, { createId } = {}) {
  const entry = clone(value);
  const resolved = resolveSkillUsage(entry, usageId);
  if (!resolved.ok) return { ...resolved, entry };

  const source = usageId === "base"
    ? {
        id: "base",
        name: entry.baseUsage?.name || entry.name || "Default",
        resolution: entry.baseUsage?.resolution || "legacy",
        mechanics: Object.fromEntries(Object.keys(SKILL_MECHANIC_DEFAULTS).map((key) => [key, clone(entry[key])])),
        rollOverrides: {},
        counterScopes: { tagUses: "shared", sections: "shared" },
        layout: clone(entry.baseUsage?.layout ?? []),
        rules: clone(entry.baseUsage?.rules ?? []),
        effectLinks: clone(entry.baseUsage?.effectLinks ?? [])
      }
    : clone(resolved.usage);
  source.id = nextId(createId, "usage");
  source.name = `${source.name || "Usage"} (Copy)`;
  const usage = remapUsageIds(normalizeUsage(source, { createId, seenIds: new Set(["base", ...entry.usages.map((item) => item.id)]) }), createId);
  if (usage.counterScopes.tagUses === "local") usage.mechanics.tagUses.current = 0;
  if (usage.counterScopes.sections === "local") usage.mechanics.sections.current = 0;
  entry.usages.push(usage);
  return { ok: true, entry, usageId: usage.id };
}

function getSkillUsage(entry, usageId) {
  if (usageId === "base") return entry.baseUsage;
  return entry.usages?.find((usage) => usage.id === usageId) ?? null;
}

function normalizeUsageName(value) {
  return String(value ?? "").trim();
}

export function addSkillUsage(value, { name = "New Usage", createId } = {}) {
  const entry = clone(value);
  entry.usages = Array.isArray(entry.usages) ? entry.usages : [];
  const seenIds = new Set(["base", ...entry.usages.map((usage) => String(usage?.id ?? "").trim()).filter(Boolean)]);
  const usage = normalizeUsage({ name: normalizeUsageName(name) }, { createId, seenIds });
  entry.usages.push(usage);
  return { ok: true, entry, usageId: usage.id };
}

export function renameSkillUsage(value, usageId, name) {
  const entry = clone(value);
  const usage = getSkillUsage(entry, usageId);
  if (!usage) return { ok: false, entry, error: `Usage ${usageId} is unavailable.` };
  usage.name = normalizeUsageName(name);
  return { ok: true, entry, usageId };
}

export function setDefaultSkillUsage(value, usageId) {
  const entry = clone(value);
  if (!getSkillUsage(entry, usageId)) {
    return { ok: false, entry, error: `Usage ${usageId} is unavailable.` };
  }
  entry.defaultUsageId = usageId;
  return { ok: true, entry, usageId };
}

export function deleteSkillUsage(value, usageId, { replacementDefaultId = null } = {}) {
  const entry = clone(value);
  if (usageId === "base") return { ok: false, entry, error: "Base usage cannot be deleted." };
  const index = entry.usages?.findIndex((usage) => usage.id === usageId) ?? -1;
  if (index < 0) return { ok: false, entry, error: `Usage ${usageId} is unavailable.` };
  if (entry.defaultUsageId === usageId && replacementDefaultId !== "base") {
    return { ok: false, entry, error: "Confirm Base as the replacement default before deleting this usage." };
  }
  entry.usages.splice(index, 1);
  if (entry.defaultUsageId === usageId) entry.defaultUsageId = "base";
  return { ok: true, entry, usageId };
}

export function clearSkillUsage(value, usageId) {
  const entry = clone(value);
  const usage = getSkillUsage(entry, usageId);
  if (!usage) return { ok: false, entry, error: `Usage ${usageId} is unavailable.` };

  if (usageId === "base") {
    for (const [key, fallback] of Object.entries(SKILL_MECHANIC_DEFAULTS)) entry[key] = clone(fallback);
    if (Array.isArray(entry.layout)) entry.layout = [];
    entry.baseUsage = {
      ...entry.baseUsage,
      resolution: "legacy",
      layout: [],
      rules: [],
      effectLinks: []
    };
    delete entry.baseUsage.description;
  } else {
    const name = usage.name;
    Object.assign(usage, normalizeUsage({ id: usage.id, name }, {
      createId: null,
      seenIds: new Set(["base"])
    }));
  }
  return { ok: true, entry, usageId };
}

const SKILL_EFFECT_LINK_EVENTS = new Set(["always", "success", "failure", "hit", "passive"]);
const SKILL_EFFECT_LINK_RECIPIENTS = new Set(["self", "target"]);
const SKILL_EFFECT_LINK_APPLICATIONS = new Set(["automatic", "offer"]);
const PRE_USE_SKILL_TAGS = new Set(["resourceCosts", "tagUses", "sections", "speed"]);

function getSkillEffectLinkTagKeys(entry, usageId) {
  const keys = new Set();
  for (const owner of [entry, entry?.baseUsage, usageId === "base" ? null : getSkillUsage(entry, usageId)]) {
    for (const row of owner?.layout ?? []) {
      const key = String(row?.key ?? "").trim();
      if (row?.kind === "tag" && key) keys.add(key);
    }
  }
  return keys;
}

export function setSkillTagCondition(value, usageId, rawTagKey, { when = "always", limitNote = "" } = {}, { createId } = {}) {
  const entry = clone(value);
  const usage = getSkillUsage(entry, usageId);
  const tagKey = String(rawTagKey ?? "").trim();
  const condition = String(when ?? "always").trim().toLowerCase();
  const note = String(limitNote ?? "").trim();
  if (!usage || !getSkillEffectLinkTagKeys(entry, usageId).has(tagKey)) {
    return { ok: false, entry, error: `Tag ${tagKey} is unavailable in this usage.` };
  }
  if (condition === "passive" || !SKILL_EFFECT_LINK_EVENTS.has(condition)) {
    return { ok: false, entry, error: `Unsupported tag condition: ${condition}.` };
  }
  if (PRE_USE_SKILL_TAGS.has(tagKey) && ["success", "failure", "hit"].includes(condition)) {
    return { ok: false, entry, error: `${tagKey} is a pre-use cost or timing tag; it cannot wait for a successful check, failed check, or hit.` };
  }
  const previous = Array.isArray(usage.rules) ? usage.rules : [];
  const rules = previous.filter(rule => rule?.editorTagKey !== tagKey);
  const ids = new Set(rules.map(rule => String(rule?.id || "")).filter(Boolean));
  const addRule = (gate, limit = "") => {
    let id;
    do id = nextId(createId, "rule"); while (ids.has(id));
    ids.add(id);
    rules.push({ id, label: "", when: gate, tagKeys: [tagKey], effectLinkIds: [], note: limit, editorTagKey: tagKey });
  };
  if (condition !== "always") addRule(condition);
  if (note) addRule("manual", note);
  usage.rules = rules;
  return { ok: true, changed: !valuesEqual(previous, rules), entry, usageId, tagKey };
}

function normalizeSkillEffectLinkInput(link, id) {
  const when = String(link?.when ?? "success").trim().toLowerCase();
  return {
    id,
    effectId: String(link?.effectId ?? "").trim(),
    tagKey: String(link?.tagKey ?? "").trim(),
    when,
    recipient: when === "passive" ? "self" : String(link?.recipient ?? "self").trim().toLowerCase(),
    application: when === "passive" ? "automatic" : String(link?.application ?? "automatic").trim().toLowerCase()
  };
}

function sameSkillEffectLink(left, right) {
  return ["effectId", "tagKey", "when", "recipient", "application"]
    .every(key => left?.[key] === right?.[key]);
}

export function upsertSkillEffectLink(value, usageId, link, { createId } = {}) {
  const entry = clone(value);
  const usage = getSkillUsage(entry, usageId);
  if (!usage) return { ok: false, changed: false, entry, error: `Usage ${usageId} is unavailable.` };

  if (!Array.isArray(usage.effectLinks)) usage.effectLinks = [];
  const requestedId = String(link?.id ?? "").trim();
  const currentIndex = requestedId
    ? usage.effectLinks.findIndex(candidate => String(candidate?.id ?? "").trim() === requestedId)
    : -1;
  if (requestedId && currentIndex < 0) {
    return { ok: false, changed: false, entry, error: `Effect link ${requestedId} is unavailable.` };
  }

  const seenIds = new Set(usage.effectLinks.map(candidate => String(candidate?.id ?? "").trim()).filter(Boolean));
  let linkId = requestedId;
  if (!linkId) {
    do linkId = nextId(createId, "link"); while (seenIds.has(linkId));
  }
  const normalized = normalizeSkillEffectLinkInput(link, linkId);
  if (!normalized.effectId) {
    return { ok: false, changed: false, entry, error: "An Actor effect definition is required." };
  }
  if (normalized.tagKey && !getSkillEffectLinkTagKeys(entry, usageId).has(normalized.tagKey)) {
    return { ok: false, changed: false, entry, error: `Tag ${normalized.tagKey} is unavailable in this usage.` };
  }
  if (!SKILL_EFFECT_LINK_EVENTS.has(normalized.when)) {
    return { ok: false, changed: false, entry, error: `Unsupported effect condition: ${normalized.when}` };
  }
  if (PRE_USE_SKILL_TAGS.has(normalized.tagKey) && ["success", "failure", "hit"].includes(normalized.when)) {
    return { ok: false, changed: false, entry, error: `${normalized.tagKey} is a pre-use cost or timing tag; it cannot wait for a successful check, failed check, or hit.` };
  }
  if (!SKILL_EFFECT_LINK_RECIPIENTS.has(normalized.recipient)) {
    return { ok: false, changed: false, entry, error: `Unsupported effect recipient: ${normalized.recipient}` };
  }
  if (!SKILL_EFFECT_LINK_APPLICATIONS.has(normalized.application)) {
    return { ok: false, changed: false, entry, error: `Unsupported effect application: ${normalized.application}` };
  }
  if (usage.effectLinks.some((candidate, index) => index !== currentIndex
    && sameSkillEffectLink(normalizeSkillEffectLinkInput(candidate, candidate?.id), normalized))) {
    return { ok: false, changed: false, entry, error: "This effect is already linked with the same settings." };
  }

  const previous = currentIndex < 0 ? null : usage.effectLinks[currentIndex];
  if (currentIndex < 0) usage.effectLinks.push(normalized);
  else usage.effectLinks[currentIndex] = normalized;
  return {
    ok: true,
    changed: !valuesEqual(previous, normalized),
    entry,
    usageId,
    linkId
  };
}

export function removeSkillEffectLink(value, usageId, rawLinkId) {
  const entry = clone(value);
  const usage = getSkillUsage(entry, usageId);
  if (!usage) return { ok: false, changed: false, entry, error: `Usage ${usageId} is unavailable.` };
  const linkId = String(rawLinkId ?? "").trim();
  const current = Array.isArray(usage.effectLinks) ? usage.effectLinks : [];
  if (!linkId || !current.some(link => String(link?.id ?? "").trim() === linkId)) {
    return { ok: false, changed: false, entry, error: `Effect link ${linkId} is unavailable.` };
  }
  usage.effectLinks = current.filter(link => String(link?.id ?? "").trim() !== linkId);
  usage.rules = Array.isArray(usage.rules) ? usage.rules.map(rule => ({
    ...rule,
    effectLinkIds: Array.isArray(rule?.effectLinkIds)
      ? rule.effectLinkIds.filter(candidate => candidate !== linkId)
      : []
  })) : [];
  return { ok: true, changed: true, entry, usageId, linkId };
}

export function removeSkillEffectReferences(value, rawEffectId) {
  const entry = clone(value);
  const effectId = String(rawEffectId ?? "").trim();
  if (!effectId) return { changed: false, entry };

  const originalEffectIds = Array.isArray(entry.effectIds) ? entry.effectIds : [];
  entry.effectIds = originalEffectIds.filter(candidate => String(candidate ?? "").trim() !== effectId);
  let changed = entry.effectIds.length !== originalEffectIds.length;
  for (const usage of [entry.baseUsage, ...(Array.isArray(entry.usages) ? entry.usages : [])]) {
    if (!usage) continue;
    const links = Array.isArray(usage.effectLinks) ? usage.effectLinks : [];
    const removedIds = new Set(links
      .filter(link => String(link?.effectId ?? "").trim() === effectId)
      .map(link => String(link?.id ?? "").trim())
      .filter(Boolean));
    if (removedIds.size === 0) continue;
    changed = true;
    usage.effectLinks = links.filter(link => !removedIds.has(String(link?.id ?? "").trim()));
    usage.rules = Array.isArray(usage.rules) ? usage.rules.map(rule => ({
      ...rule,
      effectLinkIds: Array.isArray(rule?.effectLinkIds)
        ? rule.effectLinkIds.filter(linkId => !removedIds.has(linkId))
        : []
    })) : [];
  }
  return { changed, entry, effectId };
}

export function setSkillUsageCounterScope(value, usageId, pool, scope) {
  const entry = clone(value);
  if (!["tagUses", "sections"].includes(pool) || !["shared", "local"].includes(scope)) {
    return { ok: false, entry, error: "Invalid usage counter scope." };
  }
  const usage = entry.usages?.find(candidate => candidate.id === usageId);
  if (!usage) return { ok: false, entry, error: `Usage ${usageId} is unavailable.` };
  usage.counterScopes ??= { tagUses: "shared", sections: "shared" };
  usage.mechanics ??= {};
  if (scope === "local" && usage.counterScopes[pool] !== "local") usage.mechanics[pool] = clone(entry[pool]);
  usage.counterScopes[pool] = scope;
  return { ok: true, entry, usageId, pool, scope };
}

function numberValue(value, fallback = 0, { min = null } = {}) {
  const parsed = Number.parseInt(value, 10);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return min === null ? normalized : Math.max(min, normalized);
}

function layoutOwner(data) {
  if (Array.isArray(data?.layout)) return data;
  if (data?.baseUsage && typeof data.baseUsage === "object") {
    if (!Array.isArray(data.baseUsage.layout)) data.baseUsage.layout = [];
    return data.baseUsage;
  }
  data.layout = [];
  return data;
}

function tagKeyFor(tagType, customId = null) {
  return tagType === "custom" ? `custom:${String(customId ?? "").trim()}` : tagType;
}

function ensureTagLayoutRow(data, key) {
  if (!key || key === "custom:") return;
  const owner = layoutOwner(data);
  if (!owner.layout.some(row => row?.kind === "tag" && row.key === key)) {
    owner.layout.push({ kind: "tag", key });
  }
}

function removeTagReferences(data, key) {
  const owner = layoutOwner(data);
  owner.layout = owner.layout.filter(row => !(row?.kind === "tag" && row.key === key));
  const clear = (scope) => {
    if (!scope) return;
    if (Array.isArray(scope.rules)) {
      scope.rules = scope.rules.filter(rule => rule?.editorTagKey !== key).map(rule => ({
        ...rule,
        tagKeys: Array.isArray(rule?.tagKeys) ? rule.tagKeys.filter(candidate => candidate !== key) : []
      }));
    }
    if (Array.isArray(scope.effectLinks)) {
      scope.effectLinks = scope.effectLinks.map(link => link?.tagKey === key ? { ...link, tagKey: "" } : link);
    }
  };
  clear(owner);
  if (data.baseUsage && data.baseUsage !== owner) clear(data.baseUsage);
  for (const usage of data.usages ?? []) {
    if (!usage?.layout?.some(row => row?.kind === "tag" && row.key === key)) clear(usage);
  }
}

function syncTagOrder(data, tagType, { remove = false } = {}) {
  if (!Array.isArray(data.tagOrder)) data.tagOrder = [];
  if (remove && tagType !== "custom") data.tagOrder = data.tagOrder.filter(type => type !== tagType);
  if (!remove && !data.tagOrder.includes(tagType)) data.tagOrder.push(tagType);
}

function resetTag(data, tagType, customId) {
  switch (tagType) {
    case "description": data.description = ""; break;
    case "resourceCosts": data.resourceCosts = []; break;
    case "speed": data.speed = clone(SKILL_MECHANIC_DEFAULTS.speed); break;
    case "staminaCost": data.staminaCost = 0; break;
    case "attunementCost": data.attunementCost = 0; break;
    case "range": data.range = 0; break;
    case "rangeRate": data.rangeRate = clone(SKILL_MECHANIC_DEFAULTS.rangeRate); break;
    case "damage": data.damage = clone(SKILL_MECHANIC_DEFAULTS.damage); break;
    case "desperate": data.desperate = 0; break;
    case "overkill": data.overkill = false; break;
    case "magnetism": data.magnetism = clone(SKILL_MECHANIC_DEFAULTS.magnetism); break;
    case "heal": data.heal = clone(SKILL_MECHANIC_DEFAULTS.heal); break;
    case "manifest": data.manifest = clone(SKILL_MECHANIC_DEFAULTS.manifest); break;
    case "manifestDome": data.manifestDome = clone(SKILL_MECHANIC_DEFAULTS.manifestDome); break;
    case "manifestResistance": data.manifestResistance = clone(SKILL_MECHANIC_DEFAULTS.manifestResistance); break;
    case "tagUses": data.tagUses = clone(SKILL_MECHANIC_DEFAULTS.tagUses); break;
    case "sections": data.sections = clone(SKILL_MECHANIC_DEFAULTS.sections); break;
    case "aoe": data.aoe = clone(SKILL_MECHANIC_DEFAULTS.aoe); break;
    case "targetingType":
      data.targetingType = "";
      data.aoe = clone(SKILL_MECHANIC_DEFAULTS.aoe);
      break;
    case "defense": data.defense = createDefaultCombatDefense(); break;
    case "reach": data.reach = 0; break;
    case "stability":
      data.stability = false;
      data.strengthen = false;
      removeTagReferences(data, "strengthen");
      break;
    case "strengthen": data.strengthen = false; break;
    case "custom": {
      const id = String(customId ?? "").trim();
      const tags = getCombatCustomTags(data);
      data.customTags = id ? tags.filter(tag => tag.id !== id) : [];
      syncCombatCustomTags(data);
      break;
    }
    case "self": data.self = false; break;
    default: return false;
  }
  return true;
}

function applyTag(data, tagType, tagData, { mode, customId }) {
  switch (tagType) {
    case "description": data.description = String(tagData.description ?? ""); break;
    case "resourceCosts": data.resourceCosts = Array.isArray(tagData.resourceCosts) ? clone(tagData.resourceCosts) : []; break;
    case "speed":
      data.speed = {
        type: String(tagData.speed?.type ?? ""),
        splitSecondCurrent: numberValue(tagData.speed?.splitSecondCurrent),
        splitSecondMax: numberValue(tagData.speed?.splitSecondMax)
      };
      break;
    case "staminaCost": data.staminaCost = numberValue(tagData.staminaCost); break;
    case "attunementCost": data.attunementCost = numberValue(tagData.attunementCost); break;
    case "range": data.range = numberValue(tagData.range); break;
    case "rangeRate": data.rangeRate = normalizeRangeRateValue(tagData.rangeRate); break;
    case "damage":
    case "heal":
    case "manifest": {
      const value = tagData[tagType] ?? {};
      data[tagType] = {
        enabled: true,
        diceCount: numberValue(value.diceCount),
        diceValue: numberValue(value.diceValue),
        diceBonus: numberValue(value.diceBonus),
        flat: numberValue(value.flat),
        ...(tagType === "damage" || tagType === "heal" ? { type: String(value.type ?? "") } : {})
      };
      break;
    }
    case "manifestDome": {
      const value = tagData.manifestDome ?? {};
      data.manifestDome = {
        enabled: true,
        diceCount: numberValue(value.diceCount),
        diceValue: numberValue(value.diceValue),
        diceBonus: numberValue(value.diceBonus),
        flat: numberValue(value.flat),
        duration: numberValue(value.duration, 3, { min: 1 })
      };
      break;
    }
    case "manifestResistance": {
      const value = tagData.manifestResistance ?? {};
      data.manifestResistance = {
        enabled: true,
        diceCount: numberValue(value.diceCount),
        diceValue: numberValue(value.diceValue),
        diceBonus: numberValue(value.diceBonus),
        flat: numberValue(value.flat),
        haltValues: normalizeHaltValues(value.haltValues ?? [1, 1, 1, 1])
      };
      break;
    }
    case "desperate": data.desperate = numberValue(tagData.desperate); break;
    case "overkill": data.overkill = true; break;
    case "magnetism": data.magnetism = normalizeCombatMagnetism(tagData.magnetism); break;
    case "tagUses":
    case "sections": {
      const value = tagData[tagType] ?? {};
      const max = numberValue(value.max);
      data[tagType] = { current: Math.min(max, numberValue(value.current)), max };
      break;
    }
    case "aoe": data.aoe = { value: numberValue(tagData.aoe?.value), type: String(tagData.aoe?.type ?? "") }; break;
    case "targetingType":
      data.targetingType = normalizeCombatTargetingType(tagData.targetingType) || String(tagData.targetingType ?? "");
      data.aoe = clone(SKILL_MECHANIC_DEFAULTS.aoe);
      break;
    case "defense": data.defense = normalizeCombatDefense(tagData.defense); break;
    case "reach": data.reach = numberValue(tagData.reach); break;
    case "stability": data.stability = true; break;
    case "strengthen":
      if (!data.stability) return "Strengthen requires Stability on this Skill or Notable.";
      data.strengthen = true;
      break;
    case "custom": {
      const name = String(tagData.name ?? "").trim();
      if (!name) return "Custom tags require a name.";
      const value = String(tagData.value ?? "").trim();
      const tags = getCombatCustomTags(data);
      const requestedId = String(customId ?? tagData.id ?? "").trim();
      if (mode === "edit") {
        const index = tags.findIndex(tag => tag.id === requestedId);
        if (index < 0) return "The Custom tag no longer exists.";
        tags[index] = { ...tags[index], name, value };
      } else {
        let id = requestedId || nextId(null, "custom");
        while (tags.some(tag => tag.id === id)) id = nextId(null, "custom");
        tags.push({ id, name, value });
      }
      data.customTags = tags;
      syncCombatCustomTags(data);
      return null;
    }
    case "self": data.self = true; break;
    default: return `Unknown tag type: ${tagType}`;
  }
  return null;
}

export function setSkillTagData(value, rawTagType, tagData = {}, { mode = "add", customId = null } = {}) {
  const original = value && typeof value === "object" ? value : {};
  const data = clone(original);
  const tagType = String(rawTagType ?? "").trim();
  if (!tagType || !["add", "edit", "remove"].includes(mode)) {
    return { ok: false, changed: false, data, error: "Invalid tag operation." };
  }

  if (mode === "remove") {
    if (!resetTag(data, tagType, customId)) return { ok: false, changed: false, data, error: `Unknown tag type: ${tagType}` };
    const key = tagKeyFor(tagType, customId);
    removeTagReferences(data, key);
    if (tagType === "custom" && getCombatCustomTags(data).length > 0) syncTagOrder(data, tagType);
    else syncTagOrder(data, tagType, { remove: true });
  } else {
    const error = applyTag(data, tagType, tagData, { mode, customId });
    if (error) return { ok: false, changed: false, data: clone(original), error };
    const resolvedCustomId = tagType === "custom"
      ? (mode === "edit" ? String(customId ?? tagData.id ?? "") : getCombatCustomTags(data).at(-1)?.id)
      : null;
    ensureTagLayoutRow(data, tagKeyFor(tagType, resolvedCustomId));
    syncTagOrder(data, tagType);
  }

  return { ok: true, changed: !valuesEqual(original, data), data };
}

function layoutRowIdentity(row) {
  return row?.key;
}

export function moveSkillLayoutRow(value, rowId, targetId, { insertAfter = false } = {}) {
  const data = clone(value && typeof value === "object" ? value : {});
  const owner = layoutOwner(data);
  const fromIndex = owner.layout.findIndex(row => layoutRowIdentity(row) === rowId);
  if (fromIndex < 0) return data;
  const [row] = owner.layout.splice(fromIndex, 1);
  let targetIndex = owner.layout.findIndex(candidate => layoutRowIdentity(candidate) === targetId);
  if (targetIndex < 0) targetIndex = owner.layout.length;
  else if (insertAfter) targetIndex += 1;
  owner.layout.splice(targetIndex, 0, row);
  return data;
}
