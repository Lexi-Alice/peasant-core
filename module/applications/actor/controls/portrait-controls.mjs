import { pcLog } from "../../../utils/logging.mjs";

const ImagePopoutClass = foundry?.applications?.apps?.ImagePopout;
const FilePickerClass = foundry?.applications?.apps?.FilePicker ?? globalThis.FilePicker;

export function teardownPortraitBindings(sheet) {
  try {
    if (sheet._portraitRO && typeof sheet._portraitRO.disconnect === "function") {
      sheet._portraitRO.disconnect();
    }
  } catch (e) { /* ignore */ }
  sheet._portraitRO = null;

  const ns = sheet._portraitMouseupNamespace;
  if (ns) {
    try { $(sheet._portraitMouseupDocument ?? sheet._getElementDocument?.()).off(`mouseup${ns}`); } catch (e) { /* ignore */ }
    sheet._portraitMouseupNamespace = null;
    sheet._portraitMouseupDocument = null;
  }
}

export function setupPortraitControls(sheet, html) {
  const sheetDocument = sheet._getElementDocument?.(html?.[0]) ?? document;
  const portraitEl = html.find(".character-portrait")[0];
  if (portraitEl) {
    const debouncedSave = foundry.utils.debounce(() => savePortraitFromDOM(sheet), 400);
    const portraitMouseupNamespace = `.peasant-portrait-save-${sheet.appId || sheet.id || "sheet"}`;
    sheet._portraitMouseupNamespace = portraitMouseupNamespace;
    const $portrait = $(portraitEl);
    const $portraitImg = $portrait.find("img");
    const portraitImg = $portraitImg[0];
    const portraitState = {
      offsetX: sheet.actor.system.portraitOffsetX || 0,
      offsetY: sheet.actor.system.portraitOffsetY || 0,
      scale: Math.max(1.0, sheet.actor.system.portraitScale || 1),
      naturalWidth: 0,
      naturalHeight: 0,
      imgRatio: 1,
      baseWidth: 0,
      baseHeight: 0
    };
    const PAN_MIN_SCALE = 1.02;
    let portraitSize = { width: portraitEl.clientWidth || 0, height: portraitEl.clientHeight || 0 };
    let rafPending = false;
    let pendingTransform = null;
    sheet._portraitState = portraitState;

    const readPortraitTransform = () => ({
      offsetX: portraitState.offsetX,
      offsetY: portraitState.offsetY,
      scale: portraitState.scale
    });

    const updatePortraitMetrics = (sizeOverride) => {
      if (!portraitImg) return;
      const nw = portraitImg.naturalWidth || portraitImg.clientWidth || portraitImg.width || 0;
      const nh = portraitImg.naturalHeight || portraitImg.clientHeight || portraitImg.height || 0;
      const width = sizeOverride?.width ?? portraitEl.clientWidth ?? 0;
      const height = sizeOverride?.height ?? portraitEl.clientHeight ?? 0;
      if (nw > 0 && nh > 0) {
        portraitState.naturalWidth = nw;
        portraitState.naturalHeight = nh;
        portraitState.imgRatio = nw / nh;
      } else if (width > 0 && height > 0) {
        portraitState.imgRatio = width / height;
      } else {
        portraitState.imgRatio = 1;
      }

      let ratio = portraitState.imgRatio || 1;
      if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;

      let baseW = width || portraitState.baseWidth || 0;
      let baseH = height || portraitState.baseHeight || 0;
      if (width > 0 && height > 0) {
        const containerRatio = width / height;
        if (containerRatio < ratio) {
          baseH = height;
          baseW = height * ratio;
        } else {
          baseW = width;
          baseH = width / ratio;
        }
      }

      if (baseW > 0 && baseH > 0) {
        const roundedW = Math.round(baseW);
        const roundedH = Math.round(baseH);
        if (roundedW !== portraitState.baseWidth || roundedH !== portraitState.baseHeight) {
          portraitState.baseWidth = roundedW;
          portraitState.baseHeight = roundedH;
          portraitImg.style.width = `${roundedW}px`;
          portraitImg.style.height = `${roundedH}px`;
        }
      }
    };
    updatePortraitMetrics(portraitSize);

    const clampPortraitTransform = (offsetX, offsetY, scale) => {
      const width = portraitSize.width || portraitEl.clientWidth || 0;
      const height = portraitSize.height || portraitEl.clientHeight || 0;
      const safeScale = Math.max(1.0, scale || 1);

      if (width <= 0 || height <= 0) return { offsetX: 0, offsetY: 0, scale: 1.0 };
      if (safeScale <= PAN_MIN_SCALE) return { offsetX: 0, offsetY: 0, scale: safeScale };

      const baseW = portraitState.baseWidth || portraitImg?.clientWidth || width;
      const baseH = portraitState.baseHeight || portraitImg?.clientHeight || height;
      const dispW = baseW * safeScale;
      const dispH = baseH * safeScale;
      const maxX = Math.max(0, (dispW - width) / 2);
      const maxY = Math.max(0, (dispH - height) / 2);
      const clampedX = Math.min(maxX, Math.max(-maxX, offsetX));
      const clampedY = Math.min(maxY, Math.max(-maxY, offsetY));
      return { offsetX: clampedX, offsetY: clampedY, scale: safeScale };
    };

    const applyPortraitTransform = (offsetX, offsetY, scale) => {
      if (!portraitImg) return;
      const clamped = clampPortraitTransform(offsetX, offsetY, scale);
      portraitImg.style.transform = `translate(-50%, -50%) translate3d(${clamped.offsetX}px, ${clamped.offsetY}px, 0) scale(${clamped.scale})`;
      portraitState.offsetX = clamped.offsetX;
      portraitState.offsetY = clamped.offsetY;
      portraitState.scale = clamped.scale;
    };

    const schedulePortraitTransform = (offsetX, offsetY, scale) => {
      pendingTransform = { offsetX, offsetY, scale };
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!pendingTransform) return;
        const next = pendingTransform;
        pendingTransform = null;
        applyPortraitTransform(next.offsetX, next.offsetY, next.scale);
      });
    };

    const ensurePortraitClamped = () => {
      if (!portraitImg) return;
      const current = readPortraitTransform();
      applyPortraitTransform(current.offsetX, current.offsetY, current.scale);
    };

    try {
      const ro = new ResizeObserver(() => {
        portraitSize = { width: portraitEl.clientWidth || 0, height: portraitEl.clientHeight || 0 };
        updatePortraitMetrics(portraitSize);
        ensurePortraitClamped();
        debouncedSave();
      });
      ro.observe(portraitEl);
      sheet._portraitRO = ro;
    } catch (err) {
      pcLog.debug("ResizeObserver not available for portrait autosave", err);
    }

    sheet._portraitMouseupDocument = sheetDocument;
    $(sheetDocument)
      .off(`mouseup${portraitMouseupNamespace}`)
      .on(`mouseup${portraitMouseupNamespace}`, () => debouncedSave());

    if (portraitImg) {
      try { portraitImg.setAttribute("draggable", "false"); } catch (e) {}
      if (!portraitImg.complete || portraitImg.naturalWidth === 0) {
        portraitImg.addEventListener("load", () => {
          updatePortraitMetrics(portraitSize);
          ensurePortraitClamped();
        }, { once: true });
      } else {
        updatePortraitMetrics(portraitSize);
      }

      $portraitImg.off("wheel.peasant-portrait").on("wheel.peasant-portrait", (ev) => {
        if (!sheet.isEditMode) return;
        ev.preventDefault();
        const delta = ev.originalEvent?.deltaY ?? ev.deltaY ?? 0;
        const step = delta > 0 ? -0.1 : 0.1;
        const maxScale = 4.0;
        const nextScale = Math.min(maxScale, Math.max(1.0, portraitState.scale + step));
        const clamped = clampPortraitTransform(portraitState.offsetX, portraitState.offsetY, nextScale);
        schedulePortraitTransform(clamped.offsetX, clamped.offsetY, clamped.scale);
      });

      let isDragging = false;
      let activePointerId = null;
      let lastX = 0;
      let lastY = 0;
      let dragOffsetX = 0;
      let dragOffsetY = 0;
      let startScale = 1;

      const stopDragging = (ev) => {
        if (!isDragging) return;
        if (activePointerId !== null && ev && ev.pointerId !== activePointerId) return;
        isDragging = false;
        activePointerId = null;
        dragOffsetX = portraitState.offsetX;
        dragOffsetY = portraitState.offsetY;
        $portraitImg.removeClass("draggable");
        try { portraitImg.releasePointerCapture(ev?.pointerId); } catch (e) {}
        debouncedSave();
      };

      $portraitImg.off("pointerdown.peasant-portrait").on("pointerdown.peasant-portrait", (ev) => {
        if (!sheet.isEditMode) return;
        if (ev.button !== 0 && ev.pointerType !== "touch") return;
        if (portraitState.scale <= PAN_MIN_SCALE) return;
        ev.preventDefault();
        const current = clampPortraitTransform(portraitState.offsetX, portraitState.offsetY, portraitState.scale);
        startScale = current.scale;
        dragOffsetX = current.offsetX;
        dragOffsetY = current.offsetY;
        lastX = ev.clientX;
        lastY = ev.clientY;
        isDragging = true;
        activePointerId = ev.pointerId;
        $portraitImg.addClass("draggable");
        try { portraitImg.setPointerCapture(ev.pointerId); } catch (e) {}
      });

      $portraitImg.off("pointermove.peasant-portrait").on("pointermove.peasant-portrait", (ev) => {
        if (!isDragging) return;
        if (activePointerId !== null && ev.pointerId !== activePointerId) return;
        ev.preventDefault();
        const dx = ev.clientX - lastX;
        const dy = ev.clientY - lastY;
        lastX = ev.clientX;
        lastY = ev.clientY;
        const clamped = clampPortraitTransform(dragOffsetX + dx, dragOffsetY + dy, startScale);
        dragOffsetX = clamped.offsetX;
        dragOffsetY = clamped.offsetY;
        schedulePortraitTransform(clamped.offsetX, clamped.offsetY, clamped.scale);
      });

      $portraitImg
        .off("pointerup.peasant-portrait pointercancel.peasant-portrait lostpointercapture.peasant-portrait")
        .on("pointerup.peasant-portrait pointercancel.peasant-portrait lostpointercapture.peasant-portrait", stopDragging);
    }

    ensurePortraitClamped();
  }

  try {
    $(portraitEl).on("click", "img", (ev) => {
      if (sheet.isEditMode) return;
      const img = ev.currentTarget;
      const src = img.getAttribute && (img.getAttribute("src") || img.dataset?.src) || img.src;
      if (!src) return;
      try {
        if (ImagePopoutClass) {
          const pop = new ImagePopoutClass({
            src,
            uuid: sheet.actor.uuid,
            window: { title: `${sheet.actor.name} - Portrait` }
          });
          pop.render(true);
        } else {
          window.open(src, "_blank");
        }
      } catch (err) {
        window.open(src, "_blank");
      }
    });
  } catch (err) {
    pcLog.debug("PeasantActorSheet: failed to attach portrait click handler", err);
  }

  try {
    $(portraitEl).on("contextmenu", "img", async (ev) => {
      if (!sheet.isEditMode) return;
      ev.preventDefault();
      ev.stopPropagation();

      const defaultImg =
        foundry?.utils?.getProperty?.(CONFIG, "Actor.defaultImage") ||
        foundry?.utils?.getProperty?.(CONFIG, "Actor.defaultIcon") ||
        foundry?.utils?.getProperty?.(CONFIG, "Actor.defaultProfileImg") ||
        foundry?.utils?.getProperty?.(CONFIG, "Actor.documentClass.DEFAULT_ICON") ||
        foundry?.utils?.getProperty?.(CONFIG, "Actor.documentClass.DEFAULT_IMAGE") ||
        CONST?.DEFAULT_TOKEN ||
        "icons/svg/mystery-man.svg";

      if (!defaultImg || sheet.actor.img === defaultImg) return;
      try {
        await sheet.actor.update({ img: defaultImg });
        sheet.render(true);
      } catch (err) {
        console.warn("Failed to reset actor image:", err);
      }
    });
  } catch (err) {
    pcLog.debug("PeasantActorSheet: failed to attach portrait reset handler", err);
  }

  try {
    const openPortraitPicker = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode || !sheet.isEditable) return;

      const target = ev.currentTarget;
      let openedViaCore = false;

      try {
        if (typeof sheet._onEditImage === "function") {
          if (target?.dataset) target.dataset.edit = "img";
          await sheet._onEditImage(ev);
          openedViaCore = true;
        }
      } catch (err) {
        console.warn("Failed to open portrait editor via _onEditImage:", err);
      } finally {
        if (target?.dataset?.edit === "img") delete target.dataset.edit;
      }
      if (openedViaCore) return;

      if (!FilePickerClass) {
        console.warn("Failed to update actor image: FilePicker class unavailable.");
        return;
      }

      const fp = new FilePickerClass({
        type: "image",
        current: sheet.actor.img,
        callback: async (path) => {
          try {
            await sheet.actor.update({ img: path });
            sheet.render(true);
          } catch (err) {
            console.warn("Failed to update actor image:", err);
          }
        }
      });
      fp.render(true);
    };

    html.on("click", ".select-portrait-btn", openPortraitPicker);
  } catch (err) {
    console.warn("Failed to bind portrait change handler:", err);
  }
}

export async function savePortraitFromDOM(sheet) {
  try {
    const portrait = sheet._getSheetJQ().find(".character-portrait");
    const img = portrait.find("img");
    if (!portrait.length || !img.length) return;

    const currentWidth = portrait.outerWidth();
    const currentHeight = portrait.outerHeight();

    let offsetX = sheet.actor.system.portraitOffsetX || 0;
    let offsetY = sheet.actor.system.portraitOffsetY || 0;
    let scale = Math.max(1.0, sheet.actor.system.portraitScale || 1);
    let transformStr = "";

    const state = sheet._portraitState;
    const hasState = state && Number.isFinite(state.offsetX) && Number.isFinite(state.offsetY) && Number.isFinite(state.scale);
    if (hasState) {
      offsetX = state.offsetX;
      offsetY = state.offsetY;
      scale = Math.max(1.0, state.scale || scale);
    } else {
      transformStr = img[0].style?.transform || getComputedStyle(img[0]).transform || "";

      const t3 = transformStr.match(/translate3d\(\s*([-0-9.]+)px,\s*([-0-9.]+)px,\s*[-0-9.]+px\)/i);
      if (t3) {
        offsetX = parseFloat(t3[1]);
        offsetY = parseFloat(t3[2]);
      } else {
        const m = transformStr.match(/translate\(([-0-9.]+)px,?\s*([-0-9.]+)px\)\s*scale\(([-0-9.]+)\)/);
        if (m) {
          offsetX = parseFloat(m[1]);
          offsetY = parseFloat(m[2]);
          scale = parseFloat(m[3]) || scale;
        } else {
          const tx = transformStr.match(/translateX\(([-0-9.]+)px\)/);
          const ty = transformStr.match(/translateY\(([-0-9.]+)px\)/);
          if (tx) offsetX = parseFloat(tx[1]);
          if (ty) offsetY = parseFloat(ty[1]);
        }
      }

      const sc = transformStr.match(/scale\(([-0-9.]+)\)/);
      if (sc) {
        scale = parseFloat(sc[1]) || scale;
      } else {
        const matrixMatch = transformStr.match(/matrix\(([-0-9.eE,+-]+)\)/);
        if (matrixMatch) {
          const parts = transformStr.replace(/^matrix\(|\)$/g, "").split(",").map(s => parseFloat(s.trim()));
          if (parts.length === 6) {
            const a = parts[0], b = parts[1], tx = parts[4], ty = parts[5];
            scale = Math.sqrt(a * a + b * b) || scale;
            offsetX = tx || offsetX;
            offsetY = ty || offsetY;
          }
        }
      }
    }

    pcLog.debug("Saving portrait from DOM", { currentWidth, currentHeight, offsetX, offsetY, scale, transformStr });

    await sheet.actor.update({
      "system.portraitOffsetX": Math.round(offsetX),
      "system.portraitOffsetY": Math.round(offsetY),
      "system.portraitScale": parseFloat(scale.toFixed(3))
    });
  } catch (err) {
    console.warn("Failed to save portrait from DOM:", err);
  }
}
