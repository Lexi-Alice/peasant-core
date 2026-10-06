import assert from "node:assert/strict";

globalThis.foundry = { utils: { deepClone: structuredClone, randomID: () => "id" } };
globalThis.canvas = { scene: { id: "scene" }, tokens: { controlled: [] } };
globalThis.ui = { notifications: { warn() {} } };
const flags = { edgeIndividualDie: {
  version: 1, status: "current", chainId: "chain", kind: "skill", label: "Sword",
  diceFaces: 6, dice: [5, 6], trained: true, toHit: 7, accuracy: 0
} };
const card = { id: "attack", content: "", getFlag: (_scope, key) => flags[key],
  async setFlag(_scope, key, value) { flags[key] = structuredClone(value); },
  async update(patch) { Object.assign(this, patch); }
};
const combat = { name: "Sword", damage: null };
const actor = { id: "actor", uuid: "Actor.actor", name: "Attacker", system: { notableCombats: [combat] } };
const target = { id: "target", uuid: "Actor.target", name: "Target" };
globalThis.game = { peasantCore: {}, actors: new Map([[actor.id, actor], [target.id, target]]), messages: new Map([[card.id, card]]) };
const workflow = await import("../module/applications/combat/notable-combat-workflow.mjs");
const base = { toHit: 7, accuracy: 0, initialDice: [5, 6], initialTotal: 11, total: 11,
  baseMoS: 1, accuracyMoS: 0, criticalMoS: 0, totalMoS: 1, isSuccess: true, resultText: "Success" };
const checkpoint = { version: 2, type: "notableCombatPostRoll", stage: "value", chainId: "chain",
  actor: { actorId: actor.id }, combatIndex: 0, attackMessageId: card.id, attackRollResult: base, multiTarget: false,
  targets: [{ targetRef: { actorId: target.id }, defensePromptResult: {
    selection: "defense", activeDefense: true, appliedAccuracyPenalty: 2, appliedToHitPenalty: 0
  } }]
};
const first = await workflow.replayNotableCombatPostRollEffects({ checkpoint });
const stored = flags.edgeIndividualDie.checkpoint;
const second = await workflow.replayNotableCombatPostRollEffects({ checkpoint: { ...stored, stage: "value" } });
assert.equal(first.ok, true);
assert.equal(second.ok, true);
assert.equal(first.rollOutcome.rollResult.totalMoS, 0.5);
assert.equal(stored.attackRollResult.totalMoS, 1, "Replay preserves the attack before defense penalties");
assert.equal(second.rollOutcome.rollResult.totalMoS, 0.5, "Repeated replay applies the defense penalty once");
const gm = { id: "gm", isGM: true, active: true };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
class Element {
  constructor(text = "") { this.textContent = text; this.style = {}; this.children = []; }
  querySelectorAll() { return this.spans || []; }
  querySelector(selector) { return selector === ":scope > div:nth-child(2) > div" ? this.topRow : null; }
  remove() { this.removed = true; }
}
class RollCardRoot extends Element {
  constructor() {
    super();
    const toHit = new Element();
    toHit.spans = [new Element(), new Element()];
    this.card = new Element();
    this.card.topRow = { children: [toHit] };
    this.mos = new Element();
    this.outcome = new Element();
    this.details = new Element();
    this.details.children = [new Element("Dice: [5, 6] = 11"), new Element("Base MoS: 1"), new Element("Accuracy: -2")];
  }
  querySelector(selector) {
    return ({ ".skill-roll-card": this.card, ".mos-toggle": this.mos,
      ".roll-details": this.details, ".skill-roll-card .roll-details + div": this.outcome })[selector];
  }
  set innerHTML(_content) {}
  get innerHTML() { return JSON.stringify({ mos: this.mos.textContent, outcome: this.outcome.textContent,
    details: this.details.children.filter(child => !child.removed).map(child => child.textContent) }); }
}
globalThis.HTMLElement = Element;
globalThis.document = { createElement: () => new RollCardRoot() };
game.user = gm;
game.users = new Map([[gm.id, gm]]);
game.settings = { get: () => "public" };
globalThis.ChatMessage = { getSpeaker: () => ({}), applyMode: data => data,
  create: async data => ({ id: "summary", ...data, async setFlag() {} })
};
actor.system.edge = { value: 10 };
actor.getFlag = (_scope, key) => key === "winterEdge";
actor.canUserModify = () => true;
actor.update = async patch => { if ("system.edge.value" in patch) actor.system.edge.value = patch["system.edge.value"]; };
card.unsetFlag = async (_scope, key) => { delete flags[key]; };
flags.edgeChain = { version: 2, status: "current", chainId: "chain", kind: "attack", label: "Sword",
  rerun: { type: "notableCombat", actorId: actor.id, combatIndex: 0 }, undoRecords: [], postRollRecords: [] };
flags.edgeIndividualDie.checkpoint = { ...checkpoint, stage: "attack", targetingType: "Melee" };
card.content = "Attack card";
game.peasantCore.planNotableCombatEdgeExplodeReplay = workflow.planNotableCombatEdgeExplodeReplay;
game.peasantCore.replayNotableCombatPostRollEffects = workflow.replayNotableCombatPostRollEffects;
const edge = await import("../module/applications/combat/edge-chain-rolls.mjs");
const attackEdit = await edge.applyEdgeIndividualDieRoll({ messageId: card.id, spenderActorId: actor.id,
  requesterUserId: gm.id, winter: true, dieIndex: 0, newValue: 4 });
assert.equal(attackEdit.ok, true, attackEdit.error);
assert.equal(attackEdit.replayPlan.replayRequired, false, "The edited attack still uses the same downstream route");
assert.ok(JSON.parse(card.content).details.includes("Accuracy: -2"), "Changing an attack die preserves defense accuracy on its card");
assert.equal(JSON.parse(card.content).mos, "0.25", "The displayed MoS includes the defense penalty exactly once");
assert.equal(flags.edgeIndividualDie.checkpoint.attackRollResult.totalMoS, 0.75, "The stored base stays before defense");

const defensePrompt = flags.edgeIndividualDie.checkpoint.targets[0].defensePromptResult;
defensePrompt.selectedDefense = { effectiveness: { melee: { mosPer: 0.25, accuracyPenalty: 1 } } };
defensePrompt.defenseRoll = { rolled: true, rollResult: { ...base, initialDice: [4, 5], initialTotal: 9, total: 9, baseMoS: 0.5, totalMoS: 0.5 } };
const defenseFlags = { edgeChain: structuredClone(flags.edgeChain), edgeIndividualDie: {
  ...structuredClone(flags.edgeIndividualDie), dice: [4, 5], label: "Defense",
  checkpoint: { ...structuredClone(flags.edgeIndividualDie.checkpoint), stage: "defense", defenseTargetRef: { actorId: target.id } }
} };
const defenseCard = { ...card, id: "defense", content: "Defense card",
  getFlag: (_scope, key) => defenseFlags[key],
  async setFlag(_scope, key, value) { defenseFlags[key] = structuredClone(value); },
  async unsetFlag(_scope, key) { delete defenseFlags[key]; }
};
game.messages.set(defenseCard.id, defenseCard);
const defenseEdit = await edge.applyEdgeIndividualDieRoll({ messageId: defenseCard.id, spenderActorId: actor.id,
  requesterUserId: gm.id, winter: true, dieIndex: 0, newValue: 3 });
assert.equal(defenseEdit.ok, true, defenseEdit.error);
assert.equal(defenseEdit.replayPlan.replayRequired, false);
assert.ok(JSON.parse(card.content).details.includes("Accuracy: -1"), "Changing a defense die refreshes the attack's accuracy even on the same route");
assert.equal(JSON.parse(card.content).mos, "0.5");
assert.equal(flags.edgeIndividualDie.checkpoint.targets[0].defensePromptResult.appliedAccuracyPenalty, 1);

target.system = { marker: 4 };
target.effects = [];
target.canUserModify = () => true;
target.update = async patch => { if ("system.marker" in patch) target.system.marker = patch["system.marker"]; };
const damageRecord = { id: "damage", actorId: target.id, before: { "system.marker": 0 }, after: { "system.marker": 4 } };
for (const message of [card, defenseCard]) await message.setFlag("peasant-core", "edgeChain", {
  ...message.getFlag("peasant-core", "edgeChain"), undoRecords: [damageRecord], postRollRecords: [damageRecord]
});
const failedAttack = await edge.applyEdgeIndividualDieRoll({ messageId: card.id, spenderActorId: actor.id,
  requesterUserId: gm.id, winter: true, dieIndex: 0, newValue: 1 });
assert.equal(failedAttack.ok, true, failedAttack.error);
assert.equal(failedAttack.replayPlan.replayRequired, true);
assert.equal(target.system.marker, 0, "When defense stops the edited attack, the old damage is removed");
assert.equal(JSON.parse(card.content).outcome, "Failure due to Defense");
assert.ok(JSON.parse(card.content).details.includes("Accuracy: -1"));

let createdId = 0;
ChatMessage.create = async data => {
  const messageFlags = structuredClone(data.flags?.["peasant-core"] || {});
  const created = { ...card, ...data, id: `created-${++createdId}`,
    getFlag: (_scope, key) => messageFlags[key],
    async setFlag(_scope, key, value) { messageFlags[key] = structuredClone(value); },
    async unsetFlag(_scope, key) { delete messageFlags[key]; },
    async delete() { game.messages.delete(this.id); }
  };
  game.messages.set(created.id, created);
  return created;
};
game.users = [gm];
game.users.get = id => id === gm.id ? gm : null;
globalThis.Hooks = { once: () => null };
foundry.utils.escapeHTML = value => value;
game.i18n = { format: () => "Location" };
game.tables = { getName: () => ({ name: "Location",
  draw: async () => ({ results: [{ name: "Torso" }] }),
  toMessage: async (_results, options) => ChatMessage.create(options.messageData)
}) };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() {
    assert.equal(this.formula, "1d6", "Only the newly needed damage die may roll");
    this.dice = [{ results: [{ result: 4 }] }];
    this.total = 4;
    return this;
  }
};
combat.damage = { diceCount: 1, diceValue: 6, type: "blunt" };
target.applyPeasantTargetedDamage = async ({ amount }) => {
  target.system.marker += amount;
  return { ok: true };
};
const hitAgain = await edge.applyEdgeIndividualDieRoll({ messageId: card.id, spenderActorId: actor.id,
  requesterUserId: gm.id, winter: true, dieIndex: 0, newValue: 4 });
assert.equal(hitAgain.ok, true, hitAgain.error);
assert.equal(hitAgain.replayPlan.replayRequired, true);
assert.equal(target.system.marker, 4, "When the edited attack hits again, downstream damage is applied");
assert.ok(JSON.parse(card.content).details.includes("Accuracy: -1"));
assert.equal(JSON.parse(card.content).mos, "0.5");
const repeated = await edge.applyEdgeIndividualDieRoll({ messageId: card.id, spenderActorId: actor.id,
  requesterUserId: gm.id, winter: true, dieIndex: 0, newValue: 3 });
assert.equal(repeated.ok, true, repeated.error);
assert.equal(repeated.replayPlan.replayRequired, false);
assert.equal(target.system.marker, 4, "A repeated successful edit preserves already-applied damage");
assert.equal(JSON.parse(card.content).mos, "0.25");
assert.ok(JSON.parse(card.content).details.includes("Accuracy: -1"));

game.user = { id: "player", isGM: false };
game.users = [gm];
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.ChatMessage = { getSpeaker: () => ({}), applyMode: data => data,
  create: async data => ({ id: "damage", ...data, async setFlag() {} })
};
game.settings = { get: () => "public" };
target.system = { marker: 1 };
target.canUserModify = () => false;
combat.damage = { diceCount: 1, diceValue: 6, type: "blunt" };
game.peasantCore.applyIncomingHitForUser = async () => {
  target.system.marker = 2;
  throw new Error("expected damage application metadata failure");
};
const progress = [];
await assert.rejects(() => workflow.replayNotableCombatPostRollEffects({
  checkpoint: { ...stored, stage: "value", targets: stored.targets.map(entry => ({ ...entry,
    armorChargeResolution: { handled: true, useArmorCharge: false, appliedDamageType: "blunt" },
    locationRoll: { location: "Torso", rawText: "Torso", isAP: false }
  })) },
  edgeIndividualDieReplay: { version: 1, values: [{ rollKey: "damage::Actor.target:", dice: [4] }] },
  onSaveReplayProgress: resolution => progress.push(resolution)
}), /expected damage application metadata failure/);
const partial = progress.flatMap(resolution => resolution?.application?.undoRecords || []);
assert.equal(partial.length, 1, "A thrown damage application still reports its partial target changes for rollback");
assert.equal(partial[0].before["system.marker"], 1);
assert.equal(partial[0].after["system.marker"], 2);
console.log("Winter's Edge defense replay tests passed");
