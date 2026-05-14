export function openStressGridDialog(sheet, activeType = "physical", trigger = null) {
  const active = normalizeStressType(activeType);
  sheet._stressGridDialogActive = active;
  const dialog = sheet._renderDialog({
    title: `${sheet.actor?.name || "Actor"} Stress Grids`,
    content: renderStressGridDialogContent(sheet, active),
    buttons: {},
    render: (html) => {
      html.addClass("pc-stress-grid-dialog-window");
      html.find(".dialog-buttons, .form-footer, footer").hide();
      bindStressGridDialog(sheet, html);
    }
  }, {
    classes: ["peasant-core", "pc-stress-grid-dialog"],
    position: sheet._getDialogPositionNearTrigger(trigger, 430, 260)
  });
  sheet._stressGridDialog = dialog;
  return dialog;
}

export async function setStressGridSize(sheet, stressType, count = 0) {
  await sheet.actor.setPeasantStressGridSize?.(stressType, count);
}

export async function applyStressDamage(sheet, stressType, amount = 1) {
  await sheet.actor.applyPeasantStressDamage?.(stressType, amount);
}

export async function applyStressHeal(sheet, stressType, amount = 1) {
  await sheet.actor.applyPeasantStressHeal?.(stressType, amount);
}

export function normalizeStressType(stressType) {
  const type = String(stressType || "").trim().toLowerCase();
  return getStressGridTypes().some(entry => entry.key === type) ? type : "physical";
}

function getStressGridTypes() {
  return [
    { key: "physical", label: "Physical" },
    { key: "mental", label: "Mental" },
    { key: "general", label: "General" }
  ];
}

function getStressGridStates(sheet, stressType) {
  const type = normalizeStressType(stressType);
  const count = Math.max(0, Number(sheet.actor?.system?.[`${type}StressCount`]) || 0);
  return Array.from({ length: count }, (_, index) => {
    const value = Number(sheet.actor?.system?.[`${type}${index}`]) || 0;
    return Math.max(0, Math.min(3, value));
  });
}

function renderStressGridDialogBody(sheet, activeType = "physical") {
  const active = normalizeStressType(activeType);
  const editMode = !!sheet.isEditMode;
  const types = getStressGridTypes();
  const stateClass = (cell) => cell === 1 ? "blunt" : cell === 2 ? "lethal" : cell === 3 ? "critical" : "regular";

  const tabs = types.map(type => `
    <button type="button" class="pc-stress-grid-tab${type.key === active ? " active" : ""}" data-stress-tab="${type.key}" role="tab" aria-selected="${type.key === active ? "true" : "false"}">
      ${sheet._escapeHtml(type.label)}
    </button>
  `).join("");

  const panes = types.map(type => {
    const states = getStressGridStates(sheet, type.key);
    const cells = states.map((cell, index) => `
      <div class="hp-cell stress-cell ${stateClass(cell)}" data-stress-type="${type.key}" data-index="${index}"></div>
    `).join("");
    const controls = editMode ? `
      <div class="pc-hp-grid-popup-stepper pc-stress-grid-popup-stepper">
        <label>Boxes</label>
        <button type="button" class="stress-remove sheet-stepper-btn" data-stress-type="${type.key}" title="Remove ${sheet._escapeHtml(type.label)} stress box">&minus;</button>
        <span>${states.length}</span>
        <button type="button" class="stress-add sheet-stepper-btn" data-stress-type="${type.key}" title="Add ${sheet._escapeHtml(type.label)} stress box">+</button>
      </div>
    ` : `
      <button type="button" class="pc-portrait-hp-action pc-stress-grid-refresh" data-stress-type="${type.key}" title="Reset ${sheet._escapeHtml(type.label)} Stress" aria-label="Reset ${sheet._escapeHtml(type.label)} Stress">
        <i class="fas fa-sync-alt" aria-hidden="true"></i>
      </button>
    `;

    return `
      <section class="pc-stress-grid-pane${type.key === active ? " active" : ""}" data-stress-pane="${type.key}" role="tabpanel">
        <div class="pc-stress-grid-pane-header">
          <label class="stress-label">${sheet._escapeHtml(type.label)} Stress</label>
          <div class="pc-stress-grid-pane-controls">${controls}</div>
        </div>
        ${states.length ? `
          <div class="stress-grid pc-stress-grid-popup-grid" style="--col-count: ${Math.max(states.length, 1)};">
            ${cells}
          </div>
        ` : `<div class="pc-stress-grid-empty">No ${sheet._escapeHtml(type.label.toLowerCase())} stress boxes configured.</div>`}
      </section>
    `;
  }).join("");

  return `
    <div class="pc-stress-grid-tabs" role="tablist">${tabs}</div>
    <div class="pc-stress-grid-panes">${panes}</div>
    <p class="pc-hp-grid-popup-help">Left-click cycles stress damage. Right-click clears a cell.</p>
  `;
}

function renderStressGridDialogContent(sheet, activeType = "physical") {
  return `<div class="pc-hp-grid-dialog-content pc-stress-grid-dialog-content"><div class="pc-stress-grid-dialog-body">${renderStressGridDialogBody(sheet, activeType)}</div></div>`;
}

function refreshStressGridDialog(sheet, root, activeType = null) {
  const jq = root instanceof jQuery ? root : $(root);
  const active = normalizeStressType(activeType || sheet._stressGridDialogActive || jq.find(".pc-stress-grid-tab.active").data("stress-tab"));
  sheet._stressGridDialogActive = active;
  jq.find(".pc-stress-grid-dialog-body").html(renderStressGridDialogBody(sheet, active));
  bindStressGridDialog(sheet, jq);
}

async function setStressGridCell(sheet, stressType, index, value) {
  await sheet.actor.setPeasantStressCell?.(stressType, index, value);
}

async function changeStressGridSize(sheet, stressType, delta = 0) {
  await sheet.actor.resizePeasantStressGrid?.(stressType, delta);
}

function bindStressGridDialog(sheet, root) {
  const jq = root instanceof jQuery ? root : $(root);

  jq.find(".pc-stress-grid-tab").off("click.pcStressGrid").on("click.pcStressGrid", (ev) => {
    ev.preventDefault();
    const active = normalizeStressType(ev.currentTarget?.dataset?.stressTab);
    sheet._stressGridDialogActive = active;
    jq.find(".pc-stress-grid-tab").removeClass("active").attr("aria-selected", "false");
    jq.find(`.pc-stress-grid-tab[data-stress-tab="${active}"]`).addClass("active").attr("aria-selected", "true");
    jq.find(".pc-stress-grid-pane").removeClass("active");
    jq.find(`.pc-stress-grid-pane[data-stress-pane="${active}"]`).addClass("active");
  });

  jq.find(".stress-add").off("click.pcStressGrid").on("click.pcStressGrid", async (ev) => {
    ev.preventDefault();
    const stressType = ev.currentTarget?.dataset?.stressType;
    await changeStressGridSize(sheet, stressType, 1);
    await sheet.render(false);
    refreshStressGridDialog(sheet, jq, stressType);
  });

  jq.find(".stress-remove").off("click.pcStressGrid").on("click.pcStressGrid", async (ev) => {
    ev.preventDefault();
    const stressType = ev.currentTarget?.dataset?.stressType;
    await changeStressGridSize(sheet, stressType, -1);
    await sheet.render(false);
    refreshStressGridDialog(sheet, jq, stressType);
  });

  jq.find(".stress-cell").off("click.pcStressGrid").on("click.pcStressGrid", async (ev) => {
    ev.preventDefault();
    const cell = ev.currentTarget;
    const stressType = cell?.dataset?.stressType;
    const index = Number.parseInt(cell?.dataset?.index, 10);
    if (!stressType || Number.isNaN(index)) return;
    const currentState = Number(sheet.actor?.system?.[`${stressType}${index}`]) || 0;
    await setStressGridCell(sheet, stressType, index, (currentState + 1) % 4);
    await sheet.render(false);
    refreshStressGridDialog(sheet, jq, stressType);
  });

  jq.find(".stress-cell").off("contextmenu.pcStressGrid").on("contextmenu.pcStressGrid", async (ev) => {
    ev.preventDefault();
    const cell = ev.currentTarget;
    const stressType = cell?.dataset?.stressType;
    const index = Number.parseInt(cell?.dataset?.index, 10);
    if (!stressType || Number.isNaN(index)) return;
    await setStressGridCell(sheet, stressType, index, 0);
    await sheet.render(false);
    refreshStressGridDialog(sheet, jq, stressType);
  });

  jq.find(".pc-stress-grid-refresh").off("click.pcStressGrid").on("click.pcStressGrid", async (ev) => {
    ev.preventDefault();
    const stressType = normalizeStressType(ev.currentTarget?.dataset?.stressType);
    await sheet.actor.refreshPeasantStressTrack?.(stressType);
    await sheet.render(false);
    refreshStressGridDialog(sheet, jq, stressType);
  });
}
