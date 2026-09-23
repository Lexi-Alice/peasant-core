import assert from "node:assert/strict";

globalThis.game = { combat: null, combats: [], time: { worldTime: 50 } };
globalThis.foundry = {
  applications: {
    api: {
      DialogV2: { confirm: async () => false }
    }
  }
};

const {
  buildManifestSpellApplicationPayload,
  buildManifestSpellCastPreflight,
  renderManifestSpellRecipientRows
} = await import("../module/applications/combat/manifest-spell-effects.mjs");
const {
  getManualCombatTagRollData,
  rollManualCombatTag
} = await import("../module/applications/combat/manual-combat-tag-rolls.mjs");
const {
  performNotableCombatRoll,
  planNotableCombatEdgeExplodeReplay,
  replayNotableCombatPostRollEffects
} = await import("../module/applications/combat/notable-combat-workflow.mjs");
const {
  MANIFEST_SPELL_EFFECT_CHANGE_KEYS,
  getManifestSpellEffectChanges,
  getManifestSpellEffectState
} = await import("../module/data/active-effect/spell-effect-change-keys.mjs");

function actor(id, effects = []) {
  return { id, uuid: `Actor.${id}`, name: id, img: `${id}.png`, effects };
}

function effect(id, category, manifestType, name = id) {
  return {
    id,
    type: "spellEffect",
    name,
    disabled: false,
    duration: { expired: false },
    changes: [
      { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.buffCategory, mode: 0, value: category, priority: 20 },
      { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.manifestType, mode: 0, value: manifestType, priority: 20 }
    ],
    system: { encounterId: "" }
  };
}

function setEffectManifestType(effect, manifestType) {
  getManifestSpellEffectChanges(effect)
    .find((change) => change.key === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.manifestType).value = manifestType;
}

const caster = actor("caster");
const selfPreflight = buildManifestSpellCastPreflight({ caster, targets: [], rollType: "manifestDome" });
assert.equal(selfPreflight.ok, true);
assert.equal(selfPreflight.recipients.length, 1);
assert.equal(selfPreflight.recipients[0].actor.uuid, "Actor.caster");
assert.equal(selfPreflight.recipients[0].slotAction, "create");
assert.equal(selfPreflight.recipients[0].pending, true);

const first = actor("first");
const second = actor("second", [effect("resistance", "armor", "resistance", "Manifest Resistance")]);
const targetPreflight = buildManifestSpellCastPreflight({
  caster,
  targets: [
    { actor: first, tokenId: "first-token", targetName: "First Target" },
    { actor: first, tokenId: "duplicate-token", targetName: "Duplicate" },
    { actor: second, tokenId: "second-token", targetName: "Second Target" }
  ],
  rollType: "manifestResistance"
});
assert.deepEqual(targetPreflight.recipients.map((entry) => entry.actor.uuid), ["Actor.first", "Actor.second"]);
assert.deepEqual(targetPreflight.recipients.map((entry) => entry.slotAction), ["create", "recast"]);
assert.deepEqual(targetPreflight.replacements, []);

const occupied = actor("occupied", [effect("armor-buff", "armor", "", "Stone Skin")]);
const replacementPreflight = buildManifestSpellCastPreflight({
  caster,
  targets: [{ actor: occupied, tokenId: "occupied-token", targetName: "Occupied" }],
  rollType: "manifestResistance"
});
assert.equal(replacementPreflight.recipients[0].slotAction, "replace");
assert.deepEqual(replacementPreflight.replacements, [{
  actorName: "occupied",
  occupantId: "armor-buff",
  occupantName: "Stone Skin",
  category: "armor"
}]);

const payload = buildManifestSpellApplicationPayload({
  recipient: {
    actor: occupied,
    actorId: occupied.id,
    tokenDocument: {
      id: "token",
      uuid: "Scene.scene.Token.token",
      parent: { id: "scene" }
    },
    targetName: "Occupied"
  },
  definition: replacementPreflight.definition,
  caster,
  rollTotal: 9,
  maximized: 12,
  haltValues: [2, 1, 3, 0],
  expectedOccupantId: "armor-buff",
  replacementApproved: true,
  img: "spell.png"
});
assert.deepEqual(payload, {
  targetSceneId: "scene",
  targetTokenId: "token",
  targetTokenUuid: "Scene.scene.Token.token",
  targetActorId: "occupied",
  targetActorUuid: "Actor.occupied",
  targetName: "Occupied",
  manifestType: "resistance",
  rollTotal: 9,
  maximized: 12,
  haltValues: [2, 1, 3, 0],
  casterUuid: "Actor.caster",
  img: "spell.png",
  expectedOccupantId: "armor-buff",
  replacementApproved: true
});

const rows = renderManifestSpellRecipientRows([
  { targetName: "Dane", applied: false, reason: "Socket response unavailable" },
  { targetName: "Unknown", handled: true },
  { targetName: "Alice <Mage>", applied: true, action: "created", gain: 8, value: 8, max: 20, pending: true, durationLabel: "3 Rounds" },
  { targetName: "Bob", applied: true, action: "recast", gain: 4, value: 10, max: 12, pending: false, durationLabel: "Duress" },
  { targetName: "Cora", applied: true, action: "replaced", gain: 5, value: 5, max: 15, pending: false, durationLabel: "3 Rounds" },
  { targetName: "Zero", applied: false, reason: "Roll total was not positive" }
]);
assert.equal(rows, "<div>Duration: 3 Rounds</div>");
assert.equal(renderManifestSpellRecipientRows([
  { targetName: "Dane", applied: false, reason: "Socket response unavailable" },
  { targetName: "Unknown", handled: true },
  { targetName: "Zero", applied: false, reason: "Roll total was not positive" }
]), "");

assert.equal(buildManifestSpellCastPreflight({ caster, targets: [], rollType: "manifest" }).ok, false);

const rollData = getManualCombatTagRollData(
  { system: { combatMods: { diceRate: 0, flatDamage: 0 } } },
  { manifestDome: { diceCount: 2, diceValue: 8, diceBonus: 0, flat: 1, duration: 5 } },
  "manifestDome"
);
assert.deepEqual(rollData, {
  diceCount: 2,
  diceValue: 8,
  flat: 1,
  maximized: 17,
  duration: 5,
  rollLabel: "Manifest Dome",
  typeLabel: ""
});

const resistanceRollData = getManualCombatTagRollData(
  { system: { combatMods: { diceRate: 0, flatDamage: 0 } } },
  { manifestResistance: { diceCount: 2, diceValue: 8, diceBonus: 0, flat: 0, haltValues: [2, 1, 3, 0] } },
  "manifestResistance"
);
assert.deepEqual(resistanceRollData, {
  diceCount: 2,
  diceValue: 8,
  flat: 0,
  maximized: 16,
  haltValues: [2, 1, 3, 0],
  rollLabel: "Manifest Resistance",
  typeLabel: ""
});

const buffedDomeRollData = getManualCombatTagRollData(
  { system: { combatMods: { diceRate: 1, flatDamage: 4 } } },
  { manifestDome: { diceCount: 2, diceValue: 10, diceBonus: 0, flat: 0, duration: 3 } },
  "manifestDome"
);
assert.deepEqual(
  { diceCount: buffedDomeRollData.diceCount, diceValue: buffedDomeRollData.diceValue, flat: buffedDomeRollData.flat },
  { diceCount: 2, diceValue: 10, flat: 5 },
  "Temporary modifiers should still affect the casting roll"
);
assert.equal(buffedDomeRollData.maximized, 20, "Temporary modifiers must not increase the fixed Dome cap basis");

const buffedResistanceRollData = getManualCombatTagRollData(
  { system: { combatMods: { diceRate: 1, flatDamage: 4 } } },
  { manifestResistance: { diceCount: 2, diceValue: 8, diceBonus: 0, flat: 0 } },
  "manifestResistance"
);
assert.equal(buffedResistanceRollData.maximized, 16, "Temporary modifiers must not increase the fixed Resistance cap");

let rolled = false;
let chatted = false;
let mutated = false;
globalThis.Roll = class {
  constructor() { rolled = true; }
};
globalThis.ChatMessage = {
  getSpeaker: () => ({}),
  create: async () => { chatted = true; }
};
game.user = {
  id: "user",
  targets: [{
    actor: occupied,
    document: { id: "occupied-token", actor: occupied },
    name: "Occupied"
  }]
};
const cancellingCaster = {
  ...caster,
  system: {
    combatMods: { diceRate: 0, flatDamage: 0 },
    notableCombats: [{
      name: "Barrier Spell",
      manifestResistance: { diceCount: 2, diceValue: 8, diceBonus: 0, flat: 0 }
    }]
  },
  update: async () => { mutated = true; }
};
const cancelled = await rollManualCombatTag({
  actor: cancellingCaster,
  combatIndex: 0,
  rollType: "manifestResistance"
});
assert.deepEqual(cancelled, { cancelled: true });
assert.equal(rolled, false);
assert.equal(chatted, false);
assert.equal(mutated, false);

const rollFormulas = [];
let attackDice = [4, 4];
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
    rollFormulas.push(formula);
  }

  async evaluate() {
    const results = this.formula === "2d6"
      ? attackDice
      : (this.formula === "2d10" ? [4, 6] : (this.formula === "1d8" ? [5] : []));
    this.dice = [{ results: results.map((result) => ({ result })) }];
    this.total = results.reduce((sum, result) => sum + result, 0);
    return this;
  }
};

let messageIndex = 0;
const messages = new Map();
globalThis.ChatMessage = {
  applyMode: (data) => data,
  getSpeaker: ({ actor: speakerActor } = {}) => ({ actor: speakerActor?.id || null }),
  async create(data) {
    const flags = new Map();
    const message = {
      id: `message-${++messageIndex}`,
      content: data.content,
      async update(update) {
        if (update.content !== undefined) this.content = update.content;
        return this;
      },
      async setFlag(scope, key, value) {
        flags.set(`${scope}.${key}`, structuredClone(value));
        return value;
      },
      getFlag(scope, key) {
        return flags.get(`${scope}.${key}`);
      }
    };
    messages.set(message.id, message);
    return message;
  }
};

function workflowActor(id, notableCombats = []) {
  const workflowActorDocument = {
    id,
    uuid: `Actor.${id}`,
    name: id,
    img: `${id}.png`,
    effects: [],
    system: {
      _source: {},
      combatMods: { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 },
      notableCombats
    },
    canUserModify: () => true,
    getActiveTokens: () => [],
    async createEmbeddedDocuments(_type, sources, options = {}) {
      options.parent = workflowActorDocument;
      const firstEffectNumber = workflowActorDocument.effects.length + 1;
      const created = sources.map((source, index) => {
        const effectSource = structuredClone(source);
        const effectId = `${id}-effect-${firstEffectNumber + index}`;
        const effect = {
          ...effectSource,
          id: effectId,
          _id: effectId,
          parent: workflowActorDocument,
          toObject() {
            return structuredClone({ ...effectSource, _id: this.id });
          },
          async update(update) {
            Object.assign(this, structuredClone(update));
            return this;
          },
          async delete() {
            workflowActorDocument.effects = workflowActorDocument.effects.filter((entry) => entry !== this);
          }
        };
        return effect;
      });
      workflowActorDocument.effects.push(...created);
      return created;
    }
  };
  return workflowActorDocument;
}

const barrierCombat = {
  id: "barrier-combat",
  name: "Layered Barrier",
  img: "icons/svg/sword.svg",
  type: "signature",
  tohit: 5,
  accuracy: 0,
  usesCurrent: 2,
  usesMax: 2,
  damage: { diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" },
  heal: { diceCount: 1, diceValue: 4, diceBonus: 0, flat: 0, type: "greater" },
  manifestDome: { diceCount: 2, diceValue: 10, diceBonus: 0, flat: 0, duration: 5 },
  manifestResistance: { diceCount: 1, diceValue: 8, diceBonus: 0, flat: 0 }
};
const workflowCaster = workflowActor("workflow-caster", [barrierCombat]);
workflowCaster.consumePeasantEntryUses = async (ref, { usageId, pool, spendSignature } = {}) => {
  const entry = ref?.collection === "notableCombats"
    && usageId === "base"
    && pool === "primary"
    && spendSignature === true
    ? workflowCaster.system.notableCombats.find((candidate) => candidate.id === ref.entryId)
    : null;
  if (!entry) return { ok: false, changed: false, spent: [] };
  if (entry.usesCurrent <= 0) return { ok: true, changed: false, spent: [] };
  entry.usesCurrent -= 1;
  return { ok: true, changed: true, spent: ["primary"] };
};
const barrierUsageContext = {
  version: 1,
  ref: { collection: "notableCombats", entryId: barrierCombat.id, usageId: "base" },
  data: structuredClone(barrierCombat),
  modifiers: { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 },
  signaturePool: "primary",
  usageName: "Default",
  resolution: "targeted"
};
const workflowTarget = workflowActor("workflow-target");
const workflowSecondTarget = workflowActor("workflow-second-target");
const targetTokenDocument = {
  id: "target-token",
  uuid: "Scene.scene.Token.target-token",
  name: "Workflow Target",
  actor: workflowTarget,
  parent: { id: "scene" }
};
const targetToken = {
  id: targetTokenDocument.id,
  name: targetTokenDocument.name,
  actor: workflowTarget,
  document: targetTokenDocument
};
const secondTargetTokenDocument = {
  id: "second-target-token",
  uuid: "Scene.scene.Token.second-target-token",
  name: "Workflow Second Target",
  actor: workflowSecondTarget,
  parent: { id: "scene" }
};
const secondTargetToken = {
  id: secondTargetTokenDocument.id,
  name: secondTargetTokenDocument.name,
  actor: workflowSecondTarget,
  document: secondTargetTokenDocument
};
let locationWarnings = 0;
globalThis.CONST = {
  ACTIVE_EFFECT_MODES: { CUSTOM: 0, ADD: 2, OVERRIDE: 5 },
  ACTIVE_EFFECT_SHOW_ICON: { ALWAYS: 2 },
  CHAT_MESSAGE_STYLES: { OTHER: 0 },
  DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }
};
globalThis.CONFIG = { ActiveEffect: { documentClass: { DEFAULT_ICON: "icons/svg/aura.svg" } } };
globalThis.ActiveEffect = {
  implementation: {
    getEffectStart: () => ({ combat: null, round: null, turn: null, time: 50 })
  }
};
globalThis.canvas = { scene: null, tokens: { controlled: [] } };
globalThis.ui = {
  notifications: {
    info() {},
    warn(message) {
      if (/Location table not found/.test(message)) locationWarnings += 1;
    }
  }
};
foundry.utils = {
  deepClone: (value) => structuredClone(value),
  randomID: () => `random-${messageIndex + 1}`
};
game.user = { id: "user", isGM: true, targets: new Set([targetToken]) };
game.users = [game.user];
game.actors = new Map([
  [workflowCaster.id, workflowCaster],
  [workflowTarget.id, workflowTarget],
  [workflowSecondTarget.id, workflowSecondTarget]
]);
game.messages = messages;
game.settings = { get: () => "public" };

const barrierOutcome = await performNotableCombatRoll({
  actor: workflowCaster,
  combatIndex: 0,
  promptForTargets: true
});
assert.equal(barrierOutcome.incomingHitResolution, null);
assert.deepEqual(barrierOutcome.manifestRolls.map((entry) => entry.rollType), [
  "manifestDome",
  "manifestResistance"
]);
assert.deepEqual(rollFormulas, ["2d6", "2d10", "1d8"]);
assert.deepEqual(
  workflowTarget.effects.map((entry) => getManifestSpellEffectState(entry).manifestType),
  ["dome", "resistance"]
);
assert.deepEqual(
  workflowTarget.effects.map((entry) => entry.img),
  [workflowCaster.img, workflowCaster.img]
);
assert.equal(workflowTarget.effects[0].duration.value, null);
assert.equal(workflowTarget.effects[0].flags["peasant-core"].manifestDuration, 5);
assert.equal(locationWarnings, 0);
assert.equal(
  Array.from(messages.values()).some((message) => /<span[^>]*>Damage:<\/span>/.test(message.content)),
  false
);
const [domeRollCard, resistanceRollCard] = barrierOutcome.manifestRolls.map((entry) => entry.chatMessage.content);
assert.match(
  barrierOutcome.rollResult.chatMessage.content,
  /<img class="pc-chat-card-image" src="icons\/svg\/sword\.svg" alt="">[\s\S]*To-Hit:/
);
assert.doesNotMatch(domeRollCard, /pc-chat-card-image/);
assert.doesNotMatch(resistanceRollCard, /pc-chat-card-image/);
assert.match(
  domeRollCard.split("</fieldset>")[0],
  /<div>Dice: \[4, 6\] = 10<\/div>\s*<div>Duration: 5 Rounds<\/div>/
);
assert.equal(domeRollCard.split("</fieldset>")[1].trim(), "");
assert.match(
  resistanceRollCard.split("</fieldset>")[0],
  /<div>Dice: \[5\] = 5<\/div>\s*<div>Duration: Duress<\/div>/
);
assert.equal(resistanceRollCard.split("</fieldset>")[1].trim(), "");

barrierCombat.targetingType = "Normal Targeting";
barrierCombat.img = "barrier-custom.webp";
barrierUsageContext.data = structuredClone(barrierCombat);
game.user.active = true;
game.user.targets = new Set([targetToken, secondTargetToken]);
game.peasantCore = {
  requestDefensePromptForUser: async (_recipientId, payload) => ({
    appliedAccuracyPenalty: 0,
    appliedToHitPenalty: payload.targetTokenId === secondTargetToken.id ? 4 : 0
  })
};
attackDice = [4, 4];
rollFormulas.length = 0;
messages.clear();
const mixedTargetBarrierOutcome = await performNotableCombatRoll({
  actor: workflowCaster,
  combatIndex: 0,
  promptForTargets: true,
  usageContext: barrierUsageContext
});
assert.equal(mixedTargetBarrierOutcome.multiTarget, true);
assert.deepEqual(
  mixedTargetBarrierOutcome.targetRolls.map((entry) => entry.rollResult.isSuccess),
  [true, false]
);
assert.deepEqual(rollFormulas, ["2d6", "2d10", "1d8"]);
assert.deepEqual(
  workflowTarget.effects.map((entry) => getManifestSpellEffectState(entry).manifestType),
  ["dome", "resistance"]
);
assert.deepEqual(
  workflowTarget.effects.map((entry) => entry.img),
  [barrierCombat.img, barrierCombat.img]
);
assert.deepEqual(workflowSecondTarget.effects, []);
assert.equal(workflowCaster.system.notableCombats[0].usesCurrent, 1, "a multi-target usage commits once for the shared attack");

barrierCombat.targetingType = "";
game.user.targets = new Set();
delete game.peasantCore;
rollFormulas.length = 0;
messages.clear();
const selfBarrierOutcome = await performNotableCombatRoll({
  actor: workflowCaster,
  combatIndex: 0,
  promptForTargets: true
});
assert.equal(selfBarrierOutcome.rollResult.isSuccess, true);
assert.deepEqual(rollFormulas, ["2d6", "2d10", "1d8"]);
assert.deepEqual(
  workflowCaster.effects.map((entry) => getManifestSpellEffectState(entry).manifestType),
  ["dome", "resistance"]
);

game.user.targets = new Set([targetToken]);

const manifestCheckpoint = {
  version: 2,
  type: "notableCombatPostRoll",
  stage: "attack",
  actor: { actorId: workflowCaster.id, actorUuid: workflowCaster.uuid },
  combatIndex: 0,
  combatName: barrierCombat.name,
  targetingType: "",
  isHealRoll: false,
  manifestRollTypes: ["manifestDome", "manifestResistance"],
  attackRollResult: {
    toHit: 5,
    accuracy: 0,
    initialDice: [4, 4],
    additionalDice: [],
    initialTotal: 8,
    total: 8,
    baseMoS: 0.75,
    accuracyMoS: 0,
    criticalMoS: 0,
    totalMoS: 0.75,
    isSuccess: true,
    resultText: "Success"
  },
  multiTarget: false,
  targets: [{
    targetRef: {
      actorId: workflowTarget.id,
      actorUuid: workflowTarget.uuid,
      targetName: workflowTarget.name
    },
    targetLabel: workflowTarget.name,
    defensePromptResult: null
  }]
};
const failedAttackRoll = {
  toHit: 5,
  accuracy: 0,
  initialDice: [1, 2],
  additionalDice: [],
  initialTotal: 3,
  total: 3,
  baseMoS: -0.5,
  accuracyMoS: 0,
  criticalMoS: 0,
  totalMoS: -0.5,
  isSuccess: false,
  resultText: "Failure"
};
const manifestReplayPlan = await planNotableCombatEdgeExplodeReplay({
  checkpoint: manifestCheckpoint,
  rollResult: failedAttackRoll
});
assert.equal(manifestReplayPlan.oldSignature, "manifest:success");
assert.equal(manifestReplayPlan.newSignature, "manifest:failure");
assert.equal(manifestReplayPlan.replayRequired, true);

workflowTarget.effects[0].name = "Existing Aura";
setEffectManifestType(workflowTarget.effects[0], "");
workflowTarget.effects[1].name = "Existing Armor";
setEffectManifestType(workflowTarget.effects[1], "");
let replayReplacementConfirmCalls = 0;
foundry.applications.api.DialogV2.confirm = async () => {
  replayReplacementConfirmCalls += 1;
  return false;
};
rollFormulas.length = 0;
messages.clear();
const manifestReplay = await replayNotableCombatPostRollEffects({
  checkpoint: manifestCheckpoint,
  rollResult: {
    toHit: 5,
    accuracy: 0,
    initialDice: [4, 4],
    additionalDice: [],
    initialTotal: 8,
    total: 8,
    baseMoS: 0.75,
    accuracyMoS: 0,
    criticalMoS: 0,
    totalMoS: 0.75,
    isSuccess: true,
    resultText: "Success"
  }
});
assert.equal(manifestReplay.ok, true);
assert.equal(replayReplacementConfirmCalls, 0);
assert.equal(manifestReplay.rollOutcome.incomingHitResolution, null);
assert.deepEqual(
  manifestReplay.rollOutcome.manifestRolls.map((entry) => entry.rollType),
  ["manifestDome", "manifestResistance"]
);
assert.deepEqual(rollFormulas, ["2d10", "1d8"]);
assert.deepEqual(
  workflowTarget.effects.map((entry) => getManifestSpellEffectState(entry).manifestType),
  ["dome", "resistance"]
);

const barrierHpBeforeMiss = workflowTarget.effects.map((entry) => getManifestSpellEffectState(entry).magicalHp.value);
attackDice = [1, 2];
rollFormulas.length = 0;
const failedBarrierOutcome = await performNotableCombatRoll({
  actor: workflowCaster,
  combatIndex: 0,
  promptForTargets: true
});
assert.equal(failedBarrierOutcome.rollResult.isSuccess, false);
assert.deepEqual(failedBarrierOutcome.manifestRolls, []);
assert.deepEqual(rollFormulas, ["2d6"]);
assert.deepEqual(
  workflowTarget.effects.map((entry) => getManifestSpellEffectState(entry).magicalHp.value),
  barrierHpBeforeMiss
);
assert.equal(locationWarnings, 0);

attackDice = [4, 4];
barrierCombat.baseUsage = { rules: [
  { when: "manual", tagKeys: ["manifestDome"] },
  { when: "manual", tagKeys: ["manifestResistance"] }
] };
rollFormulas.length = 0;
const gatedBarrierOutcome = await performNotableCombatRoll({
  actor: workflowCaster,
  combatIndex: 0,
  promptForTargets: true
});
assert.equal(gatedBarrierOutcome.rollResult.isSuccess, true);
assert.deepEqual(gatedBarrierOutcome.manifestRolls, [],
  "Manual-gated Manifest tags cannot apply through the automatic spell handler");
delete barrierCombat.baseUsage;

workflowTarget.effects[0].name = "Existing Aura";
setEffectManifestType(workflowTarget.effects[0], "");
workflowTarget.effects[1].name = "Existing Armor";
setEffectManifestType(workflowTarget.effects[1], "");
attackDice = [4, 4];
rollFormulas.length = 0;
let replacementConfirmCalls = 0;
let replacementConfirmContent = "";
foundry.applications.api.DialogV2.confirm = async ({ content }) => {
  replacementConfirmCalls += 1;
  replacementConfirmContent = content;
  return false;
};
workflowCaster.system.notableCombats[0].usesCurrent = 2;
barrierUsageContext.data = structuredClone(barrierCombat);
const cancelledBarrierOutcome = await performNotableCombatRoll({
  actor: workflowCaster,
  combatIndex: 0,
  promptForTargets: true,
  usageContext: barrierUsageContext
});
assert.equal(cancelledBarrierOutcome.manifestPreflightCancelled, true);
assert.equal(replacementConfirmCalls, 1);
assert.match(replacementConfirmContent, /Existing Aura/);
assert.match(replacementConfirmContent, /Existing Armor/);
assert.deepEqual(rollFormulas, []);
assert.equal(workflowCaster.system.notableCombats[0].usesCurrent, 2, "a canceled Manifest preflight does not commit the usage");

barrierUsageContext.data.baseUsage = { rules: [
  { when: "manual", tagKeys: ["manifestDome"] },
  { when: "manual", tagKeys: ["manifestResistance"] }
] };
const manualManifestOutcome = await performNotableCombatRoll({
  actor: workflowCaster, combatIndex: 0, promptForTargets: true, usageContext: barrierUsageContext
});
assert.equal(manualManifestOutcome.manifestPreflightCancelled, undefined);
assert.equal(replacementConfirmCalls, 1, "Manual-gated Manifest tags do not prompt for automatic replacement");
assert.deepEqual(manualManifestOutcome.manifestRolls, []);

delete globalThis.game;
delete globalThis.foundry;
delete globalThis.Roll;
delete globalThis.ChatMessage;
delete globalThis.CONST;
delete globalThis.CONFIG;
delete globalThis.ActiveEffect;
delete globalThis.canvas;
delete globalThis.ui;

console.log("manifest spell casting tests passed");
