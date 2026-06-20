export const PEASANT_ACTOR_UPDATE_CONTEXT = Object.freeze({
  SOURCE_WRITE: "sourceWrite",
  STATE_WRITE: "stateWrite"
});

export function clonePlainValue(value) {
  if (value == null || typeof value !== "object") return value;
  const deepClone = globalThis.foundry?.utils?.deepClone;
  if (typeof deepClone === "function") {
    try {
      return deepClone(value);
    } catch (error) {
      /* Fall back to platform cloning below. */
    }
  }

  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (error) {
      /* Fall back to JSON cloning below. */
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return Array.isArray(value) ? [...value] : { ...value };
  }
}

export function getActorSourceSystem(actor) {
  return actor?.system?._source ?? actor?._source?.system ?? actor?.system ?? {};
}

export function cloneActorSourceSystem(actor) {
  return clonePlainValue(getActorSourceSystem(actor)) ?? {};
}

export function getActorSourceValue(actor, path) {
  const propertyPath = String(path ?? "").replace(/^system\./, "");
  if (!propertyPath) return getActorSourceSystem(actor);
  const sourceSystem = getActorSourceSystem(actor);
  const getProperty = globalThis.foundry?.utils?.getProperty;
  if (typeof getProperty === "function") return getProperty(sourceSystem, propertyPath);
  return propertyPath.split(".").filter(Boolean).reduce((value, part) => value?.[part], sourceSystem);
}

export function cloneActorSourceList(actor, property, { normalizeEntry = null } = {}) {
  const source = getActorSourceSystem(actor)?.[property];
  const list = clonePlainValue(Array.isArray(source) ? source : []);
  return typeof normalizeEntry === "function" ? list.map(entry => normalizeEntry(entry)) : list;
}

export function withPeasantActorUpdateContext(options = {}, contextKey) {
  const current = options && typeof options === "object" ? options : {};
  return {
    ...current,
    peasantCore: {
      ...(current.peasantCore ?? {}),
      [contextKey]: true
    }
  };
}

export function withPeasantActorSourceWriteContext(options = {}) {
  return withPeasantActorUpdateContext(options, PEASANT_ACTOR_UPDATE_CONTEXT.SOURCE_WRITE);
}

export function withPeasantActorStateWriteContext(options = {}) {
  return withPeasantActorUpdateContext(options, PEASANT_ACTOR_UPDATE_CONTEXT.STATE_WRITE);
}

export function hasPeasantActorUpdateContext(options, contextKey) {
  return !!options?.peasantCore?.[contextKey];
}
