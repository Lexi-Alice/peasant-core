import assert from "node:assert/strict";

let messageId = 0;
let randomId = 0;
const messages = new Map();
let diceQueue = [];

globalThis.foundry = {
  abstract: { DataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: {
    deepClone: structuredClone,
    randomID: () => `scar-id-${++randomId}`
  }
};
globalThis.Actor = class {};
globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
globalThis.Hooks = { on() {}, once() {} };
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() {
    const dice = diceQueue.shift();
    assert.ok(dice, `Unexpected random roll: ${this.formula}`);
    assert.equal(this.formula, "3d6");
    this.dice = [{ results: dice.map((result) => ({ result })) }];
    this.total = dice.reduce((sum, result) => sum + result, 0);
    return this;
  }
};
globalThis.ChatMessage = {
  applyMode: (data) => data,
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id || null }),
  async create(data) {
    const flags = {};
    const message = {
      ...data,
      id: `scar-message-${++messageId}`,
      getFlag: (_scope, key) => flags[key],
      setFlag: async (_scope, key, value) => { flags[key] = structuredClone(value); return value; },
      unsetFlag: async (_scope, key) => { delete flags[key]; },
      update: async (changes) => Object.assign(message, changes),
      canUserModify: () => true
    };
    messages.set(message.id, message);
    return message;
  }
};
globalThis.game = {
  user: { id: "gm", isGM: true },
  users: { get: () => game.user },
  actors: new Map(),
  messages,
  settings: { get: () => "public" },
  peasantCore: {}
};
globalThis.ui = { notifications: { info() {}, warn() {} } };

const { getOmniWorstSaveTarget, computeBaseSaves } = await import("../module/data/actor/attributes.mjs");
const { PeasantActor } = await import("../module/documents/actor.mjs");
const { performSavingRoll } = await import("../module/dice/rolls.mjs");
const { getEdgeChainFlag, getEdgeIndividualDieFlag } = await import("../module/applications/combat/edge-chain-rolls.mjs");
const { performPeasantLongRest } = await import("../module/applications/actor/controls/rest-controls.mjs");

const blessedSystem = {
  build: 5,
  reflex: 5,
  intuition: 5,
  learn: 3,
  charisma: 5,
  blessing: { type: "spring", target: "learn" }
};
assert.equal(computeBaseSaves(blessedSystem).learn, 10, "Spring reduces the Learn Basic Attribute Save To-Hit by two");
assert.equal(getOmniWorstSaveTarget(blessedSystem), 10, "Omni-Worst is the highest of all five current Basic Save To-Hits");

const inertSave = await performSavingRoll({ toHit: 10, skillName: "Scar Save", diceOverride: [1, 2, 3], allowPostRollActions: false });
assert.equal(inertSave.forcePassResult, undefined, "Scar saves do not offer Force Pass");
assert.equal(getEdgeChainFlag(inertSave.chatMessage), null, "Scar saves have no Edge chain");
assert.equal(getEdgeIndividualDieFlag(inertSave.chatMessage), null, "Scar saves have no Edge individual action");
assert.equal(inertSave.chatMessage.getFlag("peasant-core", "rollUndo"), undefined, "Scar save cards have no Stress or roll undo action");

function makeActor(id, {
  wounds = 2,
  general = [3, 0],
  grid = [[0, 0, 0, 0, 0, 0, 0, 0, 0, 1]],
  health,
  maxHealth,
  simplified = false,
  flexibleAdvantages = ["Field Notes"],
  flexibleAdvantageDescriptions = ["Keep this description"],
  blessing = { type: "spring", target: "learn" }
} = {}) {
  const hp = { rows: 1, cols: 10, grid: structuredClone(grid) };
  const actor = Object.assign(Object.create(PeasantActor.prototype), {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type: "character",
    isOwner: true,
    system: {
      hp,
      health: { value: health ?? grid[0].filter((cell) => cell === 0).length, max: maxHealth ?? 10 },
      temporaryHp: { value: 0, max: 0 },
      bolsteredHp: 0,
      stamina: { value: 0, max: 5 },
      attunement: { value: 0, max: 4 },
      capacity: { value: 0, max: 3 },
      physicalStressCount: 0,
      mentalStressCount: 0,
      generalStressCount: general.length,
      ...Object.fromEntries(general.map((value, index) => [`general${index}`, value])),
      build: 5,
      reflex: 5,
      intuition: 5,
      learn: 3,
      charisma: 5,
      blessing,
      devastatingWounds: wounds,
      conditions: { wounded: true, head: "disabled" },
      skills: [],
      notableCombats: [],
      flexibleAdvantages: structuredClone(flexibleAdvantages),
      flexibleAdvantageDescriptions: structuredClone(flexibleAdvantageDescriptions)
    },
    effects: [],
    items: [],
    writes: [],
    getFlag: (_scope, key) => key === "simplifiedHp" && simplified ? true : undefined,
    async updatePeasantStateData(update) {
      this.writes.push(structuredClone(update));
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

const recoveryActor = makeActor("long-rest-with-wounds", {
  wounds: 2,
  general: [0],
  flexibleAdvantages: ["Field Notes"],
  flexibleAdvantageDescriptions: ["Keep this description"]
});
const advantagesBeforeRecovery = structuredClone(recoveryActor.system.flexibleAdvantages);
const descriptionsBeforeRecovery = structuredClone(recoveryActor.system.flexibleAdvantageDescriptions);
let scarSaveCalls = 0;
const recoveryResult = await recoveryActor.performPeasantLongRest({
  async rollScarSave() { scarSaveCalls++; return { isSuccess: false }; }
});
assert.equal(scarSaveCalls, 0, "Long Rest no longer invokes Scar Save automation");
assert.equal(recoveryResult.scarSaves, undefined);
assert.equal(recoveryResult.scarConsequence, undefined);
assert.equal(recoveryActor.system.conditions.wounded, false, "Eligible Long Rest still clears Wounded");
assert.equal(recoveryActor.system.devastatingWounds, 0, "Eligible Long Rest still clears Devastating Wounds");
assert.deepEqual(recoveryActor.system.flexibleAdvantages, advantagesBeforeRecovery, "Long Rest no longer grants Scar Consequences");
assert.deepEqual(recoveryActor.system.flexibleAdvantageDescriptions, descriptionsBeforeRecovery);

{
  const actor = makeActor("overcharged-long-rest", { wounds: 0, general: [2, 0] });
  actor.system.conditions.overcharged = true;
  const gridBefore = structuredClone(actor.system.hp.grid);
  const generalBefore = [actor.system.general0, actor.system.general1];
  await actor.performPeasantLongRest();
  assert.deepEqual(actor.system.hp.grid, gridBefore, "Overcharged skips Long Rest Natural Healing");
  assert.deepEqual([actor.system.general0, actor.system.general1], generalBefore, "Overcharged skips General Stress recovery");
  assert.equal(actor.system.temporaryHp.max, 1, "Overcharged retains the Long Rest Temporary HP capacity refresh");
  assert.equal(actor.system.temporaryHp.value, 1, "Overcharged retains the E5 Long Rest Temporary HP grant");
  assert.equal(actor.system.stamina.value, actor.system.stamina.max, "Overcharged still refreshes unrelated resources");
  assert.equal(actor.system.conditions.overcharged, false, "Long Rest clears Overcharged");
  const update = actor.writes.at(-1);
  assert.equal(update["system.conditions.overcharged"], false);
  assert.equal("system.hp.grid" in update, false, "Suppressed Natural Healing adds no grid update");
  assert.equal("system.general0" in update, false, "Suppressed General Stress recovery adds no stress update");
}

{
  const actor = makeActor("overcharged-simplified-long-rest", {
    wounds: 0, general: [2, 0], grid: [[0]], health: 5, maxHealth: 10, simplified: true
  });
  actor.system.conditions.overcharged = true;
  await actor.performPeasantLongRest();
  assert.equal(actor.system.health.value, 5, "Overcharged also skips simplified scalar Natural Healing");
  assert.deepEqual([actor.system.general0, actor.system.general1], [2, 0]);
  assert.equal(actor.system.temporaryHp.value, 5, "Simplified Overcharged rest still grants remaining-damage Temporary HP");
  assert.equal(actor.system.conditions.overcharged, false);
}

const appActor = makeActor("long-rest-without-chat-card", { wounds: 0 });
game.actors = new Map([[appActor.id, appActor]]);
const messageCountBeforeRest = messages.size;
const longRestResult = await performPeasantLongRest({ actor: appActor });
assert.equal(longRestResult.ok, true);
assert.equal(longRestResult.chatMessage, undefined);
assert.equal(messages.size, messageCountBeforeRest, "Long Rest creates no chat card");

delete globalThis.Actor;
delete globalThis.foundry;
delete globalThis.CONST;
delete globalThis.Hooks;
delete globalThis.Roll;
delete globalThis.ChatMessage;
delete globalThis.game;
delete globalThis.ui;

console.log("E5 Scar recovery tests passed");
