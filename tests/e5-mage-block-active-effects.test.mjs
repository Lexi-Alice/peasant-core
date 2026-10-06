import assert from "node:assert/strict";

globalThis.Actor ??= class {};
const { PeasantActor } = await import("../module/documents/actor.mjs");
const { getManifestSpellEffectState } = await import("../module/data/active-effect/spell-effect-change-keys.mjs");
const { formatSpellEffectSubtitle } = await import("../module/data/active-effect/spell-effect-lifecycle.mjs");

function applyPatch(target, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((current, key) => current[key] ??= {}, target);
  parent[last] = structuredClone(value);
}

const actor = Object.assign(Object.create(PeasantActor.prototype), {
  id: "mage-owner",
  uuid: "Actor.mage-owner",
  name: "Mage Owner",
  img: "icons/actors/mage-owner.webp",
  system: { notableCombats: [{
    id: "mage-entry",
    name: "Mage Block",
    img: "icons/notables/mage-block.webp",
    defense: { block: true, blockType: "Mage", maxHp: 40 }
  }] },
  effects: [],
  resourceCostCalls: [],
  canUserModify: () => true,
  testUserPermission: () => true,
  async applyPeasantCombatResourceCosts(...args) {
    this.resourceCostCalls.push(structuredClone(args));
    return { ok: true };
  },
  getPeasantNotableCombatsForUpdate() { return structuredClone(this.system.notableCombats); },
  async setPeasantNotableCombats(combats) { this.system.notableCombats = structuredClone(combats); },
  async createEmbeddedDocuments(_type, sources) {
    const created = sources.map((source, index) => {
      const effect = structuredClone(source);
      effect.id = `mage-effect-${this.effects.length + index + 1}`;
      effect._id = effect.id;
      effect._source = structuredClone(effect);
      effect._source._id = effect.id;
      effect.update = async (update) => {
        for (const [path, value] of Object.entries(update)) {
          applyPatch(effect, path, value);
          applyPatch(effect._source, path, value);
        }
      };
      effect.delete = async () => { this.effects = this.effects.filter((current) => current !== effect); };
    effect.system ??= structuredClone(effect._source.system || {});
    this.effects.push(effect);
      return effect;
    });
  return created;
  }
});

const result = await actor.applyPeasantMageBlockBarrierAction({
  action: "create",
  selectedCombatId: "mage-entry"
});
assert.equal(result.ok, true);
assert.equal(actor.resourceCostCalls.length, 0, "Mage Block uses the Notable's ordinary authored resource tag, not a synthetic cost");
assert.equal("hp" in actor.system.notableCombats[0].defense, false, "current barrier HP is not written to the Notable");
assert.equal("mageBarrierInitialized" in actor.system.notableCombats[0].defense, false, "Duress state is not written to the Notable");

const barrier = actor.effects.find((effect) => effect.flags?.["peasant-core"]?.mageBlockBarrier);
const duress = actor.effects.find((effect) => effect.flags?.["peasant-core"]?.mageBlockDuress);
assert.ok(barrier, "creating the barrier stores it in an Active Effect");
assert.equal(barrier.name, "Mage Block Barrier");
assert.equal(barrier.img, "icons/notables/mage-block.webp");
assert.deepEqual(getManifestSpellEffectState(barrier).magicalHp, { value: 40, max: 40 });
assert.equal(actor.effects.length, 1, "out-of-combat creation makes one pending Active Effect");
assert.equal(duress, barrier, "the barrier and Duress marker share one Active Effect");
assert.match(formatSpellEffectSubtitle(barrier), /40\/40 HP - Pending Combat/,
  "the single pending effect keeps displaying barrier HP");

actor.applyPeasantLocationlessDamage = async ({ amount }) => ({ ok: true, amount });
globalThis.game = {
  user: { id: "mage-owner", isGM: false },
  users: [{ id: "mage-owner", active: true, isGM: false }],
  actors: new Map([[actor.id, actor]]),
  peasantCore: {}
};
globalThis.foundry = { utils: { deepClone: structuredClone, randomID: () => "mage-test" } };
globalThis.ChatMessage = {
  getSpeaker: () => ({}),
  create: async (data) => ({ id: "mage-overflow", ...data })
};
const { applyIncomingHit } = await import("../module/applications/combat/incoming-hit-requests.mjs");
const hit = await applyIncomingHit({
  targetActorId: actor.id,
  damageAmount: 48,
  damageType: "blunt",
  mageBlock: { selectedCombatId: "mage-entry", selectedCombatIndex: 0, mageBarrierAction: "use" }
});
assert.equal(hit.overflow, 8);
assert.equal(actor.effects.some((effect) => effect.flags?.["peasant-core"]?.mageBlockBarrier), false,
  "a barrier that reaches zero HP is deleted");
assert.equal(actor.effects.some((effect) => effect.flags?.["peasant-core"]?.mageBlockDuress), false,
  "the Duress marker is deleted with its destroyed barrier");
const mageBlockEffects = actor.effects.filter((effect) => (
  effect.flags?.["peasant-core"]?.mageBlockBarrier || effect.flags?.["peasant-core"]?.mageBlockDuress
));
assert.equal(mageBlockEffects.length, 0, "depletion leaves no Mage Block effect at zero HP");
assert.equal("hp" in actor.system.notableCombats[0].defense, false);

delete globalThis.Actor;
delete globalThis.foundry;
delete globalThis.game;
delete globalThis.ChatMessage;
console.log("E5 Mage Block Active Effect tests passed");
