import assert from "node:assert/strict";

class DataModel {
  static migrateData(source) {
    return { ...source };
  }

  prepareBaseData() {}
}

class DataField {
  constructor(options = {}) {
    this.options = options;
  }
}

class NumberField extends DataField {}
class StringField extends DataField {}
class BooleanField extends DataField {}
class HTMLField extends DataField {}
class ObjectField extends DataField {}

class ArrayField extends DataField {
  constructor(element, options = {}) {
    super(options);
    this.element = element;
  }
}

class SchemaField extends DataField {
  constructor(fields, options = {}) {
    super(options);
    this.fields = fields;
  }
}

class EmbeddedDataField extends DataField {
  constructor(model, options = {}) {
    super(options);
    this.model = model;
  }
}

class TypedObjectField extends DataField {
  constructor(element, options = {}) {
    super(options);
    this.element = element;
  }
}

globalThis.foundry = {
  abstract: { DataModel },
  data: {
    fields: {
      ArrayField,
      BooleanField,
      EmbeddedDataField,
      HTMLField,
      NumberField,
      ObjectField,
      SchemaField,
      StringField,
      TypedObjectField
    }
  }
};
globalThis.game = {
  settings: {
    get: (_scope, key) => key === "sirLocationOptions"
      ? {
          version: 2,
          entries: [
            { key: "sirGrimmstad", label: "Grimmstad" },
            { key: "customSirLocation1", label: "Moonfall" }
          ]
        }
      : undefined
  }
};

const { PeasantCharacterModel } = await import("../module/data/actor/character.mjs");
const schema = PeasantCharacterModel.defineSchema();

assert.ok(schema.devastatingWounds instanceof NumberField, "Devastating Wounds should use NumberField");
assert.deepEqual(schema.devastatingWounds.options, { integer: true, min: 0, initial: 0 });
assert.ok(schema.sirGrimmstad instanceof NumberField, "Built-in SIRs should use NumberField");
assert.ok(schema.customSirs instanceof TypedObjectField, "Custom SIRs should use TypedObjectField");
assert.ok(schema.customSirs.element instanceof NumberField, "Custom SIR values should use NumberField");
assert.deepEqual(
  schema.notableCombats.element.fields.manifestResistance.fields.haltValues?.options?.initial,
  [1, 1, 1, 1],
  "Manifest Resistance should default to one HALT at every location"
);
assert.ok(schema.skills.element.fields.damage instanceof SchemaField, "Skills should share the mechanical tag schema");
assert.ok(schema.skills.element.fields.usages.element.fields.rollOverrides instanceof ObjectField, "Usage overrides should preserve sparse keys");
assert.notEqual(
  schema.skills.element.fields.damage,
  schema.notableCombats.element.fields.damage,
  "Skills and Notables should receive independent field instances"
);
assert.equal(schema.skills.element.fields.category.options.initial, "");
assert.ok(schema.skills.element.fields.defenseType instanceof StringField);
assert.ok(schema.skills.element.fields.trickType instanceof StringField);
assert.ok(schema.skills.element.fields.signatureType instanceof StringField);
assert.equal("sig" in schema.skills.element.fields, false, "Skills schema uses Type as the only Signature state");
assert.equal("sig" in schema.notableCombats.element.fields, false, "Notables schema uses Type as the only Signature state");
assert.equal("label" in schema.skills.element.fields.signatureUsage.fields, false, "Skills schema retires Signature counter labels");
assert.equal("note" in schema.skills.element.fields.signatureUsage.fields, false, "Skills schema retires Signature counter notes");
assert.equal("label" in schema.notableCombats.element.fields.signatureUsage.fields, false, "Notables schema retires Signature counter labels");
assert.equal("note" in schema.notableCombats.element.fields.signatureUsage.fields, false, "Notables schema retires Signature counter notes");
assert.ok(schema.skills.element.fields.signatureUsage.fields.duressUses instanceof BooleanField, "Skills store the Duress Uses switch");
assert.ok(schema.notableCombats.element.fields.signatureUsage.fields.duressUses instanceof BooleanField, "Notables store the Duress Uses switch");
assert.equal("duressEnabled" in schema.skills.element.fields.signatureUsage.fields, false, "Skills retire the legacy Duress switch name");
assert.equal("duressEnabled" in schema.notableCombats.element.fields.signatureUsage.fields, false, "Notables retire the legacy Duress switch name");

assert.deepEqual(
  PeasantCharacterModel.migrateData({
    sirGrimmstad: "+3",
    sirSavonia: "",
    customSirs: { customSirLocation1: "-2" }
  }),
  {
    sirGrimmstad: 3,
    sirSavonia: 0,
    customSirs: { customSirLocation1: -2 }
  },
  "SIR model migration should normalize legacy text values"
);

const legacySignatureData = PeasantCharacterModel.migrateData({
  skills: [
    { category: "martial", type: "Stance", sig: true },
    { category: "magic", type: "Gate", sig: true }
  ],
  notableCombats: [
    { category: "mundane", type: "skill", sig: true }
  ]
});
assert.deepEqual(
  legacySignatureData.skills.map(entry => ({ type: entry.type, hasSig: Object.hasOwn(entry, "sig") })),
  [
    { type: "Signature", hasSig: false },
    { type: "Gate", hasSig: false }
  ],
  "Pre-schema migration consumes legacy Skill Signature booleans into Type"
);
assert.deepEqual(
  legacySignatureData.notableCombats.map(entry => ({ type: entry.type, hasSig: Object.hasOwn(entry, "sig") })),
  [{ type: "Signature", hasSig: false }],
  "Pre-schema migration consumes legacy Notable Signature booleans into Type"
);

const legacySignatureMetadata = PeasantCharacterModel.migrateData({
  skills: [{ signatureUsage: { label: "Daily", note: "After rest", duressEnabled: true, duressCurrent: 1, duressMax: 2 } }],
  notableCombats: [{ signatureUsage: { label: "Scene", note: "On recovery", duressEnabled: false, duressCurrent: 0, duressMax: 0 } }]
});
assert.deepEqual(
  legacySignatureMetadata.skills[0].signatureUsage,
  { duressUses: true, duressCurrent: 1, duressMax: 2 },
  "Pre-schema migration renames the Skill Duress Uses switch and removes retired metadata"
);
assert.deepEqual(
  legacySignatureMetadata.notableCombats[0].signatureUsage,
  { duressUses: false, duressCurrent: 0, duressMax: 0 },
  "Pre-schema migration preserves a disabled Notable Duress Uses switch"
);

const model = Object.assign(Object.create(PeasantCharacterModel.prototype), { customSirs: {} });
model.prepareBaseData();
assert.equal(model.customSirs.customSirLocation1, 0, "Configured custom SIRs should prepare with a numeric zero value");
