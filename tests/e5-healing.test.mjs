import assert from "node:assert/strict";
import { withActiveEffectDocuments } from "./helpers/active-effect-documents.mjs";

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
globalThis.Actor = class {};

const [{ PeasantActor }, { HPGridModel }] = await Promise.all([
  import("../module/documents/actor.mjs"),
  import("../module/data/actor/hp-model.mjs")
]);
const { PeasantCharacterModel } = await import("../module/data/actor/character.mjs");
const { normalizeAutomatedCombatHealType, getAutomatedCombatHealTypeLabel } = await import("../module/applications/combat/automated-heal-rolls.mjs");

function makeActor({ grid = [[0]], temporaryHp = 0, health, maxHealth, bolsteredHp = 0, simplified = false, conditions = {}, devastatingWounds = 0, build = 5, blessing = "" } = {}) {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const hp = Object.assign(Object.create(HPGridModel.prototype), { rows, cols, grid: structuredClone(grid) });
  const damagedCells = grid.flat().filter((cell) => cell > 0).length;
  const actor = Object.assign(Object.create(PeasantActor.prototype), {
    type: "character",
    system: {
      hp,
      health: { value: health ?? rows * cols - damagedCells, max: maxHealth ?? rows * cols },
      temporaryHp: { value: temporaryHp, max: temporaryHp },
      bolsteredHp,
      conditions: structuredClone(conditions),
      devastatingWounds,
      build,
      blessing: { type: blessing },
      generalStressCount: 4
    },
    updates: [],
    getFlag: (_scope, key) => key === "simplifiedHp" && simplified ? true : undefined,
    async canUserModify() { return true; },
    async updatePeasantStateData(update) {
      this.updates.push(structuredClone(update));
      for (const [path, value] of Object.entries(update)) {
        const parts = path.replace(/^system\./, "").split(".");
        let target = this.system;
        while (parts.length > 1) target = target[parts.shift()];
        target[parts[0]] = structuredClone(value);
      }
    },
    async update(update) { return this.updatePeasantStateData(update); }
  });
  return withActiveEffectDocuments(actor);
}

{
  const ordinary = makeActor({ grid: [[1, 1, 1, 1, 2, 3]] });
  const ordinaryUpdates = ordinary.addPeasantLongRestHpRecoveryUpdates({});
  assert.deepEqual(ordinaryUpdates["system.hp.grid"], [[1, 1, 0, 0, 2, 3]], "Ordinary rest heals at most two Blunt cells before other damage types");
  assert.equal(ordinaryUpdates["system.temporaryHp.value"], 4, "Rest fills Temporary HP to the remaining damaged-cell capacity");

  const summerBlunt = makeActor({ grid: [[1, 1, 1, 1, 2, 3]], blessing: "summer" });
  const summerBluntUpdates = summerBlunt.addPeasantLongRestHpRecoveryUpdates({});
  assert.deepEqual(summerBluntUpdates["system.hp.grid"], [[0, 0, 0, 0, 2, 3]], "Summer doubles the Blunt budget without changing type priority");
  assert.equal(summerBluntUpdates["system.temporaryHp.value"], 2);

  const ordinaryLethal = makeActor({ grid: [[2, 2, 3]] }).addPeasantLongRestHpRecoveryUpdates({});
  assert.deepEqual(ordinaryLethal["system.hp.grid"], [[2, 0, 3]], "Ordinary rest heals one Lethal cell only when no Blunt remains");
  const summerLethal = makeActor({ grid: [[2, 2, 3]], blessing: "summer" }).addPeasantLongRestHpRecoveryUpdates({});
  assert.deepEqual(summerLethal["system.hp.grid"], [[0, 0, 3]], "Summer heals two Lethal cells when no Blunt remains");
  const summerCritical = makeActor({ grid: [[3, 3]], blessing: "summer" }).addPeasantLongRestHpRecoveryUpdates({});
  assert.deepEqual(summerCritical["system.hp.grid"], [[3, 0]], "Summer heals one Critical cell only when no Blunt or Lethal remains");
  const ordinaryCritical = makeActor({ grid: [[3, 3]] }).addPeasantLongRestHpRecoveryUpdates({});
  assert.deepEqual(ordinaryCritical["system.hp.grid"], [[3, 3]], "Ordinary rest does not heal Critical cells");

  const ordinaryScalar = makeActor({ grid: [[0]], health: 1, maxHealth: 5, simplified: true });
  assert.equal(ordinaryScalar.addPeasantLongRestHpRecoveryUpdates({})["system.health.value"], 3);
  const summerScalar = makeActor({ grid: [[0]], health: 1, maxHealth: 5, simplified: true, blessing: "summer" });
  assert.equal(summerScalar.addPeasantLongRestHpRecoveryUpdates({})["system.health.value"], 5, "Summer heals four scalar HP, capped at max");

  const overchargedSummer = makeActor({ grid: [[1, 1, 1]], blessing: "summer", conditions: { overcharged: true } });
  Object.assign(overchargedSummer.system, {
    stamina: { value: 0, max: 0 }, attunement: { value: 0, max: 0 }, capacity: { value: 0, max: 0 },
    physicalStressCount: 0, mentalStressCount: 0, generalStressCount: 1, general0: 1
  });
  await overchargedSummer.performPeasantLongRest();
  assert.deepEqual(overchargedSummer.system.hp.grid, [[1, 1, 1]], "Overcharged suppresses Summer Natural Healing");
  assert.equal(overchargedSummer.system.conditions.overcharged, false, "Long Rest clears Overcharged after suppressing recovery");
  assert.equal(overchargedSummer.system.general0, 1, "Overcharged Long Rest continues to suppress General Stress recovery");
}

{
  const conditions = PeasantCharacterModel.defineSchema().conditions.fields;
  assert.equal(conditions.overcharged.options.initial, false, "Overcharged defaults to false in the actor schema");
  assert.equal(PeasantActor.CONDITION_KEYS.includes("overcharged"), false, "Overcharged is not a Wound condition key");
}

{
  const actor = makeActor({ grid: [[2, 2, 0]], temporaryHp: 1, conditions: { overcharged: false } });
  const before = structuredClone(actor.system.hp.grid);
  const result = await actor.applyPeasantHeal(2, "temporary");
  assert.equal(result.ok, true);
  assert.deepEqual(actor.system.hp.grid, before, "Temporary Heal does not change grid cells");
  assert.equal(actor.system.temporaryHp.value, 2, "Temporary Heal fills only available Temporary HP");
  assert.equal(actor.system.conditions.overcharged, false, "Temporary Heal does not set Overcharged");
}

{
  const summer = makeActor({ grid: [[1, 1, 0]], blessing: "summer" });
  const applied = await summer.applyPeasantHeal(1, "temporary");
  assert.equal(applied.tempHpGranted, 1, "Summer does not maximize fixed direct heal amounts");
  assert.equal(summer.system.temporaryHp.value, 1, "Direct amounts remain literal despite Summer");
  await summer.setPeasantTemporaryHpValue(1, { expandMax: true });
  assert.equal(summer.system.temporaryHp.value, 1, "Direct Temporary HP setters remain literal for Summer");

  const summerCommand = makeActor({ grid: [[1, 1]], blessing: "summer" });
  await summerCommand.applyPeasantHpValueCommand("+1");
  assert.equal(summerCommand.system.temporaryHp.value, 1, "HP commands keep their supplied Summer amount literal");
}

{
  // Reverse scan encounters Critical before the later Lethal cell; Greater must skip and continue.
  const actor = makeActor({ grid: [[2, 3, 2, 3]], temporaryHp: 3 });
  const result = await actor.applyPeasantHeal(3, "greater");
  assert.deepEqual(actor.system.hp.grid, [[0, 3, 0, 3]]);
  assert.deepEqual(result.healedDamageCounts, { blunt: 0, lethal: 2, critical: 0 });
  assert.equal(actor.system.temporaryHp.max, 2, "Temporary maximum reflects the remaining marked cells");
  assert.equal(actor.system.temporaryHp.value, 2, "Temporary current value clamps to the post-heal maximum");
}

{
  const actor = makeActor({ grid: [[3, 3]], temporaryHp: 2 });
  const result = await actor.applyPeasantHeal(2, "greater");
  assert.deepEqual(actor.system.hp.grid, [[3, 3]], "Greater never heals Critical cells");
  assert.deepEqual(result.healedDamageCounts, { blunt: 0, lethal: 0, critical: 0 });
}

{
  for (const invalidType of [2, "greater2", "special3", "other"]) {
    const actor = makeActor();
    const result = await actor.applyPeasantHeal(1, invalidType);
    assert.equal(result.ok, false, `Heal type ${String(invalidType)} is rejected`);
  }
  assert.equal(PeasantActor.prototype.applyPeasantHeal.length, 2, "Heal API has no tier parameter");
}

{
  const actor = makeActor({ grid: [[0]], health: 3, maxHealth: 5, temporaryHp: 1, simplified: true, conditions: { overcharged: false } });
  const result = await actor.applyPeasantHeal(3, "greater");
  assert.equal(actor.system.temporaryHp.value, 0, "New scalar HP reduces and clamps Temporary HP capacity");
  assert.equal(actor.system.health.value, 5, "Greater overflow heals simplified scalar HP");
  assert.equal(result.healedDamageCounts.blunt, 2);
  assert.equal(actor.system.conditions.overcharged, true, "Greater scalar HP recovery sets Overcharged");
  assert.equal(actor.effects[0].name, "Overcharged", "Simplified actual HP healing also creates the effect");
  assert.equal(actor._source.system.conditions.overcharged, false);
}

{
  const actor = makeActor({ grid: [[0]], health: 3, maxHealth: 5, temporaryHp: 1, simplified: true });
  const result = await actor.applyPeasantHeal(1, "temporary");
  assert.equal(actor.system.temporaryHp.value, 2, "Temporary Heal grants available buffer");
  assert.equal(actor.system.health.value, 3, "Temporary Heal does not heal simplified scalar HP");
  assert.equal(result.effectiveHealingPower, 0);
}

{
  const actor = makeActor({ grid: [[3, 3]], temporaryHp: 2, bolsteredHp: 1 });
  const result = await actor.applyPeasantHeal(1, "special");
  assert.equal(result.ok, true);
  assert.equal(result.specialEligible, true);
  assert.equal(result.criticalOnlyBefore, true);
  assert.equal(result.criticalDamageBefore, 2);
  assert.equal(result.criticalDamageAfter, 1);
  assert.equal(result.criticalFullyHealed, false);
  assert.deepEqual(result.healedDamageCounts, { blunt: 0, lethal: 0, critical: 1 });
  assert.deepEqual(actor.system.hp.grid, [[3, 0]], "Eligible Special heals only Critical cells in reverse-grid order");
  assert.equal(actor.system.bolsteredHp, 1, "Special does not generate or overwrite Bolstered HP");
  assert.equal(actor.system.conditions.overcharged, true, "Actual Critical recovery sets Overcharged");
  assert.equal(actor.effects[0].name, "Overcharged", "Eligible Special healing creates the effect");
  assert.notEqual(actor._source.system.conditions.overcharged, true, "Special healing leaves no stored true baseline");
  assert.deepEqual(result.thresholdBreakLocationsMended, []);
}

{
  const actor = makeActor({ grid: [[3, 3]], temporaryHp: 1, conditions: { overcharged: false } });
  const result = await actor.applyPeasantHeal(1, "special");
  assert.equal(result.specialEligible, false, "Special eligibility uses pre-heal Temporary HP");
  assert.equal(result.criticalDamageAfter, 2, "Filling Temporary HP does not unlock Critical healing in the same call");
  assert.deepEqual(actor.system.hp.grid, [[3, 3]]);
  assert.equal(actor.system.temporaryHp.value, 2);
  assert.equal(actor.system.conditions.overcharged, false, "Temporary-only Special fallback does not set Overcharged");
}

{
  for (const grid of [[[3, 2]], [[2, 1]]]) {
    const actor = makeActor({ grid, temporaryHp: 2 });
    const result = await actor.applyPeasantHeal(1, "special");
    assert.equal(result.specialEligible, false, "Special requires Critical-only damage and at least one Critical cell");
    assert.deepEqual(actor.system.hp.grid, grid);
  }
}

{
  const actor = makeActor({ grid: [[3, 3]], temporaryHp: 2, conditions: {
    wounded: true,
    head: "disabled",
    rightArm: "crippled",
    leftLeg: "disabled",
    arms: "crippled",
    legs: "disabled"
  }, devastatingWounds: 3 });
  const result = await actor.applyPeasantHeal(2, "special");
  assert.equal(result.criticalFullyHealed, true);
  assert.deepEqual(result.thresholdBreakLocationsMended, ["head", "rightArm", "leftLeg", "arms", "legs"]);
  assert.equal(actor.system.conditions.wounded, true, "Special healing never removes Wounded");
  assert.equal(actor.system.devastatingWounds, 3, "Special healing never removes Devastating Wounds");
  for (const key of result.thresholdBreakLocationsMended) assert.equal(actor.system.conditions[key], "");
  assert.equal(actor.updates.length, 1, "Grid healing and every Break clear share one actor update");
  assert.ok("system.hp.grid" in actor.updates[0]);
  for (const key of result.thresholdBreakLocationsMended) assert.equal(actor.updates[0][`system.conditions.${key}`], "");
}

{
  const actor = makeActor({ grid: [[3, 3]], temporaryHp: 2, conditions: { head: "crippled" } });
  const result = await actor.applyPeasantHeal(1, "special");
  assert.equal(result.criticalFullyHealed, false);
  assert.equal(actor.system.conditions.head, "crippled", "Partial Critical healing does not mend Breaks");
}

{
  const actor = makeActor({ grid: [[0]], health: 3, maxHealth: 5, temporaryHp: 1, simplified: true, conditions: { head: "disabled" } });
  const result = await actor.applyPeasantHeal(1, "special");
  assert.equal(result.specialEligible, false);
  assert.equal(actor.system.health.value, 3, "Simplified Special fallback does not heal scalar HP");
  assert.equal(actor.system.temporaryHp.value, 2);
  assert.equal(actor.system.conditions.head, "disabled");
}

{
  const actor = makeActor({ grid: [[1]], temporaryHp: 0 });
  const result = await actor.applyPeasantHpValueCommand("+1");
  assert.equal(result.ok, true, "+N remains Temporary Heal");
  assert.equal(actor.system.temporaryHp.value, 1);
  assert.deepEqual(actor.system.hp.grid, [[1]]);
}

{
  const actor = makeActor({ grid: [[2, 3]], temporaryHp: 2 });
  const result = await actor.applyPeasantHpValueCommand("+1G");
  assert.equal(result.ok, true, "+NG dispatches to Greater Heal");
  assert.deepEqual(actor.system.hp.grid, [[0, 3]]);
  assert.equal(result.effectiveHealingPower, 2);
}

{
  const actor = makeActor({ grid: [[3]], temporaryHp: 1 });
  const result = await actor.applyPeasantHpValueCommand("+1S");
  assert.equal(result.ok, true, "+NS dispatches to Special Heal");
  assert.equal(result.specialEligible, true);
  assert.deepEqual(actor.system.hp.grid, [[0]]);
}

assert.equal(normalizeAutomatedCombatHealType("special"), "special");
assert.equal(normalizeAutomatedCombatHealType("SPECIAL"), "special");
assert.equal(normalizeAutomatedCombatHealType("unknown"), "temporary");
assert.equal(getAutomatedCombatHealTypeLabel("special"), "Special");

{
  const actor = makeActor({ grid: [[1, 1, 1, 1, 1]], temporaryHp: 5, bolsteredHp: 4 });
  await actor.applyPeasantHeal(9, "greater");
  assert.equal(actor.system.bolsteredHp, 2, "New Greater excess replaces an existing 4 with 2");
}

{
  const actor = makeActor({ grid: [[1, 1, 1, 1, 1]], temporaryHp: 5, bolsteredHp: 1 });
  await actor.applyPeasantHeal(11, "greater");
  assert.equal(actor.system.bolsteredHp, 3, "New Greater excess replaces an existing 1 with 3");
}

{
  const actor = makeActor({ grid: [[1, 1, 1]], temporaryHp: 3, bolsteredHp: 2 });
  await actor.applyPeasantHeal(3, "greater");
  assert.equal(actor.system.bolsteredHp, 2, "No excess leaves existing Bolstered HP unchanged");
}

{
  const actor = makeActor({ grid: [[1, 1, 1]], temporaryHp: 3 });
  await actor.applyPeasantHeal(100, "greater");
  assert.equal(actor.system.bolsteredHp, 3, "New Bolstered HP remains capped at one row");
}

{
  const actor = makeActor({ grid: [[1, 2, 3]], temporaryHp: 3 });
  const result = await actor.applyPeasantHeal(6, "greater");
  assert.deepEqual(result.healedDamageCounts, { blunt: 1, lethal: 1, critical: 0 });
  assert.equal(result.bolsteredHpAfter, 2);
  assert.equal(result.effectiveHealingPower, 3, "Greater power is actual Blunt plus twice Lethal grid healing only");
}

{
  const actor = makeActor({ grid: [[3]], temporaryHp: 0, conditions: { overcharged: false } });
  const result = await actor.applyPeasantHeal(4, "greater");
  assert.equal(result.tempHpGranted, 1);
  assert.equal(result.bolsteredHpAfter, 1);
  assert.equal(result.effectiveHealingPower, 0, "Temporary and Bolstered HP do not count as Effective Healing Power");
  assert.equal(actor.system.conditions.overcharged, false, "Greater that only grants buffers does not set Overcharged");
  assert.equal(actor.effects.length, 0, "Buffer-only healing creates no Overcharged effect");
}

{
  const actor = makeActor({ grid: [[2]], temporaryHp: 1, conditions: { overcharged: false } });
  const result = await actor.applyPeasantHeal(1, "greater");
  assert.equal(result.healedDamageCounts.lethal, 1);
  assert.equal(actor.system.conditions.overcharged, true, "Greater actual HP recovery sets Overcharged");
  assert.equal(actor.effects.length, 1, "Greater actual HP healing creates one visible Overcharged effect");
  assert.equal(actor.effects[0].name, "Overcharged");
  assert.deepEqual(actor.effects[0].system.changes, [
    { key: "system.conditions.overcharged", type: "override", value: true, priority: 50 }
  ], "The Changes row controls Overcharged through Foundry's native override");
  assert.equal(actor._source.system.conditions.overcharged, false, "The persisted baseline stays false so disabling or deleting reverses Overcharged");
  const repeated = await actor.applyPeasantHeal(1, "greater");
  assert.equal(repeated.ok, true);
  assert.equal(actor.system.conditions.overcharged, true, "A later heal with no HP recovery does not clear existing Overcharged");
}

{
  const actor = makeActor({ grid: [[3]], temporaryHp: 1, bolsteredHp: 1 });
  const result = await actor.applyPeasantHeal(1, "special");
  assert.equal(result.effectiveHealingPower, 4, "Special power is four per actual Critical cell healed");
  assert.equal(result.bolsteredHpAfter, 1);
}

globalThis.game = {
  user: { id: "gm", isGM: true },
  users: [],
  actors: new Map(),
  peasantCore: {},
  settings: { get: () => "public" }
};
globalThis.ui = { notifications: { warn() {} } };
globalThis.canvas = { tokens: { controlled: [] } };
globalThis.CONST = {
  ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 },
  DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 },
  CHAT_MESSAGE_STYLES: { OTHER: 0 }
};
let chatId = 0;
globalThis.ChatMessage = {
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id || null }),
  applyMode: (data) => data,
  async create(data) {
    const flags = new Map();
    const message = {
      ...data,
      id: `healing-chat-${++chatId}`,
      async update(changes) { Object.assign(message, changes); return message; },
      getFlag: (scope, key) => flags.get(`${scope}.${key}`),
      async setFlag(scope, key, value) { flags.set(`${scope}.${key}`, structuredClone(value)); return value; }
    };
    return message;
  }
};
const { applyIncomingHeal, requestIncomingHealApplicationForTarget } = await import("../module/applications/combat/incoming-hit-requests.mjs");
const {
  applyRollUndoRecords,
  attachRollUndoToChatMessage,
  undoRollChatMessageEffects
} = await import("../module/applications/chat-undo.mjs");

async function undoIncomingOnce(records) {
  const message = await ChatMessage.create({});
  await attachRollUndoToChatMessage(message, records);
  return { message, undone: await undoRollChatMessageEffects(message) };
}

{
  const actor = makeActor({ grid: [[3]], temporaryHp: 0 });
  actor.id = "heal-buffer-only";
  actor.name = "Buffer Only";
  actor.uuid = "Actor.heal-buffer-only";
  game.actors.set(actor.id, actor);
  const result = await applyIncomingHeal({ targetActorId: actor.id, healAmount: 4, healType: "greater" });
  assert.equal(result.applyResult.effectiveHealingPower, 0);
  assert.equal(result.secondaryHealingStress, null, "Buffer-only Greater creates no General Stress");
  assert.equal(actor.system.general0, undefined);
}

{
  const actor = makeActor({ grid: [[1, 2, 3]], temporaryHp: 3, build: 2 });
  actor.id = "heal-greater-secondary";
  actor.name = "Greater Secondary";
  actor.uuid = "Actor.heal-greater-secondary";
  game.actors.set(actor.id, actor);
  const result = await applyIncomingHeal({ targetActorId: actor.id, healAmount: 3, healType: "greater" });
  assert.equal(result.applyResult.effectiveHealingPower, 3);
  assert.equal(result.secondaryHealingStress.amount, 1, "Greater General Stress floors effective grid healing divided by Build");
  assert.equal(result.secondaryHealingStress.buildScore, 2);
  assert.equal(result.secondaryHealingStress.buildDivisor, 2);
  assert.equal(actor.system.general0, 1);
}

{
  const summerGreater = makeActor({ grid: [[1, 2]], temporaryHp: 2, build: 2, blessing: "summer" });
  summerGreater.id = "summer-greater-secondary";
  game.actors.set(summerGreater.id, summerGreater);
  const greater = await applyIncomingHeal({ targetActorId: summerGreater.id, healAmount: 2, healType: "greater" });
  assert.equal(greater.applyResult.effectiveHealingPower, 3);
  assert.equal(greater.secondaryHealingStress.buildScore, 2, "The stored Build remains the actual score");
  assert.equal(greater.secondaryHealingStress.buildDivisor, 4, "Summer adds two only to the General Stress divisor");
  assert.equal(greater.secondaryHealingStress.amount, 0);
  assert.equal(summerGreater.system.build, 2, "Summer never overwrites actor Build");

  const summerSpecial = makeActor({ grid: [[3, 3]], temporaryHp: 2, build: 2, blessing: "summer" });
  summerSpecial.id = "summer-special-secondary";
  game.actors.set(summerSpecial.id, summerSpecial);
  const special = await applyIncomingHeal({ targetActorId: summerSpecial.id, healAmount: 1, healType: "special" });
  assert.equal(special.applyResult.effectiveHealingPower, 4);
  assert.equal(special.secondaryHealingStress.buildScore, 2);
  assert.equal(special.secondaryHealingStress.buildDivisor, 4);
  assert.equal(special.secondaryHealingStress.amount, 1);

  const ineligibleSummerSpecial = makeActor({ grid: [[3, 3]], temporaryHp: 1, build: 2, blessing: "summer" });
  ineligibleSummerSpecial.id = "summer-ineligible-special-secondary";
  game.actors.set(ineligibleSummerSpecial.id, ineligibleSummerSpecial);
  const ineligible = await applyIncomingHeal({ targetActorId: ineligibleSummerSpecial.id, healAmount: 1, healType: "special" });
  assert.equal(ineligible.applyResult.effectiveHealingPower, 0);
  assert.equal(ineligible.secondaryHealingStress, null, "Summer ineligible Special healing creates no General Stress secondary");

  const simplifiedSummer = makeActor({ grid: [[0]], health: 2, maxHealth: 5, simplified: true, build: 1, blessing: "summer" });
  simplifiedSummer.id = "summer-simplified-secondary";
  game.actors.set(simplifiedSummer.id, simplifiedSummer);
  const simplified = await applyIncomingHeal({ targetActorId: simplifiedSummer.id, healAmount: 6, healType: "greater" });
  assert.equal(simplified.applyResult.effectiveHealingPower, 3);
  assert.equal(simplified.secondaryHealingStress.buildDivisor, 1, "Summer does not add to the divisor for simplified scalar healing");
}

{
  const actor = makeActor({ grid: [[3]], temporaryHp: 1, build: 2 });
  actor.id = "heal-special-secondary";
  actor.name = "Special Secondary";
  actor.uuid = "Actor.heal-special-secondary";
  game.actors.set(actor.id, actor);
  const result = await applyIncomingHeal({ targetActorId: actor.id, healAmount: 1, healType: "special" });
  assert.equal(result.healType, "special", "Incoming Special survives payload normalization");
  assert.equal(result.applyResult.effectiveHealingPower, 4);
  assert.equal(result.secondaryHealingStress.amount, 2, "Special General Stress floors Critical healing power divided by Build");
  assert.equal(actor.system.general0, 1);
  assert.equal(actor.system.general1, 1, "Two General Stress fills two empty boxes by one level each");
}

{
  const hooks = new Map();
  globalThis.Hooks = {
    once(name, callback) { hooks.set(`once:${name}`, callback); },
    on(name, callback) { hooks.set(`on:${name}`, callback); }
  };
  class TokenHud {
    async _onAttributeUpdate() { return "base"; }
    render() {}
  }
  const { registerTokenHudHpCommandHooks } = await import("../module/applications/token-hud/hp-commands.mjs");
  registerTokenHudHpCommandHooks({ tokenHudClass: TokenHud });
  hooks.get("once:ready")();
  const hud = new TokenHud();
  const inputAttributes = new Map();
  const input = { name: "bar1.value", value: "", dataset: { attribute: "system.health" }, setAttribute(name, value) { inputAttributes.set(name, value); } };
  hud.object = { actor: null, document: { bar1: { attribute: "system.health" } } };
  const applyHudCommand = async (actor, raw) => {
    actor.isOwner = true;
    hud.object.actor = actor;
    input.value = raw;
    const event = {
      currentTarget: input,
      prevented: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() {}
    };
    await hud._onAttributeUpdate(event);
    assert.equal(event.prevented, true);
  };
  const greaterActor = makeActor({ grid: [[2, 3]], temporaryHp: 2 });
  await applyHudCommand(greaterActor, "+1G");
  assert.deepEqual(greaterActor.system.hp.grid, [[0, 3]], "Token HUD Greater retains Critical damage");
  assert.equal(greaterActor.updates.at(-1)["system.bolsteredHp"], undefined);
  const specialActor = makeActor({ grid: [[3]], temporaryHp: 1 });
  await applyHudCommand(specialActor, "+1S");
  assert.deepEqual(specialActor.system.hp.grid, [[0]], "Token HUD +NS reaches Special Heal");
  assert.equal(specialActor.system.conditions.overcharged, true);
  const temporaryActor = makeActor({ grid: [[1]], temporaryHp: 0 });
  await applyHudCommand(temporaryActor, "+1");
  assert.deepEqual(temporaryActor.system.hp.grid, [[1]], "Token HUD Temporary Heal does not change grid cells");
  assert.equal(temporaryActor.system.temporaryHp.value, 1);
  const hudElement = { dataset: {}, addEventListener() {}, querySelectorAll: () => [input] };
  hooks.get("on:renderTokenHUD")({ object: hud.object }, hudElement);
  assert.equal(inputAttributes.get("placeholder"), "+5G / +5S / -3L");
  assert.match(inputAttributes.get("title"), /\+\#\(G\/S\)/, "Token HUD help exposes both Greater and Special suffixes");
}

{
  game.user = { id: "gm", isGM: true };
  game.users = [{ id: "gm", active: true, isGM: true }];
  const targetActor = makeActor({ grid: [[3]], temporaryHp: 1, conditions: { head: "disabled", overcharged: false } });
  Object.assign(targetActor, { id: "automated-special-target", name: "Automated Target", uuid: "Actor.automated-special-target" });
  game.actors = new Map([[targetActor.id, targetActor]]);
  const healer = makeActor();
  Object.assign(healer, { id: "automated-healer", name: "Automated Healer", uuid: "Actor.automated-healer" });
  const { resolveSuccessfulHealForTarget } = await import("../module/applications/combat/successful-heal.mjs");
  const result = await resolveSuccessfulHealForTarget({
    actor: healer,
    combat: { name: "Tier-One Cure", targetingType: "Normal", heal: { diceCount: 0, diceValue: 0, flat: 1, type: "Special" } },
    target: { actor: targetActor, targetName: targetActor.name },
    attackRoll: { rollResult: { isSuccess: true } }
  });
  assert.equal(result.healType, "special");
  assert.equal(result.application.applyResult.specialEligible, true);
  assert.deepEqual(targetActor.system.hp.grid, [[0]], "Automated combat heal delegates to the actor Special path");
  assert.equal(targetActor.system.conditions.head, "");
  assert.equal(targetActor.system.conditions.overcharged, true);
  const undoFlag = result.healRoll.chatMessage.getFlag("peasant-core", "rollUndo");
  assert.ok(undoFlag?.records?.length, "The existing automated heal card owns incoming-heal undo");
  assert.equal((await applyRollUndoRecords(undoFlag.records)).ok, true);
  assert.deepEqual(targetActor.system.hp.grid, [[3]]);
  assert.equal(targetActor.system.conditions.head, "disabled");
  assert.equal(targetActor.system.conditions.overcharged, false);

  const greaterTarget = makeActor({ grid: [[2, 3]], temporaryHp: 2 });
  Object.assign(greaterTarget, { id: "automated-greater-target", name: "Automated Greater", uuid: "Actor.automated-greater-target" });
  game.actors = new Map([[greaterTarget.id, greaterTarget]]);
  const greaterResult = await resolveSuccessfulHealForTarget({
    actor: healer,
    combat: { name: "Tier-One Greater", targetingType: "Normal", heal: { diceCount: 0, diceValue: 0, flat: 1, type: "Greater" } },
    target: { actor: greaterTarget, targetName: greaterTarget.name },
    attackRoll: { rollResult: { isSuccess: true } }
  });
  assert.equal(greaterResult.application.applyResult.effectiveHealingPower, 2);
  assert.deepEqual(greaterTarget.system.hp.grid, [[0, 3]], "Automated Greater retains Critical damage");

  const temporaryTarget = makeActor({ grid: [[1]], temporaryHp: 0 });
  Object.assign(temporaryTarget, { id: "automated-temporary-target", name: "Automated Temporary", uuid: "Actor.automated-temporary-target" });
  game.actors = new Map([[temporaryTarget.id, temporaryTarget]]);
  const temporaryResult = await resolveSuccessfulHealForTarget({
    actor: healer,
    combat: { name: "Tier-One Temporary", targetingType: "Normal", heal: { diceCount: 0, diceValue: 0, flat: 1, type: "Temporary" } },
    target: { actor: temporaryTarget, targetName: temporaryTarget.name },
    attackRoll: { rollResult: { isSuccess: true } }
  });
  assert.equal(temporaryResult.healType, "temporary");
  assert.deepEqual(temporaryTarget.system.hp.grid, [[1]], "Automated Temporary Heal does not change grid cells");
}

{
  let rollEvaluations = 0;
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; }
    async evaluate() {
      rollEvaluations += 1;
      const [, count, sides] = this.formula.match(/(\d+)d(\d+)/);
      this.dice = [{ results: Array.from({ length: Number(count) }, (_, index) => ({ result: index + 1, faces: Number(sides) })) }];
      return this;
    }
  };
  const { rollAutomatedCombatHeal } = await import("../module/applications/combat/automated-heal-rolls.mjs");
  const { resolveSuccessfulHealForTarget } = await import("../module/applications/combat/successful-heal.mjs");
  const healer = makeActor();
  Object.assign(healer, { id: "summer-heal-source", name: "Summer Heal Source", uuid: "Actor.summer-heal-source" });
  const summerTarget = makeActor({ grid: [[1]], blessing: "summer" });
  Object.assign(summerTarget, { id: "summer-heal-target", name: "Summer Target", uuid: "Actor.summer-heal-target" });
  game.actors = new Map([[summerTarget.id, summerTarget]]);
  const source = { name: "Summer Cure", heal: { diceCount: 2, diceValue: 6, flat: 1, type: "Temporary" } };
  const summerResult = await resolveSuccessfulHealForTarget({
    actor: healer,
    combat: source,
    target: { actor: summerTarget, targetName: summerTarget.name },
    attackRoll: { rollResult: { isSuccess: true } }
  });
  assert.equal(summerResult.healRoll.total, 13, "Summer maximizes every source die before the normal Temporary cap");
  assert.deepEqual(summerResult.healRoll.allDice, [6, 6]);
  assert.equal(summerTarget.system.temporaryHp.value, 1, "Summer does not fill Temporary HP beyond the target's capacity");
  assert.match(summerResult.healRoll.chatMessage.content, /Maximized Dice/);
  assert.equal(rollEvaluations, 0, "Summer maximum faces are supplied before rolling");

  const summerGreaterTarget = makeActor({ grid: [[2, 2]], temporaryHp: 2, blessing: "summer" });
  Object.assign(summerGreaterTarget, { id: "summer-greater-target", name: "Summer Greater", uuid: "Actor.summer-greater-target" });
  game.actors = new Map([[summerGreaterTarget.id, summerGreaterTarget]]);
  const summerGreaterResult = await resolveSuccessfulHealForTarget({
    actor: healer,
    combat: { ...source, name: "Summer Greater", heal: { ...source.heal, type: "Greater" } },
    target: { actor: summerGreaterTarget, targetName: summerGreaterTarget.name },
    attackRoll: { rollResult: { isSuccess: true } }
  });
  assert.equal(summerGreaterResult.healRoll.total, 13, "Automated Summer Greater source dice are maximized");
  assert.equal(summerGreaterResult.application.applyResult.effectiveHealingPower, 4, "Greater applies real maximized source overflow through ordinary grid rules");
  assert.deepEqual(summerGreaterTarget.system.hp.grid, [[0, 0]]);
  assert.equal(summerGreaterTarget.system.temporaryHp.value, 0, "Summer Greater clamps Temporary HP to the post-heal capacity");
  assert.equal(summerGreaterTarget.system.temporaryHp.max, 0);

  const summerSpecialTarget = makeActor({ grid: [[3, 3]], temporaryHp: 2, blessing: "summer" });
  Object.assign(summerSpecialTarget, { id: "summer-special-target", name: "Summer Special", uuid: "Actor.summer-special-target" });
  game.actors = new Map([[summerSpecialTarget.id, summerSpecialTarget]]);
  const summerSpecialResult = await resolveSuccessfulHealForTarget({
    actor: healer,
    combat: { ...source, name: "Summer Special", heal: { ...source.heal, type: "Special" } },
    target: { actor: summerSpecialTarget, targetName: summerSpecialTarget.name },
    attackRoll: { rollResult: { isSuccess: true } }
  });
  assert.equal(summerSpecialResult.healRoll.total, 13, "Automated Summer Special source dice are maximized");
  assert.equal(summerSpecialResult.application.applyResult.effectiveHealingPower, 8, "Special uses the real maximized total under its Critical-only rules");
  assert.deepEqual(summerSpecialTarget.system.hp.grid, [[0, 0]]);

  const ordinaryRoll = await rollAutomatedCombatHeal(healer, source, { diceOverride: [1, 2] });
  assert.equal(ordinaryRoll.total, 4, "Ordinary source rolls still use their supplied dice");
  assert.deepEqual(ordinaryRoll.allDice, [1, 2]);
  assert.equal(rollEvaluations, 0, "Replay dice are honored without generating a new Roll");
  const ordinaryRandomRoll = await rollAutomatedCombatHeal(healer, source);
  assert.equal(ordinaryRandomRoll.total, 4, "Ordinary source dice still use the existing Roll path");
  assert.deepEqual(ordinaryRandomRoll.allDice, [1, 2]);
  assert.equal(rollEvaluations, 1);
  const maximizedReplay = await rollAutomatedCombatHeal(healer, source, { diceOverride: [1, 2], maximize: true });
  assert.deepEqual(maximizedReplay.allDice, [6, 6], "Summer maximization takes precedence over stored replay dice");
  assert.equal(maximizedReplay.total, 13);

  const maximizedStability = await rollAutomatedCombatHeal(healer, {
    name: "Stable Cure", stability: true, heal: { diceCount: 1, diceValue: 6, flat: 0, type: "Temporary" }
  }, { maximize: true });
  assert.deepEqual(maximizedStability.allDice, [6, 6], "Stability receives maximum faces for every rolled die");
  assert.equal(maximizedStability.adjustedDiceTotal, 6, "Summer retains the Stability evaluation");
  const maximizedStrengthen = await rollAutomatedCombatHeal(healer, {
    name: "Strengthened Cure", stability: true, strengthen: true, heal: { diceCount: 2, diceValue: 6, flat: 1, type: "Greater" }
  }, { maximize: true });
  assert.deepEqual(maximizedStrengthen.allDice, [6, 6, 6, 6], "Strengthen also sees maximum faces for all Stability dice");
  assert.equal(maximizedStrengthen.adjustedDiceTotal, 12, "Summer retains the Strengthen keep-count evaluation");
  assert.equal(maximizedStrengthen.total, 13);

  const fixedRoll = await rollAutomatedCombatHeal(healer, {
    name: "Fixed Cure", heal: { diceCount: 0, diceValue: 0, flat: 3, type: "Temporary" }
  }, { maximize: true });
  assert.equal(fixedRoll.total, 3, "Summer keeps authored fixed heal amounts literal");
}

{
  game.user = { id: "owner", isGM: false };
  game.users = [{ id: "owner", active: true, isGM: false }];
  game.peasantCore = {};
  const actor = makeActor({ grid: [[3, 3]], temporaryHp: 2, bolsteredHp: 1, conditions: {
    wounded: true, head: "disabled", arms: "crippled", overcharged: false
  }, build: 4, devastatingWounds: 2 });
  Object.assign(actor, { id: "direct-owner-special", name: "Direct Owner", uuid: "Actor.direct-owner-special" });
  game.actors = new Map([[actor.id, actor]]);
  const result = await requestIncomingHealApplicationForTarget({
    target: { actor, targetName: actor.name },
    combat: { name: "Direct Special", targetingType: "Normal" },
    healRoll: { total: 2 },
    healType: "special"
  });
  assert.equal(result.applied, true);
  assert.equal(result.healType, "special");
  assert.equal(result.applyResult.criticalFullyHealed, true);
  assert.deepEqual(result.applyResult.thresholdBreakLocationsMended, ["head", "arms"]);
  assert.equal(actor.system.conditions.overcharged, true);
  assert.equal(actor.system.general0, 1);
  assert.equal(actor.system.general1, 1);
  assert.equal(actor.system.conditions.wounded, true);
  assert.equal(actor.system.devastatingWounds, 2);
  assert.equal((await applyRollUndoRecords(result.undoRecords)).ok, true);
  assert.deepEqual(actor.system.hp.grid, [[3, 3]], "Direct-owner undo restores Critical grid damage");
  assert.equal(actor.system.temporaryHp.value, 2);
  assert.equal(actor.system.conditions.head, "disabled");
  assert.equal(actor.system.conditions.arms, "crippled");
  assert.equal(actor.system.conditions.overcharged, false);
  assert.equal(actor.system.general0, undefined);
  assert.equal(actor.system.general1, undefined);
}

{
  game.user = { id: "owner", isGM: false };
  game.users = [{ id: "owner", active: true, isGM: false }];
  game.peasantCore = {};
  const actor = makeActor({ grid: [[1, 3]], temporaryHp: 2, bolsteredHp: 1, conditions: { overcharged: false }, build: 1 });
  Object.assign(actor, { id: "direct-owner-greater", name: "Direct Greater", uuid: "Actor.direct-owner-greater" });
  game.actors = new Map([[actor.id, actor]]);
  const result = await requestIncomingHealApplicationForTarget({
    target: { actor, targetName: actor.name },
    combat: { name: "Direct Greater", targetingType: "Normal" },
    healRoll: { total: 6 },
    healType: "greater"
  });
  assert.equal(result.applied, true);
  assert.equal(actor.system.conditions.overcharged, true, "Direct-owner Greater sets Overcharged for actual grid healing");
  assert.equal(actor.system.bolsteredHp, 2);
  const undo = await undoIncomingOnce(result.undoRecords);
  assert.equal(undo.undone, true);
  assert.equal(actor.system.conditions.overcharged, false, "Direct-owner undo restores the previous false boolean");
  assert.equal(actor.system.bolsteredHp, 1);
  assert.equal(await undoRollChatMessageEffects(undo.message), false, "The same chat undo cannot apply twice");
  assert.equal(actor.system.conditions.overcharged, false);
}

{
  game.user = { id: "attacker", isGM: false };
  game.users = [{ id: "owner", active: true, isGM: false }];
  let remoteHealPayload = null;
  game.peasantCore = {
    async applyIncomingHealForUser(userId, payload) {
      assert.equal(userId, "owner");
      remoteHealPayload = structuredClone(payload);
      const previousUser = game.user;
      game.user = { id: userId, isGM: false };
      try { return await applyIncomingHeal(payload); }
      finally { game.user = previousUser; }
    }
  };
  const actor = makeActor({ grid: [[3]], temporaryHp: 1, conditions: { overcharged: false }, build: 8 });
  Object.assign(actor, { id: "remote-owner-special", name: "Remote Owner", uuid: "Actor.remote-owner-special" });
  game.actors = new Map([[actor.id, actor]]);
  const result = await requestIncomingHealApplicationForTarget({
    target: { actor, targetName: actor.name },
    combat: { name: "Remote Special", targetingType: "Normal" },
    healRoll: { total: 1 },
    healType: "special"
  });
  assert.equal(remoteHealPayload.healType, "special", "Remote-owner payload preserves exact Special mode");
  assert.equal(result.applied, true);
  assert.equal(actor.system.conditions.overcharged, true);
  game.user = { id: "owner", isGM: false };
  assert.equal((await applyRollUndoRecords(result.undoRecords)).ok, true);
  assert.deepEqual(actor.system.hp.grid, [[3]]);
  assert.equal(actor.system.conditions.overcharged, false);
}

{
  game.user = { id: "attacker", isGM: false };
  game.users = [{ id: "owner", active: true, isGM: false }];
  let remoteHealPayload = null;
  game.peasantCore = {
    async applyIncomingHealForUser(userId, payload) {
      assert.equal(userId, "owner");
      remoteHealPayload = structuredClone(payload);
      const previousUser = game.user;
      game.user = { id: userId, isGM: false };
      try { return await applyIncomingHeal(payload); }
      finally { game.user = previousUser; }
    }
  };
  const actor = makeActor({ grid: [[2, 3]], temporaryHp: 2, bolsteredHp: 1, conditions: { head: "disabled", overcharged: false }, build: 1 });
  Object.assign(actor, { id: "remote-owner-greater", name: "Remote Greater", uuid: "Actor.remote-owner-greater" });
  game.actors = new Map([[actor.id, actor]]);
  const result = await requestIncomingHealApplicationForTarget({
    target: { actor, targetName: actor.name },
    combat: { name: "Remote Greater", targetingType: "Normal" },
    healRoll: { total: 6 },
    healType: "greater"
  });
  assert.equal(remoteHealPayload.healType, "greater");
  assert.equal(result.applied, true);
  assert.deepEqual(actor.system.hp.grid, [[0, 3]], "Remote Greater heals non-Critical HP while retaining Critical damage");
  assert.equal(actor.system.temporaryHp.value, 1);
  assert.equal(actor.system.bolsteredHp, 2, "Incoming Greater applies the Bolstered overwrite result");
  assert.equal(actor.system.conditions.overcharged, true, "Remote-owner Greater sets Overcharged for actual grid healing");
  assert.equal(actor.system.general0, 1);
  assert.equal(actor.system.general1, 1);
  assert.equal(actor.system.conditions.head, "disabled");
  game.user = { id: "owner", isGM: false };
  assert.equal((await applyRollUndoRecords(result.undoRecords)).ok, true);
  assert.deepEqual(actor.system.hp.grid, [[2, 3]]);
  assert.equal(actor.system.temporaryHp.value, 2);
  assert.equal(actor.system.bolsteredHp, 1);
  assert.equal(actor.system.conditions.overcharged, false, "Remote-owner undo restores the prior Overcharged boolean");
  assert.equal(actor.system.general0, undefined);
  assert.equal(actor.system.general1, undefined);
}

{
  const { applyPeasantActiveEffectStateOperations } = await import("../module/data/active-effect/state-operations.mjs");
  function makeHealthEffect(actor, value) {
    actor.documentName = "Actor";
    const flags = new Map();
    return {
      parent: actor,
      disabled: false,
      changes: [{ key: "system.health.value", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value }],
      getFlag(scope, key) { return flags.get(`${scope}.${key}`); },
      async update(changes) {
        const value = changes["flags.peasant-core.appliedStateOperations"];
        if (value) flags.set("peasant-core.appliedStateOperations", structuredClone(value));
      }
    };
  }

  function makeTemporaryHpEffect(actor) {
    actor.documentName = "Actor";
    const flags = new Map();
    return {
      parent: actor,
      disabled: false,
      changes: [{ key: "system.temporaryHp.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: 1 }],
      getFlag(scope, key) { return flags.get(`${scope}.${key}`); },
      async update(changes) {
        const value = changes["flags.peasant-core.appliedStateOperations"];
        if (value) flags.set("peasant-core.appliedStateOperations", structuredClone(value));
      }
    };
  }

  const gridActor = makeActor({ grid: [[2, 3]], temporaryHp: 2 });
  const gridApplied = await applyPeasantActiveEffectStateOperations(makeHealthEffect(gridActor, 1));
  assert.equal(gridApplied, true);
  assert.deepEqual(gridActor.system.hp.grid, [[0, 3]], "Grid health increase inherits Greater and leaves Critical damage");
  assert.equal(gridActor.system.conditions.overcharged, true, "Active Effect grid Greater sets Overcharged for actual healing");

  const simplifiedActor = makeActor({ grid: [[0]], health: 2, maxHealth: 5, simplified: true });
  const simplifiedApplied = await applyPeasantActiveEffectStateOperations(makeHealthEffect(simplifiedActor, 4));
  assert.equal(simplifiedApplied, true);
  assert.equal(simplifiedActor.system.health.value, 4, "Simplified health Active Effect remains a literal scalar setter");
  assert.equal(simplifiedActor.system.conditions.overcharged, false);
  assert.equal(simplifiedActor.effects.length, 0, "Literal simplified HP setters do not create Overcharged");
  assert.equal(simplifiedActor.updates.some((update) => "system.bolsteredHp" in update), false);

  const summerActor = makeActor({ grid: [[1, 1]], temporaryHp: 2, blessing: "summer" });
  summerActor.system.temporaryHp.value = 0;
  assert.equal(await applyPeasantActiveEffectStateOperations(makeTemporaryHpEffect(summerActor)), true);
  assert.equal(summerActor.system.temporaryHp.value, 1, "Active Effect numeric operations remain literal for Summer");
}

delete globalThis.Actor;

{
  const actor = makeActor({ grid: [[2, 2]], temporaryHp: 2, conditions: { overcharged: false } });
  await actor.applyPeasantHeal(1, "greater");
  const effect = actor.effects[0];
  await effect.update({ disabled: true });
  assert.equal(actor.system.conditions.overcharged, false, "Disabling the effect immediately stops Overcharged");
  await actor.applyPeasantHeal(1, "greater");
  assert.equal(actor.effects.length, 1, "Further qualifying healing reuses the existing effect");
  assert.equal(actor.effects[0].id, effect.id);
  assert.equal(effect.disabled, false, "Further actual HP recovery re-enables Overcharged");
  assert.equal(actor.system.conditions.overcharged, true);
  await effect.delete();
  assert.equal(actor.system.conditions.overcharged, false, "Deleting the effect immediately stops Overcharged");
  assert.equal(actor._source.system.conditions.overcharged, false);
}

for (const disabled of [false, true]) {
  const actor = makeActor({ grid: [[2, 2]], temporaryHp: 2, conditions: { overcharged: false } });
  Object.assign(actor.system, {
    stamina: { value: 0, max: 3 }, attunement: { value: 0, max: 2 }, capacity: { value: 0, max: 4 },
    physicalStressCount: 0, mentalStressCount: 0, general0: 3
  });
  await actor.applyPeasantHeal(1, "greater");
  const effect = actor.effects[0];
  if (disabled) await effect.update({ disabled: true });
  const [unrelated] = await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Manual Effect", system: { changes: [] } }]);
  await actor.performPeasantShortRest();
  assert.ok(actor.effects.includes(effect), "Short Rest retains the Overcharged effect");
  assert.equal(actor.system.conditions.overcharged, !disabled);
  await actor.performPeasantLongRest();
  assert.deepEqual(actor.system.hp.grid, disabled ? [[0, 0]] : [[2, 0]], "Only enabled Overcharged suppresses Natural Healing");
  assert.equal(actor.system.general0, disabled ? 0 : 3, "Only enabled Overcharged suppresses General Stress recovery");
  assert.equal(actor.system.stamina.value, 3, "Overcharged retains ordinary rest resource refreshes");
  assert.equal(actor.system.temporaryHp.value, disabled ? 0 : 1);
  assert.deepEqual(actor.effects, [unrelated], "Long Rest removes enabled and disabled Overcharged effects without touching unrelated effects");
  assert.equal(actor.system.conditions.overcharged, false);
}

{
  game.user = { id: "owner", isGM: false };
  game.users = [{ id: "owner", active: true, isGM: false }];
  game.peasantCore = {};
  const actor = makeActor({ grid: [[2, 2]], temporaryHp: 2, conditions: { overcharged: false } });
  Object.assign(actor, { id: "overcharged-disabled-undo", name: "Disabled Undo", uuid: "Actor.overcharged-disabled-undo" });
  game.actors = new Map([[actor.id, actor]]);
  await actor.applyPeasantHeal(1, "greater");
  const effect = actor.effects[0];
  await effect.update({ disabled: true });
  const result = await requestIncomingHealApplicationForTarget({
    target: { actor }, combat: { name: "Re-enable Cure", targetingType: "Normal" },
    healRoll: { total: 1 }, healType: "greater"
  });
  assert.equal(actor.system.conditions.overcharged, true);
  assert.equal((await applyRollUndoRecords(result.undoRecords)).ok, true);
  assert.equal(actor.effects.length, 1, "Heal Undo retains the previously existing effect");
  assert.equal(actor.effects[0].id, effect.id);
  assert.equal(actor.effects[0].disabled, true, "Heal Undo restores the prior disabled state");
  assert.equal(actor.system.conditions.overcharged, false);
}

console.log("E5 healing tests passed");
