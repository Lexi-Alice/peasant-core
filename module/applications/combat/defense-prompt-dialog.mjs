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
import { renderDialogV2 } from "../dialogs.mjs";
import { resolveDefensePromptActor } from "./actor-targets.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";
import { registerActiveRemotePrompt, unregisterActiveRemotePrompt } from "./remote-prompt-registry.mjs";

export async function showDefensePromptDialog(payload = {}, { rollNotableCombat = null } = {}) {
  const defenderActor = await resolveDefensePromptActor(payload);
  if (!defenderActor) {
    console.warn("Peasant Core | Defense prompt skipped: defender actor could not be resolved", {
      attack: payload.attackCombatName,
      targetingType: payload.attackTargetingType,
      targetSceneId: payload.targetSceneId,
      targetTokenId: payload.targetTokenId,
      targetActorId: payload.targetActorId,
      targetActorUuid: payload.targetActorUuid,
      targetTokenUuid: payload.targetTokenUuid
    });
    return null;
  }
  const promptId = String(payload.promptId || "").trim();

  const targetingType = String(payload.attackTargetingType || "").trim();
  const isOverkillAttack = !!payload.attackOverkill;
  const isBracedBlockingDefenseMatch = (defenseMatch) => {
    const defense = normalizeCombatDefense(defenseMatch?.defense);
    return !!(defense.block && (defense.blockType === "Shield" || defense.blockType === "Mage"));
  };
  const allMatchingDefenses = getMatchingDefenseNotables(defenderActor, targetingType);
  const matchingDefenses = isOverkillAttack
    ? allMatchingDefenses.filter(isBracedBlockingDefenseMatch)
    : allMatchingDefenses;
  const primalEvasionResult = createPrimalEvasionDefenseResult(defenderActor, targetingType);
  if (!matchingDefenses.length) {
    if (!isOverkillAttack && primalEvasionResult.activeDefense) {
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
      attack: payload.attackCombatName,
      overkill: isOverkillAttack
    });
    pcLog.debug("Peasant Core | Defense prompt skipped: no matching defenses", {
      defender: defenderActor.name,
      targetingType,
      attack: payload.attackCombatName,
      defenses: (defenderActor.system?.notableCombats || [])
        .map((combat, index) => ({ index, name: combat?.name, responses: combat?.defense?.responses || [] }))
        .filter((entry) => entry.responses.length)
    });
    return null;
  }

  const attackerName = String(payload.attackerTokenName || payload.attackerActorName || "Attacker").trim() || "Attacker";
  const titleTargetingType = targetingType || "Unknown";
  const title = `${attackerName} attacks you! | ${titleTargetingType}`;
  pcLog.debug("Peasant Core | Opening defense prompt", {
    defender: defenderActor.name,
    targetingType,
    attack: payload.attackCombatName,
    defenses: matchingDefenses.map(({ combat, index }) => ({ index, name: combat?.name }))
  });
  const previewByIndex = new Map(
    matchingDefenses.map(({ combat, index }) => [String(index), getNotableCombatRollPreview(defenderActor, combat)])
  );
  const preferredDefenseMatch = getPreferredDefenseMatch(defenderActor, targetingType, matchingDefenses);
  const preferredDefenseValue = preferredDefenseMatch ? String(preferredDefenseMatch.index) : "";
  const defaultDefenseValue = preferredDefenseValue || "__none__";
  const isShieldBlockDefenseMatch = (defenseMatch) => {
    const defense = normalizeCombatDefense(defenseMatch?.defense);
    return !!(defense.block && defense.blockType === "Shield");
  };
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
        <select class="pc-defense-prompt-select pc-select pc-dialog-field-full" name="defenseCombatIndex">
          ${optionsHtml}
        </select>
      </div>
      <div class="form-group pc-defense-favorite" style="display:none;">
        <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; color:#b0b0b0;">
          <span>Favorite as defensive reflex for targeting type?</span>
          <input type="checkbox" name="defenseFavoriteForTargeting">
        </label>
      </div>
      <div class="form-group pc-defense-brace" style="display:none;">
        <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; color:#b0b0b0;">
          <span>Brace?</span>
          <input type="checkbox" name="shieldBlockBrace">
        </label>
      </div>
      <div class="form-group pc-defense-preview" style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <label style="display:block; color:#b0b0b0;">
          <span style="display:block; margin-bottom:5px;">To-Hit</span>
          <input type="number" class="pc-input pc-dialog-field-full" name="defensePreviewToHit" value="" step="1" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*">
        </label>
        <label style="display:block; color:#b0b0b0;">
          <span style="display:block; margin-bottom:5px;">Accuracy</span>
          <input type="number" class="pc-input pc-dialog-field-full" name="defensePreviewAccuracy" value="" step="1" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*">
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
        shieldBlockBraced: false,
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

    dialogApp = renderDialogV2({
      title,
      content,
      buttons: {
        roll: {
          label: "Roll",
          callback: async (html) => {
            const selectedValue = String(html.find('[name="defenseCombatIndex"]').val() || "");
            if (selectedValue === "__none__") {
              finalize(isOverkillAttack ? {} : createPrimalEvasionDefenseResult(defenderActor, targetingType));
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
            const shieldBlockBraced = isShieldBlockDefenseMatch(selectedDefenseMatch)
              && (isOverkillAttack || !!html.find('[name="shieldBlockBrace"]').prop("checked"));
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
              cardClass: "pc-defense-roll-card",
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
              primalEvasionPenalty: 0,
              shieldBlockBraced
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

        renderedWindow = html.closest(".application, dialog")[0] || html[0];
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
        const $brace = html.find('[name="shieldBlockBrace"]');
        const $braceRow = html.find(".pc-defense-brace");
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
            $brace.prop("checked", false);
            $brace.prop("disabled", false);
            $braceRow.hide();
            $preview.hide();
            $roll.prop("disabled", false);
            return;
          }

          const preview = previewByIndex.get(selectedValue);
          const selectedDefenseMatch = matchingDefenses.find(({ index }) => String(index) === selectedValue) || null;
          const isShieldBlock = isShieldBlockDefenseMatch(selectedDefenseMatch);
          if (!preview) {
            $toHit.val("");
            $accuracy.val("");
            $favorite.prop("checked", false);
            $favoriteRow.show();
            $brace.prop("disabled", isOverkillAttack && isShieldBlock);
            $brace.prop("checked", isOverkillAttack && isShieldBlock);
            $braceRow.toggle(isShieldBlock);
            $preview.show();
            $roll.prop("disabled", true);
            return;
          }

          $favoriteRow.show();
          $favorite.prop("checked", selectedValue === preferredDefenseValue);
          $braceRow.toggle(isShieldBlock);
          $brace.prop("disabled", isOverkillAttack && isShieldBlock);
          if (isOverkillAttack && isShieldBlock) $brace.prop("checked", true);
          else if (!isShieldBlock) $brace.prop("checked", false);
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
