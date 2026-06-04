import {
  getDefaultNationalOriginEntries,
  getDefaultSirLocationEntries,
  getNationalOriginEntries,
  getSirLocationEntries,
  registerPeasantCoreIdentitySettings,
  renderPeasantCoreActorSheets,
  setNationalOriginEntries,
  setSirLocationEntries
} from "./data/actor/identity-options.mjs";

const SYSTEM_ID = "peasant-core";
const SETTINGS_MENU_TEMPLATE = `systems/${SYSTEM_ID}/templates/settings/settings-menu.html`;

const ApplicationV2 = foundry?.applications?.api?.ApplicationV2;
const HandlebarsApplicationMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;
if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error("Peasant Core requires Foundry's ApplicationV2 and HandlebarsApplicationMixin.");
}
const SettingsApplicationBase = HandlebarsApplicationMixin(ApplicationV2);

class PeasantCoreSettingsMenu extends SettingsApplicationBase {
  static MENU_CONFIG = {
    id: "peasant-core-settings-menu",
    title: "Peasant Core Configuration",
    icon: "fa-solid fa-gear",
    groupLabel: "Options",
    entryLabel: "option"
  };

  constructor(options = {}) {
    super(options);
    this._draftEntries = null;
    this._draggedEntryKey = null;
  }

  static get DEFAULT_OPTIONS() {
    const superOptions = super.DEFAULT_OPTIONS ?? {};
    const config = this.MENU_CONFIG;
    const classes = Array.from(new Set([...(superOptions.classes ?? []), "peasant-core", "pc-settings-config", "standard-form"]));

    return foundry.utils.mergeObject(superOptions, {
      id: config.id,
      classes,
      tag: "form",
      position: {
        width: 660,
        height: 360
      },
      window: {
        title: config.title,
        icon: config.icon,
        resizable: true
      },
      form: {
        handler: this._onSaveConfiguration,
        submitOnChange: false,
        closeOnSubmit: false
      },
      actions: {
        resetDefaults: this._onResetDefaults
      }
    }, { inplace: false });
  }

  static get PARTS() {
    return {
      body: {
        template: SETTINGS_MENU_TEMPLATE
      }
    };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const config = this.constructor.MENU_CONFIG;
    return Object.assign(context, {
      title: config.title,
      icon: config.icon,
      groups: [{
        label: config.groupLabel,
        tagGroup: true,
        addLabel: config.customEntryLabel,
        tags: this._getDraftEntries().map((entry) => ({
          key: entry.key,
          label: entry.label
        }))
      }]
    });
  }

  async _onRender(context, options) {
    if (typeof super._onRender === "function") await super._onRender(context, options);
    this._bindSettingTagHover();
    this._bindSettingTagEditing();
    this._bindSettingTagReordering();
  }

  _getCurrentEntries() {
    return [];
  }

  _getDefaultEntries() {
    return [];
  }

  async _saveDraftEntries(entries) {
    return entries;
  }

  _getDraftEntries() {
    if (!this._draftEntries) this._draftEntries = cloneEntries(this._getCurrentEntries());
    return this._draftEntries;
  }

  _resetDraftEntries() {
    this._draftEntries = cloneEntries(this._getDefaultEntries());
  }

  _bindSettingTagReordering() {
    const root = this.element?.nodeType === 1 ? this.element : this.element?.[0];
    if (!root?.querySelectorAll) return;

    for (const listEl of root.querySelectorAll(".pc-settings-tag-list")) {
      if (listEl.dataset.pcSettingsDropBound !== "true") {
        listEl.dataset.pcSettingsDropBound = "true";
        listEl.addEventListener("dragover", (event) => {
          if (!this._draggedEntryKey || event.target?.closest?.(".pc-settings-tag")) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          listEl.classList.add("drag-over-end");
        });
        listEl.addEventListener("dragleave", (event) => {
          if (!listEl.contains(event.relatedTarget)) listEl.classList.remove("drag-over-end");
        });
        listEl.addEventListener("drop", (event) => {
          if (event.target?.closest?.(".pc-settings-tag")) return;
          event.preventDefault();
          const sourceKey = this._getDragSourceKey(event);
          this._clearSettingTagDragState(root);
          this._moveDraftEntry(sourceKey, null, true);
        });
      }
    }

    for (const chipEl of root.querySelectorAll(".pc-settings-tag")) {
      if (chipEl.dataset.pcSettingsDragBound === "true") continue;
      chipEl.dataset.pcSettingsDragBound = "true";

      chipEl.addEventListener("dragstart", (event) => {
        if (chipEl.classList.contains("is-editing") || event.target?.closest?.(".remove-tag-btn, .pc-settings-tag-label-input")) {
          event.preventDefault();
          return;
        }

        const entryKey = chipEl.dataset.entryKey;
        if (!entryKey) {
          event.preventDefault();
          return;
        }

        this._draggedEntryKey = entryKey;
        chipEl.classList.add("dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", entryKey);
        }
      });

      chipEl.addEventListener("dragover", (event) => {
        if (!this._draggedEntryKey || this._draggedEntryKey === chipEl.dataset.entryKey) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        this._setSettingTagDropSide(chipEl, event);
      });

      chipEl.addEventListener("dragleave", () => {
        chipEl.classList.remove("drag-over-left", "drag-over-right");
      });

      chipEl.addEventListener("drop", (event) => {
        event.preventDefault();
        const sourceKey = this._getDragSourceKey(event);
        const targetKey = chipEl.dataset.entryKey;
        const insertAfter = this._isSettingTagDropAfter(chipEl, event);
        this._clearSettingTagDragState(root);
        this._moveDraftEntry(sourceKey, targetKey, insertAfter);
      });

      chipEl.addEventListener("dragend", () => {
        this._clearSettingTagDragState(root);
      });
    }
  }

  _bindSettingTagEditing() {
    const root = this.element?.nodeType === 1 ? this.element : this.element?.[0];
    if (!root?.querySelectorAll) return;

    for (const chipEl of root.querySelectorAll(".pc-settings-tag")) {
      if (chipEl.dataset.pcSettingsEditBound === "true") continue;
      chipEl.dataset.pcSettingsEditBound = "true";

      chipEl.addEventListener("contextmenu", (event) => {
        if (event.target?.closest?.(".remove-tag-btn")) return;
        event.preventDefault();
        this._startInlineTagLabelEdit(chipEl);
      });

      const removeBtn = chipEl.querySelector(".remove-tag-btn");
      removeBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._removeDraftEntry(chipEl.dataset.entryKey);
      });

      const input = chipEl.querySelector(".pc-settings-tag-label-input");
      if (!input) continue;
      input.addEventListener("input", () => this._sizeInlineTagLabelInput(input));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this._commitInlineTagLabelEdit(chipEl);
        } else if (event.key === "Escape") {
          event.preventDefault();
          this._cancelInlineTagLabelEdit(chipEl);
        }
      });
      input.addEventListener("blur", () => {
        if (chipEl.classList.contains("is-editing")) this._commitInlineTagLabelEdit(chipEl);
      });
    }

    for (const addButton of root.querySelectorAll(".pc-settings-add-tag")) {
      if (addButton.dataset.pcSettingsAddBound === "true") continue;
      addButton.dataset.pcSettingsAddBound = "true";
      addButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._addDraftEntry();
      });
    }
  }

  _startInlineTagLabelEdit(chipEl) {
    const entry = this._getDraftEntries().find((candidate) => candidate.key === chipEl?.dataset?.entryKey);
    const labelEl = chipEl?.querySelector?.(".current-tag-label");
    const input = chipEl?.querySelector?.(".pc-settings-tag-label-input");
    if (!entry || !labelEl || !input) return;

    input.value = entry.label;
    this._sizeInlineTagLabelInput(input);
    chipEl.classList.add("is-editing");
    labelEl.hidden = true;
    input.hidden = false;
    input.focus();
    input.select?.();
  }

  _commitInlineTagLabelEdit(chipEl) {
    const input = chipEl?.querySelector?.(".pc-settings-tag-label-input");
    if (!input) return false;

    const entryKey = chipEl?.dataset?.entryKey;
    const updated = this._updateDraftEntryLabel(entryKey, input.value, { render: false });
    if (!updated) {
      input.focus();
      input.select?.();
      return false;
    }

    this._finishInlineTagLabelEdit(chipEl);
    return true;
  }

  _cancelInlineTagLabelEdit(chipEl) {
    const entry = this._getDraftEntries().find((candidate) => candidate.key === chipEl?.dataset?.entryKey);
    const input = chipEl?.querySelector?.(".pc-settings-tag-label-input");
    if (entry && input) input.value = entry.label;
    this._finishInlineTagLabelEdit(chipEl);
  }

  _finishInlineTagLabelEdit(chipEl) {
    const entry = this._getDraftEntries().find((candidate) => candidate.key === chipEl?.dataset?.entryKey);
    const labelEl = chipEl?.querySelector?.(".current-tag-label");
    const input = chipEl?.querySelector?.(".pc-settings-tag-label-input");
    const removeBtn = chipEl?.querySelector?.(".remove-tag-btn");
    if (!entry || !labelEl || !input) return;

    labelEl.textContent = entry.label;
    labelEl.hidden = false;
    input.value = entry.label;
    input.hidden = true;
    chipEl.classList.remove("is-editing");
    chipEl.dataset.tooltip = `Right-click to edit ${entry.label}`;
    chipEl.setAttribute("aria-label", `Right-click to edit ${entry.label}`);
    if (removeBtn) {
      removeBtn.dataset.tooltip = `Remove ${entry.label}`;
      removeBtn.setAttribute("aria-label", `Remove ${entry.label}`);
    }
  }

  _sizeInlineTagLabelInput(input) {
    const length = String(input?.value ?? "").length;
    input.style.width = `${Math.min(Math.max(length + 2, 10), 42)}ch`;
  }

  _removeDraftEntry(entryKey) {
    const entries = this._getDraftEntries();
    const index = entries.findIndex((entry) => entry.key === entryKey);
    if (index < 0) return;

    entries.splice(index, 1);
    void this.render({ force: true });
  }

  _addDraftEntry() {
    const config = this.constructor.MENU_CONFIG;
    const entries = this._getDraftEntries();
    const label = createUniqueLabel(config.customEntryLabel, entries);
    entries.push({
      key: createCustomEntryKey(config.customEntryKeyPrefix, entries),
      custom: true,
      defaultLabel: label,
      label
    });
    void this.render({ force: true });
  }

  _moveDraftEntry(sourceKey, targetKey, insertAfter = false) {
    if (!sourceKey || sourceKey === targetKey) return;

    const entries = this._getDraftEntries();
    const sourceIndex = entries.findIndex((entry) => entry.key === sourceKey);
    if (sourceIndex < 0) return;

    const [entry] = entries.splice(sourceIndex, 1);
    if (!targetKey) {
      entries.push(entry);
      void this.render({ force: true });
      return;
    }

    const targetIndex = entries.findIndex((candidate) => candidate.key === targetKey);
    if (targetIndex < 0) {
      entries.push(entry);
    } else {
      entries.splice(targetIndex + (insertAfter ? 1 : 0), 0, entry);
    }
    void this.render({ force: true });
  }

  _setSettingTagDropSide(chipEl, event) {
    const after = this._isSettingTagDropAfter(chipEl, event);
    chipEl.classList.toggle("drag-over-left", !after);
    chipEl.classList.toggle("drag-over-right", after);
  }

  _isSettingTagDropAfter(chipEl, event) {
    const rect = chipEl.getBoundingClientRect();
    return event.clientX >= rect.left + rect.width / 2;
  }

  _getDragSourceKey(event) {
    return event?.dataTransfer?.getData?.("text/plain") || this._draggedEntryKey;
  }

  _clearSettingTagDragState(root) {
    const container = root?.querySelectorAll ? root : (this.element?.nodeType === 1 ? this.element : this.element?.[0]);
    if (!container?.querySelectorAll) return;
    for (const el of container.querySelectorAll(".pc-settings-tag")) {
      el.classList.remove("dragging", "drag-over-left", "drag-over-right");
    }
    for (const el of container.querySelectorAll(".pc-settings-tag-list")) {
      el.classList.remove("drag-over-end");
    }
    this._draggedEntryKey = null;
  }

  _updateDraftEntryLabel(entryKey, value, { render = true } = {}) {
    const label = String(value ?? "").trim();
    if (!label) {
      ui.notifications?.warn?.("Labels cannot be blank.");
      return false;
    }

    const entries = this._getDraftEntries();
    const normalized = normalizeLabel(label);
    const duplicate = entries.some((entry) => entry.key !== entryKey && normalizeLabel(entry.label) === normalized);
    if (duplicate) {
      ui.notifications?.warn?.("That label is already in use.");
      return false;
    }

    const entry = entries.find((candidate) => candidate.key === entryKey);
    if (!entry) return false;

    entry.label = label;
    if (render) void this.render({ force: true });
    return true;
  }

  _validateDraftEntries(entries) {
    const seen = new Set();
    for (const entry of entries) {
      const label = String(entry?.label ?? "").trim();
      const normalized = normalizeLabel(label);
      if (!label) {
        ui.notifications?.warn?.("Labels cannot be blank.");
        return false;
      }
      if (seen.has(normalized)) {
        ui.notifications?.warn?.("Each label must be unique.");
        return false;
      }
      seen.add(normalized);
    }

    return true;
  }

  async _saveConfiguration() {
    const entries = cloneEntries(this._getDraftEntries());
    if (!this._validateDraftEntries(entries)) return;
    await this._saveDraftEntries(entries);
    this._draftEntries = cloneEntries(entries);
    await this.close();
  }

  _bindSettingTagHover() {
    const root = this.element?.nodeType === 1 ? this.element : this.element?.[0];
    if (!root?.querySelectorAll) return;

    for (const chipEl of root.querySelectorAll(".pc-settings-tag")) {
      if (chipEl.dataset.pcSettingsHoverBound === "true") continue;
      chipEl.dataset.pcSettingsHoverBound = "true";

      const removeBtn = chipEl.querySelector(".remove-tag-btn");
      const setChipHoverState = (active) => {
        chipEl.classList.toggle("tag-hover-active", !!active);

        if (!active) {
          chipEl.style.removeProperty("background");
          chipEl.style.removeProperty("background-color");
          chipEl.style.removeProperty("border-color");
          chipEl.style.removeProperty("color");
          return;
        }

        const hoverSource = removeBtn || chipEl;
        const hoverStyles = getComputedStyle(hoverSource);
        const hoverBg = hoverStyles.getPropertyValue("--button-hover-background-color").trim() || "rgba(46, 38, 28, 0.75)";
        const hoverBorder = hoverStyles.getPropertyValue("--button-hover-border-color").trim() || "#c9b183";
        const hoverText = hoverStyles.getPropertyValue("--button-hover-text-color").trim() || "#f2dfbd";

        chipEl.style.setProperty("background", hoverBg, "important");
        chipEl.style.setProperty("background-color", hoverBg, "important");
        chipEl.style.setProperty("border-color", hoverBorder, "important");
        chipEl.style.setProperty("color", hoverText, "important");
      };

      const setRemoveHoverState = (active) => {
        removeBtn?.classList.toggle("tag-hover-active", !!active);
      };

      chipEl.addEventListener("mouseenter", () => setChipHoverState(true));
      chipEl.addEventListener("mouseleave", () => setChipHoverState(false));
      chipEl.addEventListener("focusin", (event) => {
        if (removeBtn && event.target === removeBtn) return;
        setChipHoverState(true);
      });
      chipEl.addEventListener("focusout", () => {
        setTimeout(() => {
          if (!chipEl.contains(chipEl.ownerDocument?.activeElement)) setChipHoverState(false);
        }, 0);
      });

      if (!removeBtn) continue;
      removeBtn.addEventListener("mouseenter", () => {
        setChipHoverState(false);
        setRemoveHoverState(true);
      });
      removeBtn.addEventListener("mouseleave", () => {
        setRemoveHoverState(false);
        if (!chipEl.matches(":hover") && !chipEl.contains(chipEl.ownerDocument?.activeElement)) {
          setChipHoverState(false);
        } else {
          setChipHoverState(true);
        }
      });
      removeBtn.addEventListener("focusin", () => {
        setChipHoverState(false);
        setRemoveHoverState(true);
      });
      removeBtn.addEventListener("focusout", () => {
        setRemoveHoverState(false);
        setTimeout(() => {
          const activeElement = chipEl.ownerDocument?.activeElement;
          if (!chipEl.contains(activeElement) && !chipEl.matches(":hover")) {
            setChipHoverState(false);
          } else if (chipEl.contains(activeElement) || chipEl.matches(":hover")) {
            setChipHoverState(true);
          }
        }, 0);
      });
    }
  }

  static async _onResetDefaults(event) {
    event?.preventDefault?.();
    this._resetDraftEntries?.();
    await this.render?.({ force: true });
  }

  static async _onSaveConfiguration(event) {
    event?.preventDefault?.();
    await this._saveConfiguration?.();
  }
}

class PeasantCoreSirsSettingsMenu extends PeasantCoreSettingsMenu {
  static MENU_CONFIG = {
    id: "peasant-core-sirs-settings",
    title: "SIRs",
    icon: "fa-solid fa-table-columns",
    groupLabel: "SIR Locations",
    entryLabel: "SIR location",
    customEntryLabel: "Custom SIR Location",
    customEntryKeyPrefix: "customSirLocation"
  };

  _getCurrentEntries() {
    return getSirLocationEntries();
  }

  _getDefaultEntries() {
    return getDefaultSirLocationEntries();
  }

  async _saveDraftEntries(entries) {
    await setSirLocationEntries(entries);
    renderPeasantCoreActorSheets();
  }
}

class PeasantCoreNationalOriginsSettingsMenu extends PeasantCoreSettingsMenu {
  static MENU_CONFIG = {
    id: "peasant-core-national-origins-settings",
    title: "National Origins",
    icon: "fa-solid fa-globe",
    groupLabel: "National Origins",
    entryLabel: "national origin",
    customEntryLabel: "Custom National Origin",
    customEntryKeyPrefix: "customNationalOrigin"
  };

  _getCurrentEntries() {
    return getNationalOriginEntries();
  }

  _getDefaultEntries() {
    return getDefaultNationalOriginEntries();
  }

  async _saveDraftEntries(entries) {
    const previousEntries = getNationalOriginEntries();
    await setNationalOriginEntries(entries);
    await migrateActorNationalOrigins(previousEntries, getNationalOriginEntries());
    renderPeasantCoreActorSheets();
  }
}

export function registerPeasantCoreSettingsMenus() {
  registerPeasantCoreIdentitySettings();

  game.settings.registerMenu(SYSTEM_ID, "sirs", {
    name: "SIRs",
    label: "SIRs",
    hint: "Configure the SIR options available to Peasant Core actors.",
    icon: "fa-solid fa-table-columns",
    scope: "world",
    restricted: true,
    type: PeasantCoreSirsSettingsMenu
  });

  game.settings.registerMenu(SYSTEM_ID, "nationalOrigins", {
    name: "National Origins",
    label: "National Origins",
    hint: "Configure the national origin options available to Peasant Core actors.",
    icon: "fa-solid fa-globe",
    scope: "world",
    restricted: true,
    type: PeasantCoreNationalOriginsSettingsMenu
  });
}

async function migrateActorNationalOrigins(previousEntries, nextEntries) {
  const replacements = buildNationalOriginReplacementMap(previousEntries, nextEntries);
  if (!replacements.size) return;

  const actors = game?.actors?.contents ?? [];
  for (const actor of actors) {
    if (actor?.type !== "character") continue;
    const origin = String(actor?.system?.origin ?? "").trim();
    const replacement = replacements.get(normalizeLabel(origin));
    if (!replacement || replacement === origin) continue;
    await actor.update({ "system.origin": replacement }, { render: false });
  }
}

function buildNationalOriginReplacementMap(previousEntries, nextEntries) {
  const replacements = new Map();
  const nextByKey = new Map(nextEntries.map((entry) => [entry.key, entry]));

  for (const previousEntry of previousEntries) {
    const nextEntry = nextByKey.get(previousEntry.key);
    const replacement = String(nextEntry?.label ?? "").trim();
    if (!replacement) continue;

    for (const oldLabel of [previousEntry.label, previousEntry.defaultLabel]) {
      const oldText = String(oldLabel ?? "").trim();
      if (oldText && oldText !== replacement) replacements.set(normalizeLabel(oldText), replacement);
    }
  }

  return replacements;
}

function cloneEntries(entries) {
  return entries.map((entry) => ({ ...entry }));
}

function normalizeLabel(value) {
  return String(value ?? "").trim().toLowerCase();
}

function createUniqueLabel(baseLabel, entries) {
  const base = String(baseLabel ?? "Custom").trim() || "Custom";
  const existing = new Set(entries.map((entry) => normalizeLabel(entry.label)));
  if (!existing.has(normalizeLabel(base))) return base;

  for (let index = 2; index < 1000; index += 1) {
    const label = `${base} ${index}`;
    if (!existing.has(normalizeLabel(label))) return label;
  }

  return `${base} ${Date.now()}`;
}

function createCustomEntryKey(prefix, entries) {
  const base = String(prefix ?? "customEntry").trim().replace(/[^A-Za-z0-9_-]/g, "") || "customEntry";
  const existing = new Set(entries.map((entry) => entry.key));
  const randomId = globalThis.foundry?.utils?.randomID?.(8) ?? String(Date.now());
  let key = `${base}-${randomId}`;
  let index = 2;
  while (existing.has(key)) {
    key = `${base}-${randomId}-${index}`;
    index += 1;
  }
  return key;
}
