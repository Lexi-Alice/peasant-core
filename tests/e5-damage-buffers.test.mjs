import assert from "node:assert/strict";
import test from "node:test";

import { absorbTempHpFromCounts, applyDamageResistanceToCounts, toSimplifiedHpDamageFromCountsWithResistance, toSimplifiedHpDamageWithResistance } from "../module/data/actor/damage.mjs";

for (const [label, counts, multiplier, expected] of [
  ["small positive multiplier", { critical: 1, lethal: 1, blunt: 1 }, 0.01, { critical: 1, lethal: 1, blunt: 1 }],
  ["floor above minimum", { critical: 5, lethal: 3, blunt: 0 }, 0.5, { critical: 2, lethal: 1, blunt: 0 }],
  ["zero multiplier", { critical: 1, lethal: 1, blunt: 1 }, 0, { critical: 0, lethal: 0, blunt: 0 }],
  ["absent incoming grade", { lethal: 0 }, 2, { critical: 0, lethal: 0, blunt: 0 }]
]) {
  await test(`shared typed resistance: ${label}`, () => {
    assert.deepEqual(applyDamageResistanceToCounts(counts, { getFlag: () => multiplier }), expected);
  });
}
await test("scalar resistance convenience helpers use the same typed minimum before Hard", () => {
  const actor = { getFlag: (_scope, key) => key === "damageResistanceLethalMultiplier" ? 0.5 : 0 };
  assert.equal(toSimplifiedHpDamageWithResistance(1, "lethal", actor), 2);
  assert.equal(toSimplifiedHpDamageFromCountsWithResistance({ lethal: 4 }, actor, true), 3);
});

assert.deepEqual(absorbTempHpFromCounts({ critical: 1, lethal: 0, blunt: 0 }, 3), {
  remaining: { critical: 0, lethal: 0, blunt: 0 },
  tempUsed: 3,
  tempRemaining: 0
});
assert.deepEqual(absorbTempHpFromCounts({ critical: 0, lethal: 1, blunt: 0 }, 1), {
  remaining: { critical: 0, lethal: 0, blunt: 0 },
  tempUsed: 1,
  tempRemaining: 0
});
assert.deepEqual(absorbTempHpFromCounts({ critical: 2, lethal: 0, blunt: 0 }, 8), {
  remaining: { critical: 0, lethal: 0, blunt: 0 },
  tempUsed: 8,
  tempRemaining: 0
});
assert.deepEqual(absorbTempHpFromCounts({ critical: 1, lethal: 2, blunt: 3 }, 6), {
  remaining: { critical: 0, lethal: 1, blunt: 3 },
  tempUsed: 6,
  tempRemaining: 0
});
assert.deepEqual(absorbTempHpFromCounts({ critical: 2, lethal: 1, blunt: 0 }, 6), {
  remaining: { critical: 0, lethal: 1, blunt: 0 },
  tempUsed: 6,
  tempRemaining: 0
});
assert.deepEqual(absorbTempHpFromCounts({ critical: 1, lethal: 2, blunt: 3 }, 0), {
  remaining: { critical: 1, lethal: 2, blunt: 3 },
  tempUsed: 0,
  tempRemaining: 0
});

globalThis.Actor = class {};
const { PeasantActor } = await import("../module/documents/actor.mjs");
const gridActor = new PeasantActor();
gridActor.type = "character";
gridActor.system = {
  hp: {
    rows: 1,
    cols: 3,
    grid: [[0, 2, 0]],
    applyDamage(type, amount) {
      this.damageCalls = [...(this.damageCalls ?? []), [type, amount]];
    }
  },
  health: { value: 2, max: 3 },
  temporaryHp: { value: 3, max: 3 },
  bolsteredHp: 0,
  haltValues: [0, 0, 0, 0],
  naturalHaltValues: [0, 0, 0, 0],
  combatMods: { haltBuffs: [] },
  conditions: {}
};
gridActor.effects = [];
gridActor.getFlag = () => undefined;
gridActor.updatePeasantStateData = async (update) => { gridActor.lastStateUpdate = update; };
await gridActor.applyPeasantDamage(1, "critical", false, { domeAlreadyResolved: true });
assert.equal(gridActor.system.hp.damageCalls, undefined, "partially paid Critical damage is fully absorbed");
assert.equal(gridActor.lastStateUpdate["system.temporaryHp.value"], 0);

globalThis.game = { user: { id: "gm", isGM: true }, actors: new Map() };
globalThis.foundry = {
  abstract: { DataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: { deepClone: structuredClone }
};
const { HPGridModel } = await import("../module/data/actor/hp-model.mjs");
const { captureActorRollUndo, applyRollUndoRecords } = await import("../module/applications/chat-undo.mjs");

function scalarActor({ temp = 3, bolstered = 0, max = 10, hard = false, multiplier = 1, multipliers = {} } = {}) {
  return Object.assign(Object.create(PeasantActor.prototype), {
    id: "scalar-buffer-actor",
    type: "character",
    system: {
      health: { value: 7, max },
      temporaryHp: { value: temp, max: max - 7 },
      bolsteredHp: bolstered,
      haltValues: [0, 0, 0, 0], naturalHaltValues: [0, 0, 0, 0],
      hardTorso: hard, combatMods: { haltBuffs: [] },
      conditions: {}, devastatingWounds: 0
    },
    effects: [], items: [], updates: [],
    getFlag: (_scope, key) => key === "simplifiedHp" ? true : key.startsWith("damageResistance") ? (multipliers[key] ?? multiplier) : undefined,
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
}

const routes = {
  generic: (actor, amount, type, options = {}) => actor.applyPeasantDamage(amount, type, options.hard ?? false, { domeAlreadyResolved: true }),
  targeted: (actor, amount, type) => actor.applyPeasantTargetedDamage({ amount, type, location: "Torso", domeAlreadyResolved: true }),
  locationless: (actor, amount, type, options = {}) => actor.applyPeasantLocationlessDamage({ amount, type, domeAlreadyResolved: true, ignoreResistance: options.ignoreResistance ?? false })
};
for (const [route, apply] of Object.entries(routes)) {
  for (const [label, amount, type, options, expected] of [
    ["partial Critical", 1, "critical", { temp: 3 }, [7, 0, 0, 3, 0]],
    ["partial Lethal", 1, "lethal", { temp: 1 }, [7, 0, 0, 1, 0]],
    ["exact Critical", 2, "critical", { temp: 8, max: 20 }, [7, 0, 0, 8, 0]],
    ["exact Lethal", 2, "lethal", { temp: 4, max: 20 }, [7, 0, 0, 4, 0]],
    ["mixed payment", 5, "hybrid", { temp: 3 }, [3, 0, 4, 3, 0]],
    ["residual Bolstered", 2, "critical", { temp: 3, bolstered: 2 }, [5, 0, 4, 3, 2]],
    ["buffer cap", 1, "critical", { temp: 8 }, [7, 3, 0, 4, 0]],
    ["resistance before absorption", 2, "critical", { temp: 3, multiplier: 0.5 }, [7, 0, 0, 3, 0]],
    ["no-buffer fractional resistance", 1, "critical", { temp: 0, multiplier: 0.5 }, [3, 0, 4, 0, 0]],
    ["no-buffer Lethal minimum", 1, "lethal", { temp: 0, multiplier: 0.01 }, [5, 0, 2, 0, 0]],
    ["resistance applied once", 5, "lethal", { temp: 0, multiplier: 0.5 }, [3, 0, 4, 0, 0]],
    ["full immunity", 2, "critical", { temp: 3, multiplier: 0 }, [7, 3, 0, 0, 0]],
    ["mixed immunity", 2, "hybrid", { temp: 1, multipliers: { damageResistanceLethalMultiplier: 0 } }, [7, 0, 0, 1, 0]],
    ["no Temporary", 2, "critical", { temp: 0, bolstered: 2 }, [1, 0, 8, 0, 2]]
  ]) {
    await test(`${route}: ${label} absorbs typed damage before scalar conversion`, async () => {
      const actor = scalarActor(options);
      const result = await apply(actor, amount, type, options);
      assert.equal(result.ok, true);
      assert.deepEqual([actor.system.health.value, actor.system.temporaryHp.value, result.scaledDamage, result.tempUsed, result.bolsteredUsed], expected);
      assert.deepEqual(actor.system.conditions, {}, "scalar damage never introduces wound conditions");
      assert.equal(actor.system.devastatingWounds, 0);
      assert.ok(actor.system.bolsteredHp <= actor.system.health.max);
      assert.ok(actor.updates.every(update => !Object.keys(update).some(key => key.startsWith("system.conditions") || key === "system.devastatingWounds")));
    });
  }
  await test(`${route}: typed absorption and scalar buffers undo together`, async () => {
    const actor = scalarActor({ temp: 3, bolstered: 2 });
    globalThis.game.actors.set(actor.id, actor);
    const before = structuredClone(actor.system);
    const capture = await captureActorRollUndo(actor, "Scalar Damage", () => apply(actor, 2, "critical"));
    assert.equal(actor.system.health.value, 5);
    assert.equal((await applyRollUndoRecords(capture.undoRecords)).ok, true);
    assert.deepEqual(actor.system, before);
  });
  await test(`${route}: a fully Temp-absorbed hit retains the scalar Bolstered cap`, async () => {
    const actor = scalarActor({ temp: 3, bolstered: 50 });
    const result = await apply(actor, 1, "critical");
    assert.equal(result.tempUsed, 3);
    assert.equal(result.bolsteredUsed, 0);
    assert.equal(actor.system.bolsteredHp, 10);
    assert.equal(actor.system.health.value, 7);
  });
}
for (const route of ["generic", "targeted"]) {
  await test(`${route}: Hard conversion applies to damage left after typed Temporary HP`, async () => {
    const actor = scalarActor({ temp: 1, hard: true });
    const result = await routes[route](actor, 4, "lethal", { hard: true });
    assert.equal(result.scaledDamage, 5);
    assert.equal(actor.system.health.value, 2);
  });
  await test(`${route}: resistance precedes Hard without applying converted-grade resistance twice`, async () => {
    const actor = scalarActor({ temp: 0, hard: true, multipliers: { damageResistanceLethalMultiplier: 0.5, damageResistanceBluntMultiplier: 0 } });
    const result = await routes[route](actor, 4, "lethal", { hard: true });
    assert.equal(result.scaledDamage, 3);
    assert.equal(actor.system.health.value, 4);
  });
}
await test("locationless: ignoring resistance retains typed Temporary HP absorption", async () => {
  const actor = scalarActor({ temp: 3, multiplier: 0 });
  const result = await routes.locationless(actor, 2, "critical", { ignoreResistance: true });
  assert.equal(result.scaledDamage, 4);
  assert.equal(actor.system.health.value, 3);
});

for (const [route, apply] of Object.entries(routes)) {
  for (const [label, amount, type, options, expectedCalls, expectedTemp, expectedGrid] of [
    ["positive minimum", 1, "critical", { temp: 0, multiplier: 0.01 }, [["critical", 1, false]], 0],
    ["resistance exactly once", 5, "critical", { temp: 0, multiplier: 0.5 }, [["critical", 2, false]], 0],
    ["zero immunity", 2, "critical", { temp: 3, multiplier: 0 }, [], 3],
    ["resistance before Temp", 2, "critical", { temp: 3, multiplier: 0.5 }, [], 0],
    ["mixed immunity before Temp", 2, "hybrid", { temp: 1, multipliers: { damageResistanceLethalMultiplier: 0 } }, [], 0],
    ["per-grade minimum", 2, "hybrid", { temp: 0, multiplier: 0.01 }, [["lethal", 1, false], ["blunt", 1, false]], 0],
    ...(route === "locationless" ? [] : [[
      "Hard conversion retains Blunt after original Lethal resistance", 4, "lethal",
      { temp: 0, hard: true, multipliers: { damageResistanceLethalMultiplier: 0.5, damageResistanceBluntMultiplier: 0 } },
      [["lethal", 2, true]], 0, [[2, 1, 0, 0, 0, 0, 0, 2, 2, 2]]
    ]])
  ]) {
    await test(`${route} grid: ${label}`, async () => {
      const actor = scalarActor(options);
      const flags = actor.getFlag;
      actor.getFlag = (scope, key) => key === "simplifiedHp" ? false : flags(scope, key);
      actor.system.hp = Object.assign(Object.create(HPGridModel.prototype), { rows: 1, cols: 10, grid: [[0, 0, 0, 0, 0, 0, 0, 2, 2, 2]] });
      const calls = [];
      const applyDamage = actor.system.hp.applyDamage.bind(actor.system.hp);
      actor.system.hp.applyDamage = (grade, count, hard) => { calls.push([grade, count, hard]); return applyDamage(grade, count, hard); };
      assert.equal((await apply(actor, amount, type, options)).ok, true);
      assert.deepEqual(calls, expectedCalls);
      assert.equal(actor.system.temporaryHp.value, expectedTemp);
      if (expectedGrid) {
        assert.deepEqual(actor.system.hp.grid, expectedGrid, "the real HP model keeps both the Lethal and converted Blunt cells");
        assert.equal(actor.system.health.value, 5);
      }
    });
  }
}

delete globalThis.Actor;
delete globalThis.game;
delete globalThis.foundry;

console.log("E5 damage buffer standalone assertions completed");
