const FALLBACK_COMBAT_IMAGE = "icons/svg/sword.svg";
const FALLBACK_EFFECT_IMAGE = "icons/svg/aura.svg";

function getDefaultCombatImage() {
  return String(
    globalThis.CONFIG?.Item?.documentClass?.DEFAULT_ICON
    || globalThis.CONFIG?.Item?.defaultIcon
    || FALLBACK_COMBAT_IMAGE
  ).trim() || FALLBACK_COMBAT_IMAGE;
}

export function getNotableCombatImage(combat) {
  return String(combat?.img || "").trim() || getDefaultCombatImage();
}

export function getNotableCombatEffectImage(actor, combat) {
  const combatImage = String(combat?.img || "").trim();
  const defaultCombatImage = getDefaultCombatImage();
  if (combatImage && combatImage !== defaultCombatImage && combatImage !== FALLBACK_COMBAT_IMAGE) {
    return combatImage;
  }

  return String(
    actor?.img
    || globalThis.CONFIG?.ActiveEffect?.documentClass?.DEFAULT_ICON
    || globalThis.CONFIG?.ActiveEffect?.defaultIcon
    || FALLBACK_EFFECT_IMAGE
  ).trim() || FALLBACK_EFFECT_IMAGE;
}
