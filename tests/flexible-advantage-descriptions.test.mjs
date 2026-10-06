import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

class DataField { constructor(options = {}) { this.options = options; } }
class HTMLField extends DataField {}
class ArrayField extends DataField {
  constructor(element, options = {}) { super(options); this.element = element; }
}
class SchemaField extends DataField {
  constructor(fields, options = {}) { super(options); this.fields = fields; }
}
class DataModel { static migrateData(source) { return structuredClone(source); } }
class ApplicationV2 {
  static DEFAULT_OPTIONS = {};
  constructor() { this.closed = false; }
  async close() { this.closed = true; }
}
globalThis.foundry = {
  abstract: { DataModel, TypeDataModel: DataModel },
  data: { fields: new Proxy({ HTMLField, ArrayField, SchemaField }, { get: (target, key) => target[key] ?? DataField }) },
  applications: { api: { ApplicationV2, HandlebarsApplicationMixin: Base => Base } },
  utils: { deepClone: structuredClone, mergeObject: (base, update) => ({ ...base, ...update }) }
};
globalThis.Actor = class {};
globalThis.Hooks = { on() {}, once() {} };
globalThis.game = { peasantCore: {}, settings: { get() {} } };
const errors = [];
globalThis.ui = { notifications: { error: message => errors.push(message) } };

const { PeasantActor } = await import("../module/documents/actor.mjs");
const { PeasantCharacterModel } = await import("../module/data/actor/character.mjs");
const { prepareActorAdvantageContext } = await import("../module/data/actor/sheet-display/advantages.mjs");
const { collectAdvantagesFromSheet } = await import("../module/applications/actor/controls/sheet-listener-helpers.mjs");
const { PeasantDescriptionEditorApp } = await import("../module/applications/actor/controls/description-editor-app.mjs");
const { setupSkillAdvantageDescriptionEditors } = await import("../module/applications/actor/skills/skill-advantage-description-editors.mjs");

function makeActor({ dropWrites = false } = {}) {
  const source = { flexibleAdvantages: ["Notes", "Lore"], flexibleAdvantageDescriptions: ["<p>Notes.</p>", "<p>Lore.</p>"] };
  const actor = Object.assign(Object.create(PeasantActor.prototype), { system: { _source: source }, _source: { system: source } });
  actor.update = async (changes) => {
    if (dropWrites) return actor;
    for (const [key, value] of Object.entries(changes)) {
      source[key.replace(/^system\./, "")] = structuredClone(value);
    }
    return actor;
  };
  return actor;
}

test("HTML declarations never traverse an array of scalar HTML values", () => {
  const manifest = JSON.parse(readFileSync(new URL("../system.json", import.meta.url)));
  const schema = PeasantCharacterModel.defineSchema();
  for (const path of manifest.documentTypes.Actor.character.htmlFields) {
    let field = { fields: schema };
    for (const part of path.split(".")) {
      if (part === "*") {
        assert.ok(!(field instanceof ArrayField && field.element instanceof HTMLField), `${path} triggers Foundry's scalar-array sanitizer bug`);
        field = field.element;
      } else field = field?.fields?.[part];
    }
    assert.ok(field instanceof DataField, `${path} must resolve to a declared field`);
  }
});

test("legacy descriptions migrate without losing content or row alignment", () => {
  const source = { flexibleAdvantages: ["Notes", "Lore"], flexibleAdvantageDescriptions: ["<p>Notes.</p>", ""] };
  const legacyDescriptions = source.flexibleAdvantageDescriptions;
  const migrated = PeasantCharacterModel.migrateData(source);
  assert.deepEqual(migrated.flexibleAdvantageDescriptions, [{ description: "<p>Notes.</p>" }, { description: "" }]);
  assert.deepEqual(source.flexibleAdvantageDescriptions, migrated.flexibleAdvantageDescriptions, "Foundry's loading hook ignores the return value and requires in-place migration");
  assert.deepEqual(PeasantCharacterModel.migrateData(migrated), migrated);
  assert.deepEqual(legacyDescriptions, ["<p>Notes.</p>", ""]);
});

test("the shared writer emits object rows and all row operations preserve descriptions", async () => {
  const actor = makeActor();
  await actor.setPeasantFlexibleAdvantageDescription(0, "<p><strong>Updated.</strong></p>");
  assert.deepEqual(actor._source.system.flexibleAdvantageDescriptions, [{ description: "<p><strong>Updated.</strong></p>" }, { description: "<p>Lore.</p>" }]);
  await actor.setPeasantFlexibleAdvantages(["Renamed", "Lore"], null);
  await actor.addPeasantFlexibleAdvantage();
  await actor.reorderPeasantFlexibleAdvantage(0, 3);
  assert.deepEqual(actor.getPeasantFlexibleAdvantagesForUpdate(), { names: ["Lore", "", "Renamed"], descriptions: ["<p>Lore.</p>", "", "<p><strong>Updated.</strong></p>"] });
  await actor.removePeasantFlexibleAdvantage(1);
  assert.deepEqual(actor.getPeasantFlexibleAdvantagesForUpdate(), { names: ["Lore", "Renamed"], descriptions: ["<p>Lore.</p>", "<p><strong>Updated.</strong></p>"] });
  await actor.setPeasantFlexibleAdvantageDescription(1, "");
  assert.deepEqual(actor.getPeasantFlexibleAdvantagesForUpdate().descriptions, ["<p>Lore.</p>", ""]);
});

test("sheet display and collection read both legacy and current description rows", () => {
  for (const descriptions of [["<p>Notes.</p>"], [{ description: "<p>Notes.</p>" }]]) {
    const actor = { system: { flexibleAdvantages: ["Notes"], flexibleAdvantageDescriptions: descriptions } };
    const context = {};
    prepareActorAdvantageContext(context, actor);
    assert.equal(context.flexibleAdvantages[0].description, "<p>Notes.</p>");
    assert.equal(context.flexibleAdvantages[0].hasDescription, true);
    assert.deepEqual(collectAdvantagesFromSheet({ actor }), { names: ["Notes"], descriptions: ["<p>Notes.</p>"] });
  }
});

test("a dropped write leaves the editor open with its unsaved text and an error", async () => {
  const actor = makeActor({ dropWrites: true });
  const editor = new PeasantDescriptionEditorApp({ editorName: "advantageDescription", save: content => actor.setPeasantFlexibleAdvantageDescription(0, content) });
  const input = { value: "<p>Unsaved text.</p>" };
  editor.element = { querySelector: () => input };
  errors.length = 0;
  const originalError = console.error;
  console.error = () => {};
  try { await editor._saveAndClose(); } finally { console.error = originalError; }
  assert.equal(editor.closed, false);
  assert.equal(input.value, "<p>Unsaved text.</p>");
  assert.equal(errors.length, 1);
  assert.deepEqual(actor.getPeasantFlexibleAdvantagesForUpdate().descriptions, ["<p>Notes.</p>", "<p>Lore.</p>"]);
});

test("the description editor reopens saved HTML and updates sheet fields only after persistence", async () => {
  for (const dropWrites of [false, true]) {
    const actor = makeActor({ dropWrites });
    actor._source.system.flexibleAdvantageDescriptions = [{ description: "<p>Notes.</p>" }, { description: "<p>Lore.</p>" }];
    const hidden = { value: "<p>Notes.</p>", defaultValue: "<p>Notes.</p>" };
    const row = { nodeType: 1, querySelector: () => hidden, getAttribute: () => "0" };
    const button = { closest: selector => selector === ".advantage-desc-btn" ? button : selector === ".advantage-item" ? row : null };
    const listeners = [];
    const root = { nodeType: 1, querySelector: () => row, contains: () => true, addEventListener: (_type, listener) => listeners.push(listener) };
    const sheet = { id: "test-sheet", actor, isEditMode: true, element: root, renderChild: application => { sheet.opened = application; } };
    setupSkillAdvantageDescriptionEditors(sheet, root);
    const event = { target: button, preventDefault() {}, stopPropagation() {} };
    for (const listener of listeners) await listener(event);
    assert.equal(sheet.opened.config.existing, "<p>Notes.</p>");
    const input = { value: "<p>Saved text.</p>" };
    sheet.opened.element = { querySelector: () => input };
    const originalError = console.error;
    console.error = () => {};
    try { await sheet.opened._saveAndClose(); } finally { console.error = originalError; }
    assert.equal(sheet.opened.closed, !dropWrites);
    assert.equal(hidden.value, dropWrites ? "<p>Notes.</p>" : "<p>Saved text.</p>");
    assert.equal(hidden.defaultValue, hidden.value);
    assert.equal(input.value, "<p>Saved text.</p>");
    if (!dropWrites) {
      for (const listener of listeners) await listener(event);
      assert.equal(sheet.opened.config.existing, "<p>Saved text.</p>");
    }
  }
});
