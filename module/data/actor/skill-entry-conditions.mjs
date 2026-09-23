const SYSTEM_ID = "peasant-core";
const DEFINITION_FLAG = "skillEditorDefinition";

export function findPassiveSkillEffectSource(actor, effectId) {
  const id = String(effectId ?? "").trim();
  if (!id) return null;
  const system = actor?.system?._source ?? actor?._source?.system ?? actor?.system ?? {};
  for (const collection of ["skills", "notableCombats"]) {
    for (const entry of system[collection] ?? []) {
      for (const [usageId, usage] of [["base", entry?.baseUsage],
        ...(entry?.usages ?? []).map(candidate => [candidate?.id, candidate])]) {
        if (!usage?.effectLinks?.some(link => link?.effectId === id && link?.when === "passive")) continue;
        return {
          collection,
          entryId: entry.id,
          entryName: entry.name || (collection === "skills" ? "Skill" : "Notable"),
          usageId,
          usageName: usage.name || (usageId === "base" ? "Default" : "Usage")
        };
      }
    }
  }
  return null;
}

export function isSkillRuleEligible(when, outcome = {}) {
  switch (String(when ?? "always").trim().toLowerCase()) {
    case "always": return true;
    case "success": return outcome.success === true;
    case "failure": return outcome.failed === true;
    case "hit": return outcome.hit === true;
    case "manual": return outcome.manual === true;
    default: return false;
  }
}

export function skillEffectNeedsReview(link, rules = []) {
  if (link?.when === "manual") return true;
  return (Array.isArray(rules) ? rules : []).some(rule => {
    const applies = rule?.effectLinkIds?.includes?.(link?.id)
      || (link?.tagKey && rule?.tagKeys?.includes?.(link.tagKey));
    return applies && (rule.when === "manual" || !!String(rule.note ?? "").trim());
  });
}

export function isSkillTagAutoEligible(usageData, tagKey, outcome = {}) {
  const candidateRules = usageData?.baseUsage?.rules ?? usageData?.rules;
  const rules = Array.isArray(candidateRules) ? candidateRules : [];
  return rules.filter(rule => rule?.tagKeys?.includes(tagKey))
    .every(rule => !String(rule.note ?? "").trim()
      && isSkillRuleEligible(rule.when, { ...outcome, manual: false }));
}

export function isSkillEditorDefinition(effect) {
  return effect?.flags?.[SYSTEM_ID]?.[DEFINITION_FLAG] === true
    || effect?._source?.flags?.[SYSTEM_ID]?.[DEFINITION_FLAG] === true;
}

export function hasExpiringSkillEffectDuration(duration) {
  return (duration?.value !== null && duration?.value !== undefined && duration?.value !== "")
    || !!duration?.expiry || duration?.expired === true;
}

export function isPassiveSkillEffectDefinition(effect, actor = effect?.parent) {
  return isSkillEditorDefinition(effect) && !!findPassiveSkillEffectSource(actor, effect?.id);
}
