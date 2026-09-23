import assert from "node:assert/strict";

class FakeElement {
  constructor(selectors = []) {
    this.nodeType = 1;
    this.dataset = {};
    this._selectors = new Set(selectors);
    this._queries = new Map();
    this._children = new Set();
    this._listeners = new Map();
    this.classList = {
      add() {},
      remove() {},
      toggle() {}
    };
  }

  addChild(selector, child) {
    this._queries.set(selector, child);
    this._children.add(child);
  }

  querySelector(selector) {
    return this._queries.get(selector) ?? null;
  }

  querySelectorAll() {
    return [];
  }

  contains(element) {
    return element === this || this._children.has(element);
  }

  closest(selector) {
    return this._selectors.has(selector) ? this : null;
  }

  addEventListener(type, listener) {
    const listeners = this._listeners.get(type) ?? [];
    listeners.push(listener);
    this._listeners.set(type, listeners);
  }

  removeEventListener() {}
  setAttribute() {}

  async dispatch(type, target = this) {
    const event = {
      type,
      target,
      currentTarget: this,
      button: 0,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {}
    };
    for (const listener of this._listeners.get(type) ?? []) await listener(event);
  }
}

class ApplicationV2 {
  static DEFAULT_OPTIONS = {};
  constructor(options = {}) { this.options = options; }
  render() { return this; }
  async close() {}
}

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2,
      HandlebarsApplicationMixin: Base => class extends Base {}
    },
    apps: {},
    ux: {}
  },
  utils: {
    deepClone: structuredClone,
    escapeHTML: value => String(value),
    mergeObject: (base = {}, update = {}) => ({ ...base, ...update })
  }
};
globalThis.Hooks = { on: () => 1, off() {} };
globalThis.ui = { notifications: {} };
globalThis.game = { i18n: {} };

const { setupActorEffectControls } = await import("../module/applications/actor/controls/effects-controls.mjs");
const { setupCombatModifierControls } = await import("../module/applications/actor/controls/combat-modifier-controls.mjs");
const { setupInventoryControls } = await import("../module/applications/actor/controls/inventory-controls.mjs");
const {
  openPeasantSkillEditor,
  prepareNotableCombatEffectContext
} = await import("../module/applications/actor/notable-combat/notable-combat-tag-editor.mjs");

const effectContext = prepareNotableCombatEffectContext({
  effects: { get: id => id === "whole" ? { id, name: "Whole Effect", disabled: false, sort: 10 } : null }
}, {
  effectIds: ["whole"],
  baseUsage: {
    name: "Default",
    effectLinks: [{ id: "usage-link", effectId: "missing", when: "success", application: "offer" }]
  }
}, { entryKindLabel: "Skill", selectedUsageId: "base" });
assert.deepEqual(effectContext.effectSections.map(section => section.label), ["Whole Skill", "Default"]);
assert.equal(effectContext.effectSections[0].effects[0].scope, "whole");
assert.equal(effectContext.effectSections[1].effects[0].status, "Missing");
assert.equal(effectContext.effectSections[1].effects[0].subtitle, "Successful - Offer in Chat");
assert.equal(effectContext.effectGroupToggle.label, "Grouped by Scope",
  "Skill effects retain their existing scope grouping");
const notableEffectContext = prepareNotableCombatEffectContext({ effects: { get: () => null } }, {
  effectIds: ["legacy-whole"], baseUsage: { name: "Default", effectLinks: [] }
}, { entryKindLabel: "Notable", selectedUsageId: "base" });
assert.deepEqual(notableEffectContext.effectSections, [],
  "A notable with no current-usage effects has no grouped rows");
const groupedNotable = prepareNotableCombatEffectContext({ effects: { get: () => null } }, {
  effectIds: ["legacy-whole"],
  baseUsage: { name: "Default", effectLinks: [{ id: "base-link", effectId: "base-effect", when: "passive" }] },
  usages: [
    { id: "treatment", name: "Treatment", effectLinks: [
      { id: "hit-link", effectId: "hit-effect", when: "hit" },
      { id: "success-link", effectId: "success-effect", when: "success" },
      { id: "use-link", effectId: "use-effect", when: "always" }
    ] },
    { id: "other", name: "Other", effectLinks: [{ id: "other-link", effectId: "other-effect", when: "failure" }] }
  ]
}, { entryKindLabel: "Notable", selectedUsageId: "treatment" });
assert.deepEqual(groupedNotable.effectSections.map(section => section.label),
  ["On Use", "Successful Check", "Hit"],
  "Notable effects group by condition in condition-menu order");
assert.deepEqual(groupedNotable.effectSections.map(section => section.effects.map(effect => effect.id)),
  [["use-effect"], ["success-effect"], ["hit-effect"]],
  "Each condition contains only effects linked to the selected usage");
assert.deepEqual(groupedNotable.effectFlatSection.effects.map(effect => effect.id),
  ["hit-effect", "success-effect", "use-effect"],
  "The flat view excludes other usages and legacy whole-notable effects too");
assert.equal(groupedNotable.effectGroupToggle.label, "Grouped by Condition");
const notableEntry = { id: "notable-1", name: "Test Notable", baseUsage: { name: "Default", effectLinks: [] } };
const notableSheet = {
  id: "notable-sheet",
  canModifyActor: true,
  actor: {
    uuid: "Actor.notable",
    system: { _source: { notableCombats: [notableEntry] }, notableCombats: [notableEntry] },
    updatePeasantEntry: async () => ({ ok: true, changed: false })
  },
  renderChild() {}
};
const notableEditor = await openPeasantSkillEditor(notableSheet, {
  collection: "notableCombats", entryId: notableEntry.id
});
const groupRoot = new FakeElement();
const groupBrowser = new FakeElement();
const groupToggle = new FakeElement();
groupRoot.addChild("[data-pc-notable-combat-effects-browser]", groupBrowser);
groupBrowser.addChild("[data-pc-notable-combat-effects-group-toggle]", groupToggle);
notableEditor._applyNotableCombatEffectGroupMode(groupRoot);
assert.equal(groupToggle.dataset.tooltip, "Grouped by Condition",
  "Reapplying the Notable grouped view keeps the Condition tooltip");
const onUseEffectContext = prepareNotableCombatEffectContext({ effects: { get: () => null } }, {
  baseUsage: { name: "Default", effectLinks: [
    { id: "use-link", effectId: "missing", when: "always", application: "automatic" }
  ] }
}, { entryKindLabel: "Notable" });
assert.equal(onUseEffectContext.effectSections[0].effects[0].subtitle, "On Use - Automatic",
  "Existing Always usage effects are presented as On Use without changing their condition");

function createSection(browserSelector, actionSelector) {
  const root = new FakeElement();
  const browser = new FakeElement();
  const button = new FakeElement([actionSelector]);
  root.addChild(browserSelector, browser);
  root.addChild(actionSelector, button);
  return { root, browser, button };
}

let effectDialogCount = 0;
globalThis.ActiveEffect = {
  createDialog: async () => {
    effectDialogCount += 1;
    return null;
  }
};
const actorEffects = createSection("[data-pc-passive-effects-browser]", "[data-pc-passive-effect-add]");
setupActorEffectControls({ canModifyActor: true, isEditMode: false, actor: { name: "Test Actor" } }, actorEffects.root);
await actorEffects.button.dispatch("click");
assert.equal(effectDialogCount, 1, "an actor owner can add an Active Effect in view mode");

let combatAdjustmentDialogCount = 0;
const combatAdjustments = createSection("[data-unused]", ".add-combat-halt-buff");
setupCombatModifierControls({
  isEditable: true,
  isEditMode: false,
  actor: { system: { combatMods: { haltBuffs: [] } } },
  _renderDialog: () => { combatAdjustmentDialogCount += 1; }
}, combatAdjustments.root);
await combatAdjustments.root.dispatch("click", combatAdjustments.button);
assert.equal(combatAdjustmentDialogCount, 1, "an actor owner can add a Combat Adjustment in view mode");

let itemDialogCount = 0;
globalThis.Item = {
  createDialog: async () => {
    itemDialogCount += 1;
  }
};
const inventory = createSection("[data-pc-inventory-browser]", "[data-pc-inventory-add-item]");
setupInventoryControls({ canModifyActor: true, isEditMode: false, actor: {} }, inventory.root);
await inventory.root.dispatch("click", inventory.button);
assert.equal(itemDialogCount, 1, "an actor owner can add an Inventory item in view mode");

const entry = { id: "skill-1", name: "Test Skill", effectIds: [] };
const sheet = {
  id: "sheet-1",
  canModifyActor: true,
  actor: {
    uuid: "Actor.test",
    system: { _source: { skills: [entry] }, skills: [entry] },
    updatePeasantEntry: async () => ({ ok: true, changed: false })
  },
  renderChild() {}
};
const editor = await openPeasantSkillEditor(sheet, { collection: "skills", entryId: entry.id });
entry.category = "martial";
entry.type = "Weapon";
entry.weaponType = "";
sheet.actor.updatePeasantEntry = async (_ref, patch) => {
  Object.assign(entry, patch);
  return { ok: true, changed: true, entry };
};
const classificationInputs = new Map([
  [".pc-entry-category-select", { value: "martial" }],
  [".pc-entry-weapon-type-select", { value: "custom" }],
  [".pc-entry-weapon-type-custom", { value: "Blunderbuss" }]
]);
let customTypeFocused = false;
const customTypeInput = { value: "", hidden: true, focus() { customTypeFocused = true; } };
const typeChoice = { querySelector: selector => selector === "select" ? typeSelect : customTypeInput };
const typeSelect = {
  value: "custom",
  closest: () => typeChoice,
  matches: selector => selector.split(", ").includes(".pc-entry-type-select")
};
classificationInputs.set(".pc-entry-type-select, .pc-notable-combat-type-select", typeSelect);
classificationInputs.set(".pc-entry-type-custom", customTypeInput);
const classificationRoot = {
  querySelector: selector => classificationInputs.get(selector) ?? null,
  querySelectorAll: () => []
};
const delegatedEvents = [];
const classificationContainer = {
  0: classificationRoot,
  on: (event, selector, handler) => delegatedEvents.push({ event, selector, handler })
};
editor._bindLayoutControls(classificationContainer);
const classificationChange = delegatedEvents.find(({ event, selector }) => event === "change" && selector.includes(".pc-entry-type-select"));
await classificationChange.handler({ currentTarget: typeSelect });
assert.equal(entry.weaponType, "Blunderbuss", "opening Custom Type saves pending custom Weapon Type text");
assert.equal(customTypeFocused, true);
customTypeInput.value = "Ritual";
const typeTarget = { matches: selector => selector.split(", ").includes(".pc-entry-type-select") };
const customTypeTarget = { matches: selector => selector.split(", ").includes(".pc-entry-type-custom") };
await editor._saveMainFields({ 0: classificationRoot }, customTypeTarget);
assert.equal(entry.weaponType, "Blunderbuss", "switching to a custom Type saves pending custom Weapon Type text before redraw");
typeSelect.value = "Weapon";
classificationInputs.delete(".pc-entry-weapon-type-select");
classificationInputs.delete(".pc-entry-weapon-type-custom");
await editor._saveMainFields({ 0: classificationRoot }, typeTarget);
assert.equal(entry.weaponType, "Blunderbuss", "returning to Weapon retains its custom subtype");
const editorEffects = createSection("[data-pc-notable-combat-effects-browser]", "[data-pc-notable-combat-add-effect]");
const $container = { 0: editorEffects.root };
const editorEffectScopes = [];
const createNotableCombatEffect = editor._createNotableCombatEffect.bind(editor);
editor._createNotableCombatEffect = async (container, { scope }) => {
  assert.equal(container, $container);
  editorEffectScopes.push(scope);
};
editor._bindNotableCombatEffectControls($container);
await editorEffects.root.dispatch("click", editorEffects.button);
editorEffects.button.dataset.effectScope = "usage";
await editorEffects.root.dispatch("click", editorEffects.button);
assert.deepEqual(editorEffectScopes, ["usage", "usage"],
  "the Effects-section add control always creates an effect for the selected usage");
editorEffects.root.addChild("[data-pc-notable-combat-effects-browser]", new FakeElement());
editor._bindNotableCombatEffectControls($container);
await editorEffects.root.dispatch("click", editorEffects.button);
assert.deepEqual(editorEffectScopes, ["usage", "usage", "usage"], "replacing the Effects browser does not duplicate the root Add Effect listener");
editor._createNotableCombatEffect = createNotableCombatEffect;

let createdDefinitionData = null;
let linkedDefinitionOptions = null;
const createdDefinition = { id: "effect-definition", async delete() {} };
sheet.actor.createEmbeddedDocuments = async (_documentName, [data]) => {
  createdDefinitionData = data;
  return [createdDefinition];
};
sheet.actor.managePeasantEntryEffectLink = async (_ref, action, options) => {
  assert.equal(action, "link");
  linkedDefinitionOptions = options;
  return { ok: true, changed: true, linkId: "link-definition" };
};
editor._saveMainFields = async () => {};
editor.render = async () => editor;
editor._openNotableCombatEffectSheet = () => {};
await editor._createNotableCombatEffect($container, { scope: "usage" });
assert.equal(createdDefinitionData.disabled, true);
assert.equal(createdDefinitionData.flags["peasant-core"].skillEditorDefinition, true);
assert.equal(linkedDefinitionOptions.usageId, "base");
assert.equal(linkedDefinitionOptions.effectLink.effectId, createdDefinition.id);
assert.equal(linkedDefinitionOptions.effectLink.when, "success");
assert.equal(linkedDefinitionOptions.effectLink.application, "automatic");

delete globalThis.ActiveEffect;
delete globalThis.Item;
delete globalThis.game;
delete globalThis.ui;
delete globalThis.Hooks;
delete globalThis.foundry;

console.log("Section add control listener tests passed.");
