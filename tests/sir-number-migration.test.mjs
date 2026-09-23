import assert from "node:assert/strict";

import {
  PC_WORLD_MIGRATION_VERSION_SETTING,
  migrateWorldNotableCombatData
} from "../module/migration/world.mjs";

const actorUpdates = [];
const settingUpdates = [];
const actor = {
  name: "Cyrus Cord",
  type: "character",
  _source: {
    system: {
      sirGrimmstad: "+3",
      sirSavonia: "",
      customSirs: { customSirLocation2: "-4" }
    }
  },
  system: {},
  getFlag: (scope, key) => scope === "peasant-core" && key === "customSirLocationValues"
    ? { customSirLocation1: "+5", customSirLocation2: "+7" }
    : undefined,
  update: async (data, options) => actorUpdates.push({ data, options })
};

globalThis.game = {
  user: { isGM: true },
  actors: [actor],
  settings: {
    get: (scope, key) => scope === "peasant-core" && key === PC_WORLD_MIGRATION_VERSION_SETTING ? 8 : undefined,
    set: async (scope, key, value) => settingUpdates.push({ scope, key, value })
  }
};

await migrateWorldNotableCombatData();

assert.deepEqual(
  actorUpdates,
  [{
    data: {
      "system.sirGrimmstad": 3,
      "system.sirSavonia": 0,
      "system.customSirs": {
        customSirLocation1: 5,
        customSirLocation2: -4
      },
      "flags.peasant-core.-=customSirLocationValues": null,
      "system.devastatingWounds": 0,
      "system.armorCharge": { value: 0, max: 0 },
      "system.fallBlessingUses": { value: 0, max: 1 }
    },
    options: { render: false }
  }],
  "World migration should convert built-in SIRs and move custom flag values into system data"
);
assert.deepEqual(
  settingUpdates,
  [{ scope: "peasant-core", key: PC_WORLD_MIGRATION_VERSION_SETTING, value: 26 }],
  "World migration should advance through zero-HP Mage Block cleanup"
);
