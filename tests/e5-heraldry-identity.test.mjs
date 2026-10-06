import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareActorIdentityContext } from "../module/data/actor/sheet-display/base.mjs";

const data = {};
prepareActorIdentityContext(data, { system: {
  majorHeraldry: "Generalist", minorHeraldry: "Night Eye", finalHeraldry: "Leon",
  origin: "Grimmstad", specificOrigin: "Soldier"
} });
assert.equal(data.displayMajorHeraldry, "Generalist");
assert.equal(data.displayMinorHeraldry, "Night Eye");
assert.equal(data.displayFinalHeraldry, "Leon");
assert.equal("displayRace" in data, false, "sheet context uses Heraldry names internally");

const custom = {};
prepareActorIdentityContext(custom, { system: {
  majorHeraldry: "Custom", customMajorHeraldry: "River Kin",
  minorHeraldry: "Custom", customMinorHeraldry: "Deep Sight",
  finalHeraldry: "Custom", customFinalHeraldry: "River Clan"
} }, { isEditMode: true, sourceSystem: {
  majorHeraldry: "Generalist", minorHeraldry: "Night Eye",
  finalHeraldry: "Custom", customFinalHeraldry: "Stored Clan"
} });
assert.deepEqual([custom.displayMajorHeraldry, custom.displayMinorHeraldry, custom.displayFinalHeraldry],
  ["River Kin", "Deep Sight", "River Clan"], "view labels use prepared actor values");
assert.equal(custom.customMajorHeraldrySelected, false, "edit selection uses source values");
assert.equal(custom.customMinorHeraldrySelected, false);
assert.equal(custom.customFinalHeraldrySelected, true);
assert.equal(custom.hasCustomIdentitySelection, true);

const customIdentityFields = [
  ["majorHeraldry", "customMajorHeraldry", "displayMajorHeraldry"],
  ["minorHeraldry", "customMinorHeraldry", "displayMinorHeraldry"],
  ["finalHeraldry", "customFinalHeraldry", "displayFinalHeraldry"],
  ["origin", "customOrigin", "displayOrigin"],
  ["specificOrigin", "customSpecificOrigin", "displaySpecificOrigin"]
];
for (const selection of ["Custom", "Other"]) {
  for (const text of [undefined, "", "   ", "\t\n"]) {
    const system = Object.fromEntries(customIdentityFields.flatMap(([field, customField]) => [[field, selection], [customField, text]]));
    const before = structuredClone(system);
    const emptyCustom = {};
    prepareActorIdentityContext(emptyCustom, { system }, { isEditMode: true });
    for (const [field, , displayField] of customIdentityFields) {
      assert.equal(emptyCustom[displayField], "", `${field} with no custom text has no view label`);
    }
    assert.equal(emptyCustom.hasCustomIdentitySelection, true, "blank custom selections remain editable");
    assert.deepEqual(system, before, "hiding blank labels preserves saved identity data");
  }
}
const filledCustomIdentity = {};
prepareActorIdentityContext(filledCustomIdentity, { system: Object.fromEntries(
  customIdentityFields.flatMap(([field, customField]) => [[field, "Custom"], [customField, `  ${field} name  `]])
) });
for (const [field, , displayField] of customIdentityFields) {
  assert.equal(filledCustomIdentity[displayField], `${field} name`, "populated custom identity labels remain visible");
}

assert.equal(data.majorHeraldryGroups.flatMap(group => group.options).length, 18);
assert.equal(data.minorHeraldryGroups.flatMap(group => group.options).length, 27);
assert.deepEqual(data.finalHeraldryOptions.map(option => option.value),
  ["Human", "Eve", "Taru", "Tarfel", "Lupine", "Ursa", "Leon", "Doomi", "Skeever"]);
assert.equal(data.majorHeraldryGroups[0].options[0].value, "Generalist");
assert.equal(data.majorHeraldryGroups[0].options[0].selected, true);
assert.deepEqual(data.minorHeraldryGroups.at(-1).options.map(option => option.value),
  ["Natural Caster", "Black Shadow", "Arbiter"]);
const unknown = {};
prepareActorIdentityContext(unknown, { system: { finalHeraldry: "Legacy Clan" } });
assert.equal(unknown.finalHeraldryOptions.at(-1).selected, true, "unknown saved values remain selectable");
assert.equal(unknown.finalHeraldryOptions.at(-1).value, "Legacy Clan");

class Field { constructor(options) { this.options = options; } }
class SchemaField extends Field { constructor(fields, options) { super(options); this.fields = fields; } }
class ArrayField extends Field { constructor(element, options) { super(options); this.element = element; } }
globalThis.foundry = {
  abstract: { DataModel: class { static migrateData(source) { return structuredClone(source); } } },
  data: {
    fields: { StringField: Field, NumberField: Field, BooleanField: Field, HTMLField: Field,
      ObjectField: Field, TypedObjectField: Field, EmbeddedDataField: Field, SchemaField, ArrayField },
    ActiveEffectTypeDataModel: class {}
  }
};
const { PeasantCharacterModel } = await import("../module/data/actor/character.mjs");
const schema = PeasantCharacterModel.defineSchema();
for (const key of ["majorHeraldry", "minorHeraldry", "finalHeraldry", "customMajorHeraldry", "customMinorHeraldry", "customFinalHeraldry"]) {
  assert.ok(schema[key], `schema declares ${key}`);
}
assert.equal(schema.race, undefined);
assert.equal(schema.customRace, undefined);
assert.equal(schema.majorHeraldry.options.initial, "");
assert.equal(schema.minorHeraldry.options.initial, "");
assert.equal(schema.finalHeraldry.options.initial, "Human");
for (const race of ["Human", "Tarfel", "Legacy Clan", "Custom", "Other"]) {
  const legacy = { race, customRace: "Saved Clan", authored: "keep" };
  const migrated = PeasantCharacterModel.migrateData(legacy);
  assert.equal(migrated.finalHeraldry, race);
  assert.equal(migrated.customFinalHeraldry, "Saved Clan");
  assert.equal(migrated.authored, "keep");
  assert.equal("race" in migrated, false);
  assert.equal("customRace" in migrated, false);
  assert.equal(migrated.majorHeraldry, undefined, "load migration does not invent a Major choice");
  assert.deepEqual(PeasantCharacterModel.migrateData(migrated), migrated);
  assert.equal(legacy.race, race, "the caller's source is not overwritten");
}
assert.equal(PeasantCharacterModel.migrateData({ race: "Human", finalHeraldry: "Eve" }).finalHeraldry, "Eve");
assert.equal(PeasantCharacterModel.migrateData({ customRace: "Old", customFinalHeraldry: "New" }).customFinalHeraldry, "New");

globalThis.ActorDelta = class { static migrateData(source) { return structuredClone(source); } };
const { PeasantActorDelta, configurePeasantActorDelta } = await import("../module/documents/actor-delta.mjs");
const importedDelta = PeasantActorDelta.migrateData({ system: { race: "Custom", customRace: "Imported Clan" } });
assert.deepEqual(importedDelta.system, { finalHeraldry: "Custom", customFinalHeraldry: "Imported Clan" });
assert.deepEqual(PeasantCharacterModel.migrateData({
  finalHeraldry: "Human", customFinalHeraldry: "Base Clan", ...importedDelta.system
}), importedDelta.system, "legacy Scene imports migrate token overrides before merging with their base Actor");
assert.deepEqual(PeasantActorDelta.migrateData({ system: { health: 5 } }).system, { health: 5 });
globalThis.CONFIG = { ActorDelta: {} };
configurePeasantActorDelta();
assert.equal(CONFIG.ActorDelta.documentClass, PeasantActorDelta);

globalThis.ActiveEffect = class {
  static migrateData(source) {
    const data = source;
    if (Array.isArray(data.changes)) {
      data.system = { ...data.system, changes: data.changes };
      delete data.changes;
    }
    return data;
  }
};
const { PeasantActiveEffect } = await import("../module/data/active-effect/_module.mjs");
const oldEffect = { _id: "identity-effect", changes: [
  { key: "system.race", mode: 5, value: "Custom", priority: 20, type: "string" },
  { key: "system.customRace", mode: 5, value: "Transformed Clan" },
  { key: "system.origin", mode: 5, value: "Custom" }
] };
const effect = PeasantActiveEffect.migrateData(structuredClone(oldEffect));
assert.deepEqual(effect.system.changes, oldEffect.changes.map(change => ({ ...change,
  key: change.key.replace("system.customRace", "system.customFinalHeraldry").replace("system.race", "system.finalHeraldry")
})));
assert.equal(oldEffect.changes[0].key, "system.race");
const nativeEffect = { _id: "native-effect", system: { authored: "keep", changes: structuredClone(oldEffect.changes) } };
assert.deepEqual(PeasantActiveEffect.migrateData(structuredClone(nativeEffect)).system, {
  authored: "keep", changes: effect.system.changes
}, "native v14 changes migrate as well as pre-v14 top-level rows");
const embeddedEffectSource = structuredClone(oldEffect);
PeasantActiveEffect.migrateData(embeddedEffectSource);
assert.equal(embeddedEffectSource.system.changes[0].key, "system.finalHeraldry",
  "Foundry embedded document fields retain the passed source and ignore replacement objects");

const { migrateWorldNotableCombatData, PC_WORLD_MIGRATION_VERSION_SETTING } = await import("../module/migration/world.mjs");
let version = 26;
const writes = [];
function document(name, type, system, effects = []) {
  return { name, type, _source: { system, effects }, items: [],
    async update(patch, options) {
      writes.push({ name, patch, options });
      for (const [path, value] of Object.entries(patch)) {
        const key = path.slice("system.".length);
        if (key.startsWith("-=")) delete this._source.system[key.slice(2)];
        else this._source.system[key] = value;
      }
      return this;
    },
    async updateEmbeddedDocuments(type, updates, options) {
      assert.equal(type, "ActiveEffect");
      writes.push({ name, updates, options });
      for (const update of updates) {
        const effect = this._source.effects.find(effect => effect._id === update._id);
        effect.system ??= {};
        effect.system.changes = update["system.changes"];
      }
      return updates.map(update => this._source.effects.find(effect => effect._id === update._id));
    }
  };
}
const actor = document("Actor", "character", { race: "Custom", customRace: "Saved Clan", origin: "Grimmstad" }, [structuredClone(nativeEffect)]);
const loadedActor = document("Loaded Actor", "character", {
  finalHeraldry: "Custom", customFinalHeraldry: "Already migrated on load",
  majorHeraldry: "", minorHeraldry: "", customMajorHeraldry: "", customMinorHeraldry: ""
});
const tokenActor = document("Unlinked", "character", { race: "Ursa" });
const delta = document("Token Delta", undefined, { race: "Custom", customRace: "Token Clan", authored: "keep" });
const mergedTokenActor = document("Merged Unlinked", "character", PeasantCharacterModel.migrateData({
  finalHeraldry: "Human", customFinalHeraldry: "Base Clan", ...delta._source.system
}));
const tokenEffect = { ...structuredClone(nativeEffect), _id: "token-effect" };
const inheritedEffect = { ...structuredClone(nativeEffect), _id: "inherited-effect" };
delta._source.effects = [structuredClone(tokenEffect)];
delta._source.items = [{ _id: "managed-item" }];
mergedTokenActor._source.effects = [tokenEffect, inheritedEffect];
const managedTokenItem = Object.assign(document("Managed Token Item", "equipment", {}, [structuredClone(oldEffect)]), { id: "managed-item" });
const inheritedTokenItem = Object.assign(document("Inherited Token Item", "equipment", {}, [structuredClone(oldEffect)]), { id: "inherited-item" });
mergedTokenActor.items = [managedTokenItem, inheritedTokenItem];
const emptyDelta = document("Inherited Delta", undefined, {});
const loadedDelta = document("Loaded Delta", undefined, { finalHeraldry: "Ursa" });
const inheritedTokenActor = document("Inherited Unlinked", "character", { finalHeraldry: "Human" });
const linkedActor = document("Linked", "character", { race: "Eve" });
const item = document("Item", "equipment", {}, [structuredClone(oldEffect)]);
actor.items = [document("Owned Item", "equipment", {}, [structuredClone(oldEffect)])];
globalThis.game = {
  user: { isGM: true }, actors: [actor, loadedActor], items: [item],
  scenes: [{ tokens: [{ actorLink: false, actor: tokenActor },
    { actorLink: false, actor: mergedTokenActor, delta },
    { actorLink: false, actor: inheritedTokenActor, delta: emptyDelta },
    { actorLink: false, actor: document("Loaded Token", "character", { finalHeraldry: "Ursa" }), delta: loadedDelta },
    { actorLink: true, actor: linkedActor }] }],
  settings: {
    get: (scope, key) => key === PC_WORLD_MIGRATION_VERSION_SETTING ? version : undefined,
    set: async (scope, key, value) => { assert.equal(key, PC_WORLD_MIGRATION_VERSION_SETTING); version = value; }
  }
};
await migrateWorldNotableCombatData();
assert.equal(version, 28);
assert.equal(actor._source.system.finalHeraldry, "Custom");
assert.equal(actor._source.system.customFinalHeraldry, "Saved Clan");
assert.equal(actor._source.system.majorHeraldry, "");
assert.equal(actor._source.system.minorHeraldry, "");
assert.equal(actor._source.system.origin, "Grimmstad");
assert.equal("race" in actor._source.system, false);
assert.equal("customRace" in actor._source.system, false);
assert.equal(tokenActor._source.system.finalHeraldry, "Ursa");
assert.deepEqual(delta._source.system, { finalHeraldry: "Custom", customFinalHeraldry: "Token Clan", authored: "keep" },
  "legacy token overrides migrate from the delta before base Actor values can hide them");
assert.deepEqual(emptyDelta._source.system, {}, "an unlinked token retains inheritance without new identity overrides");
assert.equal(writes.some(write => write.name === "Merged Unlinked" && write.patch), false,
  "write token identity to its delta rather than pinning inherited actor fields");
assert.equal(tokenEffect.system.changes[0].key, "system.finalHeraldry");
assert.equal(inheritedEffect.system.changes[0].key, "system.race", "inherited effects are handled on their base actor only");
assert.equal(writes.some(write => write.name === "Inherited Token Item"), false, "do not adopt inherited token Items");
assert.equal(managedTokenItem._source.effects[0].system.changes[0].key, "system.finalHeraldry");
assert.equal(linkedActor._source.system.race, "Eve", "linked tokens do not duplicate world actor writes");
for (const doc of [actor, item, actor.items[0]]) {
  assert.equal(doc._source.effects[0].system.changes[0].key, "system.finalHeraldry");
  assert.equal(doc._source.effects[0].system.changes[1].key, "system.customFinalHeraldry");
}
for (const write of writes) assert.equal(write.options.diff, false, "canonical fields/rows must be persisted after load migration");
const loadedWrite = writes.find(write => write.name === "Loaded Actor");
assert.equal(loadedWrite.patch["system.-=race"], null, "delete the saved legacy field even if load migration already removed it locally");
assert.equal(loadedWrite.patch["system.-=customRace"], null);
assert.equal(writes.find(write => write.name === "Loaded Delta").patch["system.-=race"], null,
  "persist the renamed delta override even after its load migration has removed the legacy key locally");
const writeCount = writes.length;
await migrateWorldNotableCombatData();
assert.equal(writes.length, writeCount, "a current world does not run migration again");
version = 26;
actor.update = async () => { throw new Error("migration write rejected"); };
const originalError = console.error;
console.error = () => {};
try { await migrateWorldNotableCombatData(); } finally { console.error = originalError; }
assert.equal(version, 26, "a failed write leaves migration retryable");
actor.update = async () => undefined;
console.error = () => {};
try { await migrateWorldNotableCombatData(); } finally { console.error = originalError; }
assert.equal(version, 26, "a silently rejected actor write leaves migration retryable");
actor.update = async () => actor;
actor.updateEmbeddedDocuments = async () => [];
console.error = () => {};
try { await migrateWorldNotableCombatData(); } finally { console.error = originalError; }
assert.equal(version, 26, "a silently rejected effect write leaves migration retryable");

const template = readFileSync(new URL("../templates/actor/character-sheet.html", import.meta.url), "utf8");
const fields = ["majorHeraldry", "minorHeraldry", "finalHeraldry"];
for (const field of fields) assert.match(template, new RegExp(`name="system\\.${field}"`));
for (const label of ["Major Heraldry", "Minor Heraldry", "Final Heraldry"]) assert.ok(template.includes(label));
for (const [field, label] of [["majorHeraldry", "Major Heraldry"], ["minorHeraldry", "Minor Heraldry"]]) {
  const placeholder = template.match(new RegExp(`<option value=""([^>]*)>Select ${label}</option>`))?.[1] ?? "";
  assert.match(placeholder, /\bdisabled\b/, `${label} placeholder is not selectable`);
  assert.match(placeholder, /\bhidden\b/, `${label} placeholder is omitted from the open list`);
  assert.ok(placeholder.includes(`{{#unless source.system.${field}}}selected{{/unless}}`),
    `${label} placeholder is displayed only when no heraldry is saved`);
}
assert.ok(template.indexOf("system.majorHeraldry") < template.indexOf("system.minorHeraldry"));
assert.ok(template.indexOf("system.minorHeraldry") < template.indexOf("system.finalHeraldry"));
assert.ok(template.indexOf("displayMajorHeraldry") < template.indexOf("displayMinorHeraldry"));
assert.ok(template.indexOf("displayMinorHeraldry") < template.indexOf("displayFinalHeraldry"));
assert.ok(template.indexOf("displayFinalHeraldry") < template.indexOf("displayOrigin"));
assert.doesNotMatch(template, /system\.(?:race|customRace)\b|displayRace|customRaceSelected/);
console.log("Heraldry identity and migration tests passed.");
