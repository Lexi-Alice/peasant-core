import assert from "node:assert/strict";

import {
  MANIFEST_SPELL_DEFINITIONS,
  absorbMagicalHp,
  collectManifestSpellRecipients,
  findActiveSpellEffectInCategory,
  getManifestMaximizedValue,
  getManifestSpellDefinition,
  isActiveSpellEffect,
  resolveManifestSpellHp
} from "../module/data/active-effect/spell-effects.mjs";
import { buildManifestSpellEffectChanges } from "../module/data/active-effect/spell-effect-change-keys.mjs";

assert.deepEqual(getManifestSpellDefinition("manifestDome"), MANIFEST_SPELL_DEFINITIONS.manifestDome);
assert.deepEqual(getManifestSpellDefinition("dome"), MANIFEST_SPELL_DEFINITIONS.manifestDome);
assert.deepEqual(getManifestSpellDefinition("manifestResistance"), MANIFEST_SPELL_DEFINITIONS.manifestResistance);
assert.deepEqual(getManifestSpellDefinition("resistance"), MANIFEST_SPELL_DEFINITIONS.manifestResistance);
assert.equal(getManifestSpellDefinition("manifest"), null);

assert.equal(getManifestMaximizedValue({ diceCount: 2, diceValue: 8, flat: 1 }), 17);
assert.equal(getManifestMaximizedValue({ diceCount: 0, diceValue: 0, flat: -4 }), 0);

assert.deepEqual(
  resolveManifestSpellHp({ manifestType: "dome", rollTotal: 9, maximized: 17 }),
  { gain: 9, value: 9, max: 34 }
);
assert.deepEqual(
  resolveManifestSpellHp({
    manifestType: "dome",
    rollTotal: 7,
    maximized: 10,
    existing: { value: 20, max: 34 }
  }),
  { gain: 7, value: 20, max: 20 }
);
assert.deepEqual(
  resolveManifestSpellHp({
    manifestType: "dome",
    rollTotal: 15,
    maximized: 25,
    existing: { value: 20, max: 34 }
  }),
  { gain: 15, value: 35, max: 50 }
);
assert.deepEqual(
  resolveManifestSpellHp({ manifestType: "resistance", rollTotal: 11, maximized: 16 }),
  { gain: 5, value: 5, max: 16 }
);
assert.deepEqual(
  resolveManifestSpellHp({
    manifestType: "resistance",
    rollTotal: 9,
    maximized: 12,
    existing: { value: 8, max: 16 }
  }),
  { gain: 4, value: 12, max: 12 }
);
assert.deepEqual(
  resolveManifestSpellHp({
    manifestType: "resistance",
    rollTotal: 9,
    maximized: 12,
    existing: { value: 8, max: 16 },
    replacement: true
  }),
  { gain: 4, value: 4, max: 12 }
);

assert.deepEqual(
  absorbMagicalHp({ damage: 9, hp: 4, damageType: "lethal" }),
  { absorbed: 4, penetration: 5, remainingHp: 0, depleted: true, damageType: "lethal" }
);
assert.deepEqual(
  absorbMagicalHp({ damage: 4, hp: 4, damageType: "hybrid" }),
  { absorbed: 4, penetration: 0, remainingHp: 0, depleted: true, damageType: "hybrid" }
);
assert.deepEqual(
  absorbMagicalHp({ damage: 3, hp: 8, damageType: "critical" }),
  { absorbed: 3, penetration: 0, remainingHp: 5, depleted: false, damageType: "critical" }
);

const activeDome = {
  id: "dome",
  type: "spellEffect",
  disabled: false,
  duration: { expired: false },
  changes: buildManifestSpellEffectChanges({ manifestType: "dome", hp: { value: 5, max: 10 } })
};
const disabledDome = {
  id: "disabled",
  type: "spellEffect",
  disabled: true,
  duration: { expired: false },
  changes: buildManifestSpellEffectChanges({ manifestType: "dome", hp: { value: 5, max: 10 } })
};
const expiredDome = {
  id: "expired",
  type: "spellEffect",
  disabled: false,
  duration: { expired: true },
  changes: buildManifestSpellEffectChanges({ manifestType: "dome", hp: { value: 5, max: 10 } })
};
assert.equal(isActiveSpellEffect(activeDome), true);
assert.equal(isActiveSpellEffect(disabledDome), false);
assert.equal(isActiveSpellEffect(expiredDome), false);
assert.equal(isActiveSpellEffect({ type: "enchantment", disabled: false }), false);
assert.equal(
  findActiveSpellEffectInCategory({ effects: [disabledDome, expiredDome, activeDome] }, "aura"),
  activeDome
);
assert.equal(
  findActiveSpellEffectInCategory({ effects: [activeDome] }, "aura", { excludeId: "dome" }),
  null
);

const caster = { id: "caster", uuid: "Actor.caster", name: "Caster" };
const firstActor = { id: "first", uuid: "Actor.first", name: "First" };
const secondActor = { id: "second", uuid: "Actor.second", name: "Second" };
const recipients = collectManifestSpellRecipients({
  caster,
  targets: [
    { actor: firstActor, tokenId: "one" },
    { actor: firstActor, tokenId: "two" },
    { actor: secondActor, tokenId: "three" },
    { actor: null }
  ]
});
assert.deepEqual(recipients.map((entry) => entry.actor.uuid), ["Actor.first", "Actor.second"]);
assert.deepEqual(
  collectManifestSpellRecipients({ caster, targets: [] }).map((entry) => entry.actor.uuid),
  ["Actor.caster"]
);
assert.deepEqual(collectManifestSpellRecipients({ caster: null, targets: [] }), []);

console.log("spell effects tests passed");
