import { absorbBolsteredFromCounts, absorbTempHpFromCounts, applyDamageResistanceToCounts, getDamageScaleResult, splitDamageCounts, sumDamageCounts, toSimplifiedHpDamageFromCounts } from "../data/actor/damage.mjs";
import { absorbActorSpellEffect } from "../data/active-effect/spell-effects.mjs";
import { applyOverchargedEffect, removeOverchargedEffects } from "../data/active-effect/overcharged.mjs";
import {
  createMageBlockEffects,
  getMageBlockBarrierEffect,
  getMageBlockBarrierHp,
  getMageBlockDefenseIdentity,
  getMageBlockDuressEffect
} from "../data/active-effect/mage-block-effects.mjs";
import {
  COMBAT_HALT_BUFF_TYPE_COST,
  COMBAT_HALT_BUFF_TYPE_CUSTOM,
  COMBAT_HALT_BUFF_TYPE_FLAT,
  COMBAT_HALT_BUFF_TYPE_HALT,
  COMBAT_HALT_BUFF_TYPE_NATURAL,
  getCombatHaltBuffTotals,
  normalizeHaltValues,
  parseHaltSlashValues,
  sanitizeCombatCostResourceType,
  sanitizeCombatHaltBuffs,
  sanitizeCombatHaltBuffType
} from "../data/actor/combat-modifiers.mjs";
import { createDefaultCombatDefense, normalizeCombatDefense } from "../data/actor/combat-defense.mjs";
import { resolveSelectedDefenseCombat } from "../data/actor/defense-favorites.mjs";
import { getFlexibleAdvantageDescription } from "../data/actor/flexible-advantages.mjs";
import { getNotableCombatEffectImage } from "../data/actor/notable-combat-image.mjs";
import { getNotableCombatTreeRows } from "../data/actor/notable-combat-tree.mjs";
import { COMBAT_FULL_TAG_ORDER, getCombatCustomTags, normalizeCombatMagnetism, normalizeCombatTargetingType, normalizeRangeRateValue, syncCombatCustomTags } from "../data/actor/combat-tags.mjs";
import { findPassiveSkillEffectSource, hasExpiringSkillEffectDuration, isPassiveSkillEffectDefinition, isSkillEditorDefinition } from "../data/actor/skill-entry-conditions.mjs";
import {
  SKILL_MECHANIC_DEFAULTS,
  addSkillUsage,
  clearSkillUsage,
  deleteSkillUsage,
  duplicateSkillUsage,
  normalizeSkillEntry,
  removeSkillEffectLink,
  removeSkillEffectReferences,
  renameSkillUsage,
  setDefaultSkillUsage,
  upsertSkillEffectLink,
  setSkillTagCondition,
  setSkillUsageCounterScope,
  setSkillTagData
} from "../data/actor/skill-entries.mjs";
import { getFixedSkillTypeValue, getSkillTypeOptionsForCategory, isSignatureSkillType, isSkillProgressionType, normalizeSkillTypeForCategory } from "../data/actor/skill-entry-types.mjs";
import { getActorEdgeLabelMode, getDefaultEdgeLabelMode, normalizeEdgeResourceEntry, sanitizeEdgeLabelMode } from "../data/actor/edge-resources.mjs";
import { addEquippedArmorHalt, getArmorAdjustedMovement, getEquippedArmorEffects, removeEquippedArmorAoeSaveModifier, removeEquippedArmorHalt, removeEquippedArmorMovement } from "../data/actor/equipped-armor.mjs";
import { canSpendActiveArmorCharge, getEquippedArmorGrade } from "../data/actor/active-armor.mjs";
import { getActorBolsteredMax, getActorHealthMax, isPeasantCharacterType, isSimplifiedHpActor, parseOptionalInteger } from "../data/actor/helpers.mjs";
import { cloneActorList, cloneActorListForUpdate, duplicateActorListEntry, ensureActorListEntryAt, patchActorListEntry, removeActorListEntry, reorderActorListEntry } from "../data/actor/list-helpers.mjs";
import { applyPeasantGridHealthMaxChanges, applyPeasantNumericActiveEffectChange, clampPeasantInteger, mergePeasantGridHealthEffectUpdate } from "../data/active-effect/change-modes.mjs";
import {
  collectPeasantActiveEffectChangeKeys,
  isPeasantActiveEffectDynamicKey,
  isPeasantActiveEffectFoundryDynamicKey,
  isPeasantActiveEffectStateKey,
  isPeasantActiveEffectVirtualDynamicKey
} from "../data/active-effect/key-policy.mjs";
import { parseHpValueCommand } from "../data/actor/hp-commands.mjs";
import {
  PEASANT_ACTOR_UPDATE_CONTEXT,
  getActorSourceSystem,
  getActorSourceValue,
  hasPeasantActorUpdateContext,
  withPeasantActorSourceWriteContext,
  withPeasantActorStateWriteContext
} from "../data/actor/source-system.mjs";
import { applyCombatStressDamageForActor } from "../data/actor/stress.mjs";
import { TARGETED_DAMAGE_HALT_INDEX_MAP, TARGETED_DAMAGE_HARD_FLAG_MAP, getArmorChargeMultiplier, getArmorChargeValue, getTargetedDamageConditionKey, getTargetedDamageLocationDisplay, normalizeAppliedDamageType } from "../data/actor/targeted-damage.mjs";
import { getDevastatingWoundCount, getEffectiveWoundThresholds } from "../data/actor/wounds.mjs";
import { pcLog } from "../utils/logging.mjs";

function getPeasantActorSourceHp(actor) {
  return getActorSourceSystem(actor)?.hp ?? actor?.system?.hp ?? {};
}

function normalizePeasantHpDimension(value, fallback = 1) {
  const number = Number(value);
  if (Number.isFinite(number)) return Math.max(1, Math.floor(number));
  const fallbackNumber = Number(fallback);
  return Number.isFinite(fallbackNumber) ? Math.max(1, Math.floor(fallbackNumber)) : 1;
}

function getAlreadyResolvedDomeResult(damage, damageType) {
  return {
    handled: true,
    applied: false,
    reason: "alreadyResolved",
    absorbed: 0,
    penetration: Math.max(0, Math.floor(Number(damage) || 0)),
    remainingHp: 0,
    depleted: false,
    damageType: String(damageType || "")
  };
}

function getPeasantHpDimensions(hp, fallbackHp = null) {
  return {
    rows: normalizePeasantHpDimension(hp?.rows, fallbackHp?.rows),
    cols: normalizePeasantHpDimension(hp?.cols, fallbackHp?.cols)
  };
}

function normalizePeasantHpGrid(grid, rows, cols) {
  return Array.from({ length: rows }, (_, rowIndex) => {
    const row = Array.isArray(grid?.[rowIndex]) ? grid[rowIndex] : [];
    return Array.from({ length: cols }, (_, colIndex) => {
      const value = Number(row[colIndex]) || 0;
      return Math.max(0, Math.min(3, value));
    });
  });
}

function countPeasantRegularHpCellsInDimensions(grid, rows, cols) {
  let regularCells = 0;
  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    const row = Array.isArray(grid?.[rowIndex]) ? grid[rowIndex] : [];
    for (let colIndex = 0; colIndex < cols; colIndex++) {
      if ((Number(row[colIndex]) || 0) === 0) regularCells++;
    }
  }
  return regularCells;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function collectUpdateLeafPaths(data, prefix = "", paths = []) {
  if (!isPlainObject(data)) return paths;
  for (const [key, value] of Object.entries(data)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) collectUpdateLeafPaths(value, path, paths);
    else paths.push(path);
  }
  return paths;
}

function getPathValue(root, path) {
  if (root && typeof root === "object" && Object.prototype.hasOwnProperty.call(root, path)) return root[path];
  const getProperty = globalThis.foundry?.utils?.getProperty;
  if (typeof getProperty === "function") return getProperty(root, path);
  return String(path).split(".").filter(Boolean).reduce((value, part) => value?.[part], root);
}

function deletePathValue(root, path) {
  if (!root || typeof root !== "object") return;
  if (Object.prototype.hasOwnProperty.call(root, path)) {
    delete root[path];
    return;
  }

  const deleteProperty = globalThis.foundry?.utils?.deleteProperty;
  if (typeof deleteProperty === "function") {
    deleteProperty(root, path);
    return;
  }

  const parts = String(path).split(".").filter(Boolean);
  const key = parts.pop();
  const parent = parts.reduce((value, part) => value?.[part], root);
  if (parent && key) delete parent[key];
}

function setPathValue(root, path, value) {
  if (!root || typeof root !== "object") return;
  if (Object.prototype.hasOwnProperty.call(root, path)) {
    root[path] = value;
    return;
  }

  const setProperty = globalThis.foundry?.utils?.setProperty;
  if (typeof setProperty === "function") {
    setProperty(root, path, value);
    return;
  }

  const parts = String(path).split(".").filter(Boolean);
  const key = parts.pop();
  let parent = root;
  for (const part of parts) parent = parent[part] ??= {};
  if (key) parent[key] = value;
}

function setFallBlessingUpdatePath(changed, path, value, flatUpdate) {
  if (flatUpdate) changed[path] = value;
  else setPathValue(changed, path, value);
}

function adjustFallBlessingUsesForEdgeMaxChange(actor, changed) {
  const paths = collectUpdateLeafPaths(changed);
  const edgeMaxChanged = paths.includes("system.edge.max");
  const fallValueChanged = paths.includes("system.fallBlessingUses.value");
  const fallMaxChanged = paths.includes("system.fallBlessingUses.max");
  if (!edgeMaxChanged && !fallValueChanged && !fallMaxChanged) return;

  const sourceUses = getActorSourceValue(actor, "system.fallBlessingUses") || {};
  const sourceMax = clampPeasantInteger(sourceUses.max ?? 1, { min: 0 });
  const sourceValue = clampPeasantInteger(sourceUses.value ?? 0, { min: 0 });
  const flatUpdate = Object.prototype.hasOwnProperty.call(changed, "system.edge.max")
    || Object.prototype.hasOwnProperty.call(changed, "system.fallBlessingUses.value")
    || Object.prototype.hasOwnProperty.call(changed, "system.fallBlessingUses.max");

  if (fallMaxChanged || (fallValueChanged && !edgeMaxChanged)) {
    const max = clampPeasantInteger(
      fallMaxChanged ? getPathValue(changed, "system.fallBlessingUses.max") : sourceMax,
      { min: 0 }
    );
    const value = Math.min(clampPeasantInteger(
      fallValueChanged ? getPathValue(changed, "system.fallBlessingUses.value") : sourceValue,
      { min: 0 }
    ), max);
    if (fallMaxChanged) setFallBlessingUpdatePath(changed, "system.fallBlessingUses.max", max, flatUpdate);
    if (fallValueChanged || value !== sourceValue) setFallBlessingUpdatePath(changed, "system.fallBlessingUses.value", value, flatUpdate);
    return;
  }

  const oldEdgeMax = clampPeasantInteger(getActorSourceValue(actor, "system.edge.max"), { min: 0 });
  const newEdgeMax = clampPeasantInteger(getPathValue(changed, "system.edge.max"), { min: 0 });
  if (oldEdgeMax === newEdgeMax) return;

  const oldCapacity = Math.max(1, Math.floor(oldEdgeMax / 2));
  const newCapacity = Math.max(1, Math.floor(newEdgeMax / 2));
  const max = Math.max(0, sourceMax + newCapacity - oldCapacity);
  const requestedValue = fallValueChanged
    ? clampPeasantInteger(getPathValue(changed, "system.fallBlessingUses.value"), { min: 0 })
    : sourceValue;
  const value = Math.min(requestedValue, max);
  setFallBlessingUpdatePath(changed, "system.fallBlessingUses.max", max, flatUpdate);
  setFallBlessingUpdatePath(changed, "system.fallBlessingUses.value", value, flatUpdate);
}

function pruneEmptyUpdateObjects(value) {
  if (!isPlainObject(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (isPlainObject(child) && pruneEmptyUpdateObjects(child)) delete value[key];
  }
  return Object.keys(value).length === 0;
}

function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (error) {
    return false;
  }
}

const PEASANT_ENTRY_COLLECTIONS = new Set(["skills", "notableCombats"]);
const PEASANT_USAGE_UNSET_PATHS = new Set([
  "rollOverrides.characteristics",
  "rollOverrides.characteristicMode",
  "rollOverrides.tohit",
  "rollOverrides.accuracy"
]);

function mergePeasantEntryPatch(target, patch) {
  const result = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) mergePeasantEntryPatch(result[key], value);
    else result[key] = value == null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value));
  }
  return result;
}

function normalizePeasantEntryRef(ref) {
  const collection = String(ref?.collection ?? "");
  const entryId = String(ref?.entryId ?? "").trim();
  return PEASANT_ENTRY_COLLECTIONS.has(collection) && entryId ? { collection, entryId } : null;
}

function normalizePeasantCounter(value, fallback = 0) {
  if (value === undefined) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function isPathManagedByEffect(path, effectKeys) {
  for (const key of effectKeys) {
    if (path === key || path.startsWith(`${key}.`) || key.startsWith(`${path}.`)) return true;
  }
  return false;
}

function getPeasantEffectIterable(collection) {
  if (!collection || typeof collection === "function") return [];
  if (typeof collection[Symbol.iterator] === "function") return collection;
  if (typeof collection.values === "function") return collection.values();
  if (Array.isArray(collection.contents)) return collection.contents;
  return [];
}

function collectPeasantActiveEffectDocuments(actor) {
  const collections = [
    actor?.effects?.contents ?? actor?.effects,
    actor?.temporaryEffects,
    actor?.appliedEffects
  ];

  if (typeof actor?.allApplicableEffects === "function") {
    try {
      collections.push(actor.allApplicableEffects());
    } catch (error) {
      /* Fall back to the known effect collections above. */
    }
  }

  const effects = [];
  const seen = new Set();
  for (const collection of collections) {
    for (const effect of getPeasantEffectIterable(collection)) {
      if (!effect || seen.has(effect)) continue;
      seen.add(effect);
      effects.push(effect);
    }
  }
  return effects;
}

function filterPeasantFoundryActiveEffectChanges(actor) {
  const restorations = [];
  const gridHealth = isPeasantCharacterType(actor?.type) && !isSimplifiedHpActor(actor);
  for (const effect of collectPeasantActiveEffectDocuments(actor)) {
    const changes = effect?.changes;
    if (!Array.isArray(changes)) continue;

    const filtered = isSkillEditorDefinition(effect) && !isPassiveSkillEffectDefinition(effect, actor)
      ? []
      : changes.filter(change => isPeasantActiveEffectFoundryDynamicKey(change?.key, { gridHealth }));
    if (filtered.length === changes.length) continue;

    const original = [...changes];
    try {
      changes.splice(0, changes.length, ...filtered);
      restorations.push({ changes, original });
    } catch (error) {
      /* Leave immutable change collections untouched. */
    }
  }
  return restorations;
}

function restorePeasantActiveEffectChanges(restorations) {
  for (const restoration of restorations.reverse()) {
    try {
      restoration.changes.splice(0, restoration.changes.length, ...restoration.original);
    } catch (error) {
      /* The effect document will retain its source changes even if local restoration fails. */
    }
  }
}

function preservePeasantGridHealthEffectUpdate(actor, changed) {
  if (!isPeasantCharacterType(actor?.type) || isSimplifiedHpActor(actor)) return;
  const changedGrid = getPathValue(changed, "system.hp.grid");
  if (!Array.isArray(changedGrid)) return;

  const hasHealthMaxEffect = collectPeasantActiveEffectDocuments(actor).some(effect =>
    !effect.disabled
    && !effect.isSuppressed
    && (!isSkillEditorDefinition(effect) || isPassiveSkillEffectDefinition(effect, actor))
    && (effect.changes ?? effect._source?.changes ?? []).some(change => change?.key === "system.health.max")
  );
  if (!hasHealthMaxEffect) return;

  const sourceHp = getPeasantActorSourceHp(actor);
  const sourceDimensions = getPeasantHpDimensions(sourceHp);
  const effectDimensions = getPeasantHpDimensions(actor.system?.hp, sourceHp);
  if (sourceDimensions.cols === effectDimensions.cols) return;

  setPathValue(changed, "system.hp.grid", mergePeasantGridHealthEffectUpdate(
    sourceHp.grid,
    changedGrid,
    {
      rows: sourceDimensions.rows,
      sourceColumns: sourceDimensions.cols,
      effectColumns: effectDimensions.cols
    }
  ));
}

const VIRTUAL_HALT_LOCATION_INDEXES = Object.freeze({
  head: 0,
  arms: 1,
  legs: 2,
  torso: 3
});

function getPeasantVirtualHaltTarget(path) {
  const key = String(path ?? "").trim();
  if (!isPeasantActiveEffectVirtualDynamicKey(key)) return null;
  const match = key.match(/^system\.(haltValues|naturalHaltValues|naturalhaltValues)\.(head|arms|legs|torso)$/);
  if (!match) return null;
  return {
    field: match[1] === "naturalhaltValues" ? "naturalHaltValues" : match[1],
    index: VIRTUAL_HALT_LOCATION_INDEXES[match[2]]
  };
}

function guardPeasantStateUpdateFromPreparedEffectWrites(actor, changed, options) {
  if (!hasPeasantActorUpdateContext(options, PEASANT_ACTOR_UPDATE_CONTEXT.STATE_WRITE)) return true;
  if (hasPeasantActorUpdateContext(options, PEASANT_ACTOR_UPDATE_CONTEXT.SOURCE_WRITE)) return true;

  const effectKeys = new Set([...collectPeasantActiveEffectChangeKeys(actor)].filter(isPeasantActiveEffectDynamicKey));
  if (!effectKeys.size) return true;

  const removed = [];
  for (const path of collectUpdateLeafPaths(changed)) {
    if (!String(path).startsWith("system.")) continue;
    if (!isPathManagedByEffect(path, effectKeys)) continue;

    const sourceValue = getActorSourceValue(actor, path);
    const preparedValue = getPathValue(actor?.system, path.replace(/^system\./, ""));
    const updateValue = getPathValue(changed, path);
    if (valuesEqual(sourceValue, preparedValue)) continue;
    if (!valuesEqual(updateValue, preparedValue)) continue;

    deletePathValue(changed, path);
    removed.push(path);
  }

  pruneEmptyUpdateObjects(changed);
  if (removed.length) {
    console.warn("Peasant Core prevented a state update from saving active-effect prepared values into actor source data.", {
      actor: actor?.name,
      paths: removed
    });
  }
  return collectUpdateLeafPaths(changed).length > 0;
}

export class PeasantActor extends Actor {
  static RESOURCE_NAMES = Object.freeze(["stamina", "attunement", "capacity", "edge", "armorCharge"]);
  static STRESS_TYPES = Object.freeze(["physical", "mental", "general"]);
  static CONDITION_KEYS = Object.freeze(["wounded", "head", "rightArm", "leftArm", "rightLeg", "leftLeg", "torso", "arms", "legs"]);
  static WOUND_STATUSES = Object.freeze(["disabled", "crippled"]);
  static BLESSING_TYPES = Object.freeze(["spring", "summer", "fall", "winter"]);
  static TO_HIT_PENALTY_TARGETS = Object.freeze(["Strength", "Dexterity", "Mental", "Social"]);
  static HARD_LOCATION_NAMES = Object.freeze(["Head", "Arms", "Legs", "Torso"]);

  static createPeasantNotableCombatId() {
    return foundry?.utils?.randomID?.(16) ?? `combat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  static ensurePeasantNotableCombatIds(combats) {
    if (!Array.isArray(combats)) return combats;
    const seen = new Set();
    for (const combat of combats) {
      if (!combat || typeof combat !== "object") continue;
      const current = String(combat.id ?? "").trim();
      if (current && !seen.has(current)) {
        combat.id = current;
        seen.add(current);
        continue;
      }

      let nextId = "";
      do {
        nextId = PeasantActor.createPeasantNotableCombatId();
      } while (seen.has(nextId));
      combat.id = nextId;
      seen.add(nextId);
    }
    return combats;
  }

  _queuePeasantEntryWrite(callback) {
    const previous = this._peasantEntryWriteQueue ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(callback);
    this._peasantEntryWriteQueue = current.catch(() => undefined);
    return current;
  }

  async ensurePeasantEntryIds(collection) {
    if (!PEASANT_ENTRY_COLLECTIONS.has(collection)) return { ok: false, changed: false };
    return this._queuePeasantEntryWrite(async () => {
      const source = getActorSourceSystem(this);
      const list = cloneActorList(source?.[collection]);
      const seen = new Set();
      let changed = false;
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        let id = String(entry.id ?? "").trim();
        if (!id || seen.has(id)) {
          do id = PeasantActor.createPeasantNotableCombatId(); while (seen.has(id));
          changed = true;
        } else if (entry.id !== id) {
          changed = true;
        }
        entry.id = id;
        seen.add(id);
      }
      if (!changed) return { ok: true, changed: false };
      await this.updatePeasantSourceData({ [`system.${collection}`]: list });
      return { ok: true, changed: true };
    });
  }

  async updatePeasantEntry(ref, patch = {}, { usageId = null, unset = [], state = false, render = true } = {}) {
    const normalizedRef = normalizePeasantEntryRef(ref);
    if (!normalizedRef || Object.prototype.hasOwnProperty.call(patch ?? {}, "id")) return { ok: false, changed: false };
    if (!Array.isArray(unset) || unset.some((path) => !PEASANT_USAGE_UNSET_PATHS.has(path))) {
      return { ok: false, changed: false };
    }
    return this._queuePeasantEntryWrite(async () => {
      const source = getActorSourceSystem(this);
      const list = cloneActorList(source?.[normalizedRef.collection]);
      const index = list.findIndex((entry) => String(entry?.id ?? "").trim() === normalizedRef.entryId);
      if (index < 0) return { ok: false, changed: false };

      const entry = normalizeSkillEntry(list[index], {
        collection: normalizedRef.collection,
        createId: PeasantActor.createPeasantNotableCombatId
      });
      if (usageId === null) {
        mergePeasantEntryPatch(entry, patch);
      } else if (usageId === "base") {
        const mechanics = patch.mechanics ?? Object.fromEntries(
          Object.entries(patch).filter(([key]) => Object.prototype.hasOwnProperty.call(SKILL_MECHANIC_DEFAULTS, key))
        );
        mergePeasantEntryPatch(entry, mechanics);
        const metadata = Object.fromEntries(
          Object.entries(patch).filter(([key]) => !Object.prototype.hasOwnProperty.call(SKILL_MECHANIC_DEFAULTS, key) && key !== "mechanics")
        );
        mergePeasantEntryPatch(entry.baseUsage, metadata);
      } else {
        const usage = entry.usages.find((candidate) => candidate.id === usageId);
        if (!usage) return { ok: false, changed: false };
        mergePeasantEntryPatch(usage, patch);
        for (const path of unset) delete usage.rollOverrides[path.slice("rollOverrides.".length)];
      }

      const normalized = normalizeSkillEntry(entry, {
        collection: normalizedRef.collection,
        createId: PeasantActor.createPeasantNotableCombatId
      });
      if (valuesEqual(list[index], normalized)) return { ok: true, changed: false, entry: normalized };
      list[index] = normalized;
      const update = { [`system.${normalizedRef.collection}`]: list };
      if (state) await this.updatePeasantStateData(update, { render });
      else await this.updatePeasantSourceData(update, { render });
      return { ok: true, changed: true, entry: normalized };
    });
  }

  async managePeasantEntryUsage(ref, action, options = {}) {
    const normalizedRef = normalizePeasantEntryRef(ref);
    const operation = String(action ?? "").trim().toLowerCase();
    if (!normalizedRef || !["add", "clear", "condition", "counter-scope", "default", "delete", "duplicate", "rename"].includes(operation)) {
      return { ok: false, changed: false };
    }

    return this._queuePeasantEntryWrite(async () => {
      const source = getActorSourceSystem(this);
      const list = cloneActorList(source?.[normalizedRef.collection]);
      const index = list.findIndex((entry) => String(entry?.id ?? "").trim() === normalizedRef.entryId);
      if (index < 0) return { ok: false, changed: false };
      const entry = normalizeSkillEntry(list[index], {
        collection: normalizedRef.collection,
        createId: PeasantActor.createPeasantNotableCombatId
      });

      let result;
      switch (operation) {
        case "add":
          result = addSkillUsage(entry, { name: options.name, createId: PeasantActor.createPeasantNotableCombatId });
          break;
        case "clear":
          result = clearSkillUsage(entry, options.usageId);
          break;
        case "condition":
          result = setSkillTagCondition(entry, options.usageId, options.tagKey, {
            when: options.when, limitNote: options.limitNote
          }, { createId: PeasantActor.createPeasantNotableCombatId });
          break;
        case "counter-scope":
          result = setSkillUsageCounterScope(entry, options.usageId, options.pool, options.scope);
          break;
        case "default":
          result = setDefaultSkillUsage(entry, options.usageId);
          break;
        case "delete":
          result = deleteSkillUsage(entry, options.usageId, { replacementDefaultId: options.replacementDefaultId });
          break;
        case "duplicate":
          result = duplicateSkillUsage(entry, options.usageId, { createId: PeasantActor.createPeasantNotableCombatId });
          break;
        case "rename":
          result = renameSkillUsage(entry, options.usageId, options.name);
          break;
      }
      if (!result?.ok) return { ...result, changed: false };

      const normalized = normalizeSkillEntry(result.entry, {
        collection: normalizedRef.collection,
        createId: PeasantActor.createPeasantNotableCombatId
      });
      if (valuesEqual(list[index], normalized)) return { ...result, changed: false, entry: normalized };
      list[index] = normalized;
      await this.updatePeasantSourceData({ [`system.${normalizedRef.collection}`]: list }, { render: options.render ?? true });
      return { ...result, changed: true, entry: normalized };
    });
  }

  async managePeasantEntryEffectLink(ref, action, options = {}) {
    const normalizedRef = normalizePeasantEntryRef(ref);
    const operation = String(action ?? "").trim().toLowerCase();
    if (!normalizedRef || !["link", "unlink"].includes(operation)) {
      return { ok: false, changed: false };
    }

    return this._queuePeasantEntryWrite(async () => {
      const source = getActorSourceSystem(this);
      const list = cloneActorList(source?.[normalizedRef.collection]);
      const index = list.findIndex((entry) => String(entry?.id ?? "").trim() === normalizedRef.entryId);
      if (index < 0) return { ok: false, changed: false };
      const entry = normalizeSkillEntry(list[index], {
        collection: normalizedRef.collection,
        createId: PeasantActor.createPeasantNotableCombatId
      });

      let result;
      if (operation === "link") {
        const effectId = String(options.effectLink?.effectId ?? "").trim();
        const effect = this.effects?.get?.(effectId);
        if (!effectId || !effect) {
          return { ok: false, changed: false, error: "The Actor effect definition is unavailable." };
        }
        if (!isSkillEditorDefinition(effect)) {
          return { ok: false, changed: false, error: "Only a disabled Skill effect definition can be linked to a usage." };
        }
        if (options.effectLink?.when === "passive"
          && hasExpiringSkillEffectDuration(effect._source?.duration ?? effect.duration)) {
          return { ok: false, changed: false, error: "Passive effects cannot have a duration. Clear the effect duration first." };
        }
        if (Array.from(effect.changes || []).some(change => isPeasantActiveEffectStateKey(change?.key))) {
          return { ok: false, changed: false, error: "This effect uses an immediate state-operation key, which cannot be offered safely." };
        }
        result = upsertSkillEffectLink(entry, options.usageId ?? "base", options.effectLink, {
          createId: PeasantActor.createPeasantNotableCombatId
        });
      } else {
        result = removeSkillEffectLink(entry, options.usageId ?? "base", options.linkId);
      }
      if (!result?.ok) return { ...result, changed: false };

      const normalized = normalizeSkillEntry(result.entry, {
        collection: normalizedRef.collection,
        createId: PeasantActor.createPeasantNotableCombatId
      });
      if (valuesEqual(list[index], normalized)) return { ...result, changed: false, entry: normalized };
      list[index] = normalized;
      await this.updatePeasantSourceData({ [`system.${normalizedRef.collection}`]: list }, { render: options.render ?? true });
      return { ...result, changed: true, entry: normalized };
    });
  }

  async removePeasantEffectReferences(effectId, { render = true } = {}) {
    const removeId = String(effectId ?? "").trim();
    if (!removeId) return { ok: false, changed: false };
    return this._queuePeasantEntryWrite(async () => {
      const source = getActorSourceSystem(this);
      const update = {};
      for (const collection of ["skills", "notableCombats"]) {
        const list = cloneActorList(source?.[collection]);
        let changed = false;
        for (let index = 0; index < list.length; index += 1) {
          const result = removeSkillEffectReferences(list[index], removeId);
          if (!result.changed) continue;
          list[index] = result.entry;
          changed = true;
        }
        if (changed) update[`system.${collection}`] = list;
      }
      if (Object.keys(update).length === 0) return { ok: true, changed: false };
      await this.updatePeasantSourceData(update, { render });
      return { ok: true, changed: true };
    });
  }

  async setPeasantEntryTag(ref, rawTagType, tagData = {}, {
    usageId = "base",
    mode = "add",
    customId = null,
    render = true
  } = {}) {
    const normalizedRef = normalizePeasantEntryRef(ref);
    if (!normalizedRef) return { ok: false, changed: false };
    return this._queuePeasantEntryWrite(async () => {
      const source = getActorSourceSystem(this);
      const list = cloneActorList(source?.[normalizedRef.collection]);
      const index = list.findIndex(entry => String(entry?.id ?? "").trim() === normalizedRef.entryId);
      if (index < 0) return { ok: false, changed: false };

      const entry = normalizeSkillEntry(list[index], {
        collection: normalizedRef.collection,
        createId: PeasantActor.createPeasantNotableCombatId
      });
      let result;
      if (usageId === "base") {
        result = setSkillTagData(entry, rawTagType, tagData, { mode, customId });
        if (result.ok) list[index] = normalizeSkillEntry(result.data, {
          collection: normalizedRef.collection,
          createId: PeasantActor.createPeasantNotableCombatId
        });
      } else {
        const usage = entry.usages.find(candidate => candidate.id === usageId);
        if (!usage) return { ok: false, changed: false };
        const working = {
          ...usage.mechanics,
          layout: usage.layout,
          rules: usage.rules,
          effectLinks: usage.effectLinks
        };
        result = setSkillTagData(working, rawTagType, tagData, { mode, customId });
        if (result.ok) {
          usage.mechanics = Object.fromEntries(Object.keys(SKILL_MECHANIC_DEFAULTS).map(key => [key, result.data[key]]));
          usage.layout = result.data.layout;
          usage.rules = result.data.rules ?? usage.rules;
          usage.effectLinks = result.data.effectLinks ?? usage.effectLinks;
          list[index] = normalizeSkillEntry(entry, {
            collection: normalizedRef.collection,
            createId: PeasantActor.createPeasantNotableCombatId
          });
        }
      }

      if (!result?.ok || !result.changed) return { ...result, entry: list[index] };
      await this.updatePeasantSourceData({ [`system.${normalizedRef.collection}`]: list }, { render });
      return { ok: true, changed: true, entry: list[index] };
    });
  }

  async setPeasantEntryUses(ref, { pool = "primary", current, max } = {}) {
    const normalizedRef = normalizePeasantEntryRef(ref);
    if (!normalizedRef || !["primary", "duress"].includes(pool)) return { ok: false, changed: false };
    return this._queuePeasantEntryWrite(async () => {
      const source = getActorSourceSystem(this);
      const list = cloneActorList(source?.[normalizedRef.collection]);
      const index = list.findIndex((entry) => String(entry?.id ?? "").trim() === normalizedRef.entryId);
      if (index < 0) return { ok: false, changed: false };
      const entry = normalizeSkillEntry(list[index], {
        collection: normalizedRef.collection,
        createId: PeasantActor.createPeasantNotableCombatId
      });
      if (pool === "primary") {
        const nextMax = normalizePeasantCounter(max, entry.usesMax);
        const requestedCurrent = normalizePeasantCounter(current, entry.usesCurrent);
        entry.usesMax = nextMax;
        entry.usesCurrent = Math.min(nextMax, requestedCurrent);
      } else {
        const nextMax = normalizePeasantCounter(max, entry.signatureUsage.duressMax);
        const requestedCurrent = normalizePeasantCounter(current, entry.signatureUsage.duressCurrent);
        entry.signatureUsage.duressMax = nextMax;
        entry.signatureUsage.duressCurrent = Math.min(nextMax, requestedCurrent);
      }
      if (valuesEqual(list[index], entry)) return { ok: true, changed: false, entry };
      list[index] = entry;
      await this.updatePeasantSourceData({ [`system.${normalizedRef.collection}`]: list });
      return { ok: true, changed: true, entry };
    });
  }

  async consumePeasantEntryUses(ref, { usageId = "base", pool = "primary", spendSignature = null } = {}) {
    const normalizedRef = normalizePeasantEntryRef(ref);
    if (!normalizedRef || !["primary", "duress"].includes(pool)) return { ok: false, changed: false, spent: [] };
    return this._queuePeasantEntryWrite(async () => {
      const source = getActorSourceSystem(this);
      const list = cloneActorList(source?.[normalizedRef.collection]);
      const index = list.findIndex((entry) => String(entry?.id ?? "").trim() === normalizedRef.entryId);
      if (index < 0) return { ok: false, changed: false, spent: [] };
      const entry = normalizeSkillEntry(list[index], {
        collection: normalizedRef.collection,
        createId: PeasantActor.createPeasantNotableCombatId
      });
      const usage = usageId === "base" ? null : entry.usages.find((candidate) => candidate.id === usageId);
      if (usageId !== "base" && !usage) return { ok: false, changed: false, spent: [] };

      const spent = [];
      const shouldSpendSignature = spendSignature ?? isSignatureSkillType(entry.type);
      if (shouldSpendSignature && pool === "primary" && entry.usesCurrent > 0) {
        entry.usesCurrent -= 1;
        spent.push("primary");
      }
      if (shouldSpendSignature && pool === "duress" && entry.signatureUsage.duressUses && entry.signatureUsage.duressCurrent > 0) {
        entry.signatureUsage.duressCurrent -= 1;
        spent.push("duress");
      }

      const tagUses = usage?.counterScopes?.tagUses === "local" ? usage.mechanics.tagUses : entry.tagUses;
      if (Number(tagUses?.max) > 0 && Number(tagUses?.current) > 0) {
        tagUses.current = Math.max(0, Math.trunc(Number(tagUses.current)) - 1);
        spent.push("tagUses");
      }
      if (!spent.length) return { ok: true, changed: false, spent, entry };
      list[index] = entry;
      await this.updatePeasantStateData({ [`system.${normalizedRef.collection}`]: list });
      return { ok: true, changed: true, spent, entry };
    });
  }

  applyActiveEffects(...args) {
    const restorations = filterPeasantFoundryActiveEffectChanges(this);
    try {
      return super.applyActiveEffects(...args);
    } finally {
      restorePeasantActiveEffectChanges(restorations);
    }
  }

  _applyPeasantVirtualActiveEffectChanges() {
    const haltValues = normalizeHaltValues(this.system?.haltValues);
    const naturalHaltValues = normalizeHaltValues(this.system?.naturalHaltValues);
    const valuesByField = { haltValues, naturalHaltValues };
    let changed = false;

    for (const effect of collectPeasantActiveEffectDocuments(this)) {
      if (effect.disabled || (isSkillEditorDefinition(effect) && !isPassiveSkillEffectDefinition(effect, this))) continue;
      for (const change of effect.changes ?? effect._source?.changes ?? []) {
        const target = getPeasantVirtualHaltTarget(change?.key);
        if (!target) continue;
        const values = valuesByField[target.field];
        values[target.index] = clampPeasantInteger(
          applyPeasantNumericActiveEffectChange(values[target.index], change.value, change.mode),
          { min: 0 }
        );
        changed = true;
      }
    }

    if (!changed) return;
    this.system.haltValues = haltValues;
    this.system.naturalHaltValues = naturalHaltValues;
  }

  _applyPeasantGridHealthMaxActiveEffectChanges() {
    if (!isPeasantCharacterType(this.type) || isSimplifiedHpActor(this)) return;
    const hp = this.system?.hp;
    if (!hp) return;

    const changes = [];
    for (const effect of collectPeasantActiveEffectDocuments(this)) {
      if (effect.disabled || effect.isSuppressed
        || (isSkillEditorDefinition(effect) && !isPassiveSkillEffectDefinition(effect, this))) continue;
      changes.push(...(effect.changes ?? effect._source?.changes ?? []));
    }

    const { rows, cols } = getPeasantHpDimensions(hp);
    const effectCols = applyPeasantGridHealthMaxChanges(cols, changes);
    if (effectCols === cols) return;
    hp.cols = effectCols;
    hp.grid = normalizePeasantHpGrid(hp.grid, rows, effectCols);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this._applyPeasantVirtualActiveEffectChanges();
    this._applyPeasantGridHealthMaxActiveEffectChanges();

    pcLog.debug("prepareDerivedData called for actor:", this.name, "type:", this.type);

    if (isPeasantCharacterType(this.type) && isSimplifiedHpActor(this)) {
      const maxHealth = getActorHealthMax(this);
      const currentHealthRaw = Number(this.system?.health?.value);
      const currentHealth = Number.isFinite(currentHealthRaw)
        ? Math.max(0, Math.min(currentHealthRaw, maxHealth))
        : maxHealth;

      this.system.health = {
        value: currentHealth,
        max: maxHealth
      };

      const tempHpMax = Math.max(0, maxHealth - currentHealth);
      const currentTempHp = this.system.temporaryHp?.value || 0;
      this.system.temporaryHp = {
        value: Math.min(currentTempHp, tempHpMax),
        max: tempHpMax
      };
    } else if (isPeasantCharacterType(this.type) && this.system.hp && this.system.hp.grid) {
      const { rows, cols } = getPeasantHpDimensions(this.system.hp);
      const totalCells = rows * cols;
      const regularCells = countPeasantRegularHpCellsInDimensions(this.system.hp.grid, rows, cols);

      this.system.health = {
        value: regularCells,
        max: totalCells
      };

      const tempHpMax = totalCells - regularCells;
      const currentTempHp = this.system.temporaryHp?.value || 0;
      this.system.temporaryHp = {
        value: Math.min(currentTempHp, tempHpMax),
        max: tempHpMax
      };

      pcLog.debug("Health calculated in Actor:", this.name, "- value:", regularCells, "max:", totalCells);
    } else {
      pcLog.debug("Health NOT calculated - type:", this.type, "has hp:", !!this.system.hp, "has grid:", !!this.system.hp?.grid);
    }
  }

  async _preUpdate(changed, options, user) {
    const result = await super._preUpdate(changed, options, user);
    if (result === false) return false;
    adjustFallBlessingUsesForEdgeMaxChange(this, changed);
    preservePeasantGridHealthEffectUpdate(this, changed);
    const guarded = guardPeasantStateUpdateFromPreparedEffectWrites(this, changed, options);
    if (guarded === false) return false;
    if (!options?.peasantCore?.sourceWrite && (Object.hasOwn(changed, "system.skills")
      || Object.hasOwn(changed, "system.notableCombats")
      || Object.hasOwn(changed.system ?? {}, "skills")
      || Object.hasOwn(changed.system ?? {}, "notableCombats"))) {
      options.peasantCore ??= {};
      options.peasantCore.passiveBefore = [...this._getPeasantPassiveSkillEffectIds()];
    }
    return guarded;
  }

  _onUpdate(changed, options, userId) {
    super._onUpdate?.(changed, options, userId);
    if (userId !== globalThis.game?.user?.id || options?.peasantCore?.sourceWrite) return;
    if (!Object.hasOwn(changed, "system.skills") && !Object.hasOwn(changed, "system.notableCombats")
      && !Object.hasOwn(changed.system ?? {}, "skills")
      && !Object.hasOwn(changed.system ?? {}, "notableCombats")) return;
    const previousPassiveIds = options?.peasantCore?.passiveBefore;
    return this._syncPeasantPassiveSkillEffects(Array.isArray(previousPassiveIds)
      ? new Set(previousPassiveIds) : this._getPeasantPassiveSkillEffectIds())
      .catch(error => console.error("Peasant Core: could not synchronize Passive effects", error));
  }

  _onCreate(data, options, userId) {
    super._onCreate?.(data, options, userId);
    if (userId !== globalThis.game?.user?.id) return;
    return this._syncPeasantPassiveSkillEffects(this._getPeasantPassiveSkillEffectIds())
      .catch(error => console.error("Peasant Core: could not synchronize Passive effects", error));
  }

  _getPeasantPassiveSkillEffectIds() {
    return new Set(Array.from(this.effects ?? [])
      .filter(effect => findPassiveSkillEffectSource(this, effect.id)).map(effect => effect.id));
  }

  async _syncPeasantPassiveSkillEffects(previousPassiveIds) {
    for (const effect of this.effects ?? []) {
      if (!isSkillEditorDefinition(effect)) continue;
      const passive = !!findPassiveSkillEffectSource(this, effect.id);
      const patch = {};
      if (effect.disabled === passive && (!passive || !previousPassiveIds.has(effect.id))) {
        patch.disabled = !passive;
      }
      if (passive && hasExpiringSkillEffectDuration(effect._source?.duration ?? effect.duration)) {
        patch.duration = { value: null, expiry: null, expired: false };
      }
      if (Object.keys(patch).length) await effect.update(patch);
    }
  }

  async updatePeasantSourceData(updateData, options = {}) {
    const updatesEntries = Object.hasOwn(updateData, "system.skills") || Object.hasOwn(updateData, "system.notableCombats");
    const previousPassiveIds = updatesEntries ? this._getPeasantPassiveSkillEffectIds() : null;
    const result = await this.update(updateData, withPeasantActorSourceWriteContext(options));
    if (updatesEntries) await this._syncPeasantPassiveSkillEffects(previousPassiveIds);
    return result;
  }

  async updatePeasantStateData(updateData, options = {}) {
    return this.update(updateData, withPeasantActorStateWriteContext(options));
  }

  async _applyPeasantSimplifiedHpDamageValue(scaledDamage, tempResult) {
    const maxHealth = getActorHealthMax(this);
    const currentHealthRaw = Number(this.system?.health?.value);
    const currentHealth = Number.isFinite(currentHealthRaw)
      ? Math.max(0, Math.min(currentHealthRaw, maxHealth))
      : maxHealth;
    const damageValue = Math.max(0, Math.floor(Number(scaledDamage) || 0));

    if (damageValue <= 0 && tempResult.tempUsed <= 0) {
      return { ok: true, value: currentHealth, scaledDamage: 0, tempUsed: 0, bolsteredUsed: 0 };
    }

    let remaining = damageValue;
    let bolsteredHp = Math.max(0, Number(this.system?.bolsteredHp) || 0);

    const bolsteredUsed = Math.min(bolsteredHp, remaining);
    bolsteredHp -= bolsteredUsed;
    remaining -= bolsteredUsed;

    const newHealth = Math.max(0, currentHealth - remaining);
    const newTempHpMax = Math.max(0, maxHealth - newHealth);
    const newTempHpValue = Math.min(tempResult.tempRemaining, newTempHpMax);
    const bolsteredCap = getActorBolsteredMax(this);

    await this.updatePeasantStateData({
      "system.health.value": newHealth,
      "system.health.max": maxHealth,
      "system.temporaryHp.value": newTempHpValue,
      "system.temporaryHp.max": newTempHpMax,
      "system.bolsteredHp": Math.max(0, Math.min(bolsteredHp, bolsteredCap))
    });

    return { ok: true, value: newHealth, scaledDamage: damageValue, tempUsed: tempResult.tempUsed, bolsteredUsed };
  }

  async applyPeasantDamage(amount, dmgType, hardLocation = false, { domeAlreadyResolved = false, scaleAlreadyResolved = false, attackScale = 0 } = {}) {
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Damage amount must be positive." };
    if (!scaleAlreadyResolved) amount = getDamageScaleResult(amount, this, attackScale).damage;

    const dome = domeAlreadyResolved
      ? getAlreadyResolvedDomeResult(amount, dmgType)
      : await absorbActorSpellEffect(this, { manifestType: "dome", damage: amount, damageType: dmgType });
    const resistance = await absorbActorSpellEffect(this, {
      manifestType: "resistance",
      damage: dome.penetration,
      damageType: dmgType
    });
    const postResistanceDamage = resistance.penetration;
    const damageCounts = applyDamageResistanceToCounts(splitDamageCounts(postResistanceDamage, String(dmgType || "").toLowerCase()), this);

    if (isSimplifiedHpActor(this)) {
      const tempResult = absorbTempHpFromCounts(damageCounts, this.system?.temporaryHp?.value);
      const scaledDamage = toSimplifiedHpDamageFromCounts(tempResult.remaining, hardLocation);
      const result = await this._applyPeasantSimplifiedHpDamageValue(scaledDamage, tempResult);
      return { ...result, dome, resistance };
    }

    const hp = this?.system?.hp;
    if (!hp?.grid || !Number.isFinite(hp.rows) || !Number.isFinite(hp.cols)) {
      return { ok: false, message: "HP grid is not available for this actor." };
    }
    if (typeof hp.applyDamage !== "function") {
      return { ok: false, message: "HP grid is not available for this actor." };
    }

    let tempHp = Number(this.system.temporaryHp?.value) || 0;
    let bolsteredHp = Number(this.system.bolsteredHp) || 0;
    const tempResult = absorbTempHpFromCounts(damageCounts, tempHp);
    const bolsteredResult = absorbBolsteredFromCounts(tempResult.remaining, bolsteredHp);
    const remainingCounts = bolsteredResult.remaining;
    tempHp = tempResult.tempRemaining;
    bolsteredHp = bolsteredResult.bolsteredRemaining;

    if (remainingCounts.critical > 0) hp.applyDamage("critical", remainingCounts.critical, false);
    if (remainingCounts.lethal > 0) hp.applyDamage("lethal", remainingCounts.lethal, hardLocation);
    if (remainingCounts.blunt > 0) hp.applyDamage("blunt", remainingCounts.blunt, false);

    const { rows, cols } = getPeasantHpDimensions(hp);
    const totalCells = rows * cols;
    const regularCells = countPeasantRegularHpCellsInDimensions(hp.grid, rows, cols);
    const newTempHpMax = totalCells - regularCells;
    const newTempHpValue = Math.min(tempHp, newTempHpMax);

    await this.updatePeasantStateData({
      "system.hp.grid": hp.grid.map(row => [...row]),
      "system.health.value": regularCells,
      "system.health.max": totalCells,
      "system.temporaryHp.value": newTempHpValue,
      "system.temporaryHp.max": newTempHpMax,
      "system.bolsteredHp": bolsteredHp
    });

    return { ok: true, value: regularCells, dome, resistance };
  }

  async applyPeasantTargetedDamage({
    amount,
    type,
    location = "Torso",
    isAP = false,
    preventByLuckPenetration = false,
    useArmorCharge = false,
    armorGrade = "",
    ignoreHaltReduction = false,
    woundLocation = null,
    suppressLocationBreaks = false,
    domeAlreadyResolved = false,
    scaleAlreadyResolved = false,
    attackScale = 0
  } = {}) {
    const normalizedType = normalizeAppliedDamageType(type);
    if (normalizedType === "flexible") {
      return { ok: false, message: "Flexible damage needs a concrete damage type before it can be applied." };
    }

    let damageAmount = Number(amount);
    if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
      return { ok: false, message: "Damage amount must be positive." };
    }
    if (!scaleAlreadyResolved) damageAmount = getDamageScaleResult(damageAmount, this, attackScale).damage;

    const locKey = getTargetedDamageConditionKey(location);
    const woundLoc = woundLocation || location;
    const locationDisplay = getTargetedDamageLocationDisplay(location);
    const haltIndex = TARGETED_DAMAGE_HALT_INDEX_MAP[location] ?? 0;
    const isHybrid = normalizedType === "hybrid";

    const equippedArmorGrade = getEquippedArmorGrade(this);
    const requestedArmorGrade = String(armorGrade ?? "").trim().toLowerCase();
    const armorChargeValue = getArmorChargeValue(this);
    useArmorCharge = !!useArmorCharge
      && canSpendActiveArmorCharge(this)
      && (!requestedArmorGrade || requestedArmorGrade === equippedArmorGrade);
    if (useArmorCharge && requestedArmorGrade === "light" && equippedArmorGrade === "light" && preventByLuckPenetration) {
      isAP = false;
    }

    const dome = domeAlreadyResolved
      ? getAlreadyResolvedDomeResult(damageAmount, normalizedType)
      : await absorbActorSpellEffect(this, { manifestType: "dome", damage: damageAmount, damageType: normalizedType });
    let netDamage = dome.penetration;
    let haltUsed = 0;

    const equippedArmor = getEquippedArmorEffects(this);
    const haltParts = addEquippedArmorHalt(this.system?.haltValues, equippedArmor);
    const naturalHaltParts = parseHaltSlashValues(this.system?.naturalHaltValues || "0/0/0/0");
    const combatHaltTotals = getCombatHaltBuffTotals(this.system?.combatMods?.haltBuffs);
    const armorHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_HALT] || [0, 0, 0, 0];
    const naturalHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_NATURAL] || [0, 0, 0, 0];

    if (!ignoreHaltReduction) {
      const naturalHalt = (Number.parseInt(naturalHaltParts[haltIndex], 10) || 0) + (naturalHaltBuffs[haltIndex] || 0);
      let armorHalt = (Number.parseInt(haltParts[haltIndex], 10) || 0) + (armorHaltBuffs[haltIndex] || 0);
      if (useArmorCharge) armorHalt *= getArmorChargeMultiplier(this);

      haltUsed += naturalHalt;
      if (!isAP) haltUsed += armorHalt;
      netDamage = Math.max(0, netDamage - haltUsed);
    }

    const resistance = await absorbActorSpellEffect(this, {
      manifestType: "resistance",
      damage: netDamage,
      damageType: normalizedType
    });
    netDamage = resistance.penetration;

    let isHard = false;
    if (isHybrid) {
      isHard = true;
    } else {
      const flags = TARGETED_DAMAGE_HARD_FLAG_MAP[location] || { hard: "", naturalHard: "" };
      const armorHard = !!this.system?.[flags.hard] || !!equippedArmor[flags.hard];
      const naturalHard = !!this.system?.[flags.naturalHard];
      isHard = naturalHard || (!isAP && armorHard);
    }

    const rawCounts = splitDamageCounts(netDamage, normalizedType);
    const resistedCounts = applyDamageResistanceToCounts(rawCounts, this);

    if (isSimplifiedHpActor(this)) {
      const healthBefore = Math.max(0, Number(this.system?.health?.value) || 0);
      const tempResult = absorbTempHpFromCounts(resistedCounts, this.system?.temporaryHp?.value);
      const scaledDamage = toSimplifiedHpDamageFromCounts(tempResult.remaining, isHard);
      const result = await this._applyPeasantSimplifiedHpDamageValue(scaledDamage, tempResult);
      const damageToGrid = Math.max(0, healthBefore - (Number(result?.value) || 0));
      const armorChargeRefunded = !!(result?.ok && useArmorCharge && equippedArmorGrade === "heavy" && damageToGrid === 0);
      const armorChargeSpent = !!(result?.ok && useArmorCharge && !armorChargeRefunded);
      if (armorChargeSpent) {
        await this.updatePeasantStateData({ "system.armorCharge.value": Math.max(0, armorChargeValue - 1) });
      }
      return {
        ...result,
        location,
        locationDisplay,
        haltUsed,
        netDamage,
        normalizedType,
        isHybrid,
        damageToGrid,
        isHard,
        useArmorCharge,
        armorChargeSpent,
        armorChargeRefunded,
        isAP,
        ignoreHaltReduction,
        dome,
        resistance
      };
    }

    const resistedNetDamage = sumDamageCounts(resistedCounts);

    let tempHp = this.system?.temporaryHp?.value || 0;
    let bolsteredHp = this.system?.bolsteredHp || 0;
    let tempHpUsed = 0;
    let bolsteredHpUsed = 0;

    let remainingCounts = resistedCounts;
    if (resistedNetDamage > 0) {
      const tempResult = absorbTempHpFromCounts(remainingCounts, tempHp);
      remainingCounts = tempResult.remaining;
      tempHpUsed = tempResult.tempUsed;
      tempHp = tempResult.tempRemaining;

      const bolsteredResult = absorbBolsteredFromCounts(remainingCounts, bolsteredHp);
      remainingCounts = bolsteredResult.remaining;
      bolsteredHpUsed = bolsteredResult.bolsteredUsed;
      bolsteredHp = bolsteredResult.bolsteredRemaining;
    }

    const damageToGrid = sumDamageCounts(remainingCounts);
    const hp = this.system?.hp;
    if (!hp?.grid || !Number.isFinite(hp.rows) || !Number.isFinite(hp.cols) || typeof hp.applyDamage !== "function") {
      return { ok: false, message: "HP grid is not available for this actor." };
    }

    const woundThresholds = getEffectiveWoundThresholds(this);
    const woundThresholdKey = woundLoc === "Torso"
      ? "torso"
      : (woundLoc === "RightArm" || woundLoc === "LeftArm")
        ? "arms"
        : (woundLoc === "RightLeg" || woundLoc === "LeftLeg")
          ? "legs"
          : "head";
    const { base: woundThresholdBase, effective: woundThreshold } = woundThresholds[woundThresholdKey];
    const devastatingWoundsBefore = getDevastatingWoundCount(this);
    const wasWounded = !!this.system?.conditions?.wounded;
    const currentLocStatus = this.system?.conditions?.[locKey];

    let newWoundedState = wasWounded;
    let newLocStatus = currentLocStatus;
    let breakOccurred = false;
    let breakType = "";
    let devastatingWoundsGained = 0;
    const events = [];

    if (damageToGrid > woundThreshold) {
      if (!wasWounded) {
        newWoundedState = true;
        events.push("Became Wounded!");
      } else {
        devastatingWoundsGained++;
      }
    }

    if (!suppressLocationBreaks && damageToGrid >= woundThreshold * 3) {
      breakOccurred = true;
      breakType = "Crippled";
      newLocStatus = "crippled";
    } else if (!suppressLocationBreaks && damageToGrid >= woundThreshold * 2) {
      if (currentLocStatus === "disabled") {
        breakOccurred = true;
        breakType = "Crippled";
        newLocStatus = "crippled";
      } else if (currentLocStatus === "crippled") {
        breakOccurred = true;
        breakType = "Crippled";
      } else {
        breakOccurred = true;
        breakType = "Disabled";
        newLocStatus = "disabled";
      }
    }

    if (breakType === "Disabled") devastatingWoundsGained++;
    if (breakType === "Crippled") devastatingWoundsGained += 2;
    const devastatingWoundsAfter = devastatingWoundsBefore + devastatingWoundsGained;
    const breakCriticalDamage = breakOccurred ? woundThresholdBase : 0;
    if (devastatingWoundsGained > 0) events.push(`Gained ${devastatingWoundsGained} Devastating Wound${devastatingWoundsGained === 1 ? "" : "s"}!`);
    if (breakOccurred) events.push(`${breakType} ${locationDisplay}!`);

    if (damageToGrid > 0) {
      if (remainingCounts.critical > 0) hp.applyDamage("critical", remainingCounts.critical, false);
      if (remainingCounts.lethal > 0) {
        const hardForLethal = isHybrid ? false : isHard;
        hp.applyDamage("lethal", remainingCounts.lethal, hardForLethal);
      }
      if (remainingCounts.blunt > 0) hp.applyDamage("blunt", remainingCounts.blunt, false);
      if (breakOccurred) hp.applyDamage("critical", breakCriticalDamage, false);
    }

    const { rows, cols } = getPeasantHpDimensions(hp);
    const totalCells = rows * cols;
    const regularCells = countPeasantRegularHpCellsInDimensions(hp.grid, rows, cols);

    const newTempHpMax = totalCells - regularCells;
    const newTempHpValue = Math.min(tempHp, newTempHpMax);

    const armorChargeRefunded = !!(useArmorCharge && equippedArmorGrade === "heavy" && damageToGrid === 0);
    const armorChargeSpent = !!(useArmorCharge && !armorChargeRefunded);
    await this.updatePeasantStateData({
      "system.hp.grid": hp.grid.map(row => [...row]),
      "system.health.value": regularCells,
      "system.health.max": totalCells,
      "system.temporaryHp.value": newTempHpValue,
      "system.temporaryHp.max": newTempHpMax,
      "system.bolsteredHp": bolsteredHp,
      ...(newWoundedState !== wasWounded ? { "system.conditions.wounded": newWoundedState } : {}),
      ...(!suppressLocationBreaks && newLocStatus !== currentLocStatus ? { [`system.conditions.${locKey}`]: newLocStatus } : {}),
      ...(devastatingWoundsGained > 0 ? { "system.devastatingWounds": devastatingWoundsAfter } : {}),
      ...(armorChargeSpent ? { "system.armorCharge.value": Math.max(0, armorChargeValue - 1) } : {})
    });

    return {
      ok: true,
      value: regularCells,
      location,
      locationDisplay,
      haltUsed,
      netDamage,
      normalizedType,
      isHybrid,
      damageToGrid,
      isHard,
      useArmorCharge,
      armorChargeSpent,
      armorChargeRefunded,
      isAP,
      ignoreHaltReduction,
      tempHpUsed,
      bolsteredHpUsed,
      breakOccurred,
      woundThresholds,
      devastatingWoundsBefore,
      devastatingWoundsGained,
      devastatingWoundsAfter,
      breakType,
      breakCriticalDamage,
      events,
      dome,
      resistance
    };
  }

  async applyPeasantLocationlessDamage({
    amount,
    type,
    domeAlreadyResolved = false,
    scaleAlreadyResolved = false,
    attackScale = 0,
    ignoreResistance = false
  } = {}) {
    const normalizedType = normalizeAppliedDamageType(type);
    if (normalizedType === "flexible") {
      return { ok: false, message: "Flexible damage needs a concrete damage type before it can be applied." };
    }

    let damageAmount = Number(amount);
    if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
      return { ok: false, message: "Damage amount must be positive." };
    }
    if (!scaleAlreadyResolved) damageAmount = getDamageScaleResult(damageAmount, this, attackScale).damage;

    const dome = domeAlreadyResolved
      ? getAlreadyResolvedDomeResult(damageAmount, normalizedType)
      : await absorbActorSpellEffect(this, { manifestType: "dome", damage: damageAmount, damageType: normalizedType });
    const resistance = ignoreResistance
      ? {
        handled: true,
        applied: false,
        reason: "ignored",
        absorbed: 0,
        penetration: dome.penetration,
        remainingHp: 0,
        depleted: false,
        damageType: normalizedType
      }
      : await absorbActorSpellEffect(this, {
        manifestType: "resistance",
        damage: dome.penetration,
        damageType: normalizedType
      });
    const netDamage = resistance.penetration;
    const rawCounts = splitDamageCounts(netDamage, normalizedType);
    const resistedCounts = ignoreResistance ? rawCounts : applyDamageResistanceToCounts(rawCounts, this);

    if (isSimplifiedHpActor(this)) {
      const tempResult = absorbTempHpFromCounts(resistedCounts, this.system?.temporaryHp?.value);
      const scaledDamage = toSimplifiedHpDamageFromCounts(tempResult.remaining);
      const result = await this._applyPeasantSimplifiedHpDamageValue(scaledDamage, tempResult);
      return {
        ...result,
        locationless: true,
        haltUsed: 0,
        netDamage,
        normalizedType,
        isHybrid: normalizedType === "hybrid",
        damageToGrid: result?.scaledDamage ?? scaledDamage,
        isHard: false,
        useArmorCharge: false,
        isAP: false,
        ignoreHaltReduction: true,
        dome,
        resistance
      };
    }

    const resistedDamage = sumDamageCounts(resistedCounts);

    let tempHp = this.system?.temporaryHp?.value || 0;
    let bolsteredHp = this.system?.bolsteredHp || 0;
    let tempHpUsed = 0;
    let bolsteredHpUsed = 0;

    let remainingCounts = resistedCounts;
    if (resistedDamage > 0) {
      const tempResult = absorbTempHpFromCounts(remainingCounts, tempHp);
      remainingCounts = tempResult.remaining;
      tempHpUsed = tempResult.tempUsed;
      tempHp = tempResult.tempRemaining;

      const bolsteredResult = absorbBolsteredFromCounts(remainingCounts, bolsteredHp);
      remainingCounts = bolsteredResult.remaining;
      bolsteredHpUsed = bolsteredResult.bolsteredUsed;
      bolsteredHp = bolsteredResult.bolsteredRemaining;
    }

    const damageToGrid = sumDamageCounts(remainingCounts);
    const hp = this.system?.hp;
    if (!hp?.grid || !Number.isFinite(hp.rows) || !Number.isFinite(hp.cols) || typeof hp.applyDamage !== "function") {
      return { ok: false, message: "HP grid is not available for this actor." };
    }

    if (remainingCounts.critical > 0) hp.applyDamage("critical", remainingCounts.critical, false);
    if (remainingCounts.lethal > 0) hp.applyDamage("lethal", remainingCounts.lethal, false);
    if (remainingCounts.blunt > 0) hp.applyDamage("blunt", remainingCounts.blunt, false);

    const { rows, cols } = getPeasantHpDimensions(hp);
    const totalCells = rows * cols;
    const regularCells = countPeasantRegularHpCellsInDimensions(hp.grid, rows, cols);

    const newTempHpMax = totalCells - regularCells;
    const newTempHpValue = Math.min(tempHp, newTempHpMax);

    await this.updatePeasantStateData({
      "system.hp.grid": hp.grid.map(row => [...row]),
      "system.health.value": regularCells,
      "system.health.max": totalCells,
      "system.temporaryHp.value": newTempHpValue,
      "system.temporaryHp.max": newTempHpMax,
      "system.bolsteredHp": bolsteredHp
    });

    return {
      ok: true,
      value: regularCells,
      locationless: true,
      haltUsed: 0,
      netDamage,
      normalizedType,
      isHybrid: normalizedType === "hybrid",
      damageToGrid,
      isHard: false,
      useArmorCharge: false,
      isAP: false,
      ignoreHaltReduction: true,
      tempHpUsed,
      bolsteredHpUsed,
      breakOccurred: false,
      events: [],
      dome,
      resistance
    };
  }

  async applyPeasantHeal(amount, healType) {
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Heal amount must be positive." };
    if (healType !== "temporary" && healType !== "greater" && healType !== "special") {
      return { ok: false, message: "Heal type must be temporary, greater, or special." };
    }

    const emptyHealedDamageCounts = () => ({ blunt: 0, lethal: 0, critical: 0 });
    const noSpecialResult = {
      specialEligible: false,
      criticalOnlyBefore: false,
      criticalDamageBefore: 0,
      criticalDamageAfter: 0,
      criticalFullyHealed: false,
      thresholdBreakLocationsMended: []
    };

    if (isSimplifiedHpActor(this)) {
      const maxHealth = getActorHealthMax(this);
      const currentHealthRaw = Number(this.system?.health?.value);
      const currentHealth = Number.isFinite(currentHealthRaw)
        ? Math.max(0, Math.min(currentHealthRaw, maxHealth))
        : maxHealth;

      const currentTempHp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);
      const tempHpMax = Math.max(0, maxHealth - currentHealth);
      const bolsteredCap = getActorBolsteredMax(this);
      let updates = {};

      if (healType !== "greater") {
        const canGrantTempHp = Math.max(0, tempHpMax - currentTempHp);
        const tempHpGranted = Math.min(amount, canGrantTempHp);
        updates["system.temporaryHp.value"] = currentTempHp + tempHpGranted;
        updates["system.temporaryHp.max"] = tempHpMax;
        updates["system.health.value"] = currentHealth;
        updates["system.health.max"] = maxHealth;
        await this.updatePeasantStateData(updates);
        return {
          ok: true,
          value: currentHealth,
          healedDamageCounts: emptyHealedDamageCounts(),
          tempHpGranted,
          bolsteredHpBefore: Math.max(0, Number(this.system?.bolsteredHp) || 0),
          bolsteredHpAfter: Math.max(0, Number(this.system?.bolsteredHp) || 0),
          bolsteredHpGained: 0,
          effectiveHealingPower: 0,
          ...noSpecialResult
        };
      }

      let remaining = amount;
      const canGrantTempHp = Math.max(0, tempHpMax - currentTempHp);
      const tempHpGranted = Math.min(remaining, canGrantTempHp);
      remaining -= tempHpGranted;

      const missingHp = Math.max(0, maxHealth - currentHealth);
      const hpHealed = Math.min(remaining, missingHp);
      remaining -= hpHealed;
      const newHealth = Math.min(maxHealth, currentHealth + hpHealed);

      const previousBolsteredHp = Math.max(0, Number(this.system?.bolsteredHp) || 0);
      let newBolsteredHp = previousBolsteredHp;
      if (remaining > 0) {
        const bolsteredGain = Math.floor(remaining / 2);
        newBolsteredHp = Math.min(bolsteredCap, bolsteredGain);
      }
      const bolsteredHpGained = Math.max(0, newBolsteredHp - previousBolsteredHp);
      const healedDamageCounts = { blunt: hpHealed, lethal: 0, critical: 0 };
      const effectiveHealingPower = toSimplifiedHpDamageFromCounts(healedDamageCounts);

      const newTempHpMax = Math.max(0, maxHealth - newHealth);
      const newTempHpValue = Math.min(currentTempHp + tempHpGranted, newTempHpMax);

      updates["system.health.value"] = newHealth;
      updates["system.health.max"] = maxHealth;
      updates["system.temporaryHp.value"] = newTempHpValue;
      updates["system.temporaryHp.max"] = newTempHpMax;
      updates["system.bolsteredHp"] = newBolsteredHp;
      await this.updatePeasantStateData(updates);
      if (hpHealed > 0) await applyOverchargedEffect(this);
      return {
        ok: true,
        value: newHealth,
        healedDamageCounts,
        tempHpGranted,
        bolsteredHpBefore: previousBolsteredHp,
        bolsteredHpAfter: newBolsteredHp,
        bolsteredHpGained,
        effectiveHealingPower,
        ...noSpecialResult
      };
    }

    const hpData = this.system?.hp;
    if (!hpData?.grid || !Number.isFinite(hpData.rows) || !Number.isFinite(hpData.cols)) {
      return { ok: false, message: "HP grid is not available for this actor." };
    }

    const hp = JSON.parse(JSON.stringify(hpData || { rows: 0, cols: 0, grid: [] }));
    const { rows, cols } = getPeasantHpDimensions(hp);
    const totalCells = rows * cols;
    let regularCells = countPeasantRegularHpCellsInDimensions(hp.grid, rows, cols);

    const tempHpMax = totalCells - regularCells;
    const currentTempHp = Math.max(0, Number(this.system.temporaryHp?.value) || 0);
    let criticalDamageBefore = 0;
    let damagedCellsBefore = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = Number(hp.grid?.[r]?.[c]) || 0;
        if (cell > 0) damagedCellsBefore++;
        if (cell === 3) criticalDamageBefore++;
      }
    }
    const criticalOnlyBefore = criticalDamageBefore > 0 && criticalDamageBefore === damagedCellsBefore;
    const specialEligible = healType === "special" && currentTempHp >= tempHpMax && criticalOnlyBefore;
    let updates = {};
    let remaining = amount;
    let tempHpGranted = 0;
    let bolsteredHpGained = 0;
    const healedDamageCounts = emptyHealedDamageCounts();
    const previousBolsteredHp = Math.max(0, Number(this.system?.bolsteredHp) || 0);
    let newBolsteredHp = previousBolsteredHp;

    if (healType === "temporary" || (healType === "special" && !specialEligible)) {
      const canGrantTempHp = Math.max(0, tempHpMax - currentTempHp);
      tempHpGranted = Math.min(remaining, canGrantTempHp);
      const newTempHpValue = currentTempHp + tempHpGranted;
      updates["system.temporaryHp.value"] = newTempHpValue;
      updates["system.temporaryHp.max"] = tempHpMax;
    } else if (healType === "greater" || specialEligible) {
      if (healType === "greater") {
        const canGrantTempHp = Math.max(0, tempHpMax - currentTempHp);
        tempHpGranted = Math.min(remaining, canGrantTempHp);
        remaining -= tempHpGranted;
      }

      for (let r = rows - 1; r >= 0 && remaining > 0; r--) {
        for (let c = cols - 1; c >= 0 && remaining > 0; c--) {
          const healedCell = Number(hp.grid?.[r]?.[c]) || 0;
          if (specialEligible ? healedCell !== 3 : (healedCell !== 1 && healedCell !== 2)) continue;
          if (healedCell === 1) healedDamageCounts.blunt += 1;
          else if (healedCell === 2) healedDamageCounts.lethal += 1;
          else if (healedCell === 3) healedDamageCounts.critical += 1;
          hp.grid[r][c] = 0;
          remaining--;
        }
      }

      if (healType === "greater" && remaining > 0) {
        const bolsteredHpGenerated = Math.min(Math.floor(remaining / 2), cols);
        newBolsteredHp = Math.min(getActorBolsteredMax(this), bolsteredHpGenerated);
      }
      bolsteredHpGained = Math.max(0, newBolsteredHp - previousBolsteredHp);

      regularCells = countPeasantRegularHpCellsInDimensions(hp.grid, rows, cols);
      const newTempHpMax = totalCells - regularCells;
      const newTempHpValue = Math.min(currentTempHp + tempHpGranted, newTempHpMax);

      updates["system.hp.grid"] = hp.grid.map(row => [...row]);
      updates["system.health.value"] = regularCells;
      updates["system.health.max"] = totalCells;
      updates["system.temporaryHp.value"] = newTempHpValue;
      updates["system.temporaryHp.max"] = newTempHpMax;
      if (newBolsteredHp !== previousBolsteredHp) updates["system.bolsteredHp"] = newBolsteredHp;
    }

    const criticalDamageAfter = hp.grid.slice(0, rows).reduce((sum, row) => (
      sum + row.slice(0, cols).filter((cell) => Number(cell) === 3).length
    ), 0);
    const criticalFullyHealed = specialEligible && criticalDamageBefore > 0 && criticalDamageAfter === 0;
    const thresholdBreakLocationsMended = [];
    if (criticalFullyHealed) {
      for (const key of PeasantActor.CONDITION_KEYS) {
        if (key === "wounded" || !PeasantActor.WOUND_STATUSES.includes(this.system?.conditions?.[key])) continue;
        thresholdBreakLocationsMended.push(key);
        updates[`system.conditions.${key}`] = "";
      }
    }
    await this.updatePeasantStateData(updates);
    if ((specialEligible && healedDamageCounts.critical > 0)
      || (healType === "greater" && (healedDamageCounts.blunt > 0 || healedDamageCounts.lethal > 0))) {
      await applyOverchargedEffect(this);
    }
    return {
      ok: true,
      value: regularCells,
      healedDamageCounts,
      tempHpGranted,
      bolsteredHpBefore: previousBolsteredHp,
      bolsteredHpAfter: newBolsteredHp,
      bolsteredHpGained,
      effectiveHealingPower: toSimplifiedHpDamageFromCounts(healedDamageCounts),
      specialEligible,
      criticalOnlyBefore,
      criticalDamageBefore,
      criticalDamageAfter,
      criticalFullyHealed,
      thresholdBreakLocationsMended
    };
  }

  async applyPeasantHpValueCommand(raw) {
    const cmd = parseHpValueCommand(raw);
    if (!cmd) {
      return { ok: false, message: "Use +# or -# (optional: L, B, C, H for damage; G for greater heal; S for special heal)." };
    }

    if (cmd.sign === "-") {
      const suffix = cmd.suffix || "L";
      let dmgType = "lethal";
      let hard = false;
      if (suffix === "B") dmgType = "blunt";
      else if (suffix === "C") dmgType = "critical";
      else if (suffix === "H") { dmgType = "lethal"; hard = true; }
      else if (suffix !== "L") {
        return { ok: false, message: "Damage type must be L, B, C, or H." };
      }
      return this.applyPeasantDamage(cmd.amount, dmgType, hard);
    }

    if (cmd.suffix && cmd.suffix !== "G" && cmd.suffix !== "S") {
      return { ok: false, message: "Heal modifier must be G for Greater Heal or S for Special Heal." };
    }
    const healType = cmd.suffix === "G" ? "greater" : cmd.suffix === "S" ? "special" : "temporary";
    return this.applyPeasantHeal(cmd.amount, healType);
  }

  async applyPeasantCombatResourceCosts(combat, costModifiersByType = {}) {
    const resourceCosts = Array.isArray(combat?.resourceCosts) ? combat.resourceCosts : [];

    for (const cost of resourceCosts) {
      const baseCostValue = Number.parseInt(cost?.value, 10) || 0;
      if (!cost?.type || baseCostValue <= 0) continue;

      const costType = sanitizeCombatCostResourceType(cost.type);
      let remaining = Math.max(0, baseCostValue + (costModifiersByType[costType] || 0));
      if (remaining <= 0) continue;

      switch (costType) {
        case "Stamina": {
          const currentStamina = this.system?.stamina?.value || 0;
          if (currentStamina >= remaining) {
            await this.updatePeasantStateData({ "system.stamina.value": currentStamina - remaining });
          } else {
            if (currentStamina > 0) {
              await this.updatePeasantStateData({ "system.stamina.value": 0 });
              remaining -= currentStamina;
            }
            if (remaining > 0) {
              const overflow = await applyCombatStressDamageForActor(this, "physical", remaining);
              if (overflow > 0) {
                await applyCombatStressDamageForActor(this, "general", overflow);
              }
            }
          }
          break;
        }

        case "Attunement": {
          const currentAttunement = this.system?.attunement?.value || 0;
          if (currentAttunement >= remaining) {
            await this.updatePeasantStateData({ "system.attunement.value": currentAttunement - remaining });
          } else {
            if (currentAttunement > 0) {
              await this.updatePeasantStateData({ "system.attunement.value": 0 });
              remaining -= currentAttunement;
            }

            const currentCapacity = this.system?.capacity?.value || 0;
            if (currentCapacity >= remaining) {
              await this.updatePeasantStateData({ "system.capacity.value": currentCapacity - remaining });
              remaining = 0;
            } else {
              if (currentCapacity > 0) {
                await this.updatePeasantStateData({ "system.capacity.value": 0 });
                remaining -= currentCapacity;
              }

              if (remaining > 0) {
                const stressOverflow = await applyCombatStressDamageForActor(this, "mental", remaining);
                if (stressOverflow > 0) {
                  await applyCombatStressDamageForActor(this, "general", stressOverflow);
                }

                await this.applyPeasantResourceHpDamage(remaining, "blunt");
              }
            }
          }
          break;
        }

        case "HP": {
          const dmgType = cost?.damageType?.toLowerCase() || "blunt";
          await this.applyPeasantResourceHpDamage(remaining, dmgType);
          break;
        }

        case "Physical Stress": {
          const overflow = await applyCombatStressDamageForActor(this, "physical", remaining);
          if (overflow > 0) {
            await applyCombatStressDamageForActor(this, "general", overflow);
          }
          break;
        }

        case "Mental Stress": {
          const overflow = await applyCombatStressDamageForActor(this, "mental", remaining);
          if (overflow > 0) {
            await applyCombatStressDamageForActor(this, "general", overflow);
          }
          break;
        }
      }
    }

    return { ok: true };
  }

  async applyPeasantMageBlockBarrierAction({
    action,
    selectedCombatId = null,
    selectedCombatIndex = null,
    selectedUsageId = "base"
  } = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const selected = resolveSelectedDefenseCombat(combats, { selectedCombatId, selectedCombatIndex, selectedUsageId });
    const combat = selected?.combat || null;
    const defense = selected?.defense;
    if (!combat || !defense.block || defense.blockType !== "Mage") {
      return { ok: false, changed: false, reason: "invalidMageBlockDefense" };
    }

    const identity = getMageBlockDefenseIdentity("notableCombats", combat.id, selected.usageId);
    const duress = getMageBlockDuressEffect(this, identity);
    let barrier = getMageBlockBarrierEffect(this, identity);
    const initialized = !!(barrier && duress);
    const resolvedAction = String(action || "").trim().toLowerCase();
    if (resolvedAction === "use") {
      return initialized
        ? { ok: true, changed: false, action: resolvedAction, hp: getMageBlockBarrierHp(barrier).value }
        : { ok: false, changed: false, reason: "mageBlockDuressNotStarted" };
    }
    if ((resolvedAction === "create" && initialized) || (resolvedAction === "refresh" && !initialized)) {
      return { ok: false, changed: false, reason: "invalidMageBarrierAction" };
    }
    if (resolvedAction !== "create" && resolvedAction !== "refresh") {
      return { ok: false, changed: false, reason: "invalidMageBarrierAction" };
    }

    const maxHp = Math.max(1, defense.maxHp);
    const name = String(combat.name || "Mage Block");
    const effects = await createMageBlockEffects(this, {
      identity,
      name,
      img: getNotableCombatEffectImage(this, combat),
      hp: maxHp,
      maxHp,
      createBarrier: true,
      createDuress: true,
      refreshBarrier: true
    });
    barrier = effects.barrier || getMageBlockBarrierEffect(this, identity);
    const currentDuress = effects.duress || getMageBlockDuressEffect(this, identity);
    if (!barrier || !currentDuress) {
      return { ok: false, changed: false, reason: "mageBlockEffectCreationFailed" };
    }
    return { ok: true, changed: true, action: resolvedAction, hp: maxHp };
  }

  async applyPeasantResourceHpDamage(amount, dmgType) {
    if (isSimplifiedHpActor(this)) {
      return this.applyPeasantDamage(amount, dmgType, false);
    }

    const hp = this.system?.hp;
    if (hp?.applyDamage) {
      hp.applyDamage(dmgType, amount, false);
      const { rows, cols } = getPeasantHpDimensions(hp);
      const totalCells = rows * cols;
      const regularCells = countPeasantRegularHpCellsInDimensions(hp.grid, rows, cols);
      await this.updatePeasantStateData({
        "system.hp.grid": hp.grid.map((row) => [...row]),
        "system.health.value": regularCells,
        "system.health.max": totalCells
      });
    }

    return { ok: true };
  }

  async consumePeasantCombatUse(combatIndex, options = {}) {
    await this.ensurePeasantEntryIds("notableCombats");
    const combat = getActorSourceSystem(this)?.notableCombats?.[Number.parseInt(combatIndex, 10)];
    if (!combat?.id) return { ok: false, changed: false };
    const result = await this.consumePeasantEntryUses(
      { collection: "notableCombats", entryId: combat.id },
      { usageId: options.usageId ?? "base", pool: options.pool ?? "primary" }
    );
    return { ...result, combats: getActorSourceSystem(this)?.notableCombats ?? [] };
  }

  static createDefaultPeasantCombatEntry(entry = {}) {
    const existing = (entry && typeof entry === "object") ? entry : {};
    const defaults = {
      id: PeasantActor.createPeasantNotableCombatId(),
      type: "skill",
      specialGrade: 0,
      class: 1,
      rank: "0",
      name: "",
      img: "",
      effectIds: [],
      tohit: null,
      accuracy: null,
      usesMax: 0,
      usesCurrent: 0,
      indent: 0,
      description: "",
      staminaCost: 0,
      attunementCost: 0,
      range: 0,
      rangeRate: [null, null, null, null],
      resourceCosts: [],
      speed: { type: "", splitSecondCurrent: 0, splitSecondMax: 0 },
      damage: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" },
      desperate: 0,
      overkill: false,
      tippingScales: 0,
      magnetism: { grade: 0 },
      heal: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" },
      manifest: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0 },
      manifestDome: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, duration: 3 },
      manifestResistance: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, haltValues: [1, 1, 1, 1] },
      tagUses: { current: 0, max: 0 },
      sections: { current: 0, max: 0 },
      aoe: { value: 0, type: "" },
      customTags: [],
      customTag: { name: "", value: "" },
      targetingType: "",
      defense: createDefaultCombatDefense(),
      reach: 0,
      stability: false,
      strengthen: false,
      self: false,
      tagOrder: []
    };

    const merged = { ...defaults, ...existing };
    merged.id = String(merged.id ?? "").trim() || PeasantActor.createPeasantNotableCombatId();
    merged.resourceCosts = Array.isArray(existing.resourceCosts) ? existing.resourceCosts : [];
    merged.effectIds = Array.isArray(existing.effectIds)
      ? existing.effectIds.map(id => String(id ?? "").trim()).filter(Boolean)
      : [];
    merged.speed = { ...defaults.speed, ...(existing.speed || {}) };
    merged.damage = { ...defaults.damage, ...(existing.damage || {}) };
    merged.desperate = Number.parseInt(merged.desperate, 10) || 0;
    merged.magnetism = normalizeCombatMagnetism(existing.magnetism);
    merged.heal = { ...defaults.heal, ...(existing.heal || {}) };
    merged.manifest = { ...defaults.manifest, ...(existing.manifest || {}) };
    merged.manifestDome = { ...defaults.manifestDome, ...(existing.manifestDome || {}) };
    merged.manifestResistance = { ...defaults.manifestResistance, ...(existing.manifestResistance || {}) };
    merged.manifestResistance.haltValues = normalizeHaltValues(merged.manifestResistance.haltValues);
    merged.tagUses = { ...defaults.tagUses, ...(existing.tagUses || {}) };
    merged.sections = { ...defaults.sections, ...(existing.sections || {}) };
    merged.aoe = { ...defaults.aoe, ...(existing.aoe || {}) };
    merged.defense = normalizeCombatDefense(existing.defense);
    merged.targetingType = normalizeCombatTargetingType(merged.targetingType) || String(merged.targetingType ?? "");
    merged.tagOrder = Array.isArray(existing.tagOrder)
      ? existing.tagOrder.filter((tagType) => COMBAT_FULL_TAG_ORDER.includes(tagType))
      : [];
    merged.tohit = parseOptionalInteger(merged.tohit, { min: 1 });
    merged.accuracy = parseOptionalInteger(merged.accuracy, { allowSign: true });
    merged.rangeRate = normalizeRangeRateValue(merged.rangeRate);
    syncCombatCustomTags(merged);
    if (!merged.stability) merged.strengthen = false;
    return normalizeSkillEntry(merged, {
      collection: "notableCombats",
      createId: PeasantActor.createPeasantNotableCombatId
    });
  }

  getPeasantNotableCombatsForUpdate() {
    return cloneActorListForUpdate(this, "notableCombats");
  }

  ensurePeasantNotableCombatAt(combats, index) {
    return ensureActorListEntryAt(combats, index, PeasantActor.createDefaultPeasantCombatEntry);
  }

  async setPeasantNotableCombats(combats, options = {}) {
    const list = cloneActorList(combats);
    for (const combat of list) {
      if (!combat || typeof combat !== "object") continue;
      combat.type = normalizeSkillTypeForCategory(combat.type, combat.category);
    }
    PeasantActor.ensurePeasantNotableCombatIds(list);
    await this.updatePeasantSourceData({ "system.notableCombats": list }, options);
    return { ok: true, changed: true, combats: list };
  }

  async addPeasantNotableCombat(options = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    combats.push(PeasantActor.createDefaultPeasantCombatEntry());
    return this.setPeasantNotableCombats(combats, options);
  }

  async duplicatePeasantNotableCombat(index, options = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const result = duplicateActorListEntry(combats, index, PeasantActor.createPeasantNotableCombatId);
    if (!result.changed) return result;
    return this.setPeasantNotableCombats(combats, options);
  }

  async removePeasantNotableCombat(index, options = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const result = removeActorListEntry(combats, index);
    if (!result.changed) return { ok: false, changed: false };
    return this.setPeasantNotableCombats(combats, options);
  }

  async reorderPeasantNotableCombat(fromIndex, toIndex, options = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const result = reorderActorListEntry(combats, fromIndex, toIndex);
    if (!result.changed) return { ok: false, changed: false };
    return this.setPeasantNotableCombats(combats, options);
  }

  async updatePeasantNotableCombat(index, patch, options = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const result = patchActorListEntry(combats, index, patch, PeasantActor.createDefaultPeasantCombatEntry);
    if (!result.changed) return { ok: false, changed: false };
    return this.setPeasantNotableCombats(combats, options);
  }

  async setPeasantNotableCombatType(index, rawType, { render } = {}) {
    const type = String(rawType ?? "skill").trim() || "skill";
    const combats = this.getPeasantNotableCombatsForUpdate();
    const combat = this.ensurePeasantNotableCombatAt(combats, index);
    if (!combat) return { ok: false, changed: false };

    const fixedType = getFixedSkillTypeValue(type);
    if (fixedType && !isSkillProgressionType(fixedType)) {
      const category = ["martial", "magic"].find(value =>
        getSkillTypeOptionsForCategory(value, { currentType: fixedType }).some(option => option.value === fixedType));
      if (category) combat.category = category;
    }

    if (isSkillProgressionType(type)) {
      combat.type = type;
      combat.class = combat.class || 1;
      combat.rank = combat.rank !== undefined ? String(combat.rank) : "0";
      combat.usesMax = combat.usesMax || 0;
      combat.usesCurrent = combat.usesCurrent || 0;
    } else {
      combat.type = type;
    }

    return this.setPeasantNotableCombats(combats, { render });
  }

  async changePeasantNotableCombatIndent(index, delta, { includeHidden = true, ...options } = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const combatIndex = Number.parseInt(index, 10);
    const combat = combats[combatIndex];
    if (!combat || typeof combat !== "object") return { ok: false, changed: false };
    const rows = getNotableCombatTreeRows(combats, { includeHidden });
    const rowIndex = rows.findIndex(row => row.index === combatIndex);
    if (rowIndex < 0) return { ok: false, changed: false };
    const maxDepth = (rows[rowIndex - 1]?.depth ?? -1) + 1;
    const depth = Math.min(maxDepth, Math.max(0, rows[rowIndex].depth + (Number.parseInt(delta, 10) || 0)));
    if (combat.indent === depth) return { ok: true, changed: false };
    combat.indent = depth;
    return this.setPeasantNotableCombats(combats, options);
  }

  async setPeasantNotableCombatMainFields(index, fields = {}, options = {}) {
    return this.setPeasantEntryMainFields("notableCombats", index, fields, options);
  }

  async setPeasantEntryMainFields(collection, index, fields = {}, options = {}) {
    if (!PEASANT_ENTRY_COLLECTIONS.has(collection)) return { ok: false, changed: false };
    const combats = collection === "skills" ? this.getPeasantSkillsForUpdate() : this.getPeasantNotableCombatsForUpdate();
    const combat = combats[Number.parseInt(index, 10)];
    if (!combat) return { ok: false, changed: false };
    const patch = {};
    if ("class" in fields) patch.class = Number.parseInt(fields.class, 10) || 1;
    if ("rank" in fields) {
      const rankRaw = String(fields.rank ?? "").trim();
      patch.rank = rankRaw.toLowerCase() === "u" ? rankRaw : (Number.parseInt(rankRaw, 10) || 0);
    }
    if ("name" in fields) patch.name = String(fields.name ?? "");
    if (collection === "skills") {
      if ("ap" in fields) patch.ap = parseOptionalInteger(fields.ap, { min: 0 });
      if ("sp" in fields) patch.sp = parseOptionalInteger(fields.sp, { min: 0 });
    }
    if ("specialGrade" in fields) patch.specialGrade = Math.max(0, Number.parseInt(fields.specialGrade, 10) || 0);
    Object.assign(combat, patch);

    if ("tohit" in fields || "accuracy" in fields) {
      const usageId = combat.defaultUsageId || "base";
      const usage = usageId === "base" ? null : combat.usages?.find(candidate => candidate.id === usageId);
      if (usageId !== "base" && !usage) return { ok: false, changed: false };
      const rollTarget = usage ? (usage.rollOverrides ??= {}) : combat;
      if ("tohit" in fields) rollTarget.tohit = parseOptionalInteger(fields.tohit, { min: 1 });
      if ("accuracy" in fields) rollTarget.accuracy = parseOptionalInteger(fields.accuracy, { allowSign: true });
    }
    return collection === "skills" ? this.setPeasantSkills(combats, options) : this.setPeasantNotableCombats(combats, options);
  }

  async setPeasantNotableCombatUsesMax(index, rawValue, options = {}) {
    await this.ensurePeasantEntryIds("notableCombats");
    const combat = getActorSourceSystem(this)?.notableCombats?.[Number.parseInt(index, 10)];
    if (!combat?.id) return { ok: false, changed: false };
    const result = await this.setPeasantEntryUses({ collection: "notableCombats", entryId: combat.id }, { max: rawValue });
    return { ...result, combats: getActorSourceSystem(this)?.notableCombats ?? [] };
  }

  async setPeasantNotableCombatUsesCurrent(index, rawValue, options = {}) {
    await this.ensurePeasantEntryIds("notableCombats");
    const combat = getActorSourceSystem(this)?.notableCombats?.[Number.parseInt(index, 10)];
    if (!combat?.id) return { ok: false, changed: false };
    const result = await this.setPeasantEntryUses({ collection: "notableCombats", entryId: combat.id }, { current: rawValue });
    return { ...result, combats: getActorSourceSystem(this)?.notableCombats ?? [] };
  }

  async setPeasantNotableCombatSectionsCurrent(index, rawValue, options = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const combat = this.ensurePeasantNotableCombatAt(combats, index);
    if (!combat) return { ok: false, changed: false };
    const max = Number.parseInt(combat.sections?.max, 10) || 0;
    combat.sections = combat.sections || { current: 0, max };
    combat.sections.current = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    return this.setPeasantNotableCombats(combats, options);
  }

  async setPeasantNotableCombatSplitSecondCurrent(index, rawValue, options = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const combat = this.ensurePeasantNotableCombatAt(combats, index);
    if (!combat) return { ok: false, changed: false };
    const max = Number.parseInt(combat.speed?.splitSecondMax, 10) || 0;
    combat.speed = combat.speed || { type: "", splitSecondCurrent: 0, splitSecondMax: max };
    combat.speed.splitSecondCurrent = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    return this.setPeasantNotableCombats(combats, options);
  }

  async setPeasantNotableCombatTagUsesCurrent(index, rawValue, options = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0 || numericIndex >= combats.length || !combats[numericIndex].tagUses) {
      return { ok: false, changed: false };
    }
    combats[numericIndex].tagUses.current = Math.max(0, Number.parseInt(rawValue, 10) || 0);
    return this.setPeasantNotableCombats(combats, options);
  }

  async reorderPeasantNotableCombatCustomTag(index, fromCustomIndex, toCustomIndex, { insertAfter = false, render, collection = "notableCombats", usageId = "base" } = {}) {
    if (!PEASANT_ENTRY_COLLECTIONS.has(collection)) return { ok: false, changed: false };
    const combats = collection === "skills" ? this.getPeasantSkillsForUpdate() : this.getPeasantNotableCombatsForUpdate();
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0 || numericIndex >= combats.length) return { ok: false, changed: false };
    const entry = combats[numericIndex];
    const combat = usageId === "base" ? entry : entry.usages?.find(usage => usage.id === usageId)?.mechanics;
    const from = Number.parseInt(fromCustomIndex, 10);
    let to = Number.parseInt(toCustomIndex, 10);
    if (!combat || !Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, changed: false };

    const customTags = getCombatCustomTags(combat);
    if (customTags.length <= 1 || from < 0 || from >= customTags.length || to < 0 || to >= customTags.length) {
      return { ok: false, changed: false };
    }

    if (insertAfter) to += 1;
    if (from < to) to -= 1;
    to = Math.max(0, Math.min(customTags.length - 1, to));

    const [moved] = customTags.splice(from, 1);
    customTags.splice(to, 0, moved);
    combat.customTags = customTags;
    syncCombatCustomTags(combat);
    return collection === "skills" ? this.setPeasantSkills(combats, { render }) : this.setPeasantNotableCombats(combats, { render });
  }

  async reorderPeasantNotableCombatTag(index, draggedType, targetType, { insertAfter = false, render, collection = "notableCombats", usageId = "base" } = {}) {
    if (!PEASANT_ENTRY_COLLECTIONS.has(collection)) return { ok: false, changed: false };
    const combats = collection === "skills" ? this.getPeasantSkillsForUpdate() : this.getPeasantNotableCombatsForUpdate();
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0 || numericIndex >= combats.length) return { ok: false, changed: false };
    const entry = combats[numericIndex];
    const combat = usageId === "base" ? entry : entry.usages?.find(usage => usage.id === usageId)?.mechanics;
    const dragged = String(draggedType ?? "").trim();
    const target = String(targetType ?? "").trim();
    if (!combat || !dragged || !target || dragged === target) return { ok: false, changed: false };

    const fullDefaultOrder = [...COMBAT_FULL_TAG_ORDER];
    const currentOrder = (Array.isArray(combat.tagOrder) && combat.tagOrder.length > 0)
      ? [...combat.tagOrder]
      : [...fullDefaultOrder];

    for (const tagType of fullDefaultOrder) {
      if (!currentOrder.includes(tagType)) currentOrder.push(tagType);
    }

    const draggedIndex = currentOrder.indexOf(dragged);
    if (draggedIndex > -1) currentOrder.splice(draggedIndex, 1);

    let targetIndex = currentOrder.indexOf(target);
    if (targetIndex === -1) targetIndex = currentOrder.length;
    if (insertAfter) targetIndex += 1;

    currentOrder.splice(targetIndex, 0, dragged);
    combat.tagOrder = currentOrder;
    return collection === "skills" ? this.setPeasantSkills(combats, { render }) : this.setPeasantNotableCombats(combats, { render });
  }

  async removePeasantNotableCombatTag(index, rawTagType, { customIndex = null, render } = {}) {
    await this.ensurePeasantEntryIds("notableCombats");
    const combat = getActorSourceSystem(this)?.notableCombats?.[Number.parseInt(index, 10)];
    if (!combat?.id) return { ok: false, changed: false };
    const customId = rawTagType === "custom"
      ? getCombatCustomTags(combat)[Number.parseInt(customIndex, 10)]?.id ?? null
      : null;
    const result = await this.setPeasantEntryTag(
      { collection: "notableCombats", entryId: combat.id },
      rawTagType,
      {},
      { mode: "remove", customId, render }
    );
    return { ...result, combats: getActorSourceSystem(this)?.notableCombats ?? [] };
  }
  async setPeasantNotableCombatTag(index, rawTagType, data = {}, { mode = "add", customIndex = null, render } = {}) {
    await this.ensurePeasantEntryIds("notableCombats");
    const combat = getActorSourceSystem(this)?.notableCombats?.[Number.parseInt(index, 10)];
    if (!combat?.id) return { ok: false, changed: false };
    const customId = rawTagType === "custom" && mode === "edit"
      ? getCombatCustomTags(combat)[Number.parseInt(customIndex, 10)]?.id ?? null
      : null;
    const result = await this.setPeasantEntryTag(
      { collection: "notableCombats", entryId: combat.id },
      rawTagType,
      data,
      { mode, customId, render }
    );
    return { ...result, combats: getActorSourceSystem(this)?.notableCombats ?? [] };
  }
  async setPeasantNotableCombatDescription(index, description, options = {}) {
    return this.updatePeasantNotableCombat(index, { description: String(description ?? "") }, options);
  }

  async setPeasantNotableCombatImage(index, img, options = {}) {
    return this.updatePeasantNotableCombat(index, { img: String(img ?? "") }, options);
  }

  getPeasantResourceName(rawName) {
    const name = String(rawName ?? "").trim();
    return PeasantActor.RESOURCE_NAMES.includes(name) ? name : "";
  }

  getPeasantFallBlessingUseCapacity(edgeMax = this.system?.edge?.max) {
    const maxEdge = clampPeasantInteger(edgeMax, { min: 0 });
    return Math.max(1, Math.floor(maxEdge / 2));
  }

  async setPeasantFallBlessingUses(rawUses = {}, options = {}) {
    const uses = this.system?.fallBlessingUses || { value: 0, max: 1 };
    const max = clampPeasantInteger(rawUses.max ?? uses.max ?? 1, { min: 0 });
    const value = Math.min(clampPeasantInteger(rawUses.value ?? uses.value ?? 0, { min: 0 }), max);
    await this.updatePeasantStateData({
      "system.fallBlessingUses.value": value,
      "system.fallBlessingUses.max": max
    }, options);
    return { ok: true, changed: true, value, max };
  }

  async spendPeasantFallBlessingUses(rawCount) {
    const count = Number(rawCount);
    const current = clampPeasantInteger(this.system?.fallBlessingUses?.value, { min: 0 });
    const max = clampPeasantInteger(this.system?.fallBlessingUses?.max ?? 1, { min: 0 });
    if (this.system?.blessing?.type !== "fall" || !Number.isSafeInteger(count) || count < 1 || count > current) {
      return { ok: false, changed: false, value: current, max };
    }

    const value = current - count;
    await this.updatePeasantStateData({ "system.fallBlessingUses.value": value });
    return { ok: true, changed: true, value, max, spent: count };
  }

  async setPeasantResourceMax(rawName, rawMax, { fillOnlyWhenEmpty = false } = {}) {
    const resourceName = this.getPeasantResourceName(rawName);
    if (!resourceName) return { ok: false, message: "Unknown resource." };

    const max = Math.max(0, Number.parseInt(rawMax, 10) || 0);
    const currentValue = Math.max(0, Number(this.system?.[resourceName]?.value) || 0);
    if (fillOnlyWhenEmpty && currentValue > 0) return { ok: true, changed: false, value: currentValue, max };

    const nextValue = currentValue <= 0 ? max : Math.min(currentValue, max);
    await this.updatePeasantSourceData({
      [`system.${resourceName}.value`]: nextValue,
      [`system.${resourceName}.max`]: max
    });
    return { ok: true, changed: true, value: nextValue, max };
  }

  async setPeasantResourceValue(rawName, rawValue) {
    const resourceName = this.getPeasantResourceName(rawName);
    if (!resourceName) return { ok: false, message: "Unknown resource." };

    const max = Math.max(0, Number(this.system?.[resourceName]?.max) || 0);
    const value = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    await this.updatePeasantStateData({ [`system.${resourceName}.value`]: value });
    return { ok: true, changed: true, value, max };
  }

  async refreshPeasantResource(rawName) {
    const resourceName = this.getPeasantResourceName(rawName);
    if (!resourceName) return { ok: false, message: "Unknown resource." };

    const max = Math.max(0, Number(this.system?.[resourceName]?.max) || 0);
    await this.updatePeasantStateData({ [`system.${resourceName}.value`]: max });
    return { ok: true, changed: true, value: max, max };
  }

  async setPeasantBolsteredHp(rawValue) {
    const max = getActorBolsteredMax(this);
    const value = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    await this.updatePeasantStateData({ "system.bolsteredHp": value });
    return { ok: true, changed: true, value, max };
  }

  async setPeasantTemporaryHpValue(rawValue, { expandMax = false } = {}) {
    const requested = Math.max(0, Number.parseInt(rawValue, 10) || 0);
    const currentMax = Math.max(0, Number(this.system?.temporaryHp?.max) || 0);
    const max = expandMax ? Math.max(currentMax, requested) : currentMax;
    const value = Math.min(requested, max);
    const update = { "system.temporaryHp.value": value };
    if (expandMax) update["system.temporaryHp.max"] = max;
    await this.updatePeasantStateData(update);
    return { ok: true, changed: true, value, max };
  }

  async setPeasantSimplifiedHealthMax(rawMax) {
    if (!isSimplifiedHpActor(this)) return { ok: false, message: "Actor does not use simplified HP." };

    const max = Math.max(1, Number.parseInt(rawMax, 10) || 1);
    const currentValue = Math.max(0, Number(this.system?.health?.value) || 0);
    const value = Math.min(currentValue, max);
    const currentTemp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);
    const tempMax = Math.max(0, max - value);
    const bolstered = Math.max(0, Number(this.system?.bolsteredHp) || 0);

    await this.updatePeasantSourceData({
      "system.health.max": max,
      "system.health.value": value,
      "system.temporaryHp.max": tempMax,
      "system.temporaryHp.value": Math.min(currentTemp, tempMax),
      "system.bolsteredHp": Math.min(bolstered, max)
    });
    return { ok: true, changed: true, value, max, tempMax };
  }

  async setPeasantSimplifiedHealthValue(rawValue) {
    if (!isSimplifiedHpActor(this)) return { ok: false, message: "Actor does not use simplified HP." };

    const max = getActorHealthMax(this);
    const value = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    const currentTemp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);
    const tempMax = Math.max(0, max - value);
    await this.updatePeasantStateData({
      "system.health.value": value,
      "system.temporaryHp.max": tempMax,
      "system.temporaryHp.value": Math.min(currentTemp, tempMax)
    });
    return { ok: true, changed: true, value, max, tempMax };
  }

  async updatePeasantHpGrid(grid, rows, cols, { persistDimensions = true } = {}) {
    if (isSimplifiedHpActor(this)) return { ok: false, message: "Actor uses simplified HP." };

    const safeRows = normalizePeasantHpDimension(rows);
    const safeCols = normalizePeasantHpDimension(cols);
    const safeGrid = normalizePeasantHpGrid(grid, safeRows, safeCols);

    const totalCells = safeRows * safeCols;
    const regularCells = countPeasantRegularHpCellsInDimensions(safeGrid, safeRows, safeCols);

    const tempMax = Math.max(0, totalCells - regularCells);
    const currentTemp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);

    const updateData = {
      "system.hp.grid": safeGrid.map(row => [...row]),
      "system.health.value": regularCells,
      "system.health.max": totalCells,
      "system.temporaryHp.value": Math.min(currentTemp, tempMax),
      "system.temporaryHp.max": tempMax
    };

    if (persistDimensions) {
      updateData["system.hp.rows"] = safeRows;
      updateData["system.hp.cols"] = safeCols;
    }

    if (persistDimensions) await this.updatePeasantSourceData(updateData);
    else await this.updatePeasantStateData(updateData);

    return { ok: true, changed: true, rows: safeRows, cols: safeCols, grid: safeGrid, value: regularCells, max: totalCells, tempMax };
  }

  async resizePeasantHpGrid(rowDelta = 0, colDelta = 0) {
    const hp = getPeasantActorSourceHp(this);
    const { rows: currentRows, cols: currentCols } = getPeasantHpDimensions(hp);
    const rows = Math.max(1, currentRows + (Number(rowDelta) || 0));
    const cols = Math.max(1, currentCols + (Number(colDelta) || 0));
    const sourceGrid = Array.isArray(hp.grid) ? hp.grid : [];
    const grid = normalizePeasantHpGrid(sourceGrid, rows, cols);

    return this.updatePeasantHpGrid(grid, rows, cols);
  }

  async setPeasantHpGridCell(row, col, rawValue) {
    const hp = this.system?.hp ?? {};
    const { rows, cols } = getPeasantHpDimensions(hp);
    const numericRow = Number.parseInt(row, 10);
    const numericCol = Number.parseInt(col, 10);
    if (!Number.isFinite(numericRow) || !Number.isFinite(numericCol)) return { ok: false, changed: false };
    if (numericRow < 0 || numericCol < 0 || numericRow >= rows || numericCol >= cols) return { ok: false, changed: false };

    const sourceHp = getPeasantActorSourceHp(this);
    const sourceGrid = Array.isArray(sourceHp.grid) ? sourceHp.grid : (Array.isArray(hp.grid) ? hp.grid : []);
    const grid = normalizePeasantHpGrid(sourceGrid, rows, cols);
    grid[numericRow][numericCol] = Math.max(0, Math.min(3, Number(rawValue) || 0));

    return this.updatePeasantHpGrid(grid, rows, cols, { persistDimensions: false });
  }

  async cyclePeasantHpGridCell(row, col) {
    const numericRow = Number.parseInt(row, 10);
    const numericCol = Number.parseInt(col, 10);
    if (!Number.isFinite(numericRow) || !Number.isFinite(numericCol)) return { ok: false, changed: false };

    const current = Number(this.system?.hp?.grid?.[numericRow]?.[numericCol]) || 0;
    return this.setPeasantHpGridCell(numericRow, numericCol, (current + 1) % 4);
  }

  getPeasantStressType(rawType) {
    const type = String(rawType ?? "").trim().toLowerCase();
    return PeasantActor.STRESS_TYPES.includes(type) ? type : "physical";
  }

  async setPeasantStressGridSize(rawType, rawCount = 0) {
    const type = this.getPeasantStressType(rawType);
    const countField = `${type}StressCount`;
    const sourceSystem = getActorSourceSystem(this);
    const currentCount = Math.max(0, Number(sourceSystem?.[countField]) || 0);
    const count = Math.max(0, Number.parseInt(rawCount, 10) || 0);
    const updateData = { [`system.${countField}`]: count };

    for (let index = currentCount; index < count; index++) {
      if (sourceSystem?.[`${type}${index}`] === undefined) {
        updateData[`system.${type}${index}`] = 0;
      }
    }

    await this.updatePeasantSourceData(updateData);
    return { ok: true, changed: true, type, count };
  }

  async resizePeasantStressGrid(rawType, delta = 0) {
    const type = this.getPeasantStressType(rawType);
    const countField = `${type}StressCount`;
    const currentCount = Math.max(0, Number(getActorSourceSystem(this)?.[countField]) || 0);
    return this.setPeasantStressGridSize(type, currentCount + (Number(delta) || 0));
  }

  async setPeasantStressCell(rawType, rawIndex, rawValue) {
    const type = this.getPeasantStressType(rawType);
    const index = Number.parseInt(rawIndex, 10);
    const count = Math.max(0, Number(this.system?.[`${type}StressCount`]) || 0);
    if (!Number.isFinite(index) || index < 0 || index >= count) return { ok: false, changed: false };

    const value = Math.max(0, Math.min(3, Number(rawValue) || 0));
    await this.updatePeasantStateData({ [`system.${type}${index}`]: value });
    return { ok: true, changed: true, type, index, value };
  }

  async cyclePeasantStressCell(rawType, rawIndex) {
    const type = this.getPeasantStressType(rawType);
    const index = Number.parseInt(rawIndex, 10);
    if (!Number.isFinite(index)) return { ok: false, changed: false };

    const current = Number(this.system?.[`${type}${index}`]) || 0;
    return this.setPeasantStressCell(type, index, (current + 1) % 4);
  }

  async refreshPeasantStressTrack(rawType) {
    const type = this.getPeasantStressType(rawType);
    const count = Math.max(0, Number(this.system?.[`${type}StressCount`]) || 0);
    const updateData = {};
    for (let index = 0; index < count; index++) updateData[`system.${type}${index}`] = 0;
    if (Object.keys(updateData).length) await this.updatePeasantStateData(updateData);
    return { ok: true, changed: Object.keys(updateData).length > 0, type, count };
  }

  async applyPeasantStressDamage(rawType, amount = 1) {
    const type = this.getPeasantStressType(rawType);
    const stressAmount = Math.max(0, Number(amount) || 0);
    if (stressAmount <= 0) return { ok: false, changed: false, type, overflow: 0 };

    const overflow = await applyCombatStressDamageForActor(this, type, stressAmount);
    return { ok: overflow <= 0, changed: overflow < stressAmount, type, overflow };
  }

  async applyPeasantStressHeal(rawType, amount = 1) {
    const type = this.getPeasantStressType(rawType);
    let remaining = Math.max(0, Number(amount) || 0);
    if (remaining <= 0) return { ok: false, changed: false, type };

    const count = Math.max(0, Number(this.system?.[`${type}StressCount`]) || 0);
    const states = Array.from({ length: count }, (_, index) => {
      const current = Number(this.system?.[`${type}${index}`]) || 0;
      return Math.max(0, Math.min(3, current));
    });

    for (const target of [3, 2, 1]) {
      for (let index = states.length - 1; index >= 0 && remaining > 0; index--) {
        if (states[index] !== target) continue;
        states[index] = target - 1;
        remaining--;
      }
    }

    const updates = {};
    states.forEach((value, index) => {
      updates[`system.${type}${index}`] = value;
    });
    if (Object.keys(updates).length) await this.updatePeasantStateData(updates);
    return { ok: true, changed: Object.keys(updates).length > 0, type, remaining };
  }

  addPeasantResourceRefreshUpdates(updateData, resourceNames) {
    for (const resourceName of resourceNames) {
      const maxValue = Math.max(0, Number(this.system?.[resourceName]?.max) || 0);
      updateData[`system.${resourceName}.value`] = maxValue;
    }
    return updateData;
  }

  addPeasantStressClearUpdates(updateData, stressTypes) {
    for (const stressType of stressTypes) {
      const count = Math.max(0, Number(this.system?.[`${stressType}StressCount`]) || 0);
      for (let index = 0; index < count; index++) {
        updateData[`system.${stressType}${index}`] = 0;
      }
    }
    return updateData;
  }

  addPeasantStressRecoveryUpdates(updateData, stressType, amount) {
    let remaining = Math.max(0, Number(amount) || 0);
    const count = Math.max(0, Number(this.system?.[`${stressType}StressCount`]) || 0);
    const state = Array.from({ length: count }, (_, index) => {
      const field = `${stressType}${index}`;
      const current = Number(updateData[`system.${field}`] ?? this.system?.[field]) || 0;
      return { field, current: Math.max(0, Math.min(3, current)) };
    });

    for (let value = 3; value >= 1 && remaining > 0; value--) {
      for (let index = state.length - 1; index >= 0 && remaining > 0; index--) {
        const cell = state[index];
        while (cell.current >= value && cell.current > 0 && remaining > 0) {
          cell.current -= 1;
          updateData[`system.${cell.field}`] = cell.current;
          remaining -= 1;
        }
      }
    }

    return updateData;
  }

  countPeasantRegularHpCells(grid, rows = null, cols = null) {
    if (Number.isFinite(rows) && Number.isFinite(cols)) {
      return countPeasantRegularHpCellsInDimensions(grid, Math.max(0, Math.floor(rows)), Math.max(0, Math.floor(cols)));
    }

    let regularCells = 0;
    for (const row of grid) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) if ((Number(cell) || 0) === 0) regularCells++;
    }
    return regularCells;
  }

  addPeasantLongRestHpRecoveryUpdates(updateData, { naturalHealing = true } = {}) {
    const summer = this.system?.blessing?.type === "summer";
    if (isSimplifiedHpActor(this)) {
      const maxHealth = Math.max(0, Number(this.system?.health?.max) || getActorHealthMax(this) || 0);
      const currentHealth = Math.max(0, Math.min(Number(this.system?.health?.value) || 0, maxHealth));
      const missingHealth = Math.max(0, maxHealth - currentHealth);
      const healed = naturalHealing ? Math.min(summer ? 4 : 2, missingHealth) : 0;
      const nextHealth = currentHealth + healed;
      const tempMax = Math.max(0, maxHealth - nextHealth);

      updateData["system.health.max"] = maxHealth;
      if (naturalHealing) updateData["system.health.value"] = nextHealth;
      updateData["system.temporaryHp.max"] = tempMax;
      updateData["system.temporaryHp.value"] = tempMax;
      return updateData;
    }

    const hp = this.system?.hp;
    const rows = Math.max(0, Number(hp?.rows) || 0);
    const cols = Math.max(0, Number(hp?.cols) || 0);
    const sourceGrid = Array.isArray(hp?.grid) ? hp.grid : [];
    const grid = Array.from({ length: rows }, (_, rowIndex) => {
      const row = Array.isArray(sourceGrid[rowIndex]) ? sourceGrid[rowIndex] : [];
      return Array.from({ length: cols }, (_, colIndex) => Math.max(0, Math.min(3, Number(row[colIndex]) || 0)));
    });

    const healCells = (targetValue, amount) => {
      let remaining = amount;
      for (let rowIndex = rows - 1; rowIndex >= 0 && remaining > 0; rowIndex--) {
        for (let colIndex = cols - 1; colIndex >= 0 && remaining > 0; colIndex--) {
          if (grid[rowIndex][colIndex] !== targetValue) continue;
          grid[rowIndex][colIndex] = 0;
          remaining -= 1;
        }
      }
      return amount - remaining;
    };

    const hasBlunt = grid.some(row => row.some(cell => cell === 1));
    const hasLethal = grid.some(row => row.some(cell => cell === 2));
    if (naturalHealing) {
      if (hasBlunt) healCells(1, summer ? 4 : 2);
      else if (hasLethal) healCells(2, summer ? 2 : 1);
      else if (summer) healCells(3, 1);
    }

    const totalCells = rows * cols;
    const regularCells = this.countPeasantRegularHpCells(grid, rows, cols);
    const tempMax = Math.max(0, totalCells - regularCells);

    updateData["system.health.max"] = totalCells;
    if (naturalHealing) {
      updateData["system.hp.grid"] = grid.map(row => [...row]);
      updateData["system.health.value"] = regularCells;
    }
    updateData["system.temporaryHp.max"] = tempMax;
    updateData["system.temporaryHp.value"] = tempMax;
    return updateData;
  }

  async performPeasantShortRest() {
    const updateData = {};
    this.addPeasantResourceRefreshUpdates(updateData, ["stamina", "attunement"]);
    this.addPeasantStressClearUpdates(updateData, ["physical", "mental"]);

    await this.updatePeasantStateData(updateData);
    return { ok: true, changed: true };
  }

  async performPeasantLongRest() {
    const overchargedBefore = this.system?.conditions?.overcharged === true;
    const updateData = {};
    this.addPeasantResourceRefreshUpdates(updateData, ["stamina", "attunement", "capacity"]);
    this.addPeasantStressClearUpdates(updateData, ["physical", "mental"]);
    this.addPeasantLongRestHpRecoveryUpdates(updateData, { naturalHealing: !overchargedBefore });
    if (overchargedBefore) updateData["system.conditions.overcharged"] = false;
    else this.addPeasantStressRecoveryUpdates(updateData, "general", 3);
    if (this.system?.blessing?.type === "fall") {
      updateData["system.fallBlessingUses.value"] = clampPeasantInteger(this.system?.fallBlessingUses?.max ?? 1, { min: 0 });
    }

    const healthValue = Number(updateData["system.health.value"] ?? this.system?.health?.value) || 0;
    const healthMax = Number(updateData["system.health.max"] ?? this.system?.health?.max) || 0;
    const generalStressCount = Math.max(0, Math.floor(Number(this.system?.generalStressCount) || 0));
    const generalStressRemaining = Array.from({ length: generalStressCount }, (_, index) => (
      Number(updateData[`system.general${index}`] ?? this.system?.[`general${index}`]) || 0
    )).some(value => value > 0);
    const woundsRecovered = !isSimplifiedHpActor(this)
      && healthMax > 0
      && healthValue >= healthMax
      && !generalStressRemaining;
    if (woundsRecovered) {
      updateData["system.conditions.wounded"] = false;
      updateData["system.devastatingWounds"] = 0;
    }

    await this.updatePeasantStateData(updateData);
    await removeOverchargedEffects(this);
    return { ok: true, changed: true };
  }

  async refreshPeasantResourcesAndResetTracks() {
    const updateData = {};

    this.addPeasantResourceRefreshUpdates(updateData, ["stamina", "attunement", "capacity"]);
    this.addPeasantStressClearUpdates(updateData, ["physical", "mental", "general"]);

    updateData["system.conditions.wounded"] = false;
    updateData["system.devastatingWounds"] = 0;
    for (const key of ["head", "rightArm", "leftArm", "rightLeg", "leftLeg", "torso", "arms", "legs"]) {
      updateData[`system.conditions.${key}`] = "";
    }

    if (isSimplifiedHpActor(this)) {
      const maxHp = Math.max(0, Number(this.system?.health?.max) || getActorHealthMax(this) || 0);
      updateData["system.health.max"] = maxHp;
      updateData["system.health.value"] = maxHp;
    } else {
      const rows = Math.max(0, Number(this.system?.hp?.rows) || 0);
      const cols = Math.max(0, Number(this.system?.hp?.cols) || 0);
      const totalCells = rows * cols;
      const cleanGrid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
      updateData["system.hp.grid"] = cleanGrid;
      updateData["system.health.value"] = totalCells;
      updateData["system.health.max"] = totalCells;
    }

    updateData["system.temporaryHp.value"] = 0;
    updateData["system.temporaryHp.max"] = 0;

    await this.updatePeasantStateData(updateData);
    return { ok: true, changed: true };
  }

  getPeasantConditionKey(rawKey) {
    const key = String(rawKey ?? "").trim();
    return PeasantActor.CONDITION_KEYS.includes(key) ? key : "";
  }

  async adjustPeasantDevastatingWounds(delta, options = {}) {
    const amount = Number(delta);
    const before = getDevastatingWoundCount(this);
    if (!Number.isSafeInteger(amount)) return { ok: false, changed: false, value: before };

    const value = Math.max(0, before + amount);
    if (value === before) return { ok: true, changed: false, value };
    await this.updatePeasantStateData({ "system.devastatingWounds": value }, options);
    return { ok: true, changed: true, value };
  }

  hasPeasantConditions() {
    const conditions = this.system?.conditions || {};
    return PeasantActor.CONDITION_KEYS.some((key) => {
      if (key === "wounded") return !!conditions.wounded;
      return !!conditions[key];
    });
  }

  async clearPeasantCondition(rawKey) {
    const key = this.getPeasantConditionKey(rawKey);
    if (!key) return { ok: false, changed: false };

    const update = key === "wounded"
      ? { "system.conditions.wounded": false }
      : { [`system.conditions.${key}`]: "" };
    await this.updatePeasantStateData(update);
    return { ok: true, changed: true, hasConditions: this.hasPeasantConditions() };
  }

  async addPeasantWound(rawWoundType) {
    const woundType = String(rawWoundType ?? "").trim();
    if (woundType === "wounded") {
      await this.updatePeasantStateData({ "system.conditions.wounded": true });
      return { ok: true, changed: true, hasConditions: true };
    }
    if (woundType === "devastatingly-wounded") {
      return this.adjustPeasantDevastatingWounds(1);
    }

    const [rawStatus, rawLocation] = woundType.split(":");
    const status = String(rawStatus ?? "").trim();
    const location = this.getPeasantConditionKey(rawLocation);
    if (!PeasantActor.WOUND_STATUSES.includes(status) || !location || location === "wounded") {
      return { ok: false, changed: false };
    }

    await this.updatePeasantStateData({ [`system.conditions.${location}`]: status });
    return { ok: true, changed: true, hasConditions: true, location, status };
  }

  async resetPeasantConditions() {
    const update = { "system.conditions.wounded": false };
    for (const key of PeasantActor.CONDITION_KEYS) {
      if (key !== "wounded") update[`system.conditions.${key}`] = "";
    }
    await this.updatePeasantStateData(update);
    return { ok: true, changed: true };
  }

  async setPeasantBlessing(rawType) {
    const type = String(rawType ?? "").trim().toLowerCase();
    const safeType = PeasantActor.BLESSING_TYPES.includes(type) ? type : "";

    const blessing = { type: safeType };
    await this.updatePeasantStateData({ "system.blessing": blessing });
    return { ok: true, changed: true, blessing };
  }

  async clearPeasantBlessing() {
    return this.setPeasantBlessing("");
  }

  getPeasantToHitPenaltyTarget(rawTarget) {
    const target = String(rawTarget ?? "").trim();
    return PeasantActor.TO_HIT_PENALTY_TARGETS.includes(target) ? target : "";
  }

  async setPeasantToHitPenaltyTarget(rawTarget) {
    const target = this.getPeasantToHitPenaltyTarget(rawTarget);
    try {
      this.system.toHitPenaltyTarget = target;
    } catch (e) {
      // Ignore local model write failures; update below remains authoritative.
    }
    await this.updatePeasantStateData({ "system.toHitPenaltyTarget": target });
    return { ok: true, changed: true, target };
  }

  async togglePeasantToHitPenaltyTarget(rawTarget) {
    const target = this.getPeasantToHitPenaltyTarget(rawTarget);
    const current = this.getPeasantToHitPenaltyTarget(this.system?.toHitPenaltyTarget);
    return this.setPeasantToHitPenaltyTarget(current === target ? "" : target);
  }

  async setPeasantReflexAoeSave(enabled, rawTarget = "", options = {}) {
    const isEnabled = !!enabled;
    const effectiveTarget = isEnabled ? parseOptionalInteger(rawTarget, { min: 1 }) : null;
    const target = effectiveTarget === null
      ? null
      : removeEquippedArmorAoeSaveModifier(effectiveTarget, getEquippedArmorEffects(this));
    await this.updatePeasantSourceData({
      "system.reflexAoeSaveEnabled": isEnabled,
      "system.reflexAoeSaveTarget": target
    }, options);
    return { ok: true, changed: true, enabled: isEnabled, target };
  }

  async togglePeasantHardLocation(rawLocation, rawType = "halt") {
    const location = String(rawLocation ?? "").trim();
    if (!PeasantActor.HARD_LOCATION_NAMES.includes(location)) return { ok: false, changed: false };

    const field = String(rawType ?? "").trim() === "natural"
      ? `naturalHard${location}`
      : `hard${location}`;
    const value = !this.system?.[field];
    await this.updatePeasantSourceData({ [`system.${field}`]: value });
    return { ok: true, changed: true, field, value };
  }

  async setPeasantMovement(rawValue) {
    const equippedArmor = getEquippedArmorEffects(this);
    const sourceMovement = Math.max(0, Number.parseInt(getActorSourceValue(this, "system.movement"), 10) || 0);
    const requestedMovement = Math.max(0, Number.parseInt(rawValue, 10) || 0);
    const movement = requestedMovement === getArmorAdjustedMovement(sourceMovement, equippedArmor)
      ? sourceMovement
      : removeEquippedArmorMovement(requestedMovement, equippedArmor);
    await this.updatePeasantSourceData({ "system.movement": movement });
    return { ok: true, changed: true, movement };
  }

  async setPeasantInitiative(rawValue, options = {}) {
    const initiative = parseOptionalInteger(rawValue, { allowSign: true });
    await this.updatePeasantSourceData({ "system.initiative": initiative }, options);
    return { ok: true, changed: true, initiative };
  }

  async setPeasantHaltValues(rawValues, { natural = false, render } = {}) {
    const field = natural ? "naturalHaltValues" : "haltValues";
    const values = natural
      ? normalizeHaltValues(rawValues)
      : removeEquippedArmorHalt(rawValues, getEquippedArmorEffects(this));
    await this.updatePeasantSourceData({ [`system.${field}`]: values }, { render });
    return { ok: true, changed: true, field, values };
  }

  async applyPeasantSimplifiedHpDefaults() {
    if (this?.type && !isPeasantCharacterType(this.type)) return { ok: false, changed: false };

    const rows = Number(this.system?.hp?.rows) || 0;
    const cols = Number(this.system?.hp?.cols) || 0;
    const fallbackMax = rows * cols;
    const currentMaxRaw = Number(this.system?.health?.max);
    const max = Number.isFinite(currentMaxRaw) && currentMaxRaw > 0 ? currentMaxRaw : fallbackMax;
    const value = max;
    const currentTemp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);
    const tempMax = Math.max(0, max - value);
    const tempValue = Math.min(currentTemp, tempMax);
    const bolstered = Math.max(0, Math.min(Number(this.system?.bolsteredHp) || 0, max));
    const conditionUpdates = { "system.conditions.wounded": false };
    for (const key of PeasantActor.CONDITION_KEYS) {
      if (key !== "wounded") conditionUpdates[`system.conditions.${key}`] = "";
    }

    await this.updatePeasantSourceData({
      "system.health.value": value,
      "system.health.max": max,
      "system.temporaryHp.value": tempValue,
      "system.temporaryHp.max": tempMax,
      "system.bolsteredHp": bolstered,
      ...conditionUpdates
    });

    return { ok: true, changed: true, value, max, tempMax };
  }

  getPeasantCombatHaltBuffsForUpdate() {
    const system = getActorSourceSystem(this);
    return sanitizeCombatHaltBuffs(system?.combatMods?.haltBuffs);
  }

  hasPeasantCombatHaltBuffType(buffs, rawType) {
    const type = sanitizeCombatHaltBuffType(rawType);
    return buffs.some(buff => sanitizeCombatHaltBuffType(buff?.type) === type);
  }

  hasPeasantCombatCostBuffResource(buffs, rawResourceType) {
    const resourceType = sanitizeCombatCostResourceType(rawResourceType);
    return buffs.some(buff =>
      sanitizeCombatHaltBuffType(buff?.type) === COMBAT_HALT_BUFF_TYPE_COST &&
      sanitizeCombatCostResourceType(buff?.resourceType) === resourceType
    );
  }

  async addPeasantCombatHaltBuff(rawType, { resourceType = "", customName = "", value = 0 } = {}, options = {}) {
    const type = sanitizeCombatHaltBuffType(rawType);
    const buffs = this.getPeasantCombatHaltBuffsForUpdate();
    let entry = { type, values: "0/0/0/0", value: 0, resourceType: "", customName: "" };

    if (type === COMBAT_HALT_BUFF_TYPE_COST) {
      const safeResourceType = sanitizeCombatCostResourceType(resourceType);
      if (this.hasPeasantCombatCostBuffResource(buffs, safeResourceType)) {
        return { ok: false, changed: false, reason: "duplicate-cost", resourceType: safeResourceType };
      }
      entry.resourceType = safeResourceType;
    } else if (type === COMBAT_HALT_BUFF_TYPE_CUSTOM) {
      entry.value = Number.parseInt(value, 10) || 0;
      entry.customName = String(customName ?? "").trim() || "Custom";
    } else {
      const singleUseTypes = [COMBAT_HALT_BUFF_TYPE_HALT, COMBAT_HALT_BUFF_TYPE_NATURAL, COMBAT_HALT_BUFF_TYPE_FLAT];
      if (singleUseTypes.includes(type) && this.hasPeasantCombatHaltBuffType(buffs, type)) {
        return { ok: false, changed: false, reason: "duplicate-type", type };
      }
    }

    buffs.push(entry);
    await this.updatePeasantSourceData({ "system.combatMods.haltBuffs": sanitizeCombatHaltBuffs(buffs) }, options);
    return { ok: true, changed: true, entry, buffs };
  }

  async removePeasantCombatHaltBuff(index, options = {}) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };

    const buffs = this.getPeasantCombatHaltBuffsForUpdate();
    if (numericIndex >= buffs.length) return { ok: false, changed: false };

    const [removed] = buffs.splice(numericIndex, 1);
    await this.updatePeasantSourceData({ "system.combatMods.haltBuffs": buffs }, options);
    return { ok: true, changed: true, removed, buffs };
  }

  async updatePeasantCombatHaltBuff(index, patch, options = {}) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };

    const buffs = this.getPeasantCombatHaltBuffsForUpdate();
    if (numericIndex >= buffs.length) return { ok: false, changed: false };

    buffs[numericIndex] = { ...buffs[numericIndex], ...patch };
    const sanitized = sanitizeCombatHaltBuffs(buffs);
    await this.updatePeasantSourceData({ "system.combatMods.haltBuffs": sanitized }, options);
    return { ok: true, changed: true, entry: sanitized[numericIndex], buffs: sanitized };
  }

  async setPeasantCombatHaltBuffValues(index, rawValues, options = {}) {
    return this.updatePeasantCombatHaltBuff(index, { values: normalizeHaltValues(rawValues) }, options);
  }

  async setPeasantCombatHaltBuffValue(index, rawValue, options = {}) {
    const current = this.getPeasantCombatHaltBuffsForUpdate()[Number.parseInt(index, 10)];
    const type = sanitizeCombatHaltBuffType(current?.type);
    if (type !== COMBAT_HALT_BUFF_TYPE_FLAT && type !== COMBAT_HALT_BUFF_TYPE_COST && type !== COMBAT_HALT_BUFF_TYPE_CUSTOM) {
      return { ok: false, changed: false };
    }

    return this.updatePeasantCombatHaltBuff(index, { value: Number.parseInt(rawValue, 10) || 0 }, options);
  }

  async setPeasantCombatCustomBuffName(index, rawName, options = {}) {
    const current = this.getPeasantCombatHaltBuffsForUpdate()[Number.parseInt(index, 10)];
    if (sanitizeCombatHaltBuffType(current?.type) !== COMBAT_HALT_BUFF_TYPE_CUSTOM) return { ok: false, changed: false };

    return this.updatePeasantCombatHaltBuff(index, { customName: String(rawName ?? "").trim() || "Custom" }, options);
  }

  async setPeasantCombatCostBuffResource(index, rawResourceType, options = {}) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };

    const buffs = this.getPeasantCombatHaltBuffsForUpdate();
    if (numericIndex >= buffs.length) return { ok: false, changed: false };
    if (sanitizeCombatHaltBuffType(buffs[numericIndex]?.type) !== COMBAT_HALT_BUFF_TYPE_COST) return { ok: false, changed: false };

    const resourceType = sanitizeCombatCostResourceType(rawResourceType);
    const hasDuplicate = buffs.some((buff, index) =>
      index !== numericIndex &&
      sanitizeCombatHaltBuffType(buff.type) === COMBAT_HALT_BUFF_TYPE_COST &&
      sanitizeCombatCostResourceType(buff.resourceType) === resourceType
    );
    if (hasDuplicate) return { ok: false, changed: false, reason: "duplicate-cost", resourceType };

    return this.updatePeasantCombatHaltBuff(numericIndex, { resourceType }, options);
  }

  static createDefaultPeasantSkillEntry(entry = {}) {
    const existing = (entry && typeof entry === "object") ? entry : {};
    const merged = {
      type: "skill",
      specialGrade: 0,
      class: 1,
      rank: "0",
      name: "",
      tohit: null,
      accuracy: null,
      ap: null,
      sp: null,
      usesMax: 0,
      usesCurrent: 0,
      indent: 0,
      description: "",
      ...existing
    };
    const normalized = normalizeSkillEntry(merged, {
      collection: "skills",
      createId: PeasantActor.createPeasantNotableCombatId
    });
    normalized.tohit = parseOptionalInteger(normalized.tohit, { min: 1 });
    normalized.accuracy = parseOptionalInteger(normalized.accuracy, { allowSign: true });
    normalized.ap = parseOptionalInteger(normalized.ap, { min: 0 });
    normalized.sp = parseOptionalInteger(normalized.sp, { min: 0 });
    return normalized;
  }

  getPeasantSkillsForUpdate() {
    return cloneActorListForUpdate(this, "skills", { normalizeEntry: PeasantActor.createDefaultPeasantSkillEntry });
  }

  ensurePeasantSkillEntryAt(skills, index) {
    return ensureActorListEntryAt(skills, index, PeasantActor.createDefaultPeasantSkillEntry);
  }

  async setPeasantSkills(skills, options = {}) {
    const list = cloneActorList(skills, { normalizeEntry: PeasantActor.createDefaultPeasantSkillEntry });
    await this.updatePeasantSourceData({ "system.skills": list }, options);
    return { ok: true, changed: true, skills: list };
  }

  async addPeasantSkill(entry = {}, options = {}) {
    const skills = this.getPeasantSkillsForUpdate();
    skills.push(PeasantActor.createDefaultPeasantSkillEntry(entry));
    return this.setPeasantSkills(skills, options);
  }

  async duplicatePeasantSkill(index, options = {}) {
    const skills = this.getPeasantSkillsForUpdate();
    const result = duplicateActorListEntry(skills, index, PeasantActor.createPeasantNotableCombatId);
    if (!result.changed) return result;
    return this.setPeasantSkills(skills, options);
  }

  async duplicatePeasantSkillToNotables(entryId, options = {}) {
    return this._queuePeasantEntryWrite(async () => {
      const source = getActorSourceSystem(this).skills?.find(entry => entry?.id === entryId);
      if (!source || !entryId) return { ok: false, changed: false };
      const duplicate = normalizeSkillEntry(source, { collection: "notableCombats" });
      const scopes = [duplicate.baseUsage, ...duplicate.usages];
      const effectIds = [...new Set([
        ...duplicate.effectIds, ...scopes.flatMap(usage => usage.effectLinks.map(link => link.effectId))
      ].filter(Boolean))];
      const effectData = [];
      for (const id of effectIds) {
        const effect = this.effects?.get?.(id);
        const data = effect?.toObject?.() ?? effect?._source;
        if (!data) return { ok: false, changed: false, error: "A linked Skill effect is unavailable." };
        const copy = foundry.utils.deepClone(data);
        delete copy._id;
        effectData.push(copy);
      }

      let created = [];
      try {
        if (effectData.length) created = await this.createEmbeddedDocuments("ActiveEffect", effectData, { render: false });
        if (created.length !== effectIds.length) throw new Error("Could not duplicate all linked Skill effects.");
        const effectIdMap = new Map(effectIds.map((id, index) => [id, created[index].id]));
        duplicate.effectIds = duplicate.effectIds.map(id => effectIdMap.get(id));
        for (const usage of scopes) {
          for (const link of usage.effectLinks) link.effectId = effectIdMap.get(link.effectId);
        }
        const current = getActorSourceSystem(this);
        const usedIds = new Set([...(current.skills ?? []), ...(current.notableCombats ?? [])].map(entry => entry?.id));
        do duplicate.id = PeasantActor.createPeasantNotableCombatId(); while (usedIds.has(duplicate.id));
        duplicate.indent = 0;
        const combats = cloneActorList(current.notableCombats);
        combats.push(duplicate);
        await this.updatePeasantSourceData({ "system.notableCombats": combats }, options);
        return { ok: true, changed: true, entry: duplicate, combats };
      } catch (error) {
        if (created.length) await this.deleteEmbeddedDocuments("ActiveEffect", created.map(effect => effect.id), { render: false });
        throw error;
      }
    });
  }

  async removePeasantSkill(index, options = {}) {
    const skills = this.getPeasantSkillsForUpdate();
    const result = removeActorListEntry(skills, index);
    if (!result.changed) return { ok: false, changed: false };
    return this.setPeasantSkills(skills, options);
  }

  async reorderPeasantSkill(fromIndex, toIndex, options = {}) {
    const skills = this.getPeasantSkillsForUpdate();
    const result = reorderActorListEntry(skills, fromIndex, toIndex);
    if (!result.changed) return { ok: false, changed: false };
    return this.setPeasantSkills(skills, options);
  }

  async updatePeasantSkill(index, patch, options = {}) {
    const skills = this.getPeasantSkillsForUpdate();
    const result = patchActorListEntry(skills, index, patch, PeasantActor.createDefaultPeasantSkillEntry);
    if (!result.changed) return { ok: false, changed: false };
    return this.setPeasantSkills(skills, options);
  }

  async setPeasantSkillType(index, rawType, options = {}) {
    const type = String(rawType ?? "skill").trim() || "skill";
    const skills = this.getPeasantSkillsForUpdate();
    const skill = this.ensurePeasantSkillEntryAt(skills, index);
    if (!skill) return { ok: false, changed: false };

    const fixedType = getFixedSkillTypeValue(type);
    if (fixedType && !isSkillProgressionType(fixedType)) {
      const category = ["martial", "magic"].find(value =>
        getSkillTypeOptionsForCategory(value, { currentType: fixedType }).some(option => option.value === fixedType));
      if (category) skill.category = category;
    }

    if (isSkillProgressionType(type)) {
      skill.type = type;
      skill.class = skill.class || 1;
      skill.rank = skill.rank !== undefined ? String(skill.rank) : "0";
      skill.usesMax = skill.usesMax || 0;
      skill.usesCurrent = skill.usesCurrent || 0;
    } else {
      skill.type = type;
    }

    return this.setPeasantSkills(skills, options);
  }

  async changePeasantSkillIndent(index, delta, { includeHidden = true, ...options } = {}) {
    const skills = this.getPeasantSkillsForUpdate();
    const skillIndex = Number.parseInt(index, 10);
    const skill = skills[skillIndex];
    if (!skill) return { ok: false, changed: false };
    const rows = getNotableCombatTreeRows(skills, { includeHidden });
    const rowIndex = rows.findIndex(row => row.index === skillIndex);
    if (rowIndex < 0) return { ok: false, changed: false };
    const maxDepth = (rows[rowIndex - 1]?.depth ?? -1) + 1;
    const depth = Math.min(maxDepth, Math.max(0, rows[rowIndex].depth + (Number.parseInt(delta, 10) || 0)));
    if (skill.indent === depth) return { ok: true, changed: false };
    skill.indent = depth;
    return this.setPeasantSkills(skills, options);
  }

  async setPeasantSkillUsesMax(index, rawValue, options = {}) {
    await this.ensurePeasantEntryIds("skills");
    const skill = getActorSourceSystem(this)?.skills?.[Number.parseInt(index, 10)];
    if (!skill?.id) return { ok: false, changed: false };
    const result = await this.setPeasantEntryUses({ collection: "skills", entryId: skill.id }, { max: rawValue });
    return { ...result, skills: getActorSourceSystem(this)?.skills ?? [] };
  }

  async setPeasantSkillUsesCurrent(index, rawValue, options = {}) {
    await this.ensurePeasantEntryIds("skills");
    const skill = getActorSourceSystem(this)?.skills?.[Number.parseInt(index, 10)];
    if (!skill?.id) return { ok: false, changed: false };
    const result = await this.setPeasantEntryUses({ collection: "skills", entryId: skill.id }, { current: rawValue });
    return { ...result, skills: getActorSourceSystem(this)?.skills ?? [] };
  }

  async setPeasantSkillToHitAccuracy(index, { tohit = "", accuracy = "" } = {}, options = {}) {
    return this.setPeasantSkillMainFields(index, { tohit, accuracy }, options);
  }

  async setPeasantSkillMainFields(index, fields = {}, options = {}) {
    return this.setPeasantEntryMainFields("skills", index, fields, options);
  }

  async setPeasantSkillDescription(index, description, options = {}) {
    return this.updatePeasantSkill(index, { description: String(description ?? "") }, options);
  }

  async consumePeasantSkillUse(index, options = {}) {
    await this.ensurePeasantEntryIds("skills");
    const skill = getActorSourceSystem(this)?.skills?.[Number.parseInt(index, 10)];
    if (!skill?.id) return { ok: false, changed: false };
    const result = await this.consumePeasantEntryUses(
      { collection: "skills", entryId: skill.id },
      { usageId: options.usageId ?? "base", pool: options.pool ?? "primary" }
    );
    return { ...result, skills: getActorSourceSystem(this)?.skills ?? [] };
  }

  getPeasantFlexibleAdvantagesForUpdate(names = null, descriptions = null) {
    const system = getActorSourceSystem(this);
    const sourceNames = Array.isArray(names) ? names : (Array.isArray(system?.flexibleAdvantages) ? system.flexibleAdvantages : []);
    const sourceDescriptions = Array.isArray(descriptions)
      ? descriptions
      : (Array.isArray(system?.flexibleAdvantageDescriptions) ? system.flexibleAdvantageDescriptions : []);
    const safeNames = sourceNames.map(entry => {
      if (typeof entry === "string") return entry;
      return String(entry?.name ?? "");
    });
    const safeDescriptions = sourceDescriptions.map(getFlexibleAdvantageDescription);
    while (safeDescriptions.length < safeNames.length) safeDescriptions.push("");
    if (safeDescriptions.length > safeNames.length) safeDescriptions.length = safeNames.length;
    return { names: safeNames, descriptions: safeDescriptions };
  }

  async setPeasantFlexibleAdvantages(names, descriptions, options = {}) {
    const safe = this.getPeasantFlexibleAdvantagesForUpdate(names, descriptions);
    safe.names = safe.names.map(name => name.trim());
    safe.descriptions = safe.descriptions.map(description => description.trim());
    await this.updatePeasantSourceData({
      "system.flexibleAdvantages": safe.names,
      "system.flexibleAdvantageDescriptions": safe.descriptions.map(description => ({ description }))
    }, options);
    const saved = this.getPeasantFlexibleAdvantagesForUpdate();
    if (JSON.stringify(saved) !== JSON.stringify(safe)) {
      throw new Error("Foundry did not persist the Flexible Advantage changes.");
    }
    return { ok: true, changed: true, ...saved };
  }

  async addPeasantFlexibleAdvantage(names = null, descriptions = null, options = {}) {
    const safe = this.getPeasantFlexibleAdvantagesForUpdate(names, descriptions);
    safe.names.push("");
    safe.descriptions.push("");
    return this.setPeasantFlexibleAdvantages(safe.names, safe.descriptions, options);
  }

  async removePeasantFlexibleAdvantage(index, names = null, descriptions = null, options = {}) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };
    const safe = this.getPeasantFlexibleAdvantagesForUpdate(names, descriptions);
    if (numericIndex >= safe.names.length) return { ok: false, changed: false };
    safe.names.splice(numericIndex, 1);
    safe.descriptions.splice(numericIndex, 1);
    return this.setPeasantFlexibleAdvantages(safe.names, safe.descriptions, options);
  }

  async reorderPeasantFlexibleAdvantage(fromIndex, toIndex, names = null, descriptions = null, options = {}) {
    const from = Number.parseInt(fromIndex, 10);
    let to = Number.parseInt(toIndex, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, changed: false };
    const safe = this.getPeasantFlexibleAdvantagesForUpdate(names, descriptions);
    if (from < 0 || from >= safe.names.length) return { ok: false, changed: false };

    const [movedName] = safe.names.splice(from, 1);
    const [movedDescription] = safe.descriptions.splice(from, 1);
    if (from < to) to--;
    to = Math.max(0, Math.min(to, safe.names.length));
    safe.names.splice(to, 0, movedName);
    safe.descriptions.splice(to, 0, movedDescription);
    return this.setPeasantFlexibleAdvantages(safe.names, safe.descriptions, options);
  }

  async setPeasantFlexibleAdvantageDescription(index, description, options = {}) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };
    const safe = this.getPeasantFlexibleAdvantagesForUpdate();
    while (safe.descriptions.length <= numericIndex) safe.descriptions.push("");
    while (safe.names.length <= numericIndex) safe.names.push("");
    safe.descriptions[numericIndex] = String(description ?? "");
    return this.setPeasantFlexibleAdvantages(safe.names, safe.descriptions, options);
  }

  getPeasantEdgeBaseMode() {
    const system = getActorSourceSystem(this);
    return getActorEdgeLabelMode(this, system?.edgeLabelMode);
  }

  getPeasantEdgeResourcesForUpdate() {
    const baseMode = this.getPeasantEdgeBaseMode();
    const system = getActorSourceSystem(this);
    const existing = Array.isArray(system?.edgeResources) ? system.edgeResources : [];
    return existing.map(entry => normalizeEdgeResourceEntry(entry, baseMode));
  }

  getPeasantEdgeResource(index) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return null;
    const resources = this.getPeasantEdgeResourcesForUpdate();
    return resources[numericIndex] ? { ...resources[numericIndex] } : null;
  }

  async addPeasantEdgeResource() {
    const resources = this.getPeasantEdgeResourcesForUpdate();
    const baseMode = this.getPeasantEdgeBaseMode();
    resources.push({ labelMode: baseMode, customLabel: "", value: 0, max: 0 });
    await this.updatePeasantSourceData({ "system.edgeResources": resources });
    return { ok: true, changed: true, resources };
  }

  async removePeasantEdgeResource(index) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };
    const resources = this.getPeasantEdgeResourcesForUpdate();
    if (numericIndex >= resources.length) return { ok: false, changed: false };
    resources.splice(numericIndex, 1);
    await this.updatePeasantSourceData({ "system.edgeResources": resources });
    return { ok: true, changed: true, resources };
  }

  async setPeasantEdgeLabelMode(rawMode) {
    const mode = sanitizeEdgeLabelMode(rawMode, getDefaultEdgeLabelMode(this));
    await this.updatePeasantSourceData({ "system.edgeLabelMode": mode });
    return { ok: true, changed: true, mode };
  }

  async setPeasantEdgeCustomLabel(rawLabel) {
    const label = String(rawLabel ?? "").trim();
    await this.updatePeasantSourceData({ "system.edgeCustomLabel": label });
    return { ok: true, changed: true, label };
  }

  async updatePeasantEdgeResource(index, patch, options = {}) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };
    const resources = this.getPeasantEdgeResourcesForUpdate();
    if (numericIndex >= resources.length) return { ok: false, changed: false };

    const baseMode = this.getPeasantEdgeBaseMode();
    resources[numericIndex] = normalizeEdgeResourceEntry({ ...resources[numericIndex], ...patch }, baseMode);
    await this.updatePeasantSourceData({ "system.edgeResources": resources }, options);
    return { ok: true, changed: true, entry: resources[numericIndex], resources };
  }

  async setPeasantEdgeResourceLabelMode(index, rawMode, options = {}) {
    const current = this.getPeasantEdgeResource(index);
    if (!current) return { ok: false, changed: false };
    return this.updatePeasantEdgeResource(index, {
      labelMode: sanitizeEdgeLabelMode(rawMode, current.labelMode)
    }, options);
  }

  async setPeasantEdgeResourceCustomLabel(index, rawLabel, options = {}) {
    return this.updatePeasantEdgeResource(index, {
      customLabel: String(rawLabel ?? "").trim()
    }, options);
  }

  async setPeasantEdgeResourceValue(index, rawValue, options = {}) {
    const current = this.getPeasantEdgeResource(index);
    if (!current) return { ok: false, changed: false };
    const max = Math.max(0, Number.parseInt(current.max, 10) || 0);
    const value = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    return this.updatePeasantEdgeResource(index, { value }, options);
  }

  async setPeasantEdgeResourceMax(index, rawMax, options = {}) {
    const current = this.getPeasantEdgeResource(index);
    if (!current) return { ok: false, changed: false };
    const max = Math.max(0, Number.parseInt(rawMax, 10) || 0);
    const value = Math.min(Math.max(0, Number.parseInt(current.value, 10) || 0), max);
    return this.updatePeasantEdgeResource(index, { value, max }, options);
  }

  getBarAttribute(barName, options = {}) {
    const data = super.getBarAttribute(barName, options);
    if (!data) return null;

    const customColors = {
      health: { bar: [1, 0, 0], value: [0, 1, 0] },
      stamina: { bar: [0, 0.2, 0], value: [0, 0.4, 0] },
      attunement: { bar: [0.12, 0.56, 1], value: [0.24, 0.68, 1] },
      capacity: { bar: [1, 0.55, 0], value: [1, 0.7, 0.2] },
      edge: { bar: [0.5, 0.5, 0.5], value: [1, 1, 1] }
    };

    const attrName = barName.split(".").pop();
    if (customColors[attrName]) {
      data.color = customColors[attrName].value;
      data.bgColor = customColors[attrName].bar;
    }

    return data;
  }
}
