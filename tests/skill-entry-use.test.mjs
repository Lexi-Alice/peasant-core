import assert from "node:assert/strict";

let messageId = 0;
let poolChoice = "primary";
let poolPromptCount = 0;
let nextSkillDice = null;
const skillRollFormulas = [];
globalThis.foundry = {
  applications: {
    api: {
      DialogV2: {
        wait: async (config) => {
          poolPromptCount += 1;
          assert.deepEqual(config.buttons.map((button) => button.action), ["primary", "duress", "cancel"]);
          return poolChoice;
        }
      }
    }
  },
  utils: {
    deepClone: structuredClone,
    randomID: () => `test-${++messageId}`
  }
};
globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
    skillRollFormulas.push(formula);
  }

  async evaluate() {
    const results = nextSkillDice ?? [4, 5];
    nextSkillDice = null;
    this.dice = [{ results: results.map((result) => ({ result })) }];
    this.total = results.reduce((sum, result) => sum + result, 0);
    return this;
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

function createMessage(data) {
  const flags = {};
  return {
    id: `message-${++messageId}`,
    ...data,
    getFlag: (_systemId, key) => flags[key],
    setFlag: async (_systemId, key, value) => {
      flags[key] = structuredClone(value);
      return value;
    },
    update: async () => {},
    canUserModify: () => true
  };
}

const entry = {
  id: "aid",
  name: "First Aid",
  category: "mundane",
  type: "signature",
  rank: "1",
  tohit: 7,
  accuracy: 0,
  usesCurrent: 2,
  usesMax: 3,
  signatureUsage: { duressUses: true, duressCurrent: 1, duressMax: 1 },
  tagUses: { current: 0, max: 0 },
  baseUsage: { name: "Default", resolution: "legacy", layout: [], rules: [], effectLinks: [] },
  defaultUsageId: "night",
  usages: [{
    id: "night",
    name: "Night care",
    resolution: "check",
    mechanics: {},
    rollOverrides: { tohit: 5, accuracy: 1 },
    replaceSharedTagTypes: [],
    counterScopes: { tagUses: "shared", sections: "shared" },
    layout: [],
    rules: [],
    effectLinks: []
  }]
};
const source = { skills: [structuredClone(entry)], edge: { value: 1 } };
const consumed = [];
const actor = {
  id: "actor-1",
  uuid: "Actor.actor-1",
  name: "Healer",
  system: {
    _source: source,
    skills: source.skills,
    edge: source.edge,
    combatMods: { toHit: 1, accuracy: 2, diceRate: 0, flatDamage: 0, costMod: 0 }
  },
  effects: [],
  ensurePeasantEntryIds: async () => ({ ok: true, changed: false }),
  consumePeasantEntryUses: async (ref, options) => {
    consumed.push({ ref: structuredClone(ref), options: structuredClone(options) });
    const usedEntry = source[ref.collection].find((candidate) => candidate.id === ref.entryId);
    const spendSignature = options.spendSignature
      ?? String(usedEntry.type || "").trim().toLowerCase() === "signature";
    if (!spendSignature) return { ok: true, changed: false, spent: [] };
    if (options.pool === "duress" && usedEntry.signatureUsage.duressCurrent > 0) {
      usedEntry.signatureUsage.duressCurrent -= 1;
      return { ok: true, changed: true, spent: ["duress"] };
    }
    if (options.pool === "primary" && usedEntry.usesCurrent > 0) {
      usedEntry.usesCurrent -= 1;
      return { ok: true, changed: true, spent: ["primary"] };
    }
    return { ok: true, changed: false, spent: [] };
  },
  update: async function (patch) {
    applyPatch(this.system._source, patch);
    Object.assign(this.system, this.system._source);
  },
  updatePeasantStateData: async function (patch) {
    applyPatch(this.system._source, patch);
    Object.assign(this.system, this.system._source);
  },
  canUserModify: () => true
};

const messages = new Map();
messages.contents = [];
messages[Symbol.iterator] = () => messages.values();
globalThis.game = {
  user: { id: "gm", isGM: true },
  users: { get: () => ({ id: "gm", isGM: true }) },
  actors: new Map([[actor.id, actor]]),
  messages,
  settings: { get: () => "public" }
};
globalThis.ui = { notifications: { warn: () => {} } };
globalThis.ChatMessage = {
  getSpeaker: ({ actor: speakerActor } = {}) => ({ actor: speakerActor?.id || null }),
  applyMode: (data) => data,
  create: async (data) => {
    const message = createMessage(data);
    messages.set(message.id, message);
    messages.contents.push(message);
    return message;
  }
};

const {
  createPeasantEntryUsageContext,
  startPeasantEntryUse
} = await import("../module/applications/combat/skill-entry-use.mjs");
const result = await startPeasantEntryUse({
  actor,
  ref: { collection: "skills", entryId: "aid" },
  pool: "primary"
});

assert.equal(result.rolled, true);
assert.equal(result.usageContext.version, 1);
assert.equal(result.usageContext.ref.usageId, "night");
assert.equal(result.usageContext.data.tohit, 5);
assert.equal(result.rollResult.toHit, 6);
assert.equal(result.rollResult.accuracy, 3);
assert.deepEqual(consumed, [{
  ref: { collection: "skills", entryId: "aid" },
  options: { usageId: "night", pool: "primary", spendSignature: true }
}]);
assert.equal(source.skills[0].usesCurrent, 1);
const rerun = result.rollResult.chatMessage.getFlag("peasant-core", "edgeChain").rerun;
assert.equal(rerun.type, "peasantEntryUse");
assert.equal(rerun.usageContext.data.tohit, 5);

const armorEntry = {
  id: "armor-skill",
  name: "Armor",
  category: "martial",
  type: "Defense",
  defenseType: "Armor",
  class: 4,
  rank: "4",
  baseUsage: { name: "Default", resolution: "legacy", layout: [], rules: [], effectLinks: [] },
  usages: [{
    id: "custom-check",
    name: "Custom Check",
    resolution: "check",
    mechanics: {},
    rollOverrides: {},
    replaceSharedTagTypes: [],
    counterScopes: { tagUses: "shared", sections: "shared" },
    layout: [],
    rules: [],
    effectLinks: []
  }]
};
const armorSource = {
  skills: [armorEntry],
  edge: { value: 1 },
  stamina: { value: 3, max: 4 },
  armorCharge: { value: 0, max: 2 }
};
const armorActor = {
  id: "armor-actor",
  uuid: "Actor.armor-actor",
  name: "Armored",
  system: {
    _source: armorSource,
    skills: armorSource.skills,
    edge: armorSource.edge,
    stamina: armorSource.stamina,
    armorCharge: armorSource.armorCharge,
    combatMods: {}
  },
  items: [],
  ensurePeasantEntryIds: async () => ({ ok: true, changed: false }),
  consumePeasantEntryUses: async () => ({ ok: true, changed: false }),
  update: async (patch) => applyPatch(armorSource, patch),
  canUserModify: () => true
};
game.actors.set(armorActor.id, armorActor);
const rollsBeforeArmorUse = skillRollFormulas.length;
const armorUse = await startPeasantEntryUse({
  actor: armorActor,
  ref: { collection: "skills", entryId: "armor-skill" }
});
assert.equal(armorUse.rolled, true, "the base Armor skill follows its normal Check resolution");
assert.equal(skillRollFormulas.length, rollsBeforeArmorUse + 1);
assert.equal(armorSource.stamina.value, 3, "using Armor does not impose a recharge Stamina cost");
assert.equal(armorSource.armorCharge.value, 0, "using Armor does not refill manual charges");
assert.match(armorUse.rollResult.chatMessage.content, /Armor Skill Roll/);
const { applyRollUndoRecords } = await import("../module/applications/chat-undo.mjs");

const customArmorCheck = await startPeasantEntryUse({
  actor: armorActor,
  ref: { collection: "skills", entryId: "armor-skill" },
  usageId: "custom-check"
});
assert.equal(customArmorCheck.rolled, true, "an authored non-base Armor usage keeps its Check resolution");
assert.equal(armorSource.stamina.value, 3);
assert.equal(armorSource.armorCharge.value, 0);

source.skills[0].rank = "u";
source.skills[0].usesCurrent = 1;
consumed.length = 0;
nextSkillDice = [1, 2, 6];
const untrainedFailure = await startPeasantEntryUse({
  actor,
  ref: { collection: "skills", entryId: "aid" },
  usageId: "night",
  pool: "primary"
});
assert.equal(skillRollFormulas.at(-1), "3d6", "an untrained selected usage keeps the untrained roll rule");
assert.deepEqual(untrainedFailure.rollResult.keptDice, [1, 2]);
assert.equal(untrainedFailure.rollResult.isSuccess, false);
assert.equal(
  untrainedFailure.rollResult.chatMessage.getFlag("peasant-core", "edgeChain").label,
  "First Aid Untrained Skill Roll",
  "the untrained label survives into Edge replay context"
);
assert.equal(source.skills[0].usesCurrent, 0, "a failed untrained check still commits one use");
source.skills[0].rank = "1";

source.skills[0].usesCurrent = 2;
consumed.length = 0;
  const { rollCombatFromElement, rollCombatTagFromElement, rollSkillFromElement } = await import("../module/applications/actor/controls/roll-actions.mjs");
await rollSkillFromElement(
  { actor, _prepareSheetRollEvent: () => true },
  {},
  { dataset: { index: "0" } }
);
assert.equal(source.skills[0].usesCurrent, 1, "the actor-row click spends the configured default usage");
assert.equal(consumed[0].options.usageId, "night");
assert.equal(messages.contents.at(-1).getFlag("peasant-core", "edgeChain").rerun.usageContext.data.tohit, 5);
assert.equal(poolPromptCount, 1, "the actor-row click asks which configured Signature pool to spend");

source.skills[0].usesCurrent = 2;
source.skills[0].signatureUsage.duressCurrent = 1;
poolChoice = "duress";
await startPeasantEntryUse({
  actor,
  ref: { collection: "skills", entryId: "aid" }
});
assert.equal(source.skills[0].usesCurrent, 2);
assert.equal(source.skills[0].signatureUsage.duressCurrent, 0);
assert.equal(consumed.at(-1).options.pool, "duress");

source.skills[0].signatureUsage.duressCurrent = 1;
poolChoice = "cancel";
const messagesBeforeCancel = messages.size;
const cancelled = await startPeasantEntryUse({ actor, ref: { collection: "skills", entryId: "aid" } });
assert.equal(cancelled, false);
assert.equal(source.skills[0].signatureUsage.duressCurrent, 1);
assert.equal(messages.size, messagesBeforeCancel);

source.skills[0].usesCurrent = 2;
const edgeSource = await startPeasantEntryUse({
  actor,
  ref: { collection: "skills", entryId: "aid" },
  pool: "primary"
});
assert.equal(source.skills[0].usesCurrent, 1);
game.peasantCore = { startPeasantEntryUse };
const { applyEdgeChainRoll, applyEdgeIndividualDieRoll } = await import("../module/applications/combat/edge-chain-rolls.mjs");
const edgeResult = await applyEdgeChainRoll({
  messageId: edgeSource.rollResult.chatMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: actor.id
});
assert.equal(edgeResult.ok, true);
assert.equal(source.skills[0].usesCurrent, 1, "Edge replay leaves one net Signature spend");
assert.equal(source.edge.value, 0);

source.skills[0].usesCurrent = 2;
source.edge.value = 1;
const staleEdgeSource = await startPeasantEntryUse({
  actor,
  ref: { collection: "skills", entryId: "aid" },
  usageId: "night",
  pool: "primary"
});
const savedSkillUsages = source.skills[0].usages;
source.skills[0].usages = [];
const staleEdge = await applyEdgeChainRoll({
  messageId: staleEdgeSource.rollResult.chatMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: actor.id
});
assert.equal(staleEdge.ok, false, "Edge Entire Chain must refuse a deleted selected usage");
assert.match(staleEdge.error, /original entry usage/i);
assert.equal(source.edge.value, 1, "a stale Edge replay must not spend Edge");
assert.equal(source.skills[0].usesCurrent, 1, "the committed original use remains spent");
source.skills[0].usages = savedSkillUsages;

source.skills[0].usesCurrent = 2;
const staleIndividualSource = await startPeasantEntryUse({
  actor,
  ref: { collection: "skills", entryId: "aid" },
  usageId: "night",
  pool: "primary"
});
source.skills[0].usages = [];
const staleIndividual = await applyEdgeIndividualDieRoll({
  messageId: staleIndividualSource.rollResult.chatMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: actor.id,
  dieIndex: 0
});
assert.equal(staleIndividual.ok, false, "Edge Individual Die must refuse a deleted selected usage");
assert.match(staleIndividual.error, /original entry usage/i);
assert.equal(source.edge.value, 1, "a stale individual reroll must not spend Edge");
assert.equal(source.skills[0].usesCurrent, 1, "the committed original use remains spent");
source.skills[0].usages = savedSkillUsages;

const deletedReplayContext = structuredClone(edgeSource.usageContext);
const savedSkills = source.skills;
source.skills = [];
actor.system.skills = source.skills;
const messagesBeforeDeletedReplay = messages.size;
const deletedReplay = await startPeasantEntryUse({ actor, replayContext: deletedReplayContext });
assert.equal(deletedReplay, false);
assert.equal(messages.size, messagesBeforeDeletedReplay);
source.skills = savedSkills;
actor.system.skills = source.skills;

const notable = {
  ...structuredClone(entry),
  id: "shot",
  name: "Pistol",
  tohit: 8,
  accuracy: 0,
  usesCurrent: 2,
  defaultUsageId: "aimed",
  usages: [{
    ...structuredClone(entry.usages[0]),
    id: "aimed",
    name: "Aimed",
    resolution: "targeted",
    rollOverrides: { tohit: 5, accuracy: 1 }
  }]
};
source.notableCombats = [notable];
actor.system.notableCombats = source.notableCombats;
globalThis.canvas = { scene: { id: "scene-1" }, tokens: { placeables: [], controlled: [] } };
consumed.length = 0;
const notableResult = await startPeasantEntryUse({
  actor,
  ref: { collection: "notableCombats", entryId: "shot" },
  pool: "duress",
  promptForTargets: false
});
assert.equal(notableResult.rollResult.toHit, 6, "Notable activation rolls the resolved alternate snapshot");
assert.deepEqual(consumed[0], {
  ref: { collection: "notableCombats", entryId: "shot" },
  options: { usageId: "aimed", pool: "duress", spendSignature: true }
});
assert.equal(source.notableCombats[0].signatureUsage.duressCurrent, 0);
assert.equal(notableResult.usageContext.ref.usageId, "aimed");
const notableMessage = notableResult.rollResult.chatMessage;
assert.equal(notableMessage.getFlag("peasant-core", "edgeChain").rerun.usageContext.data.tohit, 5);
assert.equal(notableMessage.getFlag("peasant-core", "edgeIndividualDie").checkpoint.usageContext.data.tohit, 5);

source.edge.value = 1;
const notableEdge = await applyEdgeChainRoll({
  messageId: notableMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: actor.id
});
assert.equal(notableEdge.ok, true);
assert.equal(source.notableCombats[0].usesCurrent, 2, "Duress replay must not touch the primary pool");
assert.equal(source.notableCombats[0].signatureUsage.duressCurrent, 0, "Duress replay leaves one net Duress spend");
const notableReplayMessage = notableEdge.rerunResult.rollResult.chatMessage;
const notableReplayRecords = notableReplayMessage.getFlag("peasant-core", "rollUndo").records;
const notableUndo = await applyRollUndoRecords(notableReplayRecords);
assert.equal(notableUndo.ok, true);
assert.equal(source.notableCombats[0].usesCurrent, 2, "undo still leaves the primary pool alone");
assert.equal(source.notableCombats[0].signatureUsage.duressCurrent, 1, "undo restores the replayed Duress spend");

source.notableCombats[0].usesCurrent = 2;
source.notableCombats[0].signatureUsage.duressCurrent = 1;
consumed.length = 0;
poolChoice = "primary";
await rollCombatFromElement(
  { actor, _prepareSheetRollEvent: () => true },
  {},
  { dataset: { index: "0" } }
);
assert.equal(messages.contents.at(-1).getFlag("peasant-core", "edgeChain").rerun.usageContext.data.tohit, 5);
assert.equal(consumed[0].options.usageId, "aimed");

globalThis.Hooks = { once() {}, on() {} };
globalThis.fromUuid = async uuid => uuid === actor.uuid ? actor : null;
actor.isOwner = true;
const { rollNotableCombatHotbarMacro } = await import("../module/applications/notable-combat-hotbar.mjs");
const legacyHotbarUse = await rollNotableCombatHotbarMacro({
  actorUuid: actor.uuid, combatId: "shot", combatIndex: 0
});
assert.equal(legacyHotbarUse.usageContext?.ref?.usageId, "aimed",
  "an existing inventory macro must use the default usage and reach its effect-aware roll path");
const pinnedHotbarUse = await rollNotableCombatHotbarMacro({
  actorUuid: actor.uuid, combatId: "shot", combatIndex: 0, usageId: "base"
});
assert.equal(pinnedHotbarUse.usageContext?.ref?.usageId, "base",
  "a newly created inventory macro keeps the usage that was default when it was added");
delete globalThis.Hooks;
delete globalThis.fromUuid;
delete actor.isOwner;

source.notableCombats[0].usages[0].resolution = "check";
source.notableCombats[0].signatureUsage.duressCurrent = 1;
consumed.length = 0;
const notableCheck = await startPeasantEntryUse({
  actor,
  ref: { collection: "notableCombats", entryId: "shot" },
  usageId: "aimed",
  pool: "duress",
  promptForTargets: false
});
assert.equal(notableCheck.rolled, true);
assert.equal(notableCheck.combatIndex, undefined, "an explicit Check usage uses the check workflow even from Notables");
assert.equal(notableCheck.rollResult.chatMessage.getFlag("peasant-core", "edgeChain").rerun.type, "peasantEntryUse");

source.skills[0].usages[0].resolution = "targeted";
source.skills[0].usesCurrent = 2;
consumed.length = 0;
const skillTargeted = await startPeasantEntryUse({
  actor,
  ref: { collection: "skills", entryId: "aid" },
  usageId: "night",
  pool: "primary",
  promptForTargets: false
});
assert.equal(skillTargeted.rolled, true);
assert.equal(skillTargeted.combatIndex, 0, "an explicit Targeted Use runs through the combat workflow from Skills");
assert.equal(skillTargeted.rollResult.chatMessage.getFlag("peasant-core", "edgeChain").label, "First Aid");
assert.equal(skillTargeted.rollResult.chatMessage.getFlag("peasant-core", "edgeChain").rerun.usageContext.ref.collection, "skills");
source.skills[0].weaponType = "Crossbow";
source.skills[0].type = "skill";
source.skills[0].usages[0].rollOverrides.tohit = 2;
source.edge.value = 1;
const targetedUsesAfterRoll = source.skills[0].usesCurrent;
const targetedEdge = await applyEdgeChainRoll({
  messageId: skillTargeted.rollResult.chatMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: actor.id
});
assert.equal(targetedEdge.ok, true, "a targeted Skill can replay through its stable usage context");
assert.equal(source.skills[0].usesCurrent, targetedUsesAfterRoll, "targeted Skill Edge leaves one net use spent");
assert.equal(targetedEdge.rerunResult.usageContext.ref.collection, "skills");
assert.equal(targetedEdge.rerunResult.rollResult.toHit, 6, "Edge keeps the original usage mechanics snapshot");
assert.equal(source.skills[0].type, "skill", "Edge preserves a later Type edit while retaining the original Signature spend");
assert.equal(source.skills[0].weaponType, "Crossbow", "Edge does not overwrite a later classification edit");
assert.equal(source.skills[0].usages[0].rollOverrides.tohit, 2, "Edge does not overwrite a later usage edit");

source.skills[0].usages[0].resolution = "reference";
source.skills[0].usages[0].mechanics = { speed: { type: "Standard" } };
source.skills[0].usesCurrent = 2;
consumed.length = 0;
const promptsBeforeReference = poolPromptCount;
const reference = await startPeasantEntryUse({
  actor,
  ref: { collection: "skills", entryId: "aid" },
  usageId: "night"
});
assert.equal(reference.rolled, false);
assert.equal(reference.referenced, true);
assert.match(reference.chatMessage.content, /First Aid/);
assert.match(reference.chatMessage.content, /Night care/);
assert.match(reference.chatMessage.content, /Speed/);
assert.match(reference.chatMessage.content, /Standard/);
assert.equal(consumed.length, 0, "Reference does not spend Signature or mechanical Uses");
assert.equal(poolPromptCount, promptsBeforeReference, "Reference does not ask for a Signature pool");

source.notableCombats[0].usages[0].resolution = "targeted";
source.notableCombats[0].damage = { diceCount: 1, diceValue: 4, diceBonus: 0, flat: 0, type: "blunt" };
source.notableCombats[0].usages[0].mechanics = {
  damage: { diceCount: 2, diceValue: 8, diceBonus: 0, flat: 1, type: "lethal" }
};
actor.system.combatMods = { toHit: 1, accuracy: 2, diceRate: 0, flatDamage: 0, costMod: 0 };
const { usageContext: manualContext } = await createPeasantEntryUsageContext({
  actor,
  ref: { collection: "notableCombats", entryId: "shot" },
  usageId: "aimed",
  pool: "primary"
});
actor.system.combatMods = { toHit: 9, accuracy: 9, diceRate: 3, flatDamage: 30, costMod: 0 };
const { rollManualCombatTag } = await import("../module/applications/combat/manual-combat-tag-rolls.mjs");
const manualDamage = await rollManualCombatTag({
  actor,
  combatIndex: 0,
  rollType: "damage",
  usageContext: manualContext
});
assert.equal(manualDamage.diceCount, 2, "manual rolls use the selected usage payload");
assert.equal(manualDamage.flat, 1, "manual rolls use the captured modifier snapshot");
assert.equal(manualDamage.chatMessage.getFlag("peasant-core", "edgeChain").rerun.usageContext.ref.usageId, "aimed");
assert.equal(manualDamage.chatMessage.getFlag("peasant-core", "edgeIndividualDie").checkpoint.usageContext.data.damage.type, "lethal");
assert.equal(consumed.length, 0, "manual value rolls do not spend the entry pools");
source.edge.value = 1;
game.peasantCore.rollManualCombatTag = rollManualCombatTag;
const manualEdge = await applyEdgeChainRoll({
  messageId: manualDamage.chatMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: actor.id
});
assert.equal(manualEdge.ok, true, "manual values replay through their stable selected usage");
assert.equal(manualEdge.rerunResult.flat, 1, "manual Edge replay keeps the captured modifiers");
assert.equal(consumed.length, 0);
const staleManual = await rollManualCombatTag({
  actor,
  combatIndex: 0,
  rollType: "damage",
  usageContext: manualContext
});
const savedNotableUsages = source.notableCombats[0].usages;
source.notableCombats[0].usages = [];
source.edge.value = 1;
const staleManualEdge = await applyEdgeChainRoll({
  messageId: staleManual.chatMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: actor.id
});
assert.equal(staleManualEdge.ok, false, "deleting the selected usage blocks manual Edge replay");
assert.equal(source.edge.value, 1);
source.notableCombats[0].usages = savedNotableUsages;

const manualMessagesBefore = messages.size;
await rollCombatTagFromElement(
  {
    actor,
    _isPrimaryPointerEvent: () => true,
    _prepareSheetRollEvent: () => true
  },
  {},
  { dataset: { combatIndex: "0", rollType: "damage" } }
);
assert.equal(messages.size, manualMessagesBefore + 1);
assert.equal(messages.contents.at(-1).getFlag("peasant-core", "edgeChain").rerun.usageContext.ref.usageId, "aimed");
assert.equal(consumed.length, 0, "actor-row manual values do not spend the default usage");

const { buildAutomatedCombatDamageData } = await import("../module/data/actor/combat-damage.mjs");
const automatedDamage = buildAutomatedCombatDamageData(actor, manualContext.data, {
  combatMods: manualContext.modifiers
});
assert.equal(automatedDamage.diceCount, 2, "automated damage uses the selected usage modifier snapshot");
assert.equal(automatedDamage.flat, 1);

manualContext.data.heal = { diceCount: 1, diceValue: 6, diceBonus: 0, flat: 2, type: "temporary" };
const { rollAutomatedCombatHeal } = await import("../module/applications/combat/automated-heal-rolls.mjs");
const automatedHeal = await rollAutomatedCombatHeal(actor, manualContext.data, {
  combatMods: manualContext.modifiers,
  diceOverride: [4]
});
assert.equal(automatedHeal.diceCount, 1, "automated healing uses the selected usage modifier snapshot");
assert.equal(automatedHeal.flat, 2);

const offerEntry = structuredClone(entry);
offerEntry.type = "Skill";
offerEntry.usages[0].rollOverrides = { tohit: 7, accuracy: 0 };
offerEntry.usages[0].effectLinks = [{
  id: "offer-link", effectId: "definition", when: "success", recipient: "self", application: "offer", tagKey: ""
}];
const offerSource = { skills: [offerEntry], edge: { value: 1 } };
const offerDefinition = {
  id: "definition", type: "skill", flags: { "peasant-core": { skillEditorDefinition: true } },
  changes: [],
  toObject() { return { _id: this.id, type: this.type, name: "Staunched", flags: this.flags, changes: [] }; }
};
const generatedOfferEffects = new Map();
const offerActor = {
  ...actor,
  id: "offer-actor",
  uuid: "Actor.offer-actor",
  system: { ...actor.system, _source: offerSource, skills: offerSource.skills, edge: offerSource.edge, combatMods: { toHit: 0, accuracy: 0 } },
  effects: {
    get: id => id === offerDefinition.id ? offerDefinition : generatedOfferEffects.get(id),
    [Symbol.iterator]: () => [offerDefinition, ...generatedOfferEffects.values()][Symbol.iterator]()
  },
  async createEmbeddedDocuments(_type, sources) {
    return sources.map(source => {
      const data = structuredClone({ ...source, _id: source._id || `generated-${++messageId}` });
      const effect = { id: data._id, type: data.type, flags: data.flags, _source: data, toObject: () => structuredClone(data) };
      generatedOfferEffects.set(effect.id, effect);
      return effect;
    });
  },
  async deleteEmbeddedDocuments(_type, ids) { ids.forEach(id => generatedOfferEffects.delete(id)); },
  async updateEmbeddedDocuments() {},
  consumePeasantEntryUses: async () => ({ ok: true, changed: false }),
  update: async patch => applyPatch(offerSource, patch)
};
game.actors.set(offerActor.id, offerActor);
globalThis.fromUuid = async uuid => uuid === offerActor.uuid ? offerActor : null;
nextSkillDice = [4, 5];
const offeredUse = await startPeasantEntryUse({
  actor: offerActor,
  ref: { collection: "skills", entryId: "aid" },
  usageId: "night",
  pool: "primary"
});
assert.equal(offeredUse.rollResult.isSuccess, true);
assert.equal(offeredUse.rollResult.chatMessage.getFlag("peasant-core", "skillEffectOffers").offers.length, 1);
assert.equal(offeredUse.rollResult.chatMessage.getFlag("peasant-core", "skillEffectOffers").offers[0].targetUuid, offerActor.uuid);
const originalOfferId = offeredUse.rollResult.chatMessage.getFlag("peasant-core", "skillEffectOffers").offers[0].operationId;
offeredUse.rollResult.chatMessage.content = ""; // The in-place replay contract is flags/state; no browser DOM in this harness.
nextSkillDice = [4];
const rerolledOffer = await applyEdgeIndividualDieRoll({
  messageId: offeredUse.rollResult.chatMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: offerActor.id,
  dieIndex: 0
});
assert.equal(rerolledOffer.ok, true, JSON.stringify(rerolledOffer));
const replacementOffers = offeredUse.rollResult.chatMessage.getFlag("peasant-core", "skillEffectOffers").offers;
assert.equal(replacementOffers.length, 1, "An in-place Skill reroll creates a fresh eligible offer");
assert.notEqual(replacementOffers[0].operationId, originalOfferId);
assert.equal(replacementOffers[0].status, "pending");
const { applySkillEffectOffer } = await import("../module/applications/combat/skill-entry-effects.mjs");
assert.equal((await applySkillEffectOffer({
  message: offeredUse.rollResult.chatMessage,
  operationId: originalOfferId,
  requesterUserId: game.user.id
})).ok, false, "The old chat button cannot apply a superseded offer");
offerSource.edge.value = 1;
nextSkillDice = [1];
const failedOfferReroll = await applyEdgeIndividualDieRoll({
  messageId: offeredUse.rollResult.chatMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: offerActor.id,
  dieIndex: 0
});
assert.equal(failedOfferReroll.ok, true, JSON.stringify(failedOfferReroll));
assert.equal(failedOfferReroll.rollResult.isSuccess, false);
assert.deepEqual(offeredUse.rollResult.chatMessage.getFlag("peasant-core", "skillEffectOffers").offers, [],
  "An in-place failed reroll clears the superseded success offer");

offerSource.edge.value = 1;
nextSkillDice = [6, 6];
const criticalOfferUse = await startPeasantEntryUse({
  actor: offerActor,
  ref: { collection: "skills", entryId: "aid" },
  usageId: "night",
  pool: "primary"
});
const criticalMessage = criticalOfferUse.rollResult.chatMessage;
const criticalOfferId = criticalMessage.getFlag("peasant-core", "skillEffectOffers").offers[0].operationId;
assert.equal((await applySkillEffectOffer({
  message: criticalMessage, operationId: criticalOfferId, requesterUserId: game.user.id
})).ok, true);
assert.equal(generatedOfferEffects.size, 1);
criticalMessage.content = "";
nextSkillDice = [2];
const { applyEdgeExplodeRoll } = await import("../module/applications/combat/edge-chain-rolls.mjs");
const originalStateUpdate = offerActor.updatePeasantStateData;
offerActor.updatePeasantStateData = async () => { throw new Error("simulated Edge spend failure"); };
const originalConsoleError = console.error;
console.error = () => {};
let failedExplosion;
try {
  failedExplosion = await applyEdgeExplodeRoll({
    messageId: criticalMessage.id, requesterUserId: game.user.id, spenderActorId: offerActor.id
  });
} finally {
  offerActor.updatePeasantStateData = originalStateUpdate;
  console.error = originalConsoleError;
}
assert.equal(failedExplosion.ok, false);
assert.equal(generatedOfferEffects.size, 1, "Failed Edge Explode restores the prior applied effect");
assert.equal(criticalMessage.getFlag("peasant-core", "skillEffectOffers").offers[0].status, "applied");
nextSkillDice = [2];
const explodedOffer = await applyEdgeExplodeRoll({
  messageId: criticalMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: offerActor.id
});
assert.equal(explodedOffer.ok, true, JSON.stringify(explodedOffer));
assert.equal(generatedOfferEffects.size, 0, "Edge Explode removes an applied copy from the previous result");
const explodedOffers = criticalMessage.getFlag("peasant-core", "skillEffectOffers").offers;
assert.equal(explodedOffers.length, 1);
assert.notEqual(explodedOffers[0].operationId, criticalOfferId,
  "An in-place critical explosion reroll replaces the original pending offer");
assert.equal((await applySkillEffectOffer({
  message: criticalMessage,
  operationId: criticalOfferId,
  requesterUserId: game.user.id
})).ok, false, "The pre-explosion chat button cannot apply after replay");

offerEntry.usages[0].effectLinks[0].application = "automatic";
offerSource.edge.value = 1;
nextSkillDice = [4, 5];
const automaticUse = await startPeasantEntryUse({
  actor: offerActor,
  ref: { collection: "skills", entryId: "aid" },
  usageId: "night",
  pool: "primary"
});
const automaticMessage = automaticUse.rollResult.chatMessage;
const firstAutomatic = automaticMessage.getFlag("peasant-core", "skillEffectOffers").offers[0];
assert.equal(firstAutomatic.status, "applied", "A successful check applies its effect without a chat action");
assert.equal(generatedOfferEffects.size, 1);
assert.equal([...generatedOfferEffects.values()][0].flags["peasant-core"].skillEditorDefinition, undefined,
  "The applied copy is not an editor definition");
const pendingAutomaticFlag = structuredClone(automaticMessage.getFlag("peasant-core", "skillEffectOffers"));
pendingAutomaticFlag.offers[0].status = "processing";
await automaticMessage.setFlag("peasant-core", "skillEffectOffers", pendingAutomaticFlag);
const inFlightEdge = await applyEdgeIndividualDieRoll({
  messageId: automaticMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: offerActor.id,
  dieIndex: 0
});
assert.equal(inFlightEdge.ok, false, "Edge waits while Automatic application has not settled");
assert.match(inFlightEdge.error, /automatic.*effect/i);
const inFlightChainEdge = await applyEdgeChainRoll({
  messageId: automaticMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: offerActor.id
});
assert.equal(inFlightChainEdge.ok, false);
assert.match(inFlightChainEdge.error, /automatic.*effect/i);
assert.equal(generatedOfferEffects.size, 1, "A blocked replay leaves the applied copy untouched");
await automaticMessage.setFlag("peasant-core", "skillEffectOffers", {
  ...pendingAutomaticFlag,
  offers: pendingAutomaticFlag.offers.map(offer => ({ ...offer, status: "applied" }))
});
automaticMessage.content = "";
nextSkillDice = [1];
const failedAutomaticReroll = await applyEdgeIndividualDieRoll({
  messageId: automaticMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: offerActor.id,
  dieIndex: 0
});
assert.equal(failedAutomaticReroll.ok, true, JSON.stringify(failedAutomaticReroll));
assert.equal(failedAutomaticReroll.rollResult.isSuccess, false);
assert.equal(generatedOfferEffects.size, 0, "A failed replay removes the prior applied copy");
assert.deepEqual(automaticMessage.getFlag("peasant-core", "skillEffectOffers").offers, []);
offerSource.edge.value = 1;
nextSkillDice = [5];
const recoveredAutomaticReroll = await applyEdgeIndividualDieRoll({
  messageId: automaticMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: offerActor.id,
  dieIndex: 0
});
assert.equal(recoveredAutomaticReroll.ok, true, JSON.stringify(recoveredAutomaticReroll));
assert.equal(recoveredAutomaticReroll.rollResult.isSuccess, true);
const recoveredAutomatic = automaticMessage.getFlag("peasant-core", "skillEffectOffers").offers[0];
assert.notEqual(recoveredAutomatic.operationId, firstAutomatic.operationId);
assert.equal(recoveredAutomatic.status, "applied", "A newly successful replay applies one fresh copy");
assert.equal(generatedOfferEffects.size, 1);
assert.equal((await applySkillEffectOffer({
  message: automaticMessage, operationId: firstAutomatic.operationId, requesterUserId: game.user.id
})).ok, false, "A replay cannot reapply its retired effect operation");

offerSource.edge.value = 1;
nextSkillDice = [6, 6];
const criticalAutomaticUse = await startPeasantEntryUse({
  actor: offerActor,
  ref: { collection: "skills", entryId: "aid" },
  usageId: "night",
  pool: "primary"
});
const criticalAutomaticMessage = criticalAutomaticUse.rollResult.chatMessage;
const preExplosionAutomaticId = criticalAutomaticMessage.getFlag("peasant-core", "skillEffectOffers").offers[0].operationId;
assert.equal(generatedOfferEffects.size, 2);
const pendingExplosionFlag = structuredClone(criticalAutomaticMessage.getFlag("peasant-core", "skillEffectOffers"));
pendingExplosionFlag.offers[0].status = "processing";
await criticalAutomaticMessage.setFlag("peasant-core", "skillEffectOffers", pendingExplosionFlag);
const inFlightExplosion = await applyEdgeExplodeRoll({
  messageId: criticalAutomaticMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: offerActor.id
});
assert.equal(inFlightExplosion.ok, false);
assert.match(inFlightExplosion.error, /automatic.*effect/i);
await criticalAutomaticMessage.setFlag("peasant-core", "skillEffectOffers", {
  ...pendingExplosionFlag,
  offers: pendingExplosionFlag.offers.map(offer => ({ ...offer, status: "applied" }))
});
criticalAutomaticMessage.content = "";
nextSkillDice = [2];
offerActor.updatePeasantStateData = async () => { throw new Error("simulated Edge spend failure"); };
console.error = () => {};
let failedAutomaticExplosion;
try {
  failedAutomaticExplosion = await applyEdgeExplodeRoll({
    messageId: criticalAutomaticMessage.id, requesterUserId: game.user.id, spenderActorId: offerActor.id
  });
} finally {
  offerActor.updatePeasantStateData = originalStateUpdate;
  console.error = originalConsoleError;
}
assert.equal(failedAutomaticExplosion.ok, false);
assert.equal(generatedOfferEffects.size, 2, "Failed replay restores the automatic copy");
assert.equal(criticalAutomaticMessage.getFlag("peasant-core", "skillEffectOffers").offers[0].status, "applied");
nextSkillDice = [2];
const explodedAutomatic = await applyEdgeExplodeRoll({
  messageId: criticalAutomaticMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: offerActor.id
});
assert.equal(explodedAutomatic.ok, true, JSON.stringify(explodedAutomatic));
const postExplosionAutomatic = criticalAutomaticMessage.getFlag("peasant-core", "skillEffectOffers").offers[0];
assert.notEqual(postExplosionAutomatic.operationId, preExplosionAutomaticId);
assert.equal(postExplosionAutomatic.status, "applied");
assert.equal(generatedOfferEffects.size, 2, "Successful replay replaces rather than duplicates its copy");

const { getMatchingDefenseNotables, resolveSelectedDefenseCombat } = await import("../module/data/actor/defense-favorites.mjs");
const usageDefense = {
  id: "ward",
  name: "Ward",
  defense: { responses: ["Projectile"], block: false },
  usages: [{
    id: "shield",
    name: "Shield Block",
    mechanics: { defense: { responses: ["Melee"], block: true, blockType: "Shield", hardness: 5 } },
    rollOverrides: {}
  }]
};
const meleeDefenses = getMatchingDefenseNotables({ system: { notableCombats: [usageDefense] } }, "Melee");
assert.deepEqual(meleeDefenses.map(({ usageId }) => usageId), ["shield"], "alternate defense usages are selectable");
assert.equal(resolveSelectedDefenseCombat([usageDefense], {
  selectedCombatId: "ward", selectedUsageId: "shield"
})?.defense.hardness, 5, "incoming damage resolves the selected usage instead of the base defense");

delete globalThis.ChatMessage;
delete globalThis.fromUuid;
delete globalThis.canvas;
delete globalThis.ui;
delete globalThis.game;
delete globalThis.Roll;
delete globalThis.CONST;
delete globalThis.foundry;

console.log("skill entry use tests passed");
