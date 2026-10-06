import assert from "node:assert/strict";

let nextMessageId = 0;
let nextDice = [3, 4];
const messages = new Map();
messages.contents = [];
const renderChatHooks = [];
globalThis.foundry = {
  applications: { api: {}, ux: { TextEditor: { implementation: {} } } },
  utils: {
    deepClone: structuredClone,
    randomID: () => `wound-${++nextMessageId}`,
    escapeHTML: (value) => String(value)
  }
};
globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
globalThis.Roll = class {
  async evaluate() {
    const result = nextDice;
    nextDice = [3, 4];
    this.dice = [{ results: result.map((value) => ({ result: value })) }];
    this.total = result.reduce((sum, value) => sum + value, 0);
    return this;
  }
};
globalThis.game = {
  user: { id: "gm", isGM: true },
  users: { get: () => ({ id: "gm", isGM: true }) },
  actors: new Map(),
  messages,
  tables: { getName: () => null },
  settings: { get: () => "public" },
  peasantCore: {}
};
globalThis.canvas = { tokens: { controlled: [] } };
globalThis.ui = { notifications: { warn: () => {} } };
globalThis.ChatMessage = {
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id || null }),
  applyMode: (data) => data,
  create: async (data) => {
    const flags = {};
    const message = {
      id: `message-${++nextMessageId}`,
      ...data,
      getFlag: (_scope, key) => flags[key],
      setFlag: async (_scope, key, value) => { flags[key] = structuredClone(value); return value; },
      update: async (changes) => Object.assign(message, changes),
      canUserModify: () => true
    };
    messages.set(message.id, message);
    messages.contents.push(message);
    return message;
  }
};
globalThis.Hooks = {
  once: (_name, callback) => { renderChatHooks.push(callback); return renderChatHooks.length; },
  off: () => {}
};

const { prepareActorSkillContext } = await import("../module/data/actor/sheet-display/skills.mjs");
const { prepareActorNotableCombatContext } = await import("../module/data/actor/sheet-display/notable-combat.mjs");
const { getNotableCombatRollPreview } = await import("../module/data/actor/combat-roll-preview.mjs");
const { createPeasantEntryUsageContext, performPeasantSkillCheck } = await import("../module/applications/combat/skill-entry-use.mjs");
const { executeResolvedNotableCombatRoll } = await import("../module/applications/combat/notable-combat-rolls.mjs");
const { performSavingRoll, performUntrainedSkillRoll } = await import("../module/dice/rolls.mjs");
const { getEffectiveSkillCombatModifiers } = await import("../module/data/actor/combat-modifiers.mjs");
const { rollAttributeToHitFromElement } = await import("../module/applications/actor/controls/roll-actions.mjs");

const skill = {
  id: "trained-skill",
  name: "Swordplay",
  category: "mundane",
  type: "skill",
  rank: "1",
  class: 1,
  tohit: 7,
  accuracy: 0,
  usesCurrent: 1,
  usesMax: 1,
  baseUsage: { name: "Default", resolution: "check", layout: [], rules: [], effectLinks: [] },
  usages: []
};
const untrainedSkill = {
  ...skill,
  id: "untrained-skill",
  name: "Untrained Swordplay",
  rank: "u"
};
const notable = {
  id: "notable-attack",
  name: "Sword Attack",
  category: "martial",
  type: "Weapon",
  rank: "1",
  class: 1,
  tohit: 7,
  accuracy: 0,
  damage: { diceCount: 0, diceValue: 0, flat: 0 }
};
const source = {
  devastatingWounds: 2,
  edge: { value: 1 },
  initiative: 12,
  combatMods: { toHit: 0, accuracy: 1, diceRate: 0, flatDamage: 0, costMod: 0 },
  skills: [skill, untrainedSkill],
  notableCombats: [notable]
};
const actor = {
  id: "wounded-actor",
  uuid: "Actor.wounded-actor",
  name: "Wounded",
  system: { _source: source, ...source, edge: source.edge },
  effects: [],
  ensurePeasantEntryIds: async () => ({ ok: true, changed: false }),
  consumePeasantEntryUses: async () => ({ ok: true, changed: false }),
  consumePeasantCombatUse: async () => ({ ok: true, changed: false }),
  canUserModify: () => true,
  updatePeasantStateData: async (patch) => {
    const value = patch["system.edge.value"];
    if (value !== undefined) {
      actor.system.edge.value = value;
      source.edge.value = value;
    }
  },
  update: async (patch) => {
    const value = patch["system.edge.value"];
    if (value !== undefined) {
      actor.system.edge.value = value;
      source.edge.value = value;
    }
  }
};
actor.sheet = {
  getData: async () => {
    const data = {};
    prepareActorNotableCombatContext(data, actor);
    return data;
  }
};
game.actors.set(actor.id, actor);
canvas.tokens.controlled = [{ actor }];

const skillSheet = {};
prepareActorSkillContext(skillSheet, actor);
assert.equal(skillSheet.skills.find((entry) => entry.id === skill.id).accuracyNum, -3, "Skill preview includes raw Accuracy plus two Wounds");

const notableSheet = {};
prepareActorNotableCombatContext(notableSheet, actor);
assert.equal(notableSheet.notableCombats.find((entry) => entry.id === notable.id).accuracyNum, -3, "Notable preview includes raw Accuracy plus two Wounds");
assert.equal(getNotableCombatRollPreview(actor, { ...notable, type: "Defense" }, { defenseRoll: true }).accuracyNum, -3, "standalone defense preview includes Wounds");

const effectiveModifiers = getEffectiveSkillCombatModifiers(actor);
assert.equal(effectiveModifiers.accuracy, -3);
assert.equal(source.combatMods.accuracy, 1, "derived Accuracy does not mutate authored actor modifiers");
const trainedContext = (await createPeasantEntryUsageContext({
  actor,
  ref: { collection: "skills", entryId: skill.id }
})).usageContext;
const untrainedContext = (await createPeasantEntryUsageContext({
  actor,
  ref: { collection: "skills", entryId: untrainedSkill.id }
})).usageContext;
assert.equal(trainedContext.modifiers.accuracy, -3, "activation stores the effective modifier snapshot");
assert.equal(trainedContext.woundAccuracyModifier, -4, "activation separately snapshots the wound-only modifier for Untrained checks");

source.devastatingWounds = 4;
actor.system.devastatingWounds = 4;
nextDice = [3, 4];
const trainedResult = await performPeasantSkillCheck({ actor, usageContext: trainedContext });
assert.equal(trainedResult.rollResult.accuracy, -3, "trained checks keep the activation snapshot after the actor changes");
nextDice = [2, 3, 6];
const untrainedResult = await performPeasantSkillCheck({ actor, usageContext: untrainedContext });
assert.equal(untrainedResult.rollResult.accuracy, -4, "plain Untrained checks receive only the wound penalty, not authored/global Accuracy");

source.devastatingWounds = 2;
actor.system.devastatingWounds = 2;
nextDice = [6, 5, 1];
await rollAttributeToHitFromElement({ actor, _prepareSheetRollEvent: () => true }, {}, {
  dataset: { characteristic: "Strength" }
});
assert.match(
  messages.contents.at(-1).content,
  /Accuracy: -4/,
  "the actor-sheet Untrained Attribute Skill Roll applies the Wound penalty"
);
const attributeMessage = messages.contents.at(-1);
source.devastatingWounds = 4;
actor.system.devastatingWounds = 4;

const notableResult = await executeResolvedNotableCombatRoll({
  actor,
  combat: notable,
  combatIndex: 0
});
assert.equal(notableResult.accuracy, -7, "Notable Combat rolls use the already-effective actor snapshot exactly once");

const defense = { ...notable, type: "Defense", name: "Reflex Defense" };
const defensePreview = getNotableCombatRollPreview(actor, defense, { defenseRoll: true });
const defenseResult = await executeResolvedNotableCombatRoll({
  actor,
  combat: defense,
  combatIndex: 0,
  rollOverrides: { toHit: defensePreview.modifiedTohit, accuracy: defensePreview.accuracyNum }
});
assert.equal(defenseResult.accuracy, -7, "defense rolls use their wound-adjusted preview override once");

const { startPeasantEntryUse } = await import("../module/applications/combat/skill-entry-use.mjs");
game.peasantCore = { startPeasantEntryUse, performUntrainedSkillRoll };
const { applyEdgeChainRoll } = await import("../module/applications/combat/edge-chain-rolls.mjs");
const edgeReplay = await applyEdgeChainRoll({
  messageId: trainedResult.rollResult.chatMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: actor.id
});
assert.equal(edgeReplay.ok, true);
assert.equal(edgeReplay.rerunResult.rollResult.accuracy, -3, "Edge replay keeps the modifier snapshot from activation");
actor.system.edge.value = 1;
nextDice = [6, 4, 5];
const attributeEdgeReplay = await applyEdgeChainRoll({
  messageId: attributeMessage.id,
  requesterUserId: game.user.id,
  spenderActorId: actor.id
});
assert.equal(attributeEdgeReplay.ok, true, JSON.stringify(attributeEdgeReplay));
assert.equal(
  attributeEdgeReplay.rerunResult.rollResult.accuracy,
  -4,
  "Untrained Attribute Edge replay keeps the original Wound-only Accuracy snapshot"
);

globalThis.HTMLElement = class {};
const macroHandlers = [];
globalThis.$ = () => ({
  length: 1,
  on: (_event, selector, callback) => { macroHandlers.push({ selector, callback }); },
  find: () => ({ off() { return this; }, on() { return this; } }),
  data: (key) => key === "index" ? 0 : undefined
});
game.peasantCore = {};
const { renderNotableCombatsChat } = await import("../module/applications/macros/notable-combats-chat.mjs");
await renderNotableCombatsChat();
const macroMessage = messages.contents.at(-1);
await renderChatHooks.at(-1)(macroMessage, new HTMLElement());
const macroRollHandler = macroHandlers.find(({ selector }) => selector === ".combat-roll-clickable")?.callback;
assert.equal(typeof macroRollHandler, "function");
await macroRollHandler({ currentTarget: {}, preventDefault() {} });
assert.match(messages.contents.at(-1).content, /Accuracy: -7/, "posted Notable Combat chat macros use Wound Accuracy");

const saveResult = await performSavingRoll({ actor, toHit: 8, skillName: "Basic Save" });
assert.equal(saveResult.toHit, 8, "saving throws do not receive the Devastating Wound Accuracy penalty");
assert.equal(actor.system.initiative, 12, "initiative remains an authored value and is not reduced by Wounds");

const { rollAutomatedCombatDamage } = await import("../module/applications/combat/automated-damage-rolls.mjs");
const { rollAutomatedCombatHeal } = await import("../module/applications/combat/automated-heal-rolls.mjs");
const damageResult = await rollAutomatedCombatDamage(actor, {
  name: "Damage Value",
  damage: { diceCount: 0, diceValue: 0, flat: 5, type: "blunt" }
});
assert.equal(damageResult.total, 5, "automated damage values do not use Wound Accuracy");
const healResult = await rollAutomatedCombatHeal(actor, {
  name: "Healing Value",
  heal: { diceCount: 0, diceValue: 0, flat: 5, type: "temporary" }
});
assert.equal(healResult.total, 5, "automated healing values do not use Wound Accuracy");

const locationTable = {
  name: "Location",
  results: [{ name: "Torso" }],
  async draw() { return { results: this.results, roll: { total: 1 } }; },
  async toMessage(_results, options) { return ChatMessage.create(options.messageData); }
};
game.tables.getName = (name) => ["Location", "Location Table"].includes(name) ? locationTable : null;
game.i18n = { format: (key) => key };
const { resolveAttackLocationForTarget } = await import("../module/applications/combat/attack-locations.mjs");
const locationResult = await resolveAttackLocationForTarget({
  actor,
  combat: { name: "Location Value" },
  target: { targetName: "Target" },
  attackRoll: { rollResult: { totalMoS: 0 } }
});
assert.equal(locationResult.location, "Torso");
assert.equal(locationResult.byMagnetism, undefined, "Wounds do not alter location rolls");

console.log("E5 Wound Accuracy tests passed.");
