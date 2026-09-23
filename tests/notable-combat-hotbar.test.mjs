import assert from "node:assert/strict";

const assigned = [];
const warnings = [];
const created = [];
const existingMacroIds = new Set(["existing-macro"]);
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
globalThis.Hooks = { once() {}, on() {} };
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
