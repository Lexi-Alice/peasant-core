import { normalizeAutomatedCombatHealType, rollAutomatedCombatHeal } from "./automated-heal-rolls.mjs";
import { requestIncomingHealApplicationForTarget } from "./incoming-hit.mjs";

export async function resolveSuccessfulHealForTarget({
  actor = null,
  attackerToken = null,
  combat = null,
  target = null,
  attackRoll = null
} = {}) {
  if (!actor || !combat?.heal || !target) return null;
  if (!attackRoll?.rollResult?.isSuccess) return null;

  const targetActor = target.actor || null;
  if (!targetActor) return { handled: false, reason: "targetActorUnavailable" };

  const targetLabel = target?.targetName || targetActor?.name || "";
  const healRoll = await rollAutomatedCombatHeal(actor, combat, { targetLabel, attackerToken });
  if (!healRoll || !Number.isFinite(Number(healRoll.total)) || Number(healRoll.total) <= 0) {
    return { handled: false, reason: "noHealRolled", healRoll };
  }

  const healType = normalizeAutomatedCombatHealType(combat.heal.type);
  const application = await requestIncomingHealApplicationForTarget({
    target,
    attackerActor: actor,
    attackerToken,
    combat,
    healRoll,
    healType
  });
  if (application?.handled && !application?.applied) {
    ui.notifications?.warn?.(application?.applyResult?.message || `Could not apply healing to ${targetActor.name || "target"}.`);
  }

  return {
    handled: !!application?.handled,
    healType,
    healRoll,
    application,
    targetActorId: targetActor.id || null
  };
}
