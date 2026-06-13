import { setupNotableCombatTagEditorDrag } from "./notable-combat-drag-drop.mjs";
import { getActiveNotableCombatEditorTags } from "./notable-combat-tag-display.mjs";
import { createNotableCombatTagEditorState } from "./notable-combat-tag-editor-state.mjs";
import { renderNotableCombatTagInputs } from "./notable-combat-tag-input-helpers.mjs";
import { renderNotableCombatTagList } from "./notable-combat-tag-list.mjs";
import { setupNotableCombatTagRemoveControls } from "./notable-combat-tag-remove-controls.mjs";
import { setupNotableCombatTagSaveControls } from "./notable-combat-tag-save-controls.mjs";
import { setupNotableCombatTagSelectionControls } from "./notable-combat-tag-selection-controls.mjs";
import { renderSheetOwnedApplication } from "../controls/sheet-owned-apps.mjs";
import { formatOptionalIntegerInput, parseOptionalInteger, sanitizeOptionalIntegerInputValue } from "../../../data/actor/helpers.mjs";
import { delegate, qs, qsa } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

const ApplicationV2 = foundry?.applications?.api?.ApplicationV2;
const HandlebarsApplicationMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;
const FilePickerClass = foundry?.applications?.apps?.FilePicker;
const ImagePopoutClass = foundry?.applications?.apps?.ImagePopout;

if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error("Peasant Core requires Foundry's ApplicationV2 and HandlebarsApplicationMixin.");
}

const NotableCombatTagEditorBase = HandlebarsApplicationMixin(ApplicationV2);
const TAG_EDITOR_BODY_TEMPLATE = "systems/peasant-core/templates/actor/apps/notable-combat-tag-editor-body.hbs";
const TAG_EDITOR_FOOTER_TEMPLATE = "systems/peasant-core/templates/actor/apps/notable-combat-tag-editor-footer.hbs";
const TAG_EDITOR_TABS = new Set(["description", "details", "effects"]);
const RANK_NAVIGATION_KEYS = new Set(["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", "Enter", "Home", "End"]);
const NO_TO_HIT_ACCURACY_TYPES = new Set(["stance", "perk", "style", "cantrip", "tm"]);
const SPECIAL_GRADE_LABELS = Object.freeze({
  TM: "Grade",
  Perk: "Grade",
  Spellcraft: "C#",
  Gate: "C#"
});
const COMBAT_TYPE_OPTIONS = Object.freeze([
  { value: "standard", label: "Standard" },
  { value: "Stance", label: "Stance" },
  { value: "Perk", label: "Perk" },
  { value: "Style", label: "Style" },
  { value: "Cantrip", label: "Cantrip" },
  { value: "Historic", label: "Historic" },
  { value: "TM", label: "TM" },
  { value: "Spellcraft", label: "Spellcraft" },
  { value: "Gate", label: "Gate" },
  { value: "Other", label: "Other" }
]);
const PC_NOTABLE_COMBAT_EFFECT_TYPE = "skill";
const PC_NOTABLE_COMBAT_EFFECT_SECTIONS = Object.freeze([
  { type: PC_NOTABLE_COMBAT_EFFECT_TYPE, icon: "fa-solid fa-bolt" }
]);
const PC_NOTABLE_EFFECT_DRAG_PREFIX = "peasant-core.notable-combat-effect-sort";
const PC_NOTABLE_EFFECT_DRAG_BLOCK_SELECTOR = "input, select, textarea, a, [data-pc-notable-combat-effect-menu]";
const PC_NOTABLE_EFFECT_SORT_MODES = Object.freeze({
  manual: {
    next: "alpha",
    label: "Sort Manually",
    icon: "fa-solid fa-arrow-down-short-wide"
  },
  alpha: {
    next: "manual",
    label: "Sort Alphabetically",
    icon: "fa-solid fa-arrow-down-a-z"
  }
});

let NotableCombatDescriptionMenuClass = null;
let notableCombatDescriptionPluginListenerRegistered = false;

function getNotableCombatDescriptionMenuClass() {
  const BaseMenu = foundry?.prosemirror?.plugins?.ProseMirrorMenu;
  if (!BaseMenu) return null;
  if (NotableCombatDescriptionMenuClass) return NotableCombatDescriptionMenuClass;

  NotableCombatDescriptionMenuClass = class PeasantNotableCombatDescriptionMenu extends BaseMenu {
    _onResize() {
      // Match the item description toolbar by letting controls wrap without adding toolbar save.
    }
  };
  return NotableCombatDescriptionMenuClass;
}

function configureNotableCombatDescriptionPlugins(event) {
  const editor = event.target;
  if (!editor?.matches?.('prose-mirror.pc-notable-combat-description-editor[name="combatDescription"]')) return;
  if (!editor.closest?.(".pc-notable-combat-tag-editor")) return;

  const prosemirror = foundry?.prosemirror;
  const MenuClass = getNotableCombatDescriptionMenuClass();
  const plugins = event.plugins ?? event.detail;
  if (!prosemirror?.defaultSchema || !MenuClass || !plugins) return;

  plugins.menu = MenuClass.build(prosemirror.defaultSchema, {
    destroyOnSave: editor.hasAttribute("toggled")
  });
}

function registerNotableCombatDescriptionEditor() {
  if (notableCombatDescriptionPluginListenerRegistered) return;
  const document = globalThis.document;
  if (!document?.addEventListener) return;
  document.addEventListener("plugins", configureNotableCombatDescriptionPlugins, { capture: true });
  notableCombatDescriptionPluginListenerRegistered = true;
}

function getDefaultCombatImage() {
  return foundry?.utils?.getProperty?.(CONFIG, "Item.documentClass.DEFAULT_ICON")
    || foundry?.utils?.getProperty?.(CONFIG, "Item.defaultIcon")
    || "icons/svg/sword.svg";
}

function getDefaultEffectIcon() {
  return foundry?.utils?.getProperty?.(CONFIG, "ActiveEffect.documentClass.DEFAULT_ICON")
    || foundry?.utils?.getProperty?.(CONFIG, "ActiveEffect.defaultIcon")
    || "icons/svg/aura.svg";
}

function getActiveEffectTypeLabel(type) {
  const key = CONFIG?.ActiveEffect?.typeLabels?.[type];
  if (key && game?.i18n?.has?.(key)) return game.i18n.localize(key);
  if (type === "base") return "Base";
  if (type === "enchantment") return "Enchantment";
  if (type === PC_NOTABLE_COMBAT_EFFECT_TYPE) return "Skill";
  return "";
}

function formatSearchText(...parts) {
  return parts.map(part => String(part ?? "").trim().toLowerCase()).filter(Boolean).join(" ");
}

function getContextMenuClass() {
  return foundry?.applications?.ux?.ContextMenu?.implementation
    ?? globalThis.ContextMenu?.implementation
    ?? globalThis.ContextMenu
    ?? null;
}

function getNotableCombatEffectIds(combatData) {
  if (!Array.isArray(combatData?.effectIds)) return [];
  const seen = new Set();
  const ids = [];
  for (const id of combatData.effectIds) {
    const value = String(id ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

function prepareNotableCombatEffectContext(actor, combatData, { groupedByType = true, sortMode = "manual" } = {}) {
  const typeLabel = "Skill";
  const effects = getNotableCombatEffectIds(combatData).map((id, index) => {
    const effect = actor?.effects?.get?.(id);
    if (!effect) return null;
    const status = effect.disabled ? "Disabled" : "Enabled";
    const name = effect.name ?? effect.label ?? "Effect";
    return {
      id: effect.id,
      type: PC_NOTABLE_COMBAT_EFFECT_TYPE,
      typeLabel,
      name,
      icon: effect.img || effect.icon || getDefaultEffectIcon(),
      disabled: !!effect.disabled,
      status,
      subtitle: typeLabel ? `${typeLabel} - ${status}` : status,
      searchText: formatSearchText(name, typeLabel, status),
      sort: Number.isFinite(Number(effect.sort)) ? Number(effect.sort) : index,
      sortName: formatSearchText(name, typeLabel)
    };
  }).filter(Boolean);

  const effectSections = PC_NOTABLE_COMBAT_EFFECT_SECTIONS.map(section => {
    const sectionEffects = effects.filter(effect => effect.type === section.type);
    return {
      ...section,
      label: getActiveEffectTypeLabel(section.type) || section.type,
      visible: sectionEffects.length > 0,
      effects: sectionEffects
    };
  });
  const sortConfig = PC_NOTABLE_EFFECT_SORT_MODES[sortMode] ?? PC_NOTABLE_EFFECT_SORT_MODES.manual;

  return {
    effects,
    effectSections,
    effectFlatSection: {
      type: "all",
      label: "All Effects",
      icon: "fa-solid fa-bolt",
      visible: effects.length > 0,
      effects
    },
    hasEffects: effects.length > 0,
    effectsGroupedByType: groupedByType,
    effectGroupToggle: {
      active: groupedByType,
      pressed: groupedByType ? "true" : "false",
      label: groupedByType ? "Grouped by Type" : "Flat List"
    },
    effectSortToggle: {
      mode: sortMode,
      label: sortConfig.label,
      icon: sortConfig.icon
    }
  };
}

function getNotableCombatEffectFromElement(actor, element) {
  const id = element?.closest?.("[data-pc-notable-combat-effect]")?.dataset?.effectId;
  return id ? actor?.effects?.get?.(id) ?? null : null;
}

function getNotableCombatEffectSortDragData(event) {
  const raw = event?.dataTransfer?.getData?.("text/plain") ?? "";
  if (!raw.startsWith(`${PC_NOTABLE_EFFECT_DRAG_PREFIX}:`)) return null;
  const [, actorUuid, effectId] = raw.match(/^peasant-core\.notable-combat-effect-sort:(.+):([^:]+)$/) ?? [];
  return actorUuid && effectId ? { actorUuid, effectId } : null;
}

function clearNotableCombatEffectDragMarkers(root) {
  for (const row of qsa(root, "[data-pc-notable-combat-effect]")) {
    row.classList.remove("drag-over-top", "drag-over-bottom");
  }
}

function isNotableCombatEffectDropAfter(row, clientY) {
  const rect = row.getBoundingClientRect();
  return clientY >= rect.top + (rect.height / 2);
}

function getNotableCombatEffectRowsInList(list) {
  return qsa(list, "[data-pc-notable-combat-effect]:not([hidden])");
}

function getNotableCombatEffectDropTargetRow(target, list) {
  return target?.closest?.("[data-pc-notable-combat-effect]") ?? getNotableCombatEffectRowsInList(list).at(-1) ?? null;
}

function normalizeRankInputValue(raw) {
  const match = String(raw || "").match(/[1234uU]/);
  return match ? match[0] : "";
}

function finalizeRankInputValue(raw) {
  const normalized = normalizeRankInputValue(raw);
  return normalized === "" ? "1" : normalized;
}

function getCombatTypeOptions(activeType) {
  const current = String(activeType || "Other");
  return COMBAT_TYPE_OPTIONS.map(option => ({
    ...option,
    selected: option.value === current
  }));
}

registerNotableCombatDescriptionEditor();

export function setupNotableCombatTagEditorControls(sheet, html) {
  html.on("click", ".combat-desc-btn", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      const btn = $(ev.currentTarget);
      const row = btn.closest(".combat-item");
      let index = parseInt(row.attr("data-combat-index"));
      if (Number.isNaN(index)) index = row.index();
      if (Number.isNaN(index)) return;
      await openNotableCombatTagEditor(sheet, index);
    } catch (e) {
      pcLog.debug("combat-desc-btn handler failed", e);
    }
  });
}

export async function openNotableCombatTagEditor(sheet, index) {
  try {
    if (Number.isNaN(index) || index === undefined || index === null) return;

    const applicationOptions = typeof sheet?._withDetachedOptions === "function"
      ? sheet._withDetachedOptions({
        position: {
          width: 560,
          height: "auto"
        }
      })
      : {
        position: {
          width: 560,
          height: "auto"
        }
      };

    const application = new PeasantNotableCombatTagEditorApp(sheet, index, applicationOptions);
    return renderSheetOwnedApplication(sheet, `combat-tags-${index}`, application);
  } catch (e) {
    pcLog.debug("openCombatTagEditor failed", e);
  }
}

class PeasantNotableCombatTagEditorApp extends NotableCombatTagEditorBase {
  _pcNotableCombatEffectsGroupedByType = true;
  _pcNotableCombatEffectSortMode = "manual";
  _pcNotableCombatEffectDragState = null;

  constructor(sheet, combatIndex, options = {}) {
    const combatName = getCombatData(sheet, combatIndex).name || "Combat";
    const appOptions = foundry.utils.mergeObject({
      id: `peasant-combat-tag-${sheet.id}-${combatIndex}`,
      classes: ["peasant-core", "peasant-tag-editor", "pc-notable-combat-tag-editor", "standard-form"],
      position: {
        width: 560,
        height: "auto"
      },
      window: {
        title: `Combat: ${combatName}`,
        icon: "fa-solid fa-bolt",
        resizable: true
      }
    }, options, { inplace: false });
    super(appOptions);

    this.sheet = sheet;
    this.combatIndex = combatIndex;
    this._controlsBound = false;
    this._boundElement = null;
    this._tagEditor = null;
    this._activeTab = "description";
  }

  static get DEFAULT_OPTIONS() {
    return foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
      window: {
        minimizable: true,
        resizable: true
      }
    }, { inplace: false });
  }

  static get PARTS() {
    return {
      body: {
        template: TAG_EDITOR_BODY_TEMPLATE
      },
      footer: {
        template: TAG_EDITOR_FOOTER_TEMPLATE
      }
    };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const combatData = this._getCombatData();
    const isStandard = !combatData.type || combatData.type === "standard";
    const rank = String(combatData.rank ?? "0").trim();
    const combatName = combatData.name || "";
    const combatType = String(combatData.type || "Other");
    const combatTypeKey = combatType.toLowerCase();
    const allowToHitAcc = isStandard || !NO_TO_HIT_ACCURACY_TYPES.has(combatTypeKey);
    const specialGradeLabel = SPECIAL_GRADE_LABELS[combatType] || "";
    const specialGrade = Number.parseInt(combatData.specialGrade, 10);
    const specialGradeInput = Number.isFinite(specialGrade) && specialGrade > 0 ? specialGrade : "";
    const effectContext = prepareNotableCombatEffectContext(this.sheet.actor, combatData, {
      groupedByType: this._areNotableCombatEffectsGroupedByType(),
      sortMode: this._getNotableCombatEffectSortMode()
    });
    return Object.assign(context, {
      combatName,
      combatClassInput: Number.parseInt(combatData.class, 10) || 1,
      combatRankInput: rank || "0",
      combatToHitInput: formatOptionalIntegerInput(combatData.tohit),
      combatAccuracyInput: formatOptionalIntegerInput(combatData.accuracy, { showPlus: true }),
      combatType,
      combatTypeOptions: getCombatTypeOptions(combatType),
      combatImageAlt: combatName || "Notable Combat",
      combatImageSrc: String(combatData.img || "").trim() || getDefaultCombatImage(),
      combatDescription: combatData.description || "",
      documentUuid: this.sheet.actor?.uuid || "",
      editable: this.sheet?.isEditable !== false && this.sheet?.isEditMode !== false,
      allowToHitAcc,
      isSignature: !!combatData.sig,
      isStandard,
      showSpecialGradeInput: !!specialGradeLabel,
      specialGradeInput,
      specialGradeLabel,
      ...effectContext
    });
  }

  async _onRender(context, options) {
    if (typeof super._onRender === "function") await super._onRender(context, options);

    const $container = $(this.element);
    if (!this._controlsBound || this._boundElement !== $container[0]) {
      this._tagEditor = createNotableCombatTagEditorState($container);
      this._bindTagEditorControls($container);
      this._boundElement = $container[0];
      this._controlsBound = true;
    }

    this._renderCurrentTags($container);
    this._syncDescriptionEditorFromData($container);
    this._applyActiveTab($container);
    this._bindNotableCombatEffectControls($container);
    this._tagEditor?.syncUi();
  }

  _bindTagEditorControls($container) {
    const buildTagInputs = (tagType) => {
      renderNotableCombatTagInputs($container, tagType, this._getCombatData(), {
        tagEditorState: this._tagEditor.state
      });
    };

    this._bindLayoutControls($container);
    this._bindNotableCombatEffectControls($container);

    setupNotableCombatTagSelectionControls($container, {
      tagEditor: this._tagEditor,
      buildTagInputs,
      openDescriptionEditor: () => this._showDescriptionTab($container)
    });

    setupNotableCombatTagRemoveControls(this.sheet, $container, this.combatIndex, {
      onChanged: () => {
        this._renderCurrentTags($container);
        this._syncDescriptionEditorFromData($container);
      }
    });

    setupNotableCombatTagSaveControls(this.sheet, $container, this.combatIndex, {
      tagEditor: this._tagEditor,
      getCombatData: () => this._getCombatData(),
      openDescriptionEditor: () => this._showDescriptionTab($container),
      onChanged: () => this._renderCurrentTags($container)
    });
  }

  _bindLayoutControls($container) {
    $container.on("click", "[data-pc-notable-combat-tab]", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._setActiveTab(ev.currentTarget?.dataset?.pcNotableCombatTab, $container);
    });

    $container.on("click", "[data-pc-notable-combat-open-effect]", (ev) => {
      this._onOpenNotableCombatEffectClick(ev);
    });

    $container.on("click", ".pc-notable-combat-description-save", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await this._saveDescription($container);
    });

    $container.on("input", ".pc-notable-combat-tohit-input", (ev) => {
      ev.currentTarget.value = sanitizeOptionalIntegerInputValue(ev.currentTarget.value);
    });

    $container.on("input", ".pc-notable-combat-accuracy-input", (ev) => {
      ev.currentTarget.value = sanitizeOptionalIntegerInputValue(ev.currentTarget.value, { allowSign: true });
    });

    $container.on("keydown", ".pc-notable-combat-rank-input", (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (RANK_NAVIGATION_KEYS.has(ev.key)) return;
      if (!/^[1234uU]$/.test(ev.key)) ev.preventDefault();
    });

    $container.on("input", ".pc-notable-combat-rank-input", (ev) => {
      const before = ev.currentTarget.value || "";
      const normalized = normalizeRankInputValue(before);
      if (normalized !== before) ev.currentTarget.value = normalized;
    });

    $container.on("blur", ".pc-notable-combat-rank-input", (ev) => {
      const finalValue = finalizeRankInputValue(ev.currentTarget.value);
      if (finalValue !== ev.currentTarget.value) ev.currentTarget.value = finalValue;
    });

    $container.on("change", ".pc-notable-combat-name-input, .pc-notable-combat-class-input, .pc-notable-combat-rank-input, .pc-notable-combat-tohit-input, .pc-notable-combat-accuracy-input, .pc-notable-combat-special-grade-input", async () => {
      await this._saveMainFields($container);
    });

    $container.on("change", ".pc-notable-combat-type-select", async (ev) => {
      await this._setCombatType(ev.currentTarget?.value);
    });

    $container.on("click", ".pc-notable-combat-toggle-type", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await this._switchToSpecialType();
    });

    $container.on("click", "[data-pc-notable-combat-image-picker]", async (ev) => {
      await this._openCombatImagePicker(ev, $container);
    });

    $container.on("click", "[data-pc-notable-combat-image-frame]", (ev) => {
      if (ev.target?.closest?.("[data-pc-notable-combat-image-picker]")) return;
      if (this.sheet?.isEditable !== false && this.sheet?.isEditMode !== false) return;
      ev.preventDefault();
      this._openCombatImagePopout();
    });
  }

  _bindNotableCombatEffectControls($container) {
    const root = $container[0];
    const browser = qs(root, "[data-pc-notable-combat-effects-browser]");
    if (!browser) return;

    if (browser.dataset.pcNotableCombatEffectsBound === "true") {
      this._applyNotableCombatEffectGroupMode(root);
      return;
    }
    browser.dataset.pcNotableCombatEffectsBound = "true";

    delegate(browser, "input", "[data-pc-notable-combat-effects-search]", () => this._applyNotableCombatEffectSearch(root));

    delegate(browser, "click", "[data-pc-notable-combat-add-effect]", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this._createNotableCombatEffect($container);
    });

    delegate(browser, "click", "[data-pc-notable-combat-effects-group-toggle]", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._pcNotableCombatEffectsGroupedByType = !this._areNotableCombatEffectsGroupedByType();
      this._applyNotableCombatEffectGroupMode(root);
    });

    delegate(browser, "click", "[data-pc-notable-combat-effects-sort-toggle]", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const mode = this._getNotableCombatEffectSortMode();
      this._pcNotableCombatEffectSortMode = PC_NOTABLE_EFFECT_SORT_MODES[mode].next;
      this._sortNotableCombatEffectRows(root);
      this._syncNotableCombatEffectSortToggle(root);
      this._syncNotableCombatEffectDragState(root);
      this._applyNotableCombatEffectSearch(root);
    });

    this._setupNotableCombatEffectContextMenu(browser);
    this._setupNotableCombatEffectManualSortControls(root, browser);
    this._applyNotableCombatEffectGroupMode(root);
  }

  _onOpenNotableCombatEffectClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const effect = getNotableCombatEffectFromElement(this.sheet.actor, event.currentTarget);
    this._openNotableCombatEffectSheet(effect);
  }

  _getNotableCombatEffectSortMode() {
    if (!PC_NOTABLE_EFFECT_SORT_MODES[this._pcNotableCombatEffectSortMode]) this._pcNotableCombatEffectSortMode = "manual";
    return this._pcNotableCombatEffectSortMode;
  }

  _areNotableCombatEffectsGroupedByType() {
    return this._pcNotableCombatEffectsGroupedByType !== false;
  }

  _syncNotableCombatEffectSortToggle(root) {
    const toggle = qs(root, "[data-pc-notable-combat-effects-sort-toggle]");
    if (!toggle) return;

    const mode = this._getNotableCombatEffectSortMode();
    const config = PC_NOTABLE_EFFECT_SORT_MODES[mode];
    toggle.classList.add("active");
    toggle.dataset.sortMode = mode;
    toggle.setAttribute("aria-pressed", "true");
    toggle.dataset.tooltip = config.label;
    toggle.setAttribute("aria-label", config.label);
    qs(toggle, "i")?.setAttribute("class", config.icon);
  }

  _canReorderNotableCombatEffects() {
    return this.sheet?.canModifyActor && this.sheet?.isEditMode !== false && this._getNotableCombatEffectSortMode() === "manual";
  }

  _syncNotableCombatEffectDragState(root) {
    const browser = qs(root, "[data-pc-notable-combat-effects-browser]");
    if (!browser) return;

    const enabled = this._canReorderNotableCombatEffects();
    browser.dataset.pcNotableCombatEffectsSortMode = this._getNotableCombatEffectSortMode();
    browser.classList.toggle("pc-inventory-manual-sort", enabled);
    for (const row of qsa(browser, "[data-pc-notable-combat-effect]")) {
      row.draggable = enabled;
      row.classList.toggle("pc-inventory-sortable", enabled);
      if (!enabled) row.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
    }
  }

  _sortNotableCombatEffectRows(root) {
    const browser = qs(root, "[data-pc-notable-combat-effects-browser]");
    if (!browser) return;

    const mode = this._getNotableCombatEffectSortMode();
    for (const list of qsa(browser, ".pc-item-effects-items")) {
      const rows = qsa(list, "[data-pc-notable-combat-effect]");
      rows.sort((left, right) => {
        if (mode === "alpha") {
          const byName = String(left.dataset.sortAlpha ?? "").localeCompare(String(right.dataset.sortAlpha ?? ""));
          if (byName !== 0) return byName;
        }
        const byManual = (Number(left.dataset.sortManual) || 0) - (Number(right.dataset.sortManual) || 0);
        if (byManual !== 0) return byManual;
        return String(left.dataset.sortAlpha ?? "").localeCompare(String(right.dataset.sortAlpha ?? ""));
      });
      list.append(...rows);
    }
  }

  _applyNotableCombatEffectSearch(root) {
    const browser = qs(root, "[data-pc-notable-combat-effects-browser]");
    if (!browser) return;

    const input = qs(browser, "[data-pc-notable-combat-effects-search]");
    const query = String(input?.value ?? "").trim().toLowerCase();
    const activeView = qs(browser, "[data-pc-notable-combat-effects-view]:not([hidden])") ?? browser;
    let matchingRows = 0;
    let totalRows = 0;

    for (const section of qsa(activeView, "[data-pc-notable-combat-effects-section]")) {
      const rows = qsa(section, "[data-pc-notable-combat-effect]");
      let sectionMatches = 0;
      for (const row of rows) {
        totalRows += 1;
        const matches = !query || String(row.dataset.search ?? "").includes(query);
        row.hidden = !matches;
        if (matches) {
          sectionMatches += 1;
          matchingRows += 1;
        }
      }
      section.hidden = !!query && sectionMatches === 0;
    }

    const empty = qs(browser, ".pc-notable-combat-effects-search-empty");
    if (empty) empty.hidden = !query || totalRows === 0 || matchingRows > 0;
  }

  _applyNotableCombatEffectGroupMode(root) {
    const browser = qs(root, "[data-pc-notable-combat-effects-browser]");
    if (!browser) return;

    const grouped = this._areNotableCombatEffectsGroupedByType();
    const activeView = grouped ? "grouped" : "flat";
    browser.dataset.pcNotableCombatEffectsGrouped = grouped ? "true" : "false";

    for (const view of qsa(browser, "[data-pc-notable-combat-effects-view]")) {
      view.hidden = view.dataset.pcNotableCombatEffectsView !== activeView;
    }

    const toggle = qs(browser, "[data-pc-notable-combat-effects-group-toggle]");
    if (toggle) {
      toggle.classList.toggle("active", grouped);
      toggle.setAttribute("aria-pressed", grouped ? "true" : "false");
      const label = grouped ? "Grouped by Type" : "Flat List";
      toggle.dataset.tooltip = label;
      toggle.setAttribute("aria-label", label);
    }

    this._sortNotableCombatEffectRows(root);
    this._syncNotableCombatEffectSortToggle(root);
    this._syncNotableCombatEffectDragState(root);
    this._applyNotableCombatEffectSearch(root);
  }

  async _reorderNotableCombatEffect(sourceEffect, targetRow, { sortBefore = false } = {}) {
    const targetEffect = getNotableCombatEffectFromElement(this.sheet.actor, targetRow);
    if (!sourceEffect || !targetEffect || sourceEffect.id === targetEffect.id) return;

    const list = targetRow?.closest?.(".pc-item-effects-items");
    if (!list) return;

    const siblings = [];
    for (const row of getNotableCombatEffectRowsInList(list)) {
      const sibling = getNotableCombatEffectFromElement(this.sheet.actor, row);
      if (sibling && sibling.id !== sourceEffect.id) siblings.push(sibling);
    }

    const sortUpdates = foundry.utils.performIntegerSort?.(sourceEffect, {
      target: targetEffect,
      siblings,
      sortBefore
    });
    if (!sortUpdates?.length) return;

    const updateData = sortUpdates.map(({ target, update }) => ({
      ...update,
      _id: target.id ?? target._id
    }));
    await this.sheet.actor.updateEmbeddedDocuments("ActiveEffect", updateData);
  }

  _setupNotableCombatEffectManualSortControls(root, browser) {
    delegate(browser, "dragstart", "[data-pc-notable-combat-effect]", (event, row) => {
      if (!this._canReorderNotableCombatEffects() || event.target?.closest?.(PC_NOTABLE_EFFECT_DRAG_BLOCK_SELECTOR)) {
        event.preventDefault();
        return;
      }

      const effect = getNotableCombatEffectFromElement(this.sheet.actor, row);
      const list = row.closest(".pc-item-effects-items");
      if (!effect || !list) {
        event.preventDefault();
        return;
      }

      row.classList.add("dragging");
      this._pcNotableCombatEffectDragState = {
        actorUuid: this.sheet.actor?.uuid,
        effectId: effect.id,
        list
      };

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `${PC_NOTABLE_EFFECT_DRAG_PREFIX}:${this.sheet.actor.uuid}:${effect.id}`);
        const dragImage = qs(row, ".pc-item-effect-row") ?? row;
        const box = dragImage.getBoundingClientRect();
        event.dataTransfer.setDragImage(dragImage, Math.min(box.width - 6, 48), box.height / 2);
      }
    });

    delegate(browser, "dragend", "[data-pc-notable-combat-effect]", (_event, row) => {
      row.classList.remove("dragging");
      clearNotableCombatEffectDragMarkers(root);
      this._pcNotableCombatEffectDragState = null;
    });

    delegate(browser, "dragover", ".pc-item-effects-items, [data-pc-notable-combat-effect]", (event, target) => {
      if (!this._canReorderNotableCombatEffects() || !this._pcNotableCombatEffectDragState) return;

      const list = target.closest?.(".pc-item-effects-items");
      if (!list || list !== this._pcNotableCombatEffectDragState.list) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearNotableCombatEffectDragMarkers(root);

      const targetRow = getNotableCombatEffectDropTargetRow(event.target, list);
      if (!targetRow || targetRow.dataset.effectId === this._pcNotableCombatEffectDragState.effectId) return;
      targetRow.classList.toggle("drag-over-bottom", isNotableCombatEffectDropAfter(targetRow, event.clientY));
      targetRow.classList.toggle("drag-over-top", !isNotableCombatEffectDropAfter(targetRow, event.clientY));
    });

    delegate(browser, "dragleave", ".pc-item-effects-items", () => {
      clearNotableCombatEffectDragMarkers(root);
    });

    delegate(browser, "drop", ".pc-item-effects-items, [data-pc-notable-combat-effect]", async (event, target) => {
      const dragData = getNotableCombatEffectSortDragData(event);
      if (!this._canReorderNotableCombatEffects() || !this._pcNotableCombatEffectDragState || dragData?.actorUuid !== this.sheet.actor?.uuid) return;

      const list = target.closest?.(".pc-item-effects-items");
      if (!list || list !== this._pcNotableCombatEffectDragState.list) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      clearNotableCombatEffectDragMarkers(root);

      const sourceEffect = this.sheet.actor?.effects?.get?.(dragData.effectId);
      const targetRow = getNotableCombatEffectDropTargetRow(event.target, list);
      if (!sourceEffect || !targetRow || targetRow.dataset.effectId === sourceEffect.id) {
        this._pcNotableCombatEffectDragState = null;
        return;
      }

      try {
        await this._reorderNotableCombatEffect(sourceEffect, targetRow, {
          sortBefore: !isNotableCombatEffectDropAfter(targetRow, event.clientY)
        });
      } finally {
        this._pcNotableCombatEffectDragState = null;
      }
    });
  }

  _setupNotableCombatEffectContextMenu(browser) {
    if (!this.sheet?.canModifyActor) return;

    const ContextMenuClass = getContextMenuClass();
    if (!ContextMenuClass) return;

    new ContextMenuClass(browser, "[data-pc-notable-combat-effect-menu]", [], {
      eventName: "click",
      fixed: true,
      jQuery: false,
      relative: "target",
      onOpen: element => {
        const effect = getNotableCombatEffectFromElement(this.sheet.actor, element);
        if (!effect) return;
        ui.context.menuItems = this._getNotableCombatEffectContextOptions(effect);
      }
    });
  }

  _getNotableCombatEffectContextOptions(effect) {
    return [
      {
        label: "Edit",
        icon: "fa-solid fa-pen-to-square",
        onClick: () => this._openNotableCombatEffectSheet(effect, { mode: "edit" })
      },
      {
        label: "Duplicate",
        icon: "fa-solid fa-copy",
        onClick: async () => this._duplicateNotableCombatEffect(effect)
      },
      {
        label: "Delete",
        icon: "fa-solid fa-trash",
        onClick: async () => this._deleteNotableCombatEffect(effect)
      }
    ];
  }

  _openNotableCombatEffectSheet(effect, { mode = null } = {}) {
    const sheet = effect?.sheet;
    if (!sheet || typeof sheet.render !== "function") return;
    const modes = sheet.constructor?.MODES ?? {};
    if (mode === "edit" && modes.EDIT !== undefined) return sheet.render({ force: true, mode: modes.EDIT });
    return sheet.render(true);
  }

  _getCurrentNotableCombatEffectIds() {
    return getNotableCombatEffectIds(this._getCombatData());
  }

  async _setCurrentNotableCombatEffectIds(effectIds) {
    const seen = new Set();
    const ids = [];
    for (const id of effectIds) {
      const value = String(id ?? "").trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      ids.push(value);
    }
    await this.sheet.actor.updatePeasantNotableCombat?.(this.combatIndex, { effectIds: ids }, { render: false });
    return ids;
  }

  async _addNotableCombatEffectId(effectId) {
    await this._setCurrentNotableCombatEffectIds([...this._getCurrentNotableCombatEffectIds(), effectId]);
  }

  async _removeNotableCombatEffectId(effectId) {
    const removeId = String(effectId ?? "").trim();
    await this._setCurrentNotableCombatEffectIds(this._getCurrentNotableCombatEffectIds().filter(id => id !== removeId));
  }

  async _createNotableCombatEffect($container = $(this.element)) {
    if (!this.sheet?.canModifyActor || this.sheet?.isEditMode === false) return;

    await this._saveMainFields($container);
    const combatData = this._getCombatData();
    const combatName = String(combatData.name || "").trim() || "Skill";
    const created = await this.sheet.actor?.createEmbeddedDocuments?.("ActiveEffect", [{
      type: PC_NOTABLE_COMBAT_EFFECT_TYPE,
      name: `${combatName} Effect`,
      img: String(combatData.img || "").trim() || this.sheet.actor?.img || getDefaultEffectIcon(),
      origin: this.sheet.actor?.uuid
    }]);
    const effect = created?.[0] ?? null;
    if (!effect) return;

    await this._addNotableCombatEffectId(effect.id);
    await this.render({ force: true });
    this._openNotableCombatEffectSheet(effect, { mode: "edit" });
  }

  async _duplicateNotableCombatEffect(effect) {
    if (!effect || !this.sheet?.canModifyActor) return null;
    const effectName = effect.name ?? effect.label ?? "Active Effect";
    const name = game.i18n?.format?.("DOCUMENT.CopyOf", { name: effectName })
      ?? `Copy of ${effectName}`;

    let duplicate = null;
    const duplicateData = {
      name,
      type: PC_NOTABLE_COMBAT_EFFECT_TYPE
    };
    if (typeof effect.clone === "function") {
      duplicate = await effect.clone(duplicateData, { save: true, addSource: true });
    } else {
      const source = effect.toObject?.() ?? effect._source ?? null;
      if (!source) return null;
      const data = foundry.utils.deepClone(source);
      delete data._id;
      foundry.utils.mergeObject(data, duplicateData);
      const created = await this.sheet.actor?.createEmbeddedDocuments?.("ActiveEffect", [data]);
      duplicate = created?.[0] ?? null;
    }

    if (duplicate) {
      await this._addNotableCombatEffectId(duplicate.id);
      await this.render({ force: true });
    }
    return duplicate;
  }

  async _deleteNotableCombatEffect(effect) {
    if (!effect || !this.sheet?.canModifyActor) return;
    const id = effect.id;
    if (typeof effect.deleteDialog === "function") {
      await effect.deleteDialog({}, { render: false });
    } else {
      await effect.delete();
    }
    if (!this.sheet.actor?.effects?.get?.(id)) {
      await this._removeNotableCombatEffectId(id);
      await this.render({ force: true });
    }
  }

  _getCombatData() {
    return getCombatData(this.sheet, this.combatIndex);
  }

  _renderCurrentTags($container = $(this.element)) {
    const $list = $container.find(".current-tags-list");
    const activeTags = getActiveNotableCombatEditorTags(this._getCombatData());
    renderNotableCombatTagList($list, activeTags);

    setupNotableCombatTagEditorDrag(this.sheet, $container, this.combatIndex, {
      onChanged: () => this._renderCurrentTags($container)
    });
  }

  _syncDescriptionEditorFromData($container = $(this.element)) {
    const editor = $container[0]?.querySelector?.('prose-mirror[name="combatDescription"]');
    if (!editor) return;
    const description = this._getCombatData().description || "";
    const previousSaved = editor.dataset.pcSavedDescription ?? "";
    if (editor.dataset.pcDescriptionReady === "true" && String(editor.value ?? "") !== previousSaved) return;
    editor.value = description;
    editor.dataset.pcSavedDescription = description;
    editor.dataset.pcDescriptionReady = "true";
  }

  _getDescriptionContent($container = $(this.element)) {
    const editor = $container[0]?.querySelector?.('prose-mirror[name="combatDescription"]');
    if (!editor) throw new Error("Combat description editor did not render.");
    if (typeof editor.save === "function" && (typeof editor.isDirty !== "function" || editor.isDirty())) {
      editor.save();
    }
    return String(editor.value ?? "");
  }

  async _saveDescription($container = $(this.element)) {
    try {
      const description = this._getDescriptionContent($container);
      await this.sheet.actor.setPeasantNotableCombatDescription?.(this.combatIndex, description, { render: false });
      const editor = $container[0]?.querySelector?.('prose-mirror[name="combatDescription"]');
      if (editor) {
        editor.dataset.pcSavedDescription = description;
        editor.dataset.pcDescriptionReady = "true";
      }
      this._renderCurrentTags($container);
      ui.notifications?.info?.("Description saved.");
    } catch (err) {
      console.error("Failed to save combat description:", err);
      ui.notifications?.error?.("Failed to save combat description. See console for details.");
    }
  }

  async _saveMainFields($container = $(this.element)) {
    const root = $container[0];
    const nameEl = root?.querySelector?.(".pc-notable-combat-name-input");
    const classEl = root?.querySelector?.(".pc-notable-combat-class-input");
    const rankEl = root?.querySelector?.(".pc-notable-combat-rank-input");
    const tohitEl = root?.querySelector?.(".pc-notable-combat-tohit-input");
    const accuracyEl = root?.querySelector?.(".pc-notable-combat-accuracy-input");
    const specialGradeEl = root?.querySelector?.(".pc-notable-combat-special-grade-input");

    const fields = {};
    if (nameEl) fields.name = nameEl.value;
    if (classEl) fields.class = classEl.value;
    if (rankEl) {
      rankEl.value = finalizeRankInputValue(rankEl.value);
      fields.rank = rankEl.value;
    }
    if (tohitEl) fields.tohit = tohitEl.value;
    if (accuracyEl) fields.accuracy = accuracyEl.value;
    if (specialGradeEl) fields.specialGrade = specialGradeEl.value;
    if (Object.keys(fields).length === 0) return;

    try {
      const result = await this.sheet.actor.setPeasantNotableCombatMainFields?.(this.combatIndex, fields, { render: false });
      const savedCombat = result?.combats?.[this.combatIndex] || this._getCombatData();
      if (nameEl) nameEl.value = savedCombat.name || "";
      if (classEl) classEl.value = Number.parseInt(savedCombat.class, 10) || 1;
      if (rankEl) rankEl.value = String(savedCombat.rank ?? "0");
      if (tohitEl) tohitEl.value = formatOptionalIntegerInput(savedCombat.tohit ?? parseOptionalInteger(fields.tohit, { min: 1 }));
      if (accuracyEl) accuracyEl.value = formatOptionalIntegerInput(savedCombat.accuracy ?? parseOptionalInteger(fields.accuracy, { allowSign: true }), { showPlus: true });
      if (specialGradeEl) specialGradeEl.value = Number.parseInt(savedCombat.specialGrade, 10) || "";
    } catch (err) {
      console.warn("Failed to persist combat field change:", err);
    }
  }

  async _switchToSpecialType() {
    if (this.sheet?.isEditable === false || this.sheet?.isEditMode === false) return;
    try {
      await this.sheet.actor.setPeasantNotableCombatType?.(this.combatIndex, "Other", {
        clearStandardFields: true,
        render: false
      });
      await this.render({ force: true });
    } catch (err) {
      console.warn("Failed to switch combat to special type:", err);
    }
  }

  async _setCombatType(type) {
    if (this.sheet?.isEditable === false || this.sheet?.isEditMode === false) return;
    const nextType = String(type || "standard");
    try {
      await this.sheet.actor.setPeasantNotableCombatType?.(this.combatIndex, nextType, { render: false });
      await this.render({ force: true });
    } catch (err) {
      console.warn("Failed to change combat type:", err);
    }
  }

  async _openCombatImagePicker(event, $container = $(this.element)) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (this.sheet?.isEditable === false || this.sheet?.isEditMode === false) return;
    if (!FilePickerClass) return;

    const picker = new FilePickerClass({
      type: "image",
      current: this._getCombatData().img || getDefaultCombatImage(),
      callback: async path => this._setCombatImage(path, $container)
    });
    picker.render(true);
  }

  _openCombatImagePopout() {
    const src = this._getCombatData().img || getDefaultCombatImage();
    if (!src) return;
    try {
      if (ImagePopoutClass) {
        const popout = new ImagePopoutClass({
          src,
          uuid: this.sheet.actor?.uuid,
          window: { title: `${this._getCombatData().name || "Notable Combat"} - Image` }
        });
        popout.render(true);
      } else {
        window.open(src, "_blank");
      }
    } catch (err) {
      window.open(src, "_blank");
    }
  }

  async _setCombatImage(path, $container = $(this.element)) {
    const nextPath = String(path ?? "").trim();
    if (!nextPath || this.sheet?.isEditable === false || this.sheet?.isEditMode === false) return;

    await this.sheet.actor.setPeasantNotableCombatImage?.(this.combatIndex, nextPath, { render: false });
    const image = $container[0]?.querySelector?.(".pc-notable-combat-image-frame .pc-item-image");
    if (image) image.src = nextPath;
  }

  _showDescriptionTab($container = $(this.element)) {
    this._setActiveTab("description", $container);
    const editor = $container[0]?.querySelector?.('prose-mirror[name="combatDescription"]');
    editor?.focus?.();
  }

  _setActiveTab(tab, $container = $(this.element)) {
    const normalized = String(tab ?? "").trim();
    if (!TAG_EDITOR_TABS.has(normalized)) return;
    this._activeTab = normalized;
    this._applyActiveTab($container);
  }

  _applyActiveTab($container = $(this.element)) {
    const activeTab = TAG_EDITOR_TABS.has(this._activeTab) ? this._activeTab : "description";
    const root = $container[0];
    if (!root) return;

    for (const tabButton of root.querySelectorAll("[data-pc-notable-combat-tab]")) {
      const active = tabButton.dataset.pcNotableCombatTab === activeTab;
      tabButton.classList.toggle("active", active);
      tabButton.setAttribute("aria-selected", active ? "true" : "false");
      tabButton.tabIndex = active ? 0 : -1;
    }

    for (const panel of root.querySelectorAll("[data-pc-notable-combat-panel]")) {
      const active = panel.dataset.pcNotableCombatPanel === activeTab;
      panel.classList.toggle("active", active);
      panel.toggleAttribute("hidden", !active);
      panel.setAttribute("aria-hidden", active ? "false" : "true");
    }

    for (const footerControl of root.querySelectorAll("[data-pc-notable-combat-footer]")) {
      footerControl.toggleAttribute("hidden", footerControl.dataset.pcNotableCombatFooter !== activeTab);
    }
  }

  _onClose(options) {
    if (typeof super._onClose === "function") super._onClose(options);
    if (options?.ownedSheetClosing || options?.ownedReplacement) return;
    this.sheet?.render?.(false);
  }
}

function getCombatData(sheet, combatIndex) {
  return sheet.actor.system.notableCombats?.[combatIndex] || {};
}
