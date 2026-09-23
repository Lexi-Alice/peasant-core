import assert from "node:assert/strict";

import {
  doesAttackReachManifestDome,
  getPostDomeMagnetismGrade,
  isConfirmedManifestDomeResult,
  shouldContinueAfterManifestDome
} from "../module/data/actor/defense-results.mjs";
import * as automatedDamageRolls from "../module/applications/combat/automated-damage-rolls.mjs";

const {
  createAutomatedDamageBarrierMessages,
  publishAutomatedCombatDamageRoll,
  rollAutomatedCombatDamage,
  renderAutomatedDamageBarrierCard
} = automatedDamageRolls;

assert.equal(typeof createAutomatedDamageBarrierMessages, "function", "Standalone barrier chat messages must be supported");
assert.equal(typeof publishAutomatedCombatDamageRoll, "function", "Damage chat messages must support deferred publication");
assert.equal(typeof renderAutomatedDamageBarrierCard, "function", "Standalone barrier card HTML must be renderable");

function attack(isSuccess, extras = {}) {
  return { rollResult: { isSuccess, ...extras } };
}

function defense({
  rollSuccess = false,
  block = false,
  blockType = "Shield",
  appliesDebuff = false
} = {}) {
  return {
    selection: "defense",
    selectedDefense: { block, blockType, appliesDebuff },
    defenseRoll: { rollResult: { isSuccess: rollSuccess } }
  };
}

assert.equal(doesAttackReachManifestDome({
  attackRoll: attack(true),
  preDefenseRollResult: { isSuccess: true },
  defensePromptResult: defense({ rollSuccess: true, block: false, appliesDebuff: false })
}), false, "A successful ordinary deflection should preserve Dome");

assert.equal(doesAttackReachManifestDome({
  attackRoll: attack(true),
  defensePromptResult: defense({ rollSuccess: false })
}), true);
assert.equal(doesAttackReachManifestDome({ attackRoll: attack(false) }), false);
assert.equal(doesAttackReachManifestDome({ attackRoll: attack(true) }), true);

assert.equal(doesAttackReachManifestDome({
  attackRoll: attack(false, { failureDueToDefense: true }),
  preDefenseRollResult: { isSuccess: true },
  defensePromptResult: defense({ rollSuccess: true, appliesDebuff: true })
}), true, "A debuff defense should use the pre-penalty success for Dome");

for (const blockType of ["Shield", "Weapon", "Mage"]) {
  const blockPrompt = defense({ rollSuccess: true, block: true, blockType });
  const failedAfterDefense = attack(false, { failureDueToDefense: true });
  assert.equal(doesAttackReachManifestDome({
    attackRoll: failedAfterDefense,
    preDefenseRollResult: { isSuccess: true },
    defensePromptResult: blockPrompt
  }), true, `${blockType} block failures should reach Dome`);
  assert.equal(shouldContinueAfterManifestDome({
    attackRoll: failedAfterDefense,
    defensePromptResult: blockPrompt,
    domeResult: { handled: true, applied: true, penetration: 4 }
  }), true, `${blockType} block failures should receive Dome penetration`);
}

assert.equal(shouldContinueAfterManifestDome({
  attackRoll: attack(false, { failureDueToDefense: true }),
  defensePromptResult: defense({ rollSuccess: true, block: false, appliesDebuff: true }),
  domeResult: { handled: true, applied: true, penetration: 4 }
}), false, "A final non-block defense failure should stop after damaging Dome");

assert.equal(shouldContinueAfterManifestDome({
  attackRoll: attack(true),
  domeResult: { handled: true, applied: true, penetration: 0 }
}), false);
assert.equal(isConfirmedManifestDomeResult({ handled: true, applied: true, penetration: 0 }), true);
assert.equal(isConfirmedManifestDomeResult({ handled: true, applied: false, reason: "Socket response unavailable" }), false);

assert.equal(getPostDomeMagnetismGrade(0, {
  handled: true,
  applied: true,
  penetration: 3,
  magnetismGrade: 1
}), 1);
assert.equal(getPostDomeMagnetismGrade(2, {
  handled: true,
  applied: true,
  penetration: 3,
  magnetismGrade: 1
}), 3);
assert.equal(getPostDomeMagnetismGrade(0, {
  handled: true,
  applied: false,
  penetration: 3,
  magnetismGrade: 2
}), 0);
assert.equal(getPostDomeMagnetismGrade(2, { handled: false, magnetismGrade: 1 }), 2);
assert.equal(getPostDomeMagnetismGrade(2, {
  handled: true,
  applied: true,
  penetration: 0,
  magnetismGrade: 1
}), 2);

const domeCard = renderAutomatedDamageBarrierCard("dome", {
  applied: true,
  absorbed: 5,
  penetration: 3,
  remainingHp: 7,
  depleted: false,
  remainingDuration: "2 Rounds",
  imageSrc: "effects/water-dome.webp"
});
assert.match(domeCard, /Manifest Dome/);
assert.match(domeCard, /class="skill-roll-card pc-manifest-roll-card pc-manifest-barrier-card"/);
assert.doesNotMatch(domeCard, /pc-chat-card-image/);
assert.match(domeCard, />7<\/button>\s*<span[^>]*>Remaining HP<\/span>/);
assert.match(domeCard, /Dome Details:/);
assert.match(domeCard, /Absorbed: 5/);
assert.match(domeCard, /Penetration: 3/);
assert.match(domeCard, /Remaining Duration: 2 Rounds/);

const depletedCard = renderAutomatedDamageBarrierCard("dome", {
  applied: true,
  absorbed: 5,
  penetration: 3,
  remainingHp: 0,
  depleted: true,
  remainingDuration: "2 Rounds"
});
assert.doesNotMatch(depletedCard, /Remaining Duration:/);

const resistanceCard = renderAutomatedDamageBarrierCard("resistance", {
  applied: true,
  absorbed: 2,
  penetration: 1,
  remainingHp: 4,
  depleted: false,
  remainingDuration: "Duress"
});
assert.match(resistanceCard, /Manifest Resistance/);
assert.match(resistanceCard, /Resistance Details:/);
assert.match(resistanceCard, /Remaining Duration: Duress/);

assert.equal(renderAutomatedDamageBarrierCard("dome", { applied: false, absorbed: 5, reason: "<unavailable>" }), "");
assert.equal(renderAutomatedDamageBarrierCard("dome", { applied: true, absorbed: 0 }), "");

const createdChatData = [];
let originalDamageCardUpdates = 0;
globalThis.game = {
  user: { id: "user" },
  settings: { get: () => "roll" }
};
globalThis.Roll = class {
  async evaluate() {
    this.dice = [{ results: [{ result: 4 }] }];
    return this;
  }
};
globalThis.ChatMessage = {
  applyMode: (data) => data,
  create: async (data) => {
    createdChatData.push(data);
    return { id: `barrier-${createdChatData.length}`, content: data.content };
  }
};
const barrierDamageRoll = {
  speaker: { alias: "Caster" },
  chatHtml: "<fieldset>Damage</fieldset>",
  chatMessage: { update: async () => { originalDamageCardUpdates += 1; } },
  barrierMessages: []
};
const barrierMessages = await createAutomatedDamageBarrierMessages(barrierDamageRoll, {
  dome: { applied: true, absorbed: 5, penetration: 3, remainingHp: 7, depleted: false, remainingDuration: "2 Rounds" },
  resistance: { applied: true, absorbed: 2, penetration: 1, remainingHp: 4, depleted: false, remainingDuration: "Duress" }
});
assert.equal(originalDamageCardUpdates, 0, "Barrier reporting must not alter the damage card");
assert.equal(createdChatData.length, 2);
assert.deepEqual(barrierMessages.map((message) => message.id), ["barrier-1", "barrier-2"]);
assert.deepEqual(barrierDamageRoll.barrierMessages.map((message) => message.id), ["barrier-1", "barrier-2"]);

createdChatData.length = 0;
globalThis.canvas = { tokens: { controlled: [] } };
globalThis.ChatMessage.getSpeaker = () => ({ alias: "Caster" });
const deferredDamageRoll = await rollAutomatedCombatDamage({
  id: "caster",
  system: { combatMods: { diceRate: 0, flatDamage: 0 } }
}, {
  name: "Attack",
  img: "attacks/musket.webp",
  damage: { diceCount: 1, diceValue: 6, flat: 5, type: "blunt" }
}, {
  targetLabel: "Target",
  deferChatMessage: true
});
assert.equal(createdChatData.length, 0, "Damage calculation must not publish a deferred chat card");
assert.doesNotMatch(deferredDamageRoll.chatHtml, /pc-chat-card-image/);
createdChatData.push({ content: "Location" });
await publishAutomatedCombatDamageRoll(deferredDamageRoll);
await createAutomatedDamageBarrierMessages(deferredDamageRoll, {
  dome: { applied: true, absorbed: 2, penetration: 3, remainingHp: 4, remainingDuration: "2 Rounds", imageSrc: "effects/water-dome.webp" }
});
assert.deepEqual(createdChatData.map(({ content }) => (
  content === "Location"
    ? "location"
    : (content.includes("pc-damage-roll-card") ? "damage" : "barrier")
)), ["location", "damage", "barrier"]);
assert.equal(createdChatData[1].rolls.length, 1, "automatic damage cards must retain their Roll metadata");
assert.equal(createdChatData[1].sound, null, "automatic damage cards must remain silent");
assert.doesNotMatch(createdChatData.at(-1).content, /pc-chat-card-image/);

delete globalThis.game;
delete globalThis.ChatMessage;
delete globalThis.canvas;
delete globalThis.Roll;

console.log("manifest dome attack order tests passed");
