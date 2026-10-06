import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canSpendActiveArmorCharge,
  getActiveArmorChargeCapacity,
  getEquippedArmorGrade
} from "../module/data/actor/active-armor.mjs";
import { getEquippedArmorEffects } from "../module/data/actor/equipped-armor.mjs";
import { prepareActorHealthResourceContext } from "../module/data/actor/sheet-display/health-resources.mjs";

function armor(category, equipped = true) {
  return { type: "equipment", system: { category, equipped, armor: {} } };
}

function armorSkill(classLevel, rank = "0", overrides = {}) {
  return {
    name: "Armor",
    category: "martial",
    type: "Defense",
    defenseType: "Armor",
    class: classLevel,
    rank,
    ...overrides
  };
}

function actor({ grade = "", skills = [], charges = 3, max = 7 } = {}) {
  const category = { light: "light-armor", medium: "medium-armor", heavy: "heavy-armor" }[grade];
  return {
    system: { skills, armorCharge: { value: charges, max } },
    items: category ? [armor(category)] : []
  };
}

assert.equal(getEquippedArmorGrade(actor()), "", "actors without equipped physical armor have no worn grade");
assert.equal(getEquippedArmorGrade(actor({ grade: "light" })), "light");
assert.equal(getEquippedArmorGrade(actor({ grade: "medium" })), "medium");
assert.equal(getEquippedArmorGrade(actor({ grade: "heavy" })), "heavy");
assert.equal(
  getEquippedArmorGrade({ items: [armor("light-armor"), armor("heavy-armor")] }),
  "heavy",
  "the heaviest equipped physical grade wins"
);
assert.equal(getEquippedArmorEffects(actor({ grade: "medium" })).grade, "medium");

for (const grade of ["", "light", "medium", "heavy"]) {
  for (const skills of [[], [armorSkill(1, "u")], [armorSkill(4, "4")], [armorSkill(7, "4")]]) {
    const current = actor({ grade, skills });
    assert.equal(getActiveArmorChargeCapacity(current), 7, "manual maximum is independent of Armor class, rank, and worn grade");
    assert.equal(canSpendActiveArmorCharge(current), !!grade, "equipped armor with available charges does not require training");
  }
}
for (const max of [-2, "invalid", Infinity]) {
  assert.equal(getActiveArmorChargeCapacity(actor({ grade: "heavy", max })), 0, "invalid maximum cannot grant usable charges");
}
assert.equal(canSpendActiveArmorCharge(actor({ grade: "light", charges: 0 })), false, "an empty pool cannot spend a charge");

globalThis.Actor = class {
  prepareDerivedData() {}
};
const { PeasantActor } = await import("../module/documents/actor.mjs");
const source = {
  system: {
    skills: [armorSkill(4, "4")],
    armorCharge: { value: 9, max: 9 },
    health: { value: 8, max: 8 },
    temporaryHp: { value: 0, max: 0 },
    hp: { rows: 1, cols: 8, grid: [[0, 0, 0, 0, 0, 0, 0, 0]] }
  }
};
const projectedActor = Object.assign(Object.create(PeasantActor.prototype), {
  type: "character",
  system: structuredClone(source.system),
  _source: source,
  items: [armor("heavy-armor")],
  effects: [],
  getFlag: (_scope, key) => key === "simplifiedHp",
  _applyPeasantVirtualActiveEffectChanges() {},
  _applyPeasantGridHealthMaxActiveEffectChanges() {}
});
projectedActor.prepareDerivedData();
assert.equal(projectedActor.system.armorCharge.max, 9, "preparation preserves the manually set maximum");
assert.equal(projectedActor.system.armorCharge.value, 9, "preparation preserves the manually set current charges");
assert.equal(source.system.armorCharge.max, 9, "preparing capacity does not rewrite authored source data");
assert.equal(source.system.armorCharge.value, 9, "preparing the current cap does not persist a temporary clamp");
const healthContext = {};
prepareActorHealthResourceContext(healthContext, projectedActor, { isEditMode: true, sourceSystem: source.system });
assert.equal(healthContext.armorCharge.max, 9, "sheet data shows the manual maximum");
assert.equal(healthContext.armorCharge.value, 9, "sheet data shows the manual current charges");
assert.doesNotMatch(healthContext.armorCharge.tooltip, /Class|Rank|skill|train/i);
const characterSheetTemplate = readFileSync(new URL("../templates/actor/character-sheet.html", import.meta.url), "utf8");
assert.match(characterSheetTemplate, /pc-portrait-resource-max-input pc-portrait-armor-charge-input/);
assert.match(characterSheetTemplate, /pc-portrait-resource-value-input pc-portrait-armor-charge-input/);

const writeResourcePatch = async (patch) => {
  for (const [path, value] of Object.entries(patch)) {
    const [, resource, field] = path.split(".");
    source.system[resource][field] = value;
    projectedActor.system[resource][field] = value;
  }
};
projectedActor.updatePeasantSourceData = writeResourcePatch;
projectedActor.updatePeasantStateData = writeResourcePatch;
await projectedActor.setPeasantResourceMax("armorCharge", 7);
await projectedActor.setPeasantResourceValue("armorCharge", 4);
projectedActor.items = [];
projectedActor.system.skills = [];
projectedActor.prepareDerivedData();
assert.deepEqual(projectedActor.system.armorCharge, { value: 4, max: 7 }, "manual current and maximum edits survive preparation without armor or an Armor skill");
assert.deepEqual(source.system.armorCharge, { value: 4, max: 7 }, "manual resource edits persist through the existing document write APIs");
const manualContext = {};
prepareActorHealthResourceContext(manualContext, projectedActor, { isEditMode: true, sourceSystem: source.system });
assert.equal(manualContext.armorCharge.maxInput, 7, "maximum editor uses the authored value even while unarmored");
assert.equal(manualContext.armorCharge.valueInput, 4, "current editor uses the authored value even while unarmored");
await projectedActor.setPeasantResourceMax("armorCharge", 3);
assert.deepEqual(projectedActor.system.armorCharge, { value: 3, max: 3 }, "lowering the manual maximum clamps current charges using the shared resource behavior");

function restDocument() {
  const restActor = Object.assign(Object.create(PeasantActor.prototype), {
    type: "character",
    system: {
      armorCharge: { value: 0, max: 2 },
      stamina: { value: 0, max: 3 },
      attunement: { value: 0, max: 2 },
      capacity: { value: 0, max: 2 },
      physicalStressCount: 0,
      mentalStressCount: 0,
      generalStressCount: 0,
      health: { value: 8, max: 10 },
      temporaryHp: { value: 0, max: 2 },
      bolsteredHp: 0,
      hp: { rows: 1, cols: 10, grid: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] },
      conditions: {}
    },
    getFlag: (_scope, key) => key === "simplifiedHp",
    updatePatches: [],
    updatePeasantStateData: async (patch) => restActor.updatePatches.push(structuredClone(patch))
  });
  return restActor;
}

for (const method of ["performPeasantShortRest", "performPeasantLongRest", "refreshPeasantResourcesAndResetTracks"]) {
  const restingActor = restDocument();
  const result = await restingActor[method]();
  assert.equal(result.ok, true, `${method} remains available`);
  assert.equal(restingActor.updatePatches.length, 1, `${method} keeps its normal single state update`);
  assert.equal(
    Object.hasOwn(restingActor.updatePatches[0], "system.armorCharge.value"),
    false,
    `${method} no longer includes Armor Charge in resource refreshes`
  );
}

const restControlsTemplate = readFileSync(new URL("../module/applications/actor/controls/rest-controls.mjs", import.meta.url), "utf8");
assert.doesNotMatch(restControlsTemplate, /refresh stamina, attunement, armor charge/i, "rest copy no longer says Armor Charge refreshes");

console.log("E5 active armor pure rules passed.");
