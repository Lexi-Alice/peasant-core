import assert from "node:assert/strict";

import {
  LOCATION_ROLL_SOURCE_STANDALONE,
  LOCATION_ROLL_SOURCE_WORKFLOW,
  buildProcessingLocationRollFlag,
  buildSupersededLocationRollFlag,
  canEdgeRerollLocationRollFlag,
  createLocationRollFlag
} from "../module/data/location-rolls.mjs";
import {
  buildEdgeRerolledIncomingHitPayload,
  chooseEdgeLocationRollSpender,
  getActorCurrentEdge
} from "../module/applications/combat/edge-location-rolls.mjs";

const assignedActor = { id: "assigned", name: "Assigned", system: { edge: { value: 2 } } };
const selectedActor = { id: "selected", name: "Selected", system: { edge: { value: 1 } } };
const secondSelectedActor = { id: "second", name: "Second", system: { edge: { value: 3 } } };

assert.equal(getActorCurrentEdge(assignedActor), 2);
assert.equal(getActorCurrentEdge({ system: { edge: { value: -1 } } }), 0);
assert.equal(getActorCurrentEdge({}), 0);

assert.deepEqual(
  chooseEdgeLocationRollSpender({ selectedActors: [selectedActor], hasSelectedTokens: true, assignedActor }),
  { ok: true, actor: selectedActor, source: "selected-token" }
);
assert.deepEqual(
  chooseEdgeLocationRollSpender({ selectedActors: [], hasSelectedTokens: false, assignedActor }),
  { ok: true, actor: assignedActor, source: "assigned-character" }
);
assert.equal(
  chooseEdgeLocationRollSpender({
    selectedActors: [selectedActor, secondSelectedActor],
    hasSelectedTokens: true,
    assignedActor
  }).reason,
  "multiple-selected"
);
assert.equal(
  chooseEdgeLocationRollSpender({ selectedActors: [], hasSelectedTokens: true, assignedActor }).reason,
  "no-owned-selected"
);

const result = { rawText: "Armor Pen Head", location: "Head", locationDisplay: "Head", isAP: true };
const standaloneFlag = createLocationRollFlag({
  source: LOCATION_ROLL_SOURCE_STANDALONE,
  result
});
assert.equal(canEdgeRerollLocationRollFlag(standaloneFlag), true);

const workflowWithoutPayload = createLocationRollFlag({
  source: LOCATION_ROLL_SOURCE_WORKFLOW,
  result
});
assert.equal(canEdgeRerollLocationRollFlag(workflowWithoutPayload), false);

const workflowWithPayload = createLocationRollFlag({
  source: LOCATION_ROLL_SOURCE_WORKFLOW,
  result,
  workflow: {
    applicationPayload: { location: "Head", damageAmount: 5 },
    undoRecords: []
  }
});
assert.equal(canEdgeRerollLocationRollFlag(workflowWithPayload), true);
assert.equal(canEdgeRerollLocationRollFlag(buildProcessingLocationRollFlag(workflowWithPayload)), false);
assert.equal(canEdgeRerollLocationRollFlag(buildSupersededLocationRollFlag(workflowWithPayload)), false);

const rerolledPayload = buildEdgeRerolledIncomingHitPayload(
  {
    location: "Head",
    locationDisplay: "Head",
    locationResultText: "Armor Pen Head",
    isAP: true,
    damageAmount: 7,
    damageType: "lethal"
  },
  {
    rawText: "Right Arm",
    location: "RightArm",
    locationDisplay: "Right Arm",
    isAP: false
  }
);
assert.equal(rerolledPayload.damageAmount, 7);
assert.equal(rerolledPayload.damageType, "lethal");
assert.equal(rerolledPayload.location, "RightArm");
assert.equal(rerolledPayload.locationDisplay, "Right Arm");
assert.equal(rerolledPayload.locationResultText, "Right Arm");
assert.equal(rerolledPayload.isAP, false);

console.log("edge-location-rolls tests passed");
