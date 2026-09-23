import assert from "node:assert/strict";
import * as notableCombatImages from "../module/data/actor/notable-combat-image.mjs";

const { getNotableCombatEffectImage, getNotableCombatImage } = notableCombatImages;

globalThis.CONFIG = {
  Item: { documentClass: { DEFAULT_ICON: "icons/svg/item-bag.svg" } },
  ActiveEffect: { documentClass: { DEFAULT_ICON: "icons/svg/aura.svg" } }
};

const caster = { img: "caster.webp" };

assert.equal(typeof getNotableCombatImage, "function");
assert.equal(getNotableCombatImage({ img: "custom-notable.webp" }), "custom-notable.webp");
assert.equal(getNotableCombatImage({ img: "" }), "icons/svg/item-bag.svg");

assert.equal(
  getNotableCombatEffectImage(caster, { img: "custom-notable.webp" }),
  "custom-notable.webp"
);
assert.equal(getNotableCombatEffectImage(caster, { img: "" }), "caster.webp");
assert.equal(
  getNotableCombatEffectImage(caster, { img: "icons/svg/item-bag.svg" }),
  "caster.webp"
);
assert.equal(
  getNotableCombatEffectImage(caster, { img: "icons/svg/sword.svg" }),
  "caster.webp"
);
assert.equal(getNotableCombatEffectImage({ img: "" }, { img: "" }), "icons/svg/aura.svg");
