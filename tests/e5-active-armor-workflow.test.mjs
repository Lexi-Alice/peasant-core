import assert from "node:assert/strict";

import { canSpendActiveArmorCharge } from "../module/data/actor/active-armor.mjs";

globalThis.game = { peasantCore: {}, user: { id: "test" } };
globalThis.canvas = { tokens: { controlled: [] } };
const [{ applyArmorChargeLocationEffects, resolveArmorChargeAndLocationForTarget }, { getManualArmorChargeControl }] = await Promise.all([
  import("../module/applications/combat/successful-attack-damage.mjs"),
  import("../module/applications/actor/controls/damage-heal-controls.mjs")
]);

const armorPenHead = {
  rawText: "Armor Pen Head",
  location: "Head",
  locationDisplay: "Head",
  isAP: true
};
const lightDecision = {
  handled: true,
  useArmorCharge: true,
  armorGrade: "light",
  preventByLuckPenetration: true,
  bySkillPenetrationMosAdjustment: 0
};
const lightByLuckResult = applyArmorChargeLocationEffects(armorPenHead, lightDecision);
assert.equal(lightByLuckResult.location, "Head");
assert.equal(lightByLuckResult.rawText, "Armor Pen Head", "the original By-Luck location identity is preserved");
assert.equal(lightByLuckResult.isAP, false, "Light Armor Charge blocks By-Luck penetration");
assert.equal(
  applyArmorChargeLocationEffects({ ...armorPenHead, bySkill: true }, lightDecision).isAP,
  true,
  "Light Armor Charge does not block By-Skill penetration"
);
assert.strictEqual(
  applyArmorChargeLocationEffects(armorPenHead, {
    useArmorCharge: true,
    armorGrade: "medium",
    preventByLuckPenetration: false
  }),
  armorPenHead,
  "Medium Armor Charge does not alter a By-Luck AP result"
);
assert.strictEqual(
  applyArmorChargeLocationEffects(armorPenHead, { useArmorCharge: false, armorGrade: "light" }),
  armorPenHead,
  "declining a charge preserves the resolved location object"
);
assert.strictEqual(
  applyArmorChargeLocationEffects(armorPenHead, { useArmorCharge: true, armorGrade: "heavy" }),
  armorPenHead,
  "Heavy Armor Charge does not alter the location"
);

const events = ["attack-defense-fixed"];
const armorChargeResolution = {
  handled: true,
  useArmorCharge: true,
  armorGrade: "medium",
  preventByLuckPenetration: false,
  bySkillPenetrationMosAdjustment: 1
};
const workflowResult = await resolveArmorChargeAndLocationForTarget({
  actor: { name: "Attacker" },
  target: { actor: { name: "Target" } },
  combat: { name: "Attack" },
  attackRoll: { rollResult: { isSuccess: true } },
  defensePromptResult: { selection: "none" },
  damagePreview: "5 Lethal",
  damageType: "lethal",
  requestArmorCharge: async (args) => {
    events.push("armor-charge-choice");
    assert.equal(args.locationRoll, undefined, "the charge choice occurs before a location exists");
    assert.equal(args.attackRoll.rollResult.isSuccess, true);
    assert.equal(args.defensePromptResult.selection, "none");
    return armorChargeResolution;
  },
  resolveLocation: async (args) => {
    events.push("location");
    assert.deepEqual(args.armorCharge, { grade: "medium", bySkillPenetrationMosAdjustment: 1 });
    return { ...armorPenHead, bySkill: true };
  }
});
assert.deepEqual(events, ["attack-defense-fixed", "armor-charge-choice", "location"]);
assert.equal(workflowResult.locationRoll.isAP, true, "Medium Armor Charge leaves the chosen AP location intact");
const cancelledLocation = await resolveArmorChargeAndLocationForTarget({
  requestArmorCharge: async () => ({ chainCancelled: true }),
  resolveLocation: async () => { throw new Error("a cancelled charge decision must stop before location"); }
});
assert.equal(cancelledLocation.chainCancelled, true, "cancelling the charge prompt stops the targeted-hit chain before any application");

const replayResult = await resolveArmorChargeAndLocationForTarget({
  attackRoll: { rollResult: { isSuccess: true, totalMoS: 6 } },
  armorChargeResolution,
  replayLocationRoll: workflowResult.locationRoll,
  requestArmorCharge: async () => { throw new Error("replay must reuse the saved Armor Charge decision"); },
  resolveLocation: async () => { throw new Error("replay must reuse the saved location"); }
});
assert.deepEqual(replayResult.resolution, armorChargeResolution);
assert.equal(replayResult.locationRoll.location, "Head");

globalThis.ChatMessage = {
  applyMode: (data) => data,
  getSpeaker: () => ({}),
  create: async (data) => ({ id: "damage-message", ...data })
};
const noDamageEvents = [];
const noDamageOutcome = await (await import("../module/applications/combat/successful-attack-damage.mjs")).resolveSuccessfulAttackDamageForTarget({
  actor: { id: "attacker", name: "Attacker", system: { combatMods: {} } },
  combat: {
    name: "First Aid",
    damage: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" }
  },
  target: { actor: { id: "target", name: "Target", effects: [], system: {} }, targetName: "Target" },
  attackRoll: { rollResult: { isSuccess: true, totalMoS: 1 } },
  workflowDependencies: {
    requestArmorCharge: async () => { noDamageEvents.push("armor-charge-choice"); return lightDecision; },
    resolveLocation: async () => { noDamageEvents.push("location"); return armorPenHead; },
    requestIncomingHitApplication: async () => { noDamageEvents.push("damage-application"); return { handled: true }; }
  }
});
assert.equal(noDamageOutcome, null, "A successful notable with no Damage tag has no downstream damage outcome");
assert.deepEqual(noDamageEvents, [], "A no-Damage-tag notable skips location and damage application");
const applicationEvents = [];
const attackOutcome = await (await import("../module/applications/combat/successful-attack-damage.mjs")).resolveSuccessfulAttackDamageForTarget({
  actor: { id: "attacker", name: "Attacker", system: { combatMods: {} } },
  combat: {
    name: "Test Attack",
    targetingType: "Melee",
    damage: { diceCount: 0, diceValue: 0, diceBonus: 0, flat: 5, type: "lethal" }
  },
  target: { actor: { id: "target", name: "Target", effects: [], system: {} }, targetName: "Target" },
  attackRoll: { rollResult: { isSuccess: true, totalMoS: 0 } },
  workflowDependencies: {
    requestArmorCharge: async () => {
      applicationEvents.push("armor-charge-choice");
      return lightDecision;
    },
    resolveLocation: async () => {
      applicationEvents.push("location");
      return armorPenHead;
    },
    requestIncomingHitApplication: async (args) => {
      applicationEvents.push("damage-application");
      assert.equal(args.locationRoll.isAP, false, "the target-owned damage path receives Light's resolved non-penetrating result");
      assert.equal(args.incomingHitResolution.preventByLuckPenetration, true);
      return { handled: true, applied: true };
    }
  }
});
assert.deepEqual(applicationEvents, ["armor-charge-choice", "location", "damage-application"]);
assert.equal(attackOutcome.locationRoll.location, "Head");
assert.equal(attackOutcome.locationRoll.isAP, false);

const lightActor = {
  system: { skills: [{ category: "martial", type: "Defense", defenseType: "Armor", class: 2, rank: "0" }], armorCharge: { value: 1, max: 1 } },
  items: [{ type: "equipment", system: { category: "light-armor", equipped: true, armor: {} } }]
};
assert.equal(canSpendActiveArmorCharge(lightActor), true);
for (const [ineligible, reason] of [
  [{ ...lightActor, items: [] }, "unarmored actors"],
  [{ ...lightActor, system: { ...lightActor.system, armorCharge: { value: 0, max: 1 } } }, "empty pools"]
]) {
  assert.equal(canSpendActiveArmorCharge(ineligible), false, `${reason} cannot spend a charge`);
  assert.equal(getManualArmorChargeControl(ineligible), "", `the manual damage dialog hides Armor Charge for ${reason}`);
}
assert.match(getManualArmorChargeControl(lightActor), /damageArmorCharge/);
assert.match(getManualArmorChargeControl(lightActor), /already resolved penetration state separately/);
assert.equal(canSpendActiveArmorCharge({ ...lightActor, system: { ...lightActor.system, skills: [] } }), true, "no Armor skill is needed to use available charges");

const { applyIncomingHit, requestIncomingHitApplicationForTarget, requestIncomingHitResolutionForTarget } = await import("../module/applications/combat/incoming-hit-requests.mjs");
let remotePromptCount = 0;
game.peasantCore.requestIncomingHitForUser = async (_userId, payload) => {
  remotePromptCount += 1;
  assert.equal(Object.hasOwn(payload, "location"), false, "the charge prompt is sent before location resolution");
  return { handled: true, useArmorCharge: true, armorGrade: "light", preventByLuckPenetration: true };
};
globalThis.foundry = { utils: { randomID: () => "prompt-id" } };
game.users = [{ id: "test", active: true, isGM: true }];
const untrainedResolution = await requestIncomingHitResolutionForTarget({
  target: { actor: { ...lightActor, system: { skills: [], armorCharge: { value: 1, max: 1 } } } },
  combat: { name: "Test" },
  damageType: "lethal"
});
assert.equal(untrainedResolution.useArmorCharge, true);
assert.equal(remotePromptCount, 1, "an actor without Armor training receives the charge prompt");

globalThis.foundry = { utils: { randomID: () => "prompt-id" } };
game.users = [{ id: "test", active: true, isGM: true }];
const trainedResolution = await requestIncomingHitResolutionForTarget({
  target: { actor: lightActor, targetName: "Target" },
  attackerActor: { id: "attacker", name: "Attacker" },
  combat: { name: "Test", targetingType: "Melee" },
  damageType: "lethal"
});
assert.equal(trainedResolution.armorGrade, "light");
assert.equal(remotePromptCount, 2);

globalThis.Actor ??= class {};
const { PeasantActor } = await import("../module/documents/actor.mjs");
function targetedDamageActor({ grade = "heavy", classLevel = 4, rank = "4", halt = 0, temporaryHp = 0, bolsteredHp = 0, simplified = false } = {}) {
  const category = { light: "light-armor", medium: "medium-armor", heavy: "heavy-armor" }[grade];
  const damageActor = Object.assign(Object.create(PeasantActor.prototype), {
    id: `armor-${grade}-target`,
    uuid: `Actor.armor-${grade}-target`,
    name: "Armor Charge Target",
    type: "character",
    system: {
      skills: [{ category: "martial", type: "Defense", defenseType: "Armor", class: classLevel, rank }],
      armorCharge: { value: 2, max: 2 },
      haltValues: [0, 0, 0, halt],
      naturalHaltValues: [0, 0, 0, 0],
      combatMods: { haltBuffs: [] },
      health: { value: 10, max: 10 },
      temporaryHp: { value: temporaryHp, max: temporaryHp },
      bolsteredHp,
      conditions: { wounded: false },
      hp: {
        rows: 1,
        cols: 7,
        grid: [[0, 0, 0, 0, 0, 0, 0]],
        applyDamage(type, amount) {
          const damageValue = { blunt: 1, lethal: 2, critical: 3 }[type];
          for (let index = 0; index < amount; index += 1) {
            const openIndex = this.grid[0].indexOf(0);
            if (openIndex < 0) break;
            this.grid[0][openIndex] = damageValue;
          }
        }
      }
    },
    items: [{ type: "equipment", system: { category, equipped: true, armor: {} } }],
    effects: [],
    ownerId: "owner",
    updatePatches: [],
    getFlag(_scope, key) { return key === "simplifiedHp" ? simplified : undefined; },
    testUserPermission(user) { return user?.id === this.ownerId; },
    canUserModify(user) { return user?.id === this.ownerId; },
    async updatePeasantStateData(patch) {
      this.updatePatches.push(structuredClone(patch));
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.replace(/^system\./, "").split(".");
        let target = this.system;
        for (const key of parts.slice(0, -1)) target = target[key] ??= {};
        target[parts.at(-1)] = structuredClone(value);
      }
    },
    async update(patch) {
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.replace(/^system\./, "").split(".");
        let target = this.system;
        for (const key of parts.slice(0, -1)) target = target[key] ??= {};
        target[parts.at(-1)] = structuredClone(value);
      }
    }
  });
  return damageActor;
}

const haltStoppedLightActor = targetedDamageActor({ grade: "light", classLevel: 2, halt: 1 });
const haltStoppedLightResult = await haltStoppedLightActor.applyPeasantTargetedDamage({
  amount: 1, type: "blunt", location: "Torso", useArmorCharge: true, armorGrade: "light", domeAlreadyResolved: true
});
assert.equal(haltStoppedLightResult.damageToGrid, 0, "HALT stops this Light charge hit before HP");
assert.equal(haltStoppedLightActor.system.armorCharge.value, 1, "Light spends a charge even when HALT stops all damage");
assert.equal(haltStoppedLightResult.armorChargeSpent, true);
assert.equal(haltStoppedLightResult.armorChargeRefunded, false);

const haltStoppedMediumActor = targetedDamageActor({ grade: "medium", classLevel: 3, halt: 1 });
const haltStoppedMediumResult = await haltStoppedMediumActor.applyPeasantTargetedDamage({
  amount: 1, type: "blunt", location: "Torso", useArmorCharge: true, armorGrade: "medium", domeAlreadyResolved: true
});
assert.equal(haltStoppedMediumResult.damageToGrid, 0);
assert.equal(haltStoppedMediumActor.system.armorCharge.value, 1, "Medium spends a charge even when HALT stops all damage");
assert.equal(haltStoppedMediumResult.armorChargeSpent, true);

const tempAbsorbedHeavyActor = targetedDamageActor({ temporaryHp: 1 });
const tempAbsorbedHeavyResult = await tempAbsorbedHeavyActor.applyPeasantTargetedDamage({
  amount: 1, type: "blunt", location: "Torso", useArmorCharge: true, armorGrade: "heavy", domeAlreadyResolved: true
});
assert.equal(tempAbsorbedHeavyResult.damageToGrid, 0, "Temporary HP absorbs the whole Heavy-charge hit");
assert.equal(tempAbsorbedHeavyActor.system.armorCharge.value, 2, "Heavy refunds its charge when no damage reaches HP");
assert.equal(tempAbsorbedHeavyResult.armorChargeSpent, false);
assert.equal(tempAbsorbedHeavyResult.armorChargeRefunded, true);

const bolsteredAbsorbedHeavyActor = targetedDamageActor({ bolsteredHp: 1 });
const bolsteredAbsorbedHeavyResult = await bolsteredAbsorbedHeavyActor.applyPeasantTargetedDamage({
  amount: 1, type: "blunt", location: "Torso", useArmorCharge: true, armorGrade: "heavy", domeAlreadyResolved: true
});
assert.equal(bolsteredAbsorbedHeavyResult.damageToGrid, 0, "Bolstered HP absorbs the whole Heavy-charge hit");
assert.equal(bolsteredAbsorbedHeavyActor.system.armorCharge.value, 2, "Heavy refunds after Bolstered HP absorption too");
assert.equal(bolsteredAbsorbedHeavyResult.armorChargeRefunded, true);

const gridDamagedHeavyActor = targetedDamageActor();
const gridDamagedHeavyResult = await gridDamagedHeavyActor.applyPeasantTargetedDamage({
  amount: 1, type: "blunt", location: "Torso", useArmorCharge: true, armorGrade: "heavy", domeAlreadyResolved: true
});
assert.equal(gridDamagedHeavyResult.damageToGrid, 1);
assert.equal(gridDamagedHeavyActor.system.armorCharge.value, 1, "Heavy spends a charge when damage reaches the HP grid");
assert.equal(gridDamagedHeavyResult.armorChargeSpent, true);
assert.equal(gridDamagedHeavyResult.armorChargeRefunded, false);
assert.equal(
  gridDamagedHeavyActor.updatePatches.flatMap(Object.keys).filter((path) => path === "system.armorCharge.value").length,
  1,
  "the target-owner application writes the charge exactly once"
);

const simplifiedTempAbsorbedActor = targetedDamageActor({ temporaryHp: 1, simplified: true });
const simplifiedTempAbsorbedResult = await simplifiedTempAbsorbedActor.applyPeasantTargetedDamage({
  amount: 1, type: "blunt", location: "Torso", useArmorCharge: true, armorGrade: "heavy", domeAlreadyResolved: true
});
assert.equal(simplifiedTempAbsorbedResult.damageToGrid, 0, "simplified HP subtracts actual Temporary HP absorption before refunding");
assert.equal(simplifiedTempAbsorbedActor.system.armorCharge.value, 2, "simplified Heavy damage also refunds after buffer absorption");
assert.equal(simplifiedTempAbsorbedResult.armorChargeRefunded, true);

const invalidChargeActor = targetedDamageActor({ grade: "heavy", classLevel: 2 });
const invalidChargeResult = await invalidChargeActor.applyPeasantTargetedDamage({
  amount: 1, type: "blunt", location: "Torso", useArmorCharge: true, armorGrade: "heavy", domeAlreadyResolved: true
});
assert.equal(invalidChargeResult.useArmorCharge, true, "Heavy armor charge benefits have no class requirement");
assert.equal(invalidChargeActor.system.armorCharge.value, 1);
const zeroDamageChargeActor = targetedDamageActor();
const zeroDamageResult = await zeroDamageChargeActor.applyPeasantTargetedDamage({
  amount: 0, type: "blunt", location: "Torso", useArmorCharge: true, armorGrade: "heavy", domeAlreadyResolved: true
});
assert.equal(zeroDamageResult.ok, false);
assert.equal(zeroDamageChargeActor.system.armorCharge.value, 2, "zero rolled damage spends nothing");

async function incomingHitRequestForOwner(actor, locationRoll = lightByLuckResult) {
  game.actors = new Map([[actor.id, actor]]);
  return requestIncomingHitApplicationForTarget({
    target: { actor, targetName: actor.name },
    attackerActor: { id: "attacker", name: "Attacker" },
    combat: { name: "Test Attack", targetingType: "Melee", damage: { type: "blunt" } },
    damageRoll: { total: 1, normalizedType: "blunt" },
    locationRoll,
    incomingHitResolution: lightDecision
  });
}

game.users = [{ id: "owner", active: true, isGM: false }];
game.user = { id: "owner", isGM: false };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
for (const [reason, changeOwnerState] of [
  ["worn grade changed", (actor) => { actor.items[0].system.category = "medium-armor"; }],
  ["last charge spent", (actor) => { actor.system.armorCharge.value = 0; }]
]) {
  const staleLightActor = targetedDamageActor({ grade: "light", classLevel: 3, halt: 2 });
  changeOwnerState(staleLightActor);
  const chargeBefore = staleLightActor.system.armorCharge.value;
  const staleLightResult = await incomingHitRequestForOwner(staleLightActor);
  assert.equal(staleLightResult.applyResult.isAP, true, `${reason}: stale Light decision cannot suppress original AP`);
  assert.equal(staleLightResult.applyResult.useArmorCharge, false);
  assert.equal(staleLightResult.applyResult.haltUsed, 0);
  assert.equal(staleLightResult.applyResult.damageToGrid, 1);
  assert.equal(staleLightActor.system.armorCharge.value, chargeBefore, `${reason}: no invalid charge spend`);
}

const localOwnerActor = targetedDamageActor({ grade: "light", classLevel: 2 });
const localOwnerResult = await incomingHitRequestForOwner(localOwnerActor);
assert.equal(localOwnerResult.applied, true, "a local owner applies the incoming hit directly");
assert.equal(localOwnerResult.requestPayload.isAP, true, "the direct-owner payload retains original AP for owner validation");
assert.equal(localOwnerResult.applyResult.isAP, false, "eligible Light protection suppresses AP on the owner");
assert.equal(localOwnerActor.system.armorCharge.value, 1);
assert.equal(
  localOwnerActor.updatePatches.flatMap(Object.keys).filter((path) => path === "system.armorCharge.value").length,
  1,
  "direct-owner damage writes one charge decrement"
);
const { applyRollUndoRecords } = await import("../module/applications/chat-undo.mjs");
const localUndo = await applyRollUndoRecords(localOwnerResult.undoRecords);
assert.equal(localUndo.ok, true);
assert.equal(localOwnerActor.system.armorCharge.value, 2, "direct-owner undo restores the pre-hit Armor Charge value");

const remoteOwnerActor = targetedDamageActor({ grade: "light", classLevel: 2 });
game.user = { id: "attacker", isGM: false };
let remoteAppliedPayload = null;
game.peasantCore.applyIncomingHitForUser = async (userId, payload) => {
  assert.equal(userId, "owner");
  remoteAppliedPayload = structuredClone(payload);
  game.user = { id: "owner", isGM: false };
  try {
    return await applyIncomingHit(payload);
  } finally {
    game.user = { id: "attacker", isGM: false };
  }
};
const remoteOwnerResult = await incomingHitRequestForOwner(remoteOwnerActor);
assert.equal(remoteOwnerResult.applied, true, "the remote owner applies the transported incoming hit");
assert.equal(remoteAppliedPayload.useArmorCharge, true);
assert.equal(remoteAppliedPayload.armorGrade, "light");
assert.equal(remoteAppliedPayload.isAP, true, "remote transport preserves original AP");
assert.equal(remoteOwnerResult.applyResult.isAP, false);
assert.equal(remoteAppliedPayload.preventByLuckPenetration, true);
assert.equal(remoteOwnerActor.system.armorCharge.value, 1);
assert.equal(
  remoteOwnerActor.updatePatches.flatMap(Object.keys).filter((path) => path === "system.armorCharge.value").length,
  1,
  "remote-owner damage writes one charge decrement"
);
game.user = { id: "owner", isGM: false };
const remoteUndo = await applyRollUndoRecords(remoteOwnerResult.undoRecords);
assert.equal(remoteUndo.ok, true);
assert.equal(remoteOwnerActor.system.armorCharge.value, 2, "remote-owner undo restores the pre-hit Armor Charge value");

game.user = { id: "attacker", isGM: false };
const remoteStaleLightActor = targetedDamageActor({ grade: "light", classLevel: 2, halt: 2 });
remoteStaleLightActor.system.armorCharge.value = 0;
const remoteStaleLightResult = await incomingHitRequestForOwner(remoteStaleLightActor);
assert.equal(remoteStaleLightResult.applyResult.isAP, true, "remote owner rejects a stale Light decision");
assert.equal(remoteStaleLightResult.applyResult.damageToGrid, 1);
assert.equal(remoteStaleLightActor.system.armorCharge.value, 0);
assert.equal(remoteAppliedPayload.isAP, true);
game.user = { id: "owner", isGM: false };

const bySkillActor = targetedDamageActor({ grade: "light", classLevel: 2 });
const bySkillApplication = await incomingHitRequestForOwner(bySkillActor, { ...armorPenHead, bySkill: true });
assert.equal(bySkillApplication.applyResult.isAP, true, "valid Light charge leaves By-Skill AP unchanged");
assert.equal(bySkillActor.system.armorCharge.value, 1);

// No AP text fallback: the explicit original AP bit must survive checkpoint serialization.
const explicitApLocation = applyArmorChargeLocationEffects({ location: "Head", locationDisplay: "Head", rawText: "Head", isAP: true }, lightDecision);
const replayCombat = { id: "armor-replay", name: "Armor Replay", targetingType: "Melee", damage: { diceCount: 0, diceValue: 0, flat: 1, type: "blunt" } };
const replayAttacker = { id: "armor-attacker", uuid: "Actor.armor-attacker", name: "Attacker", system: { combatMods: {}, notableCombats: [replayCombat] } };
const replayOwnerActor = targetedDamageActor({ grade: "light", classLevel: 2, halt: 2 });
game.actors = new Map([[replayAttacker.id, replayAttacker], [replayOwnerActor.id, replayOwnerActor]]);
const replayAttackMessage = {
  id: "armor-replay-message",
  edgeFlag: { version: 1, status: "current", chainId: "armor-chain", kind: "skill", label: "Armor Replay", diceFaces: 6, dice: [4, 5] },
  getFlag: () => replayAttackMessage.edgeFlag,
  async setFlag(_scope, _key, value) { replayAttackMessage.edgeFlag = structuredClone(value); }
};
const replayRollResult = { isSuccess: true, resultText: "Success", baseMoS: 0.1, accuracyMoS: 0, totalMoS: 0.1 };
const notableWorkflow = await import("../module/applications/combat/notable-combat-workflow.mjs");
await notableWorkflow.attachNotableCombatEdgeIndividualDieCheckpoints({
  rolled: true,
  rollResult: { ...replayRollResult, chatMessage: replayAttackMessage },
  targetRef: { actorId: replayOwnerActor.id, actorUuid: replayOwnerActor.uuid, targetName: replayOwnerActor.name },
  targetName: replayOwnerActor.name,
  locationRoll: explicitApLocation,
  incomingHitResolution: { resolution: lightDecision, locationRoll: explicitApLocation }
}, { actor: replayAttacker, combat: replayCombat, combatIndex: 0, targetingType: "Melee", resolvedDamageType: "blunt" });
const armorReplayCheckpoint = replayAttackMessage.edgeFlag.checkpoint;
const validLightReplay = await notableWorkflow.replayNotableCombatPostRollEffects({ checkpoint: armorReplayCheckpoint, rollResult: replayRollResult });
assert.equal(validLightReplay.ok, true, validLightReplay.error);
const validReplayApplication = validLightReplay.rollOutcome.incomingHitResolution.application;
assert.equal(validReplayApplication.requestPayload.isAP, true, "checkpoint replay restores explicit original AP without AP text");
assert.equal(validReplayApplication.applyResult.isAP, false, "eligible replay Light decision protects on the owner");
assert.equal(replayOwnerActor.system.armorCharge.value, 1);
assert.equal(replayOwnerActor.updatePatches.flatMap(Object.keys).filter((path) => path === "system.armorCharge.value").length, 1);
assert.equal((await applyRollUndoRecords(validReplayApplication.undoRecords)).ok, true);
assert.equal(replayOwnerActor.system.armorCharge.value, 2);
replayOwnerActor.system.armorCharge.value = 0;
const staleLightReplay = await notableWorkflow.replayNotableCombatPostRollEffects({ checkpoint: armorReplayCheckpoint, rollResult: replayRollResult });
assert.equal(staleLightReplay.ok, true, staleLightReplay.error);
const staleReplayApplication = staleLightReplay.rollOutcome.incomingHitResolution.application;
assert.equal(staleReplayApplication.applyResult.isAP, true, "stale replay cannot keep Light protection");
assert.equal(staleReplayApplication.applyResult.haltUsed, 0);
assert.equal(staleReplayApplication.applyResult.damageToGrid, 1);
assert.equal(replayOwnerActor.system.armorCharge.value, 0);

console.log("E5 active armor workflow tests passed.");
