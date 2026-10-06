import assert from "node:assert/strict";

globalThis.foundry = { utils: { deepClone: structuredClone, randomID: () => "id", escapeHTML: value => value } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.canvas = { tokens: { controlled: [] } };
const actor = { id: "winter", uuid: "Actor.winter", name: "Winter", system: { edge: { value: 2 } },
  getFlag: () => true, canUserModify: () => true,
  async update(changes) { if (Object.hasOwn(changes, "system.edge.value")) this.system.edge.value = changes["system.edge.value"]; }
};
const gm = { id: "gm", isGM: true, character: actor };
const messages = new Map();
let nextId = 0;
function message(roll, location = "Torso") {
  const flags = { locationRoll: { version: 1, status: "current", source: "standalone", result: { location, rawText: location }, workflowId: "location" } };
  const result = { id: `location-${++nextId}`, rolls: [roll],
    getFlag: (_scope, key) => flags[key],
    async setFlag(_scope, key, value) { flags[key] = structuredClone(value); },
    async delete() { messages.delete(this.id); }
  };
  messages.set(result.id, result);
  return result;
}
const table = {
  name: "Location",
  async draw({ roll, displayChat }) {
    assert.equal(displayChat, false);
    assert.equal(roll.total, 12, "Choose one die while preserving the second die and the numeric modifier");
    return { roll, results: [{ name: "Head" }] };
  },
  async toMessage(_results, { roll }) { return message(roll, "Head"); }
};
globalThis.game = { user: gm, users: new Map([[gm.id, gm]]), actors: new Map([[actor.id, actor]]), messages,
  tables: { getName: () => table }, settings: { get: () => "public" }, i18n: { format: () => "Location" }, peasantCore: {}
};
globalThis.Hooks = { once: () => null };
globalThis.ui = { notifications: { warn: text => { throw new Error(text); } } };
globalThis.ChatMessage = { getSpeaker: () => ({}), create: async () => ({}) };
class Term {
  constructor(data) { Object.assign(this, data); }
  toJSON() { return structuredClone({ faces: this.faces, results: this.results, number: this.number }); }
  static fromData(data) { return new Term(data); }
}
globalThis.Roll = class {
  static fromTerms(terms) {
    return { terms, dice: terms.filter(term => term.results), total: terms.reduce((sum, term) => sum + (term.results ? term.results.reduce((n, entry) => n + entry.result, 0) : term.number), 0) };
  }
};
const terms = [new Term({ faces: 6, results: [{ result: 2 }, { result: 4 }] }), new Term({ number: 2 })];
const sourceRoll = { dice: [terms[0]], terms };
const original = message(sourceRoll);
const { applyEdgeLocationRoll } = await import("../module/applications/combat/edge-location-rolls.mjs");
const payload = { messageId: original.id, requesterUserId: gm.id, spenderActorId: actor.id, winter: true, dieIndex: 0, newValue: 6 };
const result = await applyEdgeLocationRoll(payload);
assert.equal(result.ok, true, result.error);
assert.equal(actor.system.edge.value, 1);
assert.equal(sourceRoll.dice[0].results[0].result, 2, "The old Roll remains immutable");
assert.equal(original.getFlag("peasant-core", "locationRoll").status, "superseded");
assert.equal(result.newLocation.location, "Head");
const replacement = messages.get(result.replacementMessageId);
assert.deepEqual(replacement.rolls[0].dice[0].results.map(entry => entry.result), [6, 4]);
const invalid = await applyEdgeLocationRoll({ ...payload, messageId: replacement.id, newValue: 7 });
assert.equal(invalid.ok, false);
assert.equal(actor.system.edge.value, 1);
const ordinary = await applyEdgeLocationRoll({ ...payload, messageId: replacement.id, winter: false });
assert.equal(ordinary.ok, false, "A Winter actor cannot randomize a location using normal Edge");
const target = { id: "target", uuid: "Actor.target", name: "Target", system: { marker: 1 }, effects: [], canUserModify: () => true,
  async update(patch) { if (Object.hasOwn(patch, "system.marker")) this.system.marker = patch["system.marker"]; },
  async applyPeasantTargetedDamage() { this.system.marker = 2; return { ok: true }; }
};
game.actors.set(target.id, target);
actor.system.edge.value = 2;
const workflowSource = message(sourceRoll);
await workflowSource.setFlag("peasant-core", "locationRoll", {
  ...workflowSource.getFlag("peasant-core", "locationRoll"), source: "workflow",
  workflow: { applicationPayload: { targetActorId: target.id, damageAmount: 5, location: "Torso" },
    undoRecords: [{ actorId: target.id, before: { "system.marker": 0 }, after: { "system.marker": 1 } }] }
});
const createLocationMessage = table.toMessage;
table.toMessage = async (...args) => {
  const created = await createLocationMessage(...args);
  const saveFlag = created.setFlag;
  created.setFlag = async (scope, key, value) => {
    if (key === "locationRoll" && value.workflow?.applicationPayload) throw new Error("expected failed location metadata update");
    return saveFlag(scope, key, value);
  };
  return created;
};
const failed = await applyEdgeLocationRoll({ ...payload, messageId: workflowSource.id });
assert.equal(failed.ok, false);
assert.equal(actor.system.edge.value, 2);
assert.equal(workflowSource.getFlag("peasant-core", "locationRoll").status, "current");
assert.equal(target.system.marker, 1, "Failed location replay restores damage at the original location");
table.toMessage = createLocationMessage;
target.applyPeasantTargetedDamage = async () => {
  target.system.marker = 2;
  return { ok: true, damageToGrid: 5, events: ["Damage"] };
};
ChatMessage.create = async () => ({ id: "failed-damage-card", getFlag: () => null,
  async setFlag() { throw new Error("expected damage undo metadata failure"); }
});
const thrown = await applyEdgeLocationRoll({ ...payload, messageId: workflowSource.id });
assert.equal(thrown.ok, false);
assert.equal(actor.system.edge.value, 2);
assert.equal(target.system.marker, 1, "An exception after applying damage restores the original location's damage");
assert.equal(workflowSource.getFlag("peasant-core", "locationRoll").status, "current");
console.log("Winter's Edge location tests passed");
