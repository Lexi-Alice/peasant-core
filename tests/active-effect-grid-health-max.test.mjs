import assert from "node:assert/strict";

import * as changeModes from "../module/data/active-effect/change-modes.mjs";
import {
  PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES,
  getPeasantActiveEffectKeyMetadata,
  isPeasantActiveEffectFoundryDynamicKey
} from "../module/data/active-effect/key-policy.mjs";

globalThis.CONST = {
  ACTIVE_EFFECT_MODES: {
    CUSTOM: 0,
    MULTIPLY: 1,
    ADD: 2,
    DOWNGRADE: 3,
    UPGRADE: 4,
    OVERRIDE: 5
  }
};

assert.equal(
  getPeasantActiveEffectKeyMetadata("system.health.max").category,
  PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.DYNAMIC,
  "Maximum health should be a reversible Active Effect key"
);
assert.equal(
  isPeasantActiveEffectFoundryDynamicKey("system.health.max", { gridHealth: true }),
  false,
  "Grid health maximum changes should bypass Foundry's direct field application"
);
assert.equal(
  isPeasantActiveEffectFoundryDynamicKey("system.health.max", { gridHealth: false }),
  true,
  "Simplified health maximum changes should use Foundry's direct field application"
);

for (const key of ["token.texture.tint", "flags.peasant-core.example", "system.hp.grid"]) {
  assert.equal(
    isPeasantActiveEffectFoundryDynamicKey(key),
    true,
    `${key} should pass through to Foundry when entered manually`
  );
}
for (const key of ["system.health.value", "system.haltValues.head"]) {
  assert.equal(
    isPeasantActiveEffectFoundryDynamicKey(key),
    false,
    `${key} should remain on its Peasant Core-managed application path`
  );
}

assert.deepEqual(
  getPeasantActiveEffectKeyMetadata("token.texture.tint"),
  {
    key: "token.texture.tint",
    category: PEASANT_ACTIVE_EFFECT_KEY_CATEGORIES.UNSUPPORTED,
    label: "Manual",
    title: "Manual key. Passed to Foundry as entered, but not included in the searchable list."
  },
  "Unlisted manual keys should not be described as blocked"
);

assert.equal(
  typeof changeModes.applyPeasantGridHealthMaxChanges,
  "function",
  "Grid health maximum changes should have a column-count applicator"
);

const applyChanges = changeModes.applyPeasantGridHealthMaxChanges;
assert.equal(
  applyChanges(7, [{ key: "system.health.max", mode: 2, value: "1" }]),
  8,
  "Add 1 should add one HP column"
);
assert.equal(
  applyChanges(7, [{ key: "system.health.max", mode: 5, value: "3" }]),
  3,
  "Override 3 should temporarily set the grid to three HP columns"
);
assert.equal(
  applyChanges(7, [{ key: "system.health.max", mode: 1, value: "2" }]),
  14,
  "Multiply 2 should double the HP column count"
);
assert.equal(
  applyChanges(2, [{ key: "system.health.max", mode: 2, value: "-10" }]),
  1,
  "Grid health effects should retain at least one HP column"
);
assert.equal(
  applyChanges(7, [
    { key: "system.movement", mode: 2, value: "4" },
    { key: "system.health.max", mode: 2, value: "1", priority: 20 },
    { key: "system.health.max", mode: 4, value: "10", priority: 10 }
  ]),
  11,
  "Health maximum changes should apply in Foundry priority order"
);

assert.equal(
  typeof changeModes.mergePeasantGridHealthEffectUpdate,
  "function",
  "Grid updates should preserve cells hidden by a temporary column reduction"
);

const mergeGridUpdate = changeModes.mergePeasantGridHealthEffectUpdate;
assert.deepEqual(
  mergeGridUpdate(
    [[0, 0, 2, 3]],
    [[1, 2]],
    { rows: 1, sourceColumns: 4, effectColumns: 2 }
  ),
  [[1, 2, 2, 3]],
  "A reduced temporary grid should retain hidden source columns"
);
assert.deepEqual(
  mergeGridUpdate(
    [[0, 0]],
    [[1, 2, 3, 1]],
    { rows: 1, sourceColumns: 2, effectColumns: 4 }
  ),
  [[1, 2, 3, 1]],
  "Damage in temporary bonus columns should remain stored"
);

delete globalThis.CONST;
