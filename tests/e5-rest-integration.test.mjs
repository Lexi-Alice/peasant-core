import assert from "node:assert/strict";

let messageId = 0;
let randomId = 0;
const messages = new Map();
const diceQueue = [];

globalThis.foundry = {
  abstract: { DataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: { deepClone: structuredClone, randomID: () => `rest-${++randomId}` }
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
      id: `rest-message-${++messageId}`,
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

const { PeasantActor } = await import("../module/documents/actor.mjs");
const { performPeasantShortRest, performPeasantLongRest, refreshPeasantResourcesAndResetTracks } = await import("../module/applications/actor/controls/rest-controls.mjs");

function makeActor(id, { grid = [[0]], blessing = "", fallUses = { value: 0, max: 2 }, general = 3, wounds = 0, overcharged = false } = {}) {
  const hp = { rows: grid.length, cols: grid[0]?.length ?? 0, grid: structuredClone(grid) };
  const totalCells = hp.rows * hp.cols;
  const damagedCells = grid.flat().filter((cell) => cell > 0).length;
  const mageDefense = () => ({ block: true, blockType: "Mage", maxHp: 40 });
  return Object.assign(Object.create(PeasantActor.prototype), {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type: "character",
    isOwner: true,
    system: {
      hp,
      health: { value: totalCells - damagedCells, max: totalCells },
      temporaryHp: { value: 0, max: 0 },
      bolsteredHp: 0,
      stamina: { value: 0, max: 3 },
      attunement: { value: 0, max: 2 },
      capacity: { value: 0, max: 4 },
      armorCharge: { value: 1, max: 2 },
      fallBlessingUses: structuredClone(fallUses),
      physicalStressCount: 1,
      physical0: 2,
      mentalStressCount: 1,
      mental0: 1,
      generalStressCount: 1,
      general0: general,
      build: 5,
      reflex: 5,
      intuition: 5,
      learn: 5,
      charisma: 5,
      blessing: { type: blessing },
      devastatingWounds: wounds,
      conditions: { wounded: wounds > 0, overcharged },
      skills: [{ id: "mage-skill", defense: mageDefense(), usages: [{ mechanics: { defense: mageDefense() } }] }],
      notableCombats: [{ id: "mage-combat", defense: mageDefense(), usages: [{ mechanics: { defense: mageDefense() } }] }],
      flexibleAdvantages: [],
      flexibleAdvantageDescriptions: []
    },
    effects: [{
      id: `${id}-mage-duress`,
      type: "spellEffect",
      duration: { value: null, units: "rounds", expiry: "combatEnd", expired: false },
      system: { changes: [
        { key: "effect.system.magicalHp.value", type: "add", value: 20, priority: 20 },
        { key: "effect.system.magicalHp.max", type: "override", value: 40, priority: 20 }
      ] },
      flags: { "peasant-core": {
        mageBlockBarrier: true,
        mageBlockDuress: true,
        mageBlockDefenseId: "notableCombats:mage-combat:base"
      } }
    }],
    items: [],
    getFlag: () => undefined,
    async updatePeasantStateData(update) {
      for (const [path, value] of Object.entries(update)) {
        const parts = path.replace(/^system\./, "").split(".");
        let target = this.system;
        while (parts.length > 1) target = target[parts.shift()];
        target[parts[0]] = structuredClone(value);
      }
    },
    async update(update) { return this.updatePeasantStateData(update); }
  });
}

function mageBarrierState(actor) {
  return {
    defenses: [
    actor.system.skills[0].defense,
    actor.system.skills[0].usages[0].mechanics.defense,
    actor.system.notableCombats[0].defense,
    actor.system.notableCombats[0].usages[0].mechanics.defense
    ].map((defense) => structuredClone(defense)),
    duress: actor.effects.filter((effect) => effect.flags?.["peasant-core"]?.mageBlockDuress).map((effect) => effect.id)
  };
}

function assertMageStateUnchanged(actor, before) {
  assert.deepEqual(mageBarrierState(actor), before, "rests leave Mage barrier HP and combat-bound Duress effects unchanged");
  for (const defense of before.defenses) {
    assert.equal("hp" in defense, false, "current Mage barrier HP is not stored on the defense");
    assert.equal("mageBarrierInitialized" in defense, false, "Duress state is not stored on the defense");
  }
}

for (const rest of [
  async (actor) => actor.performPeasantShortRest(),
  async (actor) => actor.performPeasantLongRest(),
  async (actor) => actor.refreshPeasantResourcesAndResetTracks()
]) {
  const actor = makeActor("mage-reset", { fallUses: { value: 1, max: 2 } });
  const barrierBefore = mageBarrierState(actor);
  await rest(actor);
  assertMageStateUnchanged(actor, barrierBefore);
  assert.equal(actor.system.armorCharge.value, 1, "Short Rest, Long Rest, and the general reset preserve Armor Charge");
}

{
  const summerActor = makeActor("summer-rest", {
    grid: [[1, 1, 1, 1, 1, 2]], blessing: "summer", fallUses: { value: 1, max: 2 }
  });
  const mageBefore = mageBarrierState(summerActor);
  game.actors = new Map([[summerActor.id, summerActor]]);
  const messagesBeforeRest = messages.size;
  const result = await performPeasantLongRest({ actor: summerActor });
  assert.deepEqual(summerActor.system.hp.grid, [[1, 0, 0, 0, 0, 2]], "Summer doubles the Long Rest Natural Healing budget");
  assert.equal(summerActor.system.temporaryHp.max, 2, "Temporary HP capacity uses post-heal damage");
  assert.equal(summerActor.system.temporaryHp.value, 2);
  assert.equal(summerActor.system.general0, 0, "Ordinary Long Rest recovers General Stress");
  assert.deepEqual(summerActor.system.fallBlessingUses, { value: 1, max: 2 }, "Non-Fall Long Rest preserves Fall uses");
  assertMageStateUnchanged(summerActor, mageBefore);
  assert.equal("scarSaves" in result, false, "Long Rest no longer returns automated Scar saves");
  assert.equal(result.chatMessage, undefined, "Long Rest no longer creates a chat card");
  assert.equal(messages.size, messagesBeforeRest, "Long Rest creates no chat messages");
}

{
  const fallActor = makeActor("fall-scar-rest", {
    grid: [[1]], blessing: "fall", fallUses: { value: 0, max: 2 }, general: 3, wounds: 1
  });
  const mageBefore = mageBarrierState(fallActor);
  game.actors = new Map([[fallActor.id, fallActor]]);
  const advantagesBefore = structuredClone(fallActor.system.flexibleAdvantages);
  const messagesBeforeRest = messages.size;
  diceQueue.push([1, 2, 3]);
  const result = await performPeasantLongRest({ actor: fallActor });
  assert.equal(fallActor.system.hp.grid[0][0], 0, "Long Rest still applies natural healing");
  assert.equal(fallActor.system.general0, 0, "Long Rest still recovers General Stress");
  assert.deepEqual(fallActor.system.fallBlessingUses, { value: 2, max: 2 }, "Fall Long Rest refills the stored maximum");
  assertMageStateUnchanged(fallActor, mageBefore);
  assert.equal(fallActor.system.conditions.wounded, false, "Eligible Long Rest still clears Wounded");
  assert.equal(fallActor.system.devastatingWounds, 0, "Eligible Long Rest still clears Devastating Wounds");
  assert.deepEqual(fallActor.system.flexibleAdvantages, advantagesBefore, "Long Rest no longer grants Scar Consequence advantages");
  assert.equal("scarSaves" in result, false, "Long Rest no longer returns automated Scar saves");
  assert.equal("scarConsequence" in result, false, "Long Rest no longer returns a Scar Consequence");
  assert.equal(result.chatMessage, undefined, "Long Rest no longer creates a chat card");
  assert.equal(messages.size, messagesBeforeRest, "Long Rest creates no chat messages, including Scar Save cards");
  assert.equal(diceQueue.length, 1, "Long Rest no longer rolls Scar Saves");
}

{
  const overchargedActor = makeActor("overcharged-fall-rest", {
    grid: [[1, 2]], blessing: "fall", fallUses: { value: 0, max: 3 }, general: 1, overcharged: true
  });
  const mageBefore = mageBarrierState(overchargedActor);
  await overchargedActor.performPeasantLongRest();
  assert.deepEqual(overchargedActor.system.hp.grid, [[1, 2]], "Overcharged skips only Natural Healing");
  assert.equal(overchargedActor.system.health.value, 0);
  assert.equal(overchargedActor.system.temporaryHp.max, 2, "Temporary HP capacity uses the unchanged Overcharged damage state");
  assert.equal(overchargedActor.system.temporaryHp.value, 2);
  assert.equal(overchargedActor.system.general0, 1, "Overcharged skips General Stress recovery");
  assert.equal(overchargedActor.system.stamina.value, 3, "Overcharged still refreshes ordinary resources");
  assert.deepEqual(overchargedActor.system.fallBlessingUses, { value: 3, max: 3 });
  assert.equal(overchargedActor.system.conditions.overcharged, false, "Long Rest clears Overcharged after applying its restriction");
  assertMageStateUnchanged(overchargedActor, mageBefore);
}

delete globalThis.Actor;
delete globalThis.foundry;
delete globalThis.CONST;
delete globalThis.Hooks;
delete globalThis.Roll;
delete globalThis.ChatMessage;
delete globalThis.game;
delete globalThis.ui;

console.log("E5 rest integration tests passed");
