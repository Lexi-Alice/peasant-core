import {
  MANIFEST_SPELL_EFFECT_CHANGE_KEYS,
  getManifestSpellEffectChanges,
  getManifestSpellEffectState,
  setManifestSpellCurrentHp,
  toFoundryManifestSpellEffectChanges
} from "./spell-effect-change-keys.mjs";
import { getManifestSpellEncounterData } from "./spell-effects.mjs";

const SPELL_EFFECT_WRITE_OPTIONS = Object.freeze({ peasantCoreSpellEffectWrite: true });

function identityKey(identity) {
  if (typeof identity === "string") return identity.trim();
  const collection = String(identity?.collection || "").trim();
  const entryId = String(identity?.entryId || "").trim();
  const usageId = String(identity?.usageId || "base").trim() || "base";
  return collection && entryId ? `${collection}:${entryId}:${usageId}` : "";
}

function peasantFlags(effect) {
  return effect?.flags?.["peasant-core"] ?? effect?.getFlag?.("peasant-core") ?? {};
}

export function getMageBlockDefenseIdentity(collection, entryId, usageId = "base") {
  return identityKey({ collection, entryId, usageId });
}

export function isMageBlockBarrierEffect(effect) {
  return effect?.type === "spellEffect" && peasantFlags(effect).mageBlockBarrier === true;
}

export function isMageBlockDuressEffect(effect) {
  return effect?.type === "spellEffect" && peasantFlags(effect).mageBlockDuress === true;
}

function findMageBlockEffect(actor, flag, identity) {
  const key = identityKey(identity);
  if (!key) return null;
  return Array.from(actor?.effects || []).find((effect) => (
    effect?.type === "spellEffect"
    && peasantFlags(effect)[flag] === true
    && String(peasantFlags(effect).mageBlockDefenseId || "") === key
    && !effect.disabled
    && !effect.duration?.expired
  )) || null;
}

export function getMageBlockBarrierEffect(actor, identity) {
  return findMageBlockEffect(actor, "mageBlockBarrier", identity);
}

export function getMageBlockDuressEffect(actor, identity) {
  return findMageBlockEffect(actor, "mageBlockDuress", identity);
}

export function getMageBlockBarrierHp(effect) {
  return getManifestSpellEffectState(effect).magicalHp;
}

function buildBarrierChanges(hp, maxHp) {
  const maximum = Math.max(1, Math.trunc(Number(maxHp) || 40));
  const current = Math.max(0, Math.min(maximum, Math.trunc(Number(hp) || 0)));
  const changes = [
    {
      key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.currentHp,
      mode: globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2,
      value: current,
      priority: 20
    },
    {
      key: MANIFEST_SPELL_EFFECT_CHANGE_KEYS.maximumHp,
      mode: globalThis.CONST?.ACTIVE_EFFECT_MODES?.OVERRIDE ?? 5,
      value: maximum,
      priority: 20
    }
  ];
  return toFoundryManifestSpellEffectChanges(changes);
}

function getMageBlockEffectIcon(actor, img) {
  return String(img || actor?.img || globalThis.CONFIG?.ActiveEffect?.documentClass?.DEFAULT_ICON || "icons/svg/aura.svg").trim()
    || "icons/svg/aura.svg";
}

export function buildMageBlockBarrierEffectSource(actor, {
  identity,
  img = "",
  hp = 0,
  maxHp = 40,
  includeDuress = false
} = {}) {
  const key = identityKey(identity);
  if (!key) return null;
  const encounter = includeDuress ? getManifestSpellEncounterData(actor, "resistance") : null;
  return {
    name: "Mage Block Barrier",
    type: "spellEffect",
    img: getMageBlockEffectIcon(actor, img),
    origin: actor?.uuid || "",
    disabled: false,
    transfer: false,
    showIcon: globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
    start: encounter?.start,
    duration: encounter?.duration || { value: null, units: "rounds", expiry: null, expired: false },
    system: {
      changes: buildBarrierChanges(hp, maxHp),
      encounterId: encounter?.encounterId || ""
    },
    flags: {
      core: { overlay: false },
      "peasant-core": {
        mageBlockBarrier: Number(hp) > 0,
        ...(includeDuress ? { mageBlockDuress: true } : {}),
        mageBlockDefenseId: key
      }
    }
  };
}

export function buildMageBlockDuressEffectSource(actor, {
  identity,
  name = "Mage Block",
  img = ""
} = {}) {
  const key = identityKey(identity);
  if (!key) return null;
  const encounter = getManifestSpellEncounterData(actor, "resistance");
  return {
    name: `Mage Block Duress — ${String(name || "Mage Block")}`,
    type: "spellEffect",
    img: getMageBlockEffectIcon(actor, img),
    origin: actor?.uuid || "",
    disabled: false,
    transfer: false,
    showIcon: globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
    start: encounter.start,
    duration: encounter.duration,
    system: { changes: [], encounterId: encounter.encounterId },
    flags: {
      core: { overlay: false },
      "peasant-core": { mageBlockDuress: true, mageBlockDefenseId: key }
    }
  };
}

export async function createMageBlockEffects(actor, {
  identity,
  name = "Mage Block",
  img = "",
  hp = 0,
  maxHp = 40,
  createBarrier = true,
  createDuress = true,
  refreshBarrier = false
} = {}) {
  let barrier = getMageBlockBarrierEffect(actor, identity);
  let duress = getMageBlockDuressEffect(actor, identity);
  let effect = barrier || duress;

  if (barrier && duress && barrier !== duress) {
    const state = getMageBlockBarrierHp(barrier);
    if (state.value > 0) {
      const source = duress._source || duress;
      await barrier.update?.({
        start: source.start,
        duration: source.duration,
        "system.encounterId": source.system?.encounterId || "",
        "flags.peasant-core.mageBlockDuress": true
      }, { ...SPELL_EFFECT_WRITE_OPTIONS });
      await duress.delete?.({ ...SPELL_EFFECT_WRITE_OPTIONS });
      effect = barrier;
    } else {
      await barrier.delete?.({ ...SPELL_EFFECT_WRITE_OPTIONS });
      effect = duress;
    }
    barrier = getMageBlockBarrierEffect(actor, identity);
    duress = getMageBlockDuressEffect(actor, identity);
    effect = barrier || duress || effect;
  }

  if (createBarrier && hp > 0) {
    if (effect && (refreshBarrier || !barrier)) {
      effect = await refreshMageBlockBarrier(actor, effect, {
        identity,
        img,
        maxHp,
        duressEffect: duress,
        includeDuress: createDuress || !!duress
      }) || effect;
    } else if (!effect) {
      const source = buildMageBlockBarrierEffectSource(actor, {
        identity, img, hp, maxHp, includeDuress: createDuress
      });
      const created = source
        ? await actor?.createEmbeddedDocuments?.("ActiveEffect", [source], { ...SPELL_EFFECT_WRITE_OPTIONS })
        : [];
      effect = created?.[0] || null;
    }
  } else if (createDuress && !duress) {
    if (effect && isMageBlockBarrierEffect(effect)) {
      const source = buildMageBlockDuressEffectSource(actor, { identity, name, img });
      await effect.update?.({
        start: source.start,
        duration: source.duration,
        "system.encounterId": source.system.encounterId,
        "flags.peasant-core.mageBlockDuress": true
      }, { ...SPELL_EFFECT_WRITE_OPTIONS });
    } else if (!effect) {
      const source = buildMageBlockDuressEffectSource(actor, { identity, name, img });
      const created = source
        ? await actor?.createEmbeddedDocuments?.("ActiveEffect", [source], { ...SPELL_EFFECT_WRITE_OPTIONS })
        : [];
      effect = created?.[0] || null;
    }
  }

  return {
    barrier: getMageBlockBarrierEffect(actor, identity) || (isMageBlockBarrierEffect(effect) ? effect : null),
    duress: getMageBlockDuressEffect(actor, identity) || (isMageBlockDuressEffect(effect) ? effect : null)
  };
}

export async function refreshMageBlockBarrier(actor, effect, {
  identity,
  img = "",
  maxHp = 40,
  duressEffect = null,
  includeDuress = true
} = {}) {
  const source = buildMageBlockBarrierEffectSource(actor, {
    identity, img, hp: maxHp, maxHp, includeDuress
  });
  if (!source) return null;
  if (!effect) {
    const created = await actor?.createEmbeddedDocuments?.("ActiveEffect", [source], { ...SPELL_EFFECT_WRITE_OPTIONS });
    return created?.[0] || null;
  }
  const lifecycleEffect = duressEffect || (isMageBlockDuressEffect(effect) ? effect : null);
  const lifecycle = lifecycleEffect?._source || lifecycleEffect;
  await effect.update?.({
    name: source.name,
    img: source.img,
    "system.changes": source.system.changes,
    "system.encounterId": lifecycle?.system?.encounterId ?? source.system.encounterId,
    ...(lifecycle?.start || source.start ? { start: lifecycle?.start || source.start } : {}),
    duration: lifecycle?.duration || source.duration,
    "flags.peasant-core.mageBlockBarrier": true,
    "flags.peasant-core.mageBlockDefenseId": identityKey(identity),
    ...(includeDuress ? { "flags.peasant-core.mageBlockDuress": true } : {})
  }, { ...SPELL_EFFECT_WRITE_OPTIONS });
  return effect;
}

export async function updateMageBlockBarrierHp(effect, hp) {
  if (!effect) return false;
  const state = getMageBlockBarrierHp(effect);
  const changes = setManifestSpellCurrentHp(getManifestSpellEffectChanges(effect), hp);
  const rows = changes.map((change) => (
    String(change?.key || "").trim() === MANIFEST_SPELL_EFFECT_CHANGE_KEYS.maximumHp
      ? { ...change, value: Math.max(1, Number(state.max) || 40) }
      : change
  ));
  await effect.update?.({ "system.changes": toFoundryManifestSpellEffectChanges(rows) }, { ...SPELL_EFFECT_WRITE_OPTIONS });
  return true;
}

export async function deleteMageBlockBarrier(effect, duress = null) {
  if (!effect) return false;
  await effect.delete?.({ ...SPELL_EFFECT_WRITE_OPTIONS });
  if (duress && duress !== effect) await duress.delete?.({ ...SPELL_EFFECT_WRITE_OPTIONS });
  return true;
}

export function getMageBlockEffectConsolidationMigration(actor) {
  const groups = new Map();
  for (const effect of Array.from(actor?.effects || [])) {
    const flags = peasantFlags(effect);
    if (effect?.type !== "spellEffect" || (!flags.mageBlockBarrier && !flags.mageBlockDuress)) continue;
    const identity = String(flags.mageBlockDefenseId || "").trim();
    if (!identity || effect.disabled || effect.duration?.expired) continue;
    const group = groups.get(identity) || [];
    group.push(effect);
    groups.set(identity, group);
  }

  const updates = [];
  const deleteIds = [];
  for (const [identity, effects] of groups) {
    const barriers = effects.filter(isMageBlockBarrierEffect);
    const duressEffects = effects.filter(isMageBlockDuressEffect);
    const barrier = barriers.find((effect) => getMageBlockBarrierHp(effect).value > 0) || barriers[0] || null;
    const duress = duressEffects.find((effect) => String((effect?._source || effect)?.system?.encounterId || "").trim())
      || duressEffects[0]
      || null;
    const hasBarrier = !!barrier && getMageBlockBarrierHp(barrier).value > 0;
    if (!hasBarrier) {
      deleteIds.push(...effects.map((effect) => String(effect.id || effect._id || "")).filter(Boolean));
      continue;
    }
    if (effects.length === 1) continue;

    const primary = barrier;
    const lifecycle = duress?._source || duress || {};
    const primaryId = String(primary.id || primary._id || "");
    updates.push({
      _id: primaryId,
      name: primary.name,
      ...(lifecycle.start ? { start: lifecycle.start } : {}),
      ...(lifecycle.duration ? { duration: lifecycle.duration } : {}),
      "system.encounterId": lifecycle.system?.encounterId || "",
      "flags.peasant-core.mageBlockDefenseId": identity,
      "flags.peasant-core.mageBlockDuress": !!duress,
      "flags.peasant-core.mageBlockBarrier": true
    });
    deleteIds.push(...effects
      .filter((effect) => effect !== primary)
      .map((effect) => String(effect.id || effect._id || ""))
      .filter(Boolean));
  }

  return { updates, deleteIds };
}
