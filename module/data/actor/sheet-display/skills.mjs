import { prepareActorNotableCombatContext } from "./notable-combat.mjs";

export function prepareActorSkillContext(data, actor, options = {}) {
  prepareActorNotableCombatContext(data, actor, { ...options, collection: "skills" });
}
