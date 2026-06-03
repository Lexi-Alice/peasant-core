import {
  getArmorChargeValue,
  getTargetedDamageLocationDisplay,
  normalizeAppliedDamageType
} from "../../data/actor/targeted-damage.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { renderDialogV2 } from "../dialogs.mjs";
import { resolveDefensePromptActor } from "./actor-targets.mjs";
import { registerActiveRemotePrompt, unregisterActiveRemotePrompt } from "./remote-prompt-registry.mjs";

export {
  applyIncomingHeal,
  applyIncomingHit,
  requestIncomingHealApplicationForTarget,
  requestIncomingHitApplicationForTarget,
  requestIncomingHitResolutionForTarget
} from "./incoming-hit-requests.mjs";

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
  if (getArmorChargeValue(defenderActor) <= 0) {
    let appliedType = normalizedDamageType;
    if (appliedType === "flexible") appliedType = "blunt";
    return {
      handled: true,
      useArmorCharge: false,
      appliedDamageType: appliedType,
      location,
      isAP,
      chainCancelled: false,
      armorChargeUnavailable: true
    };
  }

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

    dialogApp = renderDialogV2({
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

        renderedWindow = html.closest(".application, dialog")[0] || html[0];
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
