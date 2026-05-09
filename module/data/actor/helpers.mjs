const PC_CHARACTER_TYPES = Object.freeze(["character"]);
const PC_CHARACTER_TYPE_SET = new Set(PC_CHARACTER_TYPES);

export function isPeasantCharacterType(type) {
  return PC_CHARACTER_TYPE_SET.has(String(type ?? "").trim());
}

export function isSimplifiedHpActor(actor) {
  return !!actor?.getFlag?.("peasant-core", "simplifiedHp");
}

export function getActorHealthMax(actor) {
  const currentMax = Number(actor?.system?.health?.max);
  if (Number.isFinite(currentMax) && currentMax > 0) return currentMax;
  const rows = Number(actor?.system?.hp?.rows) || 0;
  const cols = Number(actor?.system?.hp?.cols) || 0;
  return rows * cols;
}

export function getActorBolsteredMax(actor) {
  if (isSimplifiedHpActor(actor)) return getActorHealthMax(actor);
  return Number(actor?.system?.hp?.cols) || 0;
}
