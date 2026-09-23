import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    deepClone: structuredClone,
    randomID: () => "undo-id"
  }
};
globalThis.game = {
  user: { id: "user", isGM: true },
  actors: new Map()
};
globalThis.fromUuid = async (uuid) => Array.from(game.actors.values()).find((actor) => actor.uuid === uuid) || null;

const {
  applyRollUndoRecords,
  canUndoRecord,
  captureActorRollUndo
} = await import("../module/applications/chat-undo.mjs");
const {
  MANIFEST_SPELL_EFFECT_CHANGE_KEYS,
  buildManifestSpellEffectChanges,
  getManifestSpellEffectState
} = await import("../module/data/active-effect/spell-effect-change-keys.mjs");

function setPath(root, path, value) {
  const parts = path.split(".");
  let current = root;
  for (const part of parts.slice(0, -1)) current = current[part] ??= {};
  current[parts.at(-1)] = structuredClone(value);
}

function createEffect(actor, source) {
  const effect = {
    id: source._id,
    _id: source._id,
    type: source.type,
    flags: structuredClone(source.flags || {}),
    parent: actor,
    _source: structuredClone(source),
    toObject() {
      return structuredClone(effect._source);
    }
  };
  return effect;
}

function createActor(id) {
  const actor = {
    id,
    uuid: `Actor.${id}`,
    name: id,
    system: { _source: { health: { value: 10 } } },
    effects: [],
    async update(update) {
      for (const [path, value] of Object.entries(update)) {
        const systemPath = path.startsWith("system.") ? path.slice(7) : path;
        setPath(actor.system._source, systemPath, value);
      }
    },
    async createEmbeddedDocuments(_type, sources) {
      const created = sources.map((source) => createEffect(actor, source));
      actor.effects.push(...created);
      return created;
    },
    async updateEmbeddedDocuments(_type, updates) {
      for (const update of updates) {
        const id = update._id;
        const index = actor.effects.findIndex((effect) => effect.id === id);
        if (index >= 0) actor.effects[index] = createEffect(actor, structuredClone(update));
      }
      return updates;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      actor.effects = actor.effects.filter((effect) => !ids.includes(effect.id));
      return ids;
    },
    canUserModify() {
      return true;
    }
  };
  game.actors.set(id, actor);
  return actor;
}

function spellSource(id, {
  name = "Manifest Dome",
  manifestType = "dome",
  category = "aura",
  value = 5,
  max = 10,
  changes = [],
  duration = { value: 3, units: "rounds", expired: false }
} = {}) {
  const manifestChanges = manifestType
    ? buildManifestSpellEffectChanges({ manifestType, hp: { value, max } })
    : [
      { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.buffCategory, mode: 0, value: category, priority: 20 },
      { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.manifestType, mode: 0, value: "", priority: 20 },
      { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp, mode: 2, value, priority: 20 },
      { key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.maximumHp, mode: 5, value: max, priority: 20 }
    ];
  return {
    _id: id,
    name,
    type: "spellEffect",
    img: "spell.png",
    disabled: false,
    changes: [...manifestChanges, ...changes],
    duration,
    system: { encounterId: "combat" }
  };
}

const createdActor = createActor("created");
const creation = await captureActorRollUndo(
  createdActor,
  "Create Dome",
  () => createdActor.createEmbeddedDocuments("ActiveEffect", [spellSource("created-dome")]),
  { includeSpellEffects: true }
);
assert.equal(creation.undoRecords.length, 1, "Creating a Spell Effect should produce undo data");
assert.deepEqual(creation.undoRecords[0].spellEffects.before, []);
assert.equal(creation.undoRecords[0].spellEffects.after[0]._id, "created-dome");
await applyRollUndoRecords(creation.undoRecords);
assert.deepEqual(createdActor.effects, [], "Undo should delete a newly created Spell Effect");

const recastActor = createActor("recast");
recastActor.effects.push(createEffect(recastActor, spellSource("recast-dome", { value: 5 })));
const recast = await captureActorRollUndo(
  recastActor,
  "Recast Dome",
  () => recastActor.updateEmbeddedDocuments("ActiveEffect", [spellSource("recast-dome", { value: 9, max: 14 })]),
  { includeSpellEffects: true }
);
await applyRollUndoRecords(recast.undoRecords);
assert.deepEqual(getManifestSpellEffectState(recastActor.effects[0]._source).magicalHp, { value: 5, max: 10 });

const replacementActor = createActor("replacement");
replacementActor.effects.push(createEffect(replacementActor, spellSource("slot", {
  name: "Old Armor Buff",
  manifestType: "",
  category: "armor",
  value: 0,
  max: 0,
  changes: [{ key: "old", mode: 2, value: 4 }],
  duration: { value: null, units: "rounds", expired: false }
})));
const replacement = await captureActorRollUndo(
  replacementActor,
  "Replace Armor Buff",
  () => replacementActor.updateEmbeddedDocuments("ActiveEffect", [spellSource("slot", {
    name: "Manifest Resistance",
    manifestType: "resistance",
    category: "armor",
    changes: [{ key: "system.naturalHaltValues.head", mode: 2, value: 1 }]
  })]),
  { includeSpellEffects: true }
);
await applyRollUndoRecords(replacement.undoRecords);
assert.equal(replacementActor.effects[0]._source.name, "Old Armor Buff");
assert.equal(
  replacementActor.effects[0]._source.changes.some((change) => change.key === "old" && change.value === 4),
  true
);
assert.equal(getManifestSpellEffectState(replacementActor.effects[0]._source).manifestType, "");
assert.deepEqual(replacementActor.effects[0]._source.duration, { value: null, units: "rounds", expired: false });

const depletedActor = createActor("depleted");
depletedActor.effects.push(createEffect(depletedActor, spellSource("depleted-dome", { value: 2 })));
const depletion = await captureActorRollUndo(
  depletedActor,
  "Deplete Dome",
  () => depletedActor.deleteEmbeddedDocuments("ActiveEffect", ["depleted-dome"]),
  { includeSpellEffects: true }
);
await applyRollUndoRecords(depletion.undoRecords);
assert.equal(depletedActor.effects[0].id, "depleted-dome");
assert.equal(getManifestSpellEffectState(depletedActor.effects[0]._source).magicalHp.value, 2);

const mixedActor = createActor("mixed");
mixedActor.effects.push(createEffect(mixedActor, spellSource("mixed-dome", { value: 6 })));
const mixed = await captureActorRollUndo(
  mixedActor,
  "Mixed Damage",
  async () => {
    await mixedActor.update({ "system.health.value": 4 });
    await mixedActor.updateEmbeddedDocuments("ActiveEffect", [spellSource("mixed-dome", { value: 1 })]);
  },
  { includeSpellEffects: true }
);
await applyRollUndoRecords(mixed.undoRecords);
assert.equal(mixedActor.system._source.health.value, 10);
assert.equal(getManifestSpellEffectState(mixedActor.effects[0]._source).magicalHp.value, 6);

const unchangedActor = createActor("unchanged");
unchangedActor.effects.push(createEffect(unchangedActor, spellSource("unchanged-dome")));
const unchanged = await captureActorRollUndo(
  unchangedActor,
  "No Changes",
  async () => true,
  { includeSpellEffects: true }
);
assert.deepEqual(unchanged.undoRecords, []);

const unrelatedActor = createActor("unrelated");
unrelatedActor.effects.push(createEffect(unrelatedActor, spellSource("changed", { value: 5 })));
const changed = await captureActorRollUndo(
  unrelatedActor,
  "Change One",
  () => unrelatedActor.updateEmbeddedDocuments("ActiveEffect", [spellSource("changed", { value: 1 })]),
  { includeSpellEffects: true }
);
unrelatedActor.effects.push(createEffect(unrelatedActor, spellSource("unrelated", { value: 7 })));
await applyRollUndoRecords(changed.undoRecords);
assert.equal(getManifestSpellEffectState(unrelatedActor.effects.find((effect) => effect.id === "changed")._source).magicalHp.value, 5);
assert.equal(getManifestSpellEffectState(unrelatedActor.effects.find((effect) => effect.id === "unrelated")._source).magicalHp.value, 7);

function guardBrokenSource(id, duration = { value: 1, units: "rounds", expiry: "roundEnd", expired: false }) {
  return {
    _id: id,
    name: "Guard-Broken",
    type: "skill",
    disabled: false,
    start: { combat: "combat", round: 3, turn: 1, time: 100 },
    duration,
    flags: { "peasant-core": { guardBroken: true } },
    changes: []
  };
}

const guardCreatedActor = createActor("guard-created");
const guardCreation = await captureActorRollUndo(
  guardCreatedActor,
  "Apply Guard-Broken",
  () => guardCreatedActor.createEmbeddedDocuments("ActiveEffect", [guardBrokenSource("guard-created-effect")]),
  { includeSpellEffects: true }
);
assert.equal(guardCreation.undoRecords.length, 1, "Guard-Broken creation shares the existing Active Effect undo snapshot");
assert.equal(guardCreation.undoRecords[0].spellEffects.after[0].flags["peasant-core"].guardBroken, true);
await applyRollUndoRecords(guardCreation.undoRecords);
assert.equal(guardCreatedActor.effects.length, 0, "undo removes a newly created Guard-Broken effect");

const guardRestartedActor = createActor("guard-restarted");
guardRestartedActor.effects.push(createEffect(guardRestartedActor, guardBrokenSource("guard-restarted-effect", {
  value: 1,
  units: "rounds",
  expiry: "roundEnd",
  expired: true
})));
const guardRestart = await captureActorRollUndo(
  guardRestartedActor,
  "Refresh Guard-Broken",
  () => guardRestartedActor.updateEmbeddedDocuments("ActiveEffect", [guardBrokenSource("guard-restarted-effect")]),
  { includeSpellEffects: true }
);
assert.equal(guardRestart.undoRecords.length, 1, "restarting Guard-Broken is captured even though its type is skill");
await applyRollUndoRecords(guardRestart.undoRecords);
assert.equal(guardRestartedActor.effects[0]._source.duration.expired, true, "undo restores the prior expired Guard-Broken duration");

function skillSource(id, { generated = false, value = 1 } = {}) {
  return {
    _id: id,
    name: generated ? "Staunched" : "Ordinary Skill Effect",
    type: "skill",
    disabled: false,
    changes: [{ key: "system.health.max", mode: 2, value }],
    flags: generated ? { "peasant-core": { skillUseOrigin: { operationId: "operation-1", linkId: "link-1" } } } : {}
  };
}

const skillActor = createActor("skill-offer");
skillActor.effects.push(createEffect(skillActor, skillSource("ordinary")));
const skillCreation = await captureActorRollUndo(
  skillActor,
  "Apply Skill Offer",
  () => skillActor.createEmbeddedDocuments("ActiveEffect", [skillSource("generated", { generated: true })]),
  { includeSkillEffects: true }
);
assert.equal(skillCreation.undoRecords.length, 1, "Generated Skill effects produce an undo record without system changes");
assert.deepEqual(skillCreation.undoRecords[0].before, {});
assert.deepEqual(skillCreation.undoRecords[0].skillEffects.before, []);
assert.equal(skillCreation.undoRecords[0].skillEffects.after[0]._id, "generated");
assert.equal(canUndoRecord(skillCreation.undoRecords[0]), true);
await applyRollUndoRecords(skillCreation.undoRecords);
assert.deepEqual(skillActor.effects.map(effect => effect.id), ["ordinary"], "Undo removes only the generated Skill effect");

const skillRefreshActor = createActor("skill-refresh");
skillRefreshActor.effects.push(createEffect(skillRefreshActor, skillSource("generated", { generated: true })));
const skillRefresh = await captureActorRollUndo(
  skillRefreshActor,
  "Refresh Skill Effect",
  () => skillRefreshActor.updateEmbeddedDocuments("ActiveEffect", [skillSource("generated", { generated: true, value: 4 })]),
  { includeSkillEffects: true }
);
assert.equal(skillRefresh.undoRecords[0].skillEffects.before[0].changes[0].value, 1);
await applyRollUndoRecords(skillRefresh.undoRecords);
assert.equal(skillRefreshActor.effects[0]._source.changes[0].value, 1, "Undo restores the previous generated Skill effect");

const unmarkedActor = createActor("unmarked-skill");
const unmarked = await captureActorRollUndo(
  unmarkedActor,
  "Add Ordinary Skill Effect",
  () => unmarkedActor.createEmbeddedDocuments("ActiveEffect", [skillSource("unmarked")]),
  { includeSkillEffects: true }
);
assert.deepEqual(unmarked.undoRecords, [], "Ordinary Skill effects are outside generated Skill-effect undo capture");

const counterActor = createActor("counter-routing");
counterActor.system._source.skills = [{
  id: "counter-skill",
  sharedTagTypes: ["speed"],
  speed: { type: "Split Second", splitSecondCurrent: 2, splitSecondMax: 3 },
  tagUses: { current: 2, max: 3 },
  usages: [{
    id: "alternate",
    replaceSharedTagTypes: [],
    counterScopes: { tagUses: "shared", sections: "shared" },
    mechanics: { speed: { type: "Split Second", splitSecondCurrent: 1, splitSecondMax: 3 } }
  }]
}];
const counterRef = [{ collection: "skills", entryId: "counter-skill", usageId: "alternate" }];
const speedCapture = await captureActorRollUndo(counterActor, "Speed", async () => {
  counterActor.system._source.skills[0].usages[0].mechanics.speed.splitSecondCurrent = 0;
}, { entryCounterRefs: counterRef });
assert.equal(speedCapture.undoRecords[0]?.entryCounters?.find(row => row.path === "speed.splitSecondCurrent")?.usageId,
  "alternate", "Split Second undo belongs to the selected usage");
const usesCapture = await captureActorRollUndo(counterActor, "Uses", async () => {
  counterActor.system._source.skills[0].tagUses.current = 1;
}, { entryCounterRefs: counterRef });
assert.equal(usesCapture.undoRecords[0]?.entryCounters?.find(row => row.path === "tagUses.current")?.usageId,
  "base", "Shared Uses undo still belongs to the base pool");

delete globalThis.foundry;
delete globalThis.game;
delete globalThis.fromUuid;

console.log("chat undo spell effect tests passed");
