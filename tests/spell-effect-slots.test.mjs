import assert from "node:assert/strict";

globalThis.CONST = {
  ACTIVE_EFFECT_MODES: { CUSTOM: 0, ADD: 2, OVERRIDE: 5 },
  ACTIVE_EFFECT_SHOW_ICON: { ALWAYS: 2 }
};
globalThis.CONFIG = {
  ActiveEffect: { documentClass: { DEFAULT_ICON: "icons/svg/aura.svg" } }
};
globalThis.ActiveEffect = {
  implementation: {
    getEffectStart: (combat) => ({
      combat: combat?.id || null,
      combatant: null,
      initiative: null,
      round: combat?.round ?? null,
      time: 100,
      turn: combat?.turn ?? null
    })
  }
};
globalThis.game = { combat: null, combats: [] };
globalThis.ui = { notifications: { warn() {} } };

const {
  applyManifestSpellEffectToActor,
  absorbActorSpellEffect,
  buildManifestSpellEffectSource,
  enableSpellEffectWithCategoryResolution,
  getManifestSpellEncounterData,
  getManifestSpellSlotAction,
  validateSpellEffectSlotWrite
} = await import("../module/data/active-effect/spell-effects.mjs");
const {
  MANIFEST_SPELL_EFFECT_CHANGE_KEYS,
  getManifestSpellEffectState
} = await import("../module/data/active-effect/spell-effect-change-keys.mjs");

function applySource(effect, source) {
  const id = effect.id;
  for (const key of Object.keys(effect)) {
    if (!["id", "parent", "update", "delete", "toObject"].includes(key)) delete effect[key];
  }
  Object.assign(effect, structuredClone(source), { id, _id: id });
  effect.toObject = () => structuredClone({ ...source, _id: id });
}

function createActor(id = "target") {
  const actor = {
    id,
    uuid: `Actor.${id}`,
    name: id,
    img: `${id}.png`,
    effects: [],
    async createEmbeddedDocuments(_type, sources, options = {}) {
      options.parent = actor;
      const created = sources.map((source, index) => createEffect(actor, source, `${id}-effect-${index + 1}`));
      actor.effects.push(...created);
      return created;
    },
    async updateEmbeddedDocuments(_type, updates) {
      for (const update of updates) {
        const effect = actor.effects.find((entry) => entry.id === update._id);
        if (effect) await effect.update(update);
      }
      return updates;
    }
  };
  return actor;
}

function createEffect(actor, source, id) {
  const effect = {
    id,
    _id: id,
    parent: actor,
    ...structuredClone(source),
    async update(update) {
      if (Object.keys(update).some((key) => key.includes("."))) {
        if ("system.changes" in update) effect.system.changes = structuredClone(update["system.changes"]);
        if ("disabled" in update) effect.disabled = update.disabled;
      } else if (Object.keys(update).every((key) => ["changes"].includes(key))) {
        effect.changes = structuredClone(update.changes);
      } else if (Object.keys(update).every((key) => ["_id", "disabled"].includes(key))) {
        if ("disabled" in update) effect.disabled = update.disabled;
      } else {
        applySource(effect, update);
      }
      return effect;
    },
    async delete() {
      actor.effects = actor.effects.filter((entry) => entry !== effect);
      return effect;
    },
    toObject() {
      return structuredClone({ ...source, _id: id });
    }
  };
  return effect;
}

const pendingSource = buildManifestSpellEffectSource({
  actor: createActor("source-target"),
  casterUuid: "Actor.caster",
  manifestType: "dome",
  hp: { value: 8, max: 20 },
  duration: 5,
  img: "spell.png"
});
assert.equal(pendingSource.type, "spellEffect");
assert.equal(pendingSource.showIcon, 2);
assert.deepEqual(getManifestSpellEffectState(pendingSource), {
  buffCategory: "aura",
  manifestType: "dome",
  magicalHp: { value: 8, max: 20 },
  magnetismGrade: 1
});
assert.equal(pendingSource.system.encounterId, "");
assert.deepEqual(pendingSource.duration, { value: null, units: "rounds", expiry: null, expired: false });
assert.equal(pendingSource.flags["peasant-core"].manifestDuration, 5);
assert.equal(pendingSource.system.changes.length, 5);

const resistanceSource = buildManifestSpellEffectSource({
  actor: createActor("resistance-target"),
  casterUuid: "Actor.caster",
  manifestType: "resistance",
  hp: { value: 5, max: 12 }
});
assert.deepEqual(resistanceSource.duration, { value: null, units: "rounds", expiry: null, expired: false });
assert.deepEqual(
  resistanceSource.system.changes.slice(4).map(({ key, type, value }) => ({ key, type, value })),
  ["head", "arms", "legs", "torso"].map((location) => ({
    key: `system.naturalHaltValues.${location}`,
    type: "add",
    value: 1
  }))
);
assert.deepEqual(getManifestSpellEffectState(resistanceSource).magicalHp, { value: 5, max: 12 });

const customResistanceSource = buildManifestSpellEffectSource({
  actor: createActor("custom-resistance-target"),
  casterUuid: "Actor.caster",
  manifestType: "resistance",
  hp: { value: 5, max: 12 },
  haltValues: [2, 1, 3, 0]
});
assert.deepEqual(
  customResistanceSource.system.changes.slice(4).map(({ key, type, value }) => ({ key, type, value })),
  [
    { key: "system.naturalHaltValues.head", type: "add", value: 2 },
    { key: "system.naturalHaltValues.arms", type: "add", value: 1 },
    { key: "system.naturalHaltValues.legs", type: "add", value: 3 },
    { key: "system.naturalHaltValues.torso", type: "add", value: 0 }
  ]
);

const emptyActor = createActor("empty");
assert.equal(getManifestSpellSlotAction(emptyActor, { manifestType: "dome" }).action, "create");
const createdResult = await applyManifestSpellEffectToActor(emptyActor, {
  manifestType: "dome",
  rollTotal: 8,
  maximized: 10,
  casterUuid: "Actor.caster",
  img: "dome.png"
});
assert.equal(createdResult.applied, true);
assert.equal(createdResult.action, "created");
assert.equal(emptyActor.effects.length, 1);
assert.deepEqual(getManifestSpellEffectState(emptyActor.effects[0]).magicalHp, { value: 8, max: 20 });

const recastId = emptyActor.effects[0].id;
const recastResult = await applyManifestSpellEffectToActor(emptyActor, {
  manifestType: "dome",
  rollTotal: 7,
  maximized: 8,
  casterUuid: "Actor.caster"
});
assert.equal(recastResult.action, "recast");
assert.equal(emptyActor.effects[0].id, recastId);
assert.deepEqual(getManifestSpellEffectState(emptyActor.effects[0]).magicalHp, { value: 15, max: 16 });

const cappedRecastResult = await applyManifestSpellEffectToActor(emptyActor, {
  manifestType: "dome",
  rollTotal: 10,
  maximized: 8,
  casterUuid: "Actor.caster"
});
assert.equal(cappedRecastResult.gain, 1);
assert.deepEqual(getManifestSpellEffectState(emptyActor.effects[0]).magicalHp, { value: 16, max: 16 });

const otherArmorSource = {
  ...pendingSource,
  name: "Other Armor Buff",
  system: {
    ...pendingSource.system,
    changes: pendingSource.system.changes.map((change) => {
      if (change.key === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.buffCategory) return { ...change, value: "armor" };
      if (change.key === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.manifestType) return { ...change, value: "" };
      return change;
    })
  }
};
const replacementActor = createActor("replacement");
replacementActor.effects.push(createEffect(replacementActor, otherArmorSource, "armor-occupant"));
const incumbentId = replacementActor.effects[0].id;
const replacementResult = await applyManifestSpellEffectToActor(replacementActor, {
  manifestType: "resistance",
  rollTotal: 9,
  maximized: 12,
  casterUuid: "Actor.caster",
  expectedOccupantId: incumbentId,
  replacementApproved: true
});
assert.equal(replacementResult.action, "replaced");
assert.equal(replacementActor.effects[0].id, incumbentId);
assert.equal(getManifestSpellEffectState(replacementActor.effects[0]).manifestType, "resistance");
assert.deepEqual(getManifestSpellEffectState(replacementActor.effects[0]).magicalHp, { value: 4, max: 12 });
assert.equal(replacementActor.effects[0].duration.value, null);

const unapprovedActor = createActor("unapproved");
unapprovedActor.effects.push(createEffect(unapprovedActor, otherArmorSource, "occupant"));
const unapproved = await applyManifestSpellEffectToActor(unapprovedActor, {
  manifestType: "resistance",
  rollTotal: 8,
  maximized: 10
});
assert.equal(unapproved.applied, false);
assert.equal(unapproved.reason, "replacementNotApproved");
assert.equal(getManifestSpellEffectState(unapprovedActor.effects[0]).manifestType, "");

const stale = await applyManifestSpellEffectToActor(unapprovedActor, {
  manifestType: "resistance",
  rollTotal: 8,
  maximized: 10,
  expectedOccupantId: "old-occupant",
  replacementApproved: true
});
assert.equal(stale.applied, false);
assert.equal(stale.reason, "slotChanged");

const unsupported = await applyManifestSpellEffectToActor(createActor("unsupported"), {
  manifestType: "unknown",
  rollTotal: 8,
  maximized: 10
});
assert.equal(unsupported.applied, false);
assert.equal(unsupported.reason, "unsupportedManifestType");

const depletionActor = createActor("depletion");
depletionActor.effects.push(createEffect(depletionActor, resistanceSource, "resistance"));
const depletion = await absorbActorSpellEffect(depletionActor, {
  manifestType: "resistance",
  damage: 5,
  damageType: "critical"
});
assert.equal(depletion.depleted, true);
assert.equal(depletion.penetration, 0);
assert.equal(depletion.damageType, "critical");
assert.equal(depletionActor.effects.length, 0);

const currentCombat = {
  id: "combat-b",
  started: true,
  round: 2,
  turn: 1,
  combatants: [{ actorId: "encounter-target" }]
};
const lowerIdCombat = {
  id: "combat-a",
  started: true,
  round: 1,
  turn: 0,
  combatants: [{ actorId: "encounter-target" }]
};
const encounterActor = createActor("encounter-target");
game.combat = currentCombat;
game.combats = [lowerIdCombat, currentCombat];
const currentEncounter = getManifestSpellEncounterData(encounterActor, "dome");
assert.equal(currentEncounter.encounterId, "combat-b");
assert.deepEqual(currentEncounter.duration, {
  value: 3,
  units: "rounds",
  expiry: "roundEnd",
  expired: false
});
assert.deepEqual(getManifestSpellEncounterData(encounterActor, "resistance").duration, {
  value: null,
  units: "rounds",
  expiry: "combatEnd",
  expired: false
});
const activeDurationActor = createActor("active-duration");
currentCombat.combatants.push({ actorId: activeDurationActor.id });
await applyManifestSpellEffectToActor(activeDurationActor, {
  manifestType: "dome",
  rollTotal: 4,
  maximized: 10
});
assert.deepEqual(activeDurationActor.effects[0].duration, {
  value: 3,
  units: "rounds",
  expiry: "roundEnd",
  expired: false
});
activeDurationActor.effects[0].duration.expiry = "roundStart";
await applyManifestSpellEffectToActor(activeDurationActor, {
  manifestType: "dome",
  rollTotal: 4,
  maximized: 10
});
assert.equal(activeDurationActor.effects[0].duration.expiry, "roundEnd");
await applyManifestSpellEffectToActor(activeDurationActor, {
  manifestType: "resistance",
  rollTotal: 4,
  maximized: 10
});
assert.deepEqual(activeDurationActor.effects[1].duration, {
  value: null,
  units: "rounds",
  expiry: "combatEnd",
  expired: false
});
activeDurationActor.effects[1].duration.expiry = null;
await applyManifestSpellEffectToActor(activeDurationActor, {
  manifestType: "resistance",
  rollTotal: 4,
  maximized: 10
});
assert.equal(activeDurationActor.effects[1].duration.expiry, "combatEnd");
game.combat = null;
assert.equal(getManifestSpellEncounterData(encounterActor, "dome").encounterId, "combat-a");
assert.deepEqual(getManifestSpellEncounterData(createActor("pending"), "dome").duration, {
  value: null,
  units: "rounds",
  expiry: null,
  expired: false
});

const manualActor = createActor("manual");
const activeManual = createEffect(manualActor, pendingSource, "active-manual");
const disabledManual = createEffect(manualActor, {
  ...pendingSource,
  disabled: true,
  name: "Disabled Dome"
}, "disabled-manual");
manualActor.effects.push(activeManual, disabledManual);
assert.equal(
  await enableSpellEffectWithCategoryResolution(disabledManual, { confirmReplacement: async () => false }),
  false
);
assert.equal(activeManual.disabled, false);
assert.equal(disabledManual.disabled, true);
assert.equal(
  await enableSpellEffectWithCategoryResolution(disabledManual, { confirmReplacement: async () => true }),
  true
);
assert.equal(activeManual.disabled, true);
assert.equal(disabledManual.disabled, false);

const duplicateActor = createActor("duplicate");
duplicateActor.effects.push(createEffect(duplicateActor, pendingSource, "duplicate-existing"));
const duplicateCandidate = createEffect(duplicateActor, { ...pendingSource, disabled: false }, "duplicate-new");
assert.equal(validateSpellEffectSlotWrite(duplicateCandidate, {}, {}), false);
assert.equal(validateSpellEffectSlotWrite(duplicateCandidate, {}, { peasantCoreSpellEffectWrite: true }), true);
assert.equal(validateSpellEffectSlotWrite(duplicateCandidate, { disabled: true }, {}), true);

const invalidModeActor = createActor("invalid-mode");
const invalidModeSource = structuredClone(pendingSource);
invalidModeSource.system.changes.find((change) => (
  change.key === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.buffCategory
)).type = "add";
const invalidModeEffect = createEffect(invalidModeActor, invalidModeSource, "invalid-mode-effect");
assert.equal(
  validateSpellEffectSlotWrite(invalidModeEffect, {}, {}),
  false,
  "Buff Category and Manifest Type rows must use Custom mode"
);

const duplicateHpSource = structuredClone(pendingSource);
duplicateHpSource.system.changes.push({
  key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp,
  type: "add",
  value: 1,
  priority: 30
});
assert.equal(
  validateSpellEffectSlotWrite(createEffect(createActor("duplicate-hp"), duplicateHpSource, "duplicate-hp-effect"), {}, {}),
  false,
  "Mutable current HP must remain a single canonical row"
);

const nativeUpdateActor = createActor("native-update");
const nativeUpdateEffect = createEffect(nativeUpdateActor, pendingSource, "native-update-effect");
const nativeInvalidChanges = structuredClone(pendingSource.system.changes);
nativeInvalidChanges.find((change) => (
  change.key === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.manifestType
)).type = "add";
assert.equal(
  validateSpellEffectSlotWrite(nativeUpdateEffect, { system: { changes: nativeInvalidChanges } }, {}),
  false,
  "Validation should inspect Foundry v14's native system.changes update path"
);

delete globalThis.CONST;
delete globalThis.CONFIG;
delete globalThis.ActiveEffect;
delete globalThis.game;
delete globalThis.ui;

console.log("spell effect slot tests passed");
