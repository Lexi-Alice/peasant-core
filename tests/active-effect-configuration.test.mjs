import assert from "node:assert/strict";

let delegatedDurationPreparations = 0;
let delegatedUpdates = 0;
let promptConfig = null;
const deleteOperations = [];
globalThis.Actor = class {};
globalThis.Item = class {};
globalThis.ActiveEffect = class {
  static metadata = { label: "DOCUMENT.ActiveEffect" };

  _prepareCombatBasedDuration(duration) {
    delegatedDurationPreparations += 1;
    return Object.assign(duration, { remaining: -1, label: "delegated" });
  }

  async deleteDialog() {
    return null;
  }

  async delete(operation) {
    deleteOperations.push(operation);
    return this;
  }

  async _preUpdate() {
    delegatedUpdates += 1;
    return true;
  }
};
globalThis.foundry = {
  applications: {
    api: {
      DialogV2: {
        async prompt(config) {
          promptConfig = config;
          return config.ok.callback();
        }
      }
    }
  },
  data: {
    ActiveEffectTypeDataModel: class {
      static defineSchema() { return {}; }
      static migrateData(source) { return source; }
    },
    fields: {
      ArrayField: class {
        constructor(element, options = {}) {
          this.element = element;
          this.options = options;
        }
      },
      NumberField: class {},
      SchemaField: class {},
      StringField: class {}
    }
  }
};
globalThis.CONFIG = {
  ActiveEffect: {
    dataModels: { base: "base-model" },
    documentClass: ActiveEffect,
    typeLabels: { base: "Base" },
    expiryAction: "update"
  },
  time: { roundTime: 6, turnTime: 0 }
};
globalThis.game = {
  i18n: {
    format: (key, data) => {
      if (key === "DOCUMENT.Delete") return `Delete ${data.type}`;
      if (key === "SIDEBAR.DeleteWarning") {
        return `This ${data.type} will be permanently deleted and cannot be recovered.`;
      }
      return `${data.rounds ?? data.turns} ${key.includes("ROUNDS") ? "rounds" : "turns"}`;
    },
    localize: (key) => key === "COMMON.AreYouSure" ? "Are You Sure?" : "Active Effect",
    pluralRules: { select: (value) => value === 1 ? "one" : "other" }
  },
  time: { worldTime: 60 }
};

const activeEffectModule = await import("../module/data/active-effect/_module.mjs");
assert.equal(typeof activeEffectModule.configurePeasantActiveEffects, "function");

activeEffectModule.configurePeasantActiveEffects();

assert.equal(CONFIG.ActiveEffect.expiryAction, "delete");
assert.equal(CONFIG.ActiveEffect.documentClass, activeEffectModule.PeasantActiveEffect);
assert.equal(CONFIG.ActiveEffect.dataModels.base, "base-model");
assert.equal(CONFIG.ActiveEffect.dataModels.spellEffect, activeEffectModule.PeasantSpellActiveEffectModel);
assert.equal(CONFIG.ActiveEffect.typeLabels.base, "Base");
assert.equal(CONFIG.ActiveEffect.typeLabels.spellEffect, "TYPES.ActiveEffect.spellEffect");

const definitionEffect = Object.assign(Object.create(activeEffectModule.PeasantActiveEffect.prototype), {
  flags: { "peasant-core": { skillEditorDefinition: true } }
});
assert.equal(
  await definitionEffect._preUpdate({ disabled: false }, {}, "user"),
  false,
  "A generic Active Effect update cannot enable a Skill/Notable definition"
);
assert.equal(delegatedUpdates, 0);
const ordinaryEffect = Object.create(activeEffectModule.PeasantActiveEffect.prototype);
assert.equal(await ordinaryEffect._preUpdate({ disabled: false }, {}, "user"), true);
assert.equal(delegatedUpdates, 1, "Ordinary Active Effects retain Foundry's normal update path");

const spellEffectSchema = activeEffectModule.PeasantSpellActiveEffectModel.defineSchema();
assert.ok(spellEffectSchema.encounterId, "Spell Effects should retain internal encounter bookkeeping");
for (const removedField of ["buffCategory", "manifestType", "magicalHp", "haltValues"]) {
  assert.equal(spellEffectSchema[removedField], undefined, `${removedField} should be represented by native Changes rows`);
}

const migratedSpellSystem = activeEffectModule.PeasantSpellActiveEffectModel.migrateData({
  changes: [{ key: "system.combatMods.accuracy", type: "add", value: 1, phase: "initial", priority: 20 }],
  buffCategory: "aura",
  manifestKind: "dome",
  magicalHp: { value: 6, max: 40 },
  encounterId: "combat"
});
assert.equal(migratedSpellSystem.manifestKind, undefined);
assert.equal(migratedSpellSystem.magicalHp, undefined);
assert.equal(migratedSpellSystem.encounterId, "combat");
assert.deepEqual(
  migratedSpellSystem.changes.slice(0, 5).map(({ key, type, value }) => ({ key, type, value })),
  [
    { key: "effect.system.buffCategory", type: "custom", value: "aura" },
    { key: "effect.system.manifestType", type: "custom", value: "dome" },
    { key: "effect.system.magicalHp.value", type: "add", value: 6 },
    { key: "effect.system.magicalHp.max", type: "override", value: 40 },
    { key: "effect.system.magnetismGrade", type: "add", value: 1 }
  ],
  "Legacy fields should migrate before strict type-data cleaning can prune them"
);
assert.equal(migratedSpellSystem.changes.at(-1).key, "system.combatMods.accuracy");

const pendingEffect = Object.assign(Object.create(activeEffectModule.PeasantActiveEffect.prototype), {
  _source: { start: { combat: null } },
  name: "Manifest Dome",
  parent: new Actor(),
  start: { combat: null, time: 0 }
});
assert.deepEqual(
  pendingEffect._prepareCombatBasedDuration({ value: 3, units: "rounds", expired: false }),
  {
    value: 3,
    units: "rounds",
    expired: false,
    seconds: 18,
    remaining: 3,
    secondsRemaining: 18,
    label: "3 rounds"
  }
);
assert.equal(delegatedDurationPreparations, 0);

pendingEffect.start.combat = "combat";
assert.equal(
  pendingEffect._prepareCombatBasedDuration({ value: 3, units: "rounds", expired: false }).label,
  "delegated"
);
pendingEffect.start.combat = null;
assert.equal(
  pendingEffect._prepareCombatBasedDuration({ value: 3, units: "rounds", expired: true }).label,
  "delegated"
);
assert.equal(
  pendingEffect._prepareCombatBasedDuration({ value: 0, units: "rounds", expired: false }).label,
  "delegated"
);

pendingEffect._source.start.combat = "previous-combat";
assert.equal(
  pendingEffect._prepareCombatBasedDuration({ value: 3, units: "rounds", expired: false }).label,
  "delegated"
);
pendingEffect._source.start.combat = null;
pendingEffect.parent = new Item();
assert.equal(
  pendingEffect._prepareCombatBasedDuration({ value: 3, units: "rounds", expired: false }).label,
  "delegated"
);
assert.equal(delegatedDurationPreparations, 5);

const deleteOperation = { render: false };
const deleteResult = await pendingEffect.deleteDialog({}, deleteOperation);
assert.equal(promptConfig?.ok?.label, "SIDEBAR.Delete", "Active Effect deletion should use one Delete button");
assert.equal(promptConfig?.ok?.icon, "fa-solid fa-trash");
assert.equal(promptConfig?.no, undefined);
assert.deepEqual(deleteOperations, [deleteOperation]);
assert.equal(deleteResult, pendingEffect);

delete globalThis.CONFIG;
delete globalThis.foundry;
delete globalThis.game;
delete globalThis.ActiveEffect;
delete globalThis.Actor;
delete globalThis.Item;

console.log("active effect configuration tests passed");
