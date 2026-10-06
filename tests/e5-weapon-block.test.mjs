import assert from "node:assert/strict";

globalThis.Actor = class {};
globalThis.foundry = {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    escapeHTML: (value) => String(value),
    randomID: () => `undo-${Math.random()}`
  }
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };

const messages = new Map();
let nextMessageId = 0;
function makeMessage(data = {}) {
  const message = {
    id: `message-${++nextMessageId}`,
    flags: {},
    content: data.content || "",
    async setFlag(scope, key, value) {
      this.flags[scope] ||= {};
      this.flags[scope][key] = value;
      return this;
    },
    getFlag(scope, key) {
      return this.flags[scope]?.[key];
    },
    async update(changes) {
      Object.assign(this, changes);
      return this;
    },
    canUserModify: () => true
  };
  messages.set(message.id, message);
  return message;
}

const gm = { id: "gm", active: true, isGM: true };
const locationTable = {
  name: "Location",
  results: [{ name: "Torso" }],
  async toMessage(_results, options) {
    return makeMessage(options.messageData);
  }
};
globalThis.game = {
  user: gm,
  users: [gm],
  actors: new Map(),
  messages: { get: (id) => messages.get(id) || null },
  tables: { getName: (name) => name === "Location" ? locationTable : null },
  settings: { get: () => "public" },
  i18n: { format: (key) => key },
  peasantCore: {}
};
globalThis.Hooks = { once: () => 1, off: () => {} };
globalThis.ChatMessage = {
  applyMode: (data) => data,
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id || null }),
  create: async (data) => makeMessage(data)
};
globalThis.ui = { notifications: { warn: () => {}, info: () => {} } };
globalThis.canvas = { tokens: { controlled: [] } };

const { resolveSuccessfulAttackDamageForTarget } = await import("../module/applications/combat/successful-attack-damage.mjs");
const { replayNotableCombatPostRollEffects } = await import("../module/applications/combat/notable-combat-workflow.mjs");
const { planNotableCombatEdgeExplodeReplay } = await import("../module/applications/combat/notable-combat-workflow.mjs");
const { buildManifestSpellEffectChanges } = await import("../module/data/active-effect/spell-effect-change-keys.mjs");

const weaponDefense = {
  block: true,
  blockType: "Weapon",
  hardness: 2,
  masteryBonus: true
};
const combat = {
  id: "attacker-combat",
  name: "Weapon Block Test",
  targetingType: "Melee",
  magnetism: { grade: 0 },
  damage: { diceCount: 0, diceValue: 0, flat: 5, type: "blunt" }
};

function createTarget() {
  const appliedDamage = [];
  let weaponItemUpdates = 0;
  const weaponItem = {
    id: "weapon-without-stored-uuid",
    async update() {
      weaponItemUpdates += 1;
    }
  };
  const defenseEntry = {
    id: "weapon-defense",
    name: "Weapon Defense",
    defense: { ...weaponDefense }
  };
  const actor = {
    id: `target-${game.actors.size}`,
    uuid: `Actor.target-${game.actors.size}`,
    name: "Target",
    system: { notableCombats: [defenseEntry] },
    items: [weaponItem],
    effects: [],
    canUserModify: () => true,
    getPeasantNotableCombatsForUpdate() {
      return structuredClone(this.system.notableCombats);
    },
    async applyPeasantTargetedDamage(options) {
      appliedDamage.push(options);
      return { ok: true, damageToGrid: 0 };
    }
  };
  game.actors.set(actor.id, actor);
  return { actor, appliedDamage, get weaponItemUpdates() { return weaponItemUpdates; } };
}

function passedWeaponDefenseResult() {
  return {
    selection: "defense",
    selectedCombatId: "weapon-defense",
    selectedCombatIndex: 0,
    selectedDefense: { ...weaponDefense },
    appliedAccuracyPenalty: 1,
    defenseRoll: { rollResult: { isSuccess: true } }
  };
}

const attacker = {
  id: "attacker",
  uuid: "Actor.attacker",
  name: "Attacker",
  system: { combatMods: {}, notableCombats: [combat] }
};
game.actors.set(attacker.id, attacker);

const liveTarget = createTarget();
const attackRoll = { rollResult: { isSuccess: false, failureDueToDefense: true, totalMoS: 0 } };
const liveResult = await resolveSuccessfulAttackDamageForTarget({
  actor: attacker,
  combat,
  target: { actor: liveTarget.actor, targetName: liveTarget.actor.name },
  attackRoll,
  defensePromptResult: passedWeaponDefenseResult()
});

assert.equal(liveResult?.locationRoll?.byMagnetism, true);
assert.equal(liveResult?.locationRoll?.magnetismGrade, 1, "a passed-but-defeated Melee Weapon Block keeps one mastery Magnetism grade");
assert.equal(liveResult?.application?.weaponBlock, true);
assert.equal(liveResult?.application?.weaponOverflowDamage, 3);
assert.equal(liveResult?.application?.cleanHit, true, "Weapon Block overflow is marked as a Clean Hit");
assert.equal(liveResult?.application?.weaponSunderRequired, true, "Weapon Block overflow reports the required Weapon Sunder");
assert.equal(liveTarget.appliedDamage[0]?.amount, 3);
assert.equal(liveTarget.weaponItemUpdates, 0, "no weapon Item is mutated when the defense has no stored Item UUID");

const replayTarget = createTarget();
const replay = await replayNotableCombatPostRollEffects({
  checkpoint: {
    version: 2,
    type: "notableCombatPostRoll",
    stage: "attack",
    actor: { actorId: attacker.id },
    combatIndex: 0,
    combatName: combat.name,
    targetingType: "Melee",
    resolvedDamageType: "blunt",
    attackRollResult: { ...attackRoll.rollResult },
    multiTarget: false,
    targetLabel: replayTarget.actor.name,
    targets: [{
      targetRef: { actorId: replayTarget.actor.id, targetName: replayTarget.actor.name },
      targetLabel: replayTarget.actor.name,
      defensePromptResult: passedWeaponDefenseResult()
    }]
  },
  rollResult: attackRoll.rollResult
});

assert.equal(replay?.ok, true);
assert.equal(replay?.rollOutcome?.incomingHitResolution?.locationRoll?.byMagnetism, true);
assert.equal(replay?.rollOutcome?.incomingHitResolution?.locationRoll?.magnetismGrade, 1, "replay uses the same passed-but-defeated Melee Weapon Block mastery grade");
assert.equal(replay?.rollOutcome?.incomingHitResolution?.application?.cleanHit, true);
assert.equal(replay?.rollOutcome?.incomingHitResolution?.application?.weaponSunderRequired, true);
assert.equal(replayTarget.appliedDamage[0]?.amount, 3);
assert.equal(replayTarget.weaponItemUpdates, 0, "replay does not guess a weapon Item when no UUID is stored");

const domeTarget = createTarget();
domeTarget.actor.canUserModify = () => false;
domeTarget.actor.testUserPermission = user => user?.id === "owner";
domeTarget.actor.effects.push({
  id: "dome-only-magnetism",
  type: "spellEffect",
  disabled: false,
  duration: { expired: false, remaining: 2, value: 3 },
  changes: buildManifestSpellEffectChanges({
    manifestType: "dome",
    hp: { value: 5, max: 5 },
    magnetismGrade: 1
  })
});
const attackerUser = { id: "attacker-user", isGM: false };
const targetOwner = { id: "owner", active: true, isGM: false };
game.user = attackerUser;
game.users = [targetOwner];
game.peasantCore.absorbManifestDomeForUser = async (_userId, payload) => ({
  handled: true,
  applied: true,
  absorbed: 2,
  penetration: Math.max(0, payload.damage - 2),
  remainingHp: 3,
  depleted: false,
  magnetismGrade: 1,
  undoRecords: []
});
game.peasantCore.applyIncomingHitForUser = async () => ({
  handled: true,
  applied: true,
  weaponBlock: true,
  weaponOverflowDamage: 1,
  cleanHit: true,
  weaponSunderRequired: true
});
const domeCombat = { ...combat, name: "Dome Weapon Block", magnetism: { grade: 0 } };
const passedUnmasteredWeaponDefense = {
  ...passedWeaponDefenseResult(),
  selectedDefense: { ...weaponDefense, masteryBonus: false }
};
const domeLive = await resolveSuccessfulAttackDamageForTarget({
  actor: attacker,
  combat: domeCombat,
  target: { actor: domeTarget.actor, targetName: domeTarget.actor.name },
  attackRoll,
  defensePromptResult: passedUnmasteredWeaponDefense
});
assert.equal(domeLive.locationRoll.byMagnetism, true);
assert.equal(domeLive.locationRoll.domeMagnetismGrade, 1, "Dome Magnetism survives the direct Weapon Block overflow location path");

const domeLocationCheckpoint = {
  rawText: domeLive.locationRoll.rawText,
  location: domeLive.locationRoll.location,
  locationDisplay: domeLive.locationRoll.locationDisplay,
  isAP: domeLive.locationRoll.isAP,
  byMagnetism: domeLive.locationRoll.byMagnetism,
  magnetismGrade: domeLive.locationRoll.magnetismGrade,
  domeMagnetismGrade: domeLive.locationRoll.domeMagnetismGrade
};
const domeCheckpoint = {
  version: 2,
  type: "notableCombatPostRoll",
  stage: "attack",
  actor: { actorId: attacker.id, actorUuid: attacker.uuid },
  combatIndex: 0,
  targetingType: "Melee",
  attackRollResult: structuredClone(attackRoll.rollResult),
  targets: [{
    targetRef: { actorId: domeTarget.actor.id, actorUuid: domeTarget.actor.uuid, targetName: domeTarget.actor.name },
    defensePromptResult: passedUnmasteredWeaponDefense,
    locationRoll: domeLocationCheckpoint
  }]
};
const unchangedDomeWeaponReplayPlan = await planNotableCombatEdgeExplodeReplay({
  checkpoint: domeCheckpoint,
  rollResult: structuredClone(attackRoll.rollResult)
});
assert.equal(unchangedDomeWeaponReplayPlan.replayRequired, false, "unchanged Dome-only Weapon Block location mode does not request another downstream replay");

const savedWeaponBlockLocation = { ...domeLocationCheckpoint, rawText: "Saved Weapon Block location" };
const replayedDomeWeaponBlock = await resolveSuccessfulAttackDamageForTarget({
  actor: attacker,
  combat: domeCombat,
  target: { actor: domeTarget.actor, targetName: domeTarget.actor.name },
  attackRoll,
  defensePromptResult: passedUnmasteredWeaponDefense,
  replayLocationRoll: savedWeaponBlockLocation
});
assert.equal(replayedDomeWeaponBlock.locationRoll.rawText, "Saved Weapon Block location", "Weapon Block Edge replay reuses its resolved location checkpoint");

console.log("weapon block workflow tests passed");
