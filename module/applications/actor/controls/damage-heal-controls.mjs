import { applyTargetedDamageWorkflow } from "../../combat/targeted-damage-workflow.mjs";

export function setupDamageHealControls(sheet, html) {
  html.find(".damage-toggle").click((ev) => {
    const controls = html.find(".damage-controls");
    const opening = controls.hasClass("hidden");
    controls.toggleClass("hidden");
    if (opening) sheet._positionSheetPopupNearTrigger(html, ".damage-controls", ev.currentTarget);
  });

  html.find(".close-damage").click(() => {
    html.find(".damage-controls").addClass("hidden");
  });

  html.find(".apply-damage").click(async () => {
    const type = html.find("[name=damageType]").val();
    const amount = Number(html.find("[name=damageAmount]").val());
    const location = html.find("[name=damageLocation]").val() || "Torso";
    const isAP = html.find("[name=damageAP]").is(":checked");
    const useArmorCharge = html.find("[name=damageArmorCharge]").is(":checked");
    const result = await applyTargetedDamageWorkflow(sheet.actor, {
      amount,
      type,
      location,
      isAP,
      useArmorCharge,
      chatSpeaker: ChatMessage.getSpeaker({ actor: sheet.actor })
    });
    if (!result.ok) {
      ui.notifications?.warn?.(result.message || "Failed to apply damage.");
      return;
    }
    sheet.render(false);
  });

  html.find(".heal-toggle").click((ev) => {
    const controls = html.find(".heal-controls");
    const opening = controls.hasClass("hidden");
    controls.toggleClass("hidden");
    if (opening) sheet._positionSheetPopupNearTrigger(html, ".heal-controls", ev.currentTarget);
  });

  html.find(".close-heal").click(() => {
    html.find(".heal-controls").addClass("hidden");
  });

  html.find(".apply-heal").click(async () => {
    const amount = Number(html.find("[name=healAmount]").val()) || 0;
    const healType = html.find("[name=healType]").val();
    if (!amount) return;
    const result = typeof sheet.actor.applyPeasantHeal === "function"
      ? await sheet.actor.applyPeasantHeal(amount, healType)
      : { ok: false, message: "Peasant Core healing workflow is not available for this actor." };
    if (!result.ok) ui.notifications?.warn?.(result.message);
    sheet.render(false);
  });
}
