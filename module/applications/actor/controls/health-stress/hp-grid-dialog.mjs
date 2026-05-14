import { isSimplifiedHpActor } from "../../../../data/actor/helpers.mjs";
import { performConsciousnessCheck } from "../../../../dice/rolls.mjs";

const PC_CONSCIOUSNESS_SAVE_FLAG = "rollConsciousnessAsSaves";

export function openHpGridDialog(sheet, trigger = null) {
  const dialog = sheet._renderDialog({
    title: `${sheet.actor?.name || "Actor"} HP Grid`,
    content: renderHpGridDialogContent(sheet),
    buttons: {},
    render: (html) => {
      html.addClass("pc-hp-grid-dialog-window");
      html.find(".dialog-buttons, .form-footer, footer").hide();
      bindHpGridDialog(sheet, html);
    }
  }, {
    classes: ["peasant-core", "pc-hp-grid-dialog"],
    position: sheet._getDialogPositionNearTrigger(trigger, 420, 340)
  });
  sheet._hpGridDialog = dialog;
  return dialog;
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
    <div class="pc-hp-grid-popup-grid" style="--hp-cols: ${Math.max(cols, 1)};">
      ${rowHtml}
    </div>
    <p class="pc-hp-grid-popup-help">Left-click cycles damage. Right-click clears a cell.</p>
  `;
}

function renderHpGridDialogContent(sheet) {
  return `<div class="pc-hp-grid-dialog-content"><div class="pc-hp-grid-dialog-body">${renderHpGridDialogBody(sheet)}</div></div>`;
}

function refreshHpGridDialog(sheet, root) {
  const jq = root instanceof jQuery ? root : $(root);
  jq.find(".pc-hp-grid-dialog-body").html(renderHpGridDialogBody(sheet));
  bindHpGridDialog(sheet, jq);
}

async function changeHpGridSize(sheet, rowDelta = 0, colDelta = 0) {
  await sheet.actor.resizePeasantHpGrid?.(rowDelta, colDelta);
}

async function setHpGridCell(sheet, row, col, value) {
  await sheet.actor.setPeasantHpGridCell?.(row, col, value);
}

function bindHpGridDialog(sheet, root) {
  const jq = root instanceof jQuery ? root : $(root);

  jq.find(".hp-col-plus").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
    ev.preventDefault();
    await changeHpGridSize(sheet, 0, 1);
    await sheet.render(false);
    refreshHpGridDialog(sheet, jq);
  });

  jq.find(".hp-col-minus").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
    ev.preventDefault();
    await changeHpGridSize(sheet, 0, -1);
    await sheet.render(false);
    refreshHpGridDialog(sheet, jq);
  });

  jq.find(".hp-row-plus").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
    ev.preventDefault();
    await changeHpGridSize(sheet, 1, 0);
    await sheet.render(false);
    refreshHpGridDialog(sheet, jq);
  });

  jq.find(".hp-row-minus").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
    ev.preventDefault();
    await changeHpGridSize(sheet, -1, 0);
    await sheet.render(false);
    refreshHpGridDialog(sheet, jq);
  });

  jq.find(".hp-cell:not(.stress-cell)").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
    ev.preventDefault();
    const cell = $(ev.currentTarget);
    const row = Number.parseInt(cell.data("row"), 10);
    const col = Number.parseInt(cell.data("col"), 10);
    if (Number.isNaN(row) || Number.isNaN(col)) return;
    const current = Number(sheet.actor.system?.hp?.grid?.[row]?.[col]) || 0;
    await setHpGridCell(sheet, row, col, (current + 1) % 4);
    await sheet.render(false);
    refreshHpGridDialog(sheet, jq);
  });

  jq.find(".hp-cell:not(.stress-cell)").off("contextmenu.pcHpGrid").on("contextmenu.pcHpGrid", async (ev) => {
    ev.preventDefault();
    const cell = $(ev.currentTarget);
    const row = Number.parseInt(cell.data("row"), 10);
    const col = Number.parseInt(cell.data("col"), 10);
    if (Number.isNaN(row) || Number.isNaN(col)) return;
    await setHpGridCell(sheet, row, col, 0);
    await sheet.render(false);
    refreshHpGridDialog(sheet, jq);
  });

  jq.find(".hp-tn-clickable").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
    ev.preventDefault();
    const th = Number.parseInt($(ev.currentTarget).data("th"), 10);
    if (!Number.isFinite(th)) return;
    const asSave = !!sheet.actor?.getFlag?.("peasant-core", PC_CONSCIOUSNESS_SAVE_FLAG);
    await performConsciousnessCheck({
      tn: th,
      asSave,
      speaker: ChatMessage.getSpeaker({ actor: sheet.actor })
    });
  });
}
