import assert from "node:assert/strict";

import {
  applyShieldDurabilityDamage,
  getShieldBlockEffectiveHardness,
  getShieldDurabilityEffectiveHardness
} from "../module/data/actor/combat-defense.mjs";

assert.equal(getShieldDurabilityEffectiveHardness({ hp: 40, hardness: 45 }), 40);
assert.equal(getShieldBlockEffectiveHardness({ block: true, blockType: "Shield", hp: 40, hardness: 45 }), 40);
assert.equal(getShieldBlockEffectiveHardness({ block: true, blockType: "Weapon", hp: 40, hardness: 45 }), 0);

assert.deepEqual(
  applyShieldDurabilityDamage({ hp: 40, hardness: 20 }, 10),
  { hp: 30, hardness: 20 },
  "HP loss above the hardness threshold should not reduce hardness"
);

assert.deepEqual(
  applyShieldDurabilityDamage({ hp: 40, hardness: 20 }, 21),
  { hp: 19, hardness: 19 },
  "Only the HP loss that crosses below the hardness threshold should reduce hardness"
);

assert.deepEqual(
  applyShieldDurabilityDamage({ hp: 40, hardness: 45 }, 1),
  { hp: 39, hardness: 44 },
  "When HP starts below hardness, actual shield HP loss should reduce hardness"
);

assert.deepEqual(
  applyShieldDurabilityDamage({ hp: 3, hardness: 12 }, 5),
  { hp: 0, hardness: 0 },
  "A shield reduced to 0 HP should also have 0 hardness"
);

const mockCombat = {
  defense: {
    block: true,
    blockType: "Shield",
    responses: ["Melee"],
    hp: 40,
    hardness: 45
  }
};
const shieldDamageApplied = 1;
mockCombat.defense = {
  ...mockCombat.defense,
  ...applyShieldDurabilityDamage(mockCombat.defense, shieldDamageApplied)
};

assert.equal(mockCombat.defense.hp, 39);
assert.equal(mockCombat.defense.hardness, 44);

console.log("shield durability tests passed");
