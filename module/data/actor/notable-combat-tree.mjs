import { hasOptionalInteger, parseOptionalInteger } from "./helpers.mjs";
import { resolveSkillUsage } from "./skill-entries.mjs";
import { isSkillProgressionType, normalizeSkillTypeForCategory } from "./skill-entry-types.mjs";

export function isNotableCombatDisplayable(sourceCombat) {
  const resolved = resolveSkillUsage(sourceCombat);
  const combat = resolved.ok ? resolved.data : sourceCombat;
  const type = normalizeSkillTypeForCategory(combat.type, combat.category);
  if (!isSkillProgressionType(type)) return !!combat.name;
  const hasValidRank = String(combat.rank ?? "").trim().toLowerCase() === "u"
    || combat.rank === 0 || Number.isFinite(Number.parseInt(combat.rank, 10));
  return !!(combat.class && hasValidRank && combat.name
    && hasOptionalInteger(parseOptionalInteger(combat.tohit, { min: 1 })));
}

export function getNotableCombatTreeRows(combats, { includeHidden = false } = {}) {
  const rows = [];
  for (const [index, combat] of combats.entries()) {
    if (!includeHidden && !(combat.isDisplayable ?? isNotableCombatDisplayable(combat))) continue;
    const requestedDepth = Math.max(0, Number.parseInt(combat.indent, 10) || 0);
    const previousDepth = rows.at(-1)?.depth ?? -1;
    rows.push({ index, depth: Math.min(requestedDepth, previousDepth + 1) });
  }
  return rows;
}
