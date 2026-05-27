import { isSimplifiedHpActor } from "../../../../data/actor/helpers.mjs";
import { performConsciousnessCheck } from "../../../../dice/rolls.mjs";
import { qs, qsa, toElement } from "../../../dom.mjs";

const PC_CONSCIOUSNESS_SAVE_FLAG = "rollConsciousnessAsSaves";
const hpGridControllers = new WeakMap();
const HP_GRID_SIMPLIFIED_DIALOG_WIDTH = 420;
const HP_GRID_DIALOG_MIN_CONTENT_WIDTH = 300;
const HP_GRID_DIALOG_MIN_RESIZE_WIDTH = 280;
const HP_GRID_TARGET_CELL_SIZE = 32;
const HP_GRID_TARGET_LABEL_WIDTH = 82;
const HP_GRID_MIN_READABLE_CELL_SIZE = 16;
const HP_GRID_MIN_READABLE_LABEL_WIDTH = 86;

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
      applyHpGridDialogAspect(sheet, root);
      for (const element of qsa(root, ".dialog-buttons, .form-footer, footer")) element.style.display = "none";
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
  if (typeof dialog?.close === "function") {
    const closeDialog = dialog.close.bind(dialog);
    dialog.close = (...args) => {
      clearHpGridBindings(toElement(dialog));
      if (sheet._hpGridDialog === dialog) delete sheet._hpGridDialog;
      return closeDialog(...args);
    };
  }
  return dialog;
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
  const width = Math.max(HP_GRID_DIALOG_MIN_CONTENT_WIDTH, gridContentWidth + 42);
  const height = Math.max(170, controlsHeight + unitHeight + 56);
  return { width, height };
}

function applyHpGridDialogAspect(sheet, root) {
  const rootElement = toElement(root);
  if (!rootElement) return;
  const { width, height } = getHpGridDialogSize(sheet);
  const simplified = isSimplifiedHpActor(sheet.actor);
  const hp = sheet.actor?.system?.hp ?? {};
  const rows = simplified ? 1 : Math.max(1, Number(hp.rows) || 1);
  const cols = simplified ? 1 : Math.max(1, Number(hp.cols) || 1);
  const minReadableWidth = (cols * HP_GRID_MIN_READABLE_CELL_SIZE) + (cols * 2) + HP_GRID_MIN_READABLE_LABEL_WIDTH + 42;
  const minWidth = Math.min(width, Math.max(HP_GRID_DIALOG_MIN_RESIZE_WIDTH, minReadableWidth));
  const minReadableGridHeight = (rows * HP_GRID_MIN_READABLE_CELL_SIZE) + (Math.max(0, rows - 1) * 2);
  const minReadableControlsHeight = sheet.isEditMode ? 64 : 0;
  const minReadableHeight = minReadableControlsHeight + minReadableGridHeight + 70;
  const minHeight = Math.max(minWidth / (width / Math.max(height, 1)), minReadableHeight);
  rootElement.style.setProperty("--pc-hp-grid-dialog-aspect", `${width} / ${Math.max(height, 1)}`);
  rootElement.style.setProperty("--pc-hp-grid-dialog-min-width", `${minWidth}px`);
  rootElement.style.setProperty("--pc-hp-grid-dialog-min-height", `${minHeight.toFixed(2)}px`);
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
  const editMode = !!sheet.isEditMode;

  const controls = editMode ? `
    <div class="pc-hp-grid-popup-controls">
      <div class="pc-hp-grid-popup-stepper">
        <label>Columns</label>
        <button type="button" class="hp-col-minus sheet-stepper-btn" title="Decrease HP columns">&minus;</button>
        <span>${cols}</span>
        <button type="button" class="hp-col-plus sheet-stepper-btn" title="Increase HP columns">+</button>
      </div>
      <div class="pc-hp-grid-popup-stepper">
        <label>Rows</label>
        <button type="button" class="hp-row-minus sheet-stepper-btn" title="Decrease HP rows">&minus;</button>
        <span>${rows}</span>
        <button type="button" class="hp-row-plus sheet-stepper-btn" title="Increase HP rows">+</button>
      </div>
    </div>` : "";

  const rowHtml = Array.from({ length: rows }, (_, rowIndex) => {
    const row = Array.isArray(grid[rowIndex]) ? grid[rowIndex] : [];
    const cells = Array.from({ length: cols }, (_, colIndex) => {
      const cell = Number(row[colIndex]) || 0;
      const stateClass = cell === 1 ? "blunt" : cell === 2 ? "lethal" : cell === 3 ? "critical" : "regular";
      return `<div class="hp-cell ${stateClass}" data-row="${rowIndex}" data-col="${colIndex}"></div>`;
    }).join("");
    const label = labels[rowIndex] ?? { value: null, text: "" };
    const labelHtml = label.value
      ? `<span class="hp-th hp-tn-clickable" data-action="rollConsciousness" data-th="${label.value}" tabindex="0">${label.value}+</span><span class="hp-tn-text">${sheet._escapeHtml(label.text)}</span>`
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
        <p class="pc-hp-grid-popup-help">Left-click cycles damage. Right-click clears a cell.</p>
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
  const headerRect = qs(rootElement, ".window-header")?.getBoundingClientRect?.();
  const contentRect = content?.getBoundingClientRect?.();
  const fallbackWidth = rootRect?.width || 0;
  const fallbackHeight = Math.max(0, (rootRect?.height || 0) - (headerRect?.height || 0));
  const width = content?.clientWidth || contentRect?.width || fallbackWidth || frame?.clientWidth || grid.clientWidth || 0;
  const height = content?.clientHeight || contentRect?.height || fallbackHeight || frame?.clientHeight || grid.clientHeight || 0;
  if (!width || !height) return;

  const padding = 20;
  const controls = qs(rootElement, ".pc-hp-grid-popup-controls");
  const controlsHeight = controls?.getBoundingClientRect?.().height || 0;
  const controlsGap = controls ? 6 : 0;
  const availableWidth = Math.max(1, width - padding);
  const labelWidth = Math.max(80, Math.min(HP_GRID_TARGET_LABEL_WIDTH, availableWidth * 0.15));
  const columnGap = Math.max(1, Math.min(5, availableWidth / Math.max(cols * 8, 1)));
  const maxCellFromWidth = (availableWidth - labelWidth - (columnGap * cols)) / cols;
  const availableHeight = Math.max(1, height - padding - controlsHeight - controlsGap);
  const unitGap = Math.max(4, Math.min(10, availableHeight * 0.04));
  const helpFontSize = Math.max(9, Math.min(14, availableHeight * 0.055));
  const helpHeight = helpFontSize * 1.25;
  const maxCellFromHeight = (availableHeight - helpHeight - unitGap - (columnGap * Math.max(0, rows - 1))) / rows;
  const cellSize = Math.max(4, Math.min(maxCellFromWidth, maxCellFromHeight));
  const leftoverGridHeight = availableHeight - helpHeight - unitGap - (rows * cellSize);
  const rowGap = rows > 1 ? Math.max(columnGap, leftoverGridHeight / (rows - 1)) : columnGap;
  const gridWidth = (cols * cellSize) + labelWidth + (columnGap * cols);
  const labelFontSize = Math.max(9, Math.min(15, cellSize * 0.42));

  const styleTargets = [dialogContent, body, frame, unit, grid].filter((target, index, targets) => target && targets.indexOf(target) === index);
  for (const target of styleTargets) {
    target.style.setProperty("--pc-hp-cell-width", `${cellSize.toFixed(2)}px`);
    target.style.setProperty("--pc-hp-cell-height", `${cellSize.toFixed(2)}px`);
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
  applyHpGridDialogAspect(sheet, rootElement);
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

  const refresh = async () => {
    await sheet.render(false);
    refreshHpGridDialog(sheet, rootElement);
  };

  const bindResize = (selector, rowDelta, colDelta) => {
    for (const button of qsa(rootElement, selector)) {
      button.addEventListener("click", async (ev) => {
        ev.preventDefault();
        await changeHpGridSize(sheet, rowDelta, colDelta);
        await refresh();
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
      await refresh();
    }, { signal });

    cell.addEventListener("contextmenu", async (ev) => {
      ev.preventDefault();
      const row = Number.parseInt(cell.dataset.row, 10);
      const col = Number.parseInt(cell.dataset.col, 10);
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      await setHpGridCell(sheet, row, col, 0);
      await refresh();
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
