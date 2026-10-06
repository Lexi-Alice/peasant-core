import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getBaseWoundThresholds,
  getDevastatingWoundAccuracyModifier,
  getDevastatingWoundCount,
  getEffectiveWoundThresholds,
  getEffectiveSkillCombatModifiers
} from "../module/data/actor/wounds.mjs";

const actorFor = (wounds) => ({
  system: { hp: { cols: 10 }, devastatingWounds: wounds },
  getFlag: () => undefined
});
const baseThresholds = { head: 10, arms: 20, legs: 20, torso: 30 };
assert.deepEqual(getBaseWoundThresholds(actorFor(0)), baseThresholds);

for (const [wounds, accuracy, thresholds] of [
  [0, 0, [10, 20, 20, 30]],
  [1, -2, [8, 16, 16, 24]],
  [2, -4, [6, 12, 12, 18]],
  [5, -10, [1, 1, 1, 1]],
  [99, -198, [1, 1, 1, 1]]
]) {
  const actor = actorFor(wounds);
  assert.equal(getDevastatingWoundCount(actor), wounds);
  assert.equal(getDevastatingWoundAccuracyModifier(actor), accuracy);
  const effective = getEffectiveWoundThresholds(actor);
  assert.deepEqual(
    [effective.head.effective, effective.arms.effective, effective.legs.effective, effective.torso.effective],
    thresholds
  );
  assert.deepEqual(
    [effective.head.base, effective.arms.base, effective.legs.base, effective.torso.base],
    [10, 20, 20, 30]
  );
}

const customActor = {
  system: { hp: { cols: 8 }, devastatingWounds: 1 },
  getFlag: (_scope, key) => ({
    woundHeadMultiplier: 1.5,
    woundArmsMultiplier: 3,
    woundLegsMultiplier: 0.5,
    woundTorsoMultiplier: 2.5
  })[key]
};
assert.deepEqual(getBaseWoundThresholds(customActor), { head: 12, arms: 24, legs: 4, torso: 20 });
assert.deepEqual(getEffectiveWoundThresholds(customActor), {
  head: { base: 12, effective: 10 },
  arms: { base: 24, effective: 20 },
  legs: { base: 4, effective: 1 },
  torso: { base: 20, effective: 14 }
});

for (const malformed of [-1, 1.5, "invalid"]) {
  const actor = actorFor(malformed);
  assert.equal(getDevastatingWoundCount(actor), 0);
  assert.equal(getDevastatingWoundAccuracyModifier(actor), 0);
}

const rawModifiers = { accuracy: 3, toHit: 7, custom: true };
const effectiveModifiers = getEffectiveSkillCombatModifiers(actorFor(2), rawModifiers);
assert.deepEqual(effectiveModifiers, { accuracy: -1, toHit: 7, custom: true });
assert.notEqual(effectiveModifiers, rawModifiers);
assert.equal(rawModifiers.accuracy, 3, "Effective Accuracy must not overwrite authored modifiers");

globalThis.foundry = {
  abstract: { DataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) }
};
globalThis.Actor = class {};
const [{ PeasantActor }, { HPGridModel }] = await Promise.all([
  import("../module/documents/actor.mjs"),
  import("../module/data/actor/hp-model.mjs")
]);
const { prepareActorHealthResourceContext } = await import("../module/data/actor/sheet-display/health-resources.mjs");

function gridActor({ wounds = 0, wounded = false, head = "", temporaryHp = 0, bolsteredHp = 0, simplified = false } = {}) {
  const hp = Object.assign(Object.create(HPGridModel.prototype), {
    rows: 4,
    cols: 10,
    grid: Array.from({ length: 4 }, () => Array(10).fill(0)),
    damageCalls: []
  });
  const applyDamage = hp.applyDamage.bind(hp);
  hp.applyDamage = (type, amount, hard) => {
    hp.damageCalls.push([type, amount, hard]);
    return applyDamage(type, amount, hard);
  };
  const actor = Object.assign(Object.create(PeasantActor.prototype), {
    type: "character",
    system: {
      hp,
      health: { value: 40, max: 40 },
      temporaryHp: { value: temporaryHp, max: temporaryHp },
      bolsteredHp,
      devastatingWounds: wounds,
      haltValues: "0/0/0/0",
      naturalHaltValues: "0/0/0/0",
      combatMods: { haltBuffs: [] },
      conditions: { wounded, head }
    },
    effects: [],
    items: [],
    updates: [],
    getFlag: (_scope, key) => key === "simplifiedHp" && simplified ? true : undefined,
    async _applyPeasantSimplifiedHpDamageValue(scaledDamage) {
      const value = Math.max(0, this.system.health.value - scaledDamage);
      this.system.health.value = value;
      return { ok: true, value, scaledDamage, tempUsed: 0, bolsteredUsed: 0 };
    },
    async updatePeasantStateData(update) {
      this.updates.push(structuredClone(update));
      for (const [path, value] of Object.entries(update)) {
        const parts = path.replace(/^system\./, "").split(".");
        let target = this.system;
        while (parts.length > 1) target = target[parts.shift()];
        target[parts[0]] = structuredClone(value);
      }
    },
    async update(update) { return this.updatePeasantStateData(update); }
  });
  return actor;
}

async function targetedHit(amount, options = {}) {
  const actor = gridActor(options);
  const result = await actor.applyPeasantTargetedDamage({ amount, type: "blunt", location: "Head" });
  return { actor, result };
}

const woundSheetData = {};
prepareActorHealthResourceContext(woundSheetData, gridActor({ wounds: 2, wounded: true }));
assert.equal(woundSheetData.woundThresholds, "6/12/12/18");
assert.equal(woundSheetData.woundThresholdsTooltip, "Base thresholds H/A/L/T: 10/20/20/30");
assert.equal("devastatingWoundCount" in woundSheetData, false, "the actor sheet does not expose the Devastating Wounds count");
const characterSheetTemplate = readFileSync(new URL("../templates/actor/character-sheet.html", import.meta.url), "utf8");
assert.doesNotMatch(characterSheetTemplate, /Devastating Wounds:/, "the actor sheet does not render a Devastating Wounds count");
assert.match(characterSheetTemplate, /{{woundThresholds}}/, "the actor sheet continues to show effective wound thresholds");
const woundedOnlySheetData = {};
prepareActorHealthResourceContext(woundedOnlySheetData, gridActor({ wounded: true }));
assert.equal(woundedOnlySheetData.woundThresholds, "10/20/20/30", "Wounded alone does not reduce the displayed thresholds");
const simplifiedSheetData = {};
prepareActorHealthResourceContext(simplifiedSheetData, gridActor({ simplified: true }));
assert.equal("devastatingWoundCount" in simplifiedSheetData, false, "simplified actors do not gain grid-only Wound fields");

const exactWound = await targetedHit(10);
assert.equal(exactWound.result.woundThresholds.head.effective, 10);
assert.equal(exactWound.result.devastatingWoundsBefore, 0);
assert.equal(exactWound.result.devastatingWoundsGained, 0);
assert.equal(exactWound.actor.system.conditions.wounded, false, "exact effective threshold must not cause a Wound");

const firstWound = await targetedHit(11);
assert.equal(firstWound.actor.system.conditions.wounded, true, "strictly crossing the threshold sets Wounded");
assert.equal(firstWound.result.devastatingWoundsGained, 0, "the first Wound does not award a Devastating Wound");

const laterWound = await targetedHit(11, { wounded: true });
assert.equal(laterWound.result.devastatingWoundsGained, 1, "crossing while already Wounded awards one Devastating Wound");
assert.equal(laterWound.actor.system.devastatingWounds, 1);

const woundedWithoutBreak = await targetedHit(10, { wounded: true });
assert.equal(woundedWithoutBreak.result.breakOccurred, false, "Wounded alone does not reduce the 2x Break threshold");
assert.equal(woundedWithoutBreak.result.devastatingWoundsGained, 0);

const lowered = await targetedHit(7, { wounds: 2 });
assert.equal(lowered.result.woundThresholds.head.effective, 6);
assert.equal(lowered.result.devastatingWoundsBefore, 2);
assert.equal(lowered.actor.system.conditions.wounded, true);
assert.equal(lowered.result.devastatingWoundsGained, 0);
assert.equal(getEffectiveWoundThresholds(actorFor(99)).head.effective, 1, "thresholds stay at a minimum of 1");

const thresholdFloor = await targetedHit(3, { wounds: 99 });
assert.equal(thresholdFloor.result.woundThresholds.head.effective, 1);
assert.equal(thresholdFloor.result.breakType, "Crippled", "the minimum threshold keeps exact 3x Break math usable");
assert.equal(thresholdFloor.result.breakCriticalDamage, 10);

const reducedBreak = await targetedHit(18, { wounds: 2, wounded: true });
assert.equal(reducedBreak.result.breakType, "Crippled", "exact 3x reduced threshold triggers a Crippling Break");
assert.equal(reducedBreak.result.woundThresholds.head.effective, 6);
assert.equal(reducedBreak.result.breakCriticalDamage, 10, "extra Critical damage uses the base, unreduced threshold");
assert.equal(reducedBreak.result.devastatingWoundsGained, 3, "one crossing Wound and a Crippling Break award stack");

const exactDisabled = await targetedHit(20);
assert.equal(exactDisabled.result.breakType, "Disabled", "exact 2x threshold triggers a Disabling Break");
assert.equal(exactDisabled.result.damageToGrid, 20, "the original post-buffer damage remains separately reported");
assert.equal(exactDisabled.result.devastatingWoundsGained, 1);
assert.equal(exactDisabled.result.breakCriticalDamage, 10);
assert.deepEqual(exactDisabled.actor.system.hp.damageCalls, [
  ["blunt", 20, false],
  ["critical", 10, false]
], "typed base damage is applied before the unreduced base-threshold Critical damage");

const directCripple = await targetedHit(30);
assert.equal(directCripple.result.breakType, "Crippled", "exact 3x threshold triggers a direct Crippling Break");
assert.equal(directCripple.result.devastatingWoundsGained, 2);
assert.equal(directCripple.result.breakCriticalDamage, 10);
assert.deepEqual(directCripple.actor.system.hp.damageCalls.map(([type, amount]) => [type, amount]), [
  ["blunt", 30], ["critical", 10]
], "the extra Critical damage is applied once, after base damage");

const alreadyWoundedBreak = await targetedHit(20, { wounded: true });
assert.equal(alreadyWoundedBreak.result.devastatingWoundsGained, 2, "the same hit can award one Wound crossing and one Disabling Break Wound");
assert.equal(alreadyWoundedBreak.result.devastatingWoundsAfter, 2);
assert.equal(alreadyWoundedBreak.result.breakType, "Disabled");

const advancedBreak = await targetedHit(20, { head: "disabled" });
assert.equal(advancedBreak.result.breakType, "Crippled", "a 2x hit advances an already-Disabled location");
assert.equal(advancedBreak.result.devastatingWoundsGained, 2);

const repeatedCripple = await targetedHit(20, { head: "crippled" });
assert.equal(repeatedCripple.result.breakOccurred, true, "a repeated qualifying Crippling Break is still an event");
assert.equal(repeatedCripple.result.breakType, "Crippled");
assert.equal(repeatedCripple.result.devastatingWoundsGained, 2);
assert.equal(repeatedCripple.result.breakCriticalDamage, 10);
assert.equal(repeatedCripple.actor.system.conditions.head, "crippled");
assert.equal("system.conditions.head" in repeatedCripple.actor.updates.at(-1), false, "repeated Break does not rewrite unchanged condition state");

const suppressed = await targetedHit(11, { wounded: true });
const suppressedResult = await suppressed.actor.applyPeasantTargetedDamage({
  amount: 11, type: "blunt", location: "Head", suppressLocationBreaks: true
});
assert.equal(suppressedResult.devastatingWoundsGained, 1, "suppressLocationBreaks still permits the separate Wound crossing");
assert.equal(suppressedResult.breakOccurred, false);
assert.equal(suppressed.actor.system.conditions.head, "");

const buffered = gridActor({ temporaryHp: 2 });
const bufferedResult = await buffered.applyPeasantTargetedDamage({ amount: 11, type: "blunt", location: "Head" });
assert.equal(bufferedResult.damageToGrid, 9, "damageToGrid remains post-buffer damage");
assert.equal(bufferedResult.devastatingWoundsGained, 0);
assert.equal(buffered.system.conditions.wounded, false, "absorbed buffer damage is excluded from Wound thresholds");

const combinedUpdate = exactDisabled.actor.updates.at(-1);
assert.equal(exactDisabled.actor.updates.length, 1, "damage and all derived state are committed together");
assert.ok("system.hp.grid" in combinedUpdate);
assert.ok("system.conditions.head" in combinedUpdate);
assert.ok("system.devastatingWounds" in combinedUpdate);

globalThis.game = { user: { id: "gm", isGM: true }, actors: new Map() };
const { captureActorRollUndo, applyRollUndoRecords } = await import("../module/applications/chat-undo.mjs");
const undoActor = gridActor();
undoActor.id = "wound-undo";
globalThis.game.actors.set(undoActor.id, undoActor);
const undoSnapshot = () => structuredClone({
  grid: undoActor.system.hp.grid,
  health: undoActor.system.health,
  temporaryHp: undoActor.system.temporaryHp,
  bolsteredHp: undoActor.system.bolsteredHp,
  devastatingWounds: undoActor.system.devastatingWounds,
  conditions: undoActor.system.conditions
});
const stateBeforeUndoableHit = undoSnapshot();
const undoCapture = await captureActorRollUndo(undoActor, "Targeted Damage", () => (
  undoActor.applyPeasantTargetedDamage({ amount: 20, type: "blunt", location: "Head" })
));
assert.equal(undoActor.system.conditions.head, "disabled");
assert.equal(undoActor.system.devastatingWounds, 1);
assert.equal((await applyRollUndoRecords(undoCapture.undoRecords)).ok, true);
assert.deepEqual(undoSnapshot(), stateBeforeUndoableHit, "undo restores the grid, buffers, conditions, and wound count together");

const { applyIncomingHit } = await import("../module/applications/combat/incoming-hit-requests.mjs");
const incomingActor = gridActor();
incomingActor.id = "incoming-wound-hit";
globalThis.game.actors.set(incomingActor.id, incomingActor);
globalThis.ChatMessage = {
  getSpeaker: () => ({}),
  create: async (data) => ({ id: "incoming-wound-card", content: data.content })
};
const incomingResult = await applyIncomingHit({
  targetActorId: incomingActor.id,
  damageAmount: 20,
  damageType: "blunt",
  location: "Head"
});
assert.equal(incomingResult.devastatingWoundsGained, 1, "incoming-hit results expose the updated Wound outcome");
assert.equal(incomingResult.breakType, "Disabled");
assert.equal(incomingResult.breakCriticalDamage, 10);
assert.equal(incomingResult.applyResult.devastatingWoundsAfter, 1);

const simplified = gridActor({ simplified: true });
const simplifiedResult = await simplified.applyPeasantTargetedDamage({ amount: 20, type: "blunt", location: "Head" });
assert.equal(simplifiedResult.ok, true, "simplified damage continues through scalar health handling");
assert.equal(simplified.system.conditions.wounded, false);
assert.equal(simplified.system.devastatingWounds, 0);
assert.equal("devastatingWoundsAfter" in simplifiedResult, false, "simplified actors do not receive grid-only wound results");

delete globalThis.Actor;
delete globalThis.game;
delete globalThis.ChatMessage;

console.log("E5 wounds tests passed");
