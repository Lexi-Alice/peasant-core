import { escapeHtml } from "../../utils/chat.mjs";
import { renderDialogCompat } from "../dialogs.mjs";

export async function showRangeRatePrompt({
  combat = null,
  actor = null,
  combatIndex = null,
  sheet = null,
  promptForTargets = true,
  rollOverrides = null,
  targetLabel = "",
  selectedDamageType = null,
  rollNotableCombat = null
} = {}) {
  const rrValues = String(combat?.rangeRate || "").split("/");
  while (rrValues.length < 4) rrValues.push("");
  const ordinals = ["1st", "2nd", "3rd", "4th"];
  const optionsHtml = rrValues.map((value, index) => {
    const displayValue = escapeHtml((value || "").trim() || "-");
    return `<option value="${index}">${ordinals[index]}: ${displayValue}</option>`;
  }).join("");

  const dialogContent = `
    <form>
      <div class="form-group" style="margin-bottom: 10px;">
        <label style="display: block; margin-bottom: 5px; color: #b0b0b0;">Range-Rate?</label>
        <select name="rangeRateIndex" style="width: 100%; padding: 8px 10px; min-height: 38px; background: #2a2a2a; color: #e0e0e0; border: 1px solid #555; border-radius: 4px; font-size: 14px;">
          ${optionsHtml}
        </select>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;

    const finalize = (result = { rolled: false, cancelled: true, chainCancelled: false }) => {
      if (settled) return result;
      settled = true;
      if (closeWatcher) {
        clearInterval(closeWatcher);
        closeWatcher = null;
      }
      resolve(result);
      return result;
    };

    renderDialogCompat({
      title: "Range-Rate",
      content: dialogContent,
      buttons: {
        roll: {
          label: "Roll",
          callback: async (html) => {
            if (typeof rollNotableCombat !== "function") {
              ui.notifications?.warn?.("Combat roll workflow is unavailable.");
              return false;
            }

            const selectedIndex = Number.parseInt(html.find('[name="rangeRateIndex"]').val(), 10) || 0;
            const toHitAdj = selectedIndex;
            const accAdj = -selectedIndex;
            const result = await rollNotableCombat({
              actor,
              combatIndex,
              toHitAdj,
              accuracyAdj: accAdj,
              sheet,
              promptForTargets,
              rollOverrides,
              targetLabel,
              selectedDamageType
            });
            finalize(result);
            return true;
          }
        },
        cancel: {
          label: "Cancel",
          callback: async () => {
            finalize({ rolled: false, cancelled: true });
            return true;
          }
        }
      },
      default: "roll",
      render: (html) => {
        renderedWindow = html.closest(".window-app, .application")[0] || html[0];
        $(renderedWindow)
          .find('.header-control, [data-action="close"], [data-button="close"]')
          .off(".pcRangeRateClose")
          .on("click.pcRangeRateClose", () => finalize({ rolled: false, cancelled: true, chainCancelled: true }));

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) finalize({ rolled: false, cancelled: true, chainCancelled: true });
          }, 150);
        }
      }
    });
  });
}
