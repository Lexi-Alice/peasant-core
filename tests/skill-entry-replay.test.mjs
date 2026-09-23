import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    deepClone: structuredClone,
    randomID: () => "counter-undo"
  }
};

function applyPatch(root, patch) {
  for (const [rawPath, value] of Object.entries(patch)) {
    const parts = rawPath.replace(/^system\./, "").split(".");
    let target = root;
    for (const part of parts.slice(0, -1)) target = target[part] ??= {};
    target[parts.at(-1)] = structuredClone(value);
  }
}

let expectedUndoCollection = "skills";
const actor = {
  id: "fixture",
  uuid: "Actor.fixture",
  name: "Fixture",
  effects: [],
  system: {
    _source: {
      skills: [
        {
          id: "aid",
          name: "First Aid",
          type: "signature",
          usesCurrent: 2,
          usesMax: 3,
          signatureUsage: { duressUses: false, duressCurrent: 0, duressMax: 0 },
          tagUses: { current: 0, max: 0 },
          sections: { current: 0, max: 0 },
          speed: { type: "", splitSecondCurrent: 0, splitSecondMax: 0 },
          usages: []
        },
        { id: "other", name: "Other skill", type: "skill", usages: [] }
      ]
    }
  },
  async update(patch) {
    applyPatch(this.system._source, patch);
  },
  async updatePeasantStateData(patch) {
    assert.deepEqual(Object.keys(patch), [`system.${expectedUndoCollection}`], "Counter Undo must write a complete fresh list, not a nested array-index path");
    applyPatch(this.system._source, patch);
  }
};

globalThis.game = {
  user: { id: "gm", isGM: true },
  actors: new Map([[actor.id, actor]])
};
globalThis.fromUuid = async (uuid) => uuid === actor.uuid ? actor : null;

const {
  applyRollUndoRecords,
  captureActorRollUndo
} = await import("../module/applications/chat-undo.mjs");

const getEntry = () => actor.system._source.skills.find((entry) => entry.id === "aid");
const captured = await captureActorRollUndo(
  actor,
  "Signature use",
  async () => { getEntry().usesCurrent = 1; },
  { entryCounterRefs: [{ collection: "skills", entryId: "aid", usageId: "base" }] }
);

assert.equal(captured.undoRecords.length, 1);
assert.equal(Object.hasOwn(captured.undoRecords[0].before, "system.skills"), false);
assert.deepEqual(captured.undoRecords[0].entryCounters, [{
  collection: "skills",
  entryId: "aid",
  usageId: "base",
  path: "usesCurrent",
  before: 2,
  after: 1
}]);

getEntry().name = "First Aid revised";
getEntry().usages.push({ id: "night", name: "Night care" });
actor.system._source.skills.reverse();

const undone = await applyRollUndoRecords(captured.undoRecords);
assert.equal(undone.ok, true);
assert.equal(getEntry().usesCurrent, 2);
assert.equal(getEntry().name, "First Aid revised");
assert.equal(getEntry().usages[0].id, "night");
assert.equal(actor.system._source.skills[0].id, "other");

const conflictedCapture = await captureActorRollUndo(
  actor,
  "Conflicting Signature use",
  async () => { getEntry().usesCurrent = 1; },
  { entryCounterRefs: [{ collection: "skills", entryId: "aid" }] }
);
getEntry().usesCurrent = 0;
const conflictedUndo = await applyRollUndoRecords(conflictedCapture.undoRecords);
assert.equal(conflictedUndo.ok, false);
assert.match(conflictedUndo.error, /changed since the roll/i);
assert.equal(getEntry().usesCurrent, 0);

getEntry().usesCurrent = 2;
getEntry().usesMax = 3;
const loweredMaximumCapture = await captureActorRollUndo(
  actor,
  "Bounded Signature use",
  async () => { getEntry().usesCurrent = 1; },
  { entryCounterRefs: [{ collection: "skills", entryId: "aid" }] }
);
getEntry().usesMax = 1;
const loweredMaximumUndo = await applyRollUndoRecords(loweredMaximumCapture.undoRecords);
assert.equal(loweredMaximumUndo.ok, false);
assert.match(loweredMaximumUndo.error, /no longer fits its maximum/i);
assert.equal(getEntry().usesCurrent, 1);

expectedUndoCollection = "notableCombats";
actor.system._source.notableCombats = [{
  id: "pistol",
  name: "Signature Pistol",
  usesCurrent: 2,
  usesMax: 4,
  signatureUsage: { duressUses: true, duressCurrent: 1, duressMax: 2 },
  customTags: [{ id: "damage", name: "Damage" }]
}];
const notableCapture = await captureActorRollUndo(
  actor,
  "Notable Duress use",
  async () => { actor.system._source.notableCombats[0].signatureUsage.duressCurrent = 0; },
  { entryCounterRefs: [{ collection: "notableCombats", entryId: "pistol" }] }
);
assert.deepEqual(notableCapture.undoRecords[0].entryCounters.map(counter => counter.path), ["signatureUsage.duressCurrent"]);
actor.system._source.notableCombats[0].name = "Renamed Signature Pistol";
const notableUndo = await applyRollUndoRecords(notableCapture.undoRecords);
assert.equal(notableUndo.ok, true);
assert.equal(actor.system._source.notableCombats[0].name, "Renamed Signature Pistol");
assert.equal(actor.system._source.notableCombats[0].usesCurrent, 2);
assert.equal(actor.system._source.notableCombats[0].signatureUsage.duressCurrent, 1);
assert.equal(actor.system._source.notableCombats[0].customTags[0].id, "damage");

delete globalThis.fromUuid;
delete globalThis.game;
delete globalThis.foundry;

console.log("skill entry replay tests passed");
