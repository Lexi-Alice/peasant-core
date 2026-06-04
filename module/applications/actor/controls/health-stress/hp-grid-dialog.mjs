import { isSimplifiedHpActor } from "../../../../data/actor/helpers.mjs";
import { performConsciousnessCheck } from "../../../../dice/rolls.mjs";
import { qs, qsa, toElement } from "../../../dom.mjs";
import { renderDialogModeToggle } from "./dialog-mode-toggle.mjs";

const PC_CONSCIOUSNESS_SAVE_FLAG = "rollConsciousnessAsSaves";
const hpGridControllers = new WeakMap();
const openHpGridDialogs = new Set();
const HP_GRID_SIMPLIFIED_DIALOG_WIDTH = 420;
const HP_GRID_DIALOG_MIN_CONTENT_WIDTH = 300;
const HP_GRID_DIALOG_MIN_RESIZE_WIDTH = 280;
const HP_GRID_DIALOG_MAX_INITIAL_WIDTH = 640;
const HP_GRID_DIALOG_MAX_INITIAL_HEIGHT = 280;
const HP_GRID_DIALOG_MIN_INITIAL_HEIGHT = 120;
const HP_GRID_TARGET_CELL_SIZE = 32;
const HP_GRID_TARGET_LABEL_WIDTH = 82;
const HP_GRID_MIN_READABLE_CELL_SIZE = 16;
const HP_GRID_MIN_READABLE_LABEL_WIDTH = 86;

function canModifySheetActor(sheet) {
  return !!(sheet?.canModifyActor ?? (game.user?.isGM || sheet?.actor?.isOwner));
}

function isSameDialogActor(sheet, actor) {
  const sheetActor = sheet?.actor;
  return !!sheetActor && (
    sheetActor === actor
    || sheetActor.uuid === actor?.uuid
    || (!!sheetActor.id && sheetActor.id === actor?.id)
  );
}

export function openHpGridDialog(sheet, trigger = null) {
  const size = getHpGridDialogSize(sheet);
  const dialog = sheet._renderDialog({
    title: `${sheet.actor?.name || "Actor"} HP Grid`,
    content: renderHpGridDialogContent(sheet),
    buttons: {},
    window: {
      resizable: true
    },
    render: (html) => {
      const root = toElement(html);
      root?.classList.add("pc-hp-grid-dialog-window");
      applyHpGridDialogSizing(sheet, root);
      for (const element of qsa(root, ".dialog-buttons, .form-footer, footer")) element.style.display = "none";
      renderDialogModeToggle(sheet, root);
      bindHpGridDialog(sheet, root);
    }
  }, {
    classes: ["peasant-core", "pc-hp-grid-dialog"],
    position: {
      ...sheet._getDialogPositionNearTrigger(trigger, size.width, size.height),
      height: size.height
    }
  });
  sheet._hpGridDialog = dialog;
  const registration = { sheet, dialog };
  openHpGridDialogs.add(registration);
  if (typeof dialog?.close === "function") {
    const closeDialog = dialog.close.bind(dialog);
    dialog.close = (...args) => {
      openHpGridDialogs.delete(registration);
      clearHpGridBindings(toElement(dialog));
      if (sheet._hpGridDialog === dialog) delete sheet._hpGridDialog;
      return closeDialog(...args);
    };
  }
  return dialog;
}

export function refreshOpenHpGridDialogsForActor(actor) {
  if (!actor) return;
  for (const registration of Array.from(openHpGridDialogs)) {
    const { sheet, dialog } = registration;
    if (!isSameDialogActor(sheet, actor)) continue;
    refreshHpGridDialogRegistration(registration);
  }
}

export function refreshOpenHpGridDialogsForSheet(sheet) {
  if (!sheet) return;
  for (const registration of Array.from(openHpGridDialogs)) {
    if (registration.sheet !== sheet) continue;
    refreshHpGridDialogRegistration(registration);
  }
}

function refreshHpGridDialogRegistration(registration) {
  const { sheet, dialog } = registration;
  const root = toElement(dialog);
  if (!root?.isConnected) {
    openHpGridDialogs.delete(registration);
    if (sheet._hpGridDialog === dialog) delete sheet._hpGridDialog;
    return;
  }

  refreshHpGridDialog(sheet, root);
}

function getHpGridDialogSize(sheet) {
  if (isSimplifiedHpActor(sheet.actor)) {
    return { width: HP_GRID_SIMPLIFIED_DIALOG_WIDTH, height: 240 };
  }

  const hp = sheet.actor?.system?.hp ?? {};
  const rows = Math.max(1, Number(hp.rows) || 1);
  const cols = Math.max(1, Number(hp.cols) || 1);
  const controlsHeight = sheet.isEditMode ? 58 : 0;
  const labelWidth = HP_GRID_TARGET_LABEL_WIDTH;
  const gap = 4;
  const gridContentWidth = (cols * HP_GRID_TARGET_CELL_SIZE) + (cols * gap) + labelWidth;
  const gridHeight = (rows * HP_GRID_TARGET_CELL_SIZE) + (Math.max(0, rows - 1) * gap);
  const unitHeight = gridHeight + 24;
  const naturalWidth = Math.max(HP_GRID_DIALOG_MIN_CONTENT_WIDTH, gridContentWidth + 42);
  const naturalHeight = Math.max(170, controlsHeight + unitHeight + 56);
  const width = Math.min(naturalWidth, HP_GRID_DIALOG_MAX_INITIAL_WIDTH);
  const scaledHeight = getHpGridDialogScaledHeight(rows, cols, width, controlsHeight);
  const height = Math.min(Math.min(naturalHeight, HP_GRID_DIALOG_MAX_INITIAL_HEIGHT), scaledHeight);
  return { width, height };
}

function getHpGridDialogScaledHeight(rows, cols, width, controlsHeight = 0) {
  const { cellSize, columnGap, rowHeight } = getHpGridScaleMetrics(rows, cols, width);
  const gridHeight = (rows * rowHeight) + (Math.max(0, rows - 1) * columnGap);
  const controlsGap = controlsHeight ? 6 : 0;
  const helpHeight = 15;
  const unitGap = 6;
  return Math.max(HP_GRID_DIALOG_MIN_INITIAL_HEIGHT, Math.ceil(controlsHeight + controlsGap + gridHeight + helpHeight + unitGap + 56));
}

function applyHpGridDialogSizing(sheet, root) {
  const rootElement = toElement(root);
  if (!rootElement) return;
  const { width, height } = getHpGridDialogSize(sheet);
  const simplified = isSimplifiedHpActor(sheet.actor);
  const hp = sheet.actor?.system?.hp ?? {};
  const rows = simplified ? 1 : Math.max(1, Number(hp.rows) || 1);
  const cols = simplified ? 1 : Math.max(1, Number(hp.cols) || 1);
  const minReadableWidth = (cols * HP_GRID_MIN_READABLE_CELL_SIZE) + (cols * 2) + HP_GRID_MIN_READABLE_LABEL_WIDTH + 42;
  const minWidth = Math.min(width, Math.max(HP_GRID_DIALOG_MIN_RESIZE_WIDTH, minReadableWidth));
  const minReadableControlsHeight = sheet.isEditMode ? 64 : 0;
  const minHeight = simplified
    ? height
    : getHpGridDialogScaledHeight(rows, cols, minWidth, minReadableControlsHeight);
  rootElement.style.setProperty("--pc-hp-grid-dialog-min-width", `${minWidth}px`);
  rootElement.style.setProperty("--pc-hp-grid-dialog-min-height", `${minHeight.toFixed(2)}px`);
}

function getHpGridScaleMetrics(rows, cols, width) {
  const padding = 20;
  const availableWidth = Math.max(1, width - padding);
  const labelWidth = Math.max(80, Math.min(HP_GRID_TARGET_LABEL_WIDTH, availableWidth * 0.15));
  const columnGap = Math.max(1, Math.min(5, availableWidth / Math.max(cols * 8, 1)));
  const maxCellFromWidth = (availableWidth - labelWidth - (columnGap * cols)) / cols;
  const cellSize = Math.max(4, maxCellFromWidth);
  const labelFontSize = Math.max(9, Math.min(15, cellSize * 0.42));
  const rowHeight = Math.max(cellSize, labelFontSize * 1.2);
  return { availableWidth, cellSize, columnGap, labelFontSize, labelWidth, rowHeight };
}

function getHpLabelRows() {
  return [
    { value: 3, text: "Good" },
    { value: 5, text: "Fair" },
    { value: 7, text: "Poor" },
    { value: 10, text: "Terrible" },
    { value: 11, text: "Critical" }
  ];
}

function renderHpGridDialogBody(sheet) {
  if (isSimplifiedHpActor(sheet.actor)) {
    return `<div class="pc-hp-grid-empty">This actor uses simplified HP. Use the portrait HP bar directly.</div>`;
  }

  const hp = sheet.actor?.system?.hp ?? {};
  const rows = Math.max(0, Number(hp.rows) || 0);
  const cols = Math.max(0, Number(hp.cols) || 0);
  const grid = Array.isArray(hp.grid) ? hp.grid : [];
  const labels = getHpLabelRows();
  const canModify = canModifySheetActor(sheet);
  const editMode = canModify && !!sheet.isEditMode;

  const controls = editMode ? `
    <div class="pc-hp-grid-popup-controls">
      <div class="pc-hp-grid-popup-stepper">
        <label>Columns</label>
        <button type="button" class="hp-col-minus sheet-stepper-btn" data-tooltip="Decrease HP columns" aria-label="Decrease HP columns">&minus;</button>
        <span>${cols}</span>
        <button type="button" class="hp-col-plus sheet-stepper-btn" data-tooltip="Increase HP columns" aria-label="Increase HP columns">+</button>
      </div>
      <div class="pc-hp-grid-popup-stepper">
        <label>Rows</label>
        <button type="button" class="hp-row-minus sheet-stepper-btn" data-tooltip="Decrease HP rows" aria-label="Decrease HP rows">&minus;</button>
        <span>${rows}</span>
        <button type="button" class="hp-row-plus sheet-stepper-btn" data-tooltip="Increase HP rows" aria-label="Increase HP rows">+</button>
      </div>
    </div>` : "";

  const rowHtml = Array.from({ length: rows }, (_, rowIndex) => {
    const row = Array.isArray(grid[rowIndex]) ? grid[rowIndex] : [];
    const cells = Array.from({ length: cols }, (_, colIndex) => {
      const cell = Number(row[colIndex]) || 0;
      const stateClass = cell === 1 ? "blunt" : cell === 2 ? "lethal" : cell === 3 ? "critical" : "regular";
      const focusAttrs = canModify ? "" : ` tabindex="0" aria-label="HP row ${rowIndex + 1}, column ${colIndex + 1}, ${stateClass}"`;
      return `<div class="hp-cell ${stateClass}" data-row="${rowIndex}" data-col="${colIndex}"${focusAttrs}></div>`;
    }).join("");
    const label = labels[rowIndex] ?? { value: null, text: "" };
    const labelHtml = label.value
      ? `${canModify ? `<span class="hp-th hp-tn-clickable" data-action="rollConsciousness" data-th="${label.value}" tabindex="0">${label.value}+</span>` : `<span class="hp-th">${label.value}+</span>`}<span class="hp-tn-text">${sheet._escapeHtml(label.text)}</span>`
      : `<span>${sheet._escapeHtml(label.text)}</span>`;
    return `${cells}<div class="hp-label pc-hp-grid-popup-label">${labelHtml}</div>`;
  }).join("");

  return `
    ${controls}
    <div class="pc-hp-grid-popup-frame">
      <div class="pc-hp-grid-popup-unit">
        <div class="pc-hp-grid-popup-grid" data-rows="${rows}" data-cols="${cols}" style="--hp-cols: ${Math.max(cols, 1)};">
          ${rowHtml}
        </div>
        ${canModify ? `<p class="pc-hp-grid-popup-help">Left-click cycles damage. Right-click clears a cell.</p>` : ""}
      </div>
    </div>
  `;
}

function renderHpGridDialogContent(sheet) {
  return `
    <div class="pc-hp-grid-dialog-content">
      <div class="pc-hp-grid-dialog-body">${renderHpGridDialogBody(sheet)}</div>
    </div>
  `;
}

function refreshHpGridDialog(sheet, root) {
  const rootElement = toElement(root);
  const body = qs(rootElement, ".pc-hp-grid-dialog-body");
  if (!body) return;
  body.innerHTML = renderHpGridDialogBody(sheet);
  renderDialogModeToggle(sheet, rootElement);
  bindHpGridDialog(sheet, rootElement);
}

async function changeHpGridSize(sheet, rowDelta = 0, colDelta = 0) {
  await sheet.actor.resizePeasantHpGrid?.(rowDelta, colDelta);
}

async function setHpGridCell(sheet, row, col, value) {
  await sheet.actor.setPeasantHpGridCell?.(row, col, value);
}

function clearHpGridBindings(root) {
  const rootElement = toElement(root);
  if (!rootElement) return;
  const bindings = hpGridControllers.get(rootElement);
  bindings?.controller?.abort?.();
  bindings?.resizeObserver?.disconnect?.();
  hpGridControllers.delete(rootElement);
}

function syncHpGridDialogScale(root) {
  const rootElement = toElement(root);
  const grid = qs(rootElement, ".pc-hp-grid-popup-grid");
  if (!grid) return;

  const cols = Math.max(1, Number.parseInt(grid.dataset.cols, 10) || 1);
  const rows = Math.max(1, Number.parseInt(grid.dataset.rows, 10) || 1);
  const content = qs(rootElement, ".window-content") ?? qs(rootElement, ".dialog-content") ?? rootElement;
  const dialogContent = qs(rootElement, ".pc-hp-grid-dialog-content");
  const body = qs(rootElement, ".pc-hp-grid-dialog-body");
  const frame = qs(rootElement, ".pc-hp-grid-popup-frame");
  const unit = qs(rootElement, ".pc-hp-grid-popup-unit");
  const rootRect = rootElement.getBoundingClientRect?.();
  const contentRect = content?.getBoundingClientRect?.();
  const fallbackWidth = rootRect?.width || 0;
  const width = content?.clientWidth || contentRect?.width || fallbackWidth || frame?.clientWidth || grid.clientWidth || 0;
  if (!width) return;

  const controls = qs(rootElement, ".pc-hp-grid-popup-controls");
  const controlsHeight = controls?.getBoundingClientRect?.().height || 0;
  const { cellSize, columnGap, labelFontSize, labelWidth, rowHeight } = getHpGridScaleMetrics(rows, cols, width);
  const unitGap = controlsHeight ? 6 : 5;
  const helpFontSize = Math.max(9, Math.min(12, rowHeight * 0.5));
  const helpHeight = helpFontSize * 1.25;
  const rowGap = columnGap;
  const gridWidth = (cols * cellSize) + labelWidth + (columnGap * cols);

  const styleTargets = [dialogContent, body, frame, unit, grid].filter((target, index, targets) => target && targets.indexOf(target) === index);
  for (const target of styleTargets) {
    target.style.setProperty("--pc-hp-cell-width", `${cellSize.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-cell-height", `${cellSize.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-grid-row-height", `${rowHeight.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-grid-gap", `${columnGap.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-grid-column-gap", `${columnGap.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-grid-row-gap", `${rowGap.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-grid-width", `${gridWidth.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-label-width", `${labelWidth.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-label-font-size", `${labelFontSize.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-help-font-size", `${helpFontSize.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-help-height", `${helpHeight.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-unit-gap", `${unitGap.toFixed(2)}px`);
  }
}

function bindHpGridDialog(sheet, root) {
  const rootElement = toElement(root);
  if (!rootElement) return;

  clearHpGridBindings(rootElement);
  applyHpGridDialogSizing(sheet, rootElement);
  const controller = new AbortController();
  let resizeObserver = null;
  try {
    resizeObserver = new ResizeObserver(() => syncHpGridDialogScale(rootElement));
    const resizeTargets = [
      rootElement,
      qs(rootElement, ".window-content"),
      qs(rootElement, ".dialog-content"),
      qs(rootElement, ".pc-hp-grid-dialog-content"),
      qs(rootElement, ".pc-hp-grid-dialog-body"),
      qs(rootElement, ".pc-hp-grid-popup-frame"),
      qs(rootElement, ".pc-hp-grid-popup-unit")
    ].filter((target, index, targets) => target && targets.indexOf(target) === index);
    for (const resizeTarget of resizeTargets) resizeObserver.observe(resizeTarget);
  } catch (e) {
    /* ResizeObserver is cosmetic here; fixed CSS fallback remains usable. */
  }
  hpGridControllers.set(rootElement, { controller, resizeObserver });
  const { signal } = controller;
  syncHpGridDialogScale(rootElement);
  const view = rootElement.ownerDocument?.defaultView ?? window;
  if (typeof view?.requestAnimationFrame === "function") {
    view.requestAnimationFrame(() => syncHpGridDialogScale(rootElement));
  }

  if (!canModifySheetActor(sheet)) return;

  const bindResize = (selector, rowDelta, colDelta) => {
    for (const button of qsa(rootElement, selector)) {
      button.addEventListener("click", async (ev) => {
        ev.preventDefault();
        await changeHpGridSize(sheet, rowDelta, colDelta);
      }, { signal });
    }
  };

  bindResize(".hp-col-plus", 0, 1);
  bindResize(".hp-col-minus", 0, -1);
  bindResize(".hp-row-plus", 1, 0);
  bindResize(".hp-row-minus", -1, 0);

  for (const cell of qsa(rootElement, ".hp-cell:not(.stress-cell)")) {
    cell.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const row = Number.parseInt(cell.dataset.row, 10);
      const col = Number.parseInt(cell.dataset.col, 10);
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      const current = Number(sheet.actor.system?.hp?.grid?.[row]?.[col]) || 0;
      await setHpGridCell(sheet, row, col, (current + 1) % 4);
    }, { signal });

    cell.addEventListener("contextmenu", async (ev) => {
      ev.preventDefault();
      const row = Number.parseInt(cell.dataset.row, 10);
      const col = Number.parseInt(cell.dataset.col, 10);
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      await setHpGridCell(sheet, row, col, 0);
    }, { signal });
  }

  for (const button of qsa(rootElement, ".hp-tn-clickable")) {
    button.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const th = Number.parseInt(button.dataset.th, 10);
      if (!Number.isFinite(th)) return;
      const asSave = !!sheet.actor?.getFlag?.("peasant-core", PC_CONSCIOUSNESS_SAVE_FLAG);
      await performConsciousnessCheck({
        tn: th,
        asSave,
        speaker: ChatMessage.getSpeaker({ actor: sheet.actor })
      });
    }, { signal });
  }
}
