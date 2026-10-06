import assert from "node:assert/strict";

import {
  collectPeasantActiveEffectKeys,
  isPeasantActiveEffectFoundryDynamicKey,
  isPeasantActiveEffectKeyDisplayed,
  isPeasantActiveEffectStateKey,
  isPeasantActiveEffectUnsupportedKey,
  isPeasantActiveEffectVirtualDynamicKey
} from "../module/data/active-effect/key-policy.mjs";
import { MANIFEST_SPELL_EFFECT_CHANGE_KEYS } from "../module/data/active-effect/spell-effect-change-keys.mjs";

const hiddenKeys = [
  "system.editMode",
  "system.portraitScale",
  "system.edgeLabelMode",
  "system.edgeCustomLabel",
  "system.inventory",
  "system.description",
  "system.hp.rows",
  "system.hp.cols",
  "system.devastatingWounds",
  "system.fallBlessingUses.value",
  "system.fallBlessingUses.max",
  "system.category",
  "system.quality",
  "system.magicType",
  "system.quantity",
  "system.value",
  "system.equipped",
  "system.consumed"
];

for (const key of hiddenKeys) {
  assert.equal(isPeasantActiveEffectKeyDisplayed(key), false, `The picker should hide ${key}`);
}

for (const key of [
  "system.majorHeraldry",
  "system.customMajorHeraldry",
  "system.minorHeraldry",
  "system.customMinorHeraldry",
  "system.finalHeraldry",
  "system.customFinalHeraldry",
  "system.origin",
  "system.customOrigin",
  "system.specificOrigin",
  "system.customSpecificOrigin"
]) {
  assert.equal(isPeasantActiveEffectKeyDisplayed(key), true, `The picker should show ${key}`);
}

assert.equal(
  isPeasantActiveEffectKeyDisplayed("system.naturalhaltValues.head"),
  false,
  "The picker should hide the legacy naturalhaltValues spelling"
);
assert.equal(
  isPeasantActiveEffectKeyDisplayed("system.naturalHaltValues.head"),
  true,
  "The picker should show the canonical naturalHaltValues spelling"
);

for (const stressType of ["general", "physical", "mental"]) {
  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      isPeasantActiveEffectKeyDisplayed(`system.${stressType}${index}`),
      false,
      `The picker should hide system.${stressType}${index}`
    );
  }

  assert.equal(
    isPeasantActiveEffectKeyDisplayed(`system.${stressType}StressCount`),
    true,
    `The picker should show system.${stressType}StressCount`
  );
}

assert.equal(
  isPeasantActiveEffectKeyDisplayed("system.customSirs"),
  false,
  "The picker should hide the custom SIR container"
);
assert.ok(
  collectPeasantActiveEffectKeys({
    actorDataModels: {},
    itemDataModels: {},
    sirLocationEntries: [
      { key: "sirGrimmstad", custom: false },
      { key: "customSirLocation1", custom: true }
    ]
  }).includes("system.customSirs.customSirLocation1"),
  "The picker should include configured custom SIR keys"
);
const defensiveReflexKey = "system.defensiveReflexes.toHit";
const virtualKeys = collectPeasantActiveEffectKeys({
  actorDataModels: {},
  itemDataModels: {},
  sirLocationEntries: []
});
assert.ok(virtualKeys.includes(defensiveReflexKey), "the picker should offer the defensive To-Hit key");
assert.equal(isPeasantActiveEffectVirtualDynamicKey(defensiveReflexKey), true);
assert.equal(isPeasantActiveEffectFoundryDynamicKey(defensiveReflexKey), false,
  "Peasant reads the key as a defensive modifier instead of applying it to actor data");

class DataField {}
class SchemaField extends DataField {
  constructor(fields) {
    super();
    this.fields = fields;
  }
}
class NumberField extends DataField {}
class BooleanField extends DataField {}

globalThis.foundry = {
  data: {
    fields: {
      ArrayField: class ArrayField extends DataField {},
      EmbeddedDataField: class EmbeddedDataField extends DataField {},
      BooleanField,
      SchemaField
    }
  }
};

const actorDataModels = {
  character: {
    schema: new SchemaField({
      build: new NumberField(),
      devastatingWounds: new NumberField(),
      fallBlessingUses: new SchemaField({ value: new NumberField(), max: new NumberField() }),
      conditions: new SchemaField({ overcharged: new BooleanField({ initial: false }) })
    })
  }
};
const itemDataModels = {
  weapon: {
    schema: new SchemaField({
      reach: new NumberField()
    })
  },
  equipment: {
    schema: new SchemaField({
      shield: new SchemaField({ hardness: new NumberField() })
    })
  }
};
const collectionOptions = { actorDataModels, itemDataModels, sirLocationEntries: [] };

const spellEffectKeys = collectPeasantActiveEffectKeys({
  ...collectionOptions,
  effect: { type: "spellEffect", parent: { documentName: "Actor", type: "character" } }
});
for (const key of Object.values(MANIFEST_SPELL_EFFECT_CHANGE_KEYS)) {
  assert.equal(spellEffectKeys.includes(key), true, `The Spell Effect key browser should include ${key}`);
  assert.equal(isPeasantActiveEffectVirtualDynamicKey(key), true, `${key} should be handled by Peasant Core`);
  assert.equal(isPeasantActiveEffectFoundryDynamicKey(key), false, `${key} should not be applied to the Actor by Foundry`);
}
assert.equal(
  collectPeasantActiveEffectKeys({
    ...collectionOptions,
    effect: { type: "enchantment", parent: { documentName: "Actor", type: "character" } }
  }).includes(MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp),
  false,
  "Self-effect keys should only appear for Spell Effects"
);
assert.equal(isPeasantActiveEffectVirtualDynamicKey("effect.system.unknown"), false);

assert.deepEqual(
  collectPeasantActiveEffectKeys({
    ...collectionOptions,
    effect: { parent: { documentName: "Actor", type: "character" } }
  }).filter(key => ["system.build", "system.reach", "system.shield.hardness"].includes(key)),
  ["system.build"],
  "Actor effects should only show Actor model keys"
);
const actorConditionPickerKeys = collectPeasantActiveEffectKeys({
  ...collectionOptions,
  effect: { parent: { documentName: "Actor", type: "character" } }
});
assert.equal(actorConditionPickerKeys.includes("system.conditions.overcharged"), true, "Overcharged is available as a reversible Active Effect key");
for (const key of ["system.devastatingWounds", "system.fallBlessingUses.value", "system.fallBlessingUses.max"]) {
  assert.equal(actorConditionPickerKeys.includes(key), false, `${key} is excluded from searchable Active Effect keys`);
}
assert.equal(isPeasantActiveEffectUnsupportedKey("system.conditions.overcharged"), false, "Overcharged is a supported reversible key");
assert.equal(isPeasantActiveEffectStateKey("system.conditions.overcharged"), false, "Overcharged is not a Peasant Core state operation");
assert.equal(isPeasantActiveEffectFoundryDynamicKey("system.conditions.overcharged"), true, "Manual Foundry dynamic-key pass-through is preserved");

for (const transfer of [false, true]) {
  assert.deepEqual(
    collectPeasantActiveEffectKeys({
      ...collectionOptions,
      effect: { transfer, parent: { documentName: "Item", type: "weapon" } }
    }).filter(key => ["system.build", "system.reach", "system.shield.hardness"].includes(key)),
    ["system.build", "system.reach"],
    "Item effects should show Actor keys and keys for their own Item type"
  );
}

delete globalThis.foundry;
