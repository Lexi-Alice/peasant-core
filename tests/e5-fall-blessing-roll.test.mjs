import assert from "node:assert/strict";

let id = 0;
const messages = new Map();
messages.contents = [];
messages[Symbol.iterator] = () => messages.values();
const hooks = [];
let fallSocketHandler = null;
const actorUpdates = [];
const actors = new Map();
const user = { id: "gm", isGM: true };

function clone(value) {
  return structuredClone(value);
}

function setPath(root, path, value) {
  const parts = path.split(".");
  let current = root;
  for (const part of parts.slice(0, -1)) current = current[part] ??= {};
  current[parts.at(-1)] = clone(value);
}

function createActor({ type = "fall", uses = 3, stress = 0 } = {}) {
  const source = {
    blessing: { type },
    fallBlessingUses: { value: uses, max: 3 },
    stress,
    edge: { value: 2, max: 4 },
    combatMods: { toHit: 0, accuracy: 0 },
    skills: [{ id: "skill-1", name: "Foraging", rank: "trained", tohit: 7, accuracy: 0 }]
  };
  const actor = {
    id: `actor-${++id}`,
    uuid: `Actor.actor-${id}`,
    name: `Actor ${id}`,
    system: { ...clone(source), _source: source },
    canUserModify: () => true,
    async updatePeasantStateData(update) {
      actorUpdates.push(clone(update));
      for (const [path, value] of Object.entries(update)) {
        const systemPath = path.replace(/^system\./, "");
        setPath(this.system, systemPath, value);
        setPath(this.system._source, systemPath, value);
      }
    },
    async update(update) {
      for (const [path, value] of Object.entries(update)) {
        const systemPath = path.replace(/^system\./, "");
        setPath(this.system, systemPath, value);
        setPath(this.system._source, systemPath, value);
      }
    },
    async spendPeasantFallBlessingUses(count) {
      const before = this.system.fallBlessingUses.value;
      if (!Number.isInteger(count) || count < 1 || count > before) return { ok: false };
      await this.updatePeasantStateData({ "system.fallBlessingUses.value": before - count });
      return { ok: true, before, after: before - count, usesSpent: count };
    }
  };
  actors.set(actor.id, actor);
  return actor;
}

class FakeElement {
  constructor(text = "") {
    this.textContent = text;
    this.innerHTML = text;
    this.style = {};
    this.children = [];
    this.nextSibling = null;
  }
  querySelectorAll(selector) { return selector === "span" ? this.spans ?? [] : []; }
  querySelector(selector) {
    if (selector === ":scope > div:nth-child(2) > div") return this.topRow ?? null;
    if (selector === ".pc-force-pass-note") return this.forcePassNote ?? null;
    return null;
  }
  insertBefore(element) { this.children.push(element); }
  appendChild(element) { this.children.push(element); }
  remove() { this.removed = true; }
}

let currentRollDom = null;
let includeForcePassNote = false;
class FakeRollRoot extends FakeElement {
  constructor() {
    super();
    const toHit = new FakeElement();
    toHit.spans = [new FakeElement(), new FakeElement()];
    const topRow = new FakeElement();
    topRow.children = [toHit];
    this.card = new FakeElement();
    this.card.topRow = topRow;
    this.mos = new FakeElement();
    this.outcome = new FakeElement();
    this.details = new FakeElement();
    this.diceLine = new FakeElement("Dice: [3, 3] = 6");
    this.criticalLine = new FakeElement("Critical Dice: [2] = 2");
    this.baseMoSLine = new FakeElement("Base MoS: -0.25");
    this.accuracyLine = new FakeElement("Accuracy: 0");
    this.details.children = [this.diceLine, this.criticalLine, this.baseMoSLine, this.accuracyLine];
    if (includeForcePassNote) {
      this.details.forcePassNote = new FakeElement("Forced Pass: 2 General Stress");
      this.details.children.push(this.details.forcePassNote);
    }
    currentRollDom = this;
  }
  querySelector(selector) {
    return ({
      ".skill-roll-card": this.card,
      ".mos-toggle": this.mos,
      ".roll-details": this.details,
      ".skill-roll-card .roll-details + div": this.outcome
    })[selector] ?? null;
  }
}

globalThis.HTMLElement = FakeElement;
globalThis.document = { createElement: () => new FakeRollRoot() };
globalThis.foundry = { utils: { deepClone: clone, randomID: () => `id-${++id}` } };
globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
globalThis.Hooks = { on: (_event, callback) => hooks.push(callback) };
globalThis.Roll = class {
  constructor() { assert.fail("Fall Accuracy must use the resolved dice and never roll again."); }
};
globalThis.game = {
  user,
  users: { get: userId => userId === user.id ? user : null },
  actors: { get: actorId => actors.get(actorId) || null },
  messages,
  settings: { get: (_system, key) => key === "debugLogging" ? false : "public" },
  peasantCore: {}
};
globalThis.fromUuid = async uuid => [...actors.values()].find(actor => actor.uuid === uuid) || null;
globalThis.ChatMessage = {
  applyMode: data => data,
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id || "" }),
  create: async data => {
    const message = createMessage(data);
    messages.set(message.id, message);
    messages.contents.push(message);
    return message;
  }
};

function createMessage({ content = "<fieldset class=\"skill-roll-card\"></fieldset>", owner = true } = {}) {
  const flags = {};
  return {
    id: `message-${++id}`,
    content,
    updates: [],
    getFlag: (_system, key) => flags[key],
    setFlag: async (_system, key, value) => { flags[key] = clone(value); },
    unsetFlag: async (_system, key) => { delete flags[key]; },
    canUserModify: () => owner,
    async update(changes) { this.updates.push(clone(changes)); Object.assign(this, changes); },
    async delete() { messages.delete(this.id); }
  };
}

async function createSkillMessage(actor, {
  kind = "skill",
  trained = true,
  dice = [3, 3],
  toHit = 7,
  accuracy = 0,
  critical = null,
  rerun = { type: "actorSkillRoll", actorId: actor.id, actorUuid: actor.uuid, skillIndex: 0 },
  chainStatus = "current",
  processing = false,
  postRollRecords = [],
  checkpoint = null
} = {}) {
  const message = createMessage();
  messages.set(message.id, message);
  messages.contents.push(message);
  await message.setFlag("peasant-core", "edgeChain", {
    version: 2, status: chainStatus, processing, chainId: `chain-${message.id}`,
    kind, label: "Skill", rerun, undoRecords: [], preRollRecords: [], postRollRecords
  });
  await message.setFlag("peasant-core", "edgeIndividualDie", {
    version: 1, status: "current", processing: false,
    chainId: `chain-${message.id}`, kind: "skill", label: "Skill",
    trained, diceFaces: 6, dice, toHit, accuracy, checkpoint
  });
  if (critical) {
    await message.setFlag("peasant-core", "edgeExplode", {
      version: 2, status: "current", processing: false, trained,
      initialDice: trained ? dice.slice(0, 2) : [],
      allDice: trained ? [] : dice.slice(0, 3),
      keptDice: trained ? [] : dice.slice(0, 2),
      explosionDice: critical.dice,
      toHit, accuracy, criticalType: critical.label, criticalMoS: critical.mos,
      checkpoint: null, preRollRecords: [], postRollRecords: []
    });
  }
  return message;
}

function menuFor(message) {
  const menu = [];
  for (const hook of hooks) hook(null, menu);
  const element = { dataset: { messageId: message.id } };
  return menu.filter(item => item.condition(element)).map(item => item.name);
}

const edge = await import("../module/applications/combat/edge-chain-rolls.mjs");
assert.equal(typeof edge.applyFallBlessingAccuracy, "function", "Fall must expose its atomic Accuracy application");
assert.equal(typeof edge.fallBlessingAccuracyFromMessage, "function", "Fall must expose the message action");
assert.equal(typeof edge.configureFallBlessingRollChatContext, "function", "Fall must register its chat action");

edge.configureFallBlessingRollChatContext();
const actor = createActor({ uses: 3 });
const message = await createSkillMessage(actor);
assert.deepEqual(menuFor(message), ["Blessing of Fall"]);

{
  const previousHooks = globalThis.Hooks;
  const registrations = [];
  globalThis.Hooks = { on: (event, callback) => registrations.push({ event, callback }) };
  try {
    const chatListeners = await import("../module/applications/chat-listeners.mjs");
    chatListeners.configureChatListeners();
    const menuItems = [];
    for (const { event, callback } of registrations) {
      if (event === "getChatMessageContextOptions") callback(null, menuItems);
    }
    const names = menuItems.map(item => item.name);
    assert.ok(names.indexOf("Stress Roll") < names.indexOf("Blessing of Fall"));
    assert.ok(names.indexOf("Blessing of Fall") < names.indexOf("Edge Entire Chain"));
  } finally {
    globalThis.Hooks = previousHooks;
  }
}

{
  const previousFromUuidSync = globalThis.fromUuidSync;
  const baseActor = createActor({ type: "", uses: 0 });
  const tokenActor = createActor({ uses: 2 });
  tokenActor.documentName = "Actor";
  globalThis.fromUuidSync = uuid => [baseActor, tokenActor].find(candidate => candidate.uuid === uuid) || null;
  try {
    const tokenMessage = await createSkillMessage(tokenActor);
    const chainFlag = tokenMessage.getFlag("peasant-core", "edgeChain");
    await tokenMessage.setFlag("peasant-core", "edgeChain", {
      ...chainFlag,
      rerun: { ...chainFlag.rerun, actorId: baseActor.id, actorUuid: tokenActor.uuid }
    });
    assert.deepEqual(
      menuFor(tokenMessage),
      ["Blessing of Fall"],
      "Fall resolves the exact token actor by UUID when actorId points at its base actor"
    );
  } finally {
    globalThis.fromUuidSync = previousFromUuidSync;
  }
}

{
  const previousApplications = foundry.applications;
  const previousDollar = globalThis.$;
  const previousUi = globalThis.ui;
  let dialogApplyResult = null;
  const input = { value: "1.5" };
  const dialogElement = {
    nodeType: 1,
    isConnected: true,
    querySelector: selector => selector === '[name="fallBlessingUsesSpent"]' ? input : null,
    querySelectorAll: () => [],
    closest() { return this; }
  };
  class FakeDialogV2 {
    constructor(config) {
      this.config = config;
      this.element = dialogElement;
    }
    render() {
      queueMicrotask(async () => {
        dialogApplyResult = await this.config.buttons.find(button => button.action === "apply").callback(null, null, this);
        await this.config.buttons.find(button => button.action === "cancel").callback(null, null, this);
      });
      return Promise.resolve(this);
    }
  }
  foundry.applications = { api: { DialogV2: FakeDialogV2 } };
  globalThis.$ = element => [element];
  globalThis.ui = { notifications: { warn() {} } };
  const promptActor = createActor({ uses: 3 });
  const promptMessage = await createSkillMessage(promptActor);
  assert.equal(await edge.fallBlessingAccuracyFromMessage(promptMessage.id), false, "The multi-use prompt rejects fractional counts");
  assert.equal(dialogApplyResult, false, "Apply leaves a rejected fraction unselected");
  assert.equal(promptActor.system.fallBlessingUses.value, 3, "Invalid dialog input does not spend Fall uses");
  foundry.applications = previousApplications;
  globalThis.$ = previousDollar;
  globalThis.ui = previousUi;
}

const appliedMessages = [];
for (const usesSpent of [1, 2, 3]) {
  const subjectActor = createActor({ uses: 5 });
  const subject = await createSkillMessage(subjectActor, { dice: [3, 3] });
  appliedMessages.push(subject);
  const beforeUpdates = actorUpdates.length;
  const result = await edge.applyFallBlessingAccuracy({ messageId: subject.id, usesSpent, requesterUserId: user.id });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.usesSpent, usesSpent);
  assert.equal(result.accuracyBonus, usesSpent * 4);
  assert.equal(result.rollResult.accuracy, usesSpent * 4);
  assert.equal(result.rollResult.accuracyMoS, usesSpent);
  assert.equal(result.rollResult.totalMoS, -0.25 + usesSpent);
  assert.equal(result.rollResult.resultText, "Glancing Success");
  assert.equal(result.rollResult.chatMessage.id, subject.id, "Fall updates the resolved roll card in place");
  assert.equal(actorUpdates.length, beforeUpdates + 1, "One multi-use action spends Fall once");
  assert.equal(edge.getEdgeChainFlag(subject).fallAccuracyApplied, true);
  assert.equal(edge.getEdgeChainFlag(subject).fallAccuracyUsesSpent, usesSpent);
  assert.equal(edge.getEdgeChainFlag(subject).fallAccuracyBonus, usesSpent * 4);
  assert.equal(edge.getEdgeIndividualDieFlag(subject).accuracy, usesSpent * 4);
  assert.equal(subject.updates.length, 1, "The existing chat card is refreshed without creating a new roll");
  assert.equal(currentRollDom.mos.textContent, `${-0.25 + usesSpent}`);
  assert.equal(currentRollDom.outcome.textContent, "Glancing Success");
}

{
  const fallActor = createActor({ uses: 1 });
  const definition = {
    id: "fall-effect", type: "skill", flags: { "peasant-core": { skillEditorDefinition: true } }, changes: [],
    toObject() { return { _id: this.id, type: this.type, flags: this.flags, changes: [] }; }
  };
  const generatedEffects = new Map();
  fallActor.effects = {
    get: effectId => effectId === definition.id ? definition : generatedEffects.get(effectId),
    [Symbol.iterator]: () => [definition, ...generatedEffects.values()][Symbol.iterator]()
  };
  fallActor.createEmbeddedDocuments = async (_type, sources) => sources.map(source => {
    const data = clone({ ...source, _id: source._id || `applied-${++id}` });
    const effect = { id: data._id, type: data.type, flags: data.flags, _source: data, toObject: () => clone(data) };
    generatedEffects.set(effect.id, effect);
    return effect;
  });
  fallActor.deleteEmbeddedDocuments = async (_type, ids) => { ids.forEach(effectId => generatedEffects.delete(effectId)); };
  fallActor.updateEmbeddedDocuments = async () => {};
  const usageContext = {
    version: 1, resolution: "check",
    ref: { collection: "skills", entryId: "skill-1", usageId: "base" },
    data: { baseUsage: { effectLinks: [{ id: "fall-link", effectId: definition.id, when: "always", recipient: "self", application: "offer" }] } }
  };
  const message = await createSkillMessage(fallActor, {
    rerun: { type: "peasantEntryUse", actorId: fallActor.id, actorUuid: fallActor.uuid, usageContext }
  });
  const { applySkillEffectOffer, offerSkillEntryEffects } = await import("../module/applications/combat/skill-entry-effects.mjs");
  await offerSkillEntryEffects({ actor: fallActor, usageContext, message, targets: [{ actorUuid: fallActor.uuid, success: false, hit: false }] });
  const oldOfferId = message.getFlag("peasant-core", "skillEffectOffers").offers[0].operationId;
  assert.equal((await applySkillEffectOffer({ message, operationId: oldOfferId, requesterUserId: user.id })).ok, true);
  assert.equal(generatedEffects.size, 1);
  const originalCreate = ChatMessage.create;
  const originalConsoleError = console.error;
  ChatMessage.create = async () => { throw new Error("simulated summary failure"); };
  console.error = () => {};
  let failed;
  try {
    failed = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  } finally {
    ChatMessage.create = originalCreate;
    console.error = originalConsoleError;
  }
  assert.equal(failed.ok, false);
  assert.equal(generatedEffects.size, 1, "A failed Fall action restores the applied effect copy");
  assert.equal(fallActor.system.fallBlessingUses.value, 1);
  assert.equal(message.getFlag("peasant-core", "skillEffectOffers").offers[0].status, "applied");
  const result = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(result.ok, true, result.error);
  assert.equal(generatedEffects.size, 0, "Blessing of Fall removes an effect applied to the prior result");
  assert.notEqual(message.getFlag("peasant-core", "skillEffectOffers").offers[0].operationId, oldOfferId);
  assert.equal(message.getFlag("peasant-core", "skillEffectOffers")?.offers?.length, 1,
    "Fall passing an in-place Skill check offers its success-gated effect");
}

{
  const fallActor = createActor({ uses: 2 });
  const message = await createSkillMessage(fallActor, { accuracy: 2 });
  const chainFlag = edge.getEdgeChainFlag(message);
  await message.setFlag("peasant-core", "edgeChain", { ...chainFlag, label: "Foraging" });
  const firstNewMessageIndex = messages.contents.length;
  const result = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(result.ok, true, result.error);
  const [summary] = messages.contents.slice(firstNewMessageIndex);
  assert.ok(summary, "Using Fall creates an output card");
  assert.equal(result.summaryMessageId, summary.id);
  assert.match(summary.content, /<legend>Blessing of Fall On Foraging<\/legend>/);
  assert.match(summary.content, /Original MoS: \+0\.25/);
  assert.match(summary.content, /New MoS: \+1\.25/);
  assert.doesNotMatch(summary.content, /Accuracy:|Uses spent:/);
}

{
  const fallActor = createActor({ uses: 1 });
  const checkpoint = {
    version: 2,
    type: "notableCombatPostRoll",
    stage: "attack",
    actor: { actorId: fallActor.id, actorUuid: fallActor.uuid },
    chainId: "fall-summary-order",
    targets: []
  };
  const message = await createSkillMessage(fallActor, {
    kind: "attack",
    rerun: { type: "notableCombat", actorId: fallActor.id, actorUuid: fallActor.uuid },
    checkpoint
  });
  const previousPlanner = game.peasantCore.planNotableCombatEdgeExplodeReplay;
  const previousReplay = game.peasantCore.replayNotableCombatPostRollEffects;
  game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: true });
  let replayCard = null;
  game.peasantCore.replayNotableCombatPostRollEffects = async () => {
    replayCard = await ChatMessage.create({ content: "Fall downstream result" });
    return { ok: true, postRollRecords: [], messageIds: [replayCard.id] };
  };
  const firstNewMessageIndex = messages.contents.length;
  const result = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  game.peasantCore.planNotableCombatEdgeExplodeReplay = previousPlanner;
  game.peasantCore.replayNotableCombatPostRollEffects = previousReplay;
  assert.equal(result.ok, true, result.error);
  const newMessages = messages.contents.slice(firstNewMessageIndex);
  assert.equal(newMessages[0].id, result.summaryMessageId, "The Fall summary precedes replay-generated cards");
  assert.equal(newMessages[1].id, replayCard.id);
}

for (const usesSpent of [0, -1, 1.5, 4, "1"]) {
  const beforeValue = actor.system.fallBlessingUses.value;
  const beforeUpdates = actorUpdates.length;
  const invalid = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent, requesterUserId: user.id });
  assert.equal(invalid.ok, false);
  assert.equal(actor.system.fallBlessingUses.value, beforeValue);
  assert.equal(actorUpdates.length, beforeUpdates);
}

assert.deepEqual(menuFor(appliedMessages[0]), [], "An already-modified roll cannot spend Fall twice");

const criticalMessage = await createSkillMessage(actor, {
  dice: [6, 6], accuracy: 2,
  critical: { dice: [2, 4], mos: 1.5, label: "Critical Success" }
});
const critical = await edge.applyFallBlessingAccuracy({ messageId: criticalMessage.id, usesSpent: 1, requesterUserId: user.id });
assert.equal(critical.ok, true, critical.error);
assert.equal(critical.rollResult.resultText, "Critical Success", "Fall preserves critical identity");
assert.equal(critical.rollResult.criticalType, "Critical Success");
assert.deepEqual(critical.rollResult.additionalDice, [2, 4], "Fall preserves resolved explosion dice");
assert.equal(critical.rollResult.accuracy, 6);

const forbidden = [
  await createSkillMessage(actor, { kind: "save", rerun: { type: "savingRoll", actorId: actor.id } }),
  await createSkillMessage(actor, { kind: "check", rerun: { type: "consciousnessCheck", actorId: actor.id } }),
  await createSkillMessage(actor, { kind: "location" }),
  await createSkillMessage(actor, { kind: "damage" }),
  await createSkillMessage(actor, { kind: "heal", dice: [2], trained: true }),
  await createSkillMessage(actor, { chainStatus: "superseded" }),
  await createSkillMessage(actor, { processing: true }),
  await createSkillMessage(createActor({ type: "summer", uses: 2 })),
  await createSkillMessage(createActor({ uses: 0 })),
  await createSkillMessage(actor, { rerun: { type: "skillRoll", skillName: "unowned" } })
];
for (const rejected of forbidden) assert.deepEqual(menuFor(rejected), [], `Fall rejected ${rejected.id}`);

for (const { dice, accuracy, expected, success } of [
  { dice: [2, 2], accuracy: -4, expected: "Failure", success: false },
  { dice: [4, 4], accuracy: -4, expected: "Success", success: true }
]) {
  const actor = createActor({ uses: 1 });
  const message = await createSkillMessage(actor, { dice, accuracy });
  const result = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.rollResult.resultText, expected, "Fall recomputes Failure/Narrow Success after adding Accuracy");
  assert.equal(result.rollResult.isSuccess, success);
}

{
  const actor = createActor({ uses: 1 });
  const message = await createSkillMessage(actor, { trained: false, dice: [6, 3, 2] });
  const result = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.rollResult.allDice, [6, 3, 2]);
  assert.deepEqual(result.rollResult.keptDice, [3, 2]);
  assert.equal(result.rollResult.initialTotal, 5);
  assert.equal(result.rollResult.accuracy, 4);
}

for (const { kind, stage, isHealRoll } of [
  { kind: "attack", stage: "attack", isHealRoll: false },
  { kind: "defense", stage: "defense", isHealRoll: false },
  { kind: "heal", stage: "attack", isHealRoll: true }
]) {
  const attacker = createActor({ uses: 2 });
  const target = createActor({ stress: 1 });
  const oldPostRoll = {
    id: `old-${kind}`,
    actorId: target.id,
    actorUuid: target.uuid,
    actorName: target.name,
    label: `${kind} downstream effect`,
    before: { "system.stress": 0 },
    after: { "system.stress": 1 }
  };
  const checkpoint = {
    version: 2,
    type: "notableCombatPostRoll",
    stage,
    actor: { actorId: attacker.id, actorUuid: attacker.uuid },
    chainId: `notable-${kind}`,
    isHealRoll,
    multiTarget: false,
    defenseTargetRef: stage === "defense" ? { actorId: target.id, actorUuid: target.uuid } : null,
    targets: [{ targetRef: { actorId: target.id, actorUuid: target.uuid }, locationRoll: { roll: 7, location: "Torso", isResolved: true } }]
  };
  const message = await createSkillMessage(attacker, {
    kind,
    dice: [3, 3],
    rerun: { type: "notableCombat", actorId: attacker.id, actorUuid: attacker.uuid, accuracyAdj: 0, rollMode: isHealRoll ? "heal" : "" },
    postRollRecords: [oldPostRoll],
    checkpoint
  });
  const sourceContent = message.content;
  let planned = 0;
  let replayed = 0;
  let locationPrompts = 0;
  game.peasantCore.planNotableCombatEdgeExplodeReplay = async data => {
    planned++;
    assert.deepEqual(data.checkpoint, checkpoint, "Fall passes every existing checkpoint field to the planner");
    assert.equal(data.rollResult.chatMessage.id, message.id);
    assert.equal(data.rollResult.accuracy, 4);
    return { ok: true, replayRequired: true };
  };
  game.peasantCore.replayNotableCombatPostRollEffects = async data => {
    replayed++;
    assert.deepEqual(data.checkpoint.targets[0].locationRoll, checkpoint.targets[0].locationRoll);
    assert.equal(target.system.stress, 0, "Undo downstream effects before replay");
    await message.update({ content: `replayed ${kind}` });
    await target.updatePeasantStateData({ "system.stress": 2 });
    const nextPostRoll = { ...oldPostRoll, id: `new-${kind}`, before: { "system.stress": 0 }, after: { "system.stress": 2 } };
    return { ok: true, postRollRecords: [nextPostRoll], messageIds: [] };
  };

  const result = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(result.ok, true, result.error);
  assert.equal(planned, 1);
  assert.equal(replayed, 1);
  assert.equal(locationPrompts, 0, "Fall replay reuses the resolved location checkpoint");
  assert.equal(target.system.stress, 2, "The downstream operation is applied once after replay");
  assert.equal(edge.getEdgeChainFlag(message).fallAccuracyBonus, 4);
  assert.equal(edge.getEdgeChainFlag(message).rerun.accuracyAdj, stage === "defense" ? 0 : 4);
  assert.ok(edge.getEdgeChainFlag(message).postRollRecords.some(record => record.id === `new-${kind}`));
  assert.ok(edge.getEdgeChainFlag(message).preRollRecords.some(record => record.label === "Blessing of Fall Accuracy Uses"));
  assert.notEqual(message.content, sourceContent, "Replay keeps the existing resolved card current");
}

{
  const attacker = createActor({ uses: 3 });
  const target = createActor({ stress: 1 });
  const oldPostRoll = {
    id: "rollback-old-post",
    actorId: target.id,
    actorUuid: target.uuid,
    label: "Old damage state",
    before: { "system.stress": 0 },
    after: { "system.stress": 1 }
  };
  const checkpoint = {
    version: 2,
    type: "notableCombatPostRoll",
    stage: "attack",
    actor: { actorId: attacker.id, actorUuid: attacker.uuid },
    chainId: "rollback-chain",
    targets: [{ locationRoll: { roll: 7, location: "Torso" } }]
  };
  const message = await createSkillMessage(attacker, {
    kind: "attack",
    checkpoint,
    postRollRecords: [oldPostRoll],
    rerun: { type: "notableCombat", actorId: attacker.id, actorUuid: attacker.uuid }
  });
  await message.setFlag("peasant-core", "rollUndo", { status: "available", records: [oldPostRoll] });
  const originalContent = message.content;
  const messagesBeforeFailure = new Set(messages.keys());
  const originalChainFlag = edge.getEdgeChainFlag(message);
  const originalRollFlag = edge.getEdgeIndividualDieFlag(message);
  const partial = createMessage({ content: "partial replay" });
  messages.set(partial.id, partial);
  messages.contents.push(partial);
  const replayRecord = { ...oldPostRoll, id: "rollback-new-post", before: { "system.stress": 0 }, after: { "system.stress": 2 } };
  game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: true });
  game.peasantCore.replayNotableCombatPostRollEffects = async () => {
    await target.updatePeasantStateData({ "system.stress": 2 });
    return { ok: false, error: "simulated replay failure", postRollRecords: [replayRecord], messageIds: [partial.id] };
  };
  const previousConsoleError = console.error;
  console.error = () => {};
  let failed;
  try {
    failed = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 2, requesterUserId: user.id });
  } finally {
    console.error = previousConsoleError;
  }
  assert.equal(failed.ok, false);
  assert.equal(attacker.system.fallBlessingUses.value, 3, "Failure restores the full selected Fall count");
  assert.equal(target.system.stress, 1, "Failure restores the original downstream state after cleaning partial replay effects");
  assert.equal(message.content, originalContent);
  assert.equal(edge.getEdgeChainFlag(message).status, "current");
  assert.equal(edge.getEdgeChainFlag(message).fallAccuracyApplied, false);
  assert.equal(edge.getEdgeIndividualDieFlag(message).status, originalRollFlag.status);
  assert.deepEqual(message.getFlag("peasant-core", "edgeChain").rerun, originalChainFlag.rerun);
  assert.deepEqual(message.getFlag("peasant-core", "rollUndo").records, [oldPostRoll]);
  assert.equal(messages.has(partial.id), false, "Remove the partial replay card");
  const summaryCards = messages.contents.filter(candidate =>
    !messagesBeforeFailure.has(candidate.id) && candidate.content.includes("pc-fall-blessing-roll-card")
  );
  assert.equal(summaryCards.length, 1, "The failed action creates then removes its temporary summary card");
  assert.equal(messages.has(summaryCards[0].id), false, "Failure removes the temporary Fall summary card");
}

{
  const owner = { id: "player", isGM: false };
  const gm = { id: "gm", isGM: true, active: true };
  user.active = true;
  const users = [owner, gm];
  users.get = id => users.find(candidate => candidate.id === id) || null;
  game.users = users;
  const fallActor = createActor({ uses: 1 });
  const target = createActor({ stress: 1 });
  target.canUserModify = candidate => candidate.isGM === true;
  const targetRecord = {
    id: "remote-target-post",
    actorId: target.id,
    actorUuid: target.uuid,
    label: "Target damage",
    before: { "system.stress": 0 },
    after: { "system.stress": 1 }
  };
  const checkpoint = {
    version: 2,
    type: "notableCombatPostRoll",
    stage: "attack",
    actor: { actorId: fallActor.id, actorUuid: fallActor.uuid },
    chainId: "remote-chain",
    targets: [{ targetRef: { actorId: target.id, actorUuid: target.uuid } }]
  };
  const message = await createSkillMessage(fallActor, {
    kind: "attack",
    checkpoint,
    postRollRecords: [targetRecord],
    rerun: { type: "notableCombat", actorId: fallActor.id, actorUuid: fallActor.uuid }
  });
  message.canUserModify = () => false;
  const requests = [];
  const previousUser = game.user;
  game.user = owner;
  game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: true });
  game.peasantCore.requestEdgeLocationRollFromGM = async payload => {
    requests.push(payload);
    return { ok: true };
  };
  globalThis.canvas = { tokens: { controlled: [{ actor: target }] } };
  assert.equal(await edge.fallBlessingAccuracyFromMessage(message.id), true);
  assert.deepEqual(requests, [{
    edgeRollMode: "fallBlessing",
    messageId: message.id,
    usesSpent: 1,
    actorId: fallActor.id,
    actorUuid: fallActor.uuid
  }], "GM routing follows the roll-chain owner even when another token is selected");
  assert.equal(fallActor.system.fallBlessingUses.value, 1, "The requesting client does not spend uses before GM execution");
  game.user = previousUser;
  game.users = { get: id => id === user.id ? user : null };
}

{
  const player = { id: "remote-player", isGM: false };
  const gm = { id: "remote-gm", isGM: true, active: true };
  const users = [player, gm];
  users.get = id => users.find(candidate => candidate.id === id) || null;
  game.users = users;
  game.user = gm;
  const actor = createActor({ uses: 1 });
  const message = await createSkillMessage(actor);
  const socketEvents = [];
  let socketHandler = null;
  game.socket = {
    on: (_namespace, handler) => { socketHandler = handler; },
    off() {},
    emit: (_namespace, payload) => socketEvents.push(payload)
  };
  const dispatched = [];
  game.peasantCore.applyFallBlessingAccuracy = async payload => {
    dispatched.push(payload);
    return edge.applyFallBlessingAccuracy(payload);
  };
  const remote = await import("../module/socket/remote-prompts.mjs");
  remote.registerPeasantSocketHandler();
  fallSocketHandler = socketHandler;

  const payload = {
    type: "requestEdgeLocationRoll",
    requestId: "fall-request",
    userId: player.id,
    requesterUserId: player.id,
    edgeRollMode: "fallBlessing",
    messageId: message.id,
    actorId: actor.id,
    actorUuid: actor.uuid,
    usesSpent: 1
  };
  await socketHandler(payload);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].requesterUserId, player.id);
  assert.equal(dispatched[0].usesSpent, 1);
  assert.equal(socketEvents.at(-1).ok, true);

  const unaffordableMessage = await createSkillMessage(actor);
  await socketHandler({ ...payload, messageId: unaffordableMessage.id, requestId: "bad-count", usesSpent: 2 });
  assert.equal(dispatched.length, 2, "The GM delegates affordability to the serialized actor transaction");
  assert.equal(socketEvents.at(-1).ok, false);

  const currentChain = edge.getEdgeChainFlag(message);
  await message.setFlag("peasant-core", "edgeChain", { ...currentChain, status: "superseded" });
  await socketHandler({ ...payload, requestId: "stale-roll" });
  assert.equal(dispatched.length, 2, "The GM rejects a superseded roll before invoking the API");
  assert.equal(socketEvents.at(-1).ok, false);

  const unownedActor = createActor({ uses: 1 });
  unownedActor.canUserModify = () => false;
  const unownedMessage = await createSkillMessage(unownedActor);
  await socketHandler({ ...payload, requestId: "unowned-actor", messageId: unownedMessage.id, actorId: unownedActor.id, actorUuid: unownedActor.uuid });
  assert.equal(dispatched.length, 2, "The GM rejects a requester who does not own the roll actor");
  assert.equal(socketEvents.at(-1).ok, false);

  const nonFallActor = createActor({ type: "winter", uses: 1 });
  const nonFallMessage = await createSkillMessage(nonFallActor);
  await socketHandler({ ...payload, requestId: "non-fall-actor", messageId: nonFallMessage.id, actorId: nonFallActor.id, actorUuid: nonFallActor.uuid });
  assert.equal(dispatched.length, 2, "The GM rejects an actor without Fall before invoking the API");
  assert.equal(socketEvents.at(-1).ok, false);
  game.user = user;
  game.users = { get: id => id === user.id ? user : null };
}

{
  const edgeActor = createActor({ uses: 3 });
  edgeActor.system._source.edge.value = 2;
  const message = await createSkillMessage(edgeActor, { dice: [3, 3] });
  const applied = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(edgeActor.system.fallBlessingUses.value, 2);

  let rerunArgs = null;
  game.peasantCore.performSkillRoll = async args => {
    rerunArgs = args;
    const replacement = createMessage();
    messages.set(replacement.id, replacement);
    messages.contents.push(replacement);
    const result = {
      chatMessage: replacement,
      toHit: args.toHit,
      accuracy: args.accuracy,
      initialDice: [4, 4],
      allDice: [], keptDice: [], additionalDice: [],
      initialTotal: 8, total: 8,
      baseMoS: 0.25, accuracyMoS: 1, criticalMoS: 0,
      totalMoS: 1.25, isSuccess: true, resultText: "Success", criticalType: ""
    };
    await edge.attachEdgeChainToChatMessage(replacement, args.edgeChainContext, []);
    await edge.attachEdgeIndividualDieToChatMessage(replacement, result, { kind: "skill", trained: true, label: "Foraging" });
    return result;
  };
  const rerun = await edge.applyEdgeChainRoll({ messageId: message.id, spenderActorId: edgeActor.id, requesterUserId: user.id });
  assert.equal(rerun.ok, true, rerun.error);
  assert.equal(rerunArgs.accuracy, 4, "Edge Entire reruns include the already-paid Fall Accuracy");
  assert.equal(edgeActor.system.fallBlessingUses.value, 2, "Edge Entire does not refund or spend Fall a second time");
  const entireResult = rerun.rerunResult.rollResult.chatMessage;
  assert.equal(edge.getEdgeChainFlag(entireResult).fallAccuracyApplied, true);
  assert.equal(edge.getEdgeChainFlag(entireResult).fallAccuracyBonus, 4);
  assert.ok(entireResult.getFlag("peasant-core", "rollUndo").records.some(record => record.label === "Blessing of Fall Accuracy Uses"));

  globalThis.Roll = class {
    async evaluate() {
      this.dice = [{ results: [{ result: 4 }] }];
      this.total = 4;
      return this;
    }
  };
  const individual = await edge.applyEdgeIndividualDieRoll({
    messageId: entireResult.id,
    spenderActorId: edgeActor.id,
    requesterUserId: user.id,
    dieIndex: 0
  });
  assert.equal(individual.ok, true, individual.error);
  assert.equal(individual.rollResult.accuracy, 4, "Edge Individual keeps the Fall modifier");
  assert.equal(edgeActor.system.fallBlessingUses.value, 2);
  assert.equal(edge.getEdgeChainFlag(entireResult).fallAccuracyApplied, true);
  assert.deepEqual(menuFor(entireResult), [], "The post-Edge roll cannot spend Fall again");
}

{
  const edgeActor = createActor({ uses: 3 });
  edgeActor.system._source.edge.value = 1;
  const original = await createSkillMessage(edgeActor, { dice: [3, 3] });
  game.peasantCore.performSkillRoll = async args => {
    const replacement = createMessage();
    messages.set(replacement.id, replacement);
    messages.contents.push(replacement);
    const result = {
      chatMessage: replacement, toHit: args.toHit, accuracy: args.accuracy,
      initialDice: [4, 4], allDice: [], keptDice: [], additionalDice: [],
      initialTotal: 8, total: 8, baseMoS: 0.25, accuracyMoS: 0,
      criticalMoS: 0, totalMoS: 0.25, isSuccess: true, resultText: "Success", criticalType: ""
    };
    await edge.attachEdgeChainToChatMessage(replacement, args.edgeChainContext, []);
    await edge.attachEdgeIndividualDieToChatMessage(replacement, result, { kind: "skill", label: "Foraging" });
    return result;
  };
  const edged = await edge.applyEdgeChainRoll({ messageId: original.id, spenderActorId: edgeActor.id, requesterUserId: user.id });
  assert.equal(edged.ok, true, edged.error);
  const rerolledMessage = edged.rerunResult.rollResult.chatMessage;
  const applied = await edge.applyFallBlessingAccuracy({ messageId: rerolledMessage.id, usesSpent: 2, requesterUserId: user.id });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.rollResult.accuracy, 8, "Fall after Edge Entire applies the selected stack to the rerolled dice");
  assert.equal(edgeActor.system.fallBlessingUses.value, 1);
  assert.equal(edge.getEdgeChainFlag(rerolledMessage).fallAccuracyUsesSpent, 2);
}

{
  const edgeActor = createActor({ uses: 3 });
  edgeActor.system._source.edge.value = 1;
  const message = await createSkillMessage(edgeActor, {
    dice: [6, 6], accuracy: 2,
    critical: { dice: [3], mos: 0.75, label: "Critical Success" }
  });
  const applied = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(edge.getEdgeExplodeFlag(message).accuracy, 6);
  globalThis.Roll = class {
    async evaluate() {
      this.dice = [{ results: [{ result: 4 }] }];
      this.total = 4;
      return this;
    }
  };
  const exploded = await edge.applyEdgeExplodeRoll({ messageId: message.id, spenderActorId: edgeActor.id, requesterUserId: user.id });
  assert.equal(exploded.ok, true, exploded.error);
  assert.equal(exploded.rollResult.accuracy, 6, "Edge Explode keeps the stacked Fall Accuracy");
  assert.equal(edgeActor.system.fallBlessingUses.value, 2);
  assert.equal(edge.getEdgeChainFlag(message).fallAccuracyApplied, true);
}

{
  const edgeActor = createActor({ uses: 2 });
  const message = await createSkillMessage(edgeActor, {
    dice: [6, 6],
    critical: { dice: [3], mos: 0.75, label: "Critical Success" }
  });
  globalThis.Roll = class {
    async evaluate() {
      this.dice = [{ results: [{ result: 4 }] }];
      this.total = 4;
      return this;
    }
  };
  const edged = await edge.applyEdgeIndividualDieRoll({
    messageId: message.id,
    spenderActorId: edgeActor.id,
    requesterUserId: user.id,
    dieIndex: 0
  });
  assert.equal(edged.ok, true, edged.error);
  assert.equal(edged.rollResult.criticalType, "");
  const applied = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.rollResult.criticalType, "", "Fall after Edge Individual uses the current dice, not stale explosion data");
  assert.deepEqual(applied.rollResult.additionalDice, []);
  assert.equal(edge.getEdgeExplodeFlag(message).status, "superseded");
}

{
  const edgeActor = createActor({ uses: 2 });
  const message = await createSkillMessage(edgeActor, {
    dice: [6, 6], accuracy: 1,
    critical: { dice: [3], mos: 0.75, label: "Critical Success" }
  });
  globalThis.Roll = class {
    async evaluate() {
      this.dice = [{ results: [{ result: 4 }] }];
      this.total = 4;
      return this;
    }
  };
  const exploded = await edge.applyEdgeExplodeRoll({ messageId: message.id, spenderActorId: edgeActor.id, requesterUserId: user.id });
  assert.equal(exploded.ok, true, exploded.error);
  const applied = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.rollResult.accuracy, 5, "Fall after Edge Explode adds to the rerolled card's Accuracy");
  assert.deepEqual(applied.rollResult.additionalDice, [4], "Fall keeps the Edge Explode dice already resolved");
  assert.equal(edge.getEdgeChainFlag(message).fallAccuracyApplied, true);
}

{
  const forcedActor = createActor({ uses: 3, stress: 3 });
  const forcedPassRecord = {
    id: "force-pass-stress",
    actorId: forcedActor.id,
    actorUuid: forcedActor.uuid,
    actorName: forcedActor.name,
    label: "Skill Force Pass Stress",
    before: { "system.stress": 5 },
    after: { "system.stress": 3 }
  };
  const forcedMessage = await createSkillMessage(forcedActor, { postRollRecords: [forcedPassRecord] });
  await forcedMessage.setFlag("peasant-core", "rollUndo", { status: "available", records: [forcedPassRecord] });
  await forcedMessage.setFlag("peasant-core", "stressRoll", { status: "available", kind: "roll" });

  includeForcePassNote = true;
  const applied = await edge.applyFallBlessingAccuracy({ messageId: forcedMessage.id, usesSpent: 1, requesterUserId: user.id });
  includeForcePassNote = false;
  assert.equal(applied.ok, true, applied.error);
  assert.equal(forcedActor.system.stress, 5, "A now-unneeded Forced Pass restores its Stress");
  assert.equal(forcedMessage.getFlag("peasant-core", "stressRoll"), undefined, "A successful Fall result retires the old Stress action");
  assert.equal(currentRollDom.details.forcePassNote.removed, true, "The stale Forced Pass note is removed from the updated card");
  assert.equal(forcedMessage.getFlag("peasant-core", "edgeChain").postRollRecords.length, 0);
  assert.equal(forcedMessage.getFlag("peasant-core", "rollUndo").records.length, 1, "Only the Fall-use record remains undoable");

  globalThis.ui = { notifications: { info() {}, warn(message) { assert.fail(message); } } };
  const { undoRollChatMessageEffects } = await import("../module/applications/chat-undo.mjs");
  assert.equal(await undoRollChatMessageEffects(forcedMessage), true);
  assert.equal(forcedActor.system.fallBlessingUses.value, 3, "Undo restores every selected Fall use");
  assert.equal(forcedActor.system.stress, 5, "Undo does not reapply the removed Forced Pass spend");
  assert.equal(await undoRollChatMessageEffects(forcedMessage), false, "The Fall spend can only be undone once");
}

const { registerPeasantCombatApi } = await import("../module/applications/combat/api.mjs");
registerPeasantCombatApi();
assert.equal(typeof game.peasantCore.applyFallBlessingAccuracy, "function", "The public combat API registers Fall Accuracy application");
assert.equal(typeof game.peasantCore.fallBlessingAccuracyFromMessage, "function", "The public combat API registers the Fall chat action");

const repairFailures = [];
async function regression(name, run, { expectedErrors = [] } = {}) {
  const previousApi = { ...game.peasantCore };
  const previousUser = game.user;
  const previousUsers = game.users;
  const previousRoll = globalThis.Roll;
  const previousSync = globalThis.fromUuidSync;
  const previousError = console.error;
  const diagnostics = [];
  console.error = (...args) => { diagnostics.push(args.map(value => value instanceof Error ? value.message : String(value))); };
  try {
    await run();
    assert.deepEqual(diagnostics, expectedErrors, "Only explicitly expected error diagnostics are allowed");
  }
  catch (error) { repairFailures.push(`${name}: ${error.message}`); }
  finally {
    game.peasantCore = previousApi;
    game.user = previousUser;
    game.users = previousUsers;
    globalThis.Roll = previousRoll;
    globalThis.fromUuidSync = previousSync;
    console.error = previousError;
  }
}

function actorRef(actor) { return { actorId: actor.id, actorUuid: actor.uuid }; }
async function combatMessage(attacker, target, { stage = "attack", isHealRoll = false, dice = [3, 3] } = {}) {
  return createSkillMessage(attacker, {
    kind: "attack", dice,
    rerun: { type: "notableCombat", ...actorRef(attacker), accuracyAdj: 0 },
    checkpoint: {
      version: 2, type: "notableCombatPostRoll", stage,
      actor: actorRef(attacker), defenseTargetRef: actorRef(target), isHealRoll,
      attackRollResult: { accuracy: 0, initialDice: [4, 4], isSuccess: true },
      targets: [{
        targetRef: actorRef(target), locationRoll: { roll: 7, location: "Torso", isResolved: true },
        defensePromptResult: {
          handled: true, selection: "defense", selectedCombatId: "guard", selectedUsageId: "parry",
          selectedDefense: { dodge: true },
          defenseRoll: { rolled: true, actorId: target.id, rollResult: { accuracy: 0, initialDice: [3, 3] } }
        }
      }]
    }
  });
}

await regression("clicked defender owns Fall and later attack Edge retains its paid defense", async () => {
  const attacker = createActor({ type: "winter", uses: 2 });
  const defender = createActor({ uses: 1 });
  const owner = { id: "defender-owner", isGM: false };
  const users = [owner, user]; users.get = id => users.find(candidate => candidate.id === id);
  game.users = users;
  attacker.canUserModify = () => false;
  const defense = await combatMessage(attacker, defender, { stage: "defense" });
  const attack = await combatMessage(attacker, defender);
  const attackChain = edge.getEdgeChainFlag(attack);
  await attack.setFlag("peasant-core", "edgeChain", { ...attackChain, chainId: edge.getEdgeChainFlag(defense).chainId });
  await attack.setFlag("peasant-core", "edgeIndividualDie", {
    ...edge.getEdgeIndividualDieFlag(attack), chainId: edge.getEdgeChainFlag(defense).chainId
  });
  game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: false });
  await defense.setFlag("peasant-core", "edgeIndividualDie", { ...edge.getEdgeIndividualDieFlag(defense), label: "Guard" });
  game.user = owner;
  assert.deepEqual(menuFor(defense), ["Blessing of Fall"], "Defender's owner can act despite not owning the Winter attacker");
  game.user = user;
  const paid = await edge.applyFallBlessingAccuracy({ messageId: defense.id, usesSpent: 1, requesterUserId: owner.id });
  assert.equal(paid.ok, true, paid.error);
  assert.match(messages.get(paid.summaryMessageId).content, /Blessing of Fall On Guard/);
  assert.equal(defender.system.fallBlessingUses.value, 0);
  assert.equal(attacker.system.fallBlessingUses.value, 2);
  assert.equal(edge.getEdgeChainFlag(defense).rerun.accuracyAdj, 0, "Parent attacker rerun receives no defense Accuracy");
  assert.equal(edge.getEdgeIndividualDieFlag(attack).accuracy, 0);
  globalThis.Roll = class { async evaluate() { this.dice = [{ results: [{ result: 4 }] }]; this.total = 4; return this; } };
  game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: true });
  game.peasantCore.replayNotableCombatPostRollEffects = async ({ checkpoint, rollResult }) => {
    assert.equal(checkpoint.actor.actorUuid, attacker.uuid);
    assert.equal(rollResult.accuracy, 0);
    assert.equal(checkpoint.targets[0].defensePromptResult.defenseRoll.rollResult.accuracy, 4,
      "Attack Edge replay retains the already-paid defender Accuracy");
    assert.equal(checkpoint.targets[0].defensePromptResult.selectedUsageId, "parry");
    return { ok: true, postRollRecords: [], messageIds: [] };
  };
  const edged = await edge.applyEdgeIndividualDieRoll({ messageId: attack.id, dieIndex: 0, spenderActorId: attacker.id, requesterUserId: user.id });
  assert.equal(edged.ok, true, edged.error);
  assert.equal(defender.system.fallBlessingUses.value, 0);
});

await regression("attacker Fall cannot pay for a Winter defender", async () => {
  const attacker = createActor({ uses: 1 });
  const defender = createActor({ type: "winter", uses: 1 });
  const message = await combatMessage(attacker, defender, { stage: "defense" });
  assert.deepEqual(menuFor(message), []);
  assert.equal((await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id })).ok, false);
  assert.equal(attacker.system.fallBlessingUses.value, 1);
});

await regression("GM validation resolves synthetic defender UUID before base actor ID", async () => {
  const attacker = createActor({ type: "winter" });
  const base = createActor({ type: "winter", uses: 0 });
  const synthetic = createActor({ uses: 1 });
  actors.delete(synthetic.id);
  synthetic.id = base.id;
  synthetic.uuid = "Scene.fall-scene.Token.fall-token.Actor.synthetic";
  synthetic.documentName = "Actor";
  const originalFromUuid = globalThis.fromUuid;
  globalThis.fromUuid = async uuid => uuid === synthetic.uuid ? synthetic : originalFromUuid(uuid);
  globalThis.fromUuidSync = uuid => uuid === synthetic.uuid ? synthetic : [...actors.values()].find(actor => actor.uuid === uuid);
  try {
    const message = await combatMessage(attacker, synthetic, { stage: "defense" });
    const player = { id: "synthetic-player", isGM: false };
    const gm = { ...user, active: true };
    const users = [player, gm]; users.get = id => users.find(candidate => candidate.id === id);
    game.users = users; game.user = gm;
    const responses = [];
    game.socket.emit = (_namespace, payload) => responses.push(payload);
    game.peasantCore.applyFallBlessingAccuracy = edge.applyFallBlessingAccuracy;
    game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: false });
    await fallSocketHandler({ type: "requestEdgeLocationRoll", requestId: "synthetic-fall", edgeRollMode: "fallBlessing",
      messageId: message.id, ...actorRef(synthetic), usesSpent: 1, requesterUserId: player.id, userId: player.id });
    assert.equal(responses.at(-1).ok, true, responses.at(-1).error);
    assert.equal(synthetic.system.fallBlessingUses.value, 0);
    assert.equal(base.system.fallBlessingUses.value, 0);
  } finally { globalThis.fromUuid = originalFromUuid; }
});

await regression("Fall healing replay keeps the resolved one despite queued six", async () => {
  const actor = createActor({ uses: 1 });
  const target = createActor();
  const message = await combatMessage(actor, target, { isHealRoll: true, dice: [3, 4] });
  const value = createMessage(); messages.set(value.id, value); messages.contents.push(value);
  const rollKey = edge.createEdgeIndividualValueRollKey("heal", { targetRef: actorRef(target) });
  await value.setFlag("peasant-core", "edgeChain", edge.getEdgeChainFlag(message));
  await value.setFlag("peasant-core", "edgeIndividualDie", {
    version: 1, status: "current", chainId: edge.getEdgeChainFlag(message).chainId,
    kind: "heal", diceFaces: 6, dice: [1], rollKey
  });
  const damage = createMessage(); messages.set(damage.id, damage); messages.contents.push(damage);
  await damage.setFlag("peasant-core", "edgeChain", edge.getEdgeChainFlag(message));
  await damage.setFlag("peasant-core", "edgeIndividualDie", {
    version: 1, status: "current", chainId: edge.getEdgeChainFlag(message).chainId,
    kind: "damage", diceFaces: 6, dice: [2, 5], rollKey: "damage::other-target:"
  });
  const { rollAutomatedCombatHeal } = await import("../module/applications/combat/automated-heal-rolls.mjs");
  let healed = null;
  globalThis.Roll = class { async evaluate() { this.dice = [{ results: [{ result: 6 }] }]; this.total = 6; return this; } };
  game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: true });
  game.peasantCore.replayNotableCombatPostRollEffects = async ({ checkpoint, rollResult, edgeIndividualDieReplay }) => {
    assert.equal(rollResult.resultText, "Success");
    assert.deepEqual(edge.getEdgeIndividualDiceOverride(edgeIndividualDieReplay, "damage::other-target:"), [2, 5]);
    assert.deepEqual(checkpoint.targets[0].targetRef, actorRef(target));
    assert.deepEqual(checkpoint.targets[0].locationRoll, { roll: 7, location: "Torso", isResolved: true });
    healed = await rollAutomatedCombatHeal(actor, { heal: { diceCount: 1, diceValue: 6 } }, {
      diceOverride: edge.getEdgeIndividualDiceOverride(edgeIndividualDieReplay, rollKey)
    });
    return { ok: true, postRollRecords: [], messageIds: [healed.chatMessage.id] };
  };
  const result = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(healed.allDice, [1]);
  assert.equal(healed.total, 1);
});

await regression("setup failure restores all processing flags and content", async () => {
  const actor = createActor({ uses: 1 });
  const message = await createSkillMessage(actor);
  const originalFlags = ["edgeChain", "edgeIndividualDie", "edgeExplode", "rollUndo", "stressRoll"].map(key => [key, clone(message.getFlag("peasant-core", key))]);
  const originalContent = message.content;
  const originalSet = message.setFlag;
  let rejected = false;
  message.setFlag = async (system, key, value) => {
    if (!rejected && key === "edgeIndividualDie" && value.processing) { rejected = true; throw new Error("setup flag rejected"); }
    return originalSet(system, key, value);
  };
  const result = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(result.ok, false);
  for (const [key, flag] of originalFlags) assert.deepEqual(message.getFlag("peasant-core", key), flag, `Restore ${key}`);
  assert.equal(message.content, originalContent);
  assert.equal(actor.system.fallBlessingUses.value, 1);
}, { expectedErrors: [["Peasant Core | Blessing of Fall Accuracy failed", "setup flag rejected"]] });

await regression("distinct messages serialize their shared final Fall use", async () => {
  const actor = createActor({ uses: 1 });
  const first = await createSkillMessage(actor); const second = await createSkillMessage(actor);
  const results = await Promise.all([first, second].map(message => edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id })));
  assert.equal(results.filter(result => result.ok).length, 1, "Only one shared-use transaction succeeds");
  assert.equal([first, second].filter(message => edge.getEdgeIndividualDieFlag(message).accuracy === 4).length, 1);
  assert.equal(actor.system.fallBlessingUses.value, 0);
});

await regression("failed replay refunds before queued action validates", async () => {
  const actor = createActor({ uses: 1 }); const target = createActor();
  const first = await combatMessage(actor, target); const second = await createSkillMessage(actor);
  let releaseReplay; let replayStarted;
  const started = new Promise(resolve => { replayStarted = resolve; });
  const release = new Promise(resolve => { releaseReplay = resolve; });
  game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: true });
  game.peasantCore.replayNotableCombatPostRollEffects = async () => { replayStarted(); await release; return { ok: false, error: "first replay rejected" }; };
  const pending = edge.applyFallBlessingAccuracy({ messageId: first.id, usesSpent: 1, requesterUserId: user.id });
  await started;
  const queued = edge.applyFallBlessingAccuracy({ messageId: second.id, usesSpent: 1, requesterUserId: user.id });
  releaseReplay();
  assert.equal((await pending).ok, false);
  assert.equal((await queued).ok, true, "Queued validation observes the completed refund");
  assert.equal(actor.system.fallBlessingUses.value, 0);
}, { expectedErrors: [["Peasant Core | Blessing of Fall Accuracy failed", "first replay rejected"]] });

await regression("direct owner execution uses the authoritative GM route", async () => {
  const actor = createActor({ uses: 1 }); const message = await createSkillMessage(actor);
  const player = { id: "direct-owner", isGM: false };
  const gm = { ...user, active: true }; const users = [player, gm]; users.get = id => users.find(candidate => candidate.id === id);
  game.user = player; game.users = users;
  const requests = [];
  game.peasantCore.requestEdgeLocationRollFromGM = async payload => { requests.push(payload); return { ok: true }; };
  const result = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: player.id });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].actorUuid, actor.uuid);
  assert.equal(actor.system.fallBlessingUses.value, 1, "Direct client does not spend before GM execution");
  const secondaryGM = { id: "secondary-gm", isGM: true, active: true };
  users.push(secondaryGM); game.user = secondaryGM;
  const second = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: secondaryGM.id });
  assert.equal(second.ok, true);
  assert.equal(requests.length, 2, "A second GM also routes to the same authoritative GM");
  assert.equal(actor.system.fallBlessingUses.value, 1);
});

await regression("Edge Entire retains defensive Fall only for its defender entry and usage", async () => {
  const attacker = createActor({ type: "winter", uses: 2 });
  const defender = createActor({ uses: 1 });
  attacker.system.notableCombats = [{ id: "attack", name: "Attack", tohit: 7, accuracy: 0 }];
  defender.system.notableCombats = [{ id: "guard", name: "Guard", tohit: 7, accuracy: 0 }];
  const message = await combatMessage(attacker, defender, { stage: "defense" });
  await message.setFlag("peasant-core", "edgeChain", {
    ...edge.getEdgeChainFlag(message), rerun: {
      ...edge.getEdgeChainFlag(message).rerun, combatIndex: 0, combatId: "attack", combatName: "Attack", promptForTargets: false
    }
  });
  game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: false });
  const paid = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(paid.ok, true, paid.error);
  const workflow = await import("../module/applications/combat/notable-combat-workflow.mjs");
  globalThis.Roll = class { async evaluate() { this.dice = [{ results: [{ result: 4 }, { result: 4 }] }]; this.total = 8; return this; } };
  game.peasantCore.startNotableCombatRoll = async args => {
    assert.equal(args.actor, attacker);
    assert.equal(args.accuracyAdj, 0);
    const otherDefender = createActor(); otherDefender.system.notableCombats = clone(defender.system.notableCombats);
    for (const { actor, entryId, usageId, want } of [
      { actor: defender, entryId: "guard", usageId: "parry", want: 4 },
      { actor: otherDefender, entryId: "guard", usageId: "parry", want: 0 },
      { actor: defender, entryId: "different-guard", usageId: "parry", want: 0 },
      { actor: defender, entryId: "guard", usageId: "different-usage", want: 0 }
    ]) {
      const defense = await workflow.performNotableCombatRoll({
        actor, combatIndex: 0, promptForTargets: false, cardClass: "pc-defense-roll-card",
        edgeChainContext: args.edgeChainContext,
        usageContext: { version: 1, ref: { collection: "notableCombats", entryId, usageId },
          data: defender.system.notableCombats[0], modifiers: {} }
      });
      assert.equal(defense.rolled, true, defense.error?.message);
      assert.equal(defense.rollResult.accuracy || 0, want, `${actor.name}/${entryId}/${usageId} receives only its paid modifier`);
    }
    const attack = await workflow.performNotableCombatRoll({ ...args, promptForTargets: false });
    assert.equal(attack.rollResult.accuracy || 0, 0);
    return attack;
  };
  const result = await edge.applyEdgeChainRoll({ messageId: message.id, spenderActorId: attacker.id, requesterUserId: user.id });
  assert.equal(result.ok, true, result.error);
  assert.equal(defender.system.fallBlessingUses.value, 0);
  assert.equal(attacker.system.fallBlessingUses.value, 2);
});

await regression("remote queued Fall validates affordability after failed replay refund", async () => {
  const actor = createActor({ uses: 1 }); const target = createActor();
  const first = await combatMessage(actor, target); const second = await createSkillMessage(actor);
  const player = { id: "queued-player", isGM: false }; const gm = { ...user, active: true };
  const users = [player, gm]; users.get = id => users.find(candidate => candidate.id === id);
  game.users = users; game.user = gm;
  let releaseReplay; let replayStarted;
  const started = new Promise(resolve => { replayStarted = resolve; });
  const release = new Promise(resolve => { releaseReplay = resolve; });
  const responses = [];
  game.socket.emit = (_namespace, payload) => responses.push(payload);
  game.peasantCore.applyFallBlessingAccuracy = edge.applyFallBlessingAccuracy;
  game.peasantCore.planNotableCombatEdgeExplodeReplay = async () => ({ ok: true, replayRequired: true });
  game.peasantCore.replayNotableCombatPostRollEffects = async () => { replayStarted(); await release; return { ok: false, error: "first remote replay rejected" }; };
  const payload = { type: "requestEdgeLocationRoll", edgeRollMode: "fallBlessing", ...actorRef(actor), usesSpent: 1, requesterUserId: player.id, userId: player.id };
  const pending = fallSocketHandler({ ...payload, messageId: first.id, requestId: "first-queued-remote" });
  await started;
  const queued = fallSocketHandler({ ...payload, messageId: second.id, requestId: "second-queued-remote" });
  releaseReplay();
  await Promise.all([pending, queued]);
  assert.equal(responses.find(response => response.requestId === "first-queued-remote").ok, false);
  assert.equal(responses.find(response => response.requestId === "second-queued-remote").ok, true,
    "GM socket validation waits for rollback before checking remaining shared uses");
  assert.equal(actor.system.fallBlessingUses.value, 0);
}, { expectedErrors: [["Peasant Core | Blessing of Fall Accuracy failed", "first remote replay rejected"]] });

const replayWorkflow = await import("../module/applications/combat/notable-combat-workflow.mjs");
const replayBase = { toHit: 7, accuracy: 0, initialDice: [5, 6], initialTotal: 11, total: 11,
  baseMoS: 1, accuracyMoS: 0, criticalMoS: 0, totalMoS: 1, isSuccess: true, resultText: "Success" };
async function defendedReplayMessage(attacker, target) {
  attacker.system.notableCombats = [{ name: "Sword", damage: null }];
  const message = await createSkillMessage(attacker, {
    kind: "attack", dice: [5, 6], rerun: { type: "notableCombat", ...actorRef(attacker), combatIndex: 0 },
    checkpoint: { version: 2, type: "notableCombatPostRoll", stage: "attack", actor: actorRef(attacker),
      combatIndex: 0, targetingType: "Melee", attackRollResult: clone(replayBase), multiTarget: false,
      targets: [{ targetRef: actorRef(target), defensePromptResult: {
        selection: "defense", activeDefense: true, appliedAccuracyPenalty: 2, appliedToHitPenalty: 0
      } }]
    }
  });
  const flag = edge.getEdgeIndividualDieFlag(message);
  await message.setFlag("peasant-core", "edgeIndividualDie", {
    ...flag, checkpoint: { ...flag.checkpoint, attackMessageId: message.id, chainId: flag.chainId }
  });
  game.peasantCore.planNotableCombatEdgeExplodeReplay = replayWorkflow.planNotableCombatEdgeExplodeReplay;
  game.peasantCore.replayNotableCombatPostRollEffects = replayWorkflow.replayNotableCombatPostRollEffects;
  return message;
}

await regression("same-route Fall preserves defense and its bonus in subsequent replay", async () => {
  const attacker = createActor(); const target = createActor();
  const message = await defendedReplayMessage(attacker, target);
  const paid = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(paid.ok, true, paid.error);
  assert.equal(paid.replayPlan.replayRequired, false);
  assert.equal(currentRollDom.accuracyLine.textContent, "Accuracy: 2");
  assert.equal(currentRollDom.mos.textContent, "1.5");
  const saved = edge.getEdgeIndividualDieFlag(message).checkpoint;
  assert.equal(saved.attackRollResult.accuracy, 4);
  const later = await replayWorkflow.replayNotableCombatPostRollEffects({ checkpoint: { ...saved, stage: "value" } });
  assert.equal(later.ok, true, later.error);
  assert.equal(later.rollOutcome.rollResult.accuracy, 2);
  assert.equal(later.rollOutcome.rollResult.totalMoS, 1.5);
  assert.equal(attacker.system.fallBlessingUses.value, 2);
});

await regression("same-route defensive Fall refreshes the attack card and checkpoints", async () => {
  const attacker = createActor(); const defender = createActor();
  const attack = await defendedReplayMessage(attacker, defender);
  const attackFlag = edge.getEdgeIndividualDieFlag(attack);
  const checkpoint = clone(attackFlag.checkpoint);
  checkpoint.attackRollResult = { ...replayBase, baseMoS: 3, totalMoS: 3 };
  const prompt = checkpoint.targets[0].defensePromptResult;
  prompt.selectedDefense = { effectiveness: { melee: { mosPer: 0.25, accuracyPenalty: 1 } } };
  prompt.defenseRoll = { rolled: true, rollResult: { ...replayBase, initialDice: [4, 5], initialTotal: 9,
    total: 9, baseMoS: 0.5, totalMoS: 0.5 } };
  await attack.setFlag("peasant-core", "edgeIndividualDie", { ...attackFlag, checkpoint });
  const defense = await createSkillMessage(defender, { kind: "defense", dice: [4, 5],
    rerun: edge.getEdgeChainFlag(attack).rerun,
    checkpoint: { ...clone(checkpoint), stage: "defense", defenseTargetRef: actorRef(defender) }
  });
  for (const key of ["edgeChain", "edgeIndividualDie"]) await defense.setFlag("peasant-core", key, {
    ...defense.getFlag("peasant-core", key), chainId: attackFlag.chainId
  });
  const beforeUpdates = attack.updates.length;
  const paid = await edge.applyFallBlessingAccuracy({ messageId: defense.id, usesSpent: 1, requesterUserId: user.id });
  assert.equal(paid.ok, true, paid.error);
  assert.equal(paid.replayPlan.replayRequired, false);
  assert.ok(attack.updates.length > beforeUpdates, "The related attack card is refreshed");
  assert.equal(currentRollDom.accuracyLine.textContent, "Accuracy: -6");
  assert.equal(currentRollDom.mos.textContent, "1.5");
  assert.equal(edge.getEdgeIndividualDieFlag(attack).checkpoint.targets[0].defensePromptResult.appliedAccuracyPenalty, 6);
});

await regression("failed Fall healing replay deletes partial heal cards", async () => {
  const healer = createActor({ uses: 1 });
  const first = createActor(); const second = createActor();
  const message = await defendedReplayMessage(healer, first);
  healer.system.notableCombats = [{ name: "Heal", heal: { diceCount: 1, diceValue: 6, type: "temporary" } }];
  for (const target of [first, second]) {
    target.effects = [];
    target.applyPeasantHeal = async () => {
      await target.updatePeasantStateData({ "system.stress": target.system.stress + 1 });
      return { ok: true, effectiveHealingPower: 0 };
    };
  }
  const flag = edge.getEdgeIndividualDieFlag(message);
  await message.setFlag("peasant-core", "edgeIndividualDie", { ...flag, dice: [3, 3], checkpoint: {
    ...flag.checkpoint, isHealRoll: true, multiTarget: true,
    attackRollResult: { ...replayBase, initialDice: [3, 3], initialTotal: 6, total: 6, baseMoS: -0.25,
      totalMoS: -0.25, isSuccess: false, resultText: "Failure" },
    targets: [first, second].map(target => ({ targetRef: actorRef(target) }))
  } });
  game.users = [{ ...user, active: true }]; game.users.get = id => id === user.id ? user : null;
  CONST.DOCUMENT_OWNERSHIP_LEVELS = { OWNER: 3 };
  globalThis.Roll = class { async evaluate() { this.dice = [{ results: [{ result: 4 }] }]; this.total = 4; return this; } };
  const beforeMessages = new Set(messages.keys());
  const originalCreate = ChatMessage.create;
  let healCards = 0;
  ChatMessage.create = async data => {
    if (data.content.includes("pc-heal-roll-card") && ++healCards === 2) throw new Error("second heal card rejected");
    return originalCreate(data);
  };
  let paid;
  try { paid = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id }); }
  finally { ChatMessage.create = originalCreate; }
  assert.equal(paid.ok, false);
  assert.match(paid.error, /second heal card rejected/);
  assert.equal(healer.system.fallBlessingUses.value, 1);
  assert.equal(first.system.stress, 0); assert.equal(second.system.stress, 0);
  assert.deepEqual([...messages.keys()].filter(id => !beforeMessages.has(id)), [], "No partial heal card remains");
  healCards = 0;
  ChatMessage.create = async data => {
    const created = await originalCreate(data);
    if (data.content.includes("pc-heal-roll-card") && ++healCards === 2) {
      const originalSet = created.setFlag;
      created.setFlag = async (scope, key, value) => {
        if (key === "rollUndo") throw new Error("second heal metadata rejected");
        return originalSet(scope, key, value);
      };
    }
    return created;
  };
  let retry;
  try { retry = await edge.applyFallBlessingAccuracy({ messageId: message.id, usesSpent: 1, requesterUserId: user.id }); }
  finally { ChatMessage.create = originalCreate; }
  assert.equal(retry.ok, false);
  assert.match(retry.error, /second heal metadata rejected/);
  assert.equal(healer.system.fallBlessingUses.value, 1);
  assert.equal(first.system.stress, 0); assert.equal(second.system.stress, 0);
  assert.deepEqual([...messages.keys()].filter(id => !beforeMessages.has(id)), [], "Cards created before failed undo metadata are removed too");
}, { expectedErrors: [
  ["Peasant Core | Blessing of Fall Accuracy failed", "second heal card rejected"],
  ["Peasant Core | Blessing of Fall Accuracy failed", "second heal metadata rejected"]
] });

for (const failure of repairFailures) console.error(`FAIL: ${failure}`);
assert.deepEqual(repairFailures, [], "Task 1 Fall regressions");
console.log("E5 Fall blessing roll tests passed (13 audit repair regressions)");
