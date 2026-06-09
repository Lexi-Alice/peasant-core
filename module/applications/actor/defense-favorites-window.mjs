import { renderSheetOwnedApplication } from "./controls/sheet-owned-apps.mjs";
import { COMBAT_DEFENSE_RESPONSE_OPTIONS } from "../../data/actor/combat-defense.mjs";
import {
  getDefenseFavoriteKey,
  getDefenseFavorites,
  getMatchingDefenseNotables,
  getPreferredDefenseMatch
} from "../../data/actor/defense-favorites.mjs";
import { getDefaultEdgeLabelMode, resolveEdgeLabel, sanitizeEdgeLabelMode } from "../../data/actor/edge-resources.mjs";
import { getActorHealthMax } from "../../data/actor/helpers.mjs";
import { PC_DEFENSE_FAVORITES_FLAG } from "../../data/actor/sheet-settings.mjs";

const ApplicationV2 = foundry?.applications?.api?.ApplicationV2;
const HandlebarsApplicationMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;

if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error("Peasant Core requires Foundry's ApplicationV2 and HandlebarsApplicationMixin.");
}

const DefenseFavoritesWindowBase = HandlebarsApplicationMixin(ApplicationV2);
const DEFENSE_FAVORITES_TEMPLATE = "systems/peasant-core/templates/actor/apps/defense-favorites-window.hbs";
const DEFENSE_FAVORITES_FOOTER_TEMPLATE = "systems/peasant-core/templates/actor/apps/defense-favorites-window-footer.hbs";
const DEFENSE_FAVORITE_MODE_DEFAULT = "defaultSelection";
const DEFENSE_FAVORITE_MODE_ALWAYS = "always";
const DEFENSE_FAVORITE_MODE_WHEN_OVER = "whenOver";
const DEFENSE_FAVORITE_MODE_WHEN_UNDER = "whenUnder";
const DEFENSE_FAVORITE_MODES = Object.freeze([
  { value: DEFENSE_FAVORITE_MODE_DEFAULT, label: "Default Selection" },
  { value: DEFENSE_FAVORITE_MODE_ALWAYS, label: "Always" },
  { value: DEFENSE_FAVORITE_MODE_WHEN_OVER, label: "When Over" },
  { value: DEFENSE_FAVORITE_MODE_WHEN_UNDER, label: "When Under" }
]);
const DEFENSE_FAVORITE_THRESHOLD_MODES = new Set([
  DEFENSE_FAVORITE_MODE_WHEN_OVER,
  DEFENSE_FAVORITE_MODE_WHEN_UNDER
]);
const DEFENSE_FAVORITE_CONDITION_MODES = Object.freeze([
  { value: DEFENSE_FAVORITE_MODE_WHEN_OVER, label: "When Over" },
  { value: DEFENSE_FAVORITE_MODE_WHEN_UNDER, label: "When Under" }
]);

class PeasantDefenseFavoritesWindow extends DefenseFavoritesWindowBase {
  constructor(sheet, options = {}) {
    const appOptions = foundry.utils.mergeObject({
      id: `peasant-defense-favorites-${sheet.id}`,
      classes: ["peasant-core", "pc-defense-favorites-window", "standard-form"],
      position: {
        width: 760,
        height: 430
      },
      window: {
        title: "Favorited Defenses",
        icon: "fa-solid fa-shield-halved",
        resizable: true
      }
    }, options, { inplace: false });
    super(appOptions);

    this.sheet = sheet;
  }

  static get DEFAULT_OPTIONS() {
    return foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
      tag: "form",
      form: {
        handler: PeasantDefenseFavoritesWindow._onSaveConfiguration,
        submitOnChange: false,
        closeOnSubmit: false
      }
    }, { inplace: false });
  }

  static get PARTS() {
    return {
      body: {
        template: DEFENSE_FAVORITES_TEMPLATE
      },
      footer: {
        template: DEFENSE_FAVORITES_FOOTER_TEMPLATE
      }
    };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      rows: buildDefenseFavoriteRows(this.sheet?.actor)
    });
  }

  async _onRender(context, options) {
    if (typeof super._onRender === "function") await super._onRender(context, options);
    this._bindThresholdModeControls();
  }

  _bindThresholdModeControls() {
    const root = this.element?.nodeType === 1 ? this.element : this.element?.[0];
    if (!root?.querySelectorAll) return;

    const syncRow = (row) => {
      const mode = normalizeDefenseFavoriteMode(row.querySelector("[data-pc-defense-mode]")?.value);
      const showThreshold = DEFENSE_FAVORITE_THRESHOLD_MODES.has(mode);
      const threshold = row.querySelector(".pc-defense-favorite-threshold");
      if (threshold) threshold.hidden = !showThreshold;
      for (const input of row.querySelectorAll("[data-pc-defense-threshold-control]")) {
        input.disabled = !showThreshold;
      }
      this._syncAddConditionButton(row, showThreshold);
    };

    if (root.dataset.pcDefenseFavoriteConditionsBound !== "true") {
      root.dataset.pcDefenseFavoriteConditionsBound = "true";
      root.addEventListener("click", (event) => {
        const addButton = event.target?.closest?.("[data-pc-defense-add-condition]");
        if (addButton) {
          event.preventDefault();
          const row = addButton.closest("[data-pc-defense-favorite-row]");
          if (row) {
            this._addConditionRow(row);
            this._syncAddConditionButton(row);
          }
          return;
        }

        const removeButton = event.target?.closest?.("[data-pc-defense-remove-condition]");
        if (removeButton) {
          event.preventDefault();
          const row = removeButton.closest("[data-pc-defense-favorite-row]");
          if (row) {
            this._removeConditionRow(removeButton);
            this._syncAddConditionButton(row);
          }
        }
      });
    }

    for (const row of root.querySelectorAll("[data-pc-defense-favorite-row]")) {
      syncRow(row);
      const modeSelect = row.querySelector("[data-pc-defense-mode]");
      if (!modeSelect) continue;
      if (modeSelect?.dataset.pcDefenseFavoriteModeBound === "true") continue;
      modeSelect.dataset.pcDefenseFavoriteModeBound = "true";
      modeSelect.addEventListener("change", () => syncRow(row));
    }
  }

  _syncAddConditionButton(row, enabled = true) {
    const addButton = row.querySelector("[data-pc-defense-add-condition]");
    if (!addButton) return;
    const hasResourceOptions = !!row.querySelector("[data-pc-defense-threshold-resource] option");
    addButton.disabled = !enabled || !hasResourceOptions;
  }

  _removeConditionRow(button) {
    button.closest("[data-pc-defense-extra-condition]")?.remove();
  }

  _addConditionRow(row) {
    const list = row.querySelector("[data-pc-defense-extra-conditions]");
    const resourceSelect = row.querySelector("[data-pc-defense-threshold-resource]");
    if (!list || !resourceSelect) return;

    const ownerDocument = row.ownerDocument ?? document;
    const condition = ownerDocument.createElement("div");
    condition.className = "pc-defense-favorite-extra-condition";
    condition.dataset.pcDefenseExtraCondition = "true";

    const modeLabel = createFieldLabel(ownerDocument, "Condition");
    const modeSelect = ownerDocument.createElement("select");
    modeSelect.className = "pc-input";
    modeSelect.dataset.pcDefenseThresholdControl = "true";
    modeSelect.dataset.pcDefenseConditionMode = "true";
    modeSelect.setAttribute("aria-label", "Additional condition mode");
    for (const option of DEFENSE_FAVORITE_CONDITION_MODES) {
      const optionElement = ownerDocument.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      modeSelect.append(optionElement);
    }
    modeLabel.append(modeSelect);

    const valueLabel = createFieldLabel(ownerDocument, "Value");
    const valueInput = ownerDocument.createElement("input");
    valueInput.type = "number";
    valueInput.className = "pc-input";
    valueInput.min = "0";
    valueInput.step = "1";
    valueInput.inputMode = "numeric";
    valueInput.dataset.pcDefenseThresholdControl = "true";
    valueInput.dataset.pcDefenseConditionValue = "true";
    valueInput.setAttribute("aria-label", "Additional condition value");
    valueLabel.append(valueInput);

    const resourceLabel = createFieldLabel(ownerDocument, "Resource");
    const nextResourceSelect = resourceSelect.cloneNode(true);
    nextResourceSelect.dataset.pcDefenseThresholdControl = "true";
    nextResourceSelect.dataset.pcDefenseConditionResource = "true";
    delete nextResourceSelect.dataset.pcDefenseThresholdResource;
    nextResourceSelect.removeAttribute("aria-label");
    nextResourceSelect.setAttribute("aria-label", "Additional condition resource");
    nextResourceSelect.disabled = false;
    resourceLabel.append(nextResourceSelect);

    const removeButton = ownerDocument.createElement("button");
    removeButton.type = "button";
    removeButton.className = "pc-defense-condition-action";
    removeButton.dataset.pcDefenseThresholdControl = "true";
    removeButton.dataset.pcDefenseRemoveCondition = "true";
    removeButton.dataset.tooltip = "Remove condition";
    removeButton.setAttribute("aria-label", "Remove condition");
    removeButton.innerHTML = '<i class="fa-solid fa-minus" aria-hidden="true"></i>';

    condition.append(modeLabel, valueLabel, resourceLabel, removeButton);
    list.append(condition);
  }

  async _saveConfiguration() {
    const actor = this.sheet?.actor;
    if (!actor?.setFlag) return;

    const favorites = this._collectFavorites();
    if (!favorites) return;
    try {
      if (Object.keys(favorites).length > 0) {
        await actor.setFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG, favorites);
      } else if (typeof actor.unsetFlag === "function") {
        await actor.unsetFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG);
      } else {
        await actor.setFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG, {});
      }
      ui.notifications?.info?.("Favorited defenses saved.");
      await this.close({ submitted: true });
    } catch (err) {
      console.warn("Peasant Core | Failed to save favorited defenses", err);
      ui.notifications?.warn?.("Failed to save favorited defenses. See console for details.");
    }
  }

  _collectFavorites() {
    const root = this.element?.nodeType === 1 ? this.element : this.element?.[0];
    if (!root?.querySelectorAll) return {};

    const favorites = {};
    for (const row of root.querySelectorAll("[data-pc-defense-favorite-row]")) {
      const targetingKey = row.dataset.targetingKey;
      const favoriteKey = getDefenseFavoriteKey(targetingKey);
      if (!favoriteKey) continue;

      const defenseIndex = Number.parseInt(row.querySelector("[data-pc-defense-select]")?.value, 10);
      if (!Number.isFinite(defenseIndex)) continue;

      const match = getMatchingDefenseNotables(this.sheet?.actor, targetingKey)
        .find(({ index }) => index === defenseIndex);
      if (!match) continue;

      const mode = normalizeDefenseFavoriteMode(row.querySelector("[data-pc-defense-mode]")?.value);
      const entry = {
        index: defenseIndex,
        name: String(match.combat?.name || "").trim(),
        mode
      };

      if (DEFENSE_FAVORITE_THRESHOLD_MODES.has(mode)) {
        const value = parseOptionalWholeNumber(row.querySelector("[data-pc-defense-threshold-value]")?.value);
        const resourceType = String(row.querySelector("[data-pc-defense-threshold-resource]")?.value || "").trim();
        if (value === null || !resourceType) {
          ui.notifications?.warn?.(`Please complete the ${match.combat?.name || "defense"} threshold configuration.`);
          return null;
        }
        const conditions = [{ mode, value, resourceType }];
        for (const conditionRow of row.querySelectorAll("[data-pc-defense-extra-condition]")) {
          const conditionMode = normalizeDefenseFavoriteConditionMode(
            conditionRow.querySelector("[data-pc-defense-condition-mode]")?.value
          );
          const conditionValue = parseOptionalWholeNumber(
            conditionRow.querySelector("[data-pc-defense-condition-value]")?.value
          );
          const conditionResourceType = String(
            conditionRow.querySelector("[data-pc-defense-condition-resource]")?.value || ""
          ).trim();
          if (conditionValue === null || !conditionResourceType) {
            ui.notifications?.warn?.(`Please complete all ${match.combat?.name || "defense"} conditions.`);
            return null;
          }
          conditions.push({
            mode: conditionMode,
            value: conditionValue,
            resourceType: conditionResourceType
          });
        }
        entry.threshold = { value, resourceType };
        entry.conditions = conditions;
      }

      favorites[favoriteKey] = entry;
    }
    return favorites;
  }

  static async _onSaveConfiguration(event) {
    event?.preventDefault?.();
    await this._saveConfiguration?.();
  }
}

export function openDefenseFavoritesWindow(sheet, options = {}) {
  if (!sheet) return null;
  const applicationOptions = typeof sheet?._withDetachedOptions === "function"
    ? sheet._withDetachedOptions(options)
    : options;
  const application = new PeasantDefenseFavoritesWindow(sheet, applicationOptions);
  return renderSheetOwnedApplication(sheet, "defense-favorites", application);
}

function buildDefenseFavoriteRows(actor) {
  const favorites = getDefenseFavorites(actor);
  const resourceOptions = getActorResourceOptions(actor);

  return COMBAT_DEFENSE_RESPONSE_OPTIONS.map((targeting) => {
    const favoriteKey = getDefenseFavoriteKey(targeting.key);
    const favorite = favorites[favoriteKey] || {};
    const matchingDefenses = getMatchingDefenseNotables(actor, targeting.key);
    const preferredMatch = getPreferredDefenseMatch(actor, targeting.key, matchingDefenses);
    const selectedDefenseValue = preferredMatch ? String(preferredMatch.index) : "";
    const mode = normalizeDefenseFavoriteMode(favorite.mode);
    const conditions = getFavoriteConditions(favorite, mode);
    const primaryCondition = conditions[0] || {};
    const selectedResourceType = String(primaryCondition.resourceType || resourceOptions[0]?.value || "").trim();
    const rowResourceOptions = buildSelectedOptions(ensureResourceOption(resourceOptions, selectedResourceType), selectedResourceType);
    const extraConditions = conditions.slice(1).map((condition) => {
      const conditionResourceType = String(condition.resourceType || resourceOptions[0]?.value || "").trim();
      return {
        modeOptions: buildSelectedOptions(DEFENSE_FAVORITE_CONDITION_MODES, normalizeDefenseFavoriteConditionMode(condition.mode)),
        value: formatOptionalWholeNumber(condition.value),
        resourceOptions: buildSelectedOptions(ensureResourceOption(resourceOptions, conditionResourceType), conditionResourceType),
        hasResourceOptions: ensureResourceOption(resourceOptions, conditionResourceType).length > 0
      };
    });

    return {
      key: targeting.key,
      label: targeting.label,
      defenseOptions: matchingDefenses.map(({ combat, index }) => ({
        value: String(index),
        label: String(combat?.name || `Defense ${index + 1}`).trim() || `Defense ${index + 1}`,
        selected: String(index) === selectedDefenseValue
      })),
      hasDefenseOptions: matchingDefenses.length > 0,
      modeOptions: buildSelectedOptions(DEFENSE_FAVORITE_MODES, mode),
      usesThreshold: DEFENSE_FAVORITE_THRESHOLD_MODES.has(mode),
      thresholdValue: formatOptionalWholeNumber(primaryCondition.value),
      resourceOptions: rowResourceOptions,
      hasResourceOptions: rowResourceOptions.length > 0,
      hasExtraConditions: extraConditions.length > 0,
      extraConditions
    };
  });
}

function getActorResourceOptions(actor) {
  const defaultEdgeMode = getDefaultEdgeLabelMode(actor);
  const edgeMode = sanitizeEdgeLabelMode(actor?.system?.edgeLabelMode, defaultEdgeMode);
  const edgeLabel = resolveEdgeLabel(edgeMode, actor?.system?.edgeCustomLabel, defaultEdgeMode);
  const resources = [
    { value: "stamina", label: "Stamina" },
    { value: "attunement", label: "Attunement" },
    { value: "capacity", label: "Capacity" },
    { value: "edge", label: edgeLabel },
    { value: "armorCharge", label: "Armor Charge" },
    { value: "health", label: "Health" }
  ];

  return resources.filter(({ value }) => {
    const max = value === "health"
      ? getActorHealthMax(actor)
      : Number(actor?.system?.[value]?.max);
    return Number.isFinite(max) && max > 0;
  });
}

function ensureResourceOption(options, selectedValue) {
  if (!selectedValue || options.some((option) => option.value === selectedValue)) return options;
  const fallbackLabel = selectedValue.replace(/([A-Z])/g, " $1").replace(/^./, char => char.toUpperCase());
  return [...options, { value: selectedValue, label: fallbackLabel }];
}

function buildSelectedOptions(options, selectedValue) {
  return options.map((option) => ({
    ...option,
    selected: option.value === selectedValue
  }));
}

function normalizeDefenseFavoriteMode(value) {
  const normalized = String(value ?? "").trim();
  return DEFENSE_FAVORITE_MODES.some((mode) => mode.value === normalized)
    ? normalized
    : DEFENSE_FAVORITE_MODE_DEFAULT;
}

function normalizeDefenseFavoriteConditionMode(value) {
  const normalized = String(value ?? "").trim();
  return DEFENSE_FAVORITE_THRESHOLD_MODES.has(normalized)
    ? normalized
    : DEFENSE_FAVORITE_MODE_WHEN_OVER;
}

function getFavoriteConditions(favorite, fallbackMode) {
  const rawConditions = Array.isArray(favorite?.conditions) ? favorite.conditions : [];
  const conditions = rawConditions.map((condition, index) => normalizeFavoriteCondition(
    condition,
    index === 0 ? fallbackMode : DEFENSE_FAVORITE_MODE_WHEN_OVER
  )).filter(Boolean);
  if (conditions.length > 0) {
    conditions[0].mode = normalizeDefenseFavoriteConditionMode(fallbackMode);
    return conditions;
  }

  const threshold = favorite?.threshold && typeof favorite.threshold === "object" ? favorite.threshold : {};
  const value = formatOptionalWholeNumber(threshold.value);
  const resourceType = String(threshold.resourceType || "").trim();
  return [{
    mode: normalizeDefenseFavoriteConditionMode(fallbackMode),
    value,
    resourceType
  }];
}

function normalizeFavoriteCondition(condition, fallbackMode) {
  if (!condition || typeof condition !== "object") return null;
  return {
    mode: normalizeDefenseFavoriteConditionMode(condition.mode || fallbackMode),
    value: formatOptionalWholeNumber(condition.value),
    resourceType: String(condition.resourceType || "").trim()
  };
}

function createFieldLabel(ownerDocument, text) {
  const label = ownerDocument.createElement("label");
  const span = ownerDocument.createElement("span");
  span.textContent = text;
  label.append(span);
  return label;
}

function parseOptionalWholeNumber(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function formatOptionalWholeNumber(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? String(Math.max(0, parsed)) : "";
}
