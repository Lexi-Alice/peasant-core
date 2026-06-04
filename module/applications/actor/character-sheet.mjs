import { PeasantCharacterModel, PC_ACTOR_SETTING_DEFINITIONS, PC_ART_PANEL_COLLAPSED_FLAG, PC_SIMPLIFIED_HP_FLAG, isPeasantCharacterType, sanitizePeasantCoreSettingNumber } from "../../data/actor/_module.mjs";
import { PC_CUSTOM_SIR_LOCATION_VALUES_FLAG } from "../../data/actor/identity-options.mjs";
import { formatOptionalIntegerInput, parseOptionalInteger } from "../../data/actor/helpers.mjs";
import { PeasantActor } from "../../documents/_module.mjs";
import { setupBlessingControls } from "./controls/blessing-controls.mjs";
import { setupCombatModifierControls } from "./controls/combat-modifier-controls.mjs";
import { configurePeasantActorSheetHooks } from "./hooks.mjs";
import { drawLocationTableLikeMacro } from "./location-table.mjs";
import { setupDamageHealControls } from "./controls/damage-heal-controls.mjs";
import { refreshOpenHpGridDialogsForSheet } from "./controls/health-stress/hp-grid-dialog.mjs";
import { setupHealthStressControls } from "./controls/health-stress-controls.mjs";
import { refreshOpenStressGridDialogsForSheet } from "./controls/health-stress/stress-grid-dialog.mjs";
import { setupInventoryControls } from "./controls/inventory-controls.mjs";
import { setupSheetKeyboardNavigation } from "./controls/keyboard-navigation.mjs";
import { setupPortraitControls, teardownPortraitBindings } from "./controls/portrait-controls.mjs";
import { closeSheetResourceDialogs } from "./controls/resource-dialogs.mjs";
import { closeSheetOwnedApplications } from "./controls/sheet-owned-apps.mjs";
import { confirmPeasantResourceRefresh, confirmPeasantRest } from "./controls/rest-controls.mjs";
import { setupResourceControls } from "./controls/resource-controls.mjs";
import { rollAttributeSaveFromElement, rollAttributeToHitFromElement, rollCombatFromElement, rollCombatTagFromElement, rollConsciousnessFromElement, rollInitiativeFromElement, rollSkillFromElement } from "./controls/roll-actions.mjs";
import { blurActiveEditableInSheet as blurActiveEditableInSheetHelper, collectAdvantagesFromSheet, createSheetUpdateQueue, initializeSheetSaveQueues, runQueuedInputUpdate as runQueuedInputUpdateHelper, sanitizeOptionalIntegerInputElement } from "./controls/sheet-listener-helpers.mjs";
import { setupWoundsControls } from "./controls/wounds-controls.mjs";
import { prepareActorAdvantageContext, prepareActorAttributeContext, prepareActorEdgeContext, prepareActorHealthResourceContext, prepareActorIdentityContext, prepareActorInventoryContext, prepareActorNotableCombatContext, prepareActorSheetBaseContext, prepareActorSkillContext, prepareActorStressContext } from "./context/sheet-context.mjs";
import { setupNotableCombatControls } from "./notable-combat/notable-combat-controls.mjs";
import { setupNotableCombatDragDropControls } from "./notable-combat/notable-combat-drag-drop.mjs";
import { setupNotableCombatTagEditorControls } from "./notable-combat/notable-combat-tag-editor.mjs";
import { setupBasicSkillAdvantageControls } from "./skills/skill-advantage-controls.mjs";
import { setupSkillAdvantageDescriptionEditors } from "./skills/skill-advantage-description-editors.mjs";
import { setupSkillAdvantageDragDropControls } from "./skills/skill-advantage-drag-drop.mjs";
import { ensureSlideToggleElement } from "../components/slide-toggle.mjs";
import { renderDialogV2 } from "../dialogs.mjs";
import { registerPeasantCoreApi } from "../../utils/api.mjs";
import { pcLog } from "../../utils/logging.mjs";

const ActorSheetV2Class = foundry?.applications?.sheets?.ActorSheetV2;
const HandlebarsApplicationMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;
if (!ActorSheetV2Class || !HandlebarsApplicationMixin) {
  throw new Error("Peasant Core requires Foundry's ActorSheetV2 and HandlebarsApplicationMixin.");
}
const ActorSheetBase = HandlebarsApplicationMixin(ActorSheetV2Class);
const DocumentSheetConfig = foundry?.applications?.apps?.DocumentSheetConfig;
const TokenHUDClass = foundry.applications.hud.TokenHUD;
const TextEditorImplementation = foundry.applications.ux.TextEditor.implementation;
const PC_DEFAULT_SHEET_TEMPLATE = "systems/peasant-core/templates/actor/character-sheet.html";

ensureSlideToggleElement();

function getApplicationElement(appOrElement) {
  const source = appOrElement?.element ?? appOrElement;
  if (!source) return null;
  if (source.nodeType === 1 && typeof source.querySelector === "function") return source;
  if (source instanceof jQuery) return source[0] ?? null;
  if (Array.isArray(source)) return getApplicationElement(source[0]);
  const first = source?.[0];
  return first?.nodeType === 1 && typeof first.querySelector === "function" ? first : null;
}

function getApplicationJQuery(appOrElement) {
  const element = getApplicationElement(appOrElement);
  return element ? $(element) : $();
}

registerPeasantCoreApi({ drawLocationTable: drawLocationTableLikeMacro });

export class PeasantActorSheet extends ActorSheetBase {
  static MODES = {
    PLAY: 1,
    EDIT: 2
  };

  static get SHEET_TEMPLATE() {
    return PC_DEFAULT_SHEET_TEMPLATE;
  }

  static get SHEET_CLASSES() {
    return ["peasant-core", "peasant-actor-sheet", "actor", "character"];
  }

  static get SHEET_WIDTH() {
    return 800;
  }

  static get SHEET_HEIGHT() {
    return 700;
  }

  get title() {
    return this.actor?.name || super.title;
  }

  _mode = null;

  get isEditMode() {
    return this._mode === this.constructor.MODES.EDIT;
  }

  get canModifyActor() {
    return !!this.isEditable;
  }

  get canObserveActor() {
    if (this.canModifyActor) return true;
    const observerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
    try {
      return !!this.actor?.testUserPermission?.(game.user, observerLevel);
    } catch (err) {
      pcLog.debug("Peasant Core | Actor observer permission check failed", err);
      return false;
    }
  }

  get isReadOnlyObserver() {
    return this.canObserveActor && !this.canModifyActor;
  }

  _clearPendingEditAutosaves() {
    if (!(this._pendingEditAutosaveTimers instanceof Map)) {
      this._pendingEditAutosaveTimers = new Map();
      return;
    }
    for (const [el, entry] of this._pendingEditAutosaveTimers.entries()) {
      this._clearPendingEditAutosaveTarget(el, entry);
    }
    this._pendingEditAutosaveTimers.clear();
  }

  _clearPendingEditAutosaveTarget(target, entry = null) {
    if (!target || !(this._pendingEditAutosaveTimers instanceof Map)) return;
    const current = entry ?? this._pendingEditAutosaveTimers.get(target);
    const timeoutId = typeof current === "object" ? current?.timeoutId : current;
    if (timeoutId) clearTimeout(timeoutId);
    if (typeof current?.onChange === "function") {
      try { target.removeEventListener("change", current.onChange); } catch (e) { /* ignore */ }
    }
    this._pendingEditAutosaveTimers.delete(target);
  }

  async _flushPendingEditAutosaves({ triggerChanges = false } = {}) {
    if (!(this._pendingEditAutosaveTimers instanceof Map) || this._pendingEditAutosaveTimers.size === 0) return;

    const pendingTargets = [];
    for (const [el, entry] of this._pendingEditAutosaveTimers.entries()) {
      this._clearPendingEditAutosaveTarget(el, entry);
      if (triggerChanges && el?.isConnected) pendingTargets.push(el);
    }
    this._pendingEditAutosaveTimers.clear();

    if (!triggerChanges || pendingTargets.length === 0) return;
    for (const el of pendingTargets) {
      const EventConstructor = el?.ownerDocument?.defaultView?.Event ?? Event;
      try { el.dispatchEvent(new EventConstructor("change", { bubbles: true })); } catch (e) {
        try { $(el).trigger("change"); } catch (jqErr) { /* ignore */ }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 60));
  }

  _getElementDocument(element = null) {
    const resolved = getApplicationElement(element) ?? getApplicationElement(this);
    return resolved?.ownerDocument ?? document;
  }

  _isElementFocused(element) {
    if (!element) return false;
    return this._getElementDocument(element)?.activeElement === element;
  }

  _scheduleEditAutosaveChange(target, delayMs = 360) {
    if (!target || typeof target !== "object") return;
    if (!(this._pendingEditAutosaveTimers instanceof Map)) this._pendingEditAutosaveTimers = new Map();

    // Prune detached nodes to avoid stale timers.
    for (const [el, entry] of this._pendingEditAutosaveTimers.entries()) {
      if (!el?.isConnected) {
        this._clearPendingEditAutosaveTarget(el, entry);
      }
    }

    this._clearPendingEditAutosaveTarget(target);

    const timerId = setTimeout(() => {
      if (!target?.isConnected) {
        this._clearPendingEditAutosaveTarget(target);
        return;
      }
      if (this._isElementFocused(target)) return;
      this._clearPendingEditAutosaveTarget(target);
      const EventConstructor = target?.ownerDocument?.defaultView?.Event ?? Event;
      try { target.dispatchEvent(new EventConstructor("change", { bubbles: true })); } catch (e) {
        try { $(target).trigger("change"); } catch (jqErr) { /* ignore */ }
      }
    }, Math.max(120, Number(delayMs) || 0));

    const onChange = () => this._clearPendingEditAutosaveTarget(target);
    try { target.addEventListener("change", onChange, { once: true }); } catch (e) { /* ignore */ }
    this._pendingEditAutosaveTimers.set(target, { timeoutId: timerId, onChange });
  }

  async _flushQueuedSaves() {
    const queueKeys = [
      "_skillsSaveQueue",
      "_combatSaveQueue",
      "_advantageSaveQueue",
      "_edgeResourceSaveQueue",
      "_portraitLozengeSaveQueue",
      "_inventorySaveQueue"
    ];

    for (const key of queueKeys) {
      const queue = this[key];
      if (!queue || typeof queue.then !== "function") continue;
      try { await queue; } catch (e) { /* keep flushing remaining queues */ }
    }

    // Allow any final queued microtasks/change handlers to settle.
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  static get DEFAULT_OPTIONS() {
    const superOptions = super.DEFAULT_OPTIONS ?? {};
    const classes = Array.from(new Set([...(superOptions.classes ?? []), ...this.SHEET_CLASSES]));
    return foundry.utils.mergeObject(superOptions, {
      classes,
      position: {
        width: this.SHEET_WIDTH,
        height: this.SHEET_HEIGHT
      },
      window: {
        resizable: true
      },
      form: {
        submitOnChange: true,
        closeOnSubmit: false
      },
      actions: {
        tab: this._onSheetTabAction,
        changeMode: this.#changeMode,
        refreshResources: this._onRefreshResourcesAction,
        rest: this._onRestAction,
        rollConsciousness: this._onConsciousnessRollAction,
        rollInitiative: this._onInitiativeRollAction,
        rollCombat: this._onCombatRollAction,
        rollCombatTag: this._onCombatTagRollAction,
        rollSkill: this._onSkillRollAction,
        rollAttributeToHit: this._onAttributeToHitRollAction,
        rollAttributeSave: this._onAttributeSaveRollAction
      }
    }, { inplace: false });
  }

  static get PARTS() {
    return {
      sheet: {
        template: this.SHEET_TEMPLATE
      },
      tabs: {
        id: "tabs",
        classes: ["pc-sheet-tabs-part"],
        template: "systems/peasant-core/templates/actor/parts/character-tabs.html"
      }
    };
  }

  static get SHEET_PARTIAL_PATH() {
    return "systems/peasant-core/templates/actor/parts";
  }

  static get TAB_DEFINITIONS() {
    return [
      { tab: "skills", label: "Skills", icon: "fa-solid fa-book", slot: "attributes", partial: "character-skills.html" },
      { tab: "notable-combats", label: "Notable Combats", icon: "fas fa-list", slot: "attributes", partial: "character-notable-combats.html" },
      { tab: "effects", label: "Effects", icon: "fa-solid fa-bolt", slot: "main", partial: "character-effects.html" },
      { tab: "inventory", label: "Inventory", icon: "fa-solid fa-backpack", slot: "main", partial: "character-inventory.html" },
      { tab: "aspects-advantages", label: "Aspects & Advantages", icon: "fa-solid fa-star", slot: "main", partial: "character-advantages.html" },
      { tab: "biography", label: "Biography", icon: "fas fa-feather", slot: "main", partial: "character-biography.html" },
      { tab: "settings", label: "Sheet Configuration", icon: "fa-solid fa-gear", slot: "main", partial: "character-settings.html" }
    ];
  }

  static get SHEET_PARTIALS() {
    const tabPartials = this.TAB_DEFINITIONS.map(({ partial }) => `${this.SHEET_PARTIAL_PATH}/${partial}`);
    return [
      ...tabPartials,
      `${this.SHEET_PARTIAL_PATH}/inventory-section.html`
    ];
  }

  static get TABS() {
    return this.TAB_DEFINITIONS.map(({ tab, label, icon }) => ({ tab, label, icon }));
  }

  static get ATTRIBUTE_STAGE_TABS() {
    return new Set(this.TAB_DEFINITIONS
      .filter(({ slot }) => slot === "attributes")
      .map(({ tab }) => tab));
  }

  tabGroups = {
    primary: "skills"
  };

  static async preloadSheetPartials() {
    const loadTemplatesFn = foundry?.applications?.handlebars?.loadTemplates;
    if (typeof loadTemplatesFn !== "function") return;
    this._sheetPartialsReady ??= loadTemplatesFn(this.SHEET_PARTIALS).catch(err => {
      this._sheetPartialsReady = null;
      console.error("Peasant Core | Failed to preload actor sheet partials", err);
      throw err;
    });
    await this._sheetPartialsReady;
  }

  static _onSheetTabAction(event, target) {
    const tab = target?.dataset?.tab;
    const group = target?.dataset?.group ?? "primary";
    if (!tab || typeof this.changeTab !== "function") return;
    this.changeTab(tab, group, { event });
  }

  static #changeMode(event, target) {
    if (!this.canModifyActor) return;
    this._onChangeSheetMode(event, target);
  }

  async _onChangeSheetMode(event, target = event.currentTarget) {
    const { MODES } = this.constructor;
    const label = target.checked ? "Enter View Mode" : "Enter Edit Mode";
    target.dataset.tooltip = label;
    target.setAttribute("aria-label", label);
    const nextMode = target.checked ? MODES.EDIT : MODES.PLAY;

    if (this.isEditMode && nextMode !== this._mode) {
      if (typeof this._flushPendingEditAutosaves === "function") {
        await this._flushPendingEditAutosaves({ triggerChanges: true });
      }
      if (typeof this._flushQueuedSaves === "function") {
        await this._flushQueuedSaves();
      }
    }

    this._mode = nextMode;

    if (typeof this.submit === "function") await this.submit();
    const renderResult = this.render();
    refreshOpenHpGridDialogsForSheet(this);
    refreshOpenStressGridDialogsForSheet(this);
    return renderResult;
  }

  static async _onRefreshResourcesAction() {
    if (!this.canModifyActor) return;
    await confirmPeasantResourceRefresh(this);
  }

  static async _onRestAction(event, target) {
    if (!this.canModifyActor) return;
    const restButton = target ?? event?.currentTarget;
    const restType = restButton?.dataset?.type ?? restButton?.dataset?.restType;
    await confirmPeasantRest(this, restType);
  }

  static async _onConsciousnessRollAction(event, target) {
    if (!this.canModifyActor) return;
    await this._rollConsciousnessFromElement(event, target);
  }

  static async _onInitiativeRollAction(event, target) {
    if (!this.canModifyActor) return;
    await this._rollInitiativeFromElement(event, target);
  }

  static async _onCombatRollAction(event, target) {
    if (!this.canModifyActor) return;
    await this._rollCombatFromElement(event, target);
  }

  static async _onCombatTagRollAction(event, target) {
    if (!this.canModifyActor) return;
    await this._rollCombatTagFromElement(event, target);
  }

  static async _onSkillRollAction(event, target) {
    if (!this.canModifyActor) return;
    await this._rollSkillFromElement(event, target);
  }

  static async _onAttributeToHitRollAction(event, target) {
    if (!this.canModifyActor) return;
    await this._rollAttributeToHitFromElement(event, target);
  }

  static async _onAttributeSaveRollAction(event, target) {
    if (!this.canModifyActor) return;
    await this._rollAttributeSaveFromElement(event, target);
  }

  _configureRenderOptions(options) {
    if (typeof super._configureRenderOptions === "function") super._configureRenderOptions(options);

    let { mode, renderContext } = options;
    if ((mode === undefined) && (renderContext === "createItem")) mode = this.constructor.MODES.EDIT;
    this._mode = mode ?? this._mode ?? this.constructor.MODES.PLAY;
  }

  async render(options = {}) {
    if (typeof options === "boolean") options = { force: options };
    else if (!options) options = {};
    if (!this.isEditMode) this._clearPendingEditAutosaves();
    const preserveScroll = options?.preserveScroll !== false;
    const scrollState = preserveScroll ? this._captureSheetScrollState() : null;
    const rendered = await super.render(options);
    if (preserveScroll && scrollState) this._restoreSheetScrollState(scrollState);
    return rendered;
  }

  async close(options) {
    if (this.isEditMode) {
      if (typeof this._flushPendingEditAutosaves === "function") {
        try { await this._flushPendingEditAutosaves({ triggerChanges: true }); } catch (e) { /* ignore */ }
      }
      if (typeof this._flushQueuedSaves === "function") {
        try { await this._flushQueuedSaves(); } catch (e) { /* ignore */ }
      }
    }
    closeSheetResourceDialogs(this);
    closeSheetOwnedApplications(this);
    teardownPortraitBindings(this);
    this._teardownSheetEventBindings();
    return super.close(options);
  }

  _detachOptions() {
    const windowId = (this.parent ?? this).window?.windowId;
    return windowId ? { window: { windowId } } : {};
  }

  _withDetachedOptions(options = {}) {
    const detached = this._detachOptions();
    if (!detached.window) return options ?? {};
    return {
      ...(options ?? {}),
      window: {
        ...detached.window,
        ...((options ?? {}).window ?? {})
      }
    };
  }

  _renderDialog(data, options = {}) {
    return renderDialogV2(data, this._withDetachedOptions({
      ...options,
      parent: this
    }));
  }

  _teardownSheetEventBindings() {
    if (this._sheetKeydownRoot && this._sheetKeydownHandler) {
      try {
        this._sheetKeydownRoot.removeEventListener("keydown", this._sheetKeydownHandler, true);
      } catch (e) { /* ignore */ }
    }
    this._sheetKeydownRoot = null;
    this._sheetKeydownHandler = null;
  }

  _claimSheetActivationEvent(event, claim, target = null) {
    const key = `__peasantCore_${claim}`;
    const nativeEvent = event?.originalEvent ?? event;

    if (nativeEvent) {
      if (nativeEvent[key]) return false;
      try {
        Object.defineProperty(nativeEvent, key, { value: true, configurable: true });
      } catch (e) {
        try { nativeEvent[key] = true; } catch (assignErr) { /* ignore */ }
      }
    }

    const guardTarget = target ?? event?.currentTarget ?? null;
    if (guardTarget) {
      this._sheetActivationGuards ??= new WeakMap();
      const now = Date.now();
      const last = this._sheetActivationGuards.get(guardTarget);
      if (last?.claim === claim && (now - last.at) < 100) return false;
      this._sheetActivationGuards.set(guardTarget, { claim, at: now });
    }

    return true;
  }

  _prepareSheetRollEvent(event, claim, target = null) {
    if (!this._claimSheetActivationEvent(event, claim, target)) return false;
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    event?.stopPropagation?.();
    return true;
  }

  _getActionTarget(event, target) {
    return target ?? event?.currentTarget ?? null;
  }

  _isPrimaryPointerEvent(event) {
    const nativeEvent = event?.originalEvent ?? event;
    const button = event?.button ?? nativeEvent?.button;
    const which = event?.which ?? nativeEvent?.which;
    return !((button != null && button !== 0) || (button == null && which != null && which !== 1));
  }

  async _rollConsciousnessFromElement(event, target) {
    await rollConsciousnessFromElement(this, event, target);
  }

  async _rollInitiativeFromElement(event, target) {
    await rollInitiativeFromElement(this, event, target);
  }

  async _rollCombatFromElement(event, target) {
    await rollCombatFromElement(this, event, target);
  }

  async _rollCombatTagFromElement(event, target) {
    await rollCombatTagFromElement(this, event, target);
  }

  async _rollSkillFromElement(event, target) {
    await rollSkillFromElement(this, event, target);
  }

  async _rollAttributeToHitFromElement(event, target) {
    await rollAttributeToHitFromElement(this, event, target);
  }

  async _rollAttributeSaveFromElement(event, target) {
    await rollAttributeSaveFromElement(this, event, target);
  }

  _captureSheetScrollState() {
    const sheet = this._getSheetJQ()?.[0];
    if (!sheet) return null;
    return {
      top: sheet.scrollTop ?? 0,
      left: sheet.scrollLeft ?? 0
    };
  }

  _restoreSheetScrollState(state) {
    if (!state) return;
    const apply = () => {
      const sheet = this._getSheetJQ()?.[0];
      if (!sheet) return;
      sheet.scrollTop = state.top ?? 0;
      sheet.scrollLeft = state.left ?? 0;
    };
    apply();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
    setTimeout(apply, 0);
  }

  async _prepareContext(options) {
    await this.constructor.preloadSheetPartials();
    const baseContext = await super._prepareContext(options);
    const data = await this.getData(options);
    data.activeSheetTab = this._normalizeSheetTab(this.tabGroups?.primary);
    data.sheetTabs = this._getSheetTabs();
    data.editable = this.isEditable && this.isEditMode;
    return Object.assign(baseContext, data);
  }

  async _onRender(context, options) {
    if (typeof super._onRender === "function") await super._onRender(context, options);
    const sheet = this._getSheetJQ();
    const sheetEl = sheet?.[0] || null;
    if (sheetEl && sheetEl.tabIndex < 0) sheetEl.tabIndex = 0;
    this.activateListeners(sheet);
    this._bindSheetTabButtons();
    this._renderModeToggle();
    const root = getApplicationElement(this);
    root?.classList.toggle("editable", this.isEditable && this.isEditMode);
    root?.classList.toggle("interactable", this.isEditable && (this._mode === this.constructor.MODES.PLAY));
    root?.classList.toggle("locked", !this.isEditable);
    root?.classList.toggle("readonly-observer", this.isReadOnlyObserver);
    this._applyReadOnlyObserverState(root);
    this._syncSheetTabRailViewportMode();
  }

  _getSheetJQ() {
    const root = getApplicationJQuery(this);
    if (!root.length) return $();
    if (root.is(".actor-sheet")) return root;
    const sheet = root.find(".actor-sheet").first();
    if (sheet.length) return sheet;
    return root;
  }

  _syncSheetTabRailViewportMode() {
    const root = getApplicationJQuery(this);
    const rootEl = root?.[0];
    const rail = root.find(".pc-sheet-tab-rail").first()?.[0];
    if (!rootEl || !rail) return;

    const sync = () => {
      const ownerDocument = this._getElementDocument(rootEl);
      const isDetached = !!ownerDocument?.body?.classList?.contains("detached");
      root.toggleClass("pc-tabs-inside-viewport", isDetached);
      if (isDetached) return;

      root.removeClass("pc-tabs-inside-viewport");
      const viewportWidth = ownerDocument?.documentElement?.clientWidth || ownerDocument?.defaultView?.innerWidth || 0;
      const railRect = rail.getBoundingClientRect();
      const shouldPullInside = viewportWidth > 0 && railRect.right > viewportWidth - 2;
      root.toggleClass("pc-tabs-inside-viewport", shouldPullInside);
    };

    sync();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(sync);
  }

  _setupSheetTabs(html) {
    const sheet = html instanceof jQuery ? html : $(html);
    if (!sheet.length) return;

    this.tabGroups ??= {};
    const activeTab = this._normalizeSheetTab(this.tabGroups.primary);
    this.tabGroups.primary = activeTab;

    this._prepareSheetTabLayout(sheet);
    this._applySheetTab(activeTab, sheet);
  }

  _bindSheetTabButtons() {
    const root = getApplicationJQuery(this);
    root.find(".pc-sheet-tab-button").off("click.peasantCoreSheetTabs").on("click.peasantCoreSheetTabs", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      const tab = target?.dataset?.tab;
      const group = target?.dataset?.group ?? "primary";
      if (!tab) return;
      this.changeTab(tab, group, { event });
    });
  }

  _normalizeSheetTab(tab) {
    const validTabs = new Set(this.constructor.TABS.map(tabConfig => tabConfig.tab));
    return validTabs.has(String(tab ?? "")) ? String(tab) : "skills";
  }

  _getSheetTabs() {
    const activeTab = this._normalizeSheetTab(this.tabGroups?.primary);
    return this.constructor.TABS.map(({ tab, ...config }) => {
      const active = tab === activeTab;
      return {
        ...config,
        id: tab,
        group: "primary",
        active,
        cssClass: active ? "active is-active" : ""
      };
    });
  }

  _prepareSheetTabLayout(sheet) {
    const attributesPanel = sheet.find(".attributes-resources-container").first();
    const attributesSkillSection = sheet.find(".pc-attributes-skills-section").first();
    const skillsPanel = attributesSkillSection.find(".pc-skills-tab-panel").first();
    skillsPanel.addClass("tab").attr({ "data-group": "primary", "data-tab": "skills" });

    let attributesTabSlot = attributesSkillSection.find(".pc-attributes-tab-slot").first();
    if (!attributesTabSlot.length) {
      attributesTabSlot = $('<div class="pc-attributes-tab-slot"></div>').appendTo(attributesSkillSection);
    }

    let mainTabStage = sheet.find(".pc-sheet-main-tab-stage").first();
    if (!mainTabStage.length) {
      mainTabStage = $('<div class="pc-sheet-main-tab-stage" aria-live="polite"></div>');
      if (attributesPanel.length) mainTabStage.insertAfter(attributesPanel);
      else {
        const hpSection = sheet.find(".hp-section").first();
        if (hpSection.length) mainTabStage.appendTo(hpSection);
        else mainTabStage.appendTo(sheet);
      }
    }

    for (const { tab, slot } of this.constructor.TAB_DEFINITIONS) {
      if (tab === "skills") continue;
      const panel = sheet.find(`[data-pc-tab-panel="${tab}"]`).first();
      if (panel.length) {
        panel.addClass("tab").attr({ "data-group": "primary", "data-tab": tab });
        panel.appendTo(slot === "attributes" ? attributesTabSlot : mainTabStage);
      }
    }

    sheet.find(".pc-tab-detached-divider").prop("hidden", true).attr("aria-hidden", "true");
  }

  _applySheetTab(tab, sheet = this._getSheetJQ()) {
    const activeTab = this._normalizeSheetTab(tab);
    this.tabGroups ??= {};
    this.tabGroups.primary = activeTab;

    const root = getApplicationJQuery(this);
    const tabClasses = this.constructor.TABS.map(tabConfig => `tab-${tabConfig.tab}`);
    root.removeClass(tabClasses.join(" ")).addClass(`tab-${activeTab}`);

    const attributesPanel = sheet.find(".attributes-resources-container").first();
    const mainTabStage = sheet.find(".pc-sheet-main-tab-stage").first();
    const skillsHeader = sheet.find(".pc-attributes-skills-header").first();
    const showAttributes = this.constructor.ATTRIBUTE_STAGE_TABS.has(activeTab);

    attributesPanel.prop("hidden", !showAttributes).attr("aria-hidden", showAttributes ? null : "true");
    mainTabStage.prop("hidden", showAttributes).attr("aria-hidden", showAttributes ? "true" : null);
    skillsHeader.prop("hidden", activeTab !== "skills").attr("aria-hidden", activeTab === "skills" ? null : "true");

    sheet.find('.tab[data-group="primary"]').each((_, panel) => {
      const isActive = panel.dataset.tab === activeTab;
      panel.classList.toggle("active", isActive);
      panel.hidden = !isActive;
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });

    root.find('.pc-sheet-tab-rail [data-group="primary"][data-tab]').each((_, button) => {
      const isActive = button.dataset.tab === activeTab;
      button.classList.toggle("active", isActive);
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  changeTab(tab, group = "primary", options = {}) {
    const activeTab = this._normalizeSheetTab(tab);
    if (group !== "primary") {
      if (typeof super.changeTab === "function") return super.changeTab(tab, group, options);
      return;
    }

    if (typeof super.changeTab === "function") {
      try {
        super.changeTab(activeTab, group, options);
      } catch (err) {
        this.tabGroups ??= {};
        this.tabGroups.primary = activeTab;
      }
    } else {
      this.tabGroups ??= {};
      this.tabGroups.primary = activeTab;
    }

    this._applySheetTab(activeTab);
  }

  _escapeHtml(value) {
    return foundry.utils.escapeHTML(String(value ?? ""));
  }

  _getDialogPositionNearTrigger(trigger, width = 420, height = 320) {
    const triggerWindow = trigger?.isConnected !== false ? trigger?.ownerDocument?.defaultView : null;
    const hostWindow = triggerWindow ?? this.element?.ownerDocument?.defaultView ?? window;
    const hostDocument = hostWindow.document ?? document;
    const viewportWidth = Math.max(hostDocument.documentElement?.clientWidth || 0, hostWindow.innerWidth || 0);
    const viewportHeight = Math.max(hostDocument.documentElement?.clientHeight || 0, hostWindow.innerHeight || 0);
    const centeredPosition = {
      width,
      left: Math.max(16, Math.round((viewportWidth - width) / 2)),
      top: Math.max(16, Math.round((viewportHeight - height) / 2))
    };
    const rect = trigger?.getBoundingClientRect?.();
    if (!rect) return centeredPosition;
    if (trigger?.isConnected === false || (rect.width <= 0 && rect.height <= 0)) return centeredPosition;

    const gap = 12;
    const edge = 16;
    let left = rect.right + gap;
    if (left + width > viewportWidth - edge) left = rect.left - width - gap;
    if (left < edge) left = Math.min(Math.max(edge, rect.left), Math.max(edge, viewportWidth - width - edge));

    let top = rect.top - 24;
    if (top + height > viewportHeight - edge) top = viewportHeight - height - edge;
    if (top < edge) top = edge;

    return {
      width,
      left: Math.round(left),
      top: Math.round(top)
    };
  }

  _getHeaderControls() {
    const superControls = typeof super._getHeaderControls === "function" ? super._getHeaderControls() : [];
    const controls = Array.isArray(superControls) ? [...superControls] : [];
    const canConfigure = this.canModifyActor;
    if (canConfigure) {
      const hasRefreshResources = controls.some(control => String(control?.action || "").trim().toLowerCase() === "refreshresources");
      if (!hasRefreshResources) {
        controls.unshift({
          action: "refreshResources",
          icon: "fa-solid fa-rotate-right",
          label: "Refresh Resources"
        });
      }
    }

    // Foundry can surface duplicate controls via mixed providers.
    // Keep first instance by visible label, then by action key for unlabeled entries.
    const seenLabels = new Set();
    const seenActions = new Set();
    const deduped = [];
    for (const control of controls) {
      if (!control || typeof control !== "object") continue;
      const labelKey = String(control.label ?? "").trim().toLowerCase();
      const actionKey = String(control.action ?? "").trim().toLowerCase();
      if (labelKey) {
        if (seenLabels.has(labelKey)) continue;
        seenLabels.add(labelKey);
      } else if (actionKey) {
        if (seenActions.has(actionKey)) continue;
        seenActions.add(actionKey);
      }
      deduped.push(control);
    }
    return deduped;
  }

  _renderModeToggle() {
    const header = this.element.querySelector(".window-header");
    ensureSlideToggleElement(header?.ownerDocument?.defaultView);
    const toggle = header.querySelector(".mode-slider");
    const positionToggle = (toggle) => {
      const controlsToggle = header.querySelector('.header-control[data-action="toggleControls"], [data-action="toggleControls"]');
      if (controlsToggle?.parentElement === header) controlsToggle.before(toggle);
      else header.prepend(toggle);
    };
    const syncToggleLabel = (toggle) => {
      const label = toggle.checked ? "Enter View Mode" : "Enter Edit Mode";
      toggle.dataset.tooltip = label;
      toggle.setAttribute("aria-label", label);
    };
    if (this.isEditable && !toggle) {
      const toggle = header.ownerDocument.createElement("slide-toggle");
      toggle.checked = this.isEditMode;
      toggle.classList.add("mode-slider");
      toggle.dataset.action = "changeMode";
      toggle.addEventListener("dblclick", event => event.stopPropagation());
      toggle.addEventListener("pointerdown", event => event.stopPropagation());
      syncToggleLabel(toggle);
      positionToggle(toggle);
    } else if (this.isEditable) {
      toggle.checked = this.isEditMode;
      syncToggleLabel(toggle);
      positionToggle(toggle);
    } else if (!this.isEditable && toggle) {
      toggle.remove();
    }
  }

  _getHeaderButtons() {
    const buttons = typeof super._getHeaderButtons === "function" ? super._getHeaderButtons() : [];

    // Legacy frame controls that are still independent of sheet mode.
    const canConfigure = this.canModifyActor;
    if (canConfigure) {
      buttons.unshift({
        label: "Refresh Resources",
        class: "refresh-resources",
        icon: "fas fa-sync-alt",
        onclick: async () => {
          await confirmPeasantResourceRefresh(this);
        }
      });

    }

    return buttons;
  }

  async getData() {
    await this.constructor.preloadSheetPartials();

    // Start with original super data
    let data;
    try {
      if (typeof super.getData === "function") {
        data = await super.getData();
      } else {
        data = {
          actor: this.actor,
          editable: this.isEditable,
          owner: this.canModifyActor,
          canObserve: this.canObserveActor,
          options: this.options
        };
      }
      data.owner = this.canModifyActor;
      data.canObserve = this.canObserveActor;
      prepareActorSheetBaseContext(data, this.actor, { isEditable: this.isEditable, isEditMode: this.isEditMode });
      if (this.isReadOnlyObserver) data.artPanelCollapsed = false;
      if (this.isEditMode && this._initiativeInputDraft !== undefined) {
        data.initiativeInput = this._initiativeInputDraft;
      }
      prepareActorIdentityContext(data, this.actor, { isEditMode: this.isEditMode });
      prepareActorEdgeContext(data, this.actor);
      prepareActorAttributeContext(data, this.actor);
      prepareActorStressContext(data, this.actor, { isEditMode: this.isEditMode });

    // Ensure portrait offsets are valid for current scale
    const scale = Math.max(1.0, this.actor.system.portraitScale || 1);
    if (scale <= 1.0) {
      data.actor.system.portraitOffsetX = 0;
      data.actor.system.portraitOffsetY = 0;
    }

    prepareActorSkillContext(data, this.actor, { logger: pcLog });

    const TextEditorImpl = TextEditorImplementation;
    const escapeHtml = foundry.utils.escapeHTML ?? ((value) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])));
    const buildDescriptionTooltipHtml = async (entry, fallbackName) => {
      if (!entry?.hasDescription) return "";
      const enrichedDescription = await TextEditorImpl.enrichHTML(entry.description ?? "", { async: true });
      const entryName = escapeHtml(entry.name || fallbackName);
      return `<div class="pc-rich-description-tooltip"><div class="skill-tooltip-header">${entryName}</div><div class="skill-tooltip-content">${enrichedDescription ?? ""}</div></div>`;
    };
    for (const skill of data.skills ?? []) {
      skill.descriptionTooltipHtml = await buildDescriptionTooltipHtml(skill, "Skill");
    }

    const biographyRaw = String(this.actor.system.biography ?? "");
    data.hasBiographyText = biographyRaw.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim().length > 0;
    data.biographyHTML = data.hasBiographyText
      ? await TextEditorImpl.enrichHTML(this.actor.system.biography, { async: true })
      : "";

    prepareActorAdvantageContext(data, this.actor);
    for (const advantage of data.flexibleAdvantages ?? []) {
      advantage.descriptionTooltipHtml = await buildDescriptionTooltipHtml(advantage, "Advantage");
    }

    prepareActorNotableCombatContext(data, this.actor);
    for (const combat of data.notableCombats ?? []) {
      combat.descriptionTooltipHtml = await buildDescriptionTooltipHtml(combat, "Combat");
    }

    data.biography = this.actor.system.biography || "";
    await prepareActorInventoryContext(data, this.actor);
    const inventorySortMode = this._pcInventorySortMode === "alpha" ? "alpha" : "manual";
    data.inventorySortToggle = {
      mode: inventorySortMode,
      label: inventorySortMode === "alpha" ? "Sort Alphabetically" : "Sort Manually",
      icon: inventorySortMode === "alpha" ? "fa-solid fa-arrow-down-a-z" : "fa-solid fa-arrow-down-short-wide"
    };
    const inventoryGroupedByCategory = this._pcInventoryGroupedByCategory !== false;
    data.inventoryGroupToggle = {
      active: inventoryGroupedByCategory,
      pressed: inventoryGroupedByCategory ? "true" : "false",
      label: "Group by Category"
    };

    prepareActorHealthResourceContext(data, this.actor, { isEditMode: this.isEditMode });

      return data;
    } catch (err) {
      console.error('PeasantActorSheet.getData error:', err);
      // Fallback to super data so sheet can still render minimally
      try {
        if (typeof super.getData === "function") return await super.getData();
        return {
          actor: this.actor,
          editable: this.isEditable,
          owner: this.canModifyActor,
          canObserve: this.canObserveActor,
          options: this.options
        };
      } catch (err2) {
        console.error('PeasantActorSheet.getData fallback failed:', err2);
        return {};
      }
    }
  }

  async _applySimplifiedHpDefaults() {
    await this.actor?.applyPeasantSimplifiedHpDefaults?.();
  }

  async _onPeasantCoreSettingChange(event) {
    event.preventDefault();
    event.stopPropagation();
    const input = event.currentTarget;
    const flagKey = input?.dataset?.pcSetting;
    const setting = PC_ACTOR_SETTING_DEFINITIONS.find(candidate => candidate.flagKey === flagKey);
    if (!setting || !this.actor?.setFlag) return;

    try {
      if (setting.type === "boolean") {
        const wasEnabled = !!this.actor.getFlag("peasant-core", setting.flagKey);
        const enabled = !!input.checked;
        await this.actor.setFlag("peasant-core", setting.flagKey, enabled);
        if (setting.flagKey === PC_SIMPLIFIED_HP_FLAG && enabled && !wasEnabled) {
          await this._applySimplifiedHpDefaults();
        }
      } else {
        const value = sanitizePeasantCoreSettingNumber(setting, input.value);
        input.value = String(value);
        await this.actor.setFlag("peasant-core", setting.flagKey, value);
      }

    } catch (err) {
      console.warn(`Peasant Core | Failed to save actor setting ${flagKey}`, err);
      ui.notifications?.warn?.("Failed to save Peasant Core setting. See console for details.");
    }
  }

  async _onCustomSirLocationChange(event) {
    const input = event.currentTarget;
    const sirKey = String(input?.dataset?.sirKey ?? "").trim();
    if (!sirKey || !this.actor?.setFlag) return;

    const value = String(input.value ?? "");
    const current = this.actor.getFlag("peasant-core", PC_CUSTOM_SIR_LOCATION_VALUES_FLAG);
    const values = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : {};
    if (value.trim()) values[sirKey] = value;
    else delete values[sirKey];

    if (Object.keys(values).length) {
      await this.actor.setFlag("peasant-core", PC_CUSTOM_SIR_LOCATION_VALUES_FLAG, values);
    } else if (typeof this.actor.unsetFlag === "function") {
      await this.actor.unsetFlag("peasant-core", PC_CUSTOM_SIR_LOCATION_VALUES_FLAG);
    } else {
      await this.actor.setFlag("peasant-core", PC_CUSTOM_SIR_LOCATION_VALUES_FLAG, {});
    }
  }

  _applyReadOnlyObserverState(html) {
    if (!this.isReadOnlyObserver) return;
    const root = getApplicationElement(html);
    if (!root) return;
    const sheetRoot = root.matches(".actor-sheet") ? root : root.querySelector(".actor-sheet");
    const scopes = [
      sheetRoot,
      ...root.querySelectorAll(".pc-sheet-tab-rail")
    ].filter(Boolean);
    if (sheetRoot) sheetRoot.tabIndex = -1;
    for (const chromeAction of root.querySelectorAll(".window-header [data-pc-readonly-action='true']")) {
      delete chromeAction.dataset.pcReadonlyAction;
      chromeAction.removeAttribute("aria-disabled");
    }

    const allowButton = (button) => button.matches(".pc-sheet-tab-button, .pc-hp-grid-open, .pc-stress-grid-open, .toggle-wounds-menu, [data-pc-inventory-clear-search]");
    const markReadOnlyAction = (element) => {
      element.dataset.pcReadonlyAction = "true";
      element.setAttribute("aria-disabled", "true");
      if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "0");
      if ("disabled" in element) element.disabled = false;
    };
    const forEachScoped = (selector, callback) => {
      for (const scope of scopes) {
        for (const element of scope.querySelectorAll(selector)) callback(element);
      }
    };

    forEachScoped("button", (button) => {
      if (allowButton(button)) {
        button.disabled = false;
        button.removeAttribute("disabled");
        button.removeAttribute("aria-disabled");
        return;
      }
      markReadOnlyAction(button);
    });

    forEachScoped("fieldset", (fieldset) => {
      fieldset.disabled = false;
      fieldset.removeAttribute("disabled");
    });

    forEachScoped("input, textarea", (input) => {
      if (input.type === "hidden" || input.hidden || input.hasAttribute("hidden")) return;
      if (input.matches(".pc-inventory-search-input")) return;
      input.disabled = false;
      input.removeAttribute("disabled");
      input.readOnly = true;
      input.setAttribute("aria-readonly", "true");
      if (!input.hasAttribute("tabindex")) input.setAttribute("tabindex", "0");
      if (["checkbox", "radio", "range", "color", "file"].includes(input.type)) markReadOnlyAction(input);
    });

    forEachScoped("select", (select) => {
      select.disabled = false;
      select.removeAttribute("disabled");
      markReadOnlyAction(select);
    });

    forEachScoped('[contenteditable="true"], prose-mirror', (editable) => {
      if ("disabled" in editable) editable.disabled = false;
      editable.removeAttribute("disabled");
      editable.setAttribute("contenteditable", "false");
      editable.setAttribute("aria-readonly", "true");
      if (!editable.hasAttribute("tabindex")) editable.setAttribute("tabindex", "0");
    });

    forEachScoped('[data-action]:not(.pc-sheet-tab-button):not(.pc-hp-grid-open):not(.pc-stress-grid-open)', (action) => {
      markReadOnlyAction(action);
    });

    const focusableReadOnlySelectors = [
      ".pc-banner-ap-meter",
      ".pc-portrait-lozenge:not(.pc-portrait-lozenge-edit)",
      ".pc-portrait-armor-charge-field",
      ".pc-portrait-hp-main",
      ".pc-portrait-hp-side",
      ".pc-portrait-stress-bar",
      ".pc-portrait-resource-bar",
      ".halt-section",
      ".skills-list-view",
      ".notable-combats-list-view",
      ".pc-inventory-browser",
      ".advantages-list-view",
      ".pc-biography-detail-strip",
      ".pc-biography-notes-grid"
    ];
    forEachScoped(focusableReadOnlySelectors.join(", "), (element) => {
      if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "0");
    });

    this._bindReadOnlyObserverGuards(root);
  }

  _bindReadOnlyObserverGuards(html) {
    const root = getApplicationElement(html);
    if (!root || root.dataset.pcReadonlyObserverGuards === "true") return;
    root.dataset.pcReadonlyObserverGuards = "true";

    const shouldBlockActivation = (target) => {
      const action = target?.closest?.("[data-pc-readonly-action='true']");
      if (!action) return false;
      if (action.closest(".window-header")) return false;
      return !action.matches(".pc-sheet-tab-button, .pc-hp-grid-open, .pc-stress-grid-open, .toggle-wounds-menu");
    };

    const block = (event) => {
      if (!this.isReadOnlyObserver || !shouldBlockActivation(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    };

    root.addEventListener("click", block, true);
    root.addEventListener("dblclick", block, true);
    root.addEventListener("contextmenu", block, true);
    root.addEventListener("keydown", (event) => {
      if (!["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      block(event);
    }, true);
  }

  activateListeners(html) {
    if (typeof super.activateListeners === "function") {
      try {
        super.activateListeners(html);
      } catch (err) {
        console.error('Error in super.activateListeners or initial setup:', err);
      }
    }
    pcLog.debug('PeasantActorSheet.activateListeners bound for actor:', this.actor?.name);
    this._setupSheetTabs(html);
    const sheetDocument = this._getElementDocument(html?.[0]);
    teardownPortraitBindings(this);
    html.find(".header-button.apply").remove();

    if (this.isReadOnlyObserver) {
      setupPortraitControls(this, html, { readOnly: true });
      setupWoundsControls(this, html, { readOnly: true });
      setupHealthStressControls(this, html, { readOnly: true });
      setupInventoryControls(this, html, { readOnly: true });
      return;
    }

    const sheetBody = sheetDocument?.body ?? document.body;
    initializeSheetSaveQueues(this);
    const enqueueSheetUpdate = createSheetUpdateQueue(this);

    html.find(".pc-art-panel-toggle").off("click.peasantCoreArtPanel").on("click.peasantCoreArtPanel", async (event) => {
      event.preventDefault();
      const collapsed = !this.actor?.getFlag?.("peasant-core", PC_ART_PANEL_COLLAPSED_FLAG);
      await this.actor.setFlag("peasant-core", PC_ART_PANEL_COLLAPSED_FLAG, collapsed);
    });

    html.find(".pc-banner-rest-button").off("click.peasantCoreRest").on("click.peasantCoreRest", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const restType = event.currentTarget?.dataset?.type ?? event.currentTarget?.dataset?.restType;
      await confirmPeasantRest(this, restType);
    });

    html.find(".pc-sheet-setting-input").off("change.peasantCoreSettings").on("change.peasantCoreSettings", async (event) => {
      await this._onPeasantCoreSettingChange(event);
    });

    html.find(".pc-custom-sir-input").off("change.peasantCustomSir").on("change.peasantCustomSir", async (event) => {
      await this._onCustomSirLocationChange(event);
    });

    html.find(".pc-portrait-lozenge-input[data-field]").off("input.peasantPortraitLozenge change.peasantPortraitLozenge").on("input.peasantPortraitLozenge", (event) => {
      const input = event.currentTarget;
      if (input?.dataset?.field === "system.initiative") {
        event.stopPropagation();
        sanitizeOptionalIntegerInputElement(input, { allowSign: true });
        this._initiativeInputDraft = input.value;
        return;
      }
      event.stopPropagation();
      if (input?.dataset?.field !== "system.movement") return;
      const value = Number.parseInt(input.value, 10);
      if (Number.isFinite(value) && value < 0) input.value = "0";
    }).on("change.peasantPortraitLozenge", async (event) => {
      const input = event.currentTarget;
      const field = input?.dataset?.field;
      if (!["system.movement", "system.initiative"].includes(field)) return;
      if (field === "system.initiative") {
        const value = parseOptionalInteger(input.value, { allowSign: true });
        input.value = formatOptionalIntegerInput(value, { showPlus: true });
        this._initiativeInputDraft = undefined;
        await enqueueSheetUpdate("_portraitLozengeSaveQueue", "Portrait lozenge", async () => {
          await this.actor.setPeasantInitiative?.(value);
        });
        return;
      }
      event.stopPropagation();
      if (field === "system.movement") {
        const value = Math.max(0, Number.parseInt(input.value, 10) || 0);
        input.value = String(value);
        await enqueueSheetUpdate("_portraitLozengeSaveQueue", "Portrait lozenge", async () => {
          await this.actor.setPeasantMovement?.(value);
        });
        return;
      }
    });

    const collectAdvantagesFromDOM = () => collectAdvantagesFromSheet(this);
    const blurActiveEditableInSheet = () => blurActiveEditableInSheetHelper(this);
    const runQueuedInputUpdate = (input, queueKey, label, task) => runQueuedInputUpdateHelper(this, input, queueKey, label, task, { enqueueSheetUpdate });

    // D&D-style form handling: free text fields save on change/blur instead of synthetic per-keystroke changes.
             
    // Ensure initial sheet-level flag exists
    if (this._woundsMenuOpen === undefined) this._woundsMenuOpen = false;

    try {
      setupSheetKeyboardNavigation(this, html, { sheetDocument });
    } catch (err) {
      pcLog.debug('Failed to setup arrow key navigation:', err);
    }

    setupWoundsControls(this, html);

    setupCombatModifierControls(this, html, { blurActiveEditableInSheet, enqueueSheetUpdate, runQueuedInputUpdate });

    setupResourceControls(this, html, { runQueuedInputUpdate });
    setupHealthStressControls(this, html);

    setupDamageHealControls(this, html);

    setupBlessingControls(this, html);

    setupPortraitControls(this, html);

    setupBasicSkillAdvantageControls(this, html, { blurActiveEditableInSheet, collectAdvantagesFromDOM, enqueueSheetUpdate, runQueuedInputUpdate });
    setupSkillAdvantageDragDropControls(this, html, { sheetDocument, sheetBody, blurActiveEditableInSheet, collectAdvantagesFromDOM, enqueueSheetUpdate });
    setupSkillAdvantageDescriptionEditors(this, html, { enqueueSheetUpdate });
    setupNotableCombatControls(this, html, { blurActiveEditableInSheet, enqueueSheetUpdate, runQueuedInputUpdate });
    setupNotableCombatDragDropControls(this, html, { sheetDocument });
    setupNotableCombatTagEditorControls(this, html, { sheetDocument, sheetBody });
    setupInventoryControls(this, html, { runQueuedInputUpdate });

  }

}

configurePeasantActorSheetHooks({
  sheetClass: PeasantActorSheet,
  actorClass: PeasantActor,
  characterModel: PeasantCharacterModel,
  documentSheetConfig: DocumentSheetConfig,
  tokenHudClass: TokenHUDClass,
  isPeasantCharacterType
});
