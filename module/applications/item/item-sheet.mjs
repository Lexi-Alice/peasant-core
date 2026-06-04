import { PEASANT_ITEM_TYPES } from "../../data/item/_module.mjs";
import { PeasantItem } from "../../documents/_module.mjs";
import { ensureSlideToggleElement } from "../components/slide-toggle.mjs";
import { configurePeasantItemSheetHooks } from "./hooks.mjs";

const ItemSheetV2Class = foundry?.applications?.sheets?.ItemSheetV2;
const HandlebarsApplicationMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;
if (!ItemSheetV2Class || !HandlebarsApplicationMixin) {
  throw new Error("Peasant Core requires Foundry's ItemSheetV2 and HandlebarsApplicationMixin.");
}

const ItemSheetBase = HandlebarsApplicationMixin(ItemSheetV2Class);
const DocumentSheetConfig = foundry?.applications?.apps?.DocumentSheetConfig;
const ImagePopoutClass = foundry?.applications?.apps?.ImagePopout;
const FilePickerClass = foundry?.applications?.apps?.FilePicker;
const TextEditorImplementation = foundry.applications.ux.TextEditor.implementation;
const PC_ITEM_SHEET_TEMPLATE = "systems/peasant-core/templates/item/item-sheet.hbs";
const PC_ITEM_IMAGE_PAN_MIN_SCALE = 1.02;
const PC_ITEM_IMAGE_MAX_SCALE = 4;
const PC_ITEM_TABS = Object.freeze([
  { tab: "description", label: "Description", icon: "fa-solid fa-book-open" },
  { tab: "details", label: "Details", icon: "fa-solid fa-list" },
  { tab: "activities", label: "Activities", icon: "fa-solid fa-dice" },
  { tab: "effects", label: "Effects", icon: "fa-solid fa-bolt" }
]);
const PC_ITEM_QUALITY_OPTIONS = Object.freeze([
  { value: "standard", label: "Standard" },
  { value: "masterwork-1", label: "Masterwork 1" },
  { value: "masterwork-2", label: "Masterwork 2" },
  { value: "masterwork-3", label: "Masterwork 3" },
  { value: "masterwork-4", label: "Masterwork 4" },
  { value: "masterwork-5", label: "Masterwork 5" },
  { value: "grandmasters", label: "Grandmasters" }
]);
const PC_ITEM_MAGIC_TYPE_OPTIONS = Object.freeze([
  { value: "mundane", label: "Mundane" },
  { value: "magical", label: "Magical" }
]);
const PC_ITEM_CURRENCY_OPTIONS = Object.freeze([
  { value: "gp", label: "gp" },
  { value: "rs", label: "rs" },
  { value: "pp", label: "pp" }
]);
const PC_LOOT_CATEGORY_OPTIONS = Object.freeze([
  { value: "art-object", label: "Art Object" },
  { value: "adventuring-gear", label: "Adventuring Gear" },
  { value: "gemstone", label: "Gemstone" },
  { value: "titanite", label: "Titanite" },
  { value: "junk", label: "Junk" },
  { value: "material", label: "Material" },
  { value: "resource", label: "Resource" },
  { value: "trade-good", label: "Trade Good" },
  { value: "treasure", label: "Treasure" }
]);

let ItemDescriptionMenuClass = null;
let itemDescriptionPluginListenerRegistered = false;

function getItemDescriptionMenuClass() {
  const BaseMenu = foundry?.prosemirror?.plugins?.ProseMirrorMenu;
  if (!BaseMenu) return null;
  if (ItemDescriptionMenuClass) return ItemDescriptionMenuClass;

  ItemDescriptionMenuClass = class PeasantItemDescriptionMenu extends BaseMenu {
    _onResize() {
      // The item description toolbar is allowed to wrap instead of collapsing controls into dropdowns.
    }
  };
  return ItemDescriptionMenuClass;
}

function configureExpandedItemDescriptionPlugins(event) {
  const editor = event.target;
  if (!editor?.matches?.('prose-mirror.pc-item-description-editor[name="system.description"]')) return;
  if (!editor.closest?.(".peasant-item-sheet")) return;

  const prosemirror = foundry?.prosemirror;
  const MenuClass = getItemDescriptionMenuClass();
  const plugins = event.plugins ?? event.detail;
  if (!prosemirror?.defaultSchema || !MenuClass || !plugins) return;

  plugins.menu = MenuClass.build(prosemirror.defaultSchema, {
    destroyOnSave: editor.hasAttribute("toggled")
  });
}

function registerExpandedItemDescriptionEditor() {
  if (itemDescriptionPluginListenerRegistered) return;
  const document = globalThis.document;
  if (!document?.addEventListener) return;
  document.addEventListener("plugins", configureExpandedItemDescriptionPlugins, { capture: true });
  itemDescriptionPluginListenerRegistered = true;
}

function formatOptionalNumber(value) {
  return value === null || value === undefined ? "" : String(value);
}

function getSelectedOptions(options, value, fallback) {
  const activeValue = String(value || fallback);
  return options.map(option => ({
    ...option,
    selected: option.value === activeValue
  }));
}

function getItemQualityOptions(quality) {
  return getSelectedOptions(PC_ITEM_QUALITY_OPTIONS, quality, "standard");
}

function getDefaultItemImage() {
  return foundry?.utils?.getProperty?.(CONFIG, "Item.documentClass.DEFAULT_ICON")
    || foundry?.utils?.getProperty?.(CONFIG, "Item.defaultIcon")
    || "icons/svg/item-bag.svg";
}

function normalizeImageOffset(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeImageScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(PC_ITEM_IMAGE_MAX_SCALE, Math.max(1, number));
}

function formatItemImageStyle(system) {
  const scale = normalizeImageScale(system?.imageScale);
  const offsetX = scale <= PC_ITEM_IMAGE_PAN_MIN_SCALE ? 0 : normalizeImageOffset(system?.imageOffsetX);
  const offsetY = scale <= PC_ITEM_IMAGE_PAN_MIN_SCALE ? 0 : normalizeImageOffset(system?.imageOffsetY);
  return `transform: translate(-50%, -50%) translate3d(${Math.round(offsetX)}px, ${Math.round(offsetY)}px, 0) scale(${scale});`;
}

function getApplicationElement(appOrElement) {
  const source = appOrElement?.element ?? appOrElement;
  if (!source) return null;
  if (source.nodeType === 1 && typeof source.querySelector === "function") return source;
  const first = source?.[0];
  return first?.nodeType === 1 && typeof first.querySelector === "function" ? first : null;
}

function looksLikeImagePath(value) {
  const path = String(value ?? "").trim();
  if (!path) return false;
  if (/^data:image\//i.test(path)) return true;
  if (/^(?:https?:\/\/|\/|[A-Za-z]:\\|icons\/|systems\/|modules\/|worlds\/|uploads\/|assets\/)/i.test(path)) return true;
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(path);
}

function findImagePathInObject(data) {
  if (!data || typeof data !== "object") return "";
  const direct = data.img || data.src || data.path || data.url || data.texture?.src || data.document?.img;
  if (looksLikeImagePath(direct)) return String(direct).trim();
  return "";
}

async function imagePathFromDropData(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  if (looksLikeImagePath(text)) return text;

  try {
    const data = JSON.parse(text);
    const path = findImagePathInObject(data);
    if (path) return path;

    const uuid = data?.uuid || data?.documentUuid;
    if (uuid && typeof fromUuid === "function") {
      const document = await fromUuid(uuid);
      const documentPath = findImagePathInObject(document);
      if (documentPath) return documentPath;
    }
  } catch (err) {
    return "";
  }

  return "";
}

async function getImagePathFromDrop(event) {
  const transfer = event?.dataTransfer;
  if (!transfer) return "";

  const transferTypes = ["application/json", "text/uri-list", "text/plain", "text"];
  for (const type of transferTypes) {
    const path = await imagePathFromDropData(transfer.getData(type));
    if (path) return path;
  }

  for (const file of Array.from(transfer.files ?? [])) {
    if (!file?.type?.startsWith?.("image/")) continue;
    if (looksLikeImagePath(file.path)) return file.path;
    if (looksLikeImagePath(file.name)) return file.name;
  }

  return "";
}

registerExpandedItemDescriptionEditor();

export class PeasantItemSheet extends ItemSheetBase {
  static MODES = {
    PLAY: 1,
    EDIT: 2
  };

  static DEFAULT_OPTIONS = {
    classes: ["peasant-core", "peasant-item-sheet", "item"],
    position: {
      width: 560
    },
    window: {
      contentClasses: ["pc-item-sheet-window-content"],
      resizable: false
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    sheet: {
      template: PC_ITEM_SHEET_TEMPLATE
    }
  };

  _activeItemTab = "description";
  _mode = null;

  get isEditMode() {
    return this._mode === this.constructor.MODES.EDIT;
  }

  get title() {
    return this.item?.name || super.title;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const type = this.item?.type || "";
    const system = this.item?.system || {};
    const description = String(system.description ?? "");
    const itemTabs = this._getItemTabs(this._activeItemTab, type);
    const activeItemTab = itemTabs.find(tab => tab.active)?.tab || "description";
    const activeTabs = Object.fromEntries(itemTabs.map(({ tab }) => [tab, tab === activeItemTab]));
    const availableItemTabs = Object.fromEntries(itemTabs.map(({ tab }) => [tab, true]));
    const effects = Array.from(this.item?.effects ?? []).map(effect => ({
      id: effect.id,
      name: effect.name ?? effect.label ?? "Effect",
      icon: effect.img || effect.icon || "icons/svg/aura.svg",
      disabled: !!effect.disabled,
      status: effect.disabled ? "Disabled" : "Enabled"
    }));

    return Object.assign(context, {
      item: this.item,
      document: this.item,
      system,
      editable: this.isEditable && this.isEditMode,
      canEdit: this.isEditable,
      validItemType: PEASANT_ITEM_TYPES.includes(type),
      isWeapon: type === "weapon",
      isEquipment: type === "equipment",
      isTool: type === "tool",
      isConsumable: type === "consumable",
      isLoot: type === "loot",
      imageSrc: this.item?.img || getDefaultItemImage(),
      imageStyle: formatItemImageStyle(system),
      quantityInput: formatOptionalNumber(system.quantity ?? 1),
      valueInput: formatOptionalNumber(system.value ?? 0),
      sunderCurrentInput: formatOptionalNumber(system.sunder?.current ?? 0),
      sunderMaxInput: formatOptionalNumber(system.sunder?.max ?? 0),
      qualityOptions: getItemQualityOptions(system.quality),
      magicTypeOptions: getSelectedOptions(PC_ITEM_MAGIC_TYPE_OPTIONS, system.magicType, "mundane"),
      currencyOptions: getSelectedOptions(PC_ITEM_CURRENCY_OPTIONS, system.currency, "gp"),
      lootCategoryOptions: getSelectedOptions(PC_LOOT_CATEGORY_OPTIONS, system.category, "art-object"),
      itemTabs,
      activeItemTab,
      activeTabs,
      availableItemTabs,
      effects,
      descriptionHTML: await TextEditorImplementation.enrichHTML(description, { async: true }),
      inputs: {
        tohit: formatOptionalNumber(system.tohit),
        accuracy: formatOptionalNumber(system.accuracy),
        ap: formatOptionalNumber(system.ap),
        sp: formatOptionalNumber(system.sp),
        rangeRate0: formatOptionalNumber(system.rangeRate?.[0]),
        rangeRate1: formatOptionalNumber(system.rangeRate?.[1]),
        rangeRate2: formatOptionalNumber(system.rangeRate?.[2]),
        rangeRate3: formatOptionalNumber(system.rangeRate?.[3])
      }
    });
  }

  async _onRender(context, options) {
    if (typeof super._onRender === "function") await super._onRender(context, options);
    if (this._itemImageTransformDirty) await this._saveItemImageTransform();
    this._bindItemTabButtons();
    this._applyItemTab(this._activeItemTab);
    this._renderModeToggle();
    this._setupItemImageControls();
    const root = getApplicationElement(this);
    root?.classList.toggle("editable", this.isEditable && this.isEditMode);
    root?.classList.toggle("interactable", this.isEditable && !this.isEditMode);
    root?.classList.toggle("locked", !this.isEditable);
    this._fitToContent();
  }

  _configureRenderOptions(options) {
    if (typeof super._configureRenderOptions === "function") super._configureRenderOptions(options);

    let { mode, renderContext } = options;
    if ((mode === undefined) && (renderContext === "createItem")) mode = this.constructor.MODES.EDIT;
    this._mode = mode ?? this._mode ?? this.constructor.MODES.PLAY;
  }

  async close(options) {
    if (this.isEditable && this.isEditMode) await this._saveItemImageTransform();
    if (this.isEditable && this.isEditMode && typeof this.submit === "function") {
      try { await this.submit(); } catch (err) { /* Foundry will surface validation failures. */ }
    }
    this._teardownItemImageControls();
    return super.close(options);
  }

  _renderModeToggle() {
    const header = getApplicationElement(this)?.querySelector(".window-header");
    if (!header) return;
    ensureSlideToggleElement(header.ownerDocument?.defaultView);

    let toggle = header.querySelector("slide-toggle.mode-slider");
    if (!this.isEditable) {
      toggle?.remove();
      return;
    }

    const positionToggle = () => {
      const firstHeaderControl = Array.from(header.children)
        .find(element => element.matches?.(".header-control, [data-action='close']"));
      if (firstHeaderControl?.parentElement === header) firstHeaderControl.before(toggle);
      else header.prepend(toggle);
    };

    if (!toggle) {
      toggle = header.ownerDocument.createElement("slide-toggle");
      toggle.classList.add("mode-slider");
      toggle.addEventListener("dblclick", event => event.stopPropagation());
      toggle.addEventListener("pointerdown", event => event.stopPropagation());
      toggle.addEventListener("change", event => this._onChangeSheetMode(event, toggle));
    }

    toggle.checked = this.isEditMode;
    this._syncModeToggleLabel(toggle);
    positionToggle();
  }

  _syncModeToggleLabel(toggle) {
    const label = toggle.checked ? "Enter View Mode" : "Enter Edit Mode";
    toggle.dataset.tooltip = label;
    toggle.setAttribute("aria-label", label);
  }

  async _onChangeSheetMode(event, target = event.currentTarget) {
    if (!this.isEditable) return;
    const { MODES } = this.constructor;
    const nextMode = target.checked ? MODES.EDIT : MODES.PLAY;

    target.disabled = true;
    try {
      if (this.isEditMode && nextMode !== this._mode && typeof this.submit === "function") {
        await this._saveItemImageTransform();
        await this.submit();
      }
      this._mode = nextMode;
      this._syncModeToggleLabel(target);
      await this.render({ preserveScroll: false });
    } finally {
      if (target.isConnected) target.disabled = false;
    }
  }

  _teardownItemImageControls() {
    try { this._itemImageRO?.disconnect?.(); } catch (err) { /* ignore */ }
    try { this._itemImageEventController?.abort?.(); } catch (err) { /* ignore */ }
    this._itemImageRO = null;
    this._itemImageEventController = null;
  }

  _setupItemImageControls() {
    this._teardownItemImageControls();

    const root = getApplicationElement(this);
    const frame = root?.querySelector?.("[data-pc-item-image-frame]");
    if (!frame) return;

    const controller = new AbortController();
    const { signal } = controller;
    this._itemImageEventController = controller;

    const image = frame.querySelector(".pc-item-image");
    const editable = this.isEditable && this.isEditMode;
    const debouncedSave = editable ? foundry.utils.debounce(() => this._saveItemImageTransform(), 400) : () => {};

    const state = {
      offsetX: normalizeImageOffset(this.item?.system?.imageOffsetX),
      offsetY: normalizeImageOffset(this.item?.system?.imageOffsetY),
      scale: normalizeImageScale(this.item?.system?.imageScale),
      naturalWidth: 0,
      naturalHeight: 0,
      imgRatio: 1,
      baseWidth: 0,
      baseHeight: 0
    };
    if (state.scale <= PC_ITEM_IMAGE_PAN_MIN_SCALE) {
      state.offsetX = 0;
      state.offsetY = 0;
    }
    this._itemImageState = state;

    let frameSize = { width: frame.clientWidth || 0, height: frame.clientHeight || 0 };
    let pendingTransform = null;
    let rafPending = false;

    const updateImageMetrics = (sizeOverride) => {
      if (!image) return;
      const naturalWidth = image.naturalWidth || image.clientWidth || image.width || 0;
      const naturalHeight = image.naturalHeight || image.clientHeight || image.height || 0;
      const width = sizeOverride?.width ?? frame.clientWidth ?? 0;
      const height = sizeOverride?.height ?? frame.clientHeight ?? 0;
      if (naturalWidth > 0 && naturalHeight > 0) {
        state.naturalWidth = naturalWidth;
        state.naturalHeight = naturalHeight;
        state.imgRatio = naturalWidth / naturalHeight;
      } else if (width > 0 && height > 0) {
        state.imgRatio = width / height;
      } else {
        state.imgRatio = 1;
      }

      let ratio = state.imgRatio || 1;
      if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;

      let baseWidth = width || state.baseWidth || 0;
      let baseHeight = height || state.baseHeight || 0;
      if (width > 0 && height > 0) {
        const frameRatio = width / height;
        if (frameRatio < ratio) {
          baseHeight = height;
          baseWidth = height * ratio;
        } else {
          baseWidth = width;
          baseHeight = width / ratio;
        }
      }

      if (baseWidth > 0 && baseHeight > 0) {
        const roundedWidth = Math.round(baseWidth);
        const roundedHeight = Math.round(baseHeight);
        if (roundedWidth !== state.baseWidth || roundedHeight !== state.baseHeight) {
          state.baseWidth = roundedWidth;
          state.baseHeight = roundedHeight;
          image.style.width = `${roundedWidth}px`;
          image.style.height = `${roundedHeight}px`;
        }
      }
    };

    const clampImageTransform = (offsetX, offsetY, scale) => {
      const width = frameSize.width || frame.clientWidth || 0;
      const height = frameSize.height || frame.clientHeight || 0;
      const safeScale = normalizeImageScale(scale);

      if (width <= 0 || height <= 0) return { offsetX: 0, offsetY: 0, scale: 1 };
      if (safeScale <= PC_ITEM_IMAGE_PAN_MIN_SCALE) return { offsetX: 0, offsetY: 0, scale: safeScale };

      const baseWidth = state.baseWidth || image?.clientWidth || width;
      const baseHeight = state.baseHeight || image?.clientHeight || height;
      const displayedWidth = baseWidth * safeScale;
      const displayedHeight = baseHeight * safeScale;
      const maxX = Math.max(0, (displayedWidth - width) / 2);
      const maxY = Math.max(0, (displayedHeight - height) / 2);
      return {
        offsetX: Math.min(maxX, Math.max(-maxX, normalizeImageOffset(offsetX))),
        offsetY: Math.min(maxY, Math.max(-maxY, normalizeImageOffset(offsetY))),
        scale: safeScale
      };
    };

    const applyImageTransform = (offsetX, offsetY, scale) => {
      if (!image) return;
      const clamped = clampImageTransform(offsetX, offsetY, scale);
      image.style.transform = `translate(-50%, -50%) translate3d(${clamped.offsetX}px, ${clamped.offsetY}px, 0) scale(${clamped.scale})`;
      state.offsetX = clamped.offsetX;
      state.offsetY = clamped.offsetY;
      state.scale = clamped.scale;
    };

    const scheduleImageTransform = (offsetX, offsetY, scale) => {
      pendingTransform = { offsetX, offsetY, scale };
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!pendingTransform) return;
        const next = pendingTransform;
        pendingTransform = null;
        applyImageTransform(next.offsetX, next.offsetY, next.scale);
      });
    };

    const ensureClamped = () => applyImageTransform(state.offsetX, state.offsetY, state.scale);
    updateImageMetrics(frameSize);

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        frameSize = { width: frame.clientWidth || 0, height: frame.clientHeight || 0 };
        updateImageMetrics(frameSize);
        ensureClamped();
      });
      ro.observe(frame);
      this._itemImageRO = ro;
    }

    if (image) {
      try { image.setAttribute("draggable", "false"); } catch (err) { /* ignore */ }
      if (!image.complete || image.naturalWidth === 0) {
        image.addEventListener("load", () => {
          updateImageMetrics(frameSize);
          ensureClamped();
        }, { once: true, signal });
      } else {
        updateImageMetrics(frameSize);
      }

      if (editable) {
        image.addEventListener("wheel", (event) => {
          event.preventDefault();
          const step = (event.deltaY ?? 0) > 0 ? -0.1 : 0.1;
          const nextScale = Math.min(PC_ITEM_IMAGE_MAX_SCALE, Math.max(1, state.scale + step));
          const clamped = clampImageTransform(state.offsetX, state.offsetY, nextScale);
          this._itemImageTransformDirty = true;
          scheduleImageTransform(clamped.offsetX, clamped.offsetY, clamped.scale);
          debouncedSave();
        }, { signal, passive: false });

        let isDragging = false;
        let activePointerId = null;
        let lastX = 0;
        let lastY = 0;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let startScale = 1;

        const stopDragging = (event) => {
          if (!isDragging) return;
          if (activePointerId !== null && event && event.pointerId !== activePointerId) return;
          isDragging = false;
          activePointerId = null;
          dragOffsetX = state.offsetX;
          dragOffsetY = state.offsetY;
          image.classList.remove("draggable");
          try { image.releasePointerCapture(event?.pointerId); } catch (err) { /* ignore */ }
          this._itemImageTransformDirty = true;
          debouncedSave();
        };

        image.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 && event.pointerType !== "touch") return;
          if (state.scale <= PC_ITEM_IMAGE_PAN_MIN_SCALE) return;
          event.preventDefault();
          const current = clampImageTransform(state.offsetX, state.offsetY, state.scale);
          startScale = current.scale;
          dragOffsetX = current.offsetX;
          dragOffsetY = current.offsetY;
          lastX = event.clientX;
          lastY = event.clientY;
          isDragging = true;
          activePointerId = event.pointerId;
          image.classList.add("draggable");
          try { image.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
        }, { signal });

        image.addEventListener("pointermove", (event) => {
          if (!isDragging) return;
          if (activePointerId !== null && event.pointerId !== activePointerId) return;
          event.preventDefault();
          const dx = event.clientX - lastX;
          const dy = event.clientY - lastY;
          lastX = event.clientX;
          lastY = event.clientY;
          const clamped = clampImageTransform(dragOffsetX + dx, dragOffsetY + dy, startScale);
          dragOffsetX = clamped.offsetX;
          dragOffsetY = clamped.offsetY;
          scheduleImageTransform(clamped.offsetX, clamped.offsetY, clamped.scale);
        }, { signal });

        image.addEventListener("pointerup", stopDragging, { signal });
        image.addEventListener("pointercancel", stopDragging, { signal });
        image.addEventListener("lostpointercapture", stopDragging, { signal });
      }
    }

    ensureClamped();

    frame.addEventListener("click", (event) => {
      if (event.target?.closest?.("[data-pc-item-image-picker]")) return;
      if (this.isEditable && this.isEditMode) return;
      event.preventDefault();
      this._openItemImagePopout();
    }, { signal });

    if (editable) {
      const setDragOver = (event) => {
        event.preventDefault();
        frame.classList.add("drag-over");
      };
      frame.addEventListener("dragenter", setDragOver, { signal });
      frame.addEventListener("dragover", setDragOver, { signal });
      frame.addEventListener("dragleave", (event) => {
        if (!frame.contains(event.relatedTarget)) frame.classList.remove("drag-over");
      }, { signal });
      frame.addEventListener("drop", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        frame.classList.remove("drag-over");
        const path = await getImagePathFromDrop(event);
        if (path) await this._setItemImage(path);
      }, { signal });
    }

    for (const button of root.querySelectorAll("[data-pc-item-image-picker]")) {
      button.addEventListener("click", event => this._openItemImagePicker(event), { signal });
    }
  }

  async _openItemImagePicker(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isEditable || !this.isEditMode) return;
    if (!FilePickerClass) return;

    const picker = new FilePickerClass({
      type: "image",
      current: this.item?.img || getDefaultItemImage(),
      callback: async path => this._setItemImage(path)
    });
    picker.render(true);
  }

  _openItemImagePopout() {
    const src = this.item?.img || getDefaultItemImage();
    if (!src) return;
    try {
      if (ImagePopoutClass) {
        const popout = new ImagePopoutClass({
          src,
          uuid: this.item?.uuid,
          window: { title: `${this.item?.name || "Item"} - Image` }
        });
        popout.render(true);
      } else {
        window.open(src, "_blank");
      }
    } catch (err) {
      window.open(src, "_blank");
    }
  }

  async _setItemImage(path) {
    const nextPath = String(path ?? "").trim();
    if (!nextPath || !this.isEditable || !this.isEditMode) return;

    const updateData = { img: nextPath };
    if (nextPath !== this.item?.img) {
      updateData["system.imageOffsetX"] = 0;
      updateData["system.imageOffsetY"] = 0;
      updateData["system.imageScale"] = 1;
    }
    this._itemImageTransformDirty = false;
    await this.item.update(updateData);
  }

  async _saveItemImageTransform() {
    if (!this._itemImageTransformDirty || !this.isEditable) return;
    const state = this._itemImageState;
    if (!state) {
      this._itemImageTransformDirty = false;
      return;
    }

    const scale = normalizeImageScale(state.scale);
    const offsetX = scale <= PC_ITEM_IMAGE_PAN_MIN_SCALE ? 0 : Math.round(normalizeImageOffset(state.offsetX));
    const offsetY = scale <= PC_ITEM_IMAGE_PAN_MIN_SCALE ? 0 : Math.round(normalizeImageOffset(state.offsetY));
    const storedScale = parseFloat(scale.toFixed(3));
    const currentScale = parseFloat(normalizeImageScale(this.item?.system?.imageScale).toFixed(3));
    const currentOffsetX = Math.round(normalizeImageOffset(this.item?.system?.imageOffsetX));
    const currentOffsetY = Math.round(normalizeImageOffset(this.item?.system?.imageOffsetY));

    if (offsetX === currentOffsetX && offsetY === currentOffsetY && storedScale === currentScale) {
      this._itemImageTransformDirty = false;
      return;
    }

    this._itemImageTransformDirty = false;
    try {
      await this.item.update({
        "system.imageOffsetX": offsetX,
        "system.imageOffsetY": offsetY,
        "system.imageScale": storedScale
      });
    } catch (err) {
      this._itemImageTransformDirty = true;
      console.warn("Failed to save item image position:", err);
    }
  }

  _fitToContent() {
    const root = getApplicationElement(this);
    if (!root) return;
    root.style.height = "auto";
    root.style.minHeight = "0";
    root.style.maxHeight = "calc(100vh - 80px)";
  }

  _bindItemTabButtons() {
    const root = getApplicationElement(this);
    if (!root) return;

    for (const button of root.querySelectorAll("[data-pc-item-tab]")) {
      button.removeEventListener("click", this._onItemTabClick);
      button.addEventListener("click", this._onItemTabClick);
    }
  }

  _onItemTabClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const tab = event.currentTarget?.dataset?.pcItemTab;
    if (tab) this.changeTab(tab, "primary", { event });
  };

  _getAvailableItemTabs(type = this.item?.type || "") {
    if (type !== "loot") return PC_ITEM_TABS;
    return PC_ITEM_TABS.filter(tabConfig => tabConfig.tab !== "activities" && tabConfig.tab !== "effects");
  }

  _normalizeItemTab(tab, type = this.item?.type || "") {
    const requestedTab = String(tab ?? "");
    const tabs = this._getAvailableItemTabs(type);
    return tabs.some(tabConfig => tabConfig.tab === requestedTab) ? requestedTab : "description";
  }

  _getItemTabs(activeItemTab = this._activeItemTab, type = this.item?.type || "") {
    const activeTab = this._normalizeItemTab(activeItemTab, type);
    return this._getAvailableItemTabs(type).map(({ tab, ...config }) => {
      const active = tab === activeTab;
      return {
        ...config,
        tab,
        active,
        cssClass: active ? "active" : ""
      };
    });
  }

  _applyItemTab(tab) {
    const activeTab = this._normalizeItemTab(tab);
    this._activeItemTab = activeTab;

    const root = getApplicationElement(this);
    if (!root) return;

    for (const panel of root.querySelectorAll("[data-pc-item-tab-panel]")) {
      const active = panel.dataset.pcItemTabPanel === activeTab;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", active ? "false" : "true");
    }

    for (const button of root.querySelectorAll("[data-pc-item-tab]")) {
      const active = button.dataset.pcItemTab === activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    }
  }

  changeTab(tab, group = "primary", options = {}) {
    if (group !== "primary") {
      if (typeof super.changeTab === "function") return super.changeTab(tab, group, options);
      return undefined;
    }

    const activeTab = this._normalizeItemTab(tab);
    if (typeof super.changeTab === "function") {
      try {
        super.changeTab(activeTab, group, options);
      } catch (err) {
        // The item sheet owns this lightweight tab set.
      }
    }
    this._applyItemTab(activeTab);
    return undefined;
  }
}

configurePeasantItemSheetHooks({
  sheetClass: PeasantItemSheet,
  itemClass: PeasantItem,
  documentSheetConfig: DocumentSheetConfig
});
