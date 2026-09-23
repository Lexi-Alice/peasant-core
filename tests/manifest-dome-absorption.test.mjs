import assert from "node:assert/strict";

globalThis.Actor = class {};
globalThis.foundry = {
  utils: {
    randomID: () => "undo-id",
    deepClone: (value) => JSON.parse(JSON.stringify(value))
  }
};
globalThis.CONST = {
  ACTIVE_EFFECT_MODES: { CUSTOM: 0, ADD: 2, OVERRIDE: 5 },
  DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }
};

const {
  applyManifestDomeAbsorption,
  requestManifestDomeAbsorptionForTarget
} = await import("../module/applications/combat/manifest-spell-effects.mjs");
const { initializePeasantSockets } = await import("../module/socket/remote-prompts.mjs");
const { PeasantActor } = await import("../module/documents/actor.mjs");
const { applyTargetedDamageWorkflow } = await import("../module/applications/combat/targeted-damage-workflow.mjs");
const {
  buildManifestSpellEffectChanges,
  getManifestSpellEffectChanges,
  getManifestSpellEffectState
} = await import("../module/data/active-effect/spell-effect-change-keys.mjs");

function barrierEffect(actor, manifestType, hp) {
  const effect = {
    id: manifestType,
    type: "spellEffect",
    disabled: false,
    duration: { expired: false, remaining: 2, value: 3 },
    changes: buildManifestSpellEffectChanges({ manifestType, hp: { value: hp, max: hp } }),
    system: { encounterId: "combat" },
    toObject() {
      return {
        _id: this.id,
        type: this.type,
        disabled: this.disabled,
        duration: { ...this.duration },
        changes: JSON.parse(JSON.stringify(this.changes)),
        system: JSON.parse(JSON.stringify(this.system))
      };
    },
    async update(changes) {
      this.changes = JSON.parse(JSON.stringify(changes.changes ?? changes["system.changes"]));
    },
    async delete() {
      actor.effects = actor.effects.filter((entry) => entry !== this);
    }
  };
  actor.effects.push(effect);
  return effect;
}

const target = {
  id: "target",
  uuid: "Actor.target",
  name: "Target",
  system: { _source: {} },
  effects: [],
  canUserModify: () => true
};
const dome = barrierEffect(target, "dome", 4);
globalThis.game = {
  user: { id: "user", isGM: true },
  actors: new Map([[target.id, target]]),
  users: [],
  scenes: new Map()
};
globalThis.canvas = { tokens: { controlled: [] } };
globalThis.ChatMessage = {
  applyMode: (data) => data,
  getSpeaker: () => ({}),
  create: async () => ({ id: "message" })
};
const { resolveSuccessfulAttackDamageForTarget } = await import("../module/applications/combat/successful-attack-damage.mjs");

const penetration = await applyManifestDomeAbsorption({
  targetActorId: target.id,
  targetName: target.name,
  damage: 9,
  damageType: "lethal"
});
assert.equal(penetration.handled, true);
assert.equal(penetration.applied, true);
assert.equal(penetration.absorbed, 4);
assert.equal(penetration.penetration, 5);
assert.equal(penetration.damageType, "lethal");
assert.equal(penetration.depleted, true);
assert.equal(penetration.remainingDuration, "2 Rounds");
assert.equal(penetration.magnetismGrade, 1);
assert.equal(target.effects.includes(dome), false);
assert.equal(penetration.undoRecords.length, 1);

const noDome = await applyManifestDomeAbsorption({
  targetActorId: target.id,
  damage: 7,
  damageType: "critical"
});
assert.equal(noDome.applied, false);
assert.equal(noDome.penetration, 7);
assert.equal(noDome.magnetismGrade, 0);

barrierEffect(target, "dome", 10);
const absorbed = await applyManifestDomeAbsorption({
  targetActorId: target.id,
  damage: 3,
  damageType: "blunt"
});
assert.equal(absorbed.penetration, 0);
assert.equal(absorbed.magnetismGrade, 0);
const activeDome = target.effects.find((effect) => effect.id === "dome");
assert.equal(getManifestSpellEffectState(activeDome).magicalHp.value, 7);
const currentHpChanges = getManifestSpellEffectChanges(activeDome)
  .filter((change) => change.key === "effect.system.magicalHp.value");
assert.equal(currentHpChanges.length, 1);
assert.equal(currentHpChanges[0].mode, CONST.ACTIVE_EFFECT_MODES.ADD);
assert.equal(currentHpChanges[0].value, 7);

const remoteActor = {
  id: "remote",
  uuid: "Actor.remote",
  name: "Remote",
  effects: [],
  canUserModify: () => false,
  testUserPermission: () => true
};
game.user = { id: "requester", isGM: false };
game.users = [{ id: "owner", active: true, isGM: false }];
let rawSocketEmits = 0;
game.socket = { emit: () => { rawSocketEmits += 1; } };
globalThis.Hooks = { once() {} };
initializePeasantSockets();
const rawFallback = await game.peasantCore.absorbManifestDomeForUser("owner", {
  targetActorId: remoteActor.id,
  damage: 5,
  damageType: "hybrid"
});
assert.equal(rawFallback.handled, false);
assert.match(rawFallback.reason, /response unavailable/i);
assert.equal(rawSocketEmits, 0);

const ambiguous = await requestManifestDomeAbsorptionForTarget({
  target: { actor: remoteActor, targetName: "Remote" },
  damage: 5,
  damageType: "hybrid"
});
assert.equal(ambiguous.applied, false);
assert.match(ambiguous.reason, /Socket response unavailable/);

function simplifiedActor() {
  const actor = new PeasantActor();
  actor.type = "character";
  actor.system = {
    haltValues: "0/0/0/0",
    naturalHaltValues: "0/0/0/0",
    combatMods: { haltBuffs: [] },
    health: { value: 30, max: 30 },
    temporaryHp: { value: 0, max: 0 },
    bolsteredHp: 0,
    conditions: {}
  };
  actor.effects = [];
  actor.getFlag = (_scope, key) => key === "simplifiedHp" ? true : undefined;
  actor._applyPeasantSimplifiedHpDamageValue = async (scaledDamage) => ({
    ok: true,
    value: 30 - scaledDamage,
    scaledDamage,
    tempUsed: 0,
    bolsteredUsed: 0
  });
  return actor;
}

const smiteTarget = simplifiedActor();
smiteTarget.id = "smite-target";
smiteTarget.uuid = "Actor.smite-target";
smiteTarget.name = "Smite Target";
const smiteDome = barrierEffect(smiteTarget, "dome", 10);
game.actors.set(smiteTarget.id, smiteTarget);
game.user = { id: "user", isGM: true };
game.users = [{ id: "user", active: true, isGM: true }];
let smiteDamageApplied = 0;
let smiteDomeBypassed = false;
const smiteApplyTargetedDamage = smiteTarget.applyPeasantTargetedDamage.bind(smiteTarget);
smiteTarget.applyPeasantTargetedDamage = async (options = {}) => {
  smiteDomeBypassed = options.domeAlreadyResolved;
  return smiteApplyTargetedDamage(options);
};
smiteTarget._applyPeasantSimplifiedHpDamageValue = async (damage) => {
  smiteDamageApplied = damage;
  return { ok: true, value: 30 - damage, scaledDamage: damage, tempUsed: 0, bolsteredUsed: 0 };
};
const smiteResult = await resolveSuccessfulAttackDamageForTarget({
  actor: { id: "attacker", name: "Attacker", system: { combatMods: {} } },
  combat: {
    name: "Smite",
    targetingType: "Smite",
    magnetism: { grade: 1 },
    overkill: true,
    damage: { diceCount: 0, diceValue: 0, flat: 5, type: "blunt" }
  },
  target: { actor: smiteTarget, targetName: smiteTarget.name },
  attackRoll: { rollResult: { isSuccess: true, totalMoS: 0 } }
});
assert.equal(smiteResult?.handled, true, "A successful Smite should still resolve damage with an active Dome");
assert.equal(smiteDamageApplied, 5, "Smite should apply its full damage instead of Dome-penetrated damage");
assert.equal(smiteDomeBypassed, true, "Smite damage application should bypass the actor-side Dome stage");
assert.equal(smiteResult.application.applyResult.dome.reason, "alreadyResolved");
assert.equal(smiteResult.dome, undefined, "Smite should not produce a Dome resolution result");
assert.equal(smiteResult.damageRoll.barrierMessages.length, 0, "Smite should not publish a Dome barrier card");
assert.equal(getManifestSpellEffectState(smiteDome).magicalHp.value, 10, "Smite should not consume Manifest Dome HP");

for (const method of ["targeted", "locationless", "generic"]) {
  const actor = simplifiedActor();
  barrierEffect(actor, "dome", 3);
  barrierEffect(actor, "resistance", 2);
  let result;
  if (method === "targeted") {
    result = await actor.applyPeasantTargetedDamage({ amount: 10, type: "blunt", location: "Torso" });
  } else if (method === "locationless") {
    result = await actor.applyPeasantLocationlessDamage({ amount: 10, type: "blunt" });
  } else {
    result = await actor.applyPeasantDamage(10, "blunt", false);
  }
  assert.equal(result.dome.absorbed, 3, `${method} damage should consume Dome first`);
  assert.equal(result.resistance.absorbed, 2, `${method} damage should consume Resistance second`);
  assert.equal(result.resistance.penetration, 5);
}

const alreadyResolved = simplifiedActor();
const preservedDome = barrierEffect(alreadyResolved, "dome", 8);
const alreadyResolvedResult = await alreadyResolved.applyPeasantTargetedDamage({
  amount: 5,
  type: "blunt",
  location: "Torso",
  domeAlreadyResolved: true
});
assert.equal(alreadyResolvedResult.dome.reason, "alreadyResolved");
assert.equal(getManifestSpellEffectState(preservedDome).magicalHp.value, 8);

let cardContent = "";
game.user = { id: "user", isGM: true };
globalThis.ChatMessage = {
  getSpeaker: () => ({}),
  create: async (data) => {
    cardContent = data.content;
    return { id: "message" };
  }
};
const cardResult = await applyTargetedDamageWorkflow({
  applyPeasantTargetedDamage: async () => ({
    ok: true,
    haltUsed: 0,
    netDamage: 0,
    damageToGrid: 1,
    locationDisplay: "Torso",
    normalizedType: "blunt",
    isHybrid: false,
    tempHpUsed: 0,
    bolsteredHpUsed: 0,
    devastatingWoundsGained: 2,
    breakCriticalDamage: 10,
    events: ["Damage Applied"],
    dome: { absorbed: 5, penetration: 0, remainingHp: 3, depleted: false },
    resistance: { absorbed: 0, penetration: 0, remainingHp: 0, depleted: false }
  })
}, { amount: 5, type: "blunt", location: "Torso" });
assert.equal(cardResult.chatMessage.id, "message");
assert.doesNotMatch(cardContent, /Dome (?:Absorbed|Penetration|Magical HP|Depleted):/);
assert.match(cardContent, /Devastating Wounds Gained: 2/);
assert.match(cardContent, /Threshold Break Critical Damage: 10/);

delete globalThis.Actor;
delete globalThis.foundry;
delete globalThis.CONST;
delete globalThis.game;
delete globalThis.ChatMessage;

console.log("manifest dome absorption tests passed");
