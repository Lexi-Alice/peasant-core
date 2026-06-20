import assert from "node:assert/strict";

import {
  PC_PHASE_MOVEMENT,
  PC_PHASE_STANDARD,
  getFirstPendingTurnIndex,
  getReanchoredTurnForCombat
} from "../module/data/combat-turn-order.mjs";

const cyrus = { id: "cyrus", name: "Cyrus Cord" };
const kaiser = { id: "kaiser", name: "Kaiser Siegfried" };
const gabriel = { id: "gabriel", name: "Mousketeer Gabriel" };
const et = { id: "et", name: "Et" };
const seven = { id: "seven", name: "Initiative Seven" };
const moved = { id: "moved", name: "Moved To Six" };
const high = { id: "high", name: "Initiative Ten" };

const round = 1;

const complete = (id, phase) => ({
  type: "transition",
  action: "nextTurn",
  from: { round, turn: 0, phase, combatantId: id },
  to: { round, turn: 1, phase, combatantId: "next" }
});

const fakeCombat = ({ turns, phase, history = [], seizedMovement = [], seizedStandard = [] }) => ({
  turns,
  round,
  setupTurns() {},
  getFlag(scope, key) {
    if (scope !== "peasant-core") return undefined;
    if (key === "combatPhase") return phase;
    if (key === "turnHistory") return history;
    if (key === "seizedMovement") return seizedMovement;
    if (key === "seizedStandard") return seizedStandard;
    return undefined;
  }
});

const startOrderAfterEtRaise = [cyrus, kaiser, gabriel, et];
assert.equal(
  startOrderAfterEtRaise[getFirstPendingTurnIndex({
    turns: startOrderAfterEtRaise,
    history: [],
    round,
    phase: PC_PHASE_MOVEMENT
  })].id,
  "cyrus",
  "At combat start, an initiative edit should re-anchor to first pending Movement"
);

assert.equal(
  startOrderAfterEtRaise[getFirstPendingTurnIndex({
    turns: startOrderAfterEtRaise,
    history: [complete("cyrus", PC_PHASE_MOVEMENT)],
    round,
    phase: PC_PHASE_MOVEMENT
  })].id,
  "kaiser",
  "After Movement completion, initiative edits should choose first pending Movement"
);

assert.equal(
  startOrderAfterEtRaise[getFirstPendingTurnIndex({
    turns: startOrderAfterEtRaise,
    history: [complete("cyrus", PC_PHASE_MOVEMENT), complete("et", PC_PHASE_MOVEMENT)],
    round,
    phase: PC_PHASE_MOVEMENT
  })].id,
  "kaiser",
  "Completed combatants should not be revisited after initiative edits"
);

const standardOrder = [moved, seven, high];
assert.equal(
  standardOrder[getFirstPendingTurnIndex({
    turns: standardOrder,
    history: [complete("high", PC_PHASE_STANDARD)],
    round,
    phase: PC_PHASE_STANDARD
  })].id,
  "seven",
  "Standard phase should use descending initiative for pending turns"
);

assert.equal(
  standardOrder[getFirstPendingTurnIndex({
    turns: standardOrder,
    history: [complete("high", PC_PHASE_STANDARD), complete("seven", PC_PHASE_STANDARD)],
    round,
    phase: PC_PHASE_STANDARD
  })].id,
  "moved",
  "A combatant moved from initiative 8 to 6 should wait behind pending initiative 7 in Standard"
);

assert.equal(
  startOrderAfterEtRaise[getFirstPendingTurnIndex({
    turns: startOrderAfterEtRaise,
    history: [],
    round,
    phase: PC_PHASE_MOVEMENT,
    seizedIds: ["cyrus"]
  })].id,
  "kaiser",
  "A seized Movement phase should be treated as consumed"
);

assert.equal(
  standardOrder[getFirstPendingTurnIndex({
    turns: standardOrder,
    history: [],
    round,
    phase: PC_PHASE_STANDARD,
    seizedIds: ["high"]
  })].id,
  "seven",
  "A seized Standard phase should be treated as consumed"
);

assert.equal(
  getReanchoredTurnForCombat(fakeCombat({
    turns: [cyrus, kaiser],
    phase: PC_PHASE_MOVEMENT,
    history: [complete("cyrus", PC_PHASE_MOVEMENT), complete("kaiser", PC_PHASE_MOVEMENT)]
  })).phase,
  PC_PHASE_STANDARD,
  "Re-anchoring should switch to Standard when Movement is exhausted"
);

assert.equal(
  startOrderAfterEtRaise[getFirstPendingTurnIndex({
    turns: startOrderAfterEtRaise,
    history: [complete("cyrus", PC_PHASE_MOVEMENT)],
    round,
    phase: PC_PHASE_MOVEMENT
  })].id,
  "kaiser",
  "History should mark Cyrus complete before undo"
);
assert.equal(
  startOrderAfterEtRaise[getFirstPendingTurnIndex({
    turns: startOrderAfterEtRaise,
    history: [],
    round,
    phase: PC_PHASE_MOVEMENT
  })].id,
  "cyrus",
  "Removing history through undo should restore derived completion"
);

console.log("combat turn order tests passed");
