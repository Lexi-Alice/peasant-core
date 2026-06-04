import { renderSheetOwnedApplication } from "./sheet-owned-apps.mjs";

const ApplicationV2 = foundry?.applications?.api?.ApplicationV2;
const HandlebarsApplicationMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;

if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error("Peasant Core requires Foundry's ApplicationV2 and HandlebarsApplicationMixin.");
}

const DescriptionEditorBase = HandlebarsApplicationMixin(ApplicationV2);
const DESCRIPTION_EDITOR_BODY_TEMPLATE = "systems/peasant-core/templates/actor/apps/description-editor-body.hbs";
const DESCRIPTION_EDITOR_FOOTER_TEMPLATE = "systems/peasant-core/templates/actor/apps/description-editor-footer.hbs";

let DescriptionEditorMenuClass = null;
let descriptionEditorPluginListenerRegistered = false;

function getDescriptionEditorMenuClass() {
  const BaseMenu = foundry?.prosemirror?.plugins?.ProseMirrorMenu;
  if (!BaseMenu) return null;
  if (DescriptionEditorMenuClass) return DescriptionEditorMenuClass;

  DescriptionEditorMenuClass = class PeasantExpandedDescriptionMenu extends BaseMenu {
    _onResize() {
      // Description editor toolbars wrap instead of collapsing controls into dropdowns.
    }
  };
  return DescriptionEditorMenuClass;
}

function configureExpandedDescriptionEditorPlugins(event) {
  const editor = event.target;
  if (!editor?.matches?.("prose-mirror.peasant-desc-editor")) return;
  if (!editor.closest?.(".pc-description-editor")) return;

  const prosemirror = foundry?.prosemirror;
  const MenuClass = getDescriptionEditorMenuClass();
  const plugins = event.plugins ?? event.detail;
  if (!prosemirror?.defaultSchema || !MenuClass || !plugins) return;

  plugins.menu = MenuClass.build(prosemirror.defaultSchema, {
    destroyOnSave: editor.hasAttribute("toggled")
  });
}

function registerExpandedDescriptionEditor() {
  if (descriptionEditorPluginListenerRegistered) return;
  const document = globalThis.document;
  if (!document?.addEventListener) return;
  document.addEventListener("plugins", configureExpandedDescriptionEditorPlugins, { capture: true });
  descriptionEditorPluginListenerRegistered = true;
}

registerExpandedDescriptionEditor();

export class PeasantDescriptionEditorApp extends DescriptionEditorBase {
  constructor(config, options = {}) {
    const appOptions = foundry.utils.mergeObject({
      id: config.id,
      classes: ["peasant-core", "pc-description-editor", "standard-form"],
      position: {
        width: 580,
        height: "auto"
      },
      window: {
        title: config.title,
        icon: config.icon ?? "fa-solid fa-pen-to-square",
        resizable: true
      }
    }, options, { inplace: false });
    super(appOptions);

    this.config = config;
  }

  static get DEFAULT_OPTIONS() {
    return foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
      actions: {
        save: PeasantDescriptionEditorApp._onSave,
        cancel: PeasantDescriptionEditorApp._onCancel
      }
    }, { inplace: false });
  }

  static get PARTS() {
    return {
      body: {
        template: DESCRIPTION_EDITOR_BODY_TEMPLATE
      },
      footer: {
        template: DESCRIPTION_EDITOR_FOOTER_TEMPLATE
      }
    };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      editorName: this.config.editorName,
      existing: this.config.existing ?? "",
      documentUuid: this.config.documentUuid ?? ""
    });
  }

  async _onRender(context, options) {
    if (typeof super._onRender === "function") await super._onRender(context, options);
    this._initializeEditor();
  }

  _initializeEditor() {
    const editor = this.element?.querySelector?.(`prose-mirror[name="${this.config.editorName}"]`);
    if (!editor) return;
    editor.value = this.config.existing ?? "";
  }

  _getEditorContent() {
    const editor = this.element?.querySelector?.(`prose-mirror[name="${this.config.editorName}"]`);
    if (!editor) throw new Error("Description editor did not render.");
    if (typeof editor.save === "function" && (typeof editor.isDirty !== "function" || editor.isDirty())) {
      editor.save();
    }
    return String(editor.value ?? "");
  }

  async _saveAndClose() {
    try {
      const content = this._getEditorContent();
      await this.config.save?.(content);
      await this.close({ submitted: true });
    } catch (err) {
      console.error(this.config.errorLogMessage ?? "Failed to save description editor content:", err);
      ui.notifications?.error?.(this.config.errorMessage ?? "Failed to save description. See console for details.");
    }
  }

  static async _onSave(event) {
    event.preventDefault();
    await this._saveAndClose();
  }

  static _onCancel(event) {
    event.preventDefault();
    this.close();
  }
}

export function renderPeasantDescriptionEditor(sheet, key, config, options = {}) {
  const applicationOptions = typeof sheet?._withDetachedOptions === "function"
    ? sheet._withDetachedOptions(options)
    : options;
  const application = new PeasantDescriptionEditorApp(config, applicationOptions);
  return renderSheetOwnedApplication(sheet, key, application);
}
