function compareKeys(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function getFieldClasses() {
  return globalThis.foundry?.data?.fields ?? {};
}

function getSchemaFields(schemaField) {
  const fields = schemaField?.fields;
  return fields && typeof fields === "object" ? fields : null;
}

function getEmbeddedSchema(field) {
  return field?.model?.schema ?? field?.modelClass?.schema ?? null;
}

function isSchemaField(field) {
  const { SchemaField } = getFieldClasses();
  return !!SchemaField && field instanceof SchemaField;
}

function isEmbeddedDataField(field) {
  const { EmbeddedDataField } = getFieldClasses();
  return !!EmbeddedDataField && field instanceof EmbeddedDataField;
}

function isArrayField(field) {
  const { ArrayField } = getFieldClasses();
  return !!ArrayField && field instanceof ArrayField;
}

export const PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES = Object.freeze({
  DYNAMIC: "dynamic",
  STATE: "state",
  UNSUPPORTED: "unsupported"
});

const STATE_ACTIVE_EFFECT_KEY_PATTERNS = Object.freeze([
  /^system\.health\.value$/,
  /^system\.temporaryHp\.(?:value|max)$/,
  /^system\.bolsteredHp$/,
  /^system\.(?:stamina|attunement|capacity|edge|armorCharge|ap|sp)\.value$/,
  /^system\.(?:physical|mental|general)\d+$/,
  /^system\.conditions\.[^.]+$/,
  /^system\.uses\.value$/,
  /^system\.sunder\.current$/
]);

const UNSUPPORTED_ACTIVE_EFFECT_KEY_PATTERNS = Object.freeze([
  /^system\.hp\.grid(?:\.|$)/,
  /^system\.skills(?:\.|$)/,
  /^system\.notableCombats(?:\.|$)/,
  /^system\.edgeResources(?:\.|$)/,
  /^system\.flexibleAdvantages(?:\.|$)/,
  /^system\.flexibleAdvantageDescriptions(?:\.|$)/,
  /^system\.combatMods\.haltBuffs(?:\.|$)/,
  /^system\.(?:haltValues|naturalHaltValues|naturalhaltValues)(?:\.|$)/,
  /\.usesCurrent$/,
  /\.(?:tagUses|sections)\.current$/,
  /\.speed\.splitSecondCurrent$/
]);

const VIRTUAL_DYNAMIC_ACTIVE_EFFECT_KEYS = Object.freeze([
  "system.haltValues.head",
  "system.haltValues.arms",
  "system.haltValues.legs",
  "system.haltValues.torso",
  "system.naturalHaltValues.head",
  "system.naturalHaltValues.arms",
  "system.naturalHaltValues.legs",
  "system.naturalHaltValues.torso",
  "system.naturalhaltValues.head",
  "system.naturalhaltValues.arms",
  "system.naturalhaltValues.legs",
  "system.naturalhaltValues.torso"
]);

const VIRTUAL_DYNAMIC_ACTIVE_EFFECT_KEY_SET = new Set(VIRTUAL_DYNAMIC_ACTIVE_EFFECT_KEYS);

const HIDDEN_ACTIVE_EFFECT_PICKER_KEYS = Object.freeze([
  "system.age",
  "system.alignment",
  "system.ap",
  "system.ap.value",
  "system.ap.max",
  "system.appearance",
  "system.biography",
  "system.bonds",
  "system.currency",
  "system.currency.gp",
  "system.currency.pp",
  "system.currency.rs",
  "system.eyes",
  "system.faith",
  "system.flaws",
  "system.gender",
  "system.hair",
  "system.height",
  "system.imageOffsetX",
  "system.imageOffsetY",
  "system.ideals",
  "system.imageScale",
  "system.personalityTraits",
  "system.portraitHeight",
  "system.portantOffsetX",
  "system.portraitOffsetX",
  "system.portraitOffsetY",
  "system.portraitWidth",
  "system.skin",
  "system.sp",
  "system.sp.value",
  "system.sp.max",
  "system.weight",
  "system.weightUnit"
]);

const HIDDEN_ACTIVE_EFFECT_PICKER_KEY_SET = new Set(
  HIDDEN_ACTIVE_EFFECT_PICKER_KEYS.map(key => key.toLocaleLowerCase())
);

export function getPeasantActiveEffectKeyMetadata(path) {
  const key = String(path ?? "").trim();
  if (!key.startsWith("system.")) {
    return {
      key,
      category: PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.UNSUPPORTED,
      label: "Unsupported",
      title: "Only system data paths are supported."
    };
  }

  if (VIRTUAL_DYNAMIC_ACTIVE_EFFECT_KEY_SET.has(key)) {
    return {
      key,
      category: PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.DYNAMIC,
      label: "Reversible",
      title: "Reversible modifier. It applies while the effect is active and is removed when the effect ends."
    };
  }

  if (UNSUPPORTED_ACTIVE_EFFECT_KEY_PATTERNS.some(pattern => pattern.test(key))) {
    return {
      key,
      category: PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.UNSUPPORTED,
      label: "Unsupported",
      title: "This path is not offered because it is a raw array or derived structure."
    };
  }

  if (STATE_ACTIVE_EFFECT_KEY_PATTERNS.some(pattern => pattern.test(key))) {
    return {
      key,
      category: PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.STATE,
      label: "Applies once",
      title: "One-time state change. It mutates current/source state once and is not removed when the effect ends."
    };
  }

  return {
    key,
    category: PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.DYNAMIC,
    label: "Reversible",
    title: "Reversible modifier. It applies while the effect is active and is removed when the effect ends."
  };
}

export function isPeasantActiveEffectEligibleKey(path) {
  return getPeasantActiveEffectKeyMetadata(path).category !== PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.UNSUPPORTED;
}

export function isPeasantActiveEffectDynamicKey(path) {
  return getPeasantActiveEffectKeyMetadata(path).category === PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.DYNAMIC;
}

export function isPeasantActiveEffectStateKey(path) {
  return getPeasantActiveEffectKeyMetadata(path).category === PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.STATE;
}

export function isPeasantActiveEffectUnsupportedKey(path) {
  return getPeasantActiveEffectKeyMetadata(path).category === PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.UNSUPPORTED;
}

export function isPeasantActiveEffectVirtualDynamicKey(path) {
  return VIRTUAL_DYNAMIC_ACTIVE_EFFECT_KEY_SET.has(String(path ?? "").trim());
}

export function isPeasantActiveEffectFoundryDynamicKey(path) {
  const key = String(path ?? "").trim();
  return isPeasantActiveEffectDynamicKey(key) && !isPeasantActiveEffectVirtualDynamicKey(key);
}

export function isPeasantActiveEffectKeyDisplayed(path) {
  const key = String(path ?? "").trim().toLocaleLowerCase();
  return !!key && !HIDDEN_ACTIVE_EFFECT_PICKER_KEY_SET.has(key);
}

function walkSchema(prefix, schemaField, keys, seen = new Set()) {
  const fields = getSchemaFields(schemaField);
  if (!fields) return;
  if (seen.has(schemaField)) {
    if (isPeasantActiveEffectEligibleKey(prefix)) keys.add(prefix);
    return;
  }

  seen.add(schemaField);
  for (const [fieldKey, field] of Object.entries(fields)) {
    const key = `${prefix}.${fieldKey}`;
    if (isSchemaField(field)) {
      walkSchema(key, field, keys, seen);
      continue;
    }

    if (isEmbeddedDataField(field)) {
      const embeddedSchema = getEmbeddedSchema(field);
      if (embeddedSchema) {
        walkSchema(key, embeddedSchema, keys, seen);
        continue;
      }
    }

    if (isArrayField(field)) continue;
    if (isPeasantActiveEffectEligibleKey(key)) keys.add(key);
  }
  seen.delete(schemaField);
}

function addDataModelKeys(keys, dataModel) {
  const schema = dataModel?.schema;
  if (!schema) return;
  walkSchema("system", schema, keys);
}

function getEffectIterable(collection) {
  if (!collection || typeof collection === "function") return [];
  if (typeof collection[Symbol.iterator] === "function") return collection;
  if (typeof collection.values === "function") return collection.values();
  if (Array.isArray(collection.contents)) return collection.contents;
  return [];
}

export function collectPeasantActiveEffectKeys({
  actorDataModels = globalThis.CONFIG?.Actor?.dataModels ?? {},
  itemDataModels = globalThis.CONFIG?.Item?.dataModels ?? {}
} = {}) {
  const keys = new Set();
  for (const dataModel of Object.values(actorDataModels)) addDataModelKeys(keys, dataModel);
  for (const dataModel of Object.values(itemDataModels)) addDataModelKeys(keys, dataModel);
  for (const key of VIRTUAL_DYNAMIC_ACTIVE_EFFECT_KEYS) keys.add(key);
  return Array.from(keys).filter(isPeasantActiveEffectKeyDisplayed).sort(compareKeys);
}

export function collectPeasantActiveEffectChangeKeys(actor) {
  const keys = new Set();
  const seen = new Set();
  const collections = [
    actor?.effects?.contents ?? actor?.effects,
    actor?.temporaryEffects,
    actor?.appliedEffects
  ];

  for (const collection of collections) {
    for (const effect of getEffectIterable(collection)) {
      if (!effect || seen.has(effect)) continue;
      seen.add(effect);
      if (effect.disabled) continue;
      for (const change of effect.changes ?? effect._source?.changes ?? []) {
        const key = String(change?.key ?? "").trim();
        if (key.startsWith("system.")) keys.add(key);
      }
    }
  }

  return keys;
}
