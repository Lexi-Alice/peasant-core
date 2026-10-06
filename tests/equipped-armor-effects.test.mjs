import assert from "node:assert/strict";

import { prepareActorSheetBaseContext } from "../module/data/actor/sheet-display/base.mjs";
import { prepareActorHealthResourceContext } from "../module/data/actor/sheet-display/health-resources.mjs";
import { prepareActorAttributeContext } from "../module/data/actor/sheet-display/attributes.mjs";
import { getHighestHaltDamageLocation, getLowestHaltDamageLocation } from "../module/data/actor/targeted-damage.mjs";
import { getArmorAdjustedMovement, getEquippedArmorEffects, removeEquippedArmorMovement } from "../module/data/actor/equipped-armor.mjs";

globalThis.game = {
  settings: {
    get: () => undefined
  }
};

function armor(category, armorData, equipped = true) {
  return {
    type: "equipment",
    system: {
      category,
      equipped,
      armor: armorData
    }
  };
}

function armorSkill(classLevel, rank = "0") {
  return { category: "martial", type: "Defense", defenseType: "Armor", class: classLevel, rank };
}

const actor = {
  system: {
    haltValues: [1, 2, 3, 4],
    movement: 12,
    skills: [armorSkill(4, "0")],
    combatMods: { haltBuffs: [] }
  },
  items: [
    armor("light-armor", { haltValues: [1, 0, 0, 0], hardHead: true, movementProfile: "1" }),
    armor("medium-armor", { haltValues: [0, 2, 0, 0], hardArms: true, movementProfile: "+2" }),
    armor("heavy-armor", { haltValues: [0, 0, 3, 5], hardTorso: true, movementProfile: "3" }),
    armor("heavy-armor", { haltValues: [9, 9, 9, 9], movementProfile: "9" }, false),
    armor("shield", { haltValues: [9, 9, 9, 9], movementProfile: "9" })
  ],
  getFlag: () => undefined
};

const data = {};
prepareActorSheetBaseContext(data, actor, {
  isEditMode: true,
  sourceSystem: actor.system
});

assert.equal(data.haltValuesInput, "2/4/6/9", "all three equipped armor categories should add their HALT to the editable total");
assert.equal(data.movementInput, 18, "positive equipped armor Movement Profiles should increase editable Movement");
assert.deepEqual(
  data.portraitStats,
  { movement: 18, run: 36, sprint: 108, initiative: "+0" },
  "Run and Sprint should derive from Movement after equipped armor modifiers"
);

const negativeMovementActor = {
  ...actor,
  system: { ...actor.system, movement: 12 },
  items: [armor("light-armor", { movementProfile: "-2" })]
};
const negativeMovementData = {};
prepareActorSheetBaseContext(negativeMovementData, negativeMovementActor, {
  isEditMode: true,
  sourceSystem: negativeMovementActor.system
});
assert.deepEqual(
  negativeMovementData.portraitStats,
  { movement: 10, run: 20, sprint: 60, initiative: "+0" },
  "a -2 equipped Movement Profile should reduce Movement, Run, and Sprint"
);

const untrainedMediumActor = {
  system: { movement: 12, skills: [], haltValues: [], combatMods: { haltBuffs: [] } },
  items: [armor("medium-armor", { movementProfile: "+1" })]
};
const untrainedMediumData = {};
prepareActorSheetBaseContext(untrainedMediumData, untrainedMediumActor, {
  isEditMode: true,
  sourceSystem: untrainedMediumActor.system
});
assert.equal(untrainedMediumData.portraitStats.movement, 13, "Medium armor applies only its authored Movement Profile without a class penalty");
assert.equal(untrainedMediumData.movementInput, 13, "edit mode shows the same effective movement as the portrait");
assert.equal(
  getArmorAdjustedMovement(12, getEquippedArmorEffects(untrainedMediumActor)),
  13,
  "the shared effective calculation includes only equipped item movement modifiers"
);
assert.equal(
  removeEquippedArmorMovement(13, getEquippedArmorEffects(untrainedMediumActor)),
  12,
  "removing item modifiers recovers the authored movement base"
);

const trainedMediumActor = {
  ...untrainedMediumActor,
  system: { ...untrainedMediumActor.system, skills: [armorSkill(3, "1")] }
};
const trainedMediumData = {};
prepareActorSheetBaseContext(trainedMediumData, trainedMediumActor, {
  isEditMode: true,
  sourceSystem: trainedMediumActor.system
});
assert.equal(trainedMediumData.portraitStats.movement, 13, "a trained Medium wearer keeps only the authored item movement profile");

const healthData = {};
prepareActorHealthResourceContext(healthData, actor, { sourceSystem: actor.system });
assert.deepEqual(
  healthData.haltDisplay,
  [
    { value: "2", isHard: true },
    { value: "4", isHard: true },
    { value: "6", isHard: false },
    { value: "9", isHard: true }
  ],
  "the HALT display should include equipped armor values and Hard locations"
);
assert.deepEqual(
  {
    head: healthData.haltHardHead,
    arms: healthData.haltHardArms,
    legs: healthData.haltHardLegs,
    torso: healthData.haltHardTorso
  },
  { head: true, arms: true, legs: false, torso: true },
  "the sheet's HALT letters should show Hard locations granted by equipped armor"
);

globalThis.Actor = class {};
const { PeasantActor } = await import("../module/documents/actor.mjs");
const { getActorAoeReflexSaveTn, rollAoeReflexSaveForTarget } = await import("../module/applications/combat/aoe-reflex-save.mjs");
const actorDocument = Object.assign(Object.create(PeasantActor.prototype), {
  items: actor.items,
  system: actor.system,
  updatePeasantSourceData: async (update) => {
    actorDocument.lastSourceUpdate = update;
  }
});

await actorDocument.setPeasantHaltValues("7/8/9/10");
assert.deepEqual(
  actorDocument.lastSourceUpdate,
  { "system.haltValues": [6, 6, 6, 5] },
  "editing effective HALT should preserve only the manual value after equipped armor is removed"
);

const torsoArmor = armor("heavy-armor", { haltValues: [0, 0, 0, 5] });
const torsoActor = {
  system: { haltValues: [0, 0, 0, 0], movement: 0, combatMods: { haltBuffs: [] } },
  items: [torsoArmor],
  getFlag: () => undefined
};
const torsoActorDocument = Object.assign(Object.create(PeasantActor.prototype), {
  items: torsoActor.items,
  updatePeasantSourceData: async (update) => {
    torsoActorDocument.lastSourceUpdate = update;
  }
});
await torsoActorDocument.setPeasantHaltValues("0/0/0/10");
torsoActor.system.haltValues = torsoActorDocument.lastSourceUpdate["system.haltValues"];
torsoArmor.system.equipped = false;
const unequippedTorsoData = {};
prepareActorSheetBaseContext(unequippedTorsoData, torsoActor, { isEditMode: true, sourceSystem: torsoActor.system });
assert.equal(unequippedTorsoData.haltValuesInput, "0/0/0/5", "unequipping should leave the manually edited torso HALT base");
torsoArmor.system.equipped = true;
const reequippedTorsoData = {};
prepareActorSheetBaseContext(reequippedTorsoData, torsoActor, { isEditMode: true, sourceSystem: torsoActor.system });
assert.equal(reequippedTorsoData.haltValuesInput, "0/0/0/10", "re-equipping should restore the armor's torso HALT contribution");

await actorDocument.setPeasantMovement(10);
assert.deepEqual(
  actorDocument.lastSourceUpdate,
  { "system.movement": 4 },
  "editing effective Movement should preserve the unarmored manual value"
);

const untrainedMediumDocument = Object.assign(Object.create(PeasantActor.prototype), {
  system: untrainedMediumActor.system,
  items: untrainedMediumActor.items,
  updatePeasantSourceData: async (update) => {
    untrainedMediumDocument.lastSourceUpdate = update;
  }
});
await untrainedMediumDocument.setPeasantMovement(13);
assert.deepEqual(
  untrainedMediumDocument.lastSourceUpdate,
  { "system.movement": 12 },
  "saving effective Movement removes only the item contribution"
);

const untrainedHeavyDocument = Object.assign(Object.create(PeasantActor.prototype), {
  system: { movement: 1, skills: [] },
  _source: { system: { movement: 1, skills: [] } },
  items: [armor("heavy-armor", { movementProfile: "-3" })],
  async updatePeasantSourceData(update) {
    this.lastSourceUpdate = update;
    this._source.system.movement = update["system.movement"];
    this.system.movement = update["system.movement"];
  }
});
const flooredMovementData = {};
prepareActorSheetBaseContext(flooredMovementData, untrainedHeavyDocument, {
  isEditMode: true, sourceSystem: untrainedHeavyDocument._source.system
});
assert.equal(flooredMovementData.movementInput, 0);
await untrainedHeavyDocument.setPeasantMovement(0);
assert.equal(untrainedHeavyDocument.lastSourceUpdate["system.movement"], 1, "saving floored zero preserves the existing manual Movement base");
untrainedHeavyDocument.items[0].system.equipped = false;
const revealedMovementData = {};
prepareActorSheetBaseContext(revealedMovementData, untrainedHeavyDocument, { sourceSystem: untrainedHeavyDocument._source.system });
assert.equal(revealedMovementData.portraitStats.movement, 1, "removing Heavy armor reveals the authored base");
untrainedHeavyDocument.items[0].system.equipped = true;
await untrainedHeavyDocument.setPeasantMovement(5);
assert.equal(untrainedHeavyDocument.lastSourceUpdate["system.movement"], 8, "changed positive values remove the authored item movement modifier");
untrainedHeavyDocument.system.movement = 20;
await untrainedHeavyDocument.setPeasantMovement(5);
assert.equal(untrainedHeavyDocument.lastSourceUpdate["system.movement"], 8, "an unchanged editable total never projects a prepared effect into the source base");

const damageActor = new PeasantActor();
damageActor.type = "character";
damageActor.system = {
  haltValues: [0, 0, 0, 0],
  naturalHaltValues: [0, 0, 0, 0],
  combatMods: { haltBuffs: [] },
  health: { value: 20, max: 20 },
  temporaryHp: { value: 0, max: 0 },
  bolsteredHp: 0,
  conditions: {}
};
damageActor.items = [armor("heavy-armor", { haltValues: [0, 0, 0, 5], hardTorso: true })];
damageActor.effects = [];
damageActor.getFlag = (_scope, key) => key === "simplifiedHp" ? true : undefined;
damageActor._applyPeasantSimplifiedHpDamageValue = async (scaledDamage) => {
  damageActor.lastScaledDamage = scaledDamage;
  return { ok: true, value: 20 - scaledDamage, scaledDamage, tempUsed: 0, bolsteredUsed: 0 };
};

const damageResult = await damageActor.applyPeasantTargetedDamage({ amount: 10, type: "lethal", location: "Torso" });
assert.equal(damageResult.haltUsed, 5, "equipped armor HALT should reduce targeted damage");
assert.equal(damageActor.lastScaledDamage, 8, "an equipped armor Hard location should convert lethal damage");

const locationActor = {
  system: {
    haltValues: [4, 4, 4, 0],
    naturalHaltValues: [0, 0, 0, 0],
    combatMods: { haltBuffs: [] }
  },
  items: [armor("heavy-armor", { haltValues: [0, 0, 0, 5] })]
};
assert.equal(getHighestHaltDamageLocation(locationActor), "Torso", "area damage should see armor when choosing the highest-HALT location");
assert.equal(getLowestHaltDamageLocation(locationActor), "Head", "area blast should see armor when choosing the lowest-HALT location");

const aoeActor = {
  system: {
    build: 5,
    reflex: 5,
    intuition: 5,
    learn: 5,
    charisma: 5,
    reflexAoeSaveEnabled: true,
    reflexAoeSaveTarget: 8,
    combatMods: { toHit: 0 }
  },
  items: [
    armor("light-armor", { aoeSaveModifier: "+1" }),
    armor("medium-armor", { aoeSaveModifier: "2" })
  ],
  getFlag: () => undefined
};
assert.equal(getActorAoeReflexSaveTn(aoeActor), 11, "equipped numeric armor modifiers should add to the AoE Reflex Save target");

const aoeSheetData = {};
prepareActorAttributeContext(aoeSheetData, aoeActor, { isEditMode: true, sourceSystem: aoeActor.system });
assert.equal(aoeSheetData.reflexAoeSaveTarget, "11", "the editable AoE target should show the equipped armor modifier");

const inheritedAoeActor = {
  ...aoeActor,
  system: {
    ...aoeActor.system,
    reflexAoeSaveEnabled: false,
    reflexAoeSaveTarget: null
  }
};
const inheritedAoeSheetData = {};
prepareActorAttributeContext(inheritedAoeSheetData, inheritedAoeActor, { sourceSystem: inheritedAoeActor.system });
assert.equal(inheritedAoeSheetData.reflexAoeSaveDisplay, "11+", "armor should show its AoE modifier when the actor uses the normal Reflex Save target");

const { setupCombatModifierControls } = await import("../module/applications/actor/controls/combat-modifier-controls.mjs");
const rootListeners = new Map();
const root = {
  nodeType: 1,
  querySelector: () => null,
  querySelectorAll: () => [],
  contains: () => true,
  addEventListener: (type, listener) => {
    const listeners = rootListeners.get(type) ?? [];
    listeners.push(listener);
    rootListeners.set(type, listeners);
  },
  removeEventListener: () => {}
};
let addedAoeTarget = null;
setupCombatModifierControls({
  actor: {
    ...inheritedAoeActor,
    setPeasantReflexAoeSave: async (_enabled, target) => {
      addedAoeTarget = target;
    }
  },
  element: root,
  isEditable: true,
  isEditMode: true
}, root);
const addAoeTarget = {
  closest: (selector) => selector === ".reflex-aoe-add" ? addAoeTarget : null
};
await Promise.all((rootListeners.get("click") ?? []).map(listener => listener({
  target: addAoeTarget,
  preventDefault: () => {},
  stopPropagation: () => {}
})));
assert.equal(addedAoeTarget, "11", "adding a custom AoE target should seed the effective armored save value");

const aoeActorDocument = Object.assign(Object.create(PeasantActor.prototype), {
  items: aoeActor.items,
  updatePeasantSourceData: async (update) => {
    aoeActorDocument.lastSourceUpdate = update;
  }
});
await aoeActorDocument.setPeasantReflexAoeSave(true, "12");
assert.deepEqual(
  aoeActorDocument.lastSourceUpdate,
  {
    "system.reflexAoeSaveEnabled": true,
    "system.reflexAoeSaveTarget": 9
  },
  "editing an effective AoE target should preserve its unarmored manual value"
);

globalThis.Roll = class {
  constructor() {
    throw new Error("CS armor should not construct a roll");
  }
};
const csActor = {
  ...aoeActor,
  items: [armor("heavy-armor", { aoeSaveModifier: "CS" })]
};
let csResult;
await assert.doesNotReject(async () => {
  csResult = await rollAoeReflexSaveForTarget({ targetActor: csActor });
}, "CS armor should automatically fail without rolling");
assert.deepEqual(csResult, {
  toHit: null,
  rollResult: null,
  passed: false,
  automaticFailure: true
});
const csSheetData = {};
prepareActorAttributeContext(csSheetData, csActor, { sourceSystem: csActor.system });
assert.equal(csSheetData.reflexAoeSaveDisplay, "CS", "CS armor should show automatic failure on the character sheet");
assert.equal(csSheetData.reflexAoeSaveTn, null, "CS armor should not expose a rollable AoE target");
assert.equal(csSheetData.reflexAoeSaveAutoFail, true);

delete globalThis.Roll;
delete globalThis.Actor;
delete globalThis.game;

console.log("equipped armor effect tests passed");
