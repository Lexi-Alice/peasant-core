import assert from "node:assert/strict";

import {
  normalizeCombatDefense,
  resolveMageBlockDamage,
  resolveShieldBlockDamage
} from "../module/data/actor/combat-defense.mjs";
import {
  doesAttackReachManifestDome,
  getAccuracyPenaltyFromDefenseRoll,
  isMageDefenseDamageRedirect,
  shouldContinueAfterManifestDome
} from "../module/data/actor/defense-results.mjs";
import { collectNotableCombatTagData } from "../module/applications/actor/notable-combat/notable-combat-tag-data.mjs";
import { renderDefenseTagInputs } from "../module/applications/actor/notable-combat/notable-combat-defense-tag-inputs.mjs";

const normal = resolveShieldBlockDamage({ block: true, blockType: "Shield", hp: 40, hardness: 10 }, 30, { braced: false });
assert.equal(normal.hardnessApplied, 10);
assert.equal(normal.shieldDamage, 10);
assert.equal(normal.armDamage, 10);

const braced = resolveShieldBlockDamage({ block: true, blockType: "Shield", hp: 40, hardness: 10 }, 30, { braced: true });
assert.equal(braced.hardnessApplied, 20);
assert.equal(braced.shieldDamage, 10);
assert.equal(braced.armDamage, 0);

const destroyed = resolveShieldBlockDamage({ block: true, blockType: "Shield", hp: 5, hardness: 10 }, 20, { braced: true });
assert.equal(destroyed.armDamage, 5);
assert.equal(destroyed.overkill, true);

const mage = resolveMageBlockDamage({ hp: 12, maxHp: 40 }, 20);
assert.equal(mage.hpBefore, 12);
assert.equal(mage.hpAfter, 0);
assert.equal(mage.absorbed, 12);
assert.equal(mage.overflow, 8);
assert.equal(mage.cleanHit, true);

const mageBlockDefense = {
  block: true,
  blockType: "Mage",
  effectiveness: { melee: { mosPer: 1, accuracyPenalty: 3 } }
};
assert.equal(getAccuracyPenaltyFromDefenseRoll(mageBlockDefense, "Melee", { totalMoS: 2 }), 0,
  "Mage Block does not apply Effectiveness-based Accuracy penalties to the attacking skill");
assert.equal(getAccuracyPenaltyFromDefenseRoll({
  block: true,
  blockType: "Shield",
  effectiveness: { melee: { mosPer: 1, accuracyPenalty: 3 } }
}, "Melee", { totalMoS: 2 }), 6, "other blocks keep authored Effectiveness penalties");

const passingMageBlock = {
  selection: "defense",
  selectedDefense: mageBlockDefense,
  defenseRoll: { rollResult: { isSuccess: true, totalMoS: 0 } }
};
const failedAttack = { rollResult: { isSuccess: false, totalMoS: -2 } };
assert.equal(isMageDefenseDamageRedirect(passingMageBlock), true,
  "a Mage Block that passes at MoS 0 redirects damage regardless of the attacking roll's MoS");
assert.equal(doesAttackReachManifestDome({ attackRoll: failedAttack, defensePromptResult: passingMageBlock }), true,
  "a passed Mage Block still resolves through the Dome-first damage order");
assert.equal(shouldContinueAfterManifestDome({
  attackRoll: failedAttack,
  defensePromptResult: passingMageBlock,
  domeResult: { handled: true, penetration: 4 }
}), true, "post-Dome penetration continues to the Mage Block barrier");
assert.equal(shouldContinueAfterManifestDome({
  attackRoll: failedAttack,
  defensePromptResult: passingMageBlock,
  domeResult: { handled: true, penetration: 0 }
}), false, "a Dome that absorbs all damage leaves none for the Mage Block barrier");
assert.equal(isMageDefenseDamageRedirect({
  ...passingMageBlock,
  defenseRoll: { rollResult: { isSuccess: false, totalMoS: -1 } }
}), false, "a Mage Block below MoS 0 does not redirect the attack");
assert.equal(isMageDefenseDamageRedirect({
  ...passingMageBlock,
  defenseRoll: { rollResult: { totalMoS: null } }
}), false, "an absent Mage Block MoS cannot be treated as a pass");

const normalizedMage = normalizeCombatDefense({ block: true, blockType: "Mage", hp: 12 });
assert.equal(normalizedMage.hp, 0, "the Notable does not supply current Mage barrier HP");
assert.equal(normalizedMage.maxHp, 12);
assert.equal("mageBarrierInitialized" in normalizedMage, false);
assert.equal(normalizeCombatDefense({ block: true, blockType: "Mage" }).maxHp, 40);
assert.equal(normalizeCombatDefense({ block: true, blockType: "Mage", hp: 70, maxHp: 40 }).hp, 0);

const normalizedShield = normalizeCombatDefense({
  block: true,
  blockType: "Shield",
  hp: 20,
  hardness: 10,
  maxHp: 99,
  mageBarrierInitialized: true
});
assert.equal("maxHp" in normalizedShield, false);
assert.equal("mageBarrierInitialized" in normalizedShield, false);

const tagInputs = new Map([
  ['.tag-defense-response[data-defense-key="melee"]', { checked: true }],
  [".tag-defense-block", { checked: true }],
  [".tag-defense-block-type", { value: "Mage" }],
  [".tag-defense-hp", { value: "12" }],
  [".tag-defense-max-hp", { value: "48" }]
]);
const tagRoot = {
  nodeType: 1,
  querySelector(selector) { return tagInputs.get(selector) ?? null; }
};
const serializedMageTag = collectNotableCombatTagData(tagRoot, "defense", {
  combatData: { defense: { mageBarrierInitialized: true } }
});
assert.equal(serializedMageTag.tagData.defense.maxHp, 48);
assert.equal("hp" in serializedMageTag.tagData.defense, false);
assert.equal("mageBarrierInitialized" in serializedMageTag.tagData.defense, false);

let editorBlockType = "Mage";
let effectivenessVisible = null;
let editorContent = "";
const editorResponses = new Set(["melee"]);
const editorHandlers = new Map();
const tagEditorArea = {
  html(content) { editorContent = content; return this; },
  find(selector) {
    return {
      length: selector.startsWith(".defense-effectiveness-row[") ? 0 : 1,
      find: () => ({ val: () => "" }),
      is: () => selector === ".tag-defense-block"
        || (selector.startsWith(".tag-defense-response[") && editorResponses.has(selector.match(/data-defense-key="([^"]+)"/)?.[1])),
      val: () => selector === ".tag-defense-block-type" ? editorBlockType : "",
      html() { return this; },
      toggle(visible) {
        if (selector === ".defense-effectiveness-section") effectivenessVisible = visible;
        return this;
      },
      css() { return this; }
    };
  },
  off() { return this; },
  on(_event, selector, callback) { editorHandlers.set(selector, callback); return this; }
};
renderDefenseTagInputs(tagEditorArea, {
  defense: { block: true, blockType: "Mage", responses: ["Melee"], maxHp: 40 }
});
assert.match(editorContent, /class="defense-section defense-effectiveness-section" style="display:none;"/,
  "Mage Block does not show an Effectiveness vs editor");
assert.equal(effectivenessVisible, false);
editorBlockType = "Shield";
editorHandlers.get(".tag-defense-block-type")();
assert.equal(effectivenessVisible, true, "other defenses keep their Effectiveness vs editor");
editorBlockType = "Mage";
editorHandlers.get(".tag-defense-block-type")();
assert.equal(effectivenessVisible, false);

console.log("E5 block defense state tests passed");
