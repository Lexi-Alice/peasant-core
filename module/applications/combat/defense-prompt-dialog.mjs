import { normalizeCombatDefense } from "../../data/actor/combat-defense.mjs";
import { getNotableCombatRollPreview } from "../../data/actor/combat-roll-preview.mjs";
import {
  createPrimalEvasionDefenseResult,
  getAccuracyPenaltyFromDefenseRoll,
  getToHitPenaltyFromDefenseRoll
} from "../../data/actor/defense-results.mjs";
import {
  clearPreferredDefenseMatch,
  getMatchingDefenseNotables,
  getPreferredDefenseMatch,
  setPreferredDefenseMatch
} from "../../data/actor/defense-favorites.mjs";
import { escapeHtml } from "../../utils/chat.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { renderDialogCompat } from "../dialogs.mjs";
import { resolveDefensePromptActor } from "./actor-targets.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";
import { registerActiveRemotePrompt, unregisterActiveRemotePrompt } from "./remote-prompt-registry.mjs";

export async function showDefensePromptDialog(payload = {}, { rollNotableCombat = null } = {}) {
  const defenderActor = await resolveDefensePromptActor(payload);
  if (!defenderActor) return null;
  const promptId = String(payload.promptId || "").trim();

  const targetingType = String(payload.attackTargetingType || "").trim();
  const matchingDefenses = getMatchingDefenseNotables(defenderActor, targetingType);
  const primalEvasionResult = createPrimalEvasionDefenseResult(defenderActor, targetingType);
  if (!matchingDefenses.length) {
    if (primalEvasionResult.activeDefense) {
      pcLog.debug("Peasant Core | Defense prompt auto-resolved with Primal Evasion", {
        defender: defenderActor.name,
        targetingType,
        attack: payload.attackCombatName,
        penalty: primalEvasionResult.appliedAccuracyPenalty
      });
      return primalEvasionResult;
    }
    pcLog.debug("Peasant Core | Defense prompt skipped: only None available", {
      defender: defenderActor.name,
      targetingType,
      attack: payload.attackCombatName
    });
    return null;
  }

  const attackerName = String(payload.attackerTokenName || payload.attackerActorName || "Attacker").trim() || "Attacker";
  const titleTargetingType = targetingType || "Unknown";
  const title = `${attackerName} attacks you! | ${titleTargetingType}`;
  const previewByIndex = new Map(
    matchingDefenses.map(({ combat, index }) => [String(index), getNotableCombatRollPreview(defenderActor, combat)])
  );
  const preferredDefenseMatch = getPreferredDefenseMatch(defenderActor, targetingType, matchingDefenses);
  const preferredDefenseValue = preferredDefenseMatch ? String(preferredDefenseMatch.index) : "";
  const defaultDefenseValue = preferredDefenseValue || "__none__";
  const optionsHtml = [
    ...matchingDefenses.map(({ combat, index }) => {
      const label = String(combat?.name || `Defense ${index + 1}`).trim() || `Defense ${index + 1}`;
      return `<option value="${index}">${escapeHtml(label)}</option>`;
    }),
    `<option value="__none__">None</option>`
  ].join("");

  const content = `
    <form class="pc-defense-prompt-form">
      <div class="form-group" style="margin-bottom: 10px;">
        <div style="color: #e0e0e0;">Would you like to defend?</div>
      </div>
      <div class="form-group">
        <label style="display:block; margin-bottom:5px; color:#b0b0b0;">Defense:</label>
        <select class="pc-defense-prompt-select" name="defenseCombatIndex" style="width:100%; padding:8px 10px; min-height:38px; font-size:14px;">
          ${optionsHtml}
        </select>
      </div>
      <div class="form-group pc-defense-favorite" style="display:none;">
        <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; color:#b0b0b0;">
          <span>Favorite as defensive reflex for targeting type?</span>
          <input type="checkbox" name="defenseFavoriteForTargeting">
        </label>
      </div>
      <div class="form-group pc-defense-preview" style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <label style="display:block; color:#b0b0b0;">
          <span style="display:block; margin-bottom:5px;">To-Hit</span>
          <input type="number" name="defensePreviewToHit" value="" step="1">
        </label>
        <label style="display:block; color:#b0b0b0;">
          <span style="display:block; margin-bottom:5px;">Accuracy</span>
          <input type="number" name="defensePreviewAccuracy" value="" step="1">
        </label>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;
    let dialogApp = null;

    const finalize = (result = {}) => {
      if (settled) return result;
      settled = true;
      if (closeWatcher) {
        clearInterval(closeWatcher);
        closeWatcher = null;
      }
      unregisterActiveRemotePrompt(promptId, remoteCloser);
      resolve({
        handled: true,
        selection: "none",
        selectedCombatIndex: null,
        selectedDefense: null,
        defenseRoll: null,
        appliedAccuracyPenalty: 0,
        appliedToHitPenalty: 0,
        activeDefense: false,
        primalEvasionPenalty: 0,
        ...result
      });
      return result;
    };

    const remoteCloser = async (result = {}) => {
      const finalized = finalize({
        selection: "close",
        selectedCombatIndex: null,
        defenseRoll: null,
        appliedAccuracyPenalty: 0,
        appliedToHitPenalty: 0,
        chainCancelled: true,
        ...result
      });
      try {
        await dialogApp?.close?.();
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to close remote defense prompt", e);
      }
      return finalized;
    };
    if (promptId) registerActiveRemotePrompt(promptId, remoteCloser);

    dialogApp = renderDialogCompat({
      title,
      content,
      buttons: {
        roll: {
          label: "Roll",
          callback: async (html) => {
            const selectedValue = String(html.find('[name="defenseCombatIndex"]').val() || "");
            if (selectedValue === "__none__") {
              finalize(createPrimalEvasionDefenseResult(defenderActor, targetingType));
              return true;
            }

            const selectedIndex = Number.parseInt(selectedValue, 10);
            if (!Number.isFinite(selectedIndex)) {
              ui.notifications?.warn?.("No matching defenses are available for this attack.");
              return false;
            }

            const selectedDefenseMatch = matchingDefenses.find(({ index }) => index === selectedIndex) || null;
            if (!selectedDefenseMatch) {
              ui.notifications?.warn?.("That defense is no longer available.");
              return false;
            }

            const toHitRaw = String(html.find('[name="defensePreviewToHit"]').val() || "").trim();
            const accuracyRaw = String(html.find('[name="defensePreviewAccuracy"]').val() || "").trim();
            const overrideToHit = Number.parseInt(toHitRaw, 10);
            if (!Number.isFinite(overrideToHit)) {
              ui.notifications?.warn?.("Please enter a valid To-Hit value.");
              return false;
            }

            const overrideAccuracy = accuracyRaw === "" ? undefined : Number.parseInt(accuracyRaw, 10);
            if (accuracyRaw !== "" && !Number.isFinite(overrideAccuracy)) {
              ui.notifications?.warn?.("Please enter a valid Accuracy value.");
              return false;
            }

            const favoriteChecked = !!html.find('[name="defenseFavoriteForTargeting"]').prop("checked");
            try {
              if (favoriteChecked) {
                await setPreferredDefenseMatch(defenderActor, targetingType, selectedDefenseMatch);
              } else if (preferredDefenseValue === selectedValue) {
                await clearPreferredDefenseMatch(defenderActor, targetingType);
              }
            } catch (favoriteError) {
              console.warn("Peasant Core | Failed to update defensive reflex favorite", favoriteError);
            }

            if (typeof rollNotableCombat !== "function") {
              ui.notifications?.warn?.("Defense roll workflow is unavailable.");
              return false;
            }

            const defenseRoll = await rollNotableCombat({
              actor: defenderActor,
              combatIndex: selectedIndex,
              promptForTargets: false,
              targetLabel: attackerName,
              rollOverrides: {
                toHit: overrideToHit,
                accuracy: overrideAccuracy
              }
            });
            if (isChainCancelledResult(defenseRoll)) {
              finalize({
                selection: "close",
                selectedCombatIndex: selectedIndex,
                selectedDefense: normalizeCombatDefense(selectedDefenseMatch.defense),
                defenseRoll,
                appliedAccuracyPenalty: 0,
                appliedToHitPenalty: 0,
                chainCancelled: true
              });
              return true;
            }

            const appliedAccuracyPenalty = getAccuracyPenaltyFromDefenseRoll(
              selectedDefenseMatch.defense,
              targetingType,
              defenseRoll?.rollResult
            );
            const appliedToHitPenalty = getToHitPenaltyFromDefenseRoll(
              selectedDefenseMatch.defense,
              defenseRoll?.rollResult
            );

            finalize({
              selection: "defense",
              selectedCombatIndex: selectedIndex,
              selectedDefense: normalizeCombatDefense(selectedDefenseMatch.defense),
              defenseRoll,
              appliedAccuracyPenalty,
              appliedToHitPenalty,
              activeDefense: true,
              primalEvasionPenalty: 0
            });
            return true;
          }
        },
        cancel: {
          label: "Cancel",
          callback: async () => {
            finalize({
              selection: "cancel",
              selectedCombatIndex: null,
              defenseRoll: null,
              appliedAccuracyPenalty: 0,
              appliedToHitPenalty: 0
            });
            return true;
          }
        }
      },
      default: "roll",
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
          .off(".pcDefensePromptClose")
          .on("click.pcDefensePromptClose", () => {
            finalize({
              selection: "close",
              selectedCombatIndex: null,
              selectedDefense: null,
              defenseRoll: null,
              appliedAccuracyPenalty: 0,
              appliedToHitPenalty: 0,
              chainCancelled: true
            });
          });

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) {
              finalize({
                selection: "close",
                selectedCombatIndex: null,
                selectedDefense: null,
                defenseRoll: null,
                appliedAccuracyPenalty: 0,
                appliedToHitPenalty: 0,
                chainCancelled: true
              });
            }
          }, 150);
        }

        const $select = html.find('[name="defenseCombatIndex"]');
        const $favorite = html.find('[name="defenseFavoriteForTargeting"]');
        const $favoriteRow = html.find(".pc-defense-favorite");
        const $toHit = html.find('[name="defensePreviewToHit"]');
        const $accuracy = html.find('[name="defensePreviewAccuracy"]');
        const $roll = html.find('[data-action="roll"], [data-button="roll"]');
        const $preview = html.find(".pc-defense-preview");

        const updatePreview = () => {
          const selectedValue = String($select.val() || "");
          if (selectedValue === "__none__") {
            $toHit.val("");
            $accuracy.val("");
            $favorite.prop("checked", false);
            $favoriteRow.hide();
            $preview.hide();
            $roll.prop("disabled", false);
            return;
          }

          const preview = previewByIndex.get(selectedValue);
          if (!preview) {
            $toHit.val("");
            $accuracy.val("");
            $favorite.prop("checked", false);
            $favoriteRow.show();
            $preview.show();
            $roll.prop("disabled", true);
            return;
          }

          $favoriteRow.show();
          $favorite.prop("checked", selectedValue === preferredDefenseValue);
          $preview.show();
          $toHit.val(preview.hasToHit ? `${preview.modifiedTohit}` : "");
          $accuracy.val(preview.hasAccuracy ? `${preview.accuracyNum}` : "0");
          $roll.prop("disabled", false);
        };

        $select.off(".pcDefensePreview");
        $select.on("change.pcDefensePreview", updatePreview);
        $select.val(defaultDefenseValue);
        updatePreview();
      }
    }, { classes: ["pc-defense-prompt-dialog", "peasant-macro-dialog-force"] });
  });
}
