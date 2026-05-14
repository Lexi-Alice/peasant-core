import { getCombatDefenseResponseKey, normalizeCombatDefense } from "./combat-defense.mjs";
import { PC_DEFENSE_FAVORITES_FLAG } from "./sheet-settings.mjs";

export function getMatchingDefenseNotables(actor, targetingType) {
  const targetKey = getCombatDefenseResponseKey(targetingType);
  if (!actor || !targetKey) return [];

  const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
  return combats.reduce((matches, combat, index) => {
    const defenseData = normalizeCombatDefense(combat?.defense);
    const responses = Array.isArray(defenseData.responses) ? defenseData.responses : [];
    const matchesTargetingType = responses.some((response) => getCombatDefenseResponseKey(response) === targetKey);
    if (!matchesTargetingType) return matches;

    matches.push({
      index,
      combat,
      defense: defenseData
    });
    return matches;
  }, []);
}

export function getDefenseFavoriteKey(targetingType) {
  const responseKey = getCombatDefenseResponseKey(targetingType);
  if (responseKey) return responseKey;
  return String(targetingType ?? "").trim().toLowerCase();
}

export function getDefenseFavorites(actor) {
  const raw = actor?.getFlag?.("peasant-core", PC_DEFENSE_FAVORITES_FLAG);
  return (raw && typeof raw === "object") ? foundry.utils.deepClone(raw) : {};
}

export function getPreferredDefenseMatch(actor, targetingType, matchingDefenses) {
  const favoriteKey = getDefenseFavoriteKey(targetingType);
  const favorites = getDefenseFavorites(actor);
  const favorite = favorites?.[favoriteKey];
  if (!favorite || !Array.isArray(matchingDefenses) || !matchingDefenses.length) return null;

  const favoriteIndex = Number.parseInt(favorite.index, 10);
  const favoriteName = String(favorite.name || "").trim();

  if (Number.isFinite(favoriteIndex)) {
    const directMatch = matchingDefenses.find(({ index, combat }) => (
      index === favoriteIndex
      && (!favoriteName || String(combat?.name || "").trim() === favoriteName)
    ));
    if (directMatch) return directMatch;
  }

  if (favoriteName) {
    const nameMatch = matchingDefenses.find(({ combat }) => String(combat?.name || "").trim() === favoriteName);
    if (nameMatch) return nameMatch;
  }

  return null;
}

export async function setPreferredDefenseMatch(actor, targetingType, defenseMatch) {
  const favoriteKey = getDefenseFavoriteKey(targetingType);
  if (!actor?.setFlag || !favoriteKey || !defenseMatch) return false;

  const favoriteIndex = Number.parseInt(defenseMatch.index, 10);
  if (!Number.isFinite(favoriteIndex)) return false;

  const favorites = getDefenseFavorites(actor);
  favorites[favoriteKey] = {
    index: favoriteIndex,
    name: String(defenseMatch?.combat?.name || "").trim()
  };
  await actor.setFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG, favorites);
  return true;
}

export async function clearPreferredDefenseMatch(actor, targetingType) {
  const favoriteKey = getDefenseFavoriteKey(targetingType);
  if (!actor?.setFlag || !favoriteKey) return false;

  const favorites = getDefenseFavorites(actor);
  if (!(favoriteKey in favorites)) return true;

  delete favorites[favoriteKey];
  if (Object.keys(favorites).length > 0) {
    await actor.setFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG, favorites);
  } else if (typeof actor.unsetFlag === "function") {
    await actor.unsetFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG);
  } else {
    await actor.setFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG, {});
  }
  return true;
}
