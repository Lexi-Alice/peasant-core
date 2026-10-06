import assert from "node:assert/strict";

import {
  PC_WORLD_MIGRATION_VERSION_SETTING,
  getE5CombatStateMigrationUpdate,
  migrateWorldNotableCombatData
} from "../module/migration/world.mjs";
import { getMageBlockBarrierHp } from "../module/data/active-effect/mage-block-effects.mjs";

function character(system = {}, items = []) {
  return { type: "character", _source: { system, items } };
}

function applyUpdate(source, update) {
  const copy = structuredClone(source);
  for (const [path, value] of Object.entries(update)) {
    const parts = path.split(".");
    const key = parts.pop();
    const target = parts.reduce((current, part) => current[part] ??= {}, copy);
    target[key] = value;
  }
  return copy;
}

const heavyArmor = [{ type: "equipment", system: { equipped: true, category: "heavy-armor" } }];
const armorSkill = { id: "armor", category: "martial", type: "defense", defenseType: "Armor", class: 4, rank: 4 };
const source = character({
  edge: { max: 5 },
  devastatingWounds: 2,
  armorCharge: { value: 9, max: 9 },
  skills: [
    armorSkill,
    { id: "mage-skill", defense: { block: true, blockType: "Mage", hp: 32, authored: "keep" } },
    { id: "mage-use", usages: [{ id: "use", mechanics: { defense: { block: true, blockType: "Mage", hp: 0, authored: "usage" }, authored: "usage-sibling" } }] },
    { id: "shield-skill", defense: { block: true, blockType: "Shield", hp: 3 } },
    { id: "weapon-skill", usages: [{ mechanics: { defense: { block: true, blockType: "Weapon", hardness: 4 } } }] }
  ],
  notableCombats: [
    { id: "mage-combat", defense: { block: true, blockType: "Mage", hp: 12, maxHp: 40 } },
    { id: "mage-combat-use", usages: [{ mechanics: { defense: { block: true, blockType: "Mage", hp: 7, maxHp: 9, mageBarrierInitialized: true } } }] }
  ],
  blessing: { type: " Fall ", target: "learn", authored: "preserve" }
}, heavyArmor);

const update = getE5CombatStateMigrationUpdate(source);
assert.deepEqual(update["system.devastatingWounds"], undefined, "A valid wound count stays untouched");
assert.equal(update["system.armorCharge"], undefined, "migration preserves manually authored charges regardless of Armor training");
assert.deepEqual(applyUpdate(source._source, update).system.armorCharge, { value: 9, max: 9 });
assert.deepEqual(update["system.fallBlessingUses"], { value: 2, max: 2 }, "A new Fall resource starts full at its derived capacity");
assert.deepEqual(update["system.blessing"], { type: "fall", authored: "preserve" }, "Blessing type is canonical and its E4 target is removed");

const migrated = applyUpdate(source._source, update).system;
assert.deepEqual(migrated.skills[1].defense, {
  block: true, blockType: "Mage", hp: 32, authored: "keep", maxHp: 32, mageBarrierInitialized: false
}, "A legacy Mage barrier uses positive HP as its initial maximum and keeps sibling data");
assert.deepEqual(migrated.skills[2].usages[0].mechanics.defense, {
  block: true, blockType: "Mage", hp: 0, authored: "usage", maxHp: 40, mageBarrierInitialized: false
}, "A zero HP Mage barrier receives the default maximum in a nested usage");
assert.equal(migrated.skills[2].usages[0].mechanics.authored, "usage-sibling");
assert.deepEqual(migrated.notableCombats[0].defense, {
  block: true, blockType: "Mage", hp: 12, maxHp: 40, mageBarrierInitialized: false
}, "Notable base Mage defenses receive the creation marker");
assert.equal(migrated.notableCombats[1].usages[0].mechanics.defense.mageBarrierInitialized, true, "An explicit Mage marker is preserved");
assert.deepEqual(migrated.skills[3].defense, { block: true, blockType: "Shield", hp: 3 }, "Shield defenses receive no Mage fields");
assert.deepEqual(migrated.skills[4].usages[0].mechanics.defense, { block: true, blockType: "Weapon", hardness: 4 }, "Weapon defenses receive no Mage fields");
assert.equal(migrated.skills[0].id, "armor", "Stable embedded entry ids survive the array rewrite");
assert.deepEqual(getE5CombatStateMigrationUpdate(character(migrated, heavyArmor)), {}, "A second pass is idempotent");

assert.deepEqual(
  getE5CombatStateMigrationUpdate(character({ devastatingWounds: -3, armorCharge: { value: 4, max: 4 } })),
  {
    "system.devastatingWounds": 0,
    "system.fallBlessingUses": { value: 0, max: 1 }
  },
  "Missing or malformed E5 state is normalized without changing manual Armor Charge"
);
assert.equal(
  getE5CombatStateMigrationUpdate(character({ devastatingWounds: 0 })).hasOwnProperty("system.devastatingWounds"),
  false,
  "A valid non-negative wound count remains unchanged"
);
for (const count of [-3, "not-a-number", 2.9]) {
  const expected = Number.isFinite(Number(count)) ? Math.max(0, Math.trunc(Number(count))) : 0;
  assert.equal(
    getE5CombatStateMigrationUpdate(character({ devastatingWounds: count }))["system.devastatingWounds"],
    expected,
    `Malformed or fractional Devastating Wounds normalize to a non-negative integer (${count})`
  );
}
assert.deepEqual(
  getE5CombatStateMigrationUpdate(character({ armorCharge: { value: 1, max: 2 }, skills: [armorSkill] }, heavyArmor))["system.armorCharge"],
  undefined,
  "A valid manual current/max pair remains unchanged"
);
assert.deepEqual(
  getE5CombatStateMigrationUpdate(character({ blessing: { type: "invalid", target: "strength" } }))["system.blessing"],
  { type: "" },
  "Invalid Blessing types normalize and their legacy target is removed"
);
for (const type of ["spring", "summer", "fall", "winter"]) {
  assert.deepEqual(
    getE5CombatStateMigrationUpdate(character({ blessing: { type, target: "strength" } }))["system.blessing"],
    { type },
    `Legacy ${type} Blessing drops its target without changing its season`
  );
}
assert.deepEqual(
  getE5CombatStateMigrationUpdate(character({ edge: { max: 9 }, blessing: { type: "summer" } }))["system.fallBlessingUses"],
  { value: 0, max: 4 },
  "A new non-Fall actor receives the derived maximum but no current uses"
);
assert.deepEqual(
  getE5CombatStateMigrationUpdate(character({ edge: { max: 9 }, blessing: { type: "fall" }, fallBlessingUses: { value: -4, max: -2 } }))["system.fallBlessingUses"],
  { value: 0, max: 0 },
  "Malformed Fall uses clamp to a non-negative current/max pair"
);
assert.deepEqual(
  getE5CombatStateMigrationUpdate(character({ edge: { max: 8 }, blessing: { type: "spring" }, fallBlessingUses: { value: 2, max: 3 } }))["system.fallBlessingUses"],
  undefined,
  "An existing valid Fall-use pair remains unchanged regardless of the active season"
);
assert.deepEqual(
  getE5CombatStateMigrationUpdate({ type: "npc", _source: { system: {} } }),
  {},
  "Non-character actors do not receive character state migration"
);

let actorUpdate;
let settingUpdate;
const actor = {
  type: "character",
  name: "Old actor",
  _source: { system: { skills: [{ id: "old", type: "standard", name: "Old Skill" }] } },
  async update(data) { actorUpdate = data; }
};
globalThis.foundry = { utils: { randomID: () => "generated" } };
globalThis.game = {
  user: { isGM: true },
  actors: [actor],
  settings: {
    get: () => 0,
    async set(scope, key, value) { settingUpdate = { scope, key, value }; }
  }
};
await migrateWorldNotableCombatData();
assert.equal(actorUpdate["system.skills"][0].type, "skill", "Version 21 composes after prior Skill migrations in the same pass");
assert.deepEqual(settingUpdate, {
  scope: "peasant-core", key: PC_WORLD_MIGRATION_VERSION_SETTING, value: 28
}, "A successful world migration records version 28");

const mageActor = {
  type: "character",
  name: "Mage effects migration",
  img: "icons/actors/mage-effects.webp",
  effects: [],
  _source: { system: {
    skills: [{ id: "mage-skill", name: "Mage Skill", img: "icons/notables/mage-skill.webp", defense: {
      block: true, blockType: "Mage", hp: 12, maxHp: 40, mageBarrierInitialized: true
    } }],
    notableCombats: [{ id: "mage-combat", name: "Mage Combat", img: "icons/notables/mage-combat.webp", defense: {
      block: true, blockType: "Mage", hp: 0, maxHp: 40, mageBarrierInitialized: true
    } }]
  } },
  async createEmbeddedDocuments(_documentName, sources) {
    const created = sources.map((source, index) => ({
      ...structuredClone(source),
      id: `mage-effect-${index + 1}`,
      _id: `mage-effect-${index + 1}`
    }));
    this.effects.push(...created);
    return created;
  },
  async update(update) {
    this._source = applyUpdate(this._source, update);
    this.system = this._source.system;
  }
};
game.actors = [mageActor];
game.settings.get = () => 21;
await migrateWorldNotableCombatData();
assert.equal(mageActor.effects.length, 1, "migration only creates a Mage Block effect when a barrier has HP");
assert.equal("hp" in mageActor._source.system.skills[0].defense, false);
assert.equal("mageBarrierInitialized" in mageActor._source.system.skills[0].defense, false);
assert.equal("hp" in mageActor._source.system.notableCombats[0].defense, false);
assert.equal("mageBarrierInitialized" in mageActor._source.system.notableCombats[0].defense, false);
assert.equal(mageActor.effects.filter((effect) => effect.flags["peasant-core"].mageBlockBarrier).length, 1,
  "zero-HP legacy barriers do not create zero-HP effects");
assert.equal(mageActor.effects.find((effect) => effect.flags["peasant-core"].mageBlockBarrier).img,
  "icons/notables/mage-skill.webp", "migrated Mage Block barriers use their source Notable image");
assert.equal(mageActor.effects.some((effect) => effect.flags["peasant-core"].mageBlockDuress && !effect.flags["peasant-core"].mageBlockBarrier), false,
  "zero-HP legacy barriers do not migrate into marker-only Duress effects");
assert.equal(settingUpdate.value, 28);

const oldBarrier = {
  id: "old-mage-barrier",
  _id: "old-mage-barrier",
  name: "Mage Block Barrier — Mage Combat",
  type: "spellEffect",
  start: { combat: null, round: null },
  duration: { value: null, units: "rounds", expiry: null, expired: false },
  system: { encounterId: "", changes: [
    { key: "effect.system.magicalHp.value", mode: 2, value: 18, priority: 20 },
    { key: "effect.system.magicalHp.max", mode: 5, value: 40, priority: 20 }
  ] },
  flags: { "peasant-core": { mageBlockBarrier: true, mageBlockDefenseId: "notableCombats:old-mage:base" } }
};
const oldDuress = {
  id: "old-mage-duress",
  _id: "old-mage-duress",
  name: "Mage Block Duress — Mage Combat",
  type: "spellEffect",
  start: { combat: null, round: null },
  duration: { value: null, units: "rounds", expiry: null, expired: false },
  system: { encounterId: "", changes: [] },
  flags: { "peasant-core": { mageBlockDuress: true, mageBlockDefenseId: "notableCombats:old-mage:base" } }
};
const splitMageActor = {
  type: "character",
  name: "Split Mage effects",
  effects: [oldBarrier, oldDuress],
  _source: { system: {} },
  async updateEmbeddedDocuments(_documentName, updates) {
    for (const update of updates) {
      const effect = this.effects.find((candidate) => candidate.id === update._id);
      if (!effect) continue;
      if (update["system.changes"]) effect.system.changes = structuredClone(update["system.changes"]);
      if (update["flags.peasant-core.mageBlockDuress"] !== undefined) {
        effect.flags["peasant-core"].mageBlockDuress = update["flags.peasant-core.mageBlockDuress"];
      }
      if (update["flags.peasant-core.mageBlockBarrier"] !== undefined) {
        effect.flags["peasant-core"].mageBlockBarrier = update["flags.peasant-core.mageBlockBarrier"];
      }
      if (update.name !== undefined) effect.name = update.name;
      if (update.start !== undefined) effect.start = structuredClone(update.start);
      if (update.duration !== undefined) effect.duration = structuredClone(update.duration);
      if (update["system.encounterId"] !== undefined) effect.system.encounterId = update["system.encounterId"];
    }
  },
  async deleteEmbeddedDocuments(_documentName, ids) {
    this.effects = this.effects.filter((effect) => !ids.includes(effect.id));
  }
};
game.actors = [splitMageActor];
game.settings.get = () => 22;
await migrateWorldNotableCombatData();
assert.equal(splitMageActor.effects.length, 1, "the follow-up migration merges the old barrier and Duress effects");
assert.equal(splitMageActor.effects[0].flags["peasant-core"].mageBlockBarrier, true);
assert.equal(splitMageActor.effects[0].flags["peasant-core"].mageBlockDuress, true);
assert.deepEqual(getMageBlockBarrierHp(splitMageActor.effects[0]), { value: 18, max: 40 });
assert.equal(settingUpdate.value, 28);

const depletedMageDuressEffect = {
  ...structuredClone(oldBarrier),
  id: "empty-mage-effect",
  _id: "empty-mage-effect",
  system: { encounterId: "", changes: [] },
  flags: { "peasant-core": {
    mageBlockBarrier: false,
    mageBlockDuress: true,
    mageBlockDefenseId: "notableCombats:empty-mage:base"
  } }
};
let emptyActorUpdates = 0;
const emptyCombinedActor = {
  type: "character",
  name: "Depleted Mage Duress marker",
  effects: [depletedMageDuressEffect],
  _source: { system: {} },
  async update() { emptyActorUpdates += 1; },
  async deleteEmbeddedDocuments(_documentName, ids) {
    this.effects = this.effects.filter((effect) => !ids.includes(effect.id));
  }
};
game.actors = [emptyCombinedActor];
game.settings.get = () => 23;
settingUpdate = null;
await migrateWorldNotableCombatData();
assert.equal(emptyCombinedActor.effects.length, 0, "migration removes a stale Duress marker left by a depleted barrier");
assert.equal(emptyActorUpdates, 0, "effect-only migration skips an empty actor update");
assert.equal(settingUpdate.value, 28);

actorUpdate = null;
settingUpdate = null;
game.actors = [actor];
game.settings.get = () => 0;
actor.update = async () => { throw new Error("expected actor failure"); };
const originalError = console.error;
console.error = () => {};
try {
  await migrateWorldNotableCombatData();
} finally {
  console.error = originalError;
}
assert.equal(settingUpdate, null, "A failed actor migration does not mark the world migration clean");
