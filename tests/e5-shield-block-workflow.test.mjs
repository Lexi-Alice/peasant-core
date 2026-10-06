import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const defensePromptSource = readFileSync(new URL("../module/applications/combat/defense-prompt-dialog.mjs", import.meta.url), "utf8");
assert.doesNotMatch(defensePromptSource, /shieldBlockBrace/, "Shield Brace is no longer selected before damage is known");

const dialogInstances = [];
let renderShieldCloseControl = false;
globalThis.foundry = {
  utils: { deepClone: structuredClone, randomID: () => "shield-undo" },
  applications: { api: { DialogV2: class {
    constructor(config) {
      this.config = config;
      if (renderShieldCloseControl && config.classes.includes("pc-shield-brace-dialog")) {
        this.element = { nodeType: 1, querySelector: () => null, isConnected: true };
      }
      dialogInstances.push(this);
    }
    render() { return Promise.resolve(this); }
  } } }
};
globalThis.window = { setInterval };
globalThis.$ = (element) => element?.nodeType === 1 ? {
  0: element,
  closest: () => [element],
  find: () => ({
    off() { return this; },
    on(_event, callback) { element.closeClick = callback; return this; }
  })
} : ({
  find: (selector) => ({
    val: () => selector.includes("defenseCombatIndex") ? "0:base" : selector.includes("defensePreviewToHit") ? "7" : "0"
  })
});
globalThis.game = {
  user: { id: "owner", isGM: false },
  users: [{ id: "owner", active: true, isGM: false }],
  actors: new Map(),
  peasantCore: {}
};
globalThis.canvas = { tokens: { controlled: [] } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.ChatMessage = { applyMode: (data) => data, getSpeaker: () => ({}), create: async (data) => ({ id: "shield-card", ...data }) };

const { showShieldBracePrompt } = await import("../module/applications/combat/shield-brace-dialog.mjs");
const { applyIncomingHit, requestIncomingHitApplicationForTarget } = await import("../module/applications/combat/incoming-hit-requests.mjs");
const { showDefensePromptDialog } = await import("../module/applications/combat/defense-prompt-dialog.mjs");
async function nextDialogAfter(previousCount) {
  while (dialogInstances.length <= previousCount) await new Promise((resolve) => setTimeout(resolve, 0));
  return dialogInstances.at(-1);
}
async function closeShieldDialog(dialog) {
  await Promise.resolve();
  assert.equal(typeof dialog.element.closeClick, "function", "the header X can still cancel the Shield choice");
  dialog.element.closeClick();
  renderShieldCloseControl = false;
}

const bracePromptPromise = showShieldBracePrompt({
  actor: { name: "Defender" },
  attackCombatName: "Pistol",
  defense: { hp: 40, hardness: 10 },
  damageAmount: 30,
  normalResult: { hardnessApplied: 10, shieldDamageApplied: 10, armDamage: 10 },
  bracedResult: { hardnessApplied: 20, shieldDamageApplied: 10, armDamage: 0 }
});
const braceDialog = dialogInstances.at(-1);
assert.equal(braceDialog.config.window.title, "Shield Block vs Pistol", "the title names the attacking skill, not the defender");
assert.equal(braceDialog.config.content.replace(/<[^>]*>/g, "").trim(), "Shield: 40 HP / 10 Hardness", "only the current shield stats are displayed");
assert.deepEqual(braceDialog.config.buttons.map((button) => button.action), ["normal", "braced"], "only the two Shield actions are offered");
assert.equal(braceDialog.config.buttons[0].icon, "fa-solid fa-shield-halved");
assert.equal(braceDialog.config.buttons[1].icon, "fa-solid fa-shield");
assert.deepEqual(braceDialog.config.position, { width: 320, height: "auto" }, "the compact prompt fits its remaining content");
await braceDialog.config.buttons.find((button) => button.action === "braced").callback({}, null, braceDialog);
assert.equal(await bracePromptPromise, "braced");

function shieldActor(notableCombats, id = "shield-defender") {
  const actor = {
    id,
    uuid: `Actor.${id}`,
    name: id === "shield-defender" ? "Shield Defender" : `Shield Defender ${id}`,
    type: "character",
    system: { notableCombats },
    effects: [],
    writes: [],
    testUserPermission: (user) => user?.id === "owner",
    canUserModify: (user) => user?.id === "owner",
    getPeasantNotableCombatsForUpdate: () => structuredClone(actor.system.notableCombats),
    async setPeasantNotableCombats(value) {
      actor.writes.push(structuredClone(value));
      actor.system.notableCombats = structuredClone(value);
    },
    async createEmbeddedDocuments(_type, sources) {
      const created = sources.map((source, index) => {
        const stored = { ...structuredClone(source), _id: `guard-${actor.effects.length + index + 1}` };
        const effect = {
          id: stored._id,
          _id: stored._id,
          type: stored.type,
          name: stored.name,
          disabled: stored.disabled,
          flags: structuredClone(stored.flags),
          _source: stored,
          toObject: () => structuredClone(effect._source),
          async update(patch) {
            Object.assign(effect._source, structuredClone(patch));
            Object.assign(effect, structuredClone(patch));
          }
        };
        return effect;
      });
      actor.effects.push(...created);
      return created;
    },
    async updateEmbeddedDocuments(_type, updates) {
      for (const update of updates) {
        const effect = actor.effects.find((entry) => entry.id === update._id);
        if (!effect) continue;
        Object.assign(effect._source, structuredClone(update));
        Object.assign(effect, structuredClone(update));
      }
      return updates;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      actor.effects = actor.effects.filter((effect) => !ids.includes(effect.id));
      return ids;
    },
    async applyPeasantTargetedDamage(options) {
      actor.armDamage = options;
      return { ok: true, damageToGrid: options.amount, events: [] };
    },
    async update(patch) {
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.replace(/^system\./, "").split(".");
        let target = actor.system;
        for (const key of parts.slice(0, -1)) target = target[key] ??= {};
        target[parts.at(-1)] = structuredClone(value);
      }
    }
  };
  game.actors.set(actor.id, actor);
  return actor;
}

function shieldEntry(id, { hp = 40, hardness = 10 } = {}) {
  return { id, name: id, tohit: "7", defense: { responses: ["Melee"], block: true, blockType: "Shield", shieldArm: "LeftArm", hp, hardness } };
}

const promptActor = shieldActor([shieldEntry("prompt-shield")]);
const defenseDialogCount = dialogInstances.length;
const defensePromptResultPromise = showDefensePromptDialog({
  targetActorId: promptActor.id,
  attackCombatName: "Prompt Test",
  attackTargetingType: "Melee"
}, { rollNotableCombat: async () => ({ rollResult: { isSuccess: true, totalMoS: 1 } }) });
const defenseDialog = await nextDialogAfter(defenseDialogCount);
assert.doesNotMatch(defenseDialog.config.content, /shieldBlockBrace|Brace\?/i, "the pre-damage defense UI has no Brace control");
await defenseDialog.config.buttons.find((button) => button.action === "roll").callback({}, null, defenseDialog);
const defensePromptResult = await defensePromptResultPromise;
assert.equal(defensePromptResult.selectedCombatId, "prompt-shield", "defense results carry stable entry identity");
assert.equal(Object.hasOwn(defensePromptResult, "shieldBlockBraced"), false, "defense results do not preselect Brace");

const reorderedShieldActor = shieldActor([shieldEntry("other"), shieldEntry("selected")]);
const reorderedDialogCount = dialogInstances.length;
const reorderedShieldHit = applyIncomingHit({
  targetActorId: reorderedShieldActor.id,
  attackCombatName: "Overkill Attack",
  damageAmount: 30,
  damageType: "blunt",
  domeAlreadyResolved: true,
  shieldBlock: { selectedCombatId: "selected", selectedCombatIndex: 0 }
});
const reorderedDialog = await nextDialogAfter(reorderedDialogCount);
assert.equal(reorderedDialog.config.window.title, "Shield Block vs Overkill Attack", "the local hit carries the attacking skill into the prompt");
assert.match(reorderedDialog.config.content, /Shield: 40 HP \/ 10 Hardness/, "the selected shield stats survive reordering");
await reorderedDialog.config.buttons.find((button) => button.action === "braced").callback({}, null, reorderedDialog);
const reorderedShieldResult = await reorderedShieldHit;
assert.equal(reorderedShieldResult.applied, true);
assert.equal(reorderedShieldActor.writes.length, 1, "the target owner writes the selected shield exactly once");
assert.equal(reorderedShieldActor.system.notableCombats[0].defense.hp, 40, "a reorder does not redirect damage to another defense");
assert.equal(reorderedShieldActor.system.notableCombats[1].defense.hp, 30, "the selected stable ID receives the brace result");
assert.equal(reorderedShieldResult.braced, true);
assert.equal(reorderedShieldResult.armDamage, 0);
assert.equal(reorderedShieldActor.effects.length, 1, "bracing creates one Guard-Broken effect");
assert.equal(reorderedShieldActor.effects[0].flags["peasant-core"].guardBroken, true);
assert.equal(reorderedShieldActor.effects[0]._source.duration.expiry, "roundEnd");

const refreshBraceDialogCount = dialogInstances.length;
const refreshBraceHit = applyIncomingHit({
  targetActorId: reorderedShieldActor.id,
  attackCombatName: "Second Braced Attack",
  damageAmount: 10,
  damageType: "blunt",
  domeAlreadyResolved: true,
  shieldBlock: { selectedCombatId: "selected", selectedCombatIndex: 0 }
});
const refreshBraceDialog = await nextDialogAfter(refreshBraceDialogCount);
await refreshBraceDialog.config.buttons.find((button) => button.action === "braced").callback({}, null, refreshBraceDialog);
await refreshBraceHit;
assert.equal(reorderedShieldActor.effects.length, 1, "reapplying Guard-Broken refreshes rather than duplicates the effect");

const cancelledShieldActor = shieldActor([shieldEntry("cancelled")]);
const cancelledDialogCount = dialogInstances.length;
renderShieldCloseControl = true;
const cancelledShieldHit = applyIncomingHit({
  targetActorId: cancelledShieldActor.id,
  damageAmount: 30,
  damageType: "blunt",
  domeAlreadyResolved: true,
  shieldBlock: { selectedCombatId: "cancelled", selectedCombatIndex: 0 }
});
const cancelledDialog = await nextDialogAfter(cancelledDialogCount);
await closeShieldDialog(cancelledDialog);
const cancelledShieldResult = await cancelledShieldHit;
assert.equal(cancelledShieldResult.chainCancelled, true);
assert.equal(cancelledShieldActor.writes.length, 0, "cancelling leaves target state untouched");

const localCancelledActor = shieldActor([shieldEntry("local-cancelled")], "local-cancelled-owner");
let cancelledFallbacks = 0;
game.peasantCore.applyIncomingHitForUser = async () => {
  cancelledFallbacks += 1;
  return { handled: false, applied: false, reason: "unexpectedFallback" };
};
const localCancelDialogCount = dialogInstances.length;
renderShieldCloseControl = true;
const localCancelledRequest = requestIncomingHitApplicationForTarget({
  target: { actor: localCancelledActor },
  combat: { name: "Cancelled Shield", targetingType: "Melee", damage: { type: "blunt" } },
  damageRoll: { total: 30, normalizedType: "blunt" },
  locationRoll: { location: "Torso", locationDisplay: "Torso", rawText: "Torso" },
  shieldBlock: { selectedCombatId: "local-cancelled", selectedUsageId: "base" }
});
const localCancelDialog = await nextDialogAfter(localCancelDialogCount);
await closeShieldDialog(localCancelDialog);
const localCancelledResult = await localCancelledRequest;
assert.equal(cancelledFallbacks, 0, "handled Shield cancellation terminates without remote or local fallback");
assert.equal(localCancelledResult.chainCancelled, true);
assert.equal(localCancelledResult.reason, "shieldBraceCancelled");
assert.equal(dialogInstances.length - localCancelDialogCount, 1, "the local owner sees exactly one Brace prompt");
assert.equal(localCancelledActor.writes.length, 0);
assert.equal(localCancelledActor.effects.length, 0);
assert.equal(localCancelledActor.armDamage, undefined);
delete game.peasantCore.applyIncomingHitForUser;

const invalidIdShieldActor = shieldActor([shieldEntry("legacy-index")]);
const invalidIdShieldResult = await applyIncomingHit({
  targetActorId: invalidIdShieldActor.id,
  damageAmount: 30,
  damageType: "blunt",
  shieldBlock: { selectedCombatId: "missing", selectedCombatIndex: 0 }
});
assert.equal(invalidIdShieldResult.reason, "invalidShieldBlockDefense", "a supplied but missing ID must not fall back to a stale index");
assert.equal(invalidIdShieldActor.writes.length, 0);

const legacyShieldActor = shieldActor([shieldEntry("legacy-index")]);
const legacyDialogCount = dialogInstances.length;
const legacyShieldHit = applyIncomingHit({
  targetActorId: legacyShieldActor.id,
  damageAmount: 30,
  damageType: "blunt",
  domeAlreadyResolved: true,
  shieldBlock: { selectedCombatIndex: 0 }
});
const legacyDialog = await nextDialogAfter(legacyDialogCount);
await legacyDialog.config.buttons.find((button) => button.action === "normal").callback({}, null, legacyDialog);
const legacyShieldResult = await legacyShieldHit;
assert.equal(legacyShieldResult.braced, false);
assert.equal(legacyShieldResult.hardnessApplied, 10);
assert.equal(legacyShieldResult.armDamage, 10, "legacy index-only payloads retain the normal split");

const replayShieldActor = shieldActor([shieldEntry("replay-shield")]);
const replayDialogCount = dialogInstances.length;
const replayShieldResultPromise = applyIncomingHit({
  targetActorId: replayShieldActor.id,
  damageAmount: 30,
  damageType: "blunt",
  domeAlreadyResolved: true,
  shieldBlock: { selectedCombatId: "replay-shield", replayBraceChoice: "braced" }
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(dialogInstances.length, replayDialogCount, "replay uses the prior Brace choice without prompting again");
const replayShieldResult = await replayShieldResultPromise;
assert.equal(replayShieldResult.braced, true, "replay preserves the resolved braced action");

const workflowReplayShieldActor = shieldActor([shieldEntry("workflow-replay-shield")]);
game.actors.set(workflowReplayShieldActor.id, workflowReplayShieldActor);
const workflowReplayCombat = {
  name: "Replay Shield",
  targetingType: "Melee",
  damage: { diceCount: 0, diceValue: 0, flat: 30, type: "blunt" }
};
const workflowReplayAttacker = {
  id: "workflow-replay-attacker",
  uuid: "Actor.workflow-replay-attacker",
  name: "Attacker",
  system: { combatMods: {}, notableCombats: [workflowReplayCombat] }
};
game.actors.set(workflowReplayAttacker.id, workflowReplayAttacker);
const replayDialogCountBeforeWorkflow = dialogInstances.length;
const notableCombatWorkflow = await import("../module/applications/combat/notable-combat-workflow.mjs");
const workflowReplayAttackMessage = {
  id: "shield-edge-attack",
  edgeFlag: { version: 1, status: "current", chainId: "shield-chain", kind: "skill", label: "Replay Shield", diceFaces: 6, dice: [4, 5] },
  getFlag: () => workflowReplayAttackMessage.edgeFlag,
  async setFlag(_scope, _key, value) { workflowReplayAttackMessage.edgeFlag = structuredClone(value); }
};
const workflowReplayRollResult = {
  chatMessage: workflowReplayAttackMessage,
  isSuccess: true,
  resultText: "Success",
  baseMoS: 0.1,
  accuracyMoS: 0,
  totalMoS: 0.1
};
await notableCombatWorkflow.attachNotableCombatEdgeIndividualDieCheckpoints({
  rolled: true,
  rollResult: workflowReplayRollResult,
  targetRef: {
    actorId: workflowReplayShieldActor.id,
    actorUuid: workflowReplayShieldActor.uuid,
    targetName: workflowReplayShieldActor.name
  },
  targetName: workflowReplayShieldActor.name,
  defensePromptResult: {
    selection: "defense",
    selectedCombatId: "workflow-replay-shield",
    selectedCombatIndex: 0,
    appliedAccuracyPenalty: 1,
    selectedDefense: shieldEntry("workflow-replay-shield").defense
  },
  incomingHitResolution: { application: { shieldBlock: true, braced: true } }
}, {
  actor: workflowReplayAttacker,
  combat: workflowReplayCombat,
  combatIndex: 0,
  targetingType: "Melee",
  resolvedDamageType: "blunt"
});
const workflowReplayCheckpoint = workflowReplayAttackMessage.edgeFlag.checkpoint;
assert.equal(workflowReplayCheckpoint.targets[0].shieldBlockReplayChoice, "braced", "checkpoint attachment stores the resolved owner choice");
const workflowReplayResult = await notableCombatWorkflow.replayNotableCombatPostRollEffects({
  checkpoint: workflowReplayCheckpoint,
  rollResult: { isSuccess: true, resultText: "Success", baseMoS: 0.1, accuracyMoS: 0, totalMoS: 0.1 }
});
assert.equal(workflowReplayResult.ok, true, workflowReplayResult.error);
assert.equal(workflowReplayResult.rollOutcome.incomingHitResolution.application.braced, true, "Edge replay preserves the resolved braced action");
assert.equal(
  workflowReplayResult.rollOutcome.incomingHitResolution.application.requestPayload.shieldBlock.replayBraceChoice,
  "braced",
  "Edge replay forwards the checkpoint choice to the owner application"
);
assert.equal(dialogInstances.length, replayDialogCountBeforeWorkflow, "Edge replay does not reopen the Brace prompt");

const multiNormalShieldActor = shieldActor([shieldEntry("multi-normal-shield")], "multi-normal-target");
const multiBracedShieldActor = shieldActor([shieldEntry("multi-braced-shield")], "multi-braced-target");
game.actors.set(multiNormalShieldActor.id, multiNormalShieldActor);
game.actors.set(multiBracedShieldActor.id, multiBracedShieldActor);
const multiReplayAttackMessage = {
  id: "multi-shield-edge-attack",
  edgeFlag: { version: 1, status: "current", chainId: "multi-shield-chain", kind: "skill", label: "Replay Shield", diceFaces: 6, dice: [4, 5] },
  getFlag: () => multiReplayAttackMessage.edgeFlag,
  async setFlag(_scope, _key, value) { multiReplayAttackMessage.edgeFlag = structuredClone(value); }
};
const multiReplayRollResult = { ...workflowReplayRollResult, chatMessage: multiReplayAttackMessage };
const multiTargetRollOutcome = {
  rolled: true,
  multiTarget: true,
  sharedAttackRoll: { rolled: true, rollResult: multiReplayRollResult },
  targetRolls: [
    { actor: multiNormalShieldActor, shieldId: "multi-normal-shield", braced: false },
    { actor: multiBracedShieldActor, shieldId: "multi-braced-shield", braced: true }
  ].map(({ actor, shieldId, braced }) => ({
    targetRef: { actorId: actor.id, actorUuid: actor.uuid, targetName: actor.name },
    targetName: actor.name,
    defensePromptResult: {
      selection: "defense",
      selectedCombatId: shieldId,
      selectedCombatIndex: 0,
      appliedAccuracyPenalty: 1,
      selectedDefense: shieldEntry(shieldId).defense
    },
    incomingHitResolution: { application: { shieldBlock: true, braced } }
  }))
};
await notableCombatWorkflow.attachNotableCombatEdgeIndividualDieCheckpoints(multiTargetRollOutcome, {
  actor: workflowReplayAttacker,
  combat: workflowReplayCombat,
  combatIndex: 0,
  targetingType: "Melee",
  resolvedDamageType: "blunt"
});
const multiReplayCheckpoint = multiReplayAttackMessage.edgeFlag.checkpoint;
assert.deepEqual(
  multiReplayCheckpoint.targets.map((entry) => entry.shieldBlockReplayChoice),
  ["normal", "braced"],
  "multi-target checkpoint stores each target owner's Shield Brace choice"
);
const multiReplayDialogCount = dialogInstances.length;
const multiReplayResult = await notableCombatWorkflow.replayNotableCombatPostRollEffects({
  checkpoint: multiReplayCheckpoint,
  rollResult: { isSuccess: true, resultText: "Success", baseMoS: 0.1, accuracyMoS: 0, totalMoS: 0.1 }
});
assert.equal(multiReplayResult.ok, true, multiReplayResult.error);
assert.deepEqual(
  multiReplayResult.rollOutcome.targetRolls.map((entry) => entry.incomingHitResolution.application.braced),
  [false, true],
  "multi-target Edge replay retains each resolved Shield Brace choice"
);
assert.deepEqual(
  multiReplayResult.rollOutcome.targetRolls.map((entry) => entry.incomingHitResolution.application.requestPayload.shieldBlock.replayBraceChoice),
  ["normal", "braced"]
);
assert.equal(dialogInstances.length, multiReplayDialogCount, "multi-target replay skips both Brace prompts");

const remoteShieldActor = shieldActor([shieldEntry("remote-selected")]);
game.user = { id: "attacker", isGM: false };
let remoteShieldPayload = null;
game.peasantCore.applyIncomingHitForUser = async (userId, payload) => {
  assert.equal(userId, "owner");
  remoteShieldPayload = structuredClone(payload);
  game.user = { id: "owner", isGM: false };
  try {
    game.actors = new Map([[remoteShieldActor.id, remoteShieldActor]]);
    return await applyIncomingHit(payload);
  } finally {
    game.user = { id: "attacker", isGM: false };
  }
};
const remoteDialogCount = dialogInstances.length;
const remoteShieldHit = requestIncomingHitApplicationForTarget({
  target: { actor: remoteShieldActor, targetName: remoteShieldActor.name },
  attackerActor: { id: "attacker", name: "Attacker" },
  combat: { name: "Remote Shield Test", targetingType: "Melee", damage: { type: "blunt" } },
  damageRoll: { total: 40, normalizedType: "blunt" },
  locationRoll: { location: "Torso", locationDisplay: "Torso", rawText: "Torso" },
  incomingHitResolution: { appliedDamageType: "blunt" },
  damageAmountOverride: 30,
  shieldBlock: { selectedCombatId: "remote-selected", selectedCombatIndex: 0 },
  domeAlreadyResolved: true
});
const remoteShieldDialog = await nextDialogAfter(remoteDialogCount);
assert.equal(remoteShieldDialog.config.window.title, "Shield Block vs Remote Shield Test", "the owner prompt retains the remote attacking skill name");
assert.match(remoteShieldDialog.config.content, /Shield: 40 HP \/ 10 Hardness/);
await remoteShieldDialog.config.buttons.find((button) => button.action === "braced").callback({}, null, remoteShieldDialog);
const remoteShieldResult = await remoteShieldHit;
assert.equal(remoteShieldResult.applied, true, "the remote target owner resolves Shield Block");
assert.equal(remoteShieldResult.damageAmount, 30, "Brace still resolves the already-reduced Dome damage without displaying it");
assert.equal(Object.hasOwn(remoteShieldPayload.shieldBlock, "braced"), false, "the remote payload leaves Brace choice to the target owner");
assert.equal(remoteShieldPayload.shieldBlock.selectedCombatId, "remote-selected");
assert.equal(remoteShieldActor.writes.length, 1, "the remote target owner writes shield state once");
assert.equal(remoteShieldResult.shieldHpAfter, 30);
assert.equal(remoteShieldResult.armDamage, 0);
assert.equal(remoteShieldActor.effects.length, 1, "remote bracing creates Guard-Broken on the owner actor");
game.user = { id: "owner", isGM: false };
const { applyRollUndoRecords } = await import("../module/applications/chat-undo.mjs");
assert.equal((await applyRollUndoRecords(remoteShieldResult.undoRecords)).ok, true);
assert.equal(remoteShieldActor.system.notableCombats[0].defense.hp, 40, "remote Shield Block undo restores its current HP");
assert.equal(remoteShieldActor.effects.length, 0, "remote undo removes Guard-Broken created by Brace");

console.log("E5 Shield Block workflow tests passed.");
