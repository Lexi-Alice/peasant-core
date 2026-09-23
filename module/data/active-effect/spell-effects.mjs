import {
  MANIFEST_SPELL_EFFECT_CHANGE_KEYS,
  buildManifestSpellEffectChanges,
  getManifestSpellEffectChangeMode,
  getManifestSpellEffectChanges,
  getManifestSpellEffectState,
  setManifestSpellCurrentHp,
  toFoundryManifestSpellEffectChanges
} from "./spell-effect-change-keys.mjs";

export const MANIFEST_SPELL_DEFINITIONS = Object.freeze({
  manifestDome: Object.freeze({
    rollType: "manifestDome",
    manifestType: "dome",
    category: "aura",
    label: "Manifest Dome",
    durationLabel: "3 Rounds"
  }),
  manifestResistance: Object.freeze({
    rollType: "manifestResistance",
    manifestType: "resistance",
    category: "armor",
    label: "Manifest Resistance",
    durationLabel: "Duress"
  })
});

const MANIFEST_SPELL_DEFINITION_LIST = Object.freeze(Object.values(MANIFEST_SPELL_DEFINITIONS));

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function normalizedIdentifier(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function getManifestSpellDefinition(rollTypeOrManifestType) {
  const normalized = normalizedIdentifier(rollTypeOrManifestType);
  return MANIFEST_SPELL_DEFINITION_LIST.find((definition) => (
    normalizedIdentifier(definition.rollType) === normalized
    || definition.manifestType === normalized
  )) || null;
}

export function getManifestSpellRemainingDuration(effect) {
  const state = getManifestSpellEffectState(effect);
  const definition = getManifestSpellDefinition(state.manifestType);
  if (!definition) return "";
  if (!String(effect?.system?.encounterId || "").trim()) return "Pending Combat";
  if (definition.manifestType === "resistance") return "Duress";

  const nativeRemaining = Number(effect?.duration?.remaining);
  const remaining = Number.isFinite(nativeRemaining)
    ? Math.max(0, Math.ceil(nativeRemaining))
    : nonNegativeInteger(effect?.duration?.value);
  return `${remaining} ${remaining === 1 ? "Round" : "Rounds"}`;
}

export function getManifestMaximizedValue({ diceCount = 0, diceValue = 0, flat = 0 } = {}) {
  const naturalMaximum = nonNegativeInteger(diceCount) * nonNegativeInteger(diceValue);
  const flatValue = Number.isFinite(Number(flat)) ? Math.trunc(Number(flat)) : 0;
  return Math.max(0, naturalMaximum + flatValue);
}

export function resolveManifestSpellHp({
  manifestType = "",
  rollTotal = 0,
  maximized = 0,
  existing = null,
  replacement = false
} = {}) {
  const definition = getManifestSpellDefinition(manifestType);
  if (!definition) return null;

  const roll = nonNegativeInteger(rollTotal);
  const maximum = nonNegativeInteger(maximized);
  const gain = definition.manifestType === "resistance" ? Math.floor(roll / 2) : roll;
  const castCap = definition.manifestType === "dome" ? maximum * 2 : maximum;
  const recasting = !!existing && !replacement;
  const max = castCap;
  const currentValue = recasting ? nonNegativeInteger(existing.value) : 0;

  return {
    gain,
    value: Math.min(currentValue + gain, max),
    max
  };
}

export function absorbMagicalHp({ damage = 0, hp = 0, damageType = "" } = {}) {
  const incoming = nonNegativeInteger(damage);
  const currentHp = nonNegativeInteger(hp);
  const absorbed = Math.min(incoming, currentHp);
  const remainingHp = Math.max(0, currentHp - absorbed);

  return {
    absorbed,
    penetration: Math.max(0, incoming - absorbed),
    remainingHp,
    depleted: remainingHp === 0,
    damageType: String(damageType ?? "")
  };
}

export function resolveResistanceDamageStage({
  damage = 0,
  naturalHalt = 0,
  armorHalt = 0,
  isArmorPenetrating = false,
  ignoreHaltReduction = false,
  resistanceHp = 0
} = {}) {
  const incoming = nonNegativeInteger(damage);
  const naturalHaltUsed = ignoreHaltReduction ? 0 : nonNegativeInteger(naturalHalt);
  const armorHaltUsed = (ignoreHaltReduction || isArmorPenetrating) ? 0 : nonNegativeInteger(armorHalt);
  const haltUsed = naturalHaltUsed + armorHaltUsed;
  const damageAfterHalt = Math.max(0, incoming - haltUsed);
  const resistance = absorbMagicalHp({ damage: damageAfterHalt, hp: resistanceHp });
  return {
    damage: incoming,
    naturalHaltUsed,
    armorHaltUsed,
    haltUsed,
    damageAfterHalt,
    absorbed: resistance.absorbed,
    penetration: resistance.penetration,
    remainingHp: resistance.remainingHp,
    depleted: resistance.depleted
  };
}

export function isActiveSpellEffect(effect) {
  return !!(
    effect
    && effect.type === "spellEffect"
    && !effect.disabled
    && !effect.duration?.expired
  );
}

export function findActiveSpellEffectInCategory(actor, category, { excludeId = "" } = {}) {
  const normalizedCategory = normalizedIdentifier(category);
  if (!actor || !normalizedCategory) return null;

  return Array.from(actor.effects || []).find((effect) => (
    isActiveSpellEffect(effect)
    && String(effect.id ?? effect._id ?? "") !== String(excludeId || "")
    && getManifestSpellEffectState(effect).buffCategory === normalizedCategory
  )) || null;
}

export function collectManifestSpellRecipients({ caster = null, targets = [] } = {}) {
  const recipients = [];
  const seen = new Set();

  for (const target of Array.isArray(targets) ? targets : []) {
    const actor = target?.actor || null;
    const key = String(actor?.uuid || actor?.id || "").trim();
    if (!actor || !key || seen.has(key)) continue;
    seen.add(key);
    recipients.push(target);
  }

  if (recipients.length > 0 || !caster) return recipients;
  return [{
    actor: caster,
    actorId: caster.id || null,
    token: null,
    tokenDocument: null,
    tokenId: null,
    targetName: String(caster.name || "Caster").trim() || "Caster"
  }];
}

const SPELL_EFFECT_WRITE_OPTIONS = Object.freeze({ peasantCoreSpellEffectWrite: true });

function getSpellEffectWriteOptions() {
  return { ...SPELL_EFFECT_WRITE_OPTIONS };
}
const INDEFINITE_SPELL_DURATION = Object.freeze({
  value: null,
  units: "rounds",
  expiry: null,
  expired: false
});
const DOME_SPELL_DURATION = Object.freeze({
  value: 3,
  units: "rounds",
  expiry: "roundEnd",
  expired: false
});
const RESISTANCE_SPELL_DURATION = Object.freeze({
  value: null,
  units: "rounds",
  expiry: "combatEnd",
  expired: false
});
let spellEffectSlotGuardsConfigured = false;

function getEffectId(effect) {
  return String(effect?.id ?? effect?._id ?? "").trim();
}

function actorIsCombatant(actor, combat) {
  const actorId = String(actor?.id || "");
  const actorUuid = String(actor?.uuid || "");
  return Array.from(combat?.combatants || []).some((combatant) => (
    String(combatant?.actorId || combatant?.actor?.id || "") === actorId
    || (!!actorUuid && String(combatant?.actor?.uuid || "") === actorUuid)
  ));
}

function combatHasStarted(combat) {
  return !!(combat?.started || Number(combat?.round) > 0);
}

export function getManifestSpellDuration(manifestType, { enrolled = false, duration = null } = {}) {
  const definition = getManifestSpellDefinition(manifestType);
  if (!definition || !enrolled) return { ...INDEFINITE_SPELL_DURATION };
  if (definition.manifestType === "dome") {
    return {
      ...DOME_SPELL_DURATION,
      value: Math.max(1, Number.parseInt(duration, 10) || DOME_SPELL_DURATION.value)
    };
  }
  return { ...RESISTANCE_SPELL_DURATION };
}

function getEffectStart(combat = null) {
  const ActiveEffectClass = globalThis.ActiveEffect?.implementation ?? globalThis.ActiveEffect;
  return ActiveEffectClass?.getEffectStart?.(combat) || {
    combat: combat?.id || null,
    combatant: null,
    initiative: null,
    round: combat?.round ?? null,
    time: Number(globalThis.game?.time?.worldTime) || 0,
    turn: combat?.turn ?? null
  };
}

export function getManifestSpellEncounterData(actor, manifestType, { duration = null } = {}) {
  const definition = getManifestSpellDefinition(manifestType);
  const currentCombat = globalThis.game?.combat || null;
  const otherCombats = Array.from(globalThis.game?.combats || [])
    .filter((combat) => combat !== currentCombat)
    .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")));
  const combat = [currentCombat, ...otherCombats]
    .find((entry) => combatHasStarted(entry) && actorIsCombatant(actor, entry)) || null;

  return {
    combat,
    encounterId: combat?.id || "",
    pending: !combat,
    start: getEffectStart(combat),
    duration: getManifestSpellDuration(definition?.manifestType, { enrolled: !!combat, duration })
  };
}

export function buildManifestSpellEffectSource({
  actor = null,
  casterUuid = "",
  manifestType = "",
  hp = null,
  duration = null,
  haltValues = null,
  magnetismGrade = 1,
  img = ""
} = {}) {
  const definition = getManifestSpellDefinition(manifestType);
  if (!definition) return null;

  const encounter = getManifestSpellEncounterData(actor, definition.manifestType, { duration });
  const icon = String(
    img
    || actor?.img
    || globalThis.CONFIG?.ActiveEffect?.documentClass?.DEFAULT_ICON
    || "icons/svg/aura.svg"
  ).trim() || "icons/svg/aura.svg";

  return {
    name: definition.label,
    type: "spellEffect",
    img: icon,
    origin: String(casterUuid || ""),
    disabled: false,
    transfer: false,
    showIcon: globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
    start: encounter.start,
    duration: encounter.duration,
    system: {
      changes: toFoundryManifestSpellEffectChanges(buildManifestSpellEffectChanges({
        manifestType: definition.manifestType,
        hp,
        haltValues,
        magnetismGrade
      })),
      encounterId: encounter.encounterId
    },
    flags: {
      core: { overlay: false },
      "peasant-core": {
        generatedManifestSpell: true,
        ...(definition.manifestType === "dome"
          ? { manifestDuration: Math.max(1, Number.parseInt(duration, 10) || DOME_SPELL_DURATION.value) }
          : {})
      }
    }
  };
}

export function getManifestSpellSlotAction(actor, {
  manifestType = "",
  category = "",
  expectedOccupantId = ""
} = {}) {
  const definition = getManifestSpellDefinition(manifestType);
  if (!definition) return { action: "invalid", effect: null };

  const occupant = findActiveSpellEffectInCategory(actor, category || definition.category);
  if (!occupant) return { action: "create", effect: null };
  if (getManifestSpellEffectState(occupant).manifestType === definition.manifestType) {
    return { action: "recast", effect: occupant };
  }
  if (expectedOccupantId && getEffectId(occupant) !== String(expectedOccupantId)) {
    return { action: "stale", effect: occupant };
  }
  return { action: "replace", effect: occupant };
}

export async function applyManifestSpellEffectToActor(actor, {
  manifestType = "",
  rollTotal = 0,
  maximized = 0,
  duration = null,
  haltValues = null,
  casterUuid = "",
  img = "",
  expectedOccupantId = "",
  replacementApproved = false
} = {}) {
  const definition = getManifestSpellDefinition(manifestType);
  if (!actor || !definition) {
    return { handled: true, applied: false, reason: "unsupportedManifestType" };
  }

  const slot = getManifestSpellSlotAction(actor, {
    manifestType: definition.manifestType,
    category: definition.category,
    expectedOccupantId
  });
  if (slot.action === "stale") {
    return { handled: true, applied: false, reason: "slotChanged" };
  }
  if (slot.action === "replace" && !replacementApproved) {
    return { handled: true, applied: false, reason: "replacementNotApproved" };
  }

  const existingHp = slot.action === "recast"
    ? getManifestSpellEffectState(slot.effect).magicalHp
    : null;
  const previousValue = slot.action === "recast" ? nonNegativeInteger(existingHp?.value) : 0;
  const hp = resolveManifestSpellHp({
    manifestType: definition.manifestType,
    rollTotal,
    maximized,
    existing: existingHp,
    replacement: slot.action === "replace"
  });
  const source = buildManifestSpellEffectSource({
    actor,
    casterUuid,
    manifestType: definition.manifestType,
    hp,
    duration,
    haltValues,
    img
  });

  let effect = slot.effect;
  if (slot.action === "create") {
    const created = await actor.createEmbeddedDocuments?.("ActiveEffect", [source], getSpellEffectWriteOptions());
    effect = created?.[0] || null;
  } else {
    await effect?.update?.(source, { ...getSpellEffectWriteOptions(), diff: false, recursive: false });
  }

  if (!effect) return { handled: true, applied: false, reason: "documentUpdateFailed" };
  return {
    handled: true,
    applied: true,
    action: slot.action === "create" ? "created" : (slot.action === "replace" ? "replaced" : "recast"),
    effectId: getEffectId(effect),
    gain: Math.max(0, hp.value - previousValue),
    value: hp.value,
    max: hp.max,
    pending: !source.system.encounterId,
    encounterId: source.system.encounterId
  };
}

export async function absorbActorSpellEffect(actor, {
  manifestType = "",
  damage = 0,
  damageType = ""
} = {}) {
  const definition = getManifestSpellDefinition(manifestType);
  const incoming = nonNegativeInteger(damage);
  const effect = definition
    ? findActiveSpellEffectInCategory(actor, definition.category)
    : null;
  const state = getManifestSpellEffectState(effect);
  if (!effect || state.manifestType !== definition.manifestType) {
    return {
      handled: true,
      applied: false,
      reason: definition ? "noEffect" : "unsupportedManifestType",
      absorbed: 0,
      penetration: incoming,
      remainingHp: 0,
      depleted: false,
      damageType: String(damageType ?? "")
    };
  }

  const result = absorbMagicalHp({
    damage: incoming,
    hp: state.magicalHp.value,
    damageType
  });
  const remainingDuration = definition.manifestType === "resistance"
    ? definition.durationLabel
    : getManifestSpellRemainingDuration(effect);
  if (result.depleted) {
    await effect.delete?.(getSpellEffectWriteOptions());
  } else {
    await effect.update?.({
      "system.changes": setManifestSpellCurrentHp(getManifestSpellEffectChanges(effect), result.remainingHp)
    }, getSpellEffectWriteOptions());
  }

  return {
    handled: true,
    applied: result.absorbed > 0,
    effectId: getEffectId(effect),
    magnetismGrade: state.magnetismGrade,
    remainingDuration,
    ...result
  };
}

function proposedSpellEffectChanges(effect, changes = {}) {
  return Array.isArray(changes?.changes)
    ? changes.changes
    : (Array.isArray(changes?.system?.changes)
      ? changes.system.changes
      : (Array.isArray(changes?.["system.changes"])
        ? changes["system.changes"]
        : getManifestSpellEffectChanges(effect)));
}

function proposedSpellEffectState(effect, changes = {}) {
  return getManifestSpellEffectState(effect, { changes: proposedSpellEffectChanges(effect, changes) });
}

function hasDuplicateManifestIdentityRows(effect, changes = {}) {
  const uniqueKeys = new Set([
    MANIFEST_SPELL_EFFECT_CHANGE_KEYS.buffCategory,
    MANIFEST_SPELL_EFFECT_CHANGE_KEYS.manifestType,
    MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp,
    MANIFEST_SPELL_EFFECT_CHANGE_KEYS.maximumHp
  ]);
  const counts = new Map();
  for (const change of proposedSpellEffectChanges(effect, changes)) {
    const key = String(change?.key ?? "").trim();
    if (!uniqueKeys.has(key)) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.values()).some((count) => count > 1);
}

function hasInvalidManifestIdentityMode(effect, changes = {}) {
  const customMode = globalThis.CONST?.ACTIVE_EFFECT_MODES?.CUSTOM ?? 0;
  const identityKeys = new Set([
    MANIFEST_SPELL_EFFECT_CHANGE_KEYS.buffCategory,
    MANIFEST_SPELL_EFFECT_CHANGE_KEYS.manifestType
  ]);
  return proposedSpellEffectChanges(effect, changes).some((change) => (
    identityKeys.has(String(change?.key ?? "").trim())
    && getManifestSpellEffectChangeMode(change) !== customMode
  ));
}

export function validateSpellEffectSlotWrite(effect, changes = {}, options = {}) {
  if (options?.peasantCoreSpellEffectWrite) return true;
  const type = String(changes?.type ?? effect?.type ?? "");
  const disabled = changes?.disabled ?? effect?.disabled ?? false;
  const expired = changes?.duration?.expired ?? changes?.["duration.expired"] ?? effect?.duration?.expired ?? false;
  if (
    type === "spellEffect"
    && (hasDuplicateManifestIdentityRows(effect, changes) || hasInvalidManifestIdentityMode(effect, changes))
  ) return false;
  const category = proposedSpellEffectState(effect, changes).buffCategory;
  if (type !== "spellEffect" || disabled || expired || !category) return true;
  return !findActiveSpellEffectInCategory(effect?.parent, category, { excludeId: getEffectId(effect) });
}

function escapeDialogText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function confirmManualReplacement(effect, occupant) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.confirm !== "function") return false;
  return !!(await DialogV2.confirm({
    window: { title: "Replace Active Buff" },
    content: `<p>${escapeDialogText(occupant?.name || "The active buff")} already occupies the ${escapeDialogText(getManifestSpellEffectState(effect).buffCategory)} category. Replace it?</p>`,
    modal: true
  }));
}

export async function enableSpellEffectWithCategoryResolution(effect, {
  confirmReplacement = confirmManualReplacement
} = {}) {
  if (!effect || effect.type !== "spellEffect" || !effect.parent) return false;
  const category = getManifestSpellEffectState(effect).buffCategory;
  if (!category) return false;
  const occupant = findActiveSpellEffectInCategory(effect.parent, category, { excludeId: getEffectId(effect) });
  if (occupant && !(await confirmReplacement(effect, occupant))) return false;

  const updates = [
    ...(occupant ? [{ _id: getEffectId(occupant), disabled: true }] : []),
    { _id: getEffectId(effect), disabled: false }
  ];
  if (typeof effect.parent.updateEmbeddedDocuments === "function") {
    await effect.parent.updateEmbeddedDocuments("ActiveEffect", updates, getSpellEffectWriteOptions());
  } else {
    if (occupant) await occupant.update?.({ disabled: true }, getSpellEffectWriteOptions());
    await effect.update?.({ disabled: false }, getSpellEffectWriteOptions());
  }
  return true;
}

function notifyDuplicateSpellEffect(effect, changes, userId) {
  if (userId && userId !== globalThis.game?.user?.id) return;
  if (hasDuplicateManifestIdentityRows(effect, changes)) {
    globalThis.ui?.notifications?.warn?.("Manifest Spell Effects require one row for category, type, current HP, and maximum HP.");
    return;
  }
  if (hasInvalidManifestIdentityMode(effect, changes)) {
    globalThis.ui?.notifications?.warn?.("Buff Category and Manifest Type rows must use Custom mode.");
    return;
  }
  const category = proposedSpellEffectState(effect, changes).buffCategory;
  const occupant = findActiveSpellEffectInCategory(effect?.parent, category, { excludeId: getEffectId(effect) });
  globalThis.ui?.notifications?.warn?.(
    `${occupant?.name || "An active Spell Effect"} already occupies the ${category} buff category.`
  );
}

export function configurePeasantSpellEffectSlotGuards() {
  if (spellEffectSlotGuardsConfigured || !globalThis.Hooks?.on) return;
  spellEffectSlotGuardsConfigured = true;

  globalThis.Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
    const valid = validateSpellEffectSlotWrite(effect, data, options);
    if (!valid) notifyDuplicateSpellEffect(effect, data, userId);
    return valid;
  });
  globalThis.Hooks.on("preUpdateActiveEffect", (effect, changes, options, userId) => {
    const valid = validateSpellEffectSlotWrite(effect, changes, options);
    if (!valid) notifyDuplicateSpellEffect(effect, changes, userId);
    return valid;
  });
}
