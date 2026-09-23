import assert from "node:assert/strict";

globalThis.Actor = class {};

const {
  resolveResistanceDamageStage
} = await import("../module/data/active-effect/spell-effects.mjs");
const { PeasantActor } = await import("../module/documents/actor.mjs");
const { applyTargetedDamageWorkflow } = await import("../module/applications/combat/targeted-damage-workflow.mjs");
const { buildManifestSpellEffectChanges } = await import("../module/data/active-effect/spell-effect-change-keys.mjs");

assert.deepEqual(resolveResistanceDamageStage({
  damage: 12,
  naturalHalt: 2,
  armorHalt: 4,
  isArmorPenetrating: false,
  resistanceHp: 3
}), {
  damage: 12,
  naturalHaltUsed: 2,
  armorHaltUsed: 4,
  haltUsed: 6,
  damageAfterHalt: 6,
  absorbed: 3,
  penetration: 3,
  remainingHp: 0,
  depleted: true
});

assert.deepEqual(resolveResistanceDamageStage({
  damage: 12,
  naturalHalt: 2,
  armorHalt: 4,
  isArmorPenetrating: true,
  resistanceHp: 3
}), {
  damage: 12,
  naturalHaltUsed: 2,
  armorHaltUsed: 0,
  haltUsed: 2,
  damageAfterHalt: 10,
  absorbed: 3,
  penetration: 7,
  remainingHp: 0,
  depleted: true
});

assert.equal(resolveResistanceDamageStage({
  damage: 12,
  naturalHalt: 2,
  armorHalt: 4,
  ignoreHaltReduction: true,
  resistanceHp: 3
}).penetration, 9);

function resistanceEffect(actor, hp, { removePreparedHalt = false, encounterId = "combat" } = {}) {
  const effect = {
    id: `resistance-${hp}`,
    type: "spellEffect",
    disabled: false,
    duration: { expired: false, remaining: null, value: null },
    changes: buildManifestSpellEffectChanges({
      manifestType: "resistance",
      hp: { value: hp, max: hp }
    }),
    system: { encounterId },
    async update(changes) {
      this.changes = structuredClone(changes.changes ?? changes["system.changes"]);
    },
    async delete() {
      actor.effects = actor.effects.filter((entry) => entry !== this);
      if (removePreparedHalt) actor.system.naturalHaltValues = "0/0/0/0";
    }
  };
  actor.effects = [effect];
  return effect;
}

function simplifiedActor({ naturalHalt = "0/0/0/0", armorHalt = "0/0/0/0" } = {}) {
  const actor = new PeasantActor();
  actor.type = "character";
  actor.system = {
    haltValues: armorHalt,
    naturalHaltValues: naturalHalt,
    combatMods: { haltBuffs: [] },
    health: { value: 20, max: 20 },
    temporaryHp: { value: 0, max: 0 },
    bolsteredHp: 0,
    conditions: {}
  };
  actor.effects = [];
  actor.getFlag = (_scope, key) => key === "simplifiedHp" ? true : undefined;
  actor._applyPeasantSimplifiedHpDamageValue = async (scaledDamage) => {
    actor.lastScaledDamage = scaledDamage;
    return { ok: true, value: 20 - scaledDamage, scaledDamage, tempUsed: 0, bolsteredUsed: 0 };
  };
  return actor;
}

const targeted = simplifiedActor({ naturalHalt: "0/0/0/2", armorHalt: "0/0/0/9" });
resistanceEffect(targeted, 3);
const targetedResult = await targeted.applyPeasantTargetedDamage({
  amount: 10,
  type: "hybrid",
  location: "Torso",
  isAP: true
});
assert.equal(targetedResult.haltUsed, 2);
assert.equal(targetedResult.resistance.absorbed, 3);
assert.equal(targetedResult.netDamage, 5);
assert.equal(targeted.lastScaledDamage, 7, "Hybrid conversion and hard-location conversion must occur after Resistance reduces the numeric damage to 5");

const deleting = simplifiedActor({ naturalHalt: "0/0/0/1" });
resistanceEffect(deleting, 1, { removePreparedHalt: true });
const deletingResult = await deleting.applyPeasantTargetedDamage({ amount: 2, type: "blunt", location: "Torso" });
assert.equal(deletingResult.haltUsed, 1, "The depleting hit must retain Resistance's prepared +1 HALT");
assert.equal(deletingResult.resistance.depleted, true);
assert.equal(deletingResult.resistance.remainingDuration, "Duress");
assert.equal(deleting.effects.length, 0);
assert.equal(deleting.lastScaledDamage, 0);

const pending = simplifiedActor();
resistanceEffect(pending, 2, { encounterId: "" });
const pendingResult = await pending.applyPeasantTargetedDamage({ amount: 1, type: "blunt", location: "Torso" });
assert.equal(pendingResult.resistance.remainingDuration, "Duress", "Resistance damage cards always use its Duress duration");

const locationless = simplifiedActor();
resistanceEffect(locationless, 2);
const locationlessResult = await locationless.applyPeasantLocationlessDamage({ amount: 6, type: "lethal" });
assert.equal(locationlessResult.haltUsed, 0);
assert.equal(locationlessResult.resistance.penetration, 4);
assert.equal(locationless.lastScaledDamage, 8);

const generic = simplifiedActor();
resistanceEffect(generic, 2);
const genericResult = await generic.applyPeasantDamage(6, "lethal", false);
assert.equal(genericResult.resistance.penetration, 4);
assert.equal(generic.lastScaledDamage, 8);

let cardContent = "";
globalThis.game = { user: { id: "user" } };
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
    haltUsed: 1,
    netDamage: 0,
    damageToGrid: 1,
    locationDisplay: "Torso",
    normalizedType: "blunt",
    isHybrid: false,
    tempHpUsed: 0,
    bolsteredHpUsed: 0,
    events: ["Damage Applied"],
    resistance: { absorbed: 4, penetration: 0, remainingHp: 3, depleted: false }
  })
}, { amount: 5, type: "blunt", location: "Torso" });
assert.equal(cardResult.chatMessage.id, "message");
assert.doesNotMatch(cardContent, /Resistance (?:Absorbed|Penetration|Magical HP|Depleted):/);

delete globalThis.Actor;
delete globalThis.game;
delete globalThis.ChatMessage;

console.log("manifest resistance damage tests passed");
