import { getCombatDefenseResponseKey, normalizeCombatDefense } from "../../data/actor/combat-defense.mjs";
import {
  getMageBlockBarrierEffect,
  getMageBlockDefenseIdentity,
  getMageBlockDuressEffect
} from "../../data/active-effect/mage-block-effects.mjs";
import { formatSpellEffectSubtitle } from "../../data/active-effect/spell-effect-lifecycle.mjs";
import { getNotableCombatRollPreview } from "../../data/actor/combat-roll-preview.mjs";
import {
  createPrimalEvasionDefenseResult,
  getAccuracyPenaltyFromDefenseRoll,
  getToHitPenaltyFromDefenseRoll
} from "../../data/actor/defense-results.mjs";
import {
  getDefenseFavoriteKey,
  getDefenseFavorites,
  getMatchingDefenseNotables,
  getPreferredDefenseMatch
} from "../../data/actor/defense-favorites.mjs";
import { isSimplifiedHpActor } from "../../data/actor/helpers.mjs";
import { escapeHtml } from "../../utils/chat.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { renderDialogV2 } from "../dialogs.mjs";
import { rollAoeReflexSaveForTarget } from "./aoe-reflex-save.mjs";
import { resolveDefensePromptActor } from "./actor-targets.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";
import { registerActiveRemotePrompt, unregisterActiveRemotePrompt } from "./remote-prompt-registry.mjs";

const DEFENSE_FAVORITE_MODE_ALWAYS = "always";
const DEFENSE_FAVORITE_MODE_WHEN_OVER = "whenOver";
const DEFENSE_FAVORITE_MODE_WHEN_UNDER = "whenUnder";
const DEFENSE_FAVORITE_THRESHOLD_MODES = new Set([
  DEFENSE_FAVORITE_MODE_WHEN_OVER,
  DEFENSE_FAVORITE_MODE_WHEN_UNDER
]);

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
  const targetingKey = getCombatDefenseResponseKey(targetingType);
  const hasReflexSaveOption = targetingKey === "aoe";
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
  if (!matchingDefenses.length && !hasReflexSaveOption) {
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
    defenses: matchingDefenses.map(({ combat, index }) => ({ index, name: combat?.name })),
    reflexSaveOption: hasReflexSaveOption
  });
  const previewByIndex = new Map(
    matchingDefenses.map(({ combat, index }) => [String(index), getNotableCombatRollPreview(defenderActor, combat, { defenseRoll: true })])
  );
  const favoriteKey = getDefenseFavoriteKey(targetingType);
  const favorite = favoriteKey ? getDefenseFavorites(defenderActor)?.[favoriteKey] : null;
  const preferredDefenseMatch = getPreferredDefenseMatch(defenderActor, targetingType, matchingDefenses);
  const preferredDefenseValue = preferredDefenseMatch ? String(preferredDefenseMatch.index) : "";
  const defaultDefenseValue = preferredDefenseValue || (hasReflexSaveOption ? "__reflex_save__" : "__none__");
  if (preferredDefenseMatch
    && normalizeCombatDefense(preferredDefenseMatch.defense).blockType !== "Mage"
    && shouldAutoUseDefenseFavorite(defenderActor, favorite)) {
    const automaticResult = await rollAutomaticFavoriteDefense({
      defenderActor,
      targetingType,
      attackerName,
      defenseMatch: preferredDefenseMatch,
      edgeChainContext: payload.edgeChainContext || null,
      edgeExplodeReroll: payload.edgeExplodeReroll || null,
      rollNotableCombat
    });
    if (automaticResult) return automaticResult;
  }
  const optionsHtml = [
    ...matchingDefenses.map(({ combat, index }) => {
      const label = String(combat?.name || `Defense ${index + 1}`).trim() || `Defense ${index + 1}`;
      return `<option value="${index}">${escapeHtml(label)}</option>`;
    }),
    ...(hasReflexSaveOption ? [`<option value="__reflex_save__">Reflex Save</option>`] : []),
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
      <div class="form-group pc-mage-barrier-effect-group" style="display:none; margin-bottom:8px;">
        <div class="pc-mage-barrier-summary"></div>
      </div>
      <div class="form-group pc-mage-barrier-action" style="display:none;">
        <label style="display:block; margin-bottom:5px; color:#b0b0b0;">Barrier Action:</label>
        <select class="pc-select pc-dialog-field-full" name="mageBarrierAction"></select>
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
        selectedCombatId: null,
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
        selectedCombatId: null,
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
            if (selectedValue === "__reflex_save__") {
              const reflexSaveResult = await rollAoeReflexSaveForTarget({
                targetActor: defenderActor,
                targetingType
              });
              if (!reflexSaveResult) {
                ui.notifications?.warn?.("Reflex Save workflow is unavailable.");
                return false;
              }

              finalize({
                selection: "reflexSave",
                reflexSaveResult,
                appliedAccuracyPenalty: 0,
                appliedToHitPenalty: 0,
                activeDefense: true,
                primalEvasionPenalty: 0
              });
              return true;
            }

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

            const selectedDefense = normalizeCombatDefense(selectedDefenseMatch.defense);
            const isMageBlock = !!(selectedDefense.block && selectedDefense.blockType === "Mage");
            const mageIdentity = isMageBlock
              ? getMageBlockDefenseIdentity("notableCombats", selectedDefenseMatch.combat?.id, "base")
              : "";
            const mageBlockInitialized = isMageBlock
              && !!getMageBlockBarrierEffect(defenderActor, mageIdentity)
              && !!getMageBlockDuressEffect(defenderActor, mageIdentity);
            const mageBarrierAction = isMageBlock
              ? String(html.find('[name="mageBarrierAction"]').val() || "").trim().toLowerCase()
              : null;
            if (isMageBlock && (
              (!mageBlockInitialized && mageBarrierAction !== "create")
              || (mageBlockInitialized && !["use", "refresh"].includes(mageBarrierAction))
            )) {
              ui.notifications?.warn?.("Choose a valid Mage barrier action.");
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
              mageBarrierAction,
              rollOverrides: {
                toHit: overrideToHit,
                accuracy: overrideAccuracy
              },
              edgeChainContext: payload.edgeChainContext || null,
              edgeExplodeReroll: payload.edgeExplodeReroll || null
            });
            if (isChainCancelledResult(defenseRoll)) {
              finalize({
                selection: "close",
                selectedCombatIndex: selectedIndex,
                selectedCombatId: selectedDefenseMatch.combat?.id || null,
                mageBarrierAction,
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
              selectedCombatId: selectedDefenseMatch.combat?.id || null,
              selectedDefense,
              mageBarrierAction,
              defenseRoll,
              appliedAccuracyPenalty,
              appliedToHitPenalty,
              activeDefense: true,
              primalEvasionPenalty: 0
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
              selectedCombatId: null,
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
        const $toHit = html.find('[name="defensePreviewToHit"]');
        const $accuracy = html.find('[name="defensePreviewAccuracy"]');
        const $roll = html.find('[data-action="roll"], [data-button="roll"]');
        const $preview = html.find(".pc-defense-preview");
        const $mageBarrierEffectGroup = html.find(".pc-mage-barrier-effect-group");
        const $mageBarrierActionGroup = html.find(".pc-mage-barrier-action");
        const $mageBarrierSummary = html.find(".pc-mage-barrier-summary");
        const $mageBarrierAction = html.find('[name="mageBarrierAction"]');

        const updatePreview = () => {
          const selectedValue = String($select.val() || "");
          const selectedDefenseMatch = matchingDefenses.find(({ index }) => String(index) === selectedValue) || null;
          const selectedDefense = normalizeCombatDefense(selectedDefenseMatch?.defense);
          const isMageBlock = !!(selectedDefense.block && selectedDefense.blockType === "Mage");
          if (isMageBlock) {
            const identity = getMageBlockDefenseIdentity("notableCombats", selectedDefenseMatch?.combat?.id, "base");
            const barrier = getMageBlockBarrierEffect(defenderActor, identity);
            const duressExists = !!getMageBlockDuressEffect(defenderActor, identity);
            $mageBarrierSummary.html(barrier ? `<div class="pc-inventory-item pc-passive-effect pc-mage-barrier-effect">
              <div class="pc-inventory-item-row pc-passive-effect-row pc-mage-barrier-effect-row">
                <div class="pc-inventory-item-summary pc-passive-effect-summary pc-mage-barrier-effect-summary" data-tooltip="${escapeHtml(barrier.name || "Mage Block Barrier")}">
                  <img class="pc-inventory-item-image pc-passive-effect-icon" src="${escapeHtml(barrier.img || "icons/svg/aura.svg")}" alt="">
                  <span class="pc-inventory-item-name-stack pc-passive-effect-name-stack">
                    <span class="pc-inventory-item-name pc-passive-effect-name">${escapeHtml(barrier.name || "Mage Block Barrier")}</span>
                    <span class="pc-inventory-item-subtitle pc-passive-effect-subtitle">${escapeHtml(formatSpellEffectSubtitle(barrier))}</span>
                  </span>
                </div>
              </div>
            </div>` : "");
            barrier ? $mageBarrierEffectGroup.show() : $mageBarrierEffectGroup.hide();
            const actions = barrier && duressExists
              ? [["use", "Use Current Barrier"], ["refresh", "Refresh Barrier"]]
              : [["create", "Create Barrier"]];
            actions.length > 1 ? $mageBarrierActionGroup.show() : $mageBarrierActionGroup.hide();
            const currentAction = String($mageBarrierAction.val() || "");
            $mageBarrierAction.empty();
            for (const [value, label] of actions) {
              $mageBarrierAction.append(`<option value="${value}">${escapeHtml(label)}</option>`);
            }
            $mageBarrierAction.val(actions.some(([value]) => value === currentAction) ? currentAction : actions[0][0]);
          } else {
            $mageBarrierEffectGroup.hide();
            $mageBarrierActionGroup.hide();
            $mageBarrierAction.empty();
          }
          if (selectedValue === "__none__" || selectedValue === "__reflex_save__") {
            $toHit.val("");
            $accuracy.val("");
            $preview.hide();
            $roll.prop("disabled", false);
            return;
          }

          const preview = previewByIndex.get(selectedValue);
          if (!preview) {
            $toHit.val("");
            $accuracy.val("");
            $preview.show();
            $roll.prop("disabled", true);
            return;
          }

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

async function rollAutomaticFavoriteDefense({
  defenderActor,
  targetingType,
  attackerName,
  defenseMatch,
  edgeChainContext = null,
  edgeExplodeReroll = null,
  rollNotableCombat
} = {}) {
  if (typeof rollNotableCombat !== "function" || !defenderActor || !defenseMatch) return null;

  const preview = getNotableCombatRollPreview(defenderActor, defenseMatch.combat, { defenseRoll: true });
  const overrideToHit = Number.parseInt(preview?.modifiedTohit, 10);
  const rollOverrides = Number.isFinite(overrideToHit)
    ? {
      toHit: overrideToHit,
      accuracy: preview?.hasAccuracy ? preview.accuracyNum : undefined
    }
    : null;

  const defenseRoll = await rollNotableCombat({
    actor: defenderActor,
    combatIndex: defenseMatch.index,
    promptForTargets: false,
    targetLabel: attackerName,
    cardClass: "pc-defense-roll-card",
    rollOverrides,
    edgeChainContext,
    edgeExplodeReroll
  });
  if (!defenseRoll) return null;
  const selectedDefense = normalizeCombatDefense(defenseMatch.defense);

  if (isChainCancelledResult(defenseRoll)) {
    return {
      handled: true,
      selection: "close",
      selectedCombatIndex: defenseMatch.index,
      selectedCombatId: defenseMatch.combat?.id || null,
      selectedDefense,
      defenseRoll,
      appliedAccuracyPenalty: 0,
      appliedToHitPenalty: 0,
      activeDefense: false,
      primalEvasionPenalty: 0,
      chainCancelled: true,
      automaticDefenseFavorite: true
    };
  }

  return {
    handled: true,
    selection: "defense",
    selectedCombatIndex: defenseMatch.index,
    selectedCombatId: defenseMatch.combat?.id || null,
    selectedDefense,
    defenseRoll,
    appliedAccuracyPenalty: getAccuracyPenaltyFromDefenseRoll(
      defenseMatch.defense,
      targetingType,
      defenseRoll?.rollResult
    ),
    appliedToHitPenalty: getToHitPenaltyFromDefenseRoll(
      defenseMatch.defense,
      defenseRoll?.rollResult
    ),
    activeDefense: true,
    primalEvasionPenalty: 0,
    automaticDefenseFavorite: true
  };
}

function shouldAutoUseDefenseFavorite(actor, favorite) {
  const mode = normalizeDefenseFavoriteAutoMode(favorite?.mode);
  if (mode === DEFENSE_FAVORITE_MODE_ALWAYS) return true;
  if (!DEFENSE_FAVORITE_THRESHOLD_MODES.has(mode)) return false;

  const conditions = getDefenseFavoriteAutoConditions(favorite, mode);
  return conditions.length > 0 && conditions.every((condition) => isDefenseFavoriteConditionMet(actor, condition));
}

function getDefenseFavoriteAutoConditions(favorite, fallbackMode) {
  const rawConditions = Array.isArray(favorite?.conditions) ? favorite.conditions : [];
  if (rawConditions.length > 0) {
    return rawConditions.map((condition, index) => normalizeDefenseFavoriteAutoCondition(
      condition,
      index === 0 ? fallbackMode : DEFENSE_FAVORITE_MODE_WHEN_OVER
    )).filter(Boolean);
  }

  const threshold = favorite?.threshold && typeof favorite.threshold === "object" ? favorite.threshold : {};
  const fallbackCondition = normalizeDefenseFavoriteAutoCondition({
    mode: fallbackMode,
    value: threshold.value,
    resourceType: threshold.resourceType
  }, fallbackMode);
  return fallbackCondition ? [fallbackCondition] : [];
}

function normalizeDefenseFavoriteAutoCondition(condition, fallbackMode) {
  if (!condition || typeof condition !== "object") return null;

  const mode = normalizeDefenseFavoriteAutoMode(condition.mode || fallbackMode);
  if (!DEFENSE_FAVORITE_THRESHOLD_MODES.has(mode)) return null;

  const value = Number.parseInt(condition.value, 10);
  const resourceType = String(condition.resourceType || "").trim();
  if (!Number.isFinite(value) || !resourceType) return null;

  return {
    mode,
    value: Math.max(0, value),
    resourceType
  };
}

function normalizeDefenseFavoriteAutoMode(value) {
  const normalized = String(value ?? "").trim();
  return normalized === DEFENSE_FAVORITE_MODE_ALWAYS || DEFENSE_FAVORITE_THRESHOLD_MODES.has(normalized)
    ? normalized
    : "";
}

function isDefenseFavoriteConditionMet(actor, condition) {
  const currentValue = getDefenseFavoriteConditionResourceValue(actor, condition.resourceType);
  if (!Number.isFinite(currentValue)) return false;
  if (condition.mode === DEFENSE_FAVORITE_MODE_WHEN_OVER) return currentValue > condition.value;
  if (condition.mode === DEFENSE_FAVORITE_MODE_WHEN_UNDER) return currentValue < condition.value;
  return false;
}

function getDefenseFavoriteConditionResourceValue(actor, resourceType) {
  const key = String(resourceType || "").trim();
  if (key === "health") return getCurrentHealthConditionValue(actor);

  const value = Number(actor?.system?.[key]?.value);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function getCurrentHealthConditionValue(actor) {
  if (!isSimplifiedHpActor(actor)) {
    const hp = actor?.system?.hp;
    if (Array.isArray(hp?.grid) && hp.grid.length > 0) {
      let clearCells = 0;
      for (const row of hp.grid) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          if (cell === 0) clearCells += 1;
        }
      }
      return clearCells;
    }
  }

  const value = Number(actor?.system?.health?.value);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}
