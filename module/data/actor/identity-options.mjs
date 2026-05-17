const SYSTEM_ID = "peasant-core";

export const PC_NATIONAL_ORIGINS_SETTING = "nationalOriginOptions";
export const PC_SIR_LOCATIONS_SETTING = "sirLocationOptions";
export const PC_CUSTOM_SIR_LOCATION_VALUES_FLAG = "customSirLocationValues";

const NATIONAL_ORIGIN_SETTINGS_VERSION = 2;
const SIR_LOCATION_SETTINGS_VERSION = 2;

export const DEFAULT_NATIONAL_ORIGINS = Object.freeze([
  Object.freeze({ key: "grimmstad", label: "Grimmstad" }),
  Object.freeze({ key: "savonia", label: "Savonia" }),
  Object.freeze({ key: "royce", label: "Royce" }),
  Object.freeze({ key: "thingollr", label: "Thingollr" }),
  Object.freeze({ key: "garren", label: "Garren" }),
  Object.freeze({ key: "vestinia", label: "Vestinia" }),
  Object.freeze({ key: "theStepps", label: "The Stepps" }),
  Object.freeze({ key: "pirateIsles", label: "Pirate Isles" }),
  Object.freeze({ key: "hearthless", label: "Hearthless" }),
  Object.freeze({ key: "outland", label: "Outland" }),
  Object.freeze({ key: "idenThatWas", label: "Iden-That-Was" }),
  Object.freeze({ key: "winter", label: "Winter" }),
  Object.freeze({ key: "portNoon", label: "Port Noon" })
]);

export const DEFAULT_SIR_LOCATIONS = Object.freeze([
  Object.freeze({ key: "sirGrimmstad", field: "sirGrimmstad", label: "Grimmstad" }),
  Object.freeze({ key: "sirSavonia", field: "sirSavonia", label: "Savonia" }),
  Object.freeze({ key: "sirThingollr", field: "sirThingollr", label: "Thingollr" }),
  Object.freeze({ key: "sirRoyce", field: "sirRoyce", label: "Royce" }),
  Object.freeze({ key: "sirGarren", field: "sirGarren", label: "Garren" }),
  Object.freeze({ key: "sirVestinia", field: "sirVestinia", label: "Vestinia" }),
  Object.freeze({ key: "sirLupine", field: "sirLupine", label: "Lupine" }),
  Object.freeze({ key: "sirLeon", field: "sirLeon", label: "Leon" }),
  Object.freeze({ key: "sirUrsa", field: "sirUrsa", label: "Ursa" }),
  Object.freeze({ key: "sirDoomi", field: "sirDoomi", label: "Doomi" }),
  Object.freeze({ key: "sirSkeever", field: "sirSkeever", label: "Skeever" })
]);

export function registerPeasantCoreIdentitySettings() {
  game.settings.register(SYSTEM_ID, PC_NATIONAL_ORIGINS_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: createSettingValue(DEFAULT_NATIONAL_ORIGINS, NATIONAL_ORIGIN_SETTINGS_VERSION),
    onChange: renderPeasantCoreActorSheets
  });

  game.settings.register(SYSTEM_ID, PC_SIR_LOCATIONS_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: createSettingValue(DEFAULT_SIR_LOCATIONS, SIR_LOCATION_SETTINGS_VERSION),
    onChange: renderPeasantCoreActorSheets
  });
}

export function getDefaultNationalOriginEntries() {
  return normalizeEntries(DEFAULT_NATIONAL_ORIGINS);
}

export function getNationalOriginEntries() {
  return readSettingEntries(PC_NATIONAL_ORIGINS_SETTING, DEFAULT_NATIONAL_ORIGINS, {
    version: NATIONAL_ORIGIN_SETTINGS_VERSION
  });
}

export function getDefaultSirLocationEntries() {
  return normalizeEntries(DEFAULT_SIR_LOCATIONS);
}

export function getSirLocationEntries() {
  return readSettingEntries(PC_SIR_LOCATIONS_SETTING, DEFAULT_SIR_LOCATIONS, {
    version: SIR_LOCATION_SETTINGS_VERSION
  });
}

export async function setNationalOriginEntries(entries) {
  await game.settings.set(
    SYSTEM_ID,
    PC_NATIONAL_ORIGINS_SETTING,
    createSettingValue(normalizeEntries(DEFAULT_NATIONAL_ORIGINS, entries), NATIONAL_ORIGIN_SETTINGS_VERSION)
  );
}

export async function setSirLocationEntries(entries) {
  await game.settings.set(
    SYSTEM_ID,
    PC_SIR_LOCATIONS_SETTING,
    createSettingValue(normalizeEntries(DEFAULT_SIR_LOCATIONS, entries), SIR_LOCATION_SETTINGS_VERSION)
  );
}

export function getNationalOriginOptions(selectedValue) {
  const selected = normalizeComparableLabel(selectedValue);
  const options = getNationalOriginEntries().map((entry) => ({
    key: entry.key,
    label: entry.label,
    value: entry.label,
    selected: !!selected && [entry.label, entry.defaultLabel].some((label) => normalizeComparableLabel(label) === selected)
  }));

  const isCustom = /^(custom|other)$/i.test(String(selectedValue ?? "").trim());
  const hasSelected = options.some((option) => option.selected);
  if (selected && !isCustom && !hasSelected) {
    const legacyValue = String(selectedValue ?? "").trim();
    options.push({
      key: "legacy",
      label: legacyValue,
      value: legacyValue,
      selected: true
    });
  }

  return options;
}

export function getSirLocationRows(actor) {
  const system = actor?.system ?? {};
  const customValues = getCustomSirLocationValues(actor);
  return getSirLocationEntries().map((entry) => ({
    key: entry.key,
    field: entry.field,
    label: entry.label,
    isCustom: !!entry.custom,
    inputName: entry.field ? `system.${entry.field}` : "",
    value: entry.custom ? (customValues[entry.key] ?? "") : (system?.[entry.field] ?? "")
  }));
}

export function getCustomSirLocationValues(actor) {
  const raw = actor?.getFlag?.(SYSTEM_ID, PC_CUSTOM_SIR_LOCATION_VALUES_FLAG);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

export function getNationalOriginKeyForValue(value) {
  const normalized = normalizeComparableLabel(value);
  if (!normalized) return "";

  for (const entry of getNationalOriginEntries()) {
    if ([entry.label, entry.defaultLabel].some((label) => normalizeComparableLabel(label) === normalized)) {
      return entry.key;
    }
  }

  return normalized === "winter" ? "winter" : "";
}

export function resolveNationalOriginLabel(value) {
  const key = getNationalOriginKeyForValue(value);
  if (!key) return String(value ?? "").trim();

  const entry = getNationalOriginEntries().find((origin) => origin.key === key);
  return entry?.label ?? String(value ?? "").trim();
}

export function getDefaultNationalOriginLabel() {
  return getNationalOriginEntries()[0]?.label ?? DEFAULT_NATIONAL_ORIGINS[0].label;
}

export function renderPeasantCoreActorSheets() {
  if (typeof game === "undefined") return;
  const actors = game?.actors?.contents ?? [];
  for (const actor of actors) {
    for (const app of Object.values(actor?.apps ?? {})) {
      app?.render?.(false);
    }
  }
}

function readSettingEntries(settingKey, defaultEntries, { version = null } = {}) {
  if (typeof game === "undefined" || !game?.settings?.get) return normalizeEntries(defaultEntries);

  let settingValue;
  try {
    settingValue = game.settings.get(SYSTEM_ID, settingKey);
  } catch (error) {
    return normalizeEntries(defaultEntries);
  }

  if (version && settingValue?.version !== version) return normalizeEntries(defaultEntries);

  return normalizeEntries(defaultEntries, settingValue);
}

function normalizeEntries(defaultEntries, value = null) {
  const defaultByKey = new Map(defaultEntries.map((entry) => [entry.key, entry]));
  const rawEntries = Array.isArray(value)
    ? value
    : Array.isArray(value?.entries)
      ? value.entries
      : null;

  if (!rawEntries) {
    return defaultEntries.map((defaultEntry) => ({
      ...defaultEntry,
      custom: false,
      defaultLabel: defaultEntry.label,
      label: defaultEntry.label
    }));
  }

  const seenKeys = new Set();
  const normalized = [];
  for (const rawEntry of rawEntries) {
    const key = sanitizeKey(rawEntry?.key);
    if (!key || seenKeys.has(key)) continue;

    const defaultEntry = defaultByKey.get(key);
    if (defaultEntry) {
      normalized.push({
        ...defaultEntry,
        custom: false,
        defaultLabel: defaultEntry.label,
        label: sanitizeLabel(rawEntry.label, defaultEntry.label)
      });
    } else {
      const label = sanitizeLabel(rawEntry?.label, "Custom");
      normalized.push({
        key,
        custom: true,
        defaultLabel: label,
        label
      });
    }

    seenKeys.add(key);
  }

  return normalized;
}

function createSettingValue(entries, version = null) {
  return {
    ...(version ? { version } : {}),
    entries: entries.map((entry) => ({
      key: entry.key,
      label: sanitizeLabel(entry.label, entry.defaultLabel ?? entry.label)
    }))
  };
}

function sanitizeLabel(value, fallback) {
  const label = String(value ?? "").trim();
  return label || String(fallback ?? "").trim();
}

function normalizeComparableLabel(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sanitizeKey(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "");
}
