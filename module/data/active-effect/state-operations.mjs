import { applyPeasantNumericActiveEffectChange, clampPeasantInteger } from "./change-modes.mjs";
import { isPeasantActiveEffectStateKey } from "./key-policy.mjs";
import { isSkillEditorDefinition } from "../actor/skill-entry-conditions.mjs";

const SYSTEM_ID = "peasant-core";
const APPLIED_STATE_OPERATIONS_FLAG = "appliedStateOperations";
const STATE_OPERATION_HOOK_OPTION = "activeEffectStateOperation";

const RESOURCE_VALUE_PATTERN = /^system\.(stamina|attunement|capacity|edge|armorCharge|ap|sp)\.value$/;
const STRESS_CELL_PATTERN = /^system\.(physical|mental|general)(\d+)$/;
const CONDITION_PATTERN = /^system\.conditions\.([^.]+)$/;

function isInitiatingClient(userId) {
  if (!userId || !globalThis.game?.user?.id) return true;
  return userId === game.user.id;
}

function getProperty(root, path) {
  const getFoundryProperty = globalThis.foundry?.utils?.getProperty;
  if (typeof getFoundryProperty === "function") return getFoundryProperty(root, path);
  return String(path).split(".").filter(Boolean).reduce((value, part) => value?.[part], root);
}

function getDocumentSystemValue(document, key) {
  return getProperty(document?.system, String(key ?? "").replace(/^system\./, ""));
}

function getStateOperationSignature(change) {
  const key = String(change?.key ?? "").trim();
  const mode = Number(change?.mode) || 0;
  const value = String(change?.value ?? "");
  const priority = Number(change?.priority) || 0;
  return JSON.stringify([key, mode, value, priority]);
}

function getAppliedStateOperationMap(effect) {
  const flag = effect?.getFlag?.(SYSTEM_ID, APPLIED_STATE_OPERATIONS_FLAG);
  return flag && typeof flag === "object" && !Array.isArray(flag) ? { ...flag } : {};
}

async function setAppliedStateOperationMap(effect, applied) {
  await effect.update({
    [`flags.${SYSTEM_ID}.${APPLIED_STATE_OPERATIONS_FLAG}`]: applied
  }, {
    render: false,
    peasantCore: { [STATE_OPERATION_HOOK_OPTION]: true }
  });
}

async function clearAppliedStateOperationMap(effect) {
  if (!effect?.getFlag?.(SYSTEM_ID, APPLIED_STATE_OPERATIONS_FLAG)) return;
  await effect.update({
    [`flags.${SYSTEM_ID}.-=${APPLIED_STATE_OPERATIONS_FLAG}`]: null
  }, {
    render: false,
    peasantCore: { [STATE_OPERATION_HOOK_OPTION]: true }
  });
}

function getEffectOwner(effect) {
  const parent = effect?.parent ?? null;
  const item = parent?.documentName === "Item" ? parent : null;
  const actor = parent?.documentName === "Actor"
    ? parent
    : item?.actor ?? null;
  return { actor, item };
}

function applyStateNumber(current, change, { min = 0, max = Infinity } = {}) {
  return clampPeasantInteger(applyPeasantNumericActiveEffectChange(current, change?.value, change?.mode), { min, max });
}

function parseConditionStateValue(key, rawValue) {
  if (key === "wounded") {
    const value = String(rawValue ?? "true").trim().toLowerCase();
    return !["", "0", "false", "no", "off"].includes(value);
  }
  return String(rawValue ?? "").trim();
}

async function applyActorResourceValueStateOperation(actor, change, resourceName) {
  const current = Number(actor?.system?.[resourceName]?.value) || 0;
  const max = Math.max(0, Number(actor?.system?.[resourceName]?.max) || 0);
  const next = applyStateNumber(current, change, { min: 0, max });
  if (typeof actor.setPeasantResourceValue === "function" && !["ap", "sp"].includes(resourceName)) {
    return actor.setPeasantResourceValue(resourceName, next);
  }
  await actor.updatePeasantStateData?.({ [`system.${resourceName}.value`]: next });
  return { ok: true, changed: true, value: next, max };
}

async function applyActorHealthStateOperation(actor, change, field) {
  const current = Number(actor?.system?.health?.[field]) || 0;
  const max = Math.max(0, Number(actor?.system?.health?.max) || 0);
  const next = applyStateNumber(current, change, { min: 0, max: field === "value" ? max : Infinity });

  if (field === "value") {
    if (typeof actor.setPeasantSimplifiedHealthValue === "function") {
      const result = await actor.setPeasantSimplifiedHealthValue(next);
      if (result?.ok !== false) return result;
    }
    const delta = next - current;
    if (delta > 0 && typeof actor.applyPeasantHeal === "function") return actor.applyPeasantHeal(delta, "greater");
    if (delta < 0 && typeof actor.applyPeasantDamage === "function") return actor.applyPeasantDamage(Math.abs(delta), "blunt", false);
    return { ok: true, changed: false, value: current };
  }

  if (typeof actor.setPeasantSimplifiedHealthMax === "function") {
    const result = await actor.setPeasantSimplifiedHealthMax(next);
    if (result?.ok !== false) return result;
  }
  console.warn("Peasant Core could not apply health max state operation because this actor derives health max from HP dimensions.", {
    actor: actor?.name,
    key: change?.key
  });
  return { ok: false };
}

async function applyActorTemporaryHpStateOperation(actor, change, field) {
  const current = Number(actor?.system?.temporaryHp?.[field]) || 0;
  const max = Math.max(0, Number(actor?.system?.temporaryHp?.max) || 0);
  const next = applyStateNumber(current, change, { min: 0, max: field === "value" ? Math.max(max, current) : Infinity });
  if (field === "value" && typeof actor.setPeasantTemporaryHpValue === "function") {
    return actor.setPeasantTemporaryHpValue(next, { expandMax: true });
  }
  await actor.updatePeasantStateData?.({ [`system.temporaryHp.${field}`]: next });
  return { ok: true, changed: true, value: next };
}

async function applyActorStateOperation(actor, change) {
  if (!actor || typeof actor.updatePeasantStateData !== "function") return { ok: false };

  const key = String(change?.key ?? "").trim();
  const resourceMatch = key.match(RESOURCE_VALUE_PATTERN);
  if (resourceMatch) return applyActorResourceValueStateOperation(actor, change, resourceMatch[1]);

  if (key === "system.health.value") return applyActorHealthStateOperation(actor, change, "value");
  if (key === "system.health.max") return applyActorHealthStateOperation(actor, change, "max");
  if (key === "system.temporaryHp.value") return applyActorTemporaryHpStateOperation(actor, change, "value");
  if (key === "system.temporaryHp.max") return applyActorTemporaryHpStateOperation(actor, change, "max");

  if (key === "system.bolsteredHp") {
    const current = Number(actor?.system?.bolsteredHp) || 0;
    const max = Math.max(0, Number(actor?.system?.hp?.cols) || current);
    const next = applyStateNumber(current, change, { min: 0, max });
    if (typeof actor.setPeasantBolsteredHp === "function") return actor.setPeasantBolsteredHp(next);
    await actor.updatePeasantStateData({ "system.bolsteredHp": next });
    return { ok: true, changed: true, value: next, max };
  }

  const stressMatch = key.match(STRESS_CELL_PATTERN);
  if (stressMatch) {
    const [, type, rawIndex] = stressMatch;
    const current = Number(getDocumentSystemValue(actor, key)) || 0;
    const next = applyStateNumber(current, change, { min: 0, max: 3 });
    return actor.setPeasantStressCell?.(type, rawIndex, next) ?? { ok: false };
  }

  const conditionMatch = key.match(CONDITION_PATTERN);
  if (conditionMatch) {
    const conditionKey = conditionMatch[1];
    const value = parseConditionStateValue(conditionKey, change?.value);
    await actor.updatePeasantStateData({ [key]: value });
    return { ok: true, changed: true, value };
  }

  return { ok: false };
}

async function applyItemStateOperation(item, change) {
  if (!item || typeof item.update !== "function") return { ok: false };

  const key = String(change?.key ?? "").trim();
  if (key !== "system.uses.value" && key !== "system.sunder.current") return { ok: false };

  const current = Number(getDocumentSystemValue(item, key)) || 0;
  const maxKey = key === "system.uses.value" ? "system.uses.max" : "system.sunder.max";
  const max = Math.max(0, Number(getDocumentSystemValue(item, maxKey)) || 0);
  const next = applyStateNumber(current, change, { min: 0, max });
  await item.update({ [key]: next });
  return { ok: true, changed: true, value: next, max };
}

async function applyPeasantActiveEffectStateOperation(effect, change) {
  const { actor, item } = getEffectOwner(effect);
  const key = String(change?.key ?? "").trim();
  if (key === "system.uses.value" || key === "system.sunder.current") return applyItemStateOperation(item, change);
  return applyActorStateOperation(actor, change);
}

export async function applyPeasantActiveEffectStateOperations(effect, { force = false } = {}) {
  if (!effect || effect.disabled || isSkillEditorDefinition(effect)) return false;

  const changes = (effect.changes ?? effect._source?.changes ?? [])
    .filter(change => isPeasantActiveEffectStateKey(change?.key));
  if (!changes.length) return false;

  const applied = getAppliedStateOperationMap(effect);
  let changed = false;
  for (const change of changes) {
    const signature = getStateOperationSignature(change);
    if (!force && applied[signature]) continue;

    const result = await applyPeasantActiveEffectStateOperation(effect, change);
    if (result?.ok === false) continue;
    applied[signature] = true;
    changed = true;
  }

  if (changed) await setAppliedStateOperationMap(effect, applied);
  return changed;
}

export function configurePeasantActiveEffectStateOperations() {
  Hooks.on("createActiveEffect", (effect, options, userId) => {
    if (!isInitiatingClient(userId)) return;
    void applyPeasantActiveEffectStateOperations(effect);
  });

  Hooks.on("updateActiveEffect", (effect, changed, options, userId) => {
    if (options?.peasantCore?.[STATE_OPERATION_HOOK_OPTION]) return;
    if (!isInitiatingClient(userId)) return;

    if (changed?.disabled === true) {
      void clearAppliedStateOperationMap(effect);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(changed ?? {}, "changes")) {
      void applyPeasantActiveEffectStateOperations(effect, { force: true });
      return;
    }

    if (changed?.disabled === false) {
      void applyPeasantActiveEffectStateOperations(effect);
    }
  });
}
