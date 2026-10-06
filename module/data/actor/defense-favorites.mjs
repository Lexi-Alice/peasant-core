import { getCombatDefenseResponseKey, normalizeCombatDefense } from "./combat-defense.mjs";
import { PC_DEFENSE_FAVORITES_FLAG } from "./sheet-settings.mjs";
import { resolveSkillUsage } from "./skill-entries.mjs";

export function getMatchingDefenseNotables(actor, targetingType) {
  const targetKey = getCombatDefenseResponseKey(targetingType);
  if (!actor || !targetKey) return [];

  const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
  return combats.reduce((matches, combat, index) => {
    if (!combat || typeof combat !== "object") return matches;
    const usages = Array.isArray(combat.usages) ? combat.usages : [];
    for (const usageId of ["base", ...usages.map((usage) => usage?.id).filter(Boolean)]) {
      const resolved = resolveSkillUsage(combat, usageId);
      if (!resolved.ok) continue;
      const defense = normalizeCombatDefense(resolved.data.defense);
      if (!defense.responses.some((response) => getCombatDefenseResponseKey(response) === targetKey)) continue;
      matches.push({
        index,
        combat,
        usageId,
        usageName: String(resolved.usage?.name || (usageId === "base" ? "Default" : "Usage")).trim(),
        key: `${index}:${usageId}`,
        data: resolved.data,
        defense
      });
    }
    return matches;
  }, []);
}

export function resolveSelectedDefenseCombat(combats, selection = {}) {
  if (!Array.isArray(combats)) return null;
  const combatId = String(selection.selectedCombatId || "").trim();
  const index = combatId
    ? combats.findIndex((combat) => String(combat?.id || "") === combatId)
    : Number.parseInt(selection.selectedCombatIndex, 10);
  const combat = combats[index];
  if (!combat) return null;
  const usageId = String(selection.selectedUsageId || "base").trim() || "base";
  const resolved = resolveSkillUsage(combat, usageId);
  if (!resolved.ok) return null;
  return { index, combat, usageId, data: resolved.data, defense: normalizeCombatDefense(resolved.data.defense) };
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
  const favoriteUsageId = String(favorite.usageId || "base").trim() || "base";

  if (Number.isFinite(favoriteIndex)) {
    const directMatch = matchingDefenses.find(({ index, combat, usageId }) => (
      index === favoriteIndex
      && usageId === favoriteUsageId
      && (!favoriteName || String(combat?.name || "").trim() === favoriteName)
    ));
    if (directMatch) return directMatch;
  }

  if (favoriteName) {
    const nameMatch = matchingDefenses.find(({ combat, usageId }) => (
      usageId === favoriteUsageId && String(combat?.name || "").trim() === favoriteName
    ));
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
    ...((favorites[favoriteKey] && typeof favorites[favoriteKey] === "object") ? favorites[favoriteKey] : {}),
    index: favoriteIndex,
    name: String(defenseMatch?.combat?.name || "").trim(),
    usageId: String(defenseMatch?.usageId || "base")
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
