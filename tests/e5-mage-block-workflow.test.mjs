import assert from "node:assert/strict";

import { resolveMageBlockDamage } from "../module/data/actor/combat-defense.mjs";
import { getManifestSpellEffectState } from "../module/data/active-effect/spell-effect-change-keys.mjs";

assert.deepEqual(resolveMageBlockDamage({ hp: 12, maxHp: 40 }, 20), {
  hpBefore: 12,
  hpAfter: 0,
  absorbed: 12,
  overflow: 8,
  cleanHit: true
});

const {
  buildMageBlockDuressEffectSource,
  getMageBlockBarrierEffect,
  getMageBlockBarrierHp,
  getMageBlockDuressEffect,
  updateMageBlockBarrierHp,
  deleteMageBlockBarrier
} = await import("../module/data/active-effect/mage-block-effects.mjs");

globalThis.Actor ??= class {};
const { PeasantActor } = await import("../module/documents/actor.mjs");

function applyPatch(target, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((current, key) => current[key] ??= {}, target);
  parent[last] = structuredClone(value);
}

function mageActor({ maxHp = 40, attunement = 2, capacity = 10 } = {}) {
  const actor = Object.assign(Object.create(PeasantActor.prototype), {
    id: "mage-defender",
    uuid: "Actor.mage-defender",
    name: "Mage Defender",
    img: "icons/actors/mage-defender.webp",
    type: "character",
    system: {
      intuition: 5,
      build: 2,
      attunement: { value: attunement, max: 10 },
      capacity: { value: capacity, max: 10 },
      mentalStressCount: 2,
      mental0: 0,
      mental1: 0,
      generalStressCount: 2,
      general0: 0,
      general1: 0,
      health: { value: 20, max: 20 },
      temporaryHp: { value: 0, max: 0 },
      bolsteredHp: 0,
      hp: { rows: 1, cols: 20, grid: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] },
      notableCombats: [{
        id: "mage-block-id",
        name: "Mage Block",
        img: "icons/notables/mage-block.webp",
        mysteryField: "preserved",
        defense: { block: true, blockType: "Mage", maxHp }
      }]
    },
    stateWrites: [],
    combatWrites: [],
    effects: [],
    getFlag: () => false,
    async createEmbeddedDocuments(_type, sources) {
      const created = sources.map((source, index) => {
        const effect = structuredClone(source);
        effect.id = `mage-effect-${actor.effects.length + index + 1}`;
        effect._id = effect.id;
        effect.system ??= structuredClone(effect._source?.system || {});
        effect._source = structuredClone(effect);
        effect.update = async (update) => {
          for (const [path, value] of Object.entries(update)) {
            applyPatch(effect, path, value);
            applyPatch(effect._source, path, value);
          }
        };
        effect.delete = async () => { actor.effects = actor.effects.filter((entry) => entry !== effect); };
        return effect;
      });
      actor.effects.push(...created);
      return created;
    },
    async updateEmbeddedDocuments(_type, updates) {
      for (const update of updates) {
        const effect = actor.effects.find((entry) => entry.id === update._id);
        if (!effect) continue;
        Object.assign(effect._source, structuredClone(update));
        Object.assign(effect, structuredClone(update));
      }
      return updates;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      actor.effects = actor.effects.filter((effect) => !ids.includes(effect.id));
      return ids;
    },
    getPeasantNotableCombatsForUpdate: () => structuredClone(actor.system.notableCombats),
    async setPeasantNotableCombats(combats) {
      actor.combatWrites.push(structuredClone(combats));
      actor.system.notableCombats = structuredClone(combats);
    },
    async updatePeasantStateData(patch) {
      actor.stateWrites.push(structuredClone(patch));
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.replace(/^system\./, "").split(".");
        let target = actor.system;
        for (const key of parts.slice(0, -1)) target = target[key] ??= {};
        target[parts.at(-1)] = structuredClone(value);
      }
    },
    async updatePeasantSourceData(patch) { return actor.updatePeasantStateData(patch); }
  });
  return actor;
}

const firstCreationActor = mageActor({ maxHp: 40, attunement: 2, capacity: 10 });
const firstCreation = await firstCreationActor.applyPeasantMageBlockBarrierAction({
  action: "create",
  selectedCombatId: "mage-block-id",
  selectedCombatIndex: 0
});
assert.equal(firstCreation.ok, true, "legacy current HP does not bypass mandatory first creation");
assert.equal(firstCreationActor.system.attunement.value, 2, "barrier creation does not add a synthetic resource cost");
assert.equal("hp" in firstCreationActor.system.notableCombats[0].defense, false);
assert.equal("mageBarrierInitialized" in firstCreationActor.system.notableCombats[0].defense, false);
assert.deepEqual(getMageBlockBarrierHp(getMageBlockBarrierEffect(firstCreationActor, "notableCombats:mage-block-id:base")), { value: 40, max: 40 });
assert.equal(getMageBlockBarrierEffect(firstCreationActor, "notableCombats:mage-block-id:base").img, "icons/notables/mage-block.webp");
assert.ok(getMageBlockDuressEffect(firstCreationActor, "notableCombats:mage-block-id:base"));
assert.equal(firstCreationActor.system.notableCombats[0].mysteryField, "preserved");

const useBarrierActor = mageActor({ attunement: 5 });
await useBarrierActor.applyPeasantMageBlockBarrierAction({ action: "create", selectedCombatId: "mage-block-id" });
await updateMageBlockBarrierHp(getMageBlockBarrierEffect(useBarrierActor, "notableCombats:mage-block-id:base"), 12);
const useBarrier = await useBarrierActor.applyPeasantMageBlockBarrierAction({
  action: "use",
  selectedCombatId: "mage-block-id",
  selectedCombatIndex: 0
});
assert.equal(useBarrier.ok, true);
assert.equal(useBarrier.changed, false);
assert.equal(useBarrierActor.system.attunement.value, 5, "using a current barrier costs no resource");
assert.equal(getMageBlockBarrierHp(getMageBlockBarrierEffect(useBarrierActor, "notableCombats:mage-block-id:base")).value, 12,
  "using a current barrier preserves its damaged effect value");

const refreshBarrierActor = mageActor({ attunement: 5 });
await refreshBarrierActor.applyPeasantMageBlockBarrierAction({ action: "create", selectedCombatId: "mage-block-id" });
await deleteMageBlockBarrier(getMageBlockBarrierEffect(refreshBarrierActor, "notableCombats:mage-block-id:base"));
assert.equal(getMageBlockBarrierEffect(refreshBarrierActor, "notableCombats:mage-block-id:base"), null,
  "a depleted barrier is absent");
assert.equal(getMageBlockDuressEffect(refreshBarrierActor, "notableCombats:mage-block-id:base"), null,
  "depletion also clears the Duress marker");
const refreshWithoutBarrier = await refreshBarrierActor.applyPeasantMageBlockBarrierAction({
  action: "refresh",
  selectedCombatId: "mage-block-id",
  selectedCombatIndex: 0
});
assert.equal(refreshWithoutBarrier.ok, false, "a destroyed barrier cannot be refreshed");
const recreated = await refreshBarrierActor.applyPeasantMageBlockBarrierAction({
  action: "create",
  selectedCombatId: "mage-block-id",
  selectedCombatIndex: 0
});
assert.equal(recreated.ok, true, "a destroyed barrier must be created again");
assert.equal(refreshBarrierActor.system.attunement.value, 5, "refresh uses only the authored Notable resource cost");
assert.deepEqual(getMageBlockBarrierHp(getMageBlockBarrierEffect(refreshBarrierActor, "notableCombats:mage-block-id:base")), { value: 40, max: 40 });
assert.equal(getMageBlockBarrierEffect(refreshBarrierActor, "notableCombats:mage-block-id:base").img, "icons/notables/mage-block.webp");

const incompleteBarrierActor = mageActor();
const invalidUse = await incompleteBarrierActor.applyPeasantMageBlockBarrierAction({
  action: "use",
  selectedCombatId: "mage-block-id",
  selectedCombatIndex: 0
});
assert.equal(invalidUse.ok, false, "an uninitialized Mage barrier cannot be treated as previously created");
assert.equal(incompleteBarrierActor.system.attunement.value, 2);

const mageDialogs = [];
const jqueryValues = new Map();
const jqueryHtml = new Map();
const jqueryVisibility = new Map();
const selectOptions = new Map();
let cancelForcePass = false;
function jquerySelection(selector) {
  return {
    val(value) {
      if (arguments.length) { jqueryValues.set(selector, String(value)); return this; }
      if (jqueryValues.has(selector)) return jqueryValues.get(selector);
      if (selector.includes("defenseCombatIndex")) return "0:base";
      if (selector.includes("defensePreviewToHit")) return "7";
      if (selector.includes("defensePreviewAccuracy")) return "0";
      return "";
    },
    html(value) {
      if (arguments.length) { jqueryHtml.set(selector, String(value)); return this; }
      return jqueryHtml.get(selector) || "";
    },
    empty() { selectOptions.set(selector, []); jqueryValues.delete(selector); return this; },
    append(html) {
      const match = String(html).match(/<option value="([^"]+)">([^<]*)<\/option>/);
      if (match) selectOptions.set(selector, [...(selectOptions.get(selector) || []), { value: match[1], label: match[2] }]);
      return this;
    },
    show() { jqueryVisibility.set(selector, true); return this; },
    hide() { jqueryVisibility.set(selector, false); return this; },
    text() { return this; },
    prop() { return this; },
    css() { return this; },
    off() { return this; },
    on(event, callback) {
      if (cancelForcePass && event.includes("pcForcePassClose")) {
        cancelForcePass = false;
        callback();
      }
      return this;
    }
  };
}
function jqueryRoot(element) {
  const root = {
    0: element,
    length: element ? 1 : 0,
    find: (selector) => jquerySelection(selector),
    css() { return this; },
    closest() { return this; }
  };
  return root;
}
globalThis.foundry = {
  utils: { deepClone: structuredClone, randomID: () => "mage-undo" },
  applications: { api: { DialogV2: class {
    constructor(config) {
      this.config = config;
      this.element = { nodeType: 1, isConnected: true, querySelector: () => null };
      mageDialogs.push(this);
    }
    render() { return Promise.resolve(this); }
  } } }
};
globalThis.window = { innerWidth: 480, setInterval: () => 1, clearInterval: () => {} };
globalThis.ui = { notifications: { warn: () => {} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.game = {
  user: { id: "mage-owner", isGM: false },
  users: [{ id: "mage-owner", active: true, isGM: false }],
  actors: new Map(),
  peasantCore: {}
};
globalThis.ChatMessage = {
  getSpeaker: () => ({}),
  create: async (data) => ({ id: "mage-block-card", ...data })
};
globalThis.$ = (element) => jqueryRoot(element);

const { showDefensePromptDialog } = await import("../module/applications/combat/defense-prompt-dialog.mjs");
const { applyIncomingHit, requestIncomingHitApplicationForTarget } = await import("../module/applications/combat/incoming-hit-requests.mjs");
const { applyRollUndoRecords } = await import("../module/applications/chat-undo.mjs");
const promptActor = mageActor({ hp: 12, initialized: false });
promptActor.system.notableCombats[0].defense.responses = ["Melee"];
promptActor.system.notableCombats[0].tohit = 7;
promptActor.system.notableCombats[0].accuracy = 0;
promptActor.getFlag = () => ({ melee: { index: 0, name: "Mage Block" } });
promptActor.canUserModify = (user) => user?.id === "mage-owner";
promptActor.testUserPermission = (user) => user?.id === "mage-owner";
game.actors.set(promptActor.id, promptActor);
let mageRollOptions = null;
const promptResultPromise = showDefensePromptDialog({
  targetActorId: promptActor.id,
  attackCombatName: "Mage Prompt Test",
  attackTargetingType: "Melee"
}, {
  rollNotableCombat: async (options) => {
    mageRollOptions = options;
    return { rolled: true, rollResult: { isSuccess: true, totalMoS: 1 } };
  }
});
await new Promise((resolve) => setTimeout(resolve, 0));
const defenseDialog = mageDialogs.at(-1);
assert.match(defenseDialog.config.content, /pc-mage-barrier-action/);
assert.match(defenseDialog.config.content, /name="mageBarrierAction"/);
const barrierCardGroupIndex = defenseDialog.config.content.indexOf('class="form-group pc-mage-barrier-effect-group"');
const barrierActionGroupIndex = defenseDialog.config.content.indexOf('class="form-group pc-mage-barrier-action"');
assert.ok(barrierCardGroupIndex >= 0 && barrierCardGroupIndex < barrierActionGroupIndex,
  "the barrier effect has its own block above the Barrier Action group");
assert.equal(jqueryHtml.get(".pc-mage-barrier-summary"), "", "no barrier card is rendered before Mage Block is created");
assert.deepEqual(selectOptions.get('[name="mageBarrierAction"]').map(({ value }) => value), ["create"]);
assert.equal(jqueryVisibility.get(".pc-mage-barrier-action"), false,
  "the Barrier Action row is hidden when Create Barrier is the only available action");
await defenseDialog.config.buttons.find((button) => button.action === "roll").callback({}, null, defenseDialog);
const promptResult = await promptResultPromise;
assert.equal(promptResult.selectedCombatId, "mage-block-id");
assert.equal(promptResult.mageBarrierAction, "create", "a missing Duress effect forces first creation");
assert.equal(promptResult.skipResourceCosts, undefined);
assert.equal(mageRollOptions.mageBarrierAction, "create");
assert.equal(mageRollOptions.skipResourceCosts, undefined, "Mage defense keeps the ordinary authored resource-cost path");
assert.equal(promptActor.system.attunement.value, 2, "the prompt does not spend resources before a roll completes");

const initializedPromptActor = mageActor({ hp: 0, initialized: true });
await initializedPromptActor.applyPeasantMageBlockBarrierAction({ action: "create", selectedCombatId: "mage-block-id" });
await deleteMageBlockBarrier(getMageBlockBarrierEffect(initializedPromptActor, "notableCombats:mage-block-id:base"));
initializedPromptActor.system.notableCombats[0].defense.responses = ["Melee"];
initializedPromptActor.system.notableCombats[0].tohit = 7;
initializedPromptActor.system.notableCombats[0].accuracy = 0;
initializedPromptActor.getFlag = () => ({ melee: { index: 0, name: "Mage Block" } });
game.actors.set(initializedPromptActor.id, initializedPromptActor);
const initializedPromptPromise = showDefensePromptDialog({
  targetActorId: initializedPromptActor.id,
  attackCombatName: "Initialized Mage Prompt",
  attackTargetingType: "Melee"
}, { rollNotableCombat: async () => ({ rolled: true, rollResult: { isSuccess: true } }) });
await new Promise((resolve) => setTimeout(resolve, 0));
const initializedDialog = mageDialogs.at(-1);
assert.deepEqual(selectOptions.get('[name="mageBarrierAction"]').map(({ value }) => value), ["create"]);
assert.match(jqueryValues.get('[name="mageBarrierAction"]'), /create/);
assert.equal(jqueryVisibility.get(".pc-mage-barrier-action"), false,
  "destroying the barrier leaves Create Barrier as the only action");
await initializedDialog.config.buttons.find((button) => button.action === "roll").callback({}, null, initializedDialog);
assert.equal((await initializedPromptPromise).mageBarrierAction, "create",
  "destroying the barrier forces Create Barrier on the next defense");

const barrierDisplayActor = mageActor();
await barrierDisplayActor.applyPeasantMageBlockBarrierAction({ action: "create", selectedCombatId: "mage-block-id" });
await updateMageBlockBarrierHp(getMageBlockBarrierEffect(barrierDisplayActor, "notableCombats:mage-block-id:base"), 34);
barrierDisplayActor.system.notableCombats[0].defense.responses = ["Melee"];
barrierDisplayActor.system.notableCombats[0].tohit = 7;
barrierDisplayActor.system.notableCombats[0].accuracy = 0;
barrierDisplayActor.getFlag = () => ({ melee: { index: 0, name: "Mage Block" } });
game.actors.set(barrierDisplayActor.id, barrierDisplayActor);
const barrierDisplayPromise = showDefensePromptDialog({
  targetActorId: barrierDisplayActor.id,
  attackCombatName: "Mage Barrier Display",
  attackTargetingType: "Melee"
}, { rollNotableCombat: async () => ({ rolled: true, rollResult: { isSuccess: true } }) });
await new Promise((resolve) => setTimeout(resolve, 0));
const barrierDisplay = jqueryHtml.get(".pc-mage-barrier-summary");
assert.match(barrierDisplay, /pc-inventory-item-row pc-passive-effect-row pc-mage-barrier-effect-row/);
assert.match(barrierDisplay, /src="icons\/notables\/mage-block\.webp"/);
assert.match(barrierDisplay, /Mage Block Barrier/);
assert.match(barrierDisplay, /34\/40 HP/);
const barrierDisplayDialog = mageDialogs.at(-1);
await barrierDisplayDialog.config.buttons.find((button) => button.action === "roll").callback({}, null, barrierDisplayDialog);
await barrierDisplayPromise;

function createOwnerMageActor(id, entries, { owner = "mage-owner", hp = 20 } = {}) {
  const actor = Object.assign(Object.create(PeasantActor.prototype), {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type: "character",
    ownerId: owner,
    system: {
      notableCombats: structuredClone(entries),
      health: { value: hp, max: 20 },
      temporaryHp: { value: 0, max: 0 },
      bolsteredHp: 0
    },
    effects: [],
    combatWrites: [],
    locationlessWrites: [],
    effectWrites: [],
    testUserPermission: (user) => user?.id === owner,
    canUserModify: (user) => user?.id === owner,
    getPeasantNotableCombatsForUpdate: () => structuredClone(actor.system.notableCombats),
    async setPeasantNotableCombats(value) {
      actor.combatWrites.push(structuredClone(value));
      actor.system.notableCombats = structuredClone(value);
    },
    async createEmbeddedDocuments(_type, sources) {
      const created = sources.map((source, index) => {
        const stored = { ...structuredClone(source), _id: `${id}-effect-${actor.effects.length + index + 1}` };
        const effect = {
          id: stored._id,
          _id: stored._id,
          type: stored.type,
          name: stored.name,
          disabled: stored.disabled,
          duration: structuredClone(stored.duration),
          flags: structuredClone(stored.flags),
          _source: stored,
          toObject: () => structuredClone(effect._source),
          async update(patch) {
            Object.assign(effect._source, structuredClone(patch));
            Object.assign(effect, structuredClone(patch));
          }
        };
        return effect;
      });
      actor.effectWrites.push(sources.map((source) => structuredClone(source)));
      actor.effects.push(...created);
      return created;
    },
    async updateEmbeddedDocuments(_type, updates) {
      for (const update of updates) {
        const effect = actor.effects.find((entry) => entry.id === update._id);
        if (!effect) continue;
        Object.assign(effect._source, structuredClone(update));
        Object.assign(effect, structuredClone(update));
      }
      return updates;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      actor.effects = actor.effects.filter((effect) => !ids.includes(effect.id));
      return ids;
    },
    async applyPeasantLocationlessDamage(options) {
      actor.locationlessWrites.push(structuredClone(options));
      actor.system.health.value -= options.amount;
      return { ok: true, damageToGrid: options.amount, dome: { reason: "alreadyResolved" }, resistance: { reason: options.ignoreResistance ? "ignored" : "normal" } };
    },
    async updatePeasantStateData(patch) {
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.replace(/^system\./, "").split(".");
        let target = actor.system;
        for (const key of parts.slice(0, -1)) target = target[key] ??= {};
        target[parts.at(-1)] = structuredClone(value);
      }
    },
    async update(patch) { return actor.updatePeasantStateData(patch); }
  });
  return actor;
}

function mageEntry(id) {
  return { id, name: id, defense: { block: true, blockType: "Mage", maxHp: 40 } };
}

function seedMageBlockEffects(actor, entry, hp = 12) {
  const identity = `notableCombats:${entry.id}:base`;
  const source = (kind, changes = []) => ({
    _id: `${entry.id}-${kind}`,
    id: `${entry.id}-${kind}`,
    type: "spellEffect",
    name: `Mage Block ${kind}`,
    system: { encounterId: "" , changes },
    duration: kind === "Duress"
      ? { value: null, units: "rounds", expiry: "combatEnd", expired: false }
      : { value: null, units: "rounds", expiry: null, expired: false },
    flags: { "peasant-core": { [`mageBlock${kind}`]: true, mageBlockDefenseId: identity } }
  });
  const marker = source("Duress");
  actor.effects.push({
    ...marker,
    _source: structuredClone(marker),
    toObject() { return structuredClone(this._source); },
    async delete() { await actor.deleteEmbeddedDocuments("ActiveEffect", [this.id]); },
    async update(update) { Object.assign(this._source, structuredClone(update)); Object.assign(this, structuredClone(update)); }
  });
  if (hp <= 0) return;
  const barrier = source("Barrier", [
    { key: "effect.system.magicalHp.value", type: "add", value: hp, priority: 20 },
    { key: "effect.system.magicalHp.max", type: "override", value: entry.defense.maxHp, priority: 20 }
  ]);
  actor.effects.push({
    ...barrier,
    _source: structuredClone(barrier),
    toObject() { return structuredClone(this._source); },
    async delete() { await actor.deleteEmbeddedDocuments("ActiveEffect", [this.id]); },
    async update(update) {
      if (update["system.changes"]) {
        this.system.changes = structuredClone(update["system.changes"]);
        this._source.system.changes = structuredClone(update["system.changes"]);
      }
      Object.assign(this._source, structuredClone(update));
      Object.assign(this, structuredClone(update));
    }
  });
}

const liveCapacityActor = mageActor({ maxHp: 40 });
await liveCapacityActor.applyPeasantMageBlockBarrierAction({ action: "create", selectedCombatId: "mage-block-id" });
await updateMageBlockBarrierHp(getMageBlockBarrierEffect(liveCapacityActor, "notableCombats:mage-block-id:base"), 35);
liveCapacityActor.system.notableCombats[0].defense.maxHp = 20;
game.actors.set(liveCapacityActor.id, liveCapacityActor);
const liveCapacityHit = await applyIncomingHit({
  targetActorId: liveCapacityActor.id,
  damageAmount: 5,
  damageType: "blunt",
  mageBlock: { selectedCombatId: "mage-block-id", selectedUsageId: "base", mageBarrierAction: "use" }
});
assert.equal(liveCapacityHit.hpBefore, 35, "incoming Mage damage reads the live barrier, not a newly authored cap");
assert.equal(liveCapacityHit.hpAfter, 30);
assert.deepEqual(getMageBlockBarrierHp(getMageBlockBarrierEffect(liveCapacityActor, "notableCombats:mage-block-id:base")), { value: 30, max: 40 });
const changedCapacityRefresh = await liveCapacityActor.applyPeasantMageBlockBarrierAction({ action: "refresh", selectedCombatId: "mage-block-id" });
assert.equal(changedCapacityRefresh.ok, true);
assert.deepEqual(getMageBlockBarrierHp(getMageBlockBarrierEffect(liveCapacityActor, "notableCombats:mage-block-id:base")), { value: 20, max: 20 },
  "refresh takes the current authored capacity");

const directMageActor = createOwnerMageActor("direct-mage", [mageEntry("direct-selected")]);
seedMageBlockEffects(directMageActor, directMageActor.system.notableCombats[0], 12);
game.actors.set(directMageActor.id, directMageActor);
const directMageHit = await applyIncomingHit({
  targetActorId: directMageActor.id,
  damageAmount: 20,
  damageType: "blunt",
  domeAlreadyResolved: true,
  mageBlock: { selectedCombatId: "direct-selected", selectedCombatIndex: 0, mageBarrierAction: "use" }
});
assert.equal(directMageHit.applied, true);
assert.equal(directMageHit.hpAfter, 0);
assert.equal(directMageHit.overflow, 8);
assert.equal(directMageHit.cleanHit, true);
assert.equal(directMageHit.fociSunderRequired, true);
assert.equal(directMageHit.guardBreakRequired, true);
assert.equal(directMageHit.crushResistanceRequired, true);
assert.equal(directMageHit.spellJamResistanceRequired, true);
assert.equal("hp" in directMageActor.system.notableCombats[0].defense, false, "incoming barrier damage never stores current HP on the Notable");
assert.equal(directMageActor.combatWrites.length, 0, "incoming barrier damage is stored only on the Active Effect");
assert.equal(directMageActor.effects.filter((effect) => effect.flags?.["peasant-core"]?.mageBlockBarrier).length, 0,
  "depleted Mage barriers are deleted instead of persisting at zero HP");
assert.equal(directMageActor.effects.filter((effect) => effect.flags?.["peasant-core"]?.mageBlockDuress).length, 0,
  "depleting the barrier removes its Duress marker");
assert.equal(directMageActor.effects.length, 1, "Mage overflow leaves only the Guard-Broken effect");
const directGuardBroken = directMageActor.effects.find((effect) => effect.flags["peasant-core"].guardBroken);
assert.equal(directGuardBroken.type, "skill");
assert.equal(directGuardBroken.duration.expiry, "roundEnd");
assert.match(directMageHit.chatMessage.content, /Manually Sunder a Foci/);
assert.match(directMageHit.chatMessage.content, /Crush and Spell Jam resistance checks/);
assert.equal(directMageActor.combatWrites.length, 0, "the owner stores Mage barrier state on its Active Effect");
assert.equal(directMageActor.locationlessWrites[0].amount, 8);
assert.equal(directMageActor.locationlessWrites[0].ignoreResistance, true);

const depletedMageActor = mageActor();
await depletedMageActor.createEmbeddedDocuments("ActiveEffect", [buildMageBlockDuressEffectSource(depletedMageActor, {
  identity: "notableCombats:mage-block-id:base",
  name: "Mage Block",
  img: "icons/notables/mage-block.webp"
})]);
const staleMarkerUse = await depletedMageActor.applyPeasantMageBlockBarrierAction({
  action: "use",
  selectedCombatId: "mage-block-id",
  selectedCombatIndex: 0
});
assert.equal(staleMarkerUse.ok, false, "a Duress marker without a barrier cannot be used at zero HP");
const createAfterDepletion = await depletedMageActor.applyPeasantMageBlockBarrierAction({
  action: "create",
  selectedCombatId: "mage-block-id",
  selectedCombatIndex: 0
});
assert.equal(createAfterDepletion.ok, true, "a zero-HP state requires a fresh barrier creation");
assert.deepEqual(getMageBlockBarrierHp(getMageBlockBarrierEffect(depletedMageActor, "notableCombats:mage-block-id:base")), { value: 40, max: 40 });

const absorbedMageActor = createOwnerMageActor("absorbed-mage", [mageEntry("absorbed-selected")]);
seedMageBlockEffects(absorbedMageActor, absorbedMageActor.system.notableCombats[0], 12);
game.actors.set(absorbedMageActor.id, absorbedMageActor);
const absorbedMageHit = await applyIncomingHit({
  targetActorId: absorbedMageActor.id,
  damageAmount: 8,
  damageType: "blunt",
  mageBlock: { selectedCombatId: "absorbed-selected", selectedCombatIndex: 0, mageBarrierAction: "use" }
});
assert.equal(absorbedMageHit.hpAfter, 4);
assert.equal("hp" in absorbedMageActor.system.notableCombats[0].defense, false);
assert.equal(getManifestSpellEffectState(absorbedMageActor.effects.find((effect) => effect.flags?.["peasant-core"]?.mageBlockBarrier)).magicalHp.value, 4,
  "partially absorbed damage updates the current value on its barrier effect");
assert.equal(absorbedMageHit.overflow, 0);
assert.equal(absorbedMageHit.cleanHit, false);
assert.equal(absorbedMageHit.fociSunderRequired, false);
assert.equal(absorbedMageHit.guardBreakRequired, false);
assert.equal(absorbedMageHit.crushResistanceRequired, false);
assert.equal(absorbedMageHit.spellJamResistanceRequired, false);
assert.equal(absorbedMageActor.locationlessWrites.length, 0, "fully absorbed damage never reaches actor HP");
assert.equal(absorbedMageActor.effects.length, 2, "fully absorbed Mage Block leaves its barrier and Duress effects without Guard-Broken");

const remoteMageActor = createOwnerMageActor("remote-mage", [mageEntry("other"), mageEntry("remote-selected")], { owner: "remote-owner" });
seedMageBlockEffects(remoteMageActor, remoteMageActor.system.notableCombats[1], 12);
game.actors.set(remoteMageActor.id, remoteMageActor);
game.users = [{ id: "remote-owner", active: true, isGM: false }];
game.user = { id: "attacker", isGM: false };
let remoteMagePayload = null;
game.peasantCore.applyIncomingHitForUser = async (userId, payload) => {
  assert.equal(userId, "remote-owner");
  remoteMagePayload = structuredClone(payload);
  game.user = { id: "remote-owner", isGM: false };
  try {
    return await applyIncomingHit(payload);
  } finally {
    game.user = { id: "attacker", isGM: false };
  }
};
const remoteMageHit = await requestIncomingHitApplicationForTarget({
  target: { actor: remoteMageActor, targetName: remoteMageActor.name },
  attackerActor: { id: "attacker", name: "Attacker" },
  combat: { name: "Remote Mage Test", targetingType: "Melee", damage: { type: "blunt" } },
  damageRoll: { total: 40, normalizedType: "blunt" },
  locationRoll: { location: "", locationDisplay: "Mage Block Overflow", rawText: "Mage Block Overflow" },
  incomingHitResolution: { appliedDamageType: "blunt" },
  damageAmountOverride: 30,
  mageBlock: { selectedCombatId: "remote-selected", selectedCombatIndex: 0, mageBarrierAction: "refresh" },
  domeAlreadyResolved: true
});
assert.equal(remoteMagePayload.damageAmount, 30, "the Mage barrier receives post-Dome penetration");
assert.equal(remoteMagePayload.mageBlock.selectedCombatId, "remote-selected");
assert.equal(remoteMagePayload.mageBlock.mageBarrierAction, "refresh");
assert.equal("hp" in remoteMageActor.system.notableCombats[0].defense, false, "ID selection preserves unrelated Notable data");
assert.equal("hp" in remoteMageActor.system.notableCombats[1].defense, false);
assert.equal(remoteMageHit.overflow, 18);
assert.equal(remoteMageActor.locationlessWrites[0].amount, 18);
assert.equal(remoteMageActor.combatWrites.length, 0);
assert.equal(remoteMageActor.effects.length, 1, "remote overflow removes Mage Block effects and creates Guard-Broken on the target owner");
game.user = { id: "remote-owner", isGM: false };
assert.equal((await applyRollUndoRecords(remoteMageHit.undoRecords)).ok, true);
assert.equal(getManifestSpellEffectState(remoteMageActor.effects.find((effect) => effect.flags?.["peasant-core"]?.mageBlockBarrier)).magicalHp.value, 12,
  "remote Mage Block undo restores barrier state on its Active Effect");
assert.equal(remoteMageActor.system.health.value, 20, "remote Mage Block undo restores Clean Hit HP");
assert.equal(remoteMageActor.effects.length, 2, "remote Mage Block undo restores the barrier and removes Guard-Broken");

const resistanceActor = Object.assign(Object.create(PeasantActor.prototype), {
  type: "character",
  system: {
    hp: {
      rows: 1,
      cols: 8,
      grid: [[0, 0, 0, 0, 0, 0, 0, 0]],
      applyDamage(type, amount) {
        const value = { blunt: 1, lethal: 2, critical: 3 }[type];
        for (let index = 0; index < amount; index += 1) this.grid[0][index] = value;
      }
    },
    health: { value: 8, max: 8 },
    temporaryHp: { value: 0, max: 0 },
    bolsteredHp: 0
  },
  getFlag: (_scope, key) => key.startsWith("damageResistance") ? 0 : undefined,
  async updatePeasantStateData(patch) {
    for (const [path, value] of Object.entries(patch)) {
      const parts = path.replace(/^system\./, "").split(".");
      let target = resistanceActor.system;
      for (const key of parts.slice(0, -1)) target = target[key] ??= {};
      target[parts.at(-1)] = structuredClone(value);
    }
  }
});
const bypassResistanceResult = await resistanceActor.applyPeasantLocationlessDamage({
  amount: 8, type: "blunt", domeAlreadyResolved: true, ignoreResistance: true
});
assert.equal(bypassResistanceResult.damageToGrid, 8, "Mage Clean Hit overflow bypasses actor Resistance multipliers");
assert.deepEqual(resistanceActor.system.hp.grid[0], [1, 1, 1, 1, 1, 1, 1, 1]);

globalThis.CONST.CHAT_MESSAGE_STYLES = { OTHER: 0 };
globalThis.CONFIG = { sounds: { dice: null } };
globalThis.canvas = { scene: { id: "mage-scene" }, tokens: { controlled: [] } };
const workflowMessages = new Map();
workflowMessages.contents = [];
let rollDiceSets = [[3, 4]];
globalThis.Roll = class {
  async evaluate() {
    const values = rollDiceSets.shift() || [3, 4];
    this.dice = [{ results: values.map((result) => ({ result })) }];
    this.total = values.reduce((sum, value) => sum + value, 0);
    return this;
  }
};
globalThis.ChatMessage.applyMode = (data) => data;
globalThis.ChatMessage.create = async (data) => {
  const id = `mage-roll-${workflowMessages.size + 1}`;
  const flags = {};
  const message = {
    id,
    ...data,
    getFlag: (_scope, key) => flags[key],
    setFlag: async (_scope, key, value) => { flags[key] = structuredClone(value); return value; },
    update: async (patch) => Object.assign(message, patch),
    canUserModify: () => true,
    flags
  };
  workflowMessages.set(id, message);
  workflowMessages.contents.push(message);
  return message;
};
game.messages = workflowMessages;
game.settings = { get: () => "public" };

async function workflowMageActor(id, { hp = 12, attunement = 5, stamina = 5 } = {}) {
  const actor = mageActor({ attunement });
  actor.id = id;
  actor.uuid = `Actor.${id}`;
  actor.system.stamina = { value: stamina, max: 5 };
  actor.system.capacity = { value: 10, max: 10 };
  actor.system.combatMods = { toHit: 0, accuracy: 0, costMod: 0 };
  actor.system.notableCombats[0] = {
    ...actor.system.notableCombats[0],
    rank: "1",
    tohit: 7,
    accuracy: 0,
    resourceCosts: [{ type: "Stamina", value: 3 }],
    damage: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" },
    heal: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" },
    manifest: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0 }
  };
  actor.consumePeasantCombatUse = async () => ({ ok: true, changed: false });
  actor.canUserModify = () => true;
  actor.testUserPermission = () => true;
  actor.getPeasantNotableCombatsForUpdate = () => structuredClone(actor.system.notableCombats);
  actor.setPeasantNotableCombats = async (entries) => {
    actor.combatWrites.push(structuredClone(entries));
    actor.system.notableCombats = structuredClone(entries);
    return { ok: true, changed: true };
  };
  actor.updatePeasantStateData = async (patch) => {
    actor.stateWrites.push(structuredClone(patch));
    for (const [path, value] of Object.entries(patch)) {
      const parts = path.replace(/^system\./, "").split(".");
      let target = actor.system;
      for (const key of parts.slice(0, -1)) target = target[key] ??= {};
      target[parts.at(-1)] = structuredClone(value);
    }
  };
  actor.updatePeasantSourceData = actor.updatePeasantStateData;
  actor.update = actor.updatePeasantStateData;
  await actor.applyPeasantMageBlockBarrierAction({ action: "create", selectedCombatId: "mage-block-id" });
  await updateMageBlockBarrierHp(getMageBlockBarrierEffect(actor, "notableCombats:mage-block-id:base"), hp);
  return actor;
}

const { performNotableCombatRoll } = await import("../module/applications/combat/notable-combat-workflow.mjs");
const rollActor = await workflowMageActor("mage-defense-roll");
game.actors.set(rollActor.id, rollActor);
const rollOutcome = await performNotableCombatRoll({
  actor: rollActor,
  combatIndex: 0,
  promptForTargets: false,
  mageBarrierAction: "refresh",
  edgeChainContext: { chainId: "mage-defense-roll-chain" }
});
assert.equal(rollOutcome.rolled, true);
assert.equal(rollActor.system.stamina.value, 2, "Mage Block pays the manually authored Stamina resource tag");
assert.equal(rollActor.system.attunement.value, 5, "Mage Block adds no synthetic Attunement cost");
assert.equal("hp" in rollActor.system.notableCombats[0].defense, false);
assert.equal(getMageBlockBarrierHp(getMageBlockBarrierEffect(rollActor, "notableCombats:mage-block-id:base")).value, 40);
assert.ok(rollOutcome.undoRecords.some((record) => record.spellEffects), "barrier refresh is captured in defense-roll Active Effect undo");
assert.equal((await applyRollUndoRecords(rollOutcome.undoRecords)).ok, true, "the defense roll's undo restores its Mage resource transaction");
assert.equal(rollActor.system.attunement.value, 5);
assert.equal(getMageBlockBarrierHp(getMageBlockBarrierEffect(rollActor, "notableCombats:mage-block-id:base")).value, 12);
assert.equal(rollActor.system.stamina.value, 5, "undo restores the Notable's authored resource cost");

const staleRefreshActor = await workflowMageActor("mage-defense-refresh-stale");
staleRefreshActor.system.notableCombats[0].defense.responses = ["Melee"];
staleRefreshActor.getFlag = () => ({ melee: { index: 0, name: "Mage Block" } });
game.actors.set(staleRefreshActor.id, staleRefreshActor);
let staleRefreshRoll = null;
const staleRefreshPrompt = showDefensePromptDialog({
  targetActorId: staleRefreshActor.id,
  attackCombatName: "Stale Refresh",
  attackTargetingType: "Melee"
}, {
  rollNotableCombat: async (options) => {
    assert.equal(options.mageBarrierAction, "refresh", "refresh was accepted by prompt validation while the barrier existed");
    assert.ok(getMageBlockBarrierEffect(staleRefreshActor, "notableCombats:mage-block-id:base"));
    // The owner state changes after prompt validation, before the barrier action executes.
    await deleteMageBlockBarrier(getMageBlockBarrierEffect(staleRefreshActor, "notableCombats:mage-block-id:base"));
    staleRefreshRoll = await performNotableCombatRoll(options);
    return staleRefreshRoll;
  }
});
await new Promise((resolve) => setTimeout(resolve, 0));
jqueryValues.set('[name="mageBarrierAction"]', "refresh");
const staleRefreshDialog = mageDialogs.at(-1);
await staleRefreshDialog.config.buttons.find((button) => button.action === "roll").callback({}, null, staleRefreshDialog);
const staleRefreshResult = await staleRefreshPrompt;
assert.equal(staleRefreshResult.chainCancelled, true);
assert.equal(staleRefreshRoll.rolled, false);
assert.equal(staleRefreshRoll.mageBarrierActionResult.ok, false);
assert.equal(staleRefreshActor.system.stamina.value, 5, "failed Mage refresh refunds the captured authored cost");
assert.equal(getMageBlockBarrierEffect(staleRefreshActor, "notableCombats:mage-block-id:base"), null);
assert.equal(getMageBlockDuressEffect(staleRefreshActor, "notableCombats:mage-block-id:base"), null);
assert.equal((staleRefreshRoll.undoRecords || []).length, 0, "failed Mage refresh leaves no cost undo stranded on the result");
assert.equal(staleRefreshRoll.rollResult.chatMessage.getFlag("peasant-core", "rollUndo"), undefined,
  "failed Mage refresh does not attach an already-refunded cost undo to its roll card");

const useRollActor = await workflowMageActor("mage-defense-roll-use");
game.actors.set(useRollActor.id, useRollActor);
const useRollOutcome = await performNotableCombatRoll({
  actor: useRollActor,
  combatIndex: 0,
  promptForTargets: false,
  mageBarrierAction: "use",
  edgeChainContext: { chainId: "mage-defense-roll-use-chain" }
});
assert.equal(useRollOutcome.rolled, true);
assert.equal(useRollActor.system.stamina.value, 5, "using the current Mage Block barrier does not charge its authored resource tag");
assert.equal(getMageBlockBarrierHp(getMageBlockBarrierEffect(useRollActor, "notableCombats:mage-block-id:base")).value, 12);

const alternateRollActor = await workflowMageActor("mage-defense-roll-alternate");
alternateRollActor.system.notableCombats[0].usages = [{
  id: "alternate",
  name: "Alternate Mage Block",
  resolution: "targeted",
  mechanics: { defense: { responses: ["Melee"], block: true, blockType: "Mage", maxHp: 25 } },
  rollOverrides: {}
}];
await alternateRollActor.applyPeasantMageBlockBarrierAction({
  action: "create",
  selectedCombatId: "mage-block-id",
  selectedUsageId: "alternate"
});
await deleteMageBlockBarrier(getMageBlockBarrierEffect(alternateRollActor, "notableCombats:mage-block-id:base"));
alternateRollActor.consumePeasantEntryUses = async () => ({ ok: true, changed: false });
game.actors.set(alternateRollActor.id, alternateRollActor);
const { createPeasantEntryUsageContext } = await import("../module/applications/combat/skill-entry-use.mjs");
const { usageContext: alternateUsageContext } = await createPeasantEntryUsageContext({
  actor: alternateRollActor,
  ref: { collection: "notableCombats", entryId: "mage-block-id" },
  usageId: "alternate"
});
const alternateRollOutcome = await performNotableCombatRoll({
  actor: alternateRollActor,
  combatIndex: 0,
  promptForTargets: false,
  mageBarrierAction: "use",
  usageContext: alternateUsageContext,
  edgeChainContext: { chainId: "mage-defense-roll-alternate-chain" }
});
assert.equal(alternateRollOutcome.rolled, true, "an alternate Mage Block usage rolls with its own barrier");
assert.ok(getMageBlockBarrierEffect(alternateRollActor, "notableCombats:mage-block-id:alternate"));

const cancelledRollActor = await workflowMageActor("mage-defense-roll-cancelled");
game.actors.set(cancelledRollActor.id, cancelledRollActor);
rollDiceSets = [[2, 2]];
cancelForcePass = true;
const cancelledRollOutcome = await performNotableCombatRoll({
  actor: cancelledRollActor,
  combatIndex: 0,
  promptForTargets: false,
  mageBarrierAction: "refresh",
  rollOverrides: { toHit: 20, accuracy: 0 },
  edgeChainContext: { chainId: "mage-defense-roll-cancelled-chain" }
});
assert.equal(cancelledRollOutcome.chainCancelled, true);
assert.equal(cancelledRollActor.system.attunement.value, 5);
assert.equal(getMageBlockBarrierHp(getMageBlockBarrierEffect(cancelledRollActor, "notableCombats:mage-block-id:base")).value, 12,
  "a cancelled defense roll leaves the barrier Active Effect unchanged");

const declinedForcePassActor = await workflowMageActor("mage-defense-force-pass-declined");
game.actors.set(declinedForcePassActor.id, declinedForcePassActor);
rollDiceSets = [[2, 2]];
cancelForcePass = true;
const declinedForcePassOutcome = await performNotableCombatRoll({
  actor: declinedForcePassActor,
  combatIndex: 0,
  promptForTargets: false,
  cardClass: "pc-defense-roll-card",
  mageBarrierAction: "use",
  rollOverrides: { toHit: 20, accuracy: 0 },
  edgeChainContext: { chainId: "mage-defense-force-pass-declined-chain" }
});
assert.equal(declinedForcePassOutcome.rolled, true);
assert.notEqual(declinedForcePassOutcome.chainCancelled, true,
  "closing Force Pass on a failed defense must return the failure so the attack can continue");
assert.equal(declinedForcePassOutcome.rollResult.isSuccess, false);

for (const failure of ["ordinary", "critical"]) {
  for (const action of ["create", "refresh", "use"]) {
    const actor = await workflowMageActor(`mage-defense-${action}-${failure}-failure`);
    if (action === "create") {
      await deleteMageBlockBarrier(getMageBlockBarrierEffect(actor, "notableCombats:mage-block-id:base"));
    }
    game.actors.set(actor.id, actor);
    const { usageContext } = await createPeasantEntryUsageContext({
      actor,
      ref: { collection: "notableCombats", entryId: "mage-block-id" },
      usageId: "base"
    });
    rollDiceSets = [failure === "critical" ? [1, 1] : [2, 3]];
    cancelForcePass = failure === "ordinary";
    const outcome = await performNotableCombatRoll({
      actor,
      combatIndex: 0,
      usageContext,
      promptForTargets: false,
      cardClass: "pc-defense-roll-card",
      mageBarrierAction: action,
      rollOverrides: { toHit: 8, accuracy: 0 },
      edgeChainContext: { chainId: `${actor.id}-chain` }
    });
    assert.equal(outcome.rolled, true);
    assert.notEqual(outcome.chainCancelled, true, "a failed Mage defense still lets the attack continue");
    assert.equal(outcome.rollResult.isSuccess, false, `${failure} failure must exercise a failed skill roll`);
    assert.equal(outcome.rollResult.criticalType === "Critical Failure", failure === "critical");
    assert.equal(actor.system.stamina.value, action === "use" ? 5 : 2,
      `${action} on ${failure} failure keeps its authored resource cost; Use Current Barrier remains free`);
    assert.equal(actor.system.attunement.value, 5, "failed Mage Block adds no synthetic resource cost");
    if (action !== "use") {
      assert.equal((await applyRollUndoRecords(outcome.undoRecords)).ok, true);
      assert.equal(actor.system.stamina.value, 5, "explicit undo restores the failed roll's authored cost");
    }
  }
}

console.log("E5 Mage Block workflow tests passed.");
