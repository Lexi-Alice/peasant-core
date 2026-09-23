import assert from "node:assert/strict";

const refreshCalls = [];
let refreshFinished = false;
let basePreDeleteCalled = false;
let basePreDeleteOperationCalled = false;
const effects = [
  { expiry: null, startRound: 1, value: 3, remaining: 1, deleted: false },
  { expiry: "roundEnd", startRound: 1, value: 3, remaining: 1, deleted: false }
];

globalThis.Combat = class {
  static async _preDeleteOperation() {
    basePreDeleteOperationCalled = true;
    return true;
  }

  async nextRound() {
    this.round += 1;
    this.turn = 0;
    return this;
  }

  async _preDelete() {
    basePreDeleteCalled = true;
    return true;
  }
};
globalThis.Combatant = class {};
globalThis.ActiveEffect = {
  implementation: {
    getEffectStart: () => ({
      time: 100,
      combat: null,
      combatant: null,
      initiative: null,
      round: null,
      turn: null
    })
  }
};
globalThis.foundry = {
  documents: {
    ActiveEffect: {
      registry: {
        async refresh(event, context) {
          refreshCalls.push({ event, context });
          if (event === "updateWorldTime") {
            for (const effect of effects) {
              effect.remaining = effect.value - (context.round - effect.startRound);
            }
          }
          for (const effect of effects) {
            const expiryReached = effect.expiry ? effect.expiry === event : event === "updateWorldTime";
            if (effect.remaining <= 0 && expiryReached) effect.deleted = true;
          }
          await Promise.resolve();
          refreshFinished = effects.every((effect) => effect.deleted);
        }
      }
    }
  }
};
globalThis.game = { user: { id: "gm", isActiveGM: true }, time: { worldTime: 100 } };
globalThis.ui = { notifications: { info() {}, warn() {} } };

const { PeasantCombat } = await import("../module/documents/combat.mjs");

const combatant = {
  id: "cyrus",
  name: "Cyrus Cord",
  initiative: 8,
  getFlag() { return 0; }
};
const combatants = [combatant];
combatants.get = (id) => combatants.find((entry) => entry.id === id);

const flags = new Map();
const combat = {
  round: 3,
  turn: 0,
  combatant,
  combatants,
  setupTurns() {},
  getFlag(scope, key) {
    return flags.get(`${scope}.${key}`);
  },
  async setFlag(scope, key, value) {
    flags.set(`${scope}.${key}`, value);
  },
  async updateEmbeddedDocuments() {
    assert.equal(refreshFinished, true, "Native expiry refresh should finish before initiative resets");
  },
  async update(changes) {
    Object.assign(this, changes);
  }
};

await PeasantCombat.prototype.nextRound.call(combat);

assert.deepEqual(
  refreshCalls.map(({ event }) => event),
  ["updateWorldTime", "roundEnd"],
  "Peasant round advancement should recalculate durations before applying round-end expiry"
);
assert.equal(refreshCalls[0].context.combat, combat);
assert.equal(refreshCalls[0].context.round, 4);
assert.equal(refreshCalls[1].context.combat, combat);
assert.equal(refreshCalls[1].context.round, 3);
assert.equal(effects.every((effect) => effect.deleted), true, "Effects reaching zero should expire at this boundary");

let carryoverUpdates = null;
const endingActor = {
  id: "ending-actor",
  uuid: "Actor.ending-actor",
  effects: [{
    id: "carried-effect",
    type: "base",
    disabled: false,
    _source: {
      start: { combat: "ending-combat" },
      duration: { value: 3, units: "rounds", expiry: "roundEnd", expired: false }
    },
    duration: { value: 3, units: "rounds", remaining: 2, expiry: "roundEnd", expired: false },
    updateDuration() {
      return this.duration;
    }
  }],
  async updateEmbeddedDocuments(documentName, updates) {
    assert.equal(documentName, "ActiveEffect");
    carryoverUpdates = updates;
  }
};
const endingCombat = {
  id: "ending-combat",
  round: 2,
  turn: 0,
  combatants: [{ actorId: endingActor.id, actor: endingActor }]
};
await PeasantCombat.prototype._preDelete.call(endingCombat, {}, game.user);
assert.equal(basePreDeleteCalled, true);
assert.equal(carryoverUpdates, null, "Individual pre-delete must not mutate effects before cancellation hooks run");

await PeasantCombat._preDeleteOperation([endingCombat], {}, game.user);
assert.equal(basePreDeleteOperationCalled, true);
assert.deepEqual(carryoverUpdates, [{
  _id: "carried-effect",
  start: { time: 100, combat: null, combatant: null, initiative: null, round: null, turn: null },
  duration: { value: 2, units: "rounds", expiry: "roundEnd", expired: false }
}]);

game.user.isActiveGM = false;
await PeasantCombat.prototype.nextRound.call(combat);
assert.equal(refreshCalls.length, 2, "A secondary GM should leave native expiry handling to the active GM");

delete globalThis.Combat;
delete globalThis.Combatant;
delete globalThis.ActiveEffect;
delete globalThis.foundry;
delete globalThis.game;
delete globalThis.ui;

console.log("combat active effect round-end tests passed");
