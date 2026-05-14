import { getAutomatedCombatDamageTypeLabel } from "../../data/actor/combat-damage.mjs";
import {
  getTargetedDamageLocationDisplay,
  isArmorPenLocationLike,
  normalizeAppliedDamageType
} from "../../data/actor/targeted-damage.mjs";
import { PC_SOCKET_NAMESPACE, PC_SOCKET_PROMPT_INCOMING_HIT } from "../../socket/remote-prompts.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { renderDialogCompat } from "../dialogs.mjs";
import { getPreferredDefensePromptRecipientUser, resolveDefensePromptActor } from "./actor-targets.mjs";
import { withWaitingForDefenderResponse } from "./prompt-dialogs.mjs";
import { registerActiveRemotePrompt, unregisterActiveRemotePrompt } from "./remote-prompt-registry.mjs";
import { applyTargetedDamageWorkflow } from "./targeted-damage-workflow.mjs";

export { requestIncomingHitApplicationForTarget, requestIncomingHitResolutionForTarget } from "./incoming-hit-requests.mjs";

export async function showIncomingHitPrompt(payload = {}) {
  const defenderActor = await resolveDefensePromptActor(payload);
  if (!defenderActor) return null;
  const promptId = String(payload.promptId || "").trim();

  const attackerName = String(payload.attackerTokenName || payload.attackerActorName || "Attacker").trim() || "Attacker";
  const location = String(payload.location || "Torso").trim() || "Torso";
  const locationDisplay = String(payload.locationDisplay || getTargetedDamageLocationDisplay(location)).trim() || getTargetedDamageLocationDisplay(location);
  const locationText = String(payload.locationResultText || locationDisplay).trim() || locationDisplay;
  const isAP = !!payload.isAP;
  const normalizedDamageType = normalizeAppliedDamageType(payload.damageType);
  const title = `${attackerName} hits you in the ${locationText}!`;

  const content = `
    <form class="pc-incoming-hit-form">
      <div class="form-group" style="margin-bottom: 10px;">
        <div class="pc-incoming-hit-message">Use armor charge before damage is rolled and applied?</div>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;
    let dialogApp = null;

    const finalize = async (useArmorCharge, html = null, { chainCancelled = false } = {}) => {
      if (settled) return null;
      settled = true;
      if (closeWatcher) {
        clearInterval(closeWatcher);
        closeWatcher = null;
      }
      unregisterActiveRemotePrompt(promptId, remoteCloser);

      let appliedType = normalizedDamageType;
      if (appliedType === "flexible") appliedType = "blunt";

      const result = {
        handled: true,
        useArmorCharge: !!useArmorCharge,
        appliedDamageType: appliedType,
        location,
        isAP,
        chainCancelled: !!chainCancelled
      };
      resolve(result);
      try {
        Promise.resolve(dialogApp?.close?.()).catch((e) => {
          console.error("Peasant Core | Failed to close incoming hit prompt", e);
        });
      } catch (e) {
        console.error("Peasant Core | Failed to close incoming hit prompt", e);
      }
      return result;
    };

    const remoteCloser = async (result = {}) => {
      const finalized = await finalize(false, null, { chainCancelled: true, ...result });
      try {
        await dialogApp?.close?.();
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to close remote incoming hit prompt", e);
      }
      return finalized;
    };
    if (promptId) registerActiveRemotePrompt(promptId, remoteCloser);

    dialogApp = renderDialogCompat({
      title,
      content,
      buttons: {
        armor: {
          label: "Use Armor Charge",
          callback: async (html) => {
            await finalize(true, html);
            return true;
          }
        },
        noArmor: {
          label: "Don't Use Armor Charge",
          callback: async (html) => {
            await finalize(false, html);
            return true;
          }
        }
      },
      default: "noArmor",
      render: (html) => {
        const viewportWidth = Number(window?.innerWidth) || 480;
        const stableDialogWidth = Math.max(360, Math.min(420, viewportWidth - 32));
        html.css({
          width: `${stableDialogWidth}px`,
          minWidth: `${stableDialogWidth}px`,
          maxWidth: `${Math.max(320, viewportWidth - 32)}px`
        });
        html.find(".window-content, .dialog-content").css({ overflowX: "hidden" });

        renderedWindow = html.closest(".window-app, .application")[0] || html[0];
        $(renderedWindow)
          .find('.header-control, [data-action="close"], [data-button="close"]')
          .off(".pcIncomingHitClose")
          .on("click.pcIncomingHitClose", () => {
            void finalize(false, html, { chainCancelled: true });
          });

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) {
              void finalize(false, html, { chainCancelled: true });
            }
          }, 150);
        }
      }
    }, { classes: ["pc-incoming-hit-dialog", "peasant-macro-dialog-force"] });
  });
}

export async function applyIncomingHit(payload = {}) {
  const defenderActor = await resolveDefensePromptActor(payload);
  if (!defenderActor) return null;

  const damageAmount = Number(payload.damageAmount);
  if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
    return { handled: false, applied: false, reason: "invalidDamage" };
  }

  const location = String(payload.location || "Torso").trim() || "Torso";
  const armorPenHit = isArmorPenLocationLike({
    isAP: payload.isAP,
    rawText: payload.locationResultText,
    locationResultText: payload.locationDisplay,
    label: payload.location
  });
  let appliedType = normalizeAppliedDamageType(payload.damageType, "blunt");
  if (appliedType === "flexible") appliedType = "blunt";

  let applyResult = null;
  try {
    applyResult = await applyTargetedDamageWorkflow(defenderActor, {
      amount: damageAmount,
      type: appliedType,
      location,
      isAP: armorPenHit,
      useArmorCharge: !!payload.useArmorCharge,
      ignoreHaltReduction: !!payload.ignoreHaltReduction,
      chatSpeaker: ChatMessage.getSpeaker({ actor: defenderActor })
    });
  } catch (error) {
    console.error("Peasant Core | applyIncomingHit failed while applying targeted damage workflow", {
      payload,
      defender: defenderActor?.name,
      error
    });
    return {
      handled: true,
      applied: false,
      reason: "workflowError",
      error: String(error?.message || error || "Unknown error")
    };
  }

  return {
    handled: true,
    applied: !!applyResult?.ok,
    useArmorCharge: !!payload.useArmorCharge,
    ignoreHaltReduction: !!payload.ignoreHaltReduction,
    appliedDamageType: appliedType,
    location,
    isAP: armorPenHit,
    applyResult
  };
}
