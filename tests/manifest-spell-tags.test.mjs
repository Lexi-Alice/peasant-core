import assert from "node:assert/strict";

import {
  COMBAT_EDITOR_TAG_TYPES,
  COMBAT_FULL_TAG_ORDER,
  COMBAT_VIEW_TAG_TYPES
} from "../module/data/actor/combat-tags.mjs";
import { getManifestSpellDefinition } from "../module/data/active-effect/spell-effects.mjs";

for (const tags of [COMBAT_VIEW_TAG_TYPES, COMBAT_EDITOR_TAG_TYPES, COMBAT_FULL_TAG_ORDER]) {
  const manifestIndex = tags.indexOf("manifest");
  assert.ok(manifestIndex >= 0, "Generic Manifest should remain registered");
  assert.deepEqual(
    tags.slice(manifestIndex, manifestIndex + 3),
    ["manifest", "manifestDome", "manifestResistance"],
    "Manifest barrier tags should follow generic Manifest in their stable order"
  );
  assert.equal(tags.filter((tag) => tag === "manifestDome").length, 1);
  assert.equal(tags.filter((tag) => tag === "manifestResistance").length, 1);
}

assert.equal(getManifestSpellDefinition("manifestDome")?.manifestType, "dome");
assert.equal(getManifestSpellDefinition("manifestResistance")?.manifestType, "resistance");
assert.equal(getManifestSpellDefinition("manifest"), null);

console.log("manifest spell tag tests passed");
