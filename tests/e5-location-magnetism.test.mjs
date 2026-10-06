import assert from "node:assert/strict";

import { getLocationBySkillOptions } from "../module/applications/actor/location-table.mjs";
import { getWeaponMasteryMagnetismGrade, getPostDomeMagnetismGrade } from "../module/data/actor/defense-results.mjs";
import { resolveAttackLocationForTarget } from "../module/applications/combat/attack-locations.mjs";

const choicesByMoS = [
  ["table"],
  ["torso", "table"],
  ["rightArm", "leftArm", "rightLeg", "leftLeg", "torso", "table"],
  ["apTorso", "apRightArm", "apLeftArm", "apRightLeg", "apLeftLeg", "rightArm", "leftArm", "rightLeg", "leftLeg", "torso", "table"],
  ["head", "apTorso", "apRightArm", "apLeftArm", "apRightLeg", "apLeftLeg", "rightArm", "leftArm", "rightLeg", "leftLeg", "torso", "table"],
  ["headPen", "head", "apTorso", "apRightArm", "apLeftArm", "apRightLeg", "apLeftLeg", "rightArm", "leftArm", "rightLeg", "leftLeg", "torso", "table"]
];
for (let mos = 0; mos <= 5; mos += 1) {
  assert.deepEqual(
    getLocationBySkillOptions(mos).map(({ key }) => key),
    choicesByMoS[mos],
    `By-Skill choices at MoS ${mos} are independent of Magnetism`
  );
}

const ordinaryOptions = getLocationBySkillOptions(3);
const mediumChargeOptions = getLocationBySkillOptions(3, { armorCharge: { grade: "medium" } });
assert.deepEqual(
  mediumChargeOptions.filter(({ isAP }) => !isAP).map(({ key }) => key),
  ordinaryOptions.filter(({ isAP }) => !isAP).map(({ key }) => key),
  "Medium Armor Charge changes only AP thresholds"
);
assert.notDeepEqual(
  mediumChargeOptions.filter(({ isAP }) => isAP).map(({ key }) => key),
  ordinaryOptions.filter(({ isAP }) => isAP).map(({ key }) => key),
  "Medium Armor Charge raises AP thresholds by one MoS"
);

let selectedLocationKey = "table";
let nextTableResults = [];
let drawCount = 0;
let messageId = 0;
const tableMessages = [];
const table = {
  name: "Location",
  results: [
    { name: "Torso" }, { name: "Right Arm" }, { name: "Armor Pen Right Arm" }, { name: "Head" }
  ],
  async draw() {
    drawCount += 1;
    return { results: [nextTableResults.shift()], roll: { total: drawCount } };
  },
  async toMessage(_results, options) {
    const flags = { ...(options.messageData?.flags?.["peasant-core"] || {}) };
    const message = {
      id: `location-${++messageId}`,
      content: "",
      getFlag: (_scope, key) => flags[key],
      async setFlag(_scope, key, value) { flags[key] = structuredClone(value); }
    };
    tableMessages.push({ options, message });
    return message;
  }
};
globalThis.foundry = {
  applications: {
    api: {
      DialogV2: class {
        constructor(config) {
          this.config = config;
          this.element = {
            nodeType: 1,
            style: {},
            isConnected: true,
            querySelector: selector => selector === '[name="locationBySkillChoice"]' ? { value: selectedLocationKey } : null,
            querySelectorAll: () => [],
            closest() { return this; }
          };
        }
        render() {
          setTimeout(() => this.config.buttons[0].callback(null, null, this), 0);
          return Promise.resolve(this);
        }
      }
    }
  },
  utils: { escapeHTML: value => String(value) }
};
globalThis.$ = element => [element];
globalThis.window = {
  innerWidth: 1000,
  setInterval,
  clearInterval
};
globalThis.game = {
  i18n: { format: key => key },
  settings: { get: () => "public" },
  tables: { getName: name => name === "Location" ? table : null },
  user: { id: "test-user" },
  peasantCore: {}
};
globalThis.Hooks = { once: () => 1, off() {} };
globalThis.ChatMessage = { getSpeaker: () => ({}) };
globalThis.ui = { notifications: { info() {}, warn() {} } };
const { resolveArmorChargeAndLocationForTarget } = await import("../module/applications/combat/successful-attack-damage.mjs");

selectedLocationKey = "rightArm";
const selectedSkillLocation = await resolveAttackLocationForTarget({
  attackRoll: { rollResult: { totalMoS: 3 } },
  magnetismGrade: 3
});
assert.equal(selectedSkillLocation.location, "RightArm", "Positive Magnetism preserves a concrete By-Skill choice");
assert.equal(selectedSkillLocation.bySkill, true);
assert.equal(drawCount, 0, "Concrete By-Skill selection never draws the location table");
assert.equal(selectedSkillLocation.rawText, "Right Arm");
assert.match(tableMessages.at(-1).options.messageData.flavor, /Chooses a result from the Location table/);
assert.equal(tableMessages.length, 1, "A concrete By-Skill choice creates one location card");

selectedLocationKey = "apRightArm";
const selectedArmorPenetration = await resolveAttackLocationForTarget({
  attackRoll: { rollResult: { totalMoS: 3 } },
  magnetismGrade: 3
});
assert.equal(selectedArmorPenetration.rawText, "Armor Pen Right Arm");
assert.equal(selectedArmorPenetration.isAP, true, "Positive Magnetism preserves a selected By-Skill AP result");
assert.equal(selectedArmorPenetration.bySkill, true);
assert.equal(tableMessages.length, 2, "The AP choice also creates exactly one location card");

selectedLocationKey = "table";
const forcedTableChoice = await resolveAttackLocationForTarget({
  attackRoll: { rollResult: { totalMoS: 3 } },
  defensePromptResult: { selection: "defense" },
  magnetismGrade: 1
});
assert.equal(forcedTableChoice.location, "Torso", "Choosing By Luck with Magnetism forces Torso");
assert.equal(forcedTableChoice.byMagnetism, true);
assert.equal(forcedTableChoice.magnetismGrade, 1, "The forced result retains grade provenance");
assert.equal(forcedTableChoice.isAP, false);
assert.equal(drawCount, 0, "Magnetism forces Torso without drawing the table or attempting a Head deflection");
assert.match(tableMessages.at(-1).options.messageData.flavor, /Magnetized to:/);

const domeLocationResolution = await resolveArmorChargeAndLocationForTarget({
  magnetismGrade: 1,
  domeMagnetismGrade: 1,
  armorChargeResolution: { handled: true, useArmorCharge: false },
  resolveLocation: async options => ({
    location: "Torso",
    byMagnetism: true,
    magnetismGrade: options.magnetismGrade
  })
});
assert.equal(domeLocationResolution.locationRoll.domeMagnetismGrade, 1, "Resolved Dome Magnetism is retained on the location result for replay");

let staleSkillLocationResolutions = 0;
const staleSkillLocationReplay = await resolveArmorChargeAndLocationForTarget({
  attackRoll: { rollResult: { totalMoS: 0 } },
  magnetismGrade: 0,
  armorChargeResolution: { handled: true, useArmorCharge: false },
  replayLocationRoll: {
    rawText: "Right Arm",
    location: "RightArm",
    locationDisplay: "Right Arm",
    isAP: false,
    bySkill: true
  },
  resolveLocation: async () => {
    staleSkillLocationResolutions += 1;
    return { rawText: "Torso", location: "Torso", locationDisplay: "Torso", isAP: false };
  }
});
assert.equal(staleSkillLocationResolutions, 1, "A By-Skill checkpoint outside the replayed MoS choices is resolved again");
assert.equal(staleSkillLocationReplay.locationRoll.location, "Torso");

for (const savedBlockLocation of [
  { rawText: "Mage Block Overflow", location: "", byMageBlock: true },
  { rawText: "Shield Block", location: "LeftArm", byShieldBlock: true },
  { rawText: "Weapon Block", location: "LeftArm", byWeaponBlock: true }
]) {
  let freshLocationRolls = 0;
  const replay = await resolveArmorChargeAndLocationForTarget({
    attackRoll: { rollResult: { totalMoS: 0 } },
    magnetismGrade: 0,
    armorChargeResolution: { handled: true, useArmorCharge: false },
    replayLocationRoll: savedBlockLocation,
    resolveLocation: async () => {
      freshLocationRolls += 1;
      return { rawText: "Torso", location: "Torso", locationDisplay: "Torso", isAP: false };
    }
  });
  assert.equal(freshLocationRolls, 1,
    `${savedBlockLocation.rawText} cannot serve as an ordinary hit location after defense replay`);
  assert.equal(replay.locationRoll.location, "Torso");
}

let staleMagnetismLocationResolutions = 0;
const staleMagnetismLocationReplay = await resolveArmorChargeAndLocationForTarget({
  attackRoll: { rollResult: { totalMoS: 3 } },
  magnetismGrade: 1,
  armorChargeResolution: { handled: true, useArmorCharge: false },
  replayLocationRoll: {
    rawText: "Right Arm",
    location: "RightArm",
    locationDisplay: "Right Arm",
    isAP: false
  },
  resolveLocation: async () => {
    staleMagnetismLocationResolutions += 1;
    return { rawText: "Torso", location: "Torso", locationDisplay: "Torso", isAP: false, byMagnetism: true, magnetismGrade: 1 };
  }
});
assert.equal(staleMagnetismLocationResolutions, 1, "A By-Luck table checkpoint is resolved again when replayed Magnetism forces Torso");
assert.equal(staleMagnetismLocationReplay.locationRoll.byMagnetism, true);

const belowThresholdMagnetism = await resolveAttackLocationForTarget({
  attackRoll: { rollResult: { totalMoS: 0 } },
  magnetismGrade: 3
});
assert.equal(belowThresholdMagnetism.location, "Torso", "Magnetism forces Torso when no By-Skill option is available");
assert.equal(drawCount, 0);

const sourceResults = [];
for (const [source, grade] of [
  ["Manifest Dome", getPostDomeMagnetismGrade(0, { handled: true, applied: true, penetration: 1, magnetismGrade: 1 })],
  ["Weapon mastery", getWeaponMasteryMagnetismGrade(null, {
    selection: "defense",
    selectedDefense: { block: true, blockType: "Weapon", masteryBonus: true },
    defenseRoll: { rollResult: { isSuccess: true } }
  })]
]) {
  assert.equal(grade, 1, `${source} supplies its Magnetism grade`);
  const sourceResult = await resolveAttackLocationForTarget({
    attackRoll: { rollResult: { totalMoS: 2 } },
    magnetismGrade: grade
  });
  sourceResults.push(sourceResult);
  assert.equal(sourceResult.byMagnetism, true, `${source} Magnetism forces By-Luck Torso`);
}
assert.deepEqual(sourceResults[0], sourceResults[1], "Dome and Weapon mastery grades serialize to the same forced-location shape");
assert.equal(drawCount, 0);

nextTableResults.push({ name: "Torso" });
const ordinaryTableChoice = await resolveAttackLocationForTarget({
  attackRoll: { rollResult: { totalMoS: 1 } },
  magnetismGrade: 0
});
assert.equal(drawCount, 1, "Grade zero draws the location table");
assert.equal(ordinaryTableChoice.location, "Torso");
assert.equal(ordinaryTableChoice.byMagnetism, undefined);

const beforeHeadReroll = drawCount;
nextTableResults.push({ name: "Head" }, { name: "Torso" });
const reflexLocation = await resolveAttackLocationForTarget({
  attackRoll: { rollResult: { totalMoS: 1 } },
  defensePromptResult: { selection: "defense" },
  magnetismGrade: 0
});
assert.equal(drawCount - beforeHeadReroll, 2, "An actual table Head is rerolled against an active defense");
assert.equal(reflexLocation.location, "Torso");
assert.equal(tableMessages.at(-2).message.getFlag("peasant-core", "locationRoll").status, "superseded");

const replayActors = new Map();
const replayTarget = { id: "replay-target", uuid: "Actor.replay-target", name: "Replay Target", system: {} };
const replayCombat = { name: "Replay Attack", targetingType: "Melee", magnetism: { grade: 0 }, damage: { diceCount: 1, diceValue: 6, flat: 0 } };
const replayActor = { id: "replay-attacker", uuid: "Actor.replay-attacker", name: "Replay Attacker", system: { notableCombats: [replayCombat] } };
replayActors.set(replayActor.id, replayActor);
replayActors.set(replayTarget.id, replayTarget);
game.actors = { get: actorId => replayActors.get(actorId) || null };
const workflow = await import("../module/applications/combat/notable-combat-workflow.mjs");
const originalRollResult = {
  toHit: 7, accuracy: 0, initialDice: [3, 3], allDice: [3, 3], keptDice: [3, 3], additionalDice: [],
  initialTotal: 6, total: 6, baseMoS: 3, accuracyMoS: 0, criticalMoS: 0, totalMoS: 3,
  isSuccess: true, resultText: "Success", criticalType: ""
};
const replayCheckpoint = locationRoll => ({
  version: 2,
  type: "notableCombatPostRoll",
  stage: "attack",
  actor: { actorId: replayActor.id, actorUuid: replayActor.uuid },
  combatIndex: 0,
  targetingType: "Melee",
  attackRollResult: structuredClone(originalRollResult),
  targets: [{
    targetRef: { actorId: replayTarget.id, actorUuid: replayTarget.uuid, targetName: replayTarget.name },
    locationRoll,
    defensePromptResult: null
  }]
});
const replayRoll = mos => ({ ...structuredClone(originalRollResult), totalMoS: mos, baseMoS: mos });

const bySkillCheckpoint = replayCheckpoint({
  rawText: "Right Arm", location: "RightArm", locationDisplay: "Right Arm", isAP: false, bySkill: true
});
replayCombat.magnetism.grade = 0;
const changedMagnetismOnly = await workflow.planNotableCombatEdgeExplodeReplay({
  checkpoint: bySkillCheckpoint,
  rollResult: replayRoll(3)
});
replayCombat.magnetism.grade = 3;
const sameBySkillAfterMagnetism = await workflow.planNotableCombatEdgeExplodeReplay({
  checkpoint: bySkillCheckpoint,
  rollResult: replayRoll(3)
});
assert.equal(changedMagnetismOnly.replayRequired, sameBySkillAfterMagnetism.replayRequired);
assert.equal(sameBySkillAfterMagnetism.replayRequired, false, "Changing only Magnetism does not invalidate a resolved By-Skill location");
assert.deepEqual(sameBySkillAfterMagnetism.offerTargets, [{
  actorUuid: replayTarget.uuid, success: true, hit: true
}], "A no-replay plan retains the final per-target outcome for pending effect offers");

const invalidatedBySkill = await workflow.planNotableCombatEdgeExplodeReplay({
  checkpoint: bySkillCheckpoint,
  rollResult: replayRoll(1)
});
assert.equal(invalidatedBySkill.replayRequired, true, "A By-Skill location is re-resolved when its MoS requirement is no longer met");

const byLuckCheckpoint = replayCheckpoint({
  rawText: "Right Arm", location: "RightArm", locationDisplay: "Right Arm", isAP: false
});
replayCombat.magnetism.grade = 0;
const unchangedByLuck = await workflow.planNotableCombatEdgeExplodeReplay({
  checkpoint: byLuckCheckpoint,
  rollResult: replayRoll(3)
});
assert.equal(unchangedByLuck.replayRequired, false);
replayCombat.magnetism.grade = 1;
const magnetismInvalidatedByLuck = await workflow.planNotableCombatEdgeExplodeReplay({
  checkpoint: byLuckCheckpoint,
  rollResult: replayRoll(3)
});
assert.equal(magnetismInvalidatedByLuck.replayRequired, true, "A stored By-Luck location is re-resolved when Magnetism begins forcing Torso");

const domeByLuckCheckpoint = replayCheckpoint({
  rawText: "Torso", location: "Torso", locationDisplay: "Torso", isAP: false,
  byMagnetism: true, magnetismGrade: 1, domeMagnetismGrade: 1
});
replayCombat.magnetism.grade = 0;
const unchangedDomeMagnetism = await workflow.planNotableCombatEdgeExplodeReplay({
  checkpoint: domeByLuckCheckpoint,
  rollResult: replayRoll(3)
});
assert.equal(unchangedDomeMagnetism.replayRequired, false, "A resolved Dome-only Magnetism grade remains part of the location mode during Edge replay");

console.log("E5 location Magnetism tests passed");
