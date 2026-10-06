import assert from "node:assert/strict";
import { withActiveEffectDocuments } from "./helpers/active-effect-documents.mjs";
import { migrateWorldNotableCombatData } from "../module/migration/world.mjs";

function makeActor(name, overcharged) {
  const actor = {
    type: "character", name, uuid: `Actor.${name}`, system: { conditions: { overcharged } },
    async updatePeasantStateData(update) {
      for (const [path, value] of Object.entries(update)) {
        const parts = path.replace(/^system\./, "").split(".");
        const key = parts.pop();
        const target = parts.reduce((current, part) => current[part] ??= {}, this.system);
        target[key] = structuredClone(value);
      }
      return this;
    },
    async update(update) { return this.updatePeasantStateData(update); }
  };
  return withActiveEffectDocuments(actor);
}

let version = 27;
const actor = makeActor("world", true);
const tokenActor = makeActor("unlinked", true);
const ordinary = makeActor("ordinary", false);
globalThis.game = {
  user: { isGM: true }, actors: [actor, ordinary],
  scenes: [{ tokens: [{ actorLink: false, actor: tokenActor }] }],
  settings: { get: () => version, set: async (_scope, _key, next) => { version = next; } }
};

await migrateWorldNotableCombatData();
for (const migrated of [actor, tokenActor]) {
  assert.equal(migrated.effects.length, 1, "Existing world and unlinked token Overcharged states become visible effects");
  assert.equal(migrated.effects[0].name, "Overcharged");
  assert.equal(migrated._source.system.conditions.overcharged, false, "Migration removes the hidden persisted true baseline");
  assert.equal(migrated.system.conditions.overcharged, true, "Migration preserves the active restriction");
  await migrated.effects[0].update({ disabled: true });
  assert.equal(migrated.system.conditions.overcharged, false, "Migrated Overcharged can be disabled immediately");
}
assert.equal(ordinary.effects.length, 0, "Actors without Overcharged do not receive an effect");
assert.equal(version, 28);
await migrateWorldNotableCombatData();
assert.equal(actor.effects.length, 1, "Migration is idempotent and does not duplicate effects");
assert.equal(actor.effects[0].disabled, true, "Migration does not re-enable a manually disabled effect on later loads");

version = 27;
const base = makeActor("base-true", true);
const falseToken = makeActor("token-false", false);
const createBaseEffects = base.createEmbeddedDocuments;
// Foundry ActorDelta inherits new base effects even when a token overrides actor system data.
base.createEmbeddedDocuments = async function(type, sources) {
  const created = await createBaseEffects.call(this, type, sources);
  await falseToken.createEmbeddedDocuments(type, created.map(effect => effect.toObject()));
  return created;
};
game.actors = [base];
game.scenes = [{ tokens: [{ actorLink: false, actor: falseToken }] }];
await migrateWorldNotableCombatData();
assert.equal(base.system.conditions.overcharged, true, "The base actor retains its original restriction");
assert.equal(falseToken.system.conditions.overcharged, false, "A saved false token override survives inheritance of the base actor's new effect");
assert.equal(falseToken.effects.length, 0, "The synthetic actor removes the newly inherited effect through the document API");

version = 27;
const disabledBase = makeActor("disabled-base", true);
const disabledToken = makeActor("disabled-token", false);
const [baseEffect] = await disabledBase.createEmbeddedDocuments("ActiveEffect", [{
  _id: "existing-overcharged", name: "Overcharged", disabled: true,
  flags: { "peasant-core": { overcharged: true } },
  system: { changes: [{ key: "system.conditions.overcharged", type: "override", value: true, priority: 50 }] }
}]);
const [tokenEffect] = await disabledToken.createEmbeddedDocuments("ActiveEffect", [baseEffect.toObject()]);
const updateBaseEffect = baseEffect.update;
baseEffect.update = async function(update) {
  await updateBaseEffect.call(this, update);
  await tokenEffect.update(update);
  return this;
};
game.actors = [disabledBase];
game.scenes = [{ tokens: [{ actorLink: false, actor: disabledToken }] }];
await migrateWorldNotableCombatData();
assert.equal(disabledBase.system.conditions.overcharged, true);
assert.equal(disabledToken.system.conditions.overcharged, false, "Re-enabling a base effect preserves the token's previous false state");
assert.equal(disabledToken.effects.length, 1, "Migration retains an existing disabled token effect");
assert.equal(disabledToken.effects[0].disabled, true);

version = 27;
const retryBase = makeActor("retry-base", true);
const retryToken = makeActor("retry-token", false);
const createRetryBase = retryBase.createEmbeddedDocuments;
const deleteRetryBase = retryBase.deleteEmbeddedDocuments;
const deleteRetryToken = retryToken.deleteEmbeddedDocuments;
retryBase.createEmbeddedDocuments = async function(type, sources) {
  const created = await createRetryBase.call(this, type, sources);
  await retryToken.createEmbeddedDocuments(type, created.map(effect => effect.toObject()));
  return created;
};
retryBase.deleteEmbeddedDocuments = async function(type, ids) {
  const deleted = await deleteRetryBase.call(this, type, ids);
  await deleteRetryToken.call(retryToken, type, ids);
  return deleted;
};
let failOnce = true;
retryToken.deleteEmbeddedDocuments = async function(type, ids) {
  if (failOnce) { failOnce = false; throw new Error("Token cleanup temporarily failed"); }
  return deleteRetryToken.call(this, type, ids);
};
game.actors = [retryBase];
game.scenes = [{ tokens: [{ actorLink: false, actor: retryToken }] }];
const retryOriginalError = console.error;
console.error = () => {};
try { await migrateWorldNotableCombatData(); } finally { console.error = retryOriginalError; }
assert.equal(version, 27, "A token preservation failure keeps the migration retryable");
assert.equal(retryBase._source.system.conditions.overcharged, true, "Failed token preservation rolls back the legacy conversion");
assert.equal(retryToken.system.conditions.overcharged, false, "Rollback restores the token's false state");
await migrateWorldNotableCombatData();
assert.equal(version, 28, "A retry finishes once token cleanup succeeds");
assert.equal(retryBase.system.conditions.overcharged, true);
assert.equal(retryBase.effects.length, 1);
assert.equal(retryToken.system.conditions.overcharged, false, "Retry preserves the original false override");
assert.equal(retryToken.effects.length, 0);

version = 27;
const failure = makeActor("failure", true);
failure.createEmbeddedDocuments = async () => { throw new Error("Effect creation failed"); };
game.actors = [failure];
game.scenes = [];
const originalError = console.error;
console.error = () => {};
try { await migrateWorldNotableCombatData(); } finally { console.error = originalError; }
assert.equal(version, 27, "Failed Overcharged migration remains retryable");
assert.equal(failure._source.system.conditions.overcharged, true, "Effect creation failure does not erase the existing restriction");

console.log("E5 Overcharged migration tests passed");
