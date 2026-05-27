import { normalizeAutomatedCombatHealType, rollAutomatedCombatHeal } from "./automated-heal-rolls.mjs";

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

  if (typeof targetActor.applyPeasantHeal !== "function") {
    ui.notifications?.warn?.(`${targetActor.name || "Target"} cannot receive Peasant Core healing.`);
    return { handled: false, reason: "healUnavailable", healRoll };
  }

  const healType = normalizeAutomatedCombatHealType(combat.heal.type);
  let application;
  try {
    application = await targetActor.applyPeasantHeal(Number(healRoll.total) || 0, healType);
  } catch (error) {
    console.error("Peasant Core | Failed to apply automated healing", error);
    application = { ok: false, message: `Could not apply healing to ${targetActor.name || "target"}.` };
  }
  if (!application?.ok) {
    ui.notifications?.warn?.(application?.message || `Could not apply healing to ${targetActor.name || "target"}.`);
  }

  return {
    handled: !!application?.ok,
    healType,
    healRoll,
    application,
    targetActorId: targetActor.id || null
  };
}
