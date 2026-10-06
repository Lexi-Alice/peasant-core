import assert from "node:assert/strict";

const assigned = [];
const warnings = [];
const created = [];
const existingMacroIds = new Set(["existing-macro"]);
const hooks = new Map();
const actor = {
  uuid: "Actor.test",
  name: "Test Actor",
  isOwner: true,
  system: {
    notableCombats: [{
      id: "combat-1", name: "Pistol", img: "icons/pistol.webp",
      defaultUsageId: "burst", baseUsage: { name: "Default" }, usages: [{ id: "burst", name: "Burst" }]
    }]
  }
};

globalThis.game = {
  peasantCore: {},
  macros: {
    find: () => null,
    get: id => existingMacroIds.has(id) ? { id } : null
  },
  user: {
    hotbar: { 21: "existing-macro", 22: "missing-macro" },
    getHotbarMacros(page) {
      const firstSlot = ((page - 1) * 10) + 1;
      return Array.from({ length: 10 }, (_value, index) => {
        const slot = firstSlot + index;
        return { slot, macro: game.macros.get(this.hotbar[slot]) };
      });
    },
    async assignHotbarMacro(macro, slot) {
      assigned.push({ macro, slot });
      this.hotbar[slot] = macro.id;
    }
  }
};
globalThis.ui = {
  hotbar: { page: 3 },
  notifications: { warn: message => warnings.push(message) }
};
globalThis.Hooks = { once() {}, on(name, callback) { hooks.set(name, callback); } };
globalThis.foundry = { utils: {} };
globalThis.fromUuid = async uuid => uuid === actor.uuid ? actor : null;
globalThis.Macro = {
  async create(data) {
    const macro = { id: `created-${created.length + 1}`, ...data };
    existingMacroIds.add(macro.id);
    created.push(macro);
    return macro;
  }
};

const { addNotableCombatToHotbar, addSkillUsageToHotbar, rollNotableCombatHotbarMacro } = await import(
  "../module/applications/notable-combat-hotbar.mjs"
);

const added = await addNotableCombatToHotbar({
  actorUuid: actor.uuid,
  combatId: "combat-1",
  combatIndex: 0
});

assert.equal(added, true);
assert.equal(created.length, 1);
assert.equal(assigned.length, 1);
assert.equal(assigned[0].slot, 22);
assert.equal(assigned[0].macro.name, "Pistol");
assert.equal(assigned[0].macro.flags["peasant-core"].notableCombatHotbar.usageId, "burst",
  "the inventory shortcut pins the saved default usage");
const inventoryMacroCalls = [];
game.peasantCore.rollNotableCombatHotbarMacro = async data => inventoryMacroCalls.push(data);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
await new AsyncFunction(assigned[0].macro.command)();
assert.deepEqual(inventoryMacroCalls, [{
  actorUuid: actor.uuid, combatId: "combat-1", combatIndex: 0, usageId: "burst"
}], "the inventory macro executes with its pinned default usage");
assert.deepEqual(warnings, []);

game.user.hotbar = Object.fromEntries(
  Array.from({ length: 10 }, (_value, index) => [index + 21, `occupied-${index}`])
);
for (const macroId of Object.values(game.user.hotbar)) existingMacroIds.add(macroId);

const rejected = await addNotableCombatToHotbar({
  actorUuid: actor.uuid,
  combatId: "combat-1",
  combatIndex: 0
});

assert.equal(rejected, false);
assert.equal(assigned.length, 1);
assert.deepEqual(warnings, ["The current hotbar page has no empty slots."]);

game.user.hotbar = {};
const missingActor = await addNotableCombatToHotbar({
  actorUuid: "Actor.missing",
  combatId: "combat-1",
  combatIndex: 0
});

assert.equal(missingActor, false);
assert.equal(assigned.length, 1);
assert.deepEqual(warnings, [
  "The current hotbar page has no empty slots.",
  "Notable combat actor could not be found."
]);

Macro.create = async () => {
  throw new Error("create failed");
};
const originalConsoleError = console.error;
console.error = () => {};
const failedCreation = await addNotableCombatToHotbar({
  actorUuid: actor.uuid,
  combatId: "combat-1",
  combatIndex: 0
});
console.error = originalConsoleError;

assert.equal(failedCreation, false);
assert.equal(assigned.length, 1);
assert.deepEqual(warnings, [
  "The current hotbar page has no empty slots.",
  "Notable combat actor could not be found.",
  "Failed to create notable combat hotbar macro. See console for details."
]);

actor.system.skills = [{
  id: "aid", name: "First Aid", img: "icons/aid.webp",
  baseUsage: { name: "Default" },
  usages: [
    { id: "night", name: "Rest" },
    { id: "treatment", name: "Rest" }
  ]
}];
game.user.hotbar = {};
ui.hotbar.page = 1;
game.macros.find = predicate => created.find(predicate) ?? null;
Macro.create = async data => {
  const macro = {
    id: `created-${created.length + 1}`, isAuthor: true, ...data,
    getFlag: (system, key) => macro.flags?.[system]?.[key],
    async update(patch) {
      Object.assign(this, patch);
      if (patch["flags.peasant-core.skillUsageHotbar"]) {
        this.flags["peasant-core"].skillUsageHotbar = patch["flags.peasant-core.skillUsageHotbar"];
      }
      if (patch["flags.peasant-core.notableCombatHotbar"]) {
        this.flags["peasant-core"].notableCombatHotbar = patch["flags.peasant-core.notableCombatHotbar"];
      }
    }
  };
  existingMacroIds.add(macro.id);
  created.push(macro);
  return macro;
};

assert.equal(typeof addSkillUsageToHotbar, "function");
assert.equal(await addSkillUsageToHotbar({
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "night"
}), true);
assert.equal(await addSkillUsageToHotbar({
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "treatment"
}), true);
assert.equal(created.length, 3, "two same-named usages create distinct macros");
assert.equal(created[1].flags["peasant-core"].skillUsageHotbar.usageId, "night");
assert.equal(created[2].flags["peasant-core"].skillUsageHotbar.usageId, "treatment");
assert.match(created[1].command, /game\.peasantCore\.useSkillEntry/);
assert.equal(assigned.at(-1).slot, 2);
const macroCalls = [];
game.peasantCore.useSkillEntry = async data => macroCalls.push(data);
await new AsyncFunction(created[1].command)();
assert.deepEqual(macroCalls, [{
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "night"
}], "the generated script invokes stable IDs rather than the usage label or array index");

actor.system.skills[0].usages.reverse();
actor.system.skills[0].usages.find(usage => usage.id === "night").name = "Clinic";
assert.equal(await addSkillUsageToHotbar({
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "night"
}), true);
assert.equal(created.length, 3, "renaming and reordering reuse the stable-identity macro");
assert.equal(created[1].name, "First Aid: Clinic");

const beforeStaleMacro = created.length;
assert.equal(await addSkillUsageToHotbar({
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "deleted"
}), false);
actor.isOwner = false;
assert.equal(await addSkillUsageToHotbar({
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "night"
}), false);
actor.isOwner = true;
assert.equal(created.length, beforeStaleMacro, "stale or unauthorized usage macros are not created");

const staleNotable = await rollNotableCombatHotbarMacro({
  actorUuid: actor.uuid, combatId: "deleted-combat", combatIndex: 0
});
assert.equal(staleNotable, false, "old explicit Notable IDs must not fall back to a saved index");

game.user.hotbar = {};
const notableData = { actorUuid: actor.uuid, combatId: "combat-1", combatIndex: 0 };
assert.equal(await addNotableCombatToHotbar(notableData), true);
const burstMacro = assigned.at(-1).macro;
const burstCommand = burstMacro.command;
actor.system.notableCombats[0].defaultUsageId = "base";
assert.equal(await addNotableCombatToHotbar(notableData), true);
const baseMacro = assigned.at(-1).macro;
assert.notEqual(baseMacro.id, burstMacro.id, "each Notable usage has its own macro rather than overwriting another");
assert.equal(burstMacro.command, burstCommand, "switching default usage leaves an earlier shortcut pinned");
assert.equal(baseMacro.flags["peasant-core"].notableCombatHotbar.usageId, "base");
const beforeReuse = created.length;
assert.equal(await addNotableCombatToHotbar({ ...notableData, usageId: "burst" }), true);
assert.equal(assigned.at(-1).macro.id, burstMacro.id, "explicit usages reuse their own macro, not the current default");
assert.equal(created.length, beforeReuse);
inventoryMacroCalls.length = 0;
await new AsyncFunction(burstMacro.command)();
await new AsyncFunction(baseMacro.command)();
assert.deepEqual(inventoryMacroCalls.map(call => call.usageId), ["burst", "base"]);

for (const usageId of ["base", "burst"]) {
  assert.equal(await addSkillUsageToHotbar({
    actorUuid: actor.uuid, collection: "notableCombats", entryId: "combat-1", usageId
  }), true, "the shared editor supports every Notable usage");
}
const notableUsageMacros = created.filter(macro => macro.flags["peasant-core"].skillUsageHotbar?.collection === "notableCombats");
assert.deepEqual(notableUsageMacros.map(macro => macro.flags["peasant-core"].skillUsageHotbar.usageId), ["base", "burst"]);
const beforeInvalidUsage = created.length;
assert.equal(await addNotableCombatToHotbar({ ...notableData, usageId: "deleted" }), false,
  "deleted usages cannot silently become the default usage");
assert.equal(created.length, beforeInvalidUsage);

const legacyMacro = {
  id: "legacy-unpinned", type: "script", isAuthor: true,
  command: `await game.peasantCore.rollNotableCombatHotbarMacro(${JSON.stringify(notableData)});`,
  getFlag: (_system, key) => key === "notableCombatHotbar" ? notableData : null
};
created.unshift(legacyMacro);
const legacyCommand = legacyMacro.command;
assert.equal(await addNotableCombatToHotbar(notableData), true);
assert.equal(assigned.at(-1).macro.id, baseMacro.id, "an unpinned legacy macro is not rewritten into a pinned usage");
assert.equal(legacyMacro.command, legacyCommand);
actor.system.notableCombats.unshift({ id: "other", name: "Other", baseUsage: { name: "Default" } });
assert.equal(await addNotableCombatToHotbar(notableData), true);
assert.equal(assigned.at(-1).macro.name, "Pistol", "reordering entries cannot bind the old index to a different entry");
assert.equal(assigned.at(-1).macro.flags["peasant-core"].notableCombatHotbar.combatIndex, 1);
assert.equal(await addNotableCombatToHotbar({ ...notableData, combatId: "deleted-combat" }), false,
  "a stale explicit entry ID cannot create a shortcut for its former index");

// Exercise the real render hook with a minimal DOM boundary, not a replacement renderer.
class HotbarElement {
  nodeType = 1;
  isConnected = true;
  children = [];
  dataset = {};
  attributes = {};
  className = "";
  classes = new Set();
  classList = {
    add: name => this.classes.add(name),
    toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)
  };
  append(child) { child.parent = this; this.children.push(child); }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getBoundingClientRect() { return { height: 0 }; }
  querySelector(selector) {
    const slot = selector.match(/^\.slot\[data-slot="(\d+)"\]$/)?.[1];
    if (slot) return this.children.find(child => child.dataset.slot === slot) ?? null;
    const name = selector.split(".").at(-1);
    for (const child of this.children) {
      if (child.className.split(" ").includes(name)) return child;
      const descendant = child.querySelector(selector);
      if (descendant) return descendant;
    }
    return null;
  }
}
globalThis.document = { createElement: () => new HotbarElement() };
globalThis.CONFIG = {};
const skillEntry = actor.system.skills[0];
Object.assign(skillEntry, { type: "skill", tohit: 7, accuracy: 0, defaultUsageId: "treatment" });
const clinic = skillEntry.usages.find(usage => usage.id === "night");
clinic.rollOverrides = { tohit: 5, accuracy: 2 };
skillEntry.usages.find(usage => usage.id === "treatment").rollOverrides = { tohit: 9, accuracy: -1 };
const combatEntry = actor.system.notableCombats.find(entry => entry.id === "combat-1");
Object.assign(combatEntry, { type: "Weapon", tohit: 6, accuracy: 1 });
combatEntry.usages[0].rollOverrides = { tohit: 4, accuracy: 3 };
const skillMacro = created.find(macro => macro.flags?.["peasant-core"]?.skillUsageHotbar?.usageId === "night");
const editorNotableMacro = notableUsageMacros.find(macro => macro.flags["peasant-core"].skillUsageHotbar.usageId === "burst");
const normalMacro = { name: "Other", getFlag: () => null };
const displayedMacros = [skillMacro, editorNotableMacro, burstMacro, baseMacro, legacyMacro, normalMacro];
const slotElements = displayedMacros.map((_macro, index) => {
  const slot = new HotbarElement();
  slot.dataset.slot = String(index + 1);
  return slot;
});
const hotbarRoot = new HotbarElement();
hotbarRoot.id = "hotbar";
for (const slot of slotElements) hotbarRoot.append(slot);
const macroSources = displayedMacros.map(macro => ({ command: macro.command, flags: structuredClone(macro.flags) }));
async function renderHotbar() {
  hooks.get("renderApplicationV2")({ id: "hotbar", slots: displayedMacros.map((macro, index) => ({ slot: index + 1, macro })) }, hotbarRoot);
  await new Promise(setImmediate);
}
await renderHotbar();
for (const [index, toHit, accuracy, name] of [
  [0, "5+", "+2 Acc", "First Aid: Clinic"],
  [1, "4+", "+3 Acc", "Pistol: Burst"],
  [2, "4+", "+3 Acc", "Pistol"],
  [3, "6+", "+1 Acc", "Pistol"],
  [4, "6+", "+1 Acc", "Pistol"]
]) {
  const slot = slotElements[index];
  assert.equal(slot.querySelector(".pc-notable-hotbar-tohit")?.textContent, toHit,
    "existing Skill, Notable, and legacy pins display their own usage's To-Hit");
  assert.equal(slot.querySelector(".pc-notable-hotbar-accuracy")?.textContent, accuracy);
  assert.equal(slot.querySelector(".pc-notable-hotbar-label-text")?.textContent, name);
  assert.equal(slot.classes.has("pc-notable-combat-hotbar"), true, "all entry pins use the same styling");
}
assert.equal(slotElements[5].classes.size, 0, "unrelated macros are not decorated");
clinic.rollOverrides = { tohit: 3, accuracy: 0 };
clinic.name = "Field Clinic";
combatEntry.defaultUsageId = "burst";
await renderHotbar();
assert.equal(slotElements[0].querySelector(".pc-notable-hotbar-tohit").textContent, "3+");
assert.equal(slotElements[0].querySelector(".pc-notable-hotbar-accuracy").hidden, true);
assert.equal(slotElements[0].querySelector(".pc-notable-hotbar-label-text").textContent, "First Aid: Field Clinic");
assert.equal(slotElements[3].querySelector(".pc-notable-hotbar-tohit").textContent, "6+", "pinned base usage ignores default changes");
assert.equal(slotElements[4].querySelector(".pc-notable-hotbar-tohit").textContent, "4+", "old unpinned macros follow the current default");
clinic.rollOverrides.tohit = 5;
skillEntry.type = "Stance";
await renderHotbar();
assert.equal(slotElements[0].classes.has("pc-notable-combat-hotbar-no-stats"), true, "non-rollable types retain their image/name without roll stats");
skillEntry.type = "skill";
skillEntry.usages = skillEntry.usages.filter(usage => usage.id !== "night");
await renderHotbar();
assert.equal(slotElements[0].classes.has("pc-notable-combat-hotbar-missing"), true, "a deleted pinned usage is marked missing, never replaced by the default");
assert.equal(slotElements[0].querySelector(".pc-notable-hotbar-tohit").hidden, true);
assert.deepEqual(displayedMacros.map(macro => ({ command: macro.command, flags: macro.flags })), macroSources,
  "rendering existing pins does not rewrite macro commands or saved flags");

let refreshes = 0;
ui.hotbar.rendered = true;
ui.hotbar.render = () => { refreshes++; };
ui.hotbar.slots = [{ macro: skillMacro }];
for (const changes of [{ "system.skills": actor.system.skills }, { "system.skills.0.accuracy": 2 }, { "system.combatMods.accuracy": 1 }]) {
  hooks.get("updateActor")(actor, changes);
}
assert.equal(refreshes, 3, "skill edits and combat modifiers refresh assigned usage pins");
hooks.get("updateActor")({ uuid: "Actor.other" }, { "system.skills": [] });
hooks.get("updateActor")(actor, { "system.currency": {} });
assert.equal(refreshes, 3, "unrelated actors and fields do not refresh the hotbar");
ui.hotbar.slots = [];
game.user.hotbar = { 11: skillMacro.id };
game.macros.get = id => created.find(macro => macro.id === id) ?? null;
hooks.get("updateActor")(actor, { "system.skills.0.tohit": 4 });
assert.equal(refreshes, 4, "assigned Skill pins also refresh when they are on another hotbar page");
