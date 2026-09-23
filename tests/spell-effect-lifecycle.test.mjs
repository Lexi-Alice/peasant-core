import assert from "node:assert/strict";

globalThis.ActiveEffect = {
  implementation: {
    getEffectStart: (combat) => ({
      time: 120,
      combat: combat?.id || null,
      combatant: combat?.combatant?.id ?? null,
      initiative: combat?.combatant?.initiative ?? null,
      round: combat?.round ?? null,
      turn: combat?.turn ?? null
    })
  }
};

const {
  configurePeasantSpellEffectLifecycle,
  formatSpellEffectSubtitle,
  getCombatDurationCarryoverUpdate,
  getPendingCombatDurationEnrollment,
  getPendingSpellEffectEnrollment,
  shouldRemoveSpellEffectForCombat
} = await import("../module/data/active-effect/spell-effect-lifecycle.mjs");
const { MANIFEST_SPELL_EFFECT_CHANGE_KEYS, buildManifestSpellEffectChanges } = await import("../module/data/active-effect/spell-effect-change-keys.mjs");

function spellEffect({
  id = "effect",
  manifestType = "dome",
  encounterId = "",
  value = 12,
  max = 24,
  remaining = null,
  durationValue = manifestType === "dome" ? 3 : null,
  manifestDuration = null,
  expiry = null,
  startRound = null,
  expired = false,
  disabled = false
} = {}) {
  return {
    id,
    type: "spellEffect",
    disabled,
    start: { round: startRound },
    duration: { value: durationValue, remaining, expiry, expired },
    changes: buildManifestSpellEffectChanges({ manifestType, hp: { value, max } }),
    system: { encounterId },
    flags: { "peasant-core": { manifestDuration } }
  };
}

function baseEffect({
  id = "base-effect",
  value = 3,
  units = "rounds",
  remaining = value,
  expiry = "roundEnd",
  startCombat = null,
  sourceCombat = null,
  expired = false,
  disabled = false
} = {}) {
  return {
    id,
    type: "base",
    disabled,
    _source: {
      start: { combat: sourceCombat },
      duration: { value, units, expiry, expired }
    },
    start: { combat: startCombat },
    duration: { value, units, remaining, expiry, expired },
    updateDuration() {
      return this.duration;
    }
  };
}

const actor = { id: "actor", uuid: "Actor.actor" };
const unrelatedCombat = {
  id: "unrelated",
  round: 1,
  turn: 0,
  combatants: [{ actorId: "other", actor: { id: "other", uuid: "Actor.other" } }]
};
const combat = {
  id: "combat",
  round: 1,
  turn: 0,
  combatants: [{ actorId: actor.id, actor }]
};
const previousCombat = { id: "previous", round: 2, turn: 0 };

const carriedEffect = baseEffect({
  id: "carried-effect",
  value: 3,
  remaining: 2,
  sourceCombat: previousCombat.id
});
let carryoverContext = null;
carriedEffect.updateDuration = (context) => {
  carryoverContext = context;
  return carriedEffect.duration;
};
assert.deepEqual(
  getCombatDurationCarryoverUpdate(carriedEffect, previousCombat),
  {
    _id: "carried-effect",
    start: { time: 120, combat: null, combatant: null, initiative: null, round: null, turn: null },
    duration: { value: 2, units: "rounds", expiry: "roundEnd", expired: false }
  }
);
assert.equal(carryoverContext.combat, previousCombat);
assert.equal(carryoverContext.round, 2);
assert.equal(carryoverContext.turn, 0);

assert.equal(getCombatDurationCarryoverUpdate(
  baseEffect({ sourceCombat: "other" }), previousCombat
), null);
assert.equal(getCombatDurationCarryoverUpdate(
  baseEffect({ sourceCombat: previousCombat.id, disabled: true }), previousCombat
), null);
assert.equal(getCombatDurationCarryoverUpdate(
  baseEffect({ sourceCombat: previousCombat.id, expired: true }), previousCombat
), null);
assert.equal(getCombatDurationCarryoverUpdate(
  baseEffect({ sourceCombat: previousCombat.id, remaining: 0 }), previousCombat
), null);
assert.equal(getCombatDurationCarryoverUpdate(
  baseEffect({ sourceCombat: previousCombat.id, units: "seconds" }), previousCombat
), null);
assert.equal(getCombatDurationCarryoverUpdate(
  baseEffect({ sourceCombat: previousCombat.id, expiry: "combatEnd" }), previousCombat
), null);

const carriedDome = spellEffect({
  id: "carried-dome",
  encounterId: previousCombat.id,
  durationValue: 5,
  manifestDuration: 5,
  remaining: 2,
  expiry: "roundEnd"
});
carriedDome._source = {
  start: { combat: previousCombat.id },
  duration: { value: 5, units: "rounds", expiry: "roundEnd", expired: false }
};
Object.assign(carriedDome.duration, { units: "rounds" });
carriedDome.updateDuration = () => carriedDome.duration;
assert.deepEqual(getCombatDurationCarryoverUpdate(carriedDome, previousCombat), {
  _id: "carried-dome",
  "system.encounterId": "",
  start: { time: 120, combat: null, combatant: null, initiative: null, round: null, turn: null },
  duration: { value: 2, units: "rounds", expiry: "roundEnd", expired: false }
});

const pendingCarriedDome = spellEffect({
  id: "pending-carried-dome",
  durationValue: 2,
  manifestDuration: 5
});
assert.equal(getPendingSpellEffectEnrollment(pendingCarriedDome, actor, combat).duration.value, 2);

assert.deepEqual(getPendingCombatDurationEnrollment(baseEffect(), actor, combat), {
  _id: "base-effect",
  start: { time: 120, combat: "combat", combatant: null, initiative: null, round: 1, turn: 0 }
});
assert.equal(getPendingCombatDurationEnrollment(baseEffect({ units: "seconds" }), actor, combat), null);
assert.equal(getPendingCombatDurationEnrollment(baseEffect({ value: 0 }), actor, combat), null);
assert.equal(getPendingCombatDurationEnrollment(baseEffect({ startCombat: "other" }), actor, combat), null);
assert.equal(getPendingCombatDurationEnrollment(baseEffect({ sourceCombat: "previous" }), actor, combat), null);
assert.equal(getPendingCombatDurationEnrollment(baseEffect({ expired: true }), actor, combat), null);
assert.equal(getPendingCombatDurationEnrollment(baseEffect({ disabled: true }), actor, combat), null);
assert.equal(getPendingCombatDurationEnrollment(baseEffect(), actor, unrelatedCombat), null);

const pendingDome = spellEffect({ id: "dome" });
assert.equal(getPendingSpellEffectEnrollment(pendingDome, actor, unrelatedCombat), null);
assert.deepEqual(getPendingSpellEffectEnrollment(pendingDome, actor, combat), {
  _id: "dome",
  "system.encounterId": "combat",
  start: { time: 120, combat: "combat", combatant: null, initiative: null, round: 1, turn: 0 },
  duration: { value: 3, units: "rounds", expiry: "roundEnd", expired: false }
});

const shortenedPendingDome = spellEffect({ id: "short", remaining: 1 });
assert.equal(getPendingSpellEffectEnrollment(shortenedPendingDome, actor, combat).duration.value, 3);

const extendedPendingDome = spellEffect({ id: "extended", durationValue: null, manifestDuration: 5 });
assert.equal(getPendingSpellEffectEnrollment(extendedPendingDome, actor, combat).duration.value, 5);

const pendingResistance = spellEffect({ id: "resistance", manifestType: "resistance", value: 6, max: 12 });
assert.deepEqual(getPendingSpellEffectEnrollment(pendingResistance, actor, combat), {
  _id: "resistance",
  "system.encounterId": "combat",
  start: { time: 120, combat: "combat", combatant: null, initiative: null, round: 1, turn: 0 },
  duration: { value: null, units: "rounds", expiry: "combatEnd", expired: false }
});

assert.equal(getPendingSpellEffectEnrollment(spellEffect({ disabled: true }), actor, combat), null);
assert.equal(getPendingSpellEffectEnrollment(spellEffect({ encounterId: "other" }), actor, combat), null);

const expiredDome = spellEffect({ encounterId: "combat", expired: true });
assert.equal(shouldRemoveSpellEffectForCombat(expiredDome, combat, "combatRound"), false);
assert.equal(shouldRemoveSpellEffectForCombat(expiredDome, unrelatedCombat, "combatRound"), false);

const elapsedDome = spellEffect({ encounterId: "combat", startRound: 1 });
combat.round = 3;
assert.equal(shouldRemoveSpellEffectForCombat(elapsedDome, combat, "combatRound"), false);
combat.round = 4;
assert.equal(shouldRemoveSpellEffectForCombat(elapsedDome, combat, "combatRound"), false);

const boundResistance = spellEffect({ manifestType: "resistance", encounterId: "combat" });
assert.equal(shouldRemoveSpellEffectForCombat(boundResistance, combat, "combatEnd"), true);
assert.equal(shouldRemoveSpellEffectForCombat(boundResistance, combat, "deleteCombat"), true);
assert.equal(shouldRemoveSpellEffectForCombat(boundResistance, unrelatedCombat, "deleteCombat"), false);
assert.equal(shouldRemoveSpellEffectForCombat(boundResistance, combat, "combatRound"), false);
const nativeBoundResistance = spellEffect({ manifestType: "resistance", encounterId: "combat", expiry: "combatEnd" });
assert.equal(shouldRemoveSpellEffectForCombat(nativeBoundResistance, combat, "combatEnd"), false);

const mageBarrier = {
  id: "mage-barrier",
  type: "spellEffect",
  duration: { value: null, units: "rounds", expiry: "combatEnd", expired: false },
  system: { encounterId: "" },
  changes: [
    { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp, type: "add", value: 6 },
    { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.maximumHp, type: "override", value: 20 }
  ],
  flags: { "peasant-core": { mageBlockBarrier: true, mageBlockDuress: true, mageBlockDefenseId: "mage-entry" } }
};
assert.equal(formatSpellEffectSubtitle(mageBarrier), "Mage Block - 6/20 HP - Pending Combat");
assert.deepEqual(getPendingSpellEffectEnrollment(mageBarrier, actor, combat), {
  _id: "mage-barrier",
  "system.encounterId": "combat",
  start: { time: 120, combat: "combat", combatant: null, initiative: null, round: 4, turn: 0 },
  duration: { value: null, units: "rounds", expiry: "combatEnd", expired: false }
}, "the HP-bearing Mage effect enrolls as Manifest Resistance when combat starts");
assert.equal(shouldRemoveSpellEffectForCombat({ ...mageBarrier, system: { encounterId: "combat" } }, combat, "combatEnd"), false,
  "the combined Mage effect keeps its native combatEnd duration just like Manifest Resistance");
assert.equal(
  formatSpellEffectSubtitle(pendingDome),
  "Dome - 12 Magical HP - Pending Combat"
);
assert.equal(
  formatSpellEffectSubtitle(spellEffect({ encounterId: "combat", remaining: 2 })),
  "Dome - 12 Magical HP - 2 Rounds"
);
assert.equal(
  formatSpellEffectSubtitle(boundResistance),
  "Resistance - 12 Magical HP - Duress"
);
assert.equal(formatSpellEffectSubtitle({ type: "base" }), "");

const lifecycleHooks = new Map();
globalThis.Hooks = {
  on: (event, callback) => lifecycleHooks.set(event, callback)
};
globalThis.game = {
  user: { id: "gm" },
  users: [{ id: "gm", active: true, isGM: true }]
};
configurePeasantSpellEffectLifecycle();

assert.equal(lifecycleHooks.has("updateActiveEffect"), false);

let enrollmentUpdates = null;
const startingActor = {
  ...actor,
  effects: [baseEffect({ id: "starting-effect" })],
  updateEmbeddedDocuments: async (documentName, updates) => {
    assert.equal(documentName, "ActiveEffect");
    enrollmentUpdates = updates;
  }
};
const startingCombat = {
  id: "starting-combat",
  round: 1,
  turn: 0,
  started: true,
  combatants: [{ actorId: startingActor.id, actor: startingActor }]
};
lifecycleHooks.get("updateCombat")(startingCombat, { round: 1, turn: 0 });
await Promise.resolve();
assert.deepEqual(enrollmentUpdates, [{
  _id: "starting-effect",
  start: { time: 120, combat: "starting-combat", combatant: null, initiative: null, round: 1, turn: 0 }
}]);

enrollmentUpdates = null;
const joiningActor = {
  ...actor,
  effects: [baseEffect({ id: "joining-effect", units: "turns", value: 2 })],
  updateEmbeddedDocuments: async (documentName, updates) => {
    assert.equal(documentName, "ActiveEffect");
    enrollmentUpdates = updates;
  }
};
const startedCombat = {
  id: "started-combat",
  round: 2,
  turn: 1,
  started: true,
  combatants: [{ actorId: joiningActor.id, actor: joiningActor }]
};
await lifecycleHooks.get("createCombatant")({ parent: startedCombat });
await Promise.resolve();
assert.deepEqual(enrollmentUpdates, [{
  _id: "joining-effect",
  start: { time: 120, combat: "started-combat", combatant: null, initiative: null, round: 2, turn: 1 }
}]);

delete globalThis.Hooks;
delete globalThis.game;
delete globalThis.ActiveEffect;

console.log("spell effect lifecycle tests passed");
