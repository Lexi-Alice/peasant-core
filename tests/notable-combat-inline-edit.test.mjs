import assert from "node:assert/strict";
import { prepareActorNotableCombatContext } from "../module/data/actor/sheet-display/notable-combat.mjs";
import { prepareSkillEditorIdentity } from "../module/applications/actor/skills/skill-editor.mjs";

const combats = [
  { id: "weapon", name: "Pistol", category: "martial", type: "Weapon", class: 2, rank: "3", tohit: 5, accuracy: 1 },
  { id: "spellcraft", name: "Spellcraft", category: "magic", type: "Spellcraft", class: 4, tohit: 6 },
  { id: "custom", name: "Special", category: "martial", type: "Custom", tohit: 7 }
];
const actor = { system: { notableCombats: combats } };
const data = {};
prepareActorNotableCombatContext(data, actor, { isEditMode: true, sourceSystem: actor.system });

for (const [id, selected] of [["weapon", "Weapon"], ["spellcraft", "Spellcraft"]]) {
  const combat = data.notableCombats.find(entry => entry.id === id);
  assert.equal(combat.typeOptions?.find(option => option.selected)?.value, selected,
    `${id} keeps its selected type when the edit-mode type selector opens`);
}
const customCombat = data.notableCombats.find(entry => entry.id === "custom");
assert.equal(customCombat.type, "Custom", "removing the menu choice does not rewrite custom entries");
assert.equal(customCombat.typeIsCustom, true, "a custom current value remains distinct from selectable Skill");
assert.equal(customCombat.typeOptions.some(option => option.value.toLowerCase() === "custom"), false,
  "Custom is not offered in the inline special menu");
assert.equal(data.notableCombats[0].tohit, "5");
assert.equal(data.notableCombats[0].accuracy, "+1");

const alternate = {
  ...combats[0],
  defaultUsageId: "burst",
  baseUsage: { name: "Default", resolution: "check", layout: [], rules: [], effectLinks: [] },
  usages: [{
    id: "burst", name: "Burst", resolution: "check", layout: [], rules: [], effectLinks: [],
    mechanics: {}, rollOverrides: { tohit: 9, accuracy: -2 }
  }]
};
const alternateData = {};
prepareActorNotableCombatContext(alternateData, { system: { notableCombats: [alternate] } }, {
  isEditMode: true, sourceSystem: { notableCombats: [alternate] }
});
assert.equal(alternateData.notableCombats[0].tohit, "9",
  "inline To-Hit displays the selected default usage's override");
assert.equal(alternateData.notableCombats[0].accuracy, "-2",
  "inline Accuracy displays the selected default usage's override");

class Field { constructor() {} }
globalThis.foundry = {
  abstract: { DataModel: class {} },
  applications: { ux: { TextEditor: { implementation: {} } } },
  data: { fields: new Proxy({}, { get: () => Field }) },
  utils: { deepClone: structuredClone }
};
globalThis.Actor = class {};
const { PeasantActor } = await import("../module/documents/actor.mjs");

const document = Object.assign(Object.create(PeasantActor.prototype), {
  system: { notableCombats: [{
    ...structuredClone(alternate),
    usages: [
      ...structuredClone(alternate.usages),
      { id: "quiet", name: "Quiet", rollOverrides: { tohit: 4, accuracy: 3 } }
    ]
  }] },
  async setPeasantNotableCombats(list) {
    this.system.notableCombats = structuredClone(list);
    return { ok: true, changed: true, combats: list };
  }
});

await document.setPeasantNotableCombatMainFields(0, { tohit: "11" });
await document.setPeasantNotableCombatMainFields(0, { accuracy: "+4" });
await document.setPeasantNotableCombatMainFields(0, { name: "Renamed Pistol" });
const edited = document.system.notableCombats[0];
assert.equal(edited.tohit, 5, "the inherited base To-Hit remains unchanged");
assert.equal(edited.accuracy, 1, "the inherited base Accuracy remains unchanged");
assert.deepEqual(edited.usages[0].rollOverrides, { tohit: 11, accuracy: 4 },
  "roll edits belong to the default usage");
assert.deepEqual(edited.usages[1].rollOverrides, { tohit: 4, accuracy: 3 },
  "another usage's rolls stay untouched");
assert.equal(edited.name, "Renamed Pistol", "identity fields remain shared at the entry level");

edited.defaultUsageId = "base";
await document.setPeasantNotableCombatMainFields(0, { tohit: "8", accuracy: "-1" });
assert.equal(document.system.notableCombats[0].tohit, 8);
assert.equal(document.system.notableCombats[0].accuracy, -1);
assert.deepEqual(document.system.notableCombats[0].usages[0].rollOverrides, { tohit: 11, accuracy: 4 },
  "editing the base default leaves alternate overrides untouched");

const { setupNotableCombatControls } = await import("../module/applications/actor/notable-combat/notable-combat-controls.mjs");
const inheritedDocument = Object.assign(Object.create(PeasantActor.prototype), {
  system: { notableCombats: [{
    ...structuredClone(alternate),
    usages: [{ ...structuredClone(alternate.usages[0]), rollOverrides: {} }]
  }] },
  async setPeasantNotableCombats(list) {
    this.system.notableCombats = structuredClone(list);
    return { ok: true, changed: true, combats: list };
  }
});
const inputs = Object.fromEntries([
  [".combat-class", "2"], [".combat-rank", "3"], [".combat-name", "Updated Name"],
  [".combat-tohit", "5"], [".combat-accuracy", "+1"]
].map(([selector, value]) => [selector, { value }]));
const row = {
  nodeType: 1,
  querySelector: selector => inputs[selector] ?? null,
  getAttribute: name => name === "data-combat-index" ? "0" : null
};
const nameInput = {
  nodeType: 1, dataset: { field: "name" }, value: "Updated Name", querySelector: () => null,
  closest: selector => selector === ".combat-item" ? row : selector.split(", ").includes(".combat-name") ? nameInput : null
};
const listeners = new Map();
const root = {
  nodeType: 1, querySelector: () => null, querySelectorAll: () => [], contains: () => true,
  addEventListener(type, listener) {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  }
};
setupNotableCombatControls({ actor: inheritedDocument, isEditMode: true }, root, {
  runQueuedInputUpdate: async (_input, _queue, _label, task) => task()
});
for (const listener of listeners.get("change") ?? []) await listener({ target: nameInput });
assert.equal(inheritedDocument.system.notableCombats[0].name, "Updated Name");
assert.deepEqual(inheritedDocument.system.notableCombats[0].usages[0].rollOverrides, {},
  "editing a shared name does not create overrides for inherited roll values");

const specialEntry = {
  id: "combat-special", name: "Training", category: "martial", type: "Stance",
  class: 3, rank: "2", specialGrade: 4, tohit: 6
};
const specialData = {};
prepareActorNotableCombatContext(specialData, { system: { notableCombats: [specialEntry] } }, {
  isEditMode: true, sourceSystem: { notableCombats: [specialEntry] }
});
assert.deepEqual(specialData.notableCombats[0].typeOptions.map(option => option.value), [
  "skill", "Stance", "Perk", "Cantrip", "Historic", "TM", "Spellcraft", "Style", "Gate", "Subskill"
], "the inline special menu offers Skill plus every special type, without Custom");
const magicStyle = prepareSkillEditorIdentity({ category: "magic", type: "Style" });
assert.deepEqual(magicStyle.entryTypeOptions.map(option => option.value), [
  "Spellcraft", "Style", "Gate", "TM", "Cantrip", "Historic", "Spell", "Subskill", "custom"
], "Style appears between Spellcraft and Gate in Magic Type options");
assert.equal(magicStyle.entryType, "Style");
assert.equal(magicStyle.showClassInput, false);
assert.equal(magicStyle.showRankInput, false);
assert.equal(magicStyle.showSpecialGradeInput, false);
assert.equal(magicStyle.showProgressionInputs, false);
assert.equal(prepareSkillEditorIdentity({ category: "martial", type: "Style" }).entryType, "Weapon",
  "Style is not a Martial Type");

const specialDocument = Object.assign(Object.create(PeasantActor.prototype), {
  system: { notableCombats: [structuredClone(specialEntry)] },
  async updatePeasantSourceData(update) {
    this.system.notableCombats = structuredClone(update["system.notableCombats"]);
  }
});
for (const [type, category] of [
  ["Gate", "magic"], ["Perk", "martial"], ["Cantrip", "magic"], ["Style", "magic"]
]) {
  await specialDocument.setPeasantNotableCombatType(0, type);
  const saved = specialDocument.system.notableCombats[0];
  assert.equal(saved.type, type, `${type} remains selected after save`);
  assert.equal(saved.category, category, `${type} has a compatible category`);
  assert.equal(saved.class, 3, "switching type preserves Class");
  assert.equal(saved.rank, "2", "switching type preserves Rank");
  assert.equal(saved.specialGrade, 4, "switching type preserves Grade");
}

for (const [category, type, regularType] of [
  ["martial", "Stance", "Weapon"], ["magic", "Style", "Spell"], ["mundane", "Custom", "skill"]
]) {
  const entry = PeasantActor.createDefaultPeasantCombatEntry({ ...structuredClone(alternate), category, type });
  entry.usages[0].mechanics.stability = true;
  const switchingActor = Object.assign(Object.create(PeasantActor.prototype), {
    system: { notableCombats: [entry] },
    async updatePeasantSourceData(update) {
      this.system.notableCombats = structuredClone(update["system.notableCombats"]);
    }
  });
  const before = {};
  prepareActorNotableCombatContext(before, switchingActor, { isEditMode: true, sourceSystem: switchingActor.system });
  const skillOption = before.notableCombats[0].typeOptions.find(option => option.label === "Skill");
  assert.ok(skillOption, `${type} offers a way back to Class and Rank`);
  await switchingActor.setPeasantNotableCombatType(0, skillOption.value);
  const after = {};
  prepareActorNotableCombatContext(after, switchingActor, { isEditMode: true, sourceSystem: switchingActor.system });
  assert.equal(after.notableCombats[0].isSkillType, true, `${type} returns to the Class/Rank edit layout`);
  assert.equal(after.notableCombats[0].classRankDisplay, "C2R3");
  assert.equal(after.notableCombats[0].tohit, "9", "default-usage rolls survive switching back");
  assert.equal(after.notableCombats[0].accuracy, "-2");
  const saved = switchingActor.system.notableCombats[0];
  assert.equal(saved.type, regularType);
  assert.equal(saved.category, category, "switching back preserves category");
  assert.deepEqual(saved.usages, entry.usages, "switching back preserves alternate usages and tags");
}

function treeActor(depths, names = []) {
  return Object.assign(Object.create(PeasantActor.prototype), {
    system: { notableCombats: depths.map((indent, index) => ({
      id: `entry-${index}`, name: names[index] ?? `Entry ${index}`,
      category: "martial", type: "Stance", indent
    })) },
    async updatePeasantSourceData(update) {
      this.system.notableCombats = structuredClone(update["system.notableCombats"]);
    }
  });
}

function displayedDepths(actor, isEditMode = false) {
  const context = {};
  prepareActorNotableCombatContext(context, actor, { isEditMode, sourceSystem: actor.system });
  return context.notableCombats.filter(combat => isEditMode || combat.isDisplayable).map(combat => combat.treeDepth);
}

const repeatedIndent = treeActor([0, 0]);
await repeatedIndent.changePeasantNotableCombatIndent(1, 1);
await repeatedIndent.changePeasantNotableCombatIndent(1, 1);
assert.equal(repeatedIndent.system.notableCombats[1].indent, 1,
  "repeated indent cannot store a depth beyond the previous row plus one");
await repeatedIndent.changePeasantNotableCombatIndent(1, -1);
assert.deepEqual(displayedDepths(repeatedIndent), [0, 0], "one outdent visibly moves the row");
await repeatedIndent.changePeasantNotableCombatIndent(0, 1);
assert.equal(repeatedIndent.system.notableCombats[0].indent, 0, "the first row cannot indent");
await repeatedIndent.changePeasantNotableCombatIndent(50, 1);
assert.equal(repeatedIndent.system.notableCombats.length, 2, "an invalid target cannot create entries");

const inflatedIndent = treeActor([0, 8]);
await inflatedIndent.changePeasantNotableCombatIndent(1, -1);
assert.deepEqual(displayedDepths(inflatedIndent), [0, 0], "outdent uses visible depth for legacy inflated data");
const parentOutdent = treeActor([0, 1, 2]);
await parentOutdent.changePeasantNotableCombatIndent(1, -1);
assert.deepEqual(displayedDepths(parentOutdent), [0, 0, 1]);
await parentOutdent.changePeasantNotableCombatIndent(2, -1);
assert.deepEqual(displayedDepths(parentOutdent), [0, 0, 0], "a descendant also moves on its first outdent");

const hiddenParent = treeActor([0, 1, 2], ["Root", "", "Child"]);
assert.deepEqual(displayedDepths(hiddenParent), [0, 1]);
await hiddenParent.changePeasantNotableCombatIndent(2, -1, { includeHidden: false });
assert.deepEqual(displayedDepths(hiddenParent), [0, 0], "view-mode outdent accounts for hidden entries");
assert.equal(hiddenParent.system.notableCombats[1].indent, 1, "hidden entries are not rewritten");
const editHiddenParent = treeActor([0, 1, 2], ["Root", "", "Child"]);
await editHiddenParent.changePeasantNotableCombatIndent(2, -1, { includeHidden: true });
assert.deepEqual(displayedDepths(editHiddenParent, true), [0, 1, 1], "edit-mode depth includes hidden entries");

const { createSheetUpdateQueue } = await import("../module/applications/actor/controls/sheet-listener-helpers.mjs");
let menuOptions;
globalThis.ContextMenu = class {
  constructor(_root, _selector, _items, options) { menuOptions = options; }
};
globalThis.ui = { context: {} };

for (const change of ["reorder", "remove"]) {
  const queuedActor = treeActor([0, 1, 1]);
  const sheet = { actor: queuedActor, canModifyActor: true, isEditMode: false };
  const enqueue = createSheetUpdateQueue(sheet);
  const row = {
    nodeType: 1, querySelector: () => null, dataset: { combatId: "entry-1" },
    getAttribute: name => name === "data-combat-index" ? "1" : null
  };
  const target = { closest: selector => selector === ".combat-view-item" ? row : null };
  setupNotableCombatControls(sheet, root, { enqueueSheetUpdate: enqueue });
  menuOptions.onOpen(target);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = enqueue("_combatSaveQueue", "pending list change", async () => {
    await gate;
    if (change === "reorder") await queuedActor.reorderPeasantNotableCombat(0, 3);
    else await queuedActor.removePeasantNotableCombat(1);
  });
  const outdent = ui.context.menuItems.find(item => item.label === "Outdent").onClick({}, target);
  release();
  await Promise.all([pending, outdent]);
  assert.equal(queuedActor.system.notableCombats.find(combat => combat.id === "entry-2").indent, 1,
    `${change} while queued cannot redirect outdent to a different entry`);
  if (change === "reorder") {
    assert.equal(queuedActor.system.notableCombats.find(combat => combat.id === "entry-1").indent, 0);
  } else {
    assert.equal(queuedActor.system.notableCombats.length, 2, "a removed target is ignored");
  }
}

const menuActor = treeActor([0, 1, 2], ["Root", "", "Child"]);
const menuSheet = { actor: menuActor, canModifyActor: true, isEditMode: false };
const menuRow = {
  nodeType: 1, querySelector: () => null, dataset: { combatId: "entry-2" },
  getAttribute: name => name === "data-combat-index" ? "2" : null
};
const menuTarget = { closest: selector => selector === ".combat-view-item" ? menuRow : null };
setupNotableCombatControls(menuSheet, root, { enqueueSheetUpdate: createSheetUpdateQueue(menuSheet) });
menuOptions.onOpen(menuTarget);
await ui.context.menuItems.find(item => item.label === "Outdent").onClick({}, menuTarget);
assert.deepEqual(displayedDepths(menuActor), [0, 0], "the actual menu passes the sheet's visibility mode");

let deleteRequested;
const deleteOpened = new Promise(resolve => { deleteRequested = resolve; });
let confirmDelete;
const deleteConfirmed = new Promise(resolve => { confirmDelete = resolve; });
foundry.applications.api = { DialogV2: { async prompt() {
  deleteRequested();
  return deleteConfirmed;
} } };
const deletion = ui.context.menuItems.find(item => item.label === "Delete").onClick({}, menuTarget);
await deleteOpened;
await menuActor.reorderPeasantNotableCombat(2, 0);
confirmDelete(true);
await deletion;
assert.deepEqual(menuActor.system.notableCombats.map(combat => combat.id), ["entry-0", "entry-1"],
  "delete re-resolves the same entry after waiting for confirmation");

const { prepareActorSkillContext } = await import("../module/data/actor/sheet-display/skills.mjs");
const sourceSkill = PeasantActor.createDefaultPeasantSkillEntry({
  ...structuredClone(alternate), id: "skill-pistol", ap: 0, sp: 3, indent: 2,
  img: "icons/pistol.webp", description: "<p>A pistol skill</p>",
  effectIds: ["whole-effect"],
  baseUsage: {
    ...structuredClone(alternate.baseUsage),
    effectLinks: [{ id: "base-link", effectId: "usage-effect", when: "success", recipient: "self", application: "automatic" }]
  }
});
sourceSkill.usages[0].mechanics.stability = true;
sourceSkill.usages[0].effectLinks = [{
  id: "burst-link", effectId: "usage-effect", tagKey: "stability", when: "success", recipient: "target", application: "offer"
}];
sourceSkill.usages[0].rules = [{ id: "once", when: "manual", note: "Once a day", tagKeys: ["stability"], effectLinkIds: ["burst-link"] }];
const skillData = {};
prepareActorSkillContext(skillData, { system: { skills: [sourceSkill] } });
assert.equal(skillData.skills[0].imageSrc, "icons/pistol.webp", "skills use their authored image in the inventory layout");
assert.equal(skillData.skills[0].activeTags.some(tag => tag.type === "stability"), true,
  "skill tags come from the displayed default usage");
assert.equal(skillData.skills[0].ap, "0", "zero AP survives resolving an alternate default usage");
assert.equal(skillData.skills[0].hasAp, true);
assert.equal(skillData.skills[0].sp, "3");
assert.equal(skillData.skills[0].treeDepth, 0, "the first skill is displayed at the root");

const skillDocument = Object.assign(Object.create(PeasantActor.prototype), {
  system: { skills: [structuredClone(sourceSkill)], notableCombats: [{ id: "existing", name: "Existing" }] },
  async updatePeasantSourceData(update) {
    for (const [path, value] of Object.entries(update)) this.system[path.slice(7)] = structuredClone(value);
  }
});
await skillDocument.setPeasantSkillMainFields(0, { tohit: "10", accuracy: "+2", ap: "4" });
assert.equal(skillDocument.system.skills[0].tohit, 5, "skill inline editing leaves base rolls unchanged");
assert.deepEqual(skillDocument.system.skills[0].usages[0].rollOverrides, { tohit: 10, accuracy: 2 });
assert.equal(skillDocument.system.skills[0].ap, 4, "AP is shared rather than a usage override");
assert.equal(skillDocument.system.skills[0].usages[0].rollOverrides.ap, undefined);

const definitions = new Map([
  ["whole-effect", { _id: "whole-effect", name: "Whole", type: "skill", changes: [{ key: "system.combatMods.accuracy", value: "1" }] }],
  ["usage-effect", { _id: "usage-effect", name: "Usage", type: "skill", disabled: true, flags: { "peasant-core": { skillEditorDefinition: true } }, changes: [] }]
]);
skillDocument.effects = { get: id => definitions.has(id) ? { toObject: () => structuredClone(definitions.get(id)) } : null };
let clonedEffects = [];
skillDocument.createEmbeddedDocuments = async (type, entries) => {
  assert.equal(type, "ActiveEffect");
  clonedEffects = entries.map((entry, index) => ({ ...structuredClone(entry), id: `cloned-${index}` }));
  return clonedEffects;
};
const originalSkill = structuredClone(skillDocument.system.skills[0]);
assert.equal(typeof skillDocument.duplicatePeasantSkillToNotables, "function");
const copiedResult = await skillDocument.duplicatePeasantSkillToNotables("skill-pistol");
assert.equal(copiedResult.ok, true);
assert.equal(skillDocument.system.notableCombats.length, 2, "copy appends at the bottom");
const copiedSkill = skillDocument.system.notableCombats[1];
assert.equal(copiedSkill.name, "Pistol", "a cross-list copy keeps the skill name without a Copy suffix");
assert.notEqual(copiedSkill.id, originalSkill.id);
assert.equal(copiedSkill.indent, 0);
assert.equal(copiedSkill.ap, 4);
assert.equal(copiedSkill.sp, 3);
assert.equal(copiedSkill.defaultUsageId, "burst");
assert.equal(copiedSkill.img, "icons/pistol.webp");
assert.equal(copiedSkill.description, "<p>A pistol skill</p>");
assert.deepEqual(copiedSkill.usages[0].rules, originalSkill.usages[0].rules);
assert.deepEqual(copiedSkill.usages[0].mechanics, originalSkill.usages[0].mechanics);
assert.equal(clonedEffects.length, 2, "each referenced effect is cloned once even if several usages link it");
assert.equal(clonedEffects.some(effect => effect._id), false);
assert.equal(clonedEffects[1].disabled, true);
assert.equal(clonedEffects[1].flags["peasant-core"].skillEditorDefinition, true);
assert.deepEqual(copiedSkill.effectIds, ["cloned-0"]);
assert.equal(copiedSkill.baseUsage.effectLinks[0].effectId, "cloned-1");
assert.equal(copiedSkill.usages[0].effectLinks[0].effectId, "cloned-1");
assert.deepEqual(skillDocument.system.skills[0], originalSkill, "copy leaves the original skill untouched");
copiedSkill.usages[0].rules[0].note = "Independent";
assert.equal(skillDocument.system.skills[0].usages[0].rules[0].note, "Once a day");

let removedEffects;
skillDocument.deleteEmbeddedDocuments = async (type, ids) => {
  assert.equal(type, "ActiveEffect");
  removedEffects = ids;
};
const saveSkillSource = skillDocument.updatePeasantSourceData;
skillDocument.updatePeasantSourceData = async () => { throw new Error("save failed"); };
await assert.rejects(skillDocument.duplicatePeasantSkillToNotables("skill-pistol"), /save failed/);
assert.deepEqual(removedEffects, ["cloned-0", "cloned-1"], "a failed entry save removes only newly created effects");
assert.equal(skillDocument.system.notableCombats.length, 2);
skillDocument.updatePeasantSourceData = saveSkillSource;
assert.equal((await skillDocument.duplicatePeasantSkillToNotables("deleted-skill")).ok, false);

const { setupSkillRowControls } = await import("../module/applications/actor/skills/skill-row-controls.mjs");
const skillSheet = { actor: skillDocument, canModifyActor: true, isEditMode: false };
const skillRow = {
  nodeType: 1, querySelector: () => null, dataset: { combatId: "skill-pistol" },
  getAttribute: name => name === "data-combat-index" ? "0" : null
};
const skillTarget = { closest: selector => selector === ".combat-view-item" ? skillRow : null };
setupSkillRowControls(skillSheet, root);
menuOptions.onOpen(skillTarget);
assert.deepEqual(ui.context.menuItems.map(item => item.label), [
  "Edit", "Duplicate", "Indent", "Outdent", "Delete", "Add to Hotbar", "Duplicate to Notables"
], "skills offer regular duplication below Edit as well as cross-list duplication");
await ui.context.menuItems.find(item => item.label === "Duplicate").onClick({}, skillTarget);
assert.equal(skillDocument.system.skills[1].name, "Pistol (Copy)");
assert.equal(skillDocument.system.skills[1].indent, originalSkill.indent);
assert.deepEqual(skillDocument.system.skills[1].usages, originalSkill.usages);
assert.deepEqual(skillDocument.system.skills[1].effectIds, originalSkill.effectIds);
assert.deepEqual(skillDocument.system.skills[0], originalSkill);
assert.deepEqual(ui.context.menuItems.slice(-2).map(item => item.label), ["Add to Hotbar", "Duplicate to Notables"]);
await ui.context.menuItems.at(-1).onClick({}, skillTarget);
assert.equal(skillDocument.system.notableCombats.at(-1).name, "Pistol");
setupNotableCombatControls(menuSheet, root);
menuOptions.onOpen(menuTarget);
assert.equal(ui.context.menuItems.some(item => item.label === "Duplicate to Notables"), false,
  "cross-list duplication is offered only on skills");

const preferenceStore = {};
globalThis.game = {
  user: { id: "first-user" },
  settings: {
    get: (_system, key) => structuredClone(preferenceStore[key] ?? {}),
    set: async (_system, key, value) => { preferenceStore[key] = structuredClone(value); }
  }
};
skillDocument.uuid = "Actor.skills";
function visibilityFixture(sheet) {
  const classes = new Set();
  const attributes = {};
  const visibilityRow = {
    dataset: { combatId: "skill-pistol", combatIndex: "0" },
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) }
  };
  const toggle = {
    closest: selector => selector === ".combat-view-item" ? visibilityRow : selector === "[data-pc-notable-combat-tags-toggle]" ? toggle : null,
    setAttribute: (name, value) => { attributes[name] = value; },
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) }
  };
  const events = [];
  const fixtureRoot = {
    nodeType: 1, querySelector: () => null, contains: () => true,
    querySelectorAll: selector => selector === "[data-pc-notable-combat-tags-toggle]" ? [toggle] : [],
    addEventListener: (type, listener) => { if (type === "click") events.push(listener); }
  };
  setupSkillRowControls(sheet, fixtureRoot);
  return { classes, attributes, async click() {
    for (const listener of events) await listener({ target: toggle, preventDefault() {}, stopPropagation() {} });
  } };
}
const firstVisibility = visibilityFixture(skillSheet);
assert.equal(firstVisibility.attributes["aria-expanded"], "false", "skills start with their tags hidden");
assert.equal(firstVisibility.classes.has("fa-expand"), true);
await firstVisibility.click();
assert.equal(firstVisibility.attributes["aria-expanded"], "true");
assert.equal(firstVisibility.classes.has("fa-compress"), true);
assert.equal(firstVisibility.classes.has("pc-notable-combat-tags-collapsed"), false);
const reopened = visibilityFixture({ ...skillSheet, _pcSkillExpandedTags: undefined });
assert.equal(reopened.attributes["aria-expanded"], "true", "an expanded preference survives reopening the sheet");
game.user.id = "second-user";
const otherUser = visibilityFixture({ ...skillSheet, _pcSkillExpandedTags: undefined });
assert.equal(otherUser.attributes["aria-expanded"], "false", "another user keeps the default collapsed state");

const { setupNotableCombatDragDropControls } = await import("../module/applications/actor/notable-combat/notable-combat-drag-drop.mjs");
const skillTags = Object.assign(Object.create(PeasantActor.prototype), {
  system: {
    skills: [{ id: "ordered-skill", type: "skill", name: "Ordered", class: 1, rank: "1", tohit: 6, tagOrder: ["stability", "range"], stability: true, range: 3 }],
    notableCombats: [{ id: "untouched-notable", name: "Other", tagOrder: ["stability", "range"] }]
  },
  async updatePeasantSourceData(update) {
    for (const [path, value] of Object.entries(update)) this.system[path.slice(7)] = structuredClone(value);
  }
});
const dragListeners = new Map();
const dragRoot = {
  nodeType: 1, querySelector: () => null, querySelectorAll: () => [], contains: () => true,
  addEventListener(type, listener) { dragListeners.set(type, [...(dragListeners.get(type) ?? []), listener]); }
};
const dragRow = { dataset: { combatId: "ordered-skill" }, closest: () => ({ dataset: { entryCollection: "skills" } }) };
const tagContainer = { dataset: { combatIndex: "0" }, closest: () => dragRow };
function draggableSkillTag(type) {
  const tag = {
    dataset: { tagType: type, tagKey: type }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    closest: selector => selector === ".combat-tags-inline" ? tagContainer : selector === ".combat-view-item" ? dragRow : selector === ".combat-tag-draggable" ? tag : null,
    getBoundingClientRect: () => ({ left: 0, width: 20 })
  };
  return tag;
}
setupNotableCombatDragDropControls({ actor: skillTags }, dragRoot);
for (const listener of dragListeners.get("dragstart") ?? []) await listener({ target: draggableSkillTag("range"), dataTransfer: { setData() {} } });
for (const listener of dragListeners.get("drop") ?? []) await listener({ target: draggableSkillTag("stability"), clientX: 0, preventDefault() {} });
assert.deepEqual(skillTags.system.skills[0].tagOrder.slice(0, 2), ["range", "stability"], "skill tag reordering updates the skill collection");
assert.deepEqual(skillTags.system.notableCombats[0].tagOrder, ["stability", "range"], "skill tag reordering cannot alter a notable at the same index");

const { rollCombatTagFromElement } = await import("../module/applications/actor/controls/roll-actions.mjs");
const tagRollMessages = [];
globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
globalThis.ChatMessage = {
  getSpeaker: () => ({}), applyMode: data => data,
  async create(data) {
    tagRollMessages.push(data);
    return { id: "skill-tag-roll", ...data, async update() {} };
  }
};
skillTags.uuid = "Actor.tags";
skillTags.system.skills[0].damage = { enabled: true, diceCount: 0, diceValue: 0, flat: 2, type: "Lethal" };
skillTags.system.notableCombats[0].damage = { enabled: true, diceCount: 0, diceValue: 0, flat: 9, type: "Lethal" };
const rollTarget = {
  dataset: { combatIndex: "0", rollType: "damage" },
  closest: selector => selector === "[data-entry-collection]" ? { dataset: { entryCollection: "skills" } } : null
};
await rollCombatTagFromElement({ actor: skillTags, _isPrimaryPointerEvent: () => true, _prepareSheetRollEvent: () => true }, {}, rollTarget);
assert.equal(tagRollMessages.length, 1, "the skill's damage tag posts a roll card");
assert.match(tagRollMessages[0].content, /Ordered/);
assert.doesNotMatch(tagRollMessages[0].content, /Other/);

const skillTree = Object.assign(Object.create(PeasantActor.prototype), {
  system: { skills: [{ ...sourceSkill, id: "root", indent: 0 }, { ...sourceSkill, id: "child", indent: 8 }] },
  async updatePeasantSourceData(update) { this.system.skills = structuredClone(update["system.skills"]); }
});
await skillTree.changePeasantSkillIndent(1, -1);
assert.equal(skillTree.system.skills[1].indent, 0, "skill outdent works in one click even with a legacy inflated indent");
await skillTree.changePeasantSkillIndent(0, 1);
assert.equal(skillTree.system.skills[0].indent, 0, "the first skill cannot indent");

const blankProgression = {};
prepareActorSkillContext(blankProgression, { system: { skills: [{ ...sourceSkill, ap: null, sp: null }] } });
assert.equal(blankProgression.skills[0].hasAp, false, "blank AP is omitted in view mode");
assert.equal(blankProgression.skills[0].hasSp, false);

const { setupSkillAdvantageDragDropControls } = await import("../module/applications/actor/skills/skill-advantage-drag-drop.mjs");
for (const collection of ["skills", "notableCombats"]) {
  const rowDragHandlers = [];
  const guardRoot = {
    nodeType: 1, querySelector: () => null, querySelectorAll: () => [], contains: () => true,
    addEventListener(type, listener) { if (type === "dragstart") rowDragHandlers.push(listener); }
  };
  const guardSheet = { actor: skillTags };
  setupSkillAdvantageDragDropControls(guardSheet, guardRoot, { sheetDocument: { body: {} }, sheetBody: {} });
  setupNotableCombatDragDropControls(guardSheet, guardRoot);
  const rowSelector = collection === "skills" ? ".skills-list .skill-item" : ".notable-combats-list .combat-item";
  const tagTarget = { closest(selector) {
    if (selector === rowSelector) return {};
    if (selector === ".combat-tag-draggable" || selector.includes("button,")) return tagTarget;
    return null;
  } };
  let cancelled = false;
  for (const listener of rowDragHandlers) await listener({ target: tagTarget, preventDefault() { cancelled = true; } });
  assert.equal(cancelled, false, `${collection} row sorting does not cancel its nested tag drag`);
}
