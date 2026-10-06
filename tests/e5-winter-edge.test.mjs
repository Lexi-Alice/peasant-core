import assert from "node:assert/strict";

let nextId = 0;
globalThis.foundry = { utils: { deepClone: structuredClone, randomID: () => `winter-${++nextId}` } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.canvas = { tokens: { controlled: [] } };
const hooks = [];
globalThis.Hooks = { on: (name, callback) => { if (name === "getChatMessageContextOptions") hooks.push(callback); } };
const actor = {
  id: "winter", uuid: "Actor.winter", name: "Winter", winter: true, owned: true,
  system: { edge: { value: 20 }, edgeLabelMode: "edge", marker: 1 },
  getFlag: (_scope, key) => key === "winterEdge" && actor.winter,
  canUserModify: () => actor.owned,
  async update(changes) {
    for (const key of ["edge.value", "marker"]) {
      if (!Object.hasOwn(changes, `system.${key}`)) continue;
      if (key === "marker") this.system.marker = changes[`system.${key}`];
      else this.system.edge.value = changes[`system.${key}`];
    }
  }
};
const player = { id: "player", isGM: false, character: actor };
const gm = { id: "gm", isGM: true, character: actor };
const messages = new Map();
messages.contents = [];
function message(flags = {}, content = "") {
  const result = {
    id: `message-${++nextId}`, content,
    getFlag: (_scope, key) => flags[key],
    async setFlag(_scope, key, value) { flags[key] = structuredClone(value); },
    async unsetFlag(_scope, key) { delete flags[key]; },
    canUserModify: user => user.isGM,
    async update(patch) { Object.assign(this, patch); },
    async delete() { messages.delete(this.id); messages.contents = messages.contents.filter(entry => entry !== this); }
  };
  messages.set(result.id, result);
  messages.contents.push(result);
  return result;
}
globalThis.game = {
  user: gm, users: new Map([[gm.id, gm], [player.id, player]]), actors: new Map([[actor.id, actor]]), messages,
  settings: { get: () => "public" }, peasantCore: {}
};
globalThis.ChatMessage = {
  applyMode: data => data, getSpeaker: () => ({ actor: actor.id }),
  create: async data => message(data.flags?.["peasant-core"], data.content)
};
let rolls = [];
globalThis.Roll = class {
  async evaluate() {
    assert.ok(rolls.length, "Only newly required critical dice may roll; the chosen face must never roll randomly");
    const value = rolls.shift();
    this.dice = [{ results: [{ result: value }] }];
    this.total = value;
    return this;
  }
};

const { prepareActorEdgeContext } = await import("../module/data/actor/sheet-display/base.mjs");
const edge = await import("../module/applications/combat/edge-chain-rolls.mjs");
const location = await import("../module/applications/combat/edge-location-rolls.mjs");
const data = {};
prepareActorEdgeContext(data, actor);
assert.equal(data.edgeDisplayLabel, "Winter's Edge", "The checkbox must override a persisted ordinary Edge label");
actor.winter = false;
prepareActorEdgeContext(data, actor);
assert.equal(data.edgeDisplayLabel, "Edge", "Unchecking restores the saved label");

function skill(dice, explosion = [], { legacy = false, trained = true, checkpoint = null } = {}) {
  const kept = trained ? dice : dice.filter((_, index) => index !== dice.indexOf(Math.max(...dice))).slice(0, 2);
  const critical = kept.every(value => value === 6) ? "Critical Success" : kept.every(value => value === 1) ? "Critical Failure" : "";
  const chainId = `chain-${++nextId}`;
  return message({
    edgeChain: { version: 2, status: "current", chainId, kind: "skill", label: "Sword", rerun: { type: "skillRoll" },
      edgeBlockedReason: critical ? "critical-roll" : "", edgeBlockedLabel: critical,
      preRollRecords: [], postRollRecords: [], undoRecords: [] },
    ...(!legacy ? { edgeIndividualDie: { version: 1, status: "current", chainId, kind: "skill", label: "Sword", diceFaces: 6,
      dice, trained, toHit: 7, accuracy: 0, checkpoint } } : {}),
    ...(critical ? { edgeExplode: { version: 2, status: "current", trained, initialDice: trained ? dice : [],
      allDice: trained ? [] : dice, keptDice: kept, explosionDice: explosion, criticalType: critical,
      criticalMoS: (critical === "Critical Success" ? 1 : -1) * explosion.reduce((sum, value) => sum + value, 0) / 4,
      toHit: 7, accuracy: 0, checkpoint } } : {})
  });
}
edge.configureEdgeChainRollChatContext();
edge.configureEdgeIndividualDieRollChatContext();
edge.configureEdgeExplodeRollChatContext();
location.configureEdgeLocationRollChatContext();
function menu(card) {
  const items = [];
  hooks.forEach(callback => callback(null, items));
  const element = { dataset: { messageId: card.id }, closest: () => element };
  return items.filter(item => item.condition(element));
}
const card = skill([4, 5]);
game.user = player;
assert.deepEqual(menu(card).map(item => item.name), ["Edge Entire Chain", "Edge Individual Die"]);
actor.system.edge.value = 0;
assert.deepEqual(menu(card), [], "Zero Edge must hide regular actions");
actor.system.edge.value = 20;
player.character = null;
assert.deepEqual(menu(card), [], "No selected or assigned spender must hide regular actions");
player.character = actor;
actor.winter = true;
assert.deepEqual(menu(card).map(item => item.name), ["Winter's Edge"]);
assert.match(menu(card)[0].icon, /snowflake/);
const critical = skill([6, 6], [6, 4], { legacy: true });
assert.deepEqual(menu(critical).map(item => item.name), ["Winter's Edge"], "Legacy critical cards remain editable");
canvas.tokens.controlled = [{ actor: { id: "unowned", canUserModify: () => false } }];
assert.deepEqual(menu(card), [], "An unowned selection cannot fall back to the assigned character");
canvas.tokens.controlled = [];
assert.equal(location.resolveEdgeLocationRollSpender().ok, false, "Regular Edge cannot use a Winter actor");
game.user = gm;
const payload = card => ({ messageId: card.id, requesterUserId: player.id, spenderActorId: actor.id, winter: true, dieIndex: 0, newValue: 5 });
let result = await edge.applyEdgeIndividualDieRoll(payload(critical));
assert.equal(result.ok, true, result.error);
assert.deepEqual(result.rollResult.initialDice, [5, 6]);
assert.deepEqual(result.rollResult.additionalDice, []);
assert.equal(edge.getEdgeChainFlag(critical).edgeBlockedReason, "");
assert.equal(edge.getEdgeExplodeFlag(critical), null, "Breaking a critical clears stale explosion data");
assert.match(messages.get(result.summaryMessageId).content, /Winter(?:&#39;|')s Edge/);

const createCrit = skill([5, 6]);
rolls = [3];
result = await edge.applyEdgeIndividualDieRoll({ ...payload(createCrit), newValue: 6 });
assert.equal(result.ok, true, result.error);
assert.equal(result.rollResult.criticalType, "Critical Success");
assert.deepEqual(result.rollResult.additionalDice, [3]);
assert.equal(result.rollResult.totalMoS, 2);
result = await edge.applyEdgeIndividualDieRoll({ ...payload(createCrit), dieType: "explosion", newValue: 6 });
assert.equal(result.ok, false, "A missing continuation must fail without spending Edge");
assert.deepEqual(edge.getEdgeExplodeFlag(createCrit).explosionDice, [3]);
rolls = [2];
result = await edge.applyEdgeIndividualDieRoll({ ...payload(createCrit), dieType: "explosion", newValue: 6 });
assert.equal(result.ok, true, result.error);
assert.deepEqual(result.rollResult.additionalDice, [6, 2]);
result = await edge.applyEdgeIndividualDieRoll({ ...payload(createCrit), dieType: "explosion", newValue: 1 });
assert.equal(result.ok, true, result.error);
assert.deepEqual(result.rollResult.additionalDice, [1], "A non-six truncates subsequent explosion dice");

const failure = skill([1, 1], [6, 4]);
result = await edge.applyEdgeIndividualDieRoll({ ...payload(failure), dieType: "explosion", newValue: 2 });
assert.equal(result.ok, true, result.error);
assert.equal(result.rollResult.criticalType, "Critical Failure");
assert.equal(result.rollResult.criticalMoS, -0.5);
assert.deepEqual(result.rollResult.additionalDice, [2]);
const untrained = skill([6, 6, 6], [4], { trained: false });
result = await edge.applyEdgeIndividualDieRoll({ ...payload(untrained), newValue: 2 });
assert.equal(result.ok, true, result.error);
assert.deepEqual(result.rollResult.keptDice, [2, 6]);
assert.equal(result.rollResult.criticalType, "");
const beforeInvalid = actor.system.edge.value;
for (const newValue of [0, 7, 2.5, "2junk"]) {
  result = await edge.applyEdgeIndividualDieRoll({ ...payload(card), newValue });
  assert.equal(result.ok, false, "Chosen faces must be integers within the actual die bounds");
}
assert.equal(actor.system.edge.value, beforeInvalid);
const secondCritical = skill([6, 6], [3]);
const otherCritical = skill([1, 1], [2]);
await otherCritical.setFlag("peasant-core", "edgeChain", { ...edge.getEdgeChainFlag(otherCritical), chainId: edge.getEdgeChainFlag(secondCritical).chainId });
result = await edge.applyEdgeIndividualDieRoll(payload(secondCritical));
assert.equal(result.ok, true, result.error);
assert.equal(edge.getEdgeChainFlag(secondCritical).edgeBlockedReason, "critical-roll", "Another critical defense must retain the normal whole-chain lock");

const checkpoint = { version: 2, type: "notableCombatPostRoll", stage: "attack", attackRollResult: { initialDice: [3, 5] }, targets: [] };
const currentAttack = skill([3, 5], [], { checkpoint });
const valueCard = message({
  edgeChain: edge.getEdgeChainFlag(currentAttack),
  edgeIndividualDie: { version: 1, status: "current", chainId: edge.getEdgeChainFlag(currentAttack).chainId,
    kind: "damage", diceFaces: 8, dice: [2], rollKey: "damage:target", checkpoint: { ...checkpoint, stage: "value" } }
});
game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: false });
result = await edge.applyEdgeIndividualDieRoll(payload(currentAttack));
assert.equal(result.ok, true, result.error);
assert.deepEqual(edge.getEdgeIndividualDieFlag(valueCard).checkpoint.attackRollResult.initialDice, [5, 5],
  "A later value edit must replay the current attack even when the prior edit kept the same downstream route");
const beforeRollback = actor.system.edge.value;
const beforeRollbackFlags = structuredClone(edge.getEdgeIndividualDieFlag(currentAttack));
const beforeRollbackChain = structuredClone(edge.getEdgeChainFlag(currentAttack));
const beforeRollbackMessages = messages.size;
game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: true });
game.peasantCore.replayNotableCombatPostRollEffects = async () => { throw new Error("expected failed Winter replay"); };
result = await edge.applyEdgeIndividualDieRoll({ ...payload(currentAttack), newValue: 1 });
assert.equal(result.ok, false);
assert.equal(actor.system.edge.value, beforeRollback);
assert.equal(messages.size, beforeRollbackMessages, "Failed replay deletes its temporary summary");
assert.deepEqual(edge.getEdgeIndividualDieFlag(currentAttack), beforeRollbackFlags);
assert.deepEqual(edge.getEdgeChainFlag(currentAttack), beforeRollbackChain);
game.peasantCore.replayNotableCombatPostRollEffects = async () => ({ ok: true, postRollRecords: [], messageIds: [] });
result = await edge.applyEdgeIndividualDieRoll({ ...payload(currentAttack), newValue: 6 });
assert.equal(result.ok, true, result.error);
assert.deepEqual(edge.getEdgeIndividualDieFlag(valueCard).checkpoint.attackRollResult.initialDice, [6, 5],
  "Replay also synchronizes sibling cards to the current attack");
const beforePartialMessages = messages.size;
game.peasantCore.replayNotableCombatPostRollEffects = async ({ onSaveReplayProgress }) => {
  actor.system.marker = 2;
  onSaveReplayProgress?.({ application: { undoRecords: [{ actorId: actor.id, before: { "system.marker": 1 }, after: { "system.marker": 2 } }] },
    damageRoll: { chatMessage: message({}, "partial damage") } });
  return { ok: false, error: "expected partial Winter replay failure" };
};
result = await edge.applyEdgeIndividualDieRoll({ ...payload(currentAttack), newValue: 2 });
assert.equal(result.ok, false);
assert.equal(actor.system.marker, 1, "A later target cancellation undoes already-applied replay damage");
assert.equal(messages.size, beforePartialMessages, "Partial replay cards are removed");
delete game.peasantCore.planNotableCombatEdgeExplodeReplay;
delete game.peasantCore.replayNotableCombatPostRollEffects;
result = await edge.applyEdgeChainRoll({ ...payload(card), winter: false });
assert.equal(result.ok, false, "Winter points cannot reroll whole chains even through direct API calls");
result = await edge.applyEdgeIndividualDieRoll({ ...payload(card), winter: false });
assert.equal(result.ok, false, "Winter points cannot perform random individual rerolls");
actor.winter = false;
result = await edge.applyEdgeIndividualDieRoll(payload(card));
assert.equal(result.ok, false, "A regular actor cannot submit chosen die faces");
assert.equal(actor.system.edge.value, beforeRollback - 1);
actor.winter = true;
actor.system.edge.value = 1;
const originalUpdate = actor.update;
actor.update = async changes => { await new Promise(resolve => setTimeout(resolve, 5)); return originalUpdate.call(actor, changes); };
const concurrent = await Promise.all([skill([4, 5]), skill([4, 5])].map(card => edge.applyEdgeIndividualDieRoll({ ...payload(card), newValue: 2 })));
assert.equal(concurrent.filter(result => result.ok).length, 1, "One remaining point funds exactly one concurrent edit");
assert.equal(actor.system.edge.value, 0);
actor.update = originalUpdate;
console.log("E5 Winter's Edge tests passed");
