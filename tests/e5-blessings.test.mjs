import assert from "node:assert/strict";

class TestField {
  constructor(options = {}) { this.options = options; }
}
class TestSchemaField extends TestField {
  constructor(fields, options = {}) { super(options); this.fields = fields; }
}
class TestArrayField extends TestField {
  constructor(model, options = {}) { super(options); this.model = model; }
}

globalThis.foundry = {
  abstract: { DataModel: class {} },
  data: {
    fields: new Proxy({}, {
      get(_target, key) {
        if (key === "SchemaField") return TestSchemaField;
        if (key === "ArrayField") return TestArrayField;
        return TestField;
      }
    })
  },
  utils: {
    deepClone: structuredClone,
    getProperty(root, path) { return String(path).split(".").filter(Boolean).reduce((value, key) => value?.[key], root); }
  }
};
globalThis.Actor = class {
  async _preUpdate() { return true; }
};

const [{ computeBaseSaves, computeBaseAttrToHits }, { PeasantActor }, { PeasantCharacterModel }] = await Promise.all([
  import("../module/data/actor/attributes.mjs"),
  import("../module/documents/actor.mjs"),
  import("../module/data/actor/character.mjs")
]);
const { prepareActorAttributeContext } = await import("../module/data/actor/sheet-display/attributes.mjs");
const { setupBlessingControls } = await import("../module/applications/actor/controls/blessing-controls.mjs");
const { getPeasantCoreSettingGroups } = await import("../module/data/actor/sheet-settings.mjs");

function setPath(root, path, value) {
  const parts = String(path).split(".").filter(Boolean);
  let target = root;
  while (parts.length > 1) {
    const key = parts.shift();
    target[key] ??= {};
    target = target[key];
  }
  target[parts[0]] = structuredClone(value);
}

function applyUpdateObject(target, update) {
  for (const [key, value] of Object.entries(update)) {
    if (key.includes(".")) setPath(target, key.replace(/^system\./, ""), value);
    else if (key === "system" && value && typeof value === "object") applyUpdateObject(target, value);
    else target[key] = structuredClone(value);
  }
}

function makeFallActor({ edgeValue = 0, edgeMax = 4, fallValue = 1, fallMax = 2, blessing = "fall", preparedEdgeMax = null } = {}) {
  const sourceSystem = {
    edge: { value: edgeValue, max: edgeMax },
    fallBlessingUses: { value: fallValue, max: fallMax },
    blessing: { type: blessing },
    hp: { rows: 1, cols: 1, grid: [[0]] },
    health: { value: 1, max: 1 },
    temporaryHp: { value: 0, max: 0 },
    conditions: { overcharged: false },
    stamina: { value: 0, max: 0 },
    attunement: { value: 0, max: 0 },
    capacity: { value: 0, max: 0 },
    physicalStressCount: 0,
    mentalStressCount: 0,
    generalStressCount: 0,
    devastatingWounds: 0
  };
  const system = structuredClone(sourceSystem);
  if (preparedEdgeMax !== null) system.edge.max = preparedEdgeMax;
  return Object.assign(Object.create(PeasantActor.prototype), {
    type: "character",
    system,
    _source: { system: structuredClone(sourceSystem) },
    updates: [],
    getFlag: () => undefined,
    async update(update, options = {}) {
      const changed = structuredClone(update);
      const result = await this._preUpdate(changed, options, {});
      if (result === false) return false;
      this.updates.push(structuredClone(changed));
      applyUpdateObject(this.system, changed);
      applyUpdateObject(this._source.system, changed);
      return this;
    },
    async updatePeasantStateData(update, options = {}) {
      return this.update(update, { ...options, peasantCore: { ...options.peasantCore, stateWrite: true } });
    },
    async updatePeasantSourceData(update, options = {}) {
      return this.update(update, { ...options, peasantCore: { ...options.peasantCore, sourceWrite: true } });
    }
  });
}

const baseSystem = {
  build: 3,
  reflex: 4,
  intuition: 5,
  learn: 6,
  charisma: 7,
  blessing: { type: "", target: "" },
  toHitPenaltyTarget: ""
};
assert.deepEqual(computeBaseSaves(baseSystem), { build: 12, reflex: 10, intuition: 8, learn: 6, charisma: 4 });

{
  const spring = { ...baseSystem, blessing: { type: "spring", target: "charisma" } };
  assert.deepEqual(computeBaseSaves(spring), { build: 12, reflex: 10, intuition: 8, learn: 4, charisma: 4 }, "Spring always improves Learn, ignoring a legacy target");
}

for (const type of ["summer", "fall", "winter"]) {
  assert.deepEqual(
    computeBaseSaves({ ...baseSystem, blessing: { type, target: "build" } }),
    computeBaseSaves(baseSystem),
    `${type} does not change any current Basic Attribute Save`
  );
}

const ordinaryCharacteristics = { Strength: 11, Dexterity: 9, Mental: 7, Social: 6 };
assert.deepEqual(computeBaseAttrToHits(baseSystem), ordinaryCharacteristics);
for (const type of ["summer", "fall", "winter"]) {
  assert.deepEqual(
    computeBaseAttrToHits({ ...baseSystem, blessing: { type, target: "build" } }),
    ordinaryCharacteristics,
    `${type} does not replace Characteristic To-Hit formulas`
  );
}
assert.deepEqual(
  computeBaseAttrToHits({ ...baseSystem, blessing: { type: "summer", target: "learn" }, toHitPenaltyTarget: "Strength" }),
  { ...ordinaryCharacteristics, Strength: 10 },
  "The independent Strength penalty remains −1 with Summer"
);

{
  const actor = Object.assign(Object.create(PeasantActor.prototype), {
    type: "character",
    system: { ...baseSystem, blessing: { type: "spring", target: "charisma" }, combatMods: { toHit: 0 } },
    effects: [],
    items: [],
    getFlag: () => undefined
  });
  const data = {};
  prepareActorAttributeContext(data, actor);
  assert.equal(data.attributes.learnSave, "4+", "The sheet uses Spring's fixed Learn Save");
  assert.equal(data.attributes.charismaSave, "4+", "A legacy target does not redirect Spring on the sheet");
  assert.deepEqual(data.isBlessed, { build: false, reflex: false, intuition: false, learn: true, charisma: false });

  actor.system.blessing = { type: "summer", target: "build" };
  const summerData = {};
  prepareActorAttributeContext(summerData, actor);
  assert.equal(summerData.attributes.strToHit, "11+");
  assert.deepEqual(summerData.isBlessed, { build: false, reflex: false, intuition: false, learn: false, charisma: false });

}

{
  const actor = makeFallActor({ blessing: "spring", fallValue: 1, fallMax: 2 });
  const groups = getPeasantCoreSettingGroups(actor);
  const blessingsIndex = groups.findIndex(group => group.label === "Blessings");
  assert.equal(blessingsIndex, groups.findIndex(group => group.label === "Miscellaneous") - 1);
  const choices = groups[blessingsIndex].settings;
  assert.deepEqual(choices.map(choice => choice.blessingType), ["spring", "summer", "fall", "winter"]);
  assert.deepEqual(choices.map(choice => choice.checked), [true, false, false, false]);
  assert.ok(getPeasantCoreSettingGroups(actor, false).find(group => group.label === "Blessings").settings.every(setting => !setting.editable));

  const makeInput = (dataset, value = "", checked = false) => ({
    dataset, value, checked,
    addEventListener(type, callback) { if (type === "change") this.change = callback; }
  });
  const seasonInputs = choices.map(choice => makeInput({ blessingType: choice.blessingType }, "", choice.checked));
  const currentInput = makeInput({ fallUseField: "value" }, "4");
  const maxInput = makeInput({ fallUseField: "max" }, "5");
  const root = {
    nodeType: 1,
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === ".pc-blessing-choice") return seasonInputs;
      if (selector === ".pc-fall-blessing-uses-input") return [currentInput, maxInput];
      return [];
    },
    addEventListener() {},
    contains() { return true; }
  };
  const sheet = { isEditMode: true, actor };
  const change = async input => {
    assert.equal(typeof input.change, "function", "Configuration inputs bind their save action");
    await input.change({ currentTarget: input, preventDefault() {}, stopPropagation() {} });
  };
  setupBlessingControls(sheet, root);

  seasonInputs[2].checked = true;
  await change(seasonInputs[2]);
  assert.equal(actor.system.blessing.type, "fall", "Changing the configuration selects Fall immediately");
  assert.deepEqual(seasonInputs.map(input => input.checked), [false, false, true, false], "Only one blessing remains selected");
  assert.deepEqual(actor.system.fallBlessingUses, { value: 1, max: 2 }, "Selecting Fall preserves stored uses");
  const fallSettings = getPeasantCoreSettingGroups(actor).find(group => group.label === "Blessings").settings;
  assert.deepEqual(fallSettings.filter(setting => setting.fallUseField).map(setting => [setting.fallUseField, setting.value]), [["value", 1], ["max", 2]]);

  await change(currentInput);
  assert.deepEqual(actor.system.fallBlessingUses, { value: 2, max: 2 }, "Current uses still clamp to the stored maximum");
  await change(maxInput);
  assert.deepEqual(actor.system.fallBlessingUses, { value: 2, max: 5 }, "Editing maximum uses preserves current uses");

  const updateActor = actor.update.bind(actor);
  let releaseUpdate;
  let signalUpdateStarted;
  const updateStarted = new Promise(resolve => { signalUpdateStarted = resolve; });
  const delayedUpdate = new Promise(resolve => { releaseUpdate = resolve; });
  let delayNextUpdate = true;
  actor.update = async (...args) => {
    if (delayNextUpdate) {
      delayNextUpdate = false;
      signalUpdateStarted();
      await delayedUpdate;
    }
    return updateActor(...args);
  };
  maxInput.value = "7";
  const maximumSave = change(maxInput);
  await updateStarted;
  currentInput.value = "4";
  const currentSave = change(currentInput);
  currentInput.value = "6";
  releaseUpdate();
  await Promise.all([maximumSave, currentSave]);
  assert.deepEqual(actor.system.fallBlessingUses, { value: 4, max: 7 }, "Rapid Maximum and Uses edits preserve both values while a save is pending");
  assert.equal(currentInput.value, "6", "A pending save captures its value without overwriting a newer input draft");

  seasonInputs[3].checked = true;
  await change(seasonInputs[3]);
  assert.equal(actor.system.blessing.type, "winter");
  assert.equal(getPeasantCoreSettingGroups(actor).find(group => group.label === "Blessings").settings.length, 4, "Fall-only fields disappear for other blessings");
  seasonInputs[3].checked = false;
  await change(seasonInputs[3]);
  assert.equal(actor.system.blessing.type, "", "Unchecking the active blessing clears it");
  assert.deepEqual(actor.system.fallBlessingUses, { value: 4, max: 7 }, "Clearing the blessing preserves Fall uses");

  sheet.isEditMode = false;
  seasonInputs[0].checked = true;
  await change(seasonInputs[0]);
  await change(currentInput);
  assert.equal(actor.system.blessing.type, "", "View mode cannot change blessings");
  assert.deepEqual(actor.system.fallBlessingUses, { value: 4, max: 7 }, "View mode cannot edit Fall uses");
}

{
  const schema = PeasantCharacterModel.defineSchema();
  assert.deepEqual(Object.keys(schema.blessing.fields), ["type"], "Blessing schema stores only the season");
}

{
  const actor = Object.assign(Object.create(PeasantActor.prototype), {
    system: { blessing: { type: "", target: "learn" } },
    updates: [],
    async updatePeasantStateData(update) {
      this.updates.push(structuredClone(update));
      this.system.blessing = structuredClone(update["system.blessing"]);
    }
  });
  const result = await actor.setPeasantBlessing("spring", "charisma");
  assert.deepEqual(result.blessing, { type: "spring" }, "A legacy second argument cannot recreate a target");
  assert.deepEqual(actor.updates.at(-1)["system.blessing"], { type: "spring" });
  assert.equal(PeasantActor.prototype.setPeasantBlessing.length, 1, "The setter has no target parameter");

  await actor.setPeasantBlessing("invalid", "build");
  assert.deepEqual(actor.system.blessing, { type: "" }, "Invalid season normalizes to an empty targetless Blessing");
  await actor.clearPeasantBlessing();
  assert.deepEqual(actor.system.blessing, { type: "" });
}

{
  const schema = PeasantCharacterModel.defineSchema();
  assert.deepEqual(Object.keys(schema.fallBlessingUses.fields), ["value", "max"]);
  assert.equal(schema.fallBlessingUses.fields.value.options.initial, 0);
  assert.equal(schema.fallBlessingUses.fields.max.options.initial, 1);

  for (const [edgeMax, expected] of [[0, 1], [1, 1], [2, 1], [3, 1], [4, 2], [5, 2]]) {
    const actor = makeFallActor({ edgeValue: 99, edgeMax, fallMax: expected });
    assert.equal(actor.getPeasantFallBlessingUseCapacity(), expected, `Fall capacity derives from max Edge ${edgeMax}, not current Edge`);
  }

  const positiveOffset = makeFallActor({ edgeMax: 4, fallValue: 2, fallMax: 3, preparedEdgeMax: 9 });
  await positiveOffset.update({ "system.edge.max": 6 });
  assert.deepEqual(positiveOffset.system.fallBlessingUses, { value: 2, max: 4 }, "A positive manual offset survives a flat Edge-max update without refilling current uses");

  const negativeOffset = makeFallActor({ edgeMax: 4, fallValue: 0, fallMax: 0 });
  await negativeOffset.update({ "system.edge.max": 6 });
  assert.equal(negativeOffset.system.fallBlessingUses.max, 1, "Negative Fall-use offsets survive Edge increases");
  await negativeOffset.update({ "system.edge.max": 0 });
  assert.equal(negativeOffset.system.fallBlessingUses.max, 0, "Derived changes clamp a negative manual maximum at zero");

  const decreasingEdge = makeFallActor({ edgeMax: 4, fallValue: 3, fallMax: 3 });
  await decreasingEdge.update({ "system.edge.max": 0 });
  assert.deepEqual(decreasingEdge.system.fallBlessingUses, { value: 2, max: 2 }, "Edge decreases adjust Fall maximum and clamp current uses without refilling");

  const nestedUpdate = makeFallActor({ edgeMax: 4, fallValue: 1, fallMax: 2 });
  await nestedUpdate.update({ system: { edge: { max: 6 } } });
  assert.deepEqual(nestedUpdate.system.fallBlessingUses, { value: 1, max: 3 }, "Nested persisted Edge updates use the same adjustment");

  const resourceSetter = makeFallActor({ edgeMax: 4, edgeValue: 1, fallValue: 1, fallMax: 2 });
  await resourceSetter.setPeasantResourceMax("edge", 6);
  assert.deepEqual(resourceSetter.system.fallBlessingUses, { value: 1, max: 3 }, "The existing Edge resource setter gets the same derived adjustment");

  const explicitRestore = makeFallActor({ edgeMax: 4, fallValue: 1, fallMax: 2 });
  await explicitRestore.update({ system: { edge: { max: 6 }, fallBlessingUses: { value: 7, max: 9 } } });
  assert.deepEqual(explicitRestore.system.fallBlessingUses, { value: 7, max: 9 }, "Explicit Fall values are authoritative during migration or undo");

  const explicitCurrent = makeFallActor({ edgeMax: 4, fallValue: 1, fallMax: 3 });
  await explicitCurrent.update({ system: { edge: { max: 6 }, fallBlessingUses: { value: 2 } } });
  assert.deepEqual(explicitCurrent.system.fallBlessingUses, { value: 2, max: 4 }, "An explicit current value is preserved while an unprovided maximum follows Edge");

  const manual = makeFallActor({ edgeMax: 4, fallValue: 1, fallMax: 2 });
  await manual.setPeasantFallBlessingUses({ value: 8, max: 5 });
  assert.deepEqual(manual.system.fallBlessingUses, { value: 5, max: 5 }, "Manual current uses clamp to the selected maximum");
  await manual.setPeasantFallBlessingUses({ value: -4, max: -2 });
  assert.deepEqual(manual.system.fallBlessingUses, { value: 0, max: 0 }, "Manual Fall values normalize to non-negative integers");

  const fallRest = makeFallActor({ edgeMax: 4, fallValue: 1, fallMax: 3, blessing: "fall" });
  await fallRest.performPeasantLongRest();
  assert.deepEqual(fallRest.system.fallBlessingUses, { value: 3, max: 3 }, "Fall Long Rest refills the stored maximum without recalculating it");

  const nonFallRest = makeFallActor({ edgeMax: 4, fallValue: 0, fallMax: 4, blessing: "summer" });
  await nonFallRest.performPeasantLongRest();
  assert.deepEqual(nonFallRest.system.fallBlessingUses, { value: 0, max: 4 }, "Non-Fall Long Rest neither grants uses nor changes the stored maximum");
  await nonFallRest.setPeasantBlessing("fall");
  assert.deepEqual(nonFallRest.system.fallBlessingUses, { value: 0, max: 4 }, "Changing Blessing never grants, refills, or recalculates uses");

  for (const spend of [1, 2, 3, 4]) {
    const actor = makeFallActor({ edgeMax: 4, fallValue: 4, fallMax: 4 });
    const result = await actor.spendPeasantFallBlessingUses(spend);
    assert.equal(result.ok, true, `Spending ${spend} uses succeeds atomically`);
    assert.equal(actor.system.fallBlessingUses.value, 4 - spend);
    assert.equal(actor.updates.length, 1, "Each spend uses one state update");
  }

  for (const invalidSpend of [0, 1.5, 5]) {
    const actor = makeFallActor({ edgeMax: 4, fallValue: 4, fallMax: 4 });
    assert.equal((await actor.spendPeasantFallBlessingUses(invalidSpend)).ok, false);
    assert.equal(actor.system.fallBlessingUses.value, 4);
    assert.equal(actor.updates.length, 0);
  }
  const nonFall = makeFallActor({ edgeMax: 4, fallValue: 2, fallMax: 2, blessing: "spring" });
  assert.equal((await nonFall.spendPeasantFallBlessingUses(1)).ok, false);
  const empty = makeFallActor({ edgeMax: 4, fallValue: 0, fallMax: 2 });
  assert.equal((await empty.spendPeasantFallBlessingUses(1)).ok, false);
}

delete globalThis.Actor;

console.log("E5 Blessing tests passed");
