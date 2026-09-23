import {
  getManifestSpellDefinition,
  getManifestSpellDuration,
  getManifestSpellRemainingDuration,
  isActiveSpellEffect
} from "./spell-effects.mjs";
import { getManifestSpellEffectState } from "./spell-effect-change-keys.mjs";
import {
  getMageBlockBarrierHp,
  isMageBlockBarrierEffect,
  isMageBlockDuressEffect
} from "./mage-block-effects.mjs";

const SPELL_EFFECT_WRITE_OPTIONS = Object.freeze({ peasantCoreSpellEffectWrite: true });
let spellEffectLifecycleConfigured = false;

function getSpellEffectWriteOptions() {
  return { ...SPELL_EFFECT_WRITE_OPTIONS };
}

function effectId(effect) {
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

function getEffectStart(combat) {
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

export function getCombatDurationCarryoverUpdate(effect, combat) {
  const id = effectId(effect);
  const sourceCombatId = String(effect?._source?.start?.combat || "");
  const units = String(effect?.duration?.units || "");
  const expiry = String(effect?.duration?.expiry || "");
  if (
    !id
    || !sourceCombatId
    || sourceCombatId !== String(combat?.id || "")
    || effect?.disabled
    || effect?.duration?.expired
    || !["rounds", "turns"].includes(units)
    || expiry === "combatEnd"
  ) {
    return null;
  }

  const duration = effect?.updateDuration?.({
    combat,
    round: combat?.round ?? null,
    turn: combat?.turn ?? null
  }) || effect?.duration;
  const remaining = Number(duration?.remaining);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const update = {
    _id: id,
    start: getEffectStart(null),
    duration: {
      ...effect?._source?.duration,
      value: remaining,
      expired: false
    }
  };
  if (effect?.type === "spellEffect") update["system.encounterId"] = "";
  return update;
}

export function getPendingCombatDurationEnrollment(effect, actor, combat) {
  const id = effectId(effect);
  const value = Number(effect?.duration?.value);
  const units = String(effect?.duration?.units || "");
  if (
    !id
    || effect?.disabled
    || effect?.duration?.expired
    || effect?._source?.start?.combat
    || effect?.start?.combat
    || !Number.isFinite(value)
    || value <= 0
    || !["rounds", "turns"].includes(units)
    || !actorIsCombatant(actor, combat)
  ) {
    return null;
  }
  return { _id: id, start: getEffectStart(combat) };
}

export function getPendingSpellEffectEnrollment(effect, actor, combat) {
  if (isMageBlockDuressEffect(effect)) {
    if (
      !effectId(effect)
      || effect?.disabled
      || effect?.duration?.expired
      || effect?._source?.start?.combat
      || effect?.start?.combat
      || String(effect?.system?.encounterId || "").trim()
      || !actorIsCombatant(actor, combat)
    ) return null;
    return {
      _id: effectId(effect),
      "system.encounterId": String(combat?.id || ""),
      start: getEffectStart(combat),
      duration: getManifestSpellDuration("resistance", { enrolled: true })
    };
  }

  const definition = getManifestSpellDefinition(getManifestSpellEffectState(effect).manifestType);
  if (
    !definition
    || !isActiveSpellEffect(effect)
    || String(effect?.system?.encounterId || "").trim()
    || !actorIsCombatant(actor, combat)
  ) {
    return null;
  }

  const update = {
    _id: effectId(effect),
    "system.encounterId": String(combat?.id || "")
  };
  if (!update._id || !update["system.encounterId"]) return null;
  update.start = getEffectStart(combat);
  update.duration = getManifestSpellDuration(definition.manifestType, {
    enrolled: true,
    duration: effect?.duration?.value ?? effect?.flags?.["peasant-core"]?.manifestDuration
  });
  return update;
}

export function shouldRemoveSpellEffectForCombat(effect, combat, event) {
  if (isMageBlockDuressEffect(effect)) {
    const encounterId = String(effect?.system?.encounterId || "").trim();
    const legacyDuress = !String(effect?.duration?.expiry || "").trim();
    return legacyDuress
      && !!encounterId
      && encounterId === String(combat?.id || "")
      && ["combatEnd", "deleteCombat"].includes(String(event || ""));
  }

  const definition = getManifestSpellDefinition(getManifestSpellEffectState(effect).manifestType);
  const encounterId = String(effect?.system?.encounterId || "").trim();
  if (!definition || !encounterId || encounterId !== String(combat?.id || "")) return false;

  if (definition.manifestType === "dome") return false;
  const legacyResistance = definition.manifestType === "resistance"
    && !String(effect?.duration?.expiry || "").trim();
  return legacyResistance && ["combatEnd", "deleteCombat"].includes(String(event || ""));
}

function titleCase(value) {
  const text = String(value || "").trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

export function formatSpellEffectSubtitle(effect) {
  if (effect?.type !== "spellEffect") return "";
  if (isMageBlockBarrierEffect(effect)) {
    const hp = getMageBlockBarrierHp(effect);
    if (hp.value <= 0) return "";
    const duration = isMageBlockDuressEffect(effect)
      ? String(effect?.system?.encounterId || "").trim() ? "Duress" : "Pending Combat"
      : "";
    return `Mage Block - ${nonNegativeInteger(hp.value)}/${nonNegativeInteger(hp.max)} HP${duration ? ` - ${duration}` : ""}`;
  }
  if (isMageBlockDuressEffect(effect)) {
    return String(effect?.system?.encounterId || "").trim()
      ? "Mage Block - Duress"
      : "Mage Block - Pending Combat";
  }
  const state = getManifestSpellEffectState(effect);
  const definition = getManifestSpellDefinition(state.manifestType);
  if (!definition) return "";

  const manifestType = titleCase(definition.manifestType);
  const hpValue = nonNegativeInteger(state.magicalHp.value);
  const duration = getManifestSpellRemainingDuration(effect);

  return `${manifestType} - ${hpValue} Magical HP - ${duration}`;
}

function getCombatActors(combat) {
  const actors = [];
  const seen = new Set();
  for (const combatant of Array.from(combat?.combatants || [])) {
    const actor = combatant?.actor || combatant?.token?.actor || null;
    const key = String(actor?.uuid || actor?.id || "").trim();
    if (!actor || !key || seen.has(key)) continue;
    seen.add(key);
    actors.push(actor);
  }
  return actors;
}

export async function prepareCombatDurationCarryover(combat) {
  for (const actor of getCombatActors(combat)) {
    const updates = Array.from(actor.effects || [])
      .map((effect) => getCombatDurationCarryoverUpdate(effect, combat))
      .filter(Boolean);
    if (!updates.length) continue;
    await actor.updateEmbeddedDocuments("ActiveEffect", updates, getSpellEffectWriteOptions());
  }
}

function isLifecycleAuthority() {
  const activeGMs = Array.from(globalThis.game?.users || [])
    .filter((user) => user?.active && user?.isGM)
    .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
  return !!activeGMs[0] && activeGMs[0].id === globalThis.game?.user?.id;
}

async function enrollActorEffects(actor, combat) {
  const updates = Array.from(actor?.effects || [])
    .map((effect) => (
      getPendingSpellEffectEnrollment(effect, actor, combat)
      || getPendingCombatDurationEnrollment(effect, actor, combat)
    ))
    .filter(Boolean);
  if (!updates.length) return;

  if (typeof actor.updateEmbeddedDocuments === "function") {
    await actor.updateEmbeddedDocuments("ActiveEffect", updates, getSpellEffectWriteOptions());
    return;
  }
  for (const update of updates) {
    const effect = Array.from(actor.effects || []).find((entry) => effectId(entry) === update._id);
    await effect?.update?.(update, getSpellEffectWriteOptions());
  }
}

async function enrollCombatEffects(combat) {
  if (!isLifecycleAuthority()) return;
  for (const actor of getCombatActors(combat)) await enrollActorEffects(actor, combat);
}

async function removeCombatEffects(combat, event) {
  if (!isLifecycleAuthority()) return;
  for (const actor of getCombatActors(combat)) {
    const ids = Array.from(actor?.effects || [])
      .filter((effect) => shouldRemoveSpellEffectForCombat(effect, combat, event))
      .map(effectId)
      .filter(Boolean);
    if (!ids.length) continue;

    if (typeof actor.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids, getSpellEffectWriteOptions());
      continue;
    }
    for (const id of ids) {
      const effect = Array.from(actor.effects || []).find((entry) => effectId(entry) === id);
      await effect?.delete?.(getSpellEffectWriteOptions());
    }
  }
}

export function configurePeasantSpellEffectLifecycle() {
  if (spellEffectLifecycleConfigured || !globalThis.Hooks?.on) return;
  spellEffectLifecycleConfigured = true;

  globalThis.Hooks.on("createCombatant", (combatant) => {
    const combat = combatant?.parent || combatant?.combat || null;
    if (combat?.started) void enrollCombatEffects(combat);
  });
  globalThis.Hooks.on("updateCombat", (combat, changes) => {
    if (!("round" in (changes || {}))) return;
    if (combat?.started) {
      void enrollCombatEffects(combat);
      return;
    }
    void removeCombatEffects(combat, "combatEnd");
  });
  globalThis.Hooks.on("deleteCombat", (combat) => {
    void removeCombatEffects(combat, "deleteCombat");
  });
}
