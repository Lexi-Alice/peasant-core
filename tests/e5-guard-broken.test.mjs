import assert from "node:assert/strict";

globalThis.ActiveEffect = {
  implementation: {
    getEffectStart: (combat) => ({
      combat: combat?.id || null,
      combatant: "combatant-1",
      initiative: 7,
      round: combat?.round ?? null,
      time: 100,
      turn: combat?.turn ?? null
    })
  }
};

const { createGuardBrokenEffectData } = await import("../module/data/actor/guard-broken.mjs");
const combat = { id: "combat-1", round: 3, turn: 1 };
const guardBrokenSource = createGuardBrokenEffectData(combat);
assert.deepEqual(guardBrokenSource, {
  name: "Guard-Broken",
  type: "skill",
  disabled: false,
  start: {
    combat: "combat-1",
    combatant: "combatant-1",
    initiative: 7,
    round: 3,
    time: 100,
    turn: 1
  },
  duration: { value: 1, units: "rounds", expiry: "roundEnd", expired: false },
  flags: { "peasant-core": { guardBroken: true } },
  changes: [{ key: "system.defensiveReflexes.toHit", mode: 2, value: 4, priority: 20 }]
});

const { getNotableCombatRollPreview } = await import("../module/data/actor/combat-roll-preview.mjs");
const guardBrokenActor = {
  system: {},
  effects: [guardBrokenSource]
};
const defenseEntry = { name: "Reflex", type: "Defense", tohit: 7, accuracy: 0 };
assert.equal(getNotableCombatRollPreview(guardBrokenActor, defenseEntry).modifiedTohit, 7, "ordinary skill use keeps its normal To-Hit");
assert.equal(getNotableCombatRollPreview(guardBrokenActor, defenseEntry, { defenseRoll: true }).modifiedTohit, 11, "the Active Effect change adds four to the defense preview");
const manualModifierActor = {
  system: {},
  effects: [{ disabled: false, changes: [{ key: "system.defensiveReflexes.toHit", mode: 2, value: 2 }] }]
};
assert.equal(getNotableCombatRollPreview(manualModifierActor, defenseEntry, { defenseRoll: true }).modifiedTohit, 9,
  "the defensive To-Hit key works on effects without the Guard-Broken flag");
assert.equal(getNotableCombatRollPreview({
  system: {}, effects: [{ disabled: true, changes: [{ key: "system.defensiveReflexes.toHit", mode: 2, value: 4 }] }]
}, defenseEntry, { defenseRoll: true }).modifiedTohit, 7, "disabled effect changes do not apply");
const dialogInstances = [];
globalThis.foundry = {
  utils: { deepClone: structuredClone },
  applications: { api: { DialogV2: class {
    constructor(config) { this.config = config; dialogInstances.push(this); }
    render() { return Promise.resolve(this); }
  } } }
};
globalThis.game = {
  user: { id: "defender", isGM: false },
  users: [{ id: "defender", active: true, isGM: false }],
  actors: new Map()
};
const { getActorAoeReflexSaveTn } = await import("../module/applications/combat/aoe-reflex-save.mjs");
assert.equal(getActorAoeReflexSaveTn({
  system: { reflexAoeSaveEnabled: true, reflexAoeSaveTarget: 9 },
  items: [],
  effects: [guardBrokenSource]
}), 9, "defensive skill modifiers do not change Reflex saves");
globalThis.window = { innerWidth: 480, setInterval: () => 1, clearInterval() {} };
globalThis.ui = { notifications: { warn() {} } };
globalThis.$ = () => ({
  find: (selector) => ({
    val: () => selector.includes("defenseCombatIndex") ? "0:base"
      : selector.includes("defensePreviewToHit") ? "11" : "0"
  })
});
const { showDefensePromptDialog } = await import("../module/applications/combat/defense-prompt-dialog.mjs");
const defender = {
  id: "defender",
  name: "Defender",
  system: {
    combatMods: {},
    notableCombats: [{ ...defenseEntry, id: "reflex-id", defense: { responses: ["Melee"] } }]
  },
  effects: guardBrokenActor.effects,
  getFlag: () => ({ melee: { index: 0, name: "Reflex" } })
};
game.actors.set(defender.id, defender);
let defenseRollToHit = null;
const defensePromptPromise = showDefensePromptDialog({
  targetActorId: defender.id,
  attackCombatName: "Attack",
  attackTargetingType: "Melee"
}, {
  rollNotableCombat: async (options) => {
    defenseRollToHit = options.rollOverrides.toHit;
    return { rolled: true, rollResult: { isSuccess: true, totalMoS: 1 } };
  }
});
await new Promise((resolve) => setTimeout(resolve, 0));
await dialogInstances.at(-1).config.buttons.find((button) => button.action === "roll").callback({}, null, dialogInstances.at(-1));
assert.equal((await defensePromptPromise).activeDefense, true);
assert.equal(defenseRollToHit, 11, "the actual Defensive Reflex roll receives the same +4 preview modifier");

delete globalThis.ActiveEffect;
delete globalThis.foundry;
delete globalThis.game;
delete globalThis.window;
delete globalThis.ui;
delete globalThis.$;

console.log("E5 Guard-Broken tests passed.");
