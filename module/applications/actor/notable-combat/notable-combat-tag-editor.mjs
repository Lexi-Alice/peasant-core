import { openNotableCombatDescriptionEditor } from "./notable-combat-description-editor.mjs";
import { setupNotableCombatTagEditorDrag } from "./notable-combat-drag-drop.mjs";
import { getActiveNotableCombatEditorTags } from "./notable-combat-tag-display.mjs";
import { createNotableCombatTagEditorState } from "./notable-combat-tag-editor-state.mjs";
import { renderNotableCombatTagInputs } from "./notable-combat-tag-input-helpers.mjs";
import { renderNotableCombatTagList } from "./notable-combat-tag-list.mjs";
import { setupNotableCombatTagRemoveControls } from "./notable-combat-tag-remove-controls.mjs";
import { setupNotableCombatTagSaveControls } from "./notable-combat-tag-save-controls.mjs";
import { setupNotableCombatTagSelectionControls } from "./notable-combat-tag-selection-controls.mjs";
import { renderSheetOwnedApplication } from "../controls/sheet-owned-apps.mjs";
import { pcLog } from "../../../utils/logging.mjs";

const ApplicationV2 = foundry?.applications?.api?.ApplicationV2;
const HandlebarsApplicationMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;

if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error("Peasant Core requires Foundry's ApplicationV2 and HandlebarsApplicationMixin.");
}

const NotableCombatTagEditorBase = HandlebarsApplicationMixin(ApplicationV2);
const TAG_EDITOR_BODY_TEMPLATE = "systems/peasant-core/templates/actor/apps/notable-combat-tag-editor-body.hbs";
const TAG_EDITOR_FOOTER_TEMPLATE = "systems/peasant-core/templates/actor/apps/notable-combat-tag-editor-footer.hbs";

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
          width: 480,
          height: "auto"
        }
      })
      : {
        position: {
          width: 480,
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
  constructor(sheet, combatIndex, options = {}) {
    const combatName = getCombatData(sheet, combatIndex).name || "Combat";
    const appOptions = foundry.utils.mergeObject({
      id: `peasant-combat-tag-${sheet.id}-${combatIndex}`,
      classes: ["peasant-core", "peasant-tag-editor", "pc-notable-combat-tag-editor", "standard-form"],
      position: {
        width: 480,
        height: "auto"
      },
      window: {
        title: `Combat Tags: ${combatName}`,
        icon: "fa-solid fa-tags",
        resizable: true
      }
    }, options, { inplace: false });
    super(appOptions);

    this.sheet = sheet;
    this.combatIndex = combatIndex;
    this._controlsBound = false;
    this._tagEditor = null;
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
    return Object.assign(context, {
      combatName: getCombatData(this.sheet, this.combatIndex).name || "Combat"
    });
  }

  async _onRender(context, options) {
    if (typeof super._onRender === "function") await super._onRender(context, options);

    const $container = $(this.element);
    if (!this._controlsBound) {
      this._tagEditor = createNotableCombatTagEditorState($container);
      this._bindTagEditorControls($container);
      this._controlsBound = true;
    }

    this._renderCurrentTags($container);
    this._tagEditor?.syncUi();
  }

  _bindTagEditorControls($container) {
    const buildTagInputs = (tagType) => {
      renderNotableCombatTagInputs($container, tagType, this._getCombatData(), {
        tagEditorState: this._tagEditor.state
      });
    };

    setupNotableCombatTagSelectionControls($container, {
      tagEditor: this._tagEditor,
      buildTagInputs,
      openDescriptionEditor: () => this._openDescriptionEditor($container)
    });

    setupNotableCombatTagRemoveControls(this.sheet, $container, this.combatIndex, {
      onChanged: () => this._renderCurrentTags($container)
    });

    setupNotableCombatTagSaveControls(this.sheet, $container, this.combatIndex, {
      tagEditor: this._tagEditor,
      getCombatData: () => this._getCombatData(),
      openDescriptionEditor: () => this._openDescriptionEditor($container),
      onChanged: () => this._renderCurrentTags($container)
    });
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

  _openDescriptionEditor($container = $(this.element)) {
    return openNotableCombatDescriptionEditor(this.sheet, this.combatIndex, {
      onSaveCallback: () => this._renderCurrentTags($container)
    });
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
