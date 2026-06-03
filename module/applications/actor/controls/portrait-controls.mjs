import { qs, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

const ImagePopoutClass = foundry?.applications?.apps?.ImagePopout;
const FilePickerClass = foundry.applications.apps.FilePicker;

export function teardownPortraitBindings(sheet) {
  try {
    if (sheet._portraitRO && typeof sheet._portraitRO.disconnect === "function") {
      sheet._portraitRO.disconnect();
    }
  } catch (e) { /* ignore */ }
  sheet._portraitRO = null;

  try {
    sheet._portraitEventController?.abort?.();
  } catch (e) {
    /* ignore */
  }
  sheet._portraitEventController = null;
  sheet._portraitMouseupDocument = null;
}

export function setupPortraitControls(sheet, html, { readOnly = !!sheet?.isReadOnlyObserver } = {}) {
  const sheetRoot = toElement(html);
  const sheetDocument = sheet._getElementDocument?.(sheetRoot) ?? document;
  const portraitEl = qs(sheetRoot, ".character-portrait");
  try { sheet._portraitEventController?.abort?.(); } catch (e) { /* ignore */ }
  const eventController = new AbortController();
  const { signal } = eventController;
  sheet._portraitEventController = eventController;

  if (portraitEl) {
    const debouncedSave = readOnly ? () => {} : foundry.utils.debounce(() => savePortraitFromDOM(sheet), 400);
    const portraitImg = qs(portraitEl, "img");
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

    if (!readOnly) {
      sheet._portraitMouseupDocument = sheetDocument;
      sheetDocument.addEventListener("mouseup", () => debouncedSave(), { signal });
    }

    if (portraitImg) {
      try { portraitImg.setAttribute("draggable", "false"); } catch (e) {}
      if (!portraitImg.complete || portraitImg.naturalWidth === 0) {
        portraitImg.addEventListener("load", () => {
          updatePortraitMetrics(portraitSize);
          ensurePortraitClamped();
        }, { once: true, signal });
      } else {
        updatePortraitMetrics(portraitSize);
      }

      portraitImg.addEventListener("wheel", (ev) => {
        if (readOnly || !sheet.isEditMode) return;
        ev.preventDefault();
        const delta = ev.deltaY ?? 0;
        const step = delta > 0 ? -0.1 : 0.1;
        const maxScale = 4.0;
        const nextScale = Math.min(maxScale, Math.max(1.0, portraitState.scale + step));
        const clamped = clampPortraitTransform(portraitState.offsetX, portraitState.offsetY, nextScale);
        schedulePortraitTransform(clamped.offsetX, clamped.offsetY, clamped.scale);
      }, { signal, passive: false });

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
        portraitImg.classList.remove("draggable");
        try { portraitImg.releasePointerCapture(ev?.pointerId); } catch (e) {}
        debouncedSave();
      };

      portraitImg.addEventListener("pointerdown", (ev) => {
        if (readOnly || !sheet.isEditMode) return;
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
        portraitImg.classList.add("draggable");
        try { portraitImg.setPointerCapture(ev.pointerId); } catch (e) {}
      }, { signal });

      portraitImg.addEventListener("pointermove", (ev) => {
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
      }, { signal });

      portraitImg.addEventListener("pointerup", stopDragging, { signal });
      portraitImg.addEventListener("pointercancel", stopDragging, { signal });
      portraitImg.addEventListener("lostpointercapture", stopDragging, { signal });
    }

    ensurePortraitClamped();
  }

  try {
    portraitEl?.addEventListener("click", (ev) => {
      if (!ev.target?.closest?.("img")) return;
      if (!readOnly && sheet.isEditMode) return;
      const img = ev.target.closest("img");
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
    }, { signal });
  } catch (err) {
    pcLog.debug("PeasantActorSheet: failed to attach portrait click handler", err);
  }

  try {
    portraitEl?.addEventListener("contextmenu", async (ev) => {
      if (!ev.target?.closest?.("img")) return;
      if (readOnly || !sheet.isEditMode) return;
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
      } catch (err) {
        console.warn("Failed to reset actor image:", err);
      }
    }, { signal });
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
          } catch (err) {
            console.warn("Failed to update actor image:", err);
          }
        }
      });
      fp.render(true);
    };

    for (const button of (sheetRoot?.querySelectorAll?.(".select-portrait-btn") ?? [])) {
      button.addEventListener("click", openPortraitPicker, { signal });
    }
  } catch (err) {
    console.warn("Failed to bind portrait change handler:", err);
  }
}

export async function savePortraitFromDOM(sheet) {
  try {
    if (sheet?.canModifyActor === false) return;
    const sheetRoot = toElement(sheet.element) ?? sheet._getSheetJQ?.()?.[0] ?? null;
    const portrait = qs(sheetRoot, ".character-portrait");
    const img = qs(portrait, "img");
    if (!portrait || !img) return;

    const currentWidth = portrait.offsetWidth;
    const currentHeight = portrait.offsetHeight;

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
      transformStr = img.style?.transform || getComputedStyle(img).transform || "";

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
