import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as damage from "../module/data/actor/damage.mjs";

await test("Scale is a non-action header field with only its current value in the tooltip", () => {
  const template = readFileSync(new URL("../templates/actor/character-sheet.html", import.meta.url), "utf8");
  const fields = template.match(/<(?:label|span)\b[^>]*class="[^"]*\bpc-banner-scale\b[^"]*"[^>]*>/g) || [];
  assert.equal(fields.length, 2, "Scale has edit and view variants");
  assert.match(template, /{{else}}\s*{{#if scaleDisplay}}\s*<span class="pc-banner-scale"/, "view mode omits Scale when its prepared value is zero");
  assert.match(template, /{{#if @root.editable}}\s*<label class="pc-banner-scale"/, "edit mode always retains the Scale input");
  for (const field of fields) {
    assert.doesNotMatch(field, /pc-banner-rest-button|data-action=|role="button"/, "Scale must not bind the rest click handler or button hover styling");
    assert.match(field, /data-tooltip="Scale {{scale(?:Input|Display)}}"/);
  }
});

await test("Scale halves damage for each missing rating, rounds down, and never grants excess damage", () => {
  assert.equal(typeof damage.getDamageScaleResult, "function", "Scale calculation is available");
  for (const [amount, targetScale, attackScale, expected] of [
    [32, 3, 0, 4], [31, 3, 0, 3], [31, 3, 2, 15],
    [31, 3, 3, 31], [31, 3, 8, 31], [1, 1, 0, 0],
    [20, 0, 0, 20], [20, 0, 1, 20], [20, 0, 4, 20],
    [20, undefined, 0, 20], [20, -2, -1, 20], [20, "bad", "bad", 20]
  ]) {
    assert.equal(damage.getDamageScaleResult(amount, { system: { scale: targetScale } }, attackScale).damage,
      expected, `${amount} damage against Scale ${targetScale} with penetration ${attackScale}`);
  }
});

globalThis.Actor = class {};
globalThis.foundry = {
  abstract: { DataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: { deepClone: structuredClone }
};
globalThis.game = { user: { id: "gm", isGM: true }, actors: new Map() };
const { PeasantActor } = await import("../module/documents/actor.mjs");
const { HPGridModel } = await import("../module/data/actor/hp-model.mjs");
const { prepareActorSheetBaseContext } = await import("../module/data/actor/sheet-display/base.mjs");
const { buildManifestSpellEffectChanges } = await import("../module/data/active-effect/spell-effect-change-keys.mjs");

function actorFixture({ scale = 2, scalar = false, halt = 0 } = {}) {
  const hp = Object.assign(Object.create(HPGridModel.prototype), {
    rows: 8, cols: 10, grid: Array.from({ length: 8 }, () => Array(10).fill(0))
  });
  return Object.assign(Object.create(PeasantActor.prototype), {
    id: "scale-fixture", type: "character", effects: [], items: [],
    system: {
      scale, hp, build: 10, health: { value: 80, max: 80 },
      temporaryHp: { value: 0, max: 0 }, bolsteredHp: 0,
      haltValues: [halt, halt, halt, halt], naturalHaltValues: [0, 0, 0, 0],
      combatMods: { haltBuffs: [] }, conditions: {}, devastatingWounds: 0
    },
    getFlag: (_scope, key) => key === "simplifiedHp" ? scalar : undefined,
    async updatePeasantStateData(update) {
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

await test("Scale input preserves the source value while view mode uses the prepared value", () => {
  const data = {};
  prepareActorSheetBaseContext(data, actorFixture({ scale: 3 }), { sourceSystem: { scale: 1 } });
  assert.equal(data.scaleInput, 1);
  assert.equal(data.scaleDisplay, 3);
});



for (const scalar of [false, true]) {
  for (const route of ["generic", "targeted", "locationless"]) {
    await test(`${route} ${scalar ? "scalar" : "grid"} damage applies Scale before HP`, async () => {
      const actor = actorFixture({ scalar });
      if (route === "generic") await actor.applyPeasantDamage(20, "blunt");
      if (route === "targeted") await actor.applyPeasantTargetedDamage({ amount: 20, type: "blunt" });
      if (route === "locationless") await actor.applyPeasantLocationlessDamage({ amount: 20, type: "blunt" });
      assert.equal(actor.system.health.value, 75);
    });
  }
}

await test("Scale is calculated before HALT, and already resolved damage is not reduced twice", async () => {
  const actor = actorFixture({ halt: 3 });
  const result = await actor.applyPeasantTargetedDamage({ amount: 20, type: "blunt" });
  assert.equal(result.netDamage, 2);
  assert.equal(actor.system.health.value, 78);
  const resolved = actorFixture({ halt: 3 });
  await resolved.applyPeasantTargetedDamage({ amount: 5, type: "blunt", scaleAlreadyResolved: true });
  assert.equal(resolved.system.health.value, 78);
});

await test("Scale precedes Dome HP consumption", async () => {
  const actor = actorFixture();
  const dome = {
    id: "dome", type: "spellEffect", disabled: false,
    duration: { expired: false, remaining: null, value: null },
    system: { encounterId: "combat" },
    changes: buildManifestSpellEffectChanges({ manifestType: "dome", hp: { value: 10, max: 10 } }),
    async update(patch) { this.changes = structuredClone(patch.changes); },
    async delete() { actor.effects = []; }
  };
  actor.effects = [dome];
  const result = await actor.applyPeasantTargetedDamage({ amount: 20, type: "blunt" });
  assert.equal(result.dome.absorbed, 5);
  assert.equal(result.dome.remainingHp, 5);
  assert.equal(actor.system.health.value, 80);
});

const { setSkillTagData, normalizeSkillEntry, resolveSkillUsage } = await import("../module/data/actor/skill-entries.mjs");
const { collectNotableCombatTagData } = await import("../module/applications/actor/notable-combat/notable-combat-tag-data.mjs");
const { getActiveNotableCombatEditorTags } = await import("../module/applications/actor/notable-combat/notable-combat-tag-display.mjs");

await test("Tipping Scales editor shows only the penetration input without helper text", async () => {
  const { renderStandardNotableCombatTagInputs } = await import("../module/applications/actor/notable-combat/notable-combat-standard-tag-inputs.mjs");
  let html = "";
  assert.equal(renderStandardNotableCombatTagInputs({ html(value) { html = value; } }, "tippingScales", { tippingScales: 2 }), true);
  assert.match(html, /aria-label="Scale Penetration" value="2"/);
  assert.doesNotMatch(html, /<p\b|pc-tag-message/);
});

await test("Tipping Scales can be added, edited, and removed without changing an alternate usage", () => {
  const original = normalizeSkillEntry({ id: "strike", usages: [{ id: "alternate", mechanics: {} }] });
  const added = setSkillTagData(original, "tippingScales", { tippingScales: 2 });
  assert.equal(added.ok, true);
  assert.equal(added.data.tippingScales, 2);
  assert.equal(resolveSkillUsage(added.data, "alternate").data.tippingScales, 0);
  assert.deepEqual(getActiveNotableCombatEditorTags(added.data).find(tag => tag.type === "tippingScales"), {
    kind: "tag", type: "tippingScales", key: "tippingScales", label: "Tipping Scales",
    summary: "2", display: "Tipping Scales: 2"
  });
  const edited = setSkillTagData(added.data, "tippingScales", { tippingScales: 3 }, { mode: "edit" });
  assert.equal(edited.data.tippingScales, 3);
  const removed = setSkillTagData(edited.data, "tippingScales", {}, { mode: "remove" });
  assert.equal(removed.data.tippingScales, 0);
  assert.equal(removed.data.baseUsage.layout.some(row => row.key === "tippingScales"), false);
  assert.equal(original.tippingScales, 0);
});

await test("Tipping Scales editor and setter reject invalid penetration values", () => {
  for (const value of ["", "0", "-1", "1.5", "bad", "Infinity"]) {
    const root = { nodeType: 1, querySelector: () => ({ value }) };
    assert.equal(collectNotableCombatTagData(root, "tippingScales").tagAdded, false);
    assert.equal(setSkillTagData({}, "tippingScales", { tippingScales: value }).ok, false);
  }
  const root = { nodeType: 1, querySelector: () => ({ value: "2" }) };
  assert.deepEqual(collectNotableCombatTagData(root, "tippingScales").tagData, { tippingScales: 2 });
});

globalThis.canvas = { tokens: { controlled: [] } };
globalThis.game.users = [{ id: "gm", active: true, isGM: true }];
globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ actor: actor?.id }), applyMode: data => data,
  create: async data => ({ id: "scale-damage-card", ...data })
};
const { resolveSuccessfulAttackDamageForTarget } = await import("../module/applications/combat/successful-attack-damage.mjs");

for (const [label, scale, penetration, expected] of [
  ["ordinary hit", 2, 0, 5], ["penetrating hit", 2, 1, 10],
  ["excess penetration", 2, 4, 20], ["unscaled target", 0, 1, 20]
]) {
  await test(`automated ${label} applies Scale once through target-owned damage`, async () => {
    const target = actorFixture({ scale });
    globalThis.game.actors.set(target.id, target);
    const result = await resolveSuccessfulAttackDamageForTarget({
      actor: { id: "attacker", system: { combatMods: {} } },
      combat: { name: "Strike", targetingType: "Melee", tippingScales: penetration,
        damage: { enabled: true, diceCount: 0, diceValue: 0, flat: 20, type: "blunt" } },
      target: { actor: target, targetName: "Target" },
      attackRoll: { rollResult: { isSuccess: true, totalMoS: 1 } },
      workflowDependencies: {
        requestArmorCharge: async () => ({ handled: true, useArmorCharge: false, appliedDamageType: "blunt" }),
        resolveLocation: async () => ({ location: "Torso", locationDisplay: "Torso", rawText: "Torso", isAP: false })
      }
    });
    assert.equal(result.damageRoll.displayTotal, expected);
    assert.match(result.damageRoll.chatMessage.content, /<button class="mos-toggle"[^>]*>\s*20\s*<\/button>/,
      "the chat card shows rolled damage before Scale");
    assert.doesNotMatch(result.damageRoll.chatMessage.content, /<div>(?:Scale:|Damage Before Scale:)/,
      "Scale calculation lines are omitted from Roll Details");
    assert.equal(result.application.requestPayload.scaleAlreadyResolved, true);
    assert.equal(result.application.applied, true);
    assert.equal(target.system.health.value, 80 - expected);
    assert.equal(target.system.scale, scale, "penetration never grants or changes the target's Scale");
  });
}

await test("damage card keeps Glance and AoE save adjustments while hiding Scale reduction", async () => {
  const { rollAutomatedCombatDamage } = await import("../module/applications/combat/automated-damage-rolls.mjs");
  for (const [glance, reflexPassed, cardDamage, appliedDamage] of [
    [false, false, 21, 5], [true, false, 10, 2],
    [false, true, 10, 2], [true, true, 5, 1]
  ]) {
    const result = await rollAutomatedCombatDamage(
      { id: "attacker", system: { combatMods: {} } },
      { name: "Strike", damage: { enabled: true, diceCount: 0, diceValue: 0, flat: 21, type: "blunt" } },
      { targetActor: actorFixture({ scale: 2 }), halveDamageForGlance: glance,
        aoeReflexSaveResult: { passed: reflexPassed }, deferChatMessage: true }
    );
    assert.equal(Number(result.chatHtml.match(/<button class="mos-toggle"[^>]*>\s*([\d.]+)\s*<\/button>/)?.[1]), cardDamage);
    assert.equal(result.displayTotal, appliedDamage, "target resolution retains Scale reduction");
    assert.doesNotMatch(result.chatHtml, /<div>(?:Scale:|Damage Before Scale:)/);
  }
});

await test("manual Tipping Scales conditions do not automatically penetrate Scale", async () => {
  const target = actorFixture({ scale: 2 });
  globalThis.game.actors.set(target.id, target);
  const result = await resolveSuccessfulAttackDamageForTarget({
    actor: { id: "attacker", system: { combatMods: {} } },
    combat: { name: "Strike", targetingType: "Melee", tippingScales: 2,
      baseUsage: { rules: [{ when: "manual", tagKeys: ["tippingScales"] }] },
      damage: { enabled: true, diceCount: 0, diceValue: 0, flat: 20, type: "blunt" } },
    target: { actor: target }, attackRoll: { rollResult: { isSuccess: true, totalMoS: 1 } },
    workflowDependencies: {
      requestArmorCharge: async () => ({ handled: true, useArmorCharge: false, appliedDamageType: "blunt" }),
      resolveLocation: async () => ({ location: "Torso", locationDisplay: "Torso", rawText: "Torso" })
    }
  });
  assert.equal(result.damageRoll.displayTotal, 5);
  assert.equal(target.system.health.value, 75);
});

await test("Dome overflow from an automated hit reaches HP without another Scale reduction", async () => {
  const target = actorFixture({ scale: 2 });
  globalThis.game.actors.set(target.id, target);
  target.effects = [{
    id: "small-dome", type: "spellEffect", disabled: false,
    duration: { expired: false, remaining: null, value: null }, system: { encounterId: "combat" },
    changes: buildManifestSpellEffectChanges({ manifestType: "dome", hp: { value: 3, max: 3 } }),
    async delete() { target.effects = []; }
  }];
  const result = await resolveSuccessfulAttackDamageForTarget({
    actor: { id: "attacker", system: { combatMods: {} } },
    combat: { name: "Strike", targetingType: "Melee",
      damage: { enabled: true, diceCount: 0, diceValue: 0, flat: 20, type: "blunt" } },
    target: { actor: target }, attackRoll: { rollResult: { isSuccess: true, totalMoS: 1 } },
    workflowDependencies: {
      requestArmorCharge: async () => ({ handled: true, useArmorCharge: false, appliedDamageType: "blunt" }),
      resolveLocation: async () => ({ location: "Torso", locationDisplay: "Torso", rawText: "Torso" })
    }
  });
  assert.equal(result.dome.absorbed, 3);
  assert.equal(result.dome.penetration, 2);
  assert.equal(target.system.health.value, 78);
});

await test("Undo and a damage dice replay retain one Scale calculation", async () => {
  const target = actorFixture({ scale: 2 });
  globalThis.game.actors.set(target.id, target);
  const { applyRollUndoRecords } = await import("../module/applications/chat-undo.mjs");
  const args = {
    actor: { id: "attacker", system: { combatMods: {} } },
    combat: { name: "Strike", targetingType: "Melee", tippingScales: 1,
      damage: { enabled: true, diceCount: 0, diceValue: 0, flat: 20, type: "blunt" } },
    target: { actor: target }, attackRoll: { rollResult: { isSuccess: true, totalMoS: 1 } },
    replayLocationRoll: { location: "Torso", locationDisplay: "Torso", rawText: "Torso" },
    replayArmorChargeResolution: { handled: true, useArmorCharge: false, appliedDamageType: "blunt" }
  };
  const first = await resolveSuccessfulAttackDamageForTarget(args);
  assert.equal(target.system.health.value, 70);
  await applyRollUndoRecords(first.application.undoRecords);
  assert.equal(target.system.health.value, 80);
  const replay = await resolveSuccessfulAttackDamageForTarget(args);
  assert.equal(replay.damageRoll.displayTotal, 10);
  assert.equal(target.system.health.value, 70);
});

await test("Mage Block replay recalculates damage when Tipping Scales becomes eligible", async () => {
  const { planNotableCombatEdgeExplodeReplay } = await import("../module/applications/combat/notable-combat-workflow.mjs");
  const combat = { name: "Strike", targetingType: "Melee", tippingScales: 1,
    baseUsage: { rules: [{ when: "success", tagKeys: ["tippingScales"] }] } };
  const attacker = { id: "scale-replay-attacker", system: { notableCombats: [combat] } };
  game.actors.set(attacker.id, attacker);
  const failed = { toHit: 7, accuracy: 0, initialDice: [3, 3], allDice: [3, 3],
    initialTotal: 6, total: 6, baseMoS: -0.25, totalMoS: -0.25, isSuccess: false, resultText: "Failure" };
  const passed = { ...failed, initialDice: [5, 6], allDice: [5, 6], initialTotal: 11, total: 11,
    baseMoS: 1, totalMoS: 1, isSuccess: true, resultText: "Success" };
  const checkpoint = { version: 2, type: "notableCombatPostRoll", stage: "attack",
    actor: { actorId: attacker.id }, combatIndex: 0, targetingType: "Melee", attackRollResult: failed,
    targets: [{ locationRoll: { byMageBlock: true }, defensePromptResult: {
      selection: "defense", activeDefense: true, selectedDefense: { block: true, blockType: "Mage" },
      defenseRoll: { rolled: true, rollResult: passed }, appliedAccuracyPenalty: 0, appliedToHitPenalty: 0
    } }] };
  const changed = await planNotableCombatEdgeExplodeReplay({ checkpoint, rollResult: passed });
  assert.equal(changed.ok, true);
  assert.equal(changed.replayRequired, true, "new penetration must replace the already applied Mage Block damage");
  combat.baseUsage.rules = [];
  const unchanged = await planNotableCombatEdgeExplodeReplay({ checkpoint, rollResult: passed });
  assert.equal(unchanged.replayRequired, false, "unchanged penetration retains the existing damage roll");
});

for (const blockType of ["Weapon", "Shield", "Mage"]) {
  await test(`incoming ${blockType} Block resolves Scale before the block and does not scale overflow again`, async () => {
    const { applyIncomingHit } = await import("../module/applications/combat/incoming-hit-requests.mjs");
    const target = actorFixture();
    target.system.notableCombats = [{ id: "scale-block", name: `${blockType} Block`,
      defense: { block: true, blockType, hardness: 2, hp: 1, maxHp: 3, shieldArm: "LeftArm" } }];
    game.actors.set(target.id, target);
    if (blockType === "Mage") {
      const { buildMageBlockBarrierEffectSource } = await import("../module/data/active-effect/mage-block-effects.mjs");
      const barrier = { id: "scale-mage-barrier", ...buildMageBlockBarrierEffectSource(target, {
        identity: "notableCombats:scale-block:base", hp: 3, maxHp: 3, includeDuress: true
      }), async delete() { target.effects = []; } };
      target.effects = [barrier];
    }
    const selection = { selectedCombatId: "scale-block", selectedCombatIndex: 0, replayBraceChoice: "normal" };
    const result = await applyIncomingHit({ targetActorId: target.id, damageAmount: 20, damageType: "blunt",
      location: "Torso", domeAlreadyResolved: true,
      ...(blockType === "Weapon" ? { weaponBlock: { ...selection, originalDamageAmount: 20 } } : {}),
      ...(blockType === "Shield" ? { shieldBlock: selection } : {}),
      ...(blockType === "Mage" ? { mageBlock: selection } : {}) });
    assert.equal(result.applied, true);
    assert.equal(target.system.health.value, blockType === "Mage" ? 78 : 77);
    if (blockType === "Shield") {
      assert.equal(result.damageAmount, 5);
      assert.equal(result.hardnessApplied, 1, "Shield Hardness is capped by its remaining HP");
      assert.equal(result.armDamage, 3);
    }
    if (blockType === "Mage") {
      assert.equal(result.absorbed, 3);
      assert.equal(result.overflow, 2);
      assert.equal(target.effects.length, 0, "the exhausted Mage Block barrier is removed");
    }
  });
}
