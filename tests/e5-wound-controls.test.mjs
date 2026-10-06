import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry = {
  abstract: { DataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: { deepClone: structuredClone }
};
globalThis.Actor = class {};
globalThis.game = { peasantCore: {}, user: { id: "gm", isGM: true }, actors: new Map() };

const { PeasantActor } = await import("../module/documents/actor.mjs");
const { getEffectiveSkillCombatModifiers } = await import("../module/data/actor/combat-modifiers.mjs");
const { getEffectiveWoundThresholds } = await import("../module/data/actor/wounds.mjs");
const { setupWoundsControls } = await import("../module/applications/actor/controls/wounds-controls.mjs");
const { createPeasantEntryUsageContext } = await import("../module/applications/combat/skill-entry-use.mjs");

function actorFor({ wounds = 2 } = {}) {
  const actor = Object.assign(Object.create(PeasantActor.prototype), {
    id: "wound-control-actor",
    type: "character",
    system: {
      hp: { rows: 1, cols: 10, grid: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] },
      health: { value: 10, max: 10 },
      temporaryHp: { value: 0, max: 0 },
      bolsteredHp: 0,
      stamina: { value: 0, max: 4 },
      attunement: { value: 0, max: 3 },
      capacity: { value: 0, max: 2 },
      devastatingWounds: wounds,
      combatMods: { accuracy: 3 },
      conditions: { wounded: true, head: "disabled" },
      skills: [],
      notableCombats: [],
      flexibleAdvantages: ["Scholar", ""],
      flexibleAdvantageDescriptions: ["Research", ""]
    },
    updates: [],
    getFlag: () => undefined,
    async updatePeasantStateData(update) {
      this.updates.push(structuredClone(update));
      for (const [path, value] of Object.entries(update)) {
        const parts = path.replace(/^system\./, "").split(".");
        let target = this.system;
        while (parts.length > 1) target = target[parts.shift()];
        target[parts[0]] = structuredClone(value);
      }
    },
    async update(update) { return this.updatePeasantStateData(update); }
  });
  return actor;
}

const actor = actorFor();
assert.equal(getEffectiveWoundThresholds(actor).head.effective, 6);
assert.equal(getEffectiveSkillCombatModifiers(actor).accuracy, -1);
actor.system.skills = [{ id: "manual-wound-skill", name: "Swordplay", category: "mundane", type: "skill", rank: "1", class: 1, tohit: 7, accuracy: 2 }];
const initialSkillSnapshot = (await createPeasantEntryUsageContext({
  actor,
  ref: { collection: "skills", entryId: "manual-wound-skill" }
})).usageContext;
assert.equal(initialSkillSnapshot.modifiers.accuracy, -1);
assert.equal(initialSkillSnapshot.data.accuracy, 2);
assert.equal((await actor.adjustPeasantDevastatingWounds(1)).value, 3);
assert.equal(getEffectiveWoundThresholds(actor).head.effective, 4);
assert.equal(getEffectiveSkillCombatModifiers(actor).accuracy, -3);
const nextSkillSnapshot = (await createPeasantEntryUsageContext({
  actor,
  ref: { collection: "skills", entryId: "manual-wound-skill" }
})).usageContext;
assert.equal(nextSkillSnapshot.modifiers.accuracy, -3, "future Skill snapshots immediately see the adjusted count");
assert.equal(initialSkillSnapshot.modifiers.accuracy, -1, "existing Skill snapshots remain stable");
assert.equal(actor.system.combatMods.accuracy, 3, "manual count changes never rewrite authored Accuracy");
assert.equal((await actor.adjustPeasantDevastatingWounds(-2)).value, 1);
assert.equal((await actor.adjustPeasantDevastatingWounds(-5)).value, 0, "the count cannot fall below zero");
assert.equal(actor.system.devastatingWounds, 0);

const resetActor = actorFor();
await resetActor.refreshPeasantResourcesAndResetTracks();
assert.equal(resetActor.system.devastatingWounds, 0, "the owner resource reset clears Devastating Wounds");
assert.equal(resetActor.system.conditions.wounded, false);

function rootWithListener() {
  const listeners = new Map();
  return {
    nodeType: 1,
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry !== listener)); },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => true,
    click(target) {
      return Promise.all((listeners.get("click") ?? []).map(listener => listener({
        target: { closest: () => target },
        preventDefault() {},
        stopPropagation() {}
      })));
    }
  };
}

function sheetFor(currentActor, readOnly = false) {
  const sheet = {
    actor: currentActor,
    isReadOnlyObserver: readOnly,
    _renderDialog(config) { this.dialogConfig = config; return {}; }
  };
  return sheet;
}

const ownerSheet = sheetFor(actor);
const ownerRoot = rootWithListener();
setupWoundsControls(ownerSheet, ownerRoot);
await ownerRoot.click({});
assert.doesNotMatch(ownerSheet.dialogConfig.content, /pc-wounds-devastating-row/, "zero Devastating Wounds clears its Active Wounds row");
assert.match(ownerSheet.dialogConfig.content, /WOUNDED/);

ownerSheet.dialogConfig.buttons.add.callback(null);
const addWoundConfig = ownerSheet.dialogConfig;
assert.deepEqual(Object.keys(addWoundConfig.buttons), ["add"], "the Add Wound dialog has no Cancel action");
assert.match(addWoundConfig.content, /<option value="wounded">Wounded<\/option>\s*<option value="devastatingly-wounded">Devastatingly Wounded<\/option>/);
await addWoundConfig.buttons.add.callback({
  nodeType: 1,
  querySelector: (selector) => selector === '[name="woundType"]' ? { value: "devastatingly-wounded" } : null
});
assert.equal(actor.system.devastatingWounds, 1, "adding Devastatingly Wounded increments the count");
assert.match(ownerSheet.dialogConfig.content, /pc-wounds-devastating-row/);
assert.match(ownerSheet.dialogConfig.content, /pc-wounds-devastating-count">1<\/span>/);
assert.match(ownerSheet.dialogConfig.content, /data-delta="-1"[^>]*aria-label="Clear Devastating Wounds"[^>]*>&times;<\/button>/, "the last Devastating Wound uses an X to signal that it clears the row");
assert.match(ownerSheet.dialogConfig.content, /class="pc-adjust-devastating-wounds pc-remove-condition"[^>]*data-delta="-1"/, "the Devastating Wounds decrement control uses the shared wound remove-button style");
assert.ok(
  ownerSheet.dialogConfig.content.indexOf('data-delta="1"') < ownerSheet.dialogConfig.content.indexOf('data-delta="-1"'),
  "the add control precedes the remove control"
);

ownerSheet.dialogConfig.buttons.add.callback(null);
await ownerSheet.dialogConfig.buttons.add.callback({
  nodeType: 1,
  querySelector: (selector) => selector === '[name="woundType"]' ? { value: "devastatingly-wounded" } : null
});
assert.equal(actor.system.devastatingWounds, 2, "adding Devastatingly Wounded again increments the count");
assert.match(ownerSheet.dialogConfig.content, /data-delta="-1"[^>]*aria-label="Remove one Devastating Wound"[^>]*>&minus;<\/button>/);

const countButton = {
  dataset: { delta: "-1" },
  listeners: new Map(),
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); },
  async click() { await Promise.all((this.listeners.get("click") ?? []).map(listener => listener({ preventDefault() {}, stopPropagation() {} }))); }
};
const clearedConditions = [];
const clearCondition = actor.clearPeasantCondition.bind(actor);
actor.clearPeasantCondition = async (key) => { clearedConditions.push(key); return clearCondition(key); };
const woundList = { innerHTML: "" };
ownerSheet.dialogConfig.render({
  nodeType: 1,
  querySelector: (selector) => selector === ".pc-wounds-list" ? woundList : null,
  // Rendering replaces the old buttons; do not rebind the retained detached test button.
  querySelectorAll: (selector) => !woundList.innerHTML && [".pc-adjust-devastating-wounds", ".pc-remove-condition"].includes(selector) ? [countButton] : []
});
await countButton.click();
assert.equal(actor.system.devastatingWounds, 1, "the remove control decrements the actor count");
assert.match(woundList.innerHTML, /pc-wounds-devastating-count">1</);
await test("Devastating decrement invokes only the count action", () => {
  assert.deepEqual(clearedConditions, [], "shared hover class must not attach ordinary condition removal");
});

await countButton.click();
assert.equal(actor.system.devastatingWounds, 0, "removing the last Devastating Wound clears the count");
assert.doesNotMatch(woundList.innerHTML, /pc-wounds-devastating-row/, "the Active Wounds row disappears after the last wound is removed");

await test("a Devastating-only card omits the empty-state message", async () => {
  const currentActor = actorFor({ wounds: 1 });
  currentActor.system.conditions = {};
  const currentSheet = sheetFor(currentActor);
  const root = rootWithListener();
  setupWoundsControls(currentSheet, root);
  await root.click({});
  assert.match(currentSheet.dialogConfig.content, /pc-wounds-devastating-count">1<\/span>/);
  assert.doesNotMatch(currentSheet.dialogConfig.content, /No active wounds/);
  currentActor.system.devastatingWounds = 0;
  await root.click({});
  assert.match(currentSheet.dialogConfig.content, /No active wounds/);
});

await actor.adjustPeasantDevastatingWounds(1);
const readOnlySheet = sheetFor(actor, true);
const readOnlyRoot = rootWithListener();
setupWoundsControls(readOnlySheet, readOnlyRoot);
await readOnlyRoot.click({});
assert.match(readOnlySheet.dialogConfig.content, /Devastating Wounds/);
assert.match(readOnlySheet.dialogConfig.content, /pc-wounds-devastating-count[^>]*>1<\/span>/, "read-only observers see the count");
assert.doesNotMatch(readOnlySheet.dialogConfig.content, /pc-adjust-devastating-wounds/);

function hoverElement(hoverBackground = "") {
  const classes = new Set();
  const listeners = new Map();
  const styleValues = new Map();
  return {
    dataset: {},
    classList: {
      toggle(name, active) { active ? classes.add(name) : classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    style: {
      values: styleValues,
      setProperty(name, value) { styleValues.set(name, value); },
      removeProperty(name) { styleValues.delete(name); }
    },
    hoverBackground,
    ownerDocument: {
      defaultView: {
        getComputedStyle: (element) => ({
          getPropertyValue: (name) => name === "--button-hover-background-color" ? element.hoverBackground : ""
        })
      }
    },
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    dispatch(type, event) { return Promise.all((listeners.get(type) ?? []).map(listener => listener(event))); },
    matches(selector) { return selector === ":hover" && !!this.hovered; },
    querySelector(selector) {
      return selector.includes("pc-remove-condition") ? this.removeControl || null : null;
    },
    querySelectorAll(selector) { return selector === ".pc-adjust-devastating-wounds" ? this.adjustControls || [] : []; }
  };
}

const hoverActor = actorFor({ wounds: 1 });
const hoverSheet = sheetFor(hoverActor);
const hoverDialogRoot = rootWithListener();
setupWoundsControls(hoverSheet, hoverDialogRoot);
await hoverDialogRoot.click({});
const regularWound = hoverElement("row-yellow");
const regularRemove = hoverElement("system-rust");
regularRemove.dataset.condition = "wounded";
regularWound.removeControl = regularRemove;
const devastatingWound = hoverElement("ugly-yellow");
const devastatingAdd = hoverElement("other-button-color");
const devastatingRemove = hoverElement("system-rust");
devastatingWound.removeControl = devastatingRemove;
devastatingWound.adjustControls = [devastatingAdd, devastatingRemove];
hoverSheet.dialogConfig.render({
  nodeType: 1,
  querySelector: (selector) => selector === ".pc-wounds-list" ? {} : null,
  querySelectorAll: (selector) => ({
    ".pc-wound-tag": [regularWound, devastatingWound],
    ".pc-remove-condition": [regularRemove, devastatingRemove],
    ".pc-remove-condition[data-condition]": [regularRemove],
    ".pc-adjust-devastating-wounds": [devastatingAdd, devastatingRemove]
  })[selector] || []
});
regularWound.hovered = true;
regularWound.dispatch("mouseenter");
devastatingWound.hovered = true;
devastatingWound.dispatch("mouseenter");
assert.equal(
  devastatingWound.style.values.get("background"),
  regularWound.style.values.get("background"),
  "Devastating Wounds uses the same row highlight color as regular wound entries"
);
regularRemove.dispatch("mouseenter");
devastatingAdd.dispatch("mouseenter");
assert.equal(devastatingWound.classList.contains("tag-hover-active"), regularWound.classList.contains("tag-hover-active"));
assert.equal(devastatingAdd.classList.contains("tag-hover-active"), regularRemove.classList.contains("tag-hover-active"));
await regularRemove.dispatch("click", { preventDefault() {}, stopPropagation() {} });
assert.equal(hoverActor.system.conditions.wounded, false, "ordinary controls with data-condition still clear their condition");

delete globalThis.Actor;
delete globalThis.foundry;
delete globalThis.game;

console.log("E5 Wound control standalone assertions completed");
