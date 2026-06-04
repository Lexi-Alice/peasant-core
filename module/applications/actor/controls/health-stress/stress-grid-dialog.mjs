import { qs, qsa, toElement } from "../../../dom.mjs";
import { renderDialogModeToggle } from "./dialog-mode-toggle.mjs";

const stressGridControllers = new WeakMap();
const openStressGridDialogs = new Set();

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

export function openStressGridDialog(sheet, activeType = "physical", trigger = null) {
  const active = normalizeStressType(activeType);
  sheet._stressGridDialogActive = active;
  const dialog = sheet._renderDialog({
    title: `${sheet.actor?.name || "Actor"} Stress Grids`,
    content: renderStressGridDialogContent(sheet, active),
    buttons: {},
    render: (html) => {
      const root = toElement(html);
      root?.classList.add("pc-stress-grid-dialog-window");
      for (const element of qsa(root, ".dialog-buttons, .form-footer, footer")) element.style.display = "none";
      renderDialogModeToggle(sheet, root);
      bindStressGridDialog(sheet, root);
    }
  }, {
    classes: ["peasant-core", "pc-stress-grid-dialog"],
    position: sheet._getDialogPositionNearTrigger(trigger, 430, 260)
  });
  sheet._stressGridDialog = dialog;
  const registration = { sheet, dialog };
  openStressGridDialogs.add(registration);
  if (typeof dialog?.close === "function") {
    const closeDialog = dialog.close.bind(dialog);
    dialog.close = (...args) => {
      openStressGridDialogs.delete(registration);
      const root = toElement(dialog);
      if (root) {
        stressGridControllers.get(root)?.abort?.();
        stressGridControllers.delete(root);
      }
      if (sheet._stressGridDialog === dialog) delete sheet._stressGridDialog;
      return closeDialog(...args);
    };
  }
  return dialog;
}

export function refreshOpenStressGridDialogsForActor(actor) {
  if (!actor) return;
  for (const registration of Array.from(openStressGridDialogs)) {
    const { sheet, dialog } = registration;
    if (!isSameDialogActor(sheet, actor)) continue;
    refreshStressGridDialogRegistration(registration);
  }
}

export function refreshOpenStressGridDialogsForSheet(sheet) {
  if (!sheet) return;
  for (const registration of Array.from(openStressGridDialogs)) {
    if (registration.sheet !== sheet) continue;
    refreshStressGridDialogRegistration(registration);
  }
}

function refreshStressGridDialogRegistration(registration) {
  const { sheet, dialog } = registration;
  const root = toElement(dialog);
  if (!root?.isConnected) {
    openStressGridDialogs.delete(registration);
    if (sheet._stressGridDialog === dialog) delete sheet._stressGridDialog;
    return;
  }

  refreshStressGridDialog(sheet, root);
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
    { key: "physical", label: "Physical", icon: "fa-solid fa-heart-pulse" },
    { key: "mental", label: "Mental", icon: "fa-solid fa-brain" },
    { key: "general", label: "General", icon: "fa-solid fa-shield-heart" }
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
  const canModify = canModifySheetActor(sheet);
  const editMode = canModify && !!sheet.isEditMode;
  const types = getStressGridTypes();
  const stateClass = (cell) => cell === 1 ? "blunt" : cell === 2 ? "lethal" : cell === 3 ? "critical" : "regular";

  const tabs = types.map(type => `
    <button type="button" class="pc-stress-grid-tab${type.key === active ? " active" : ""}" data-tab="${type.key}" data-stress-tab="${type.key}" role="tab" aria-selected="${type.key === active ? "true" : "false"}">
      <i class="${sheet._escapeHtml(type.icon)}" aria-hidden="true"></i>
      <span>${sheet._escapeHtml(type.label)}</span>
    </button>
  `).join("");

  const panes = types.map(type => {
    const states = getStressGridStates(sheet, type.key);
    const cells = states.map((cell, index) => `
      <div class="hp-cell stress-cell ${stateClass(cell)}" data-stress-type="${type.key}" data-index="${index}"${canModify ? "" : ` tabindex="0" aria-label="${sheet._escapeHtml(type.label)} stress box ${index + 1}, ${stateClass(cell)}"`}></div>
    `).join("");
    const controls = editMode ? `
      <div class="pc-hp-grid-popup-stepper pc-stress-grid-popup-stepper">
        <label>Boxes</label>
        <button type="button" class="stress-remove sheet-stepper-btn" data-stress-type="${type.key}" data-tooltip="Remove ${sheet._escapeHtml(type.label)} stress box" aria-label="Remove ${sheet._escapeHtml(type.label)} stress box">&minus;</button>
        <span>${states.length}</span>
        <button type="button" class="stress-add sheet-stepper-btn" data-stress-type="${type.key}" data-tooltip="Add ${sheet._escapeHtml(type.label)} stress box" aria-label="Add ${sheet._escapeHtml(type.label)} stress box">+</button>
      </div>
    ` : canModify ? `
      <button type="button" class="pc-portrait-hp-action pc-stress-grid-refresh" data-stress-type="${type.key}" data-tooltip="Reset ${sheet._escapeHtml(type.label)} Stress" aria-label="Reset ${sheet._escapeHtml(type.label)} Stress">
        <i class="fas fa-sync-alt" aria-hidden="true"></i>
      </button>
    ` : "";

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
    <nav class="pc-stress-grid-tabs tabs sheet-tabs" role="tablist">${tabs}</nav>
    <div class="pc-stress-grid-panes">${panes}</div>
    ${canModify ? `<p class="pc-hp-grid-popup-help">Left-click cycles stress damage. Right-click clears a cell.</p>` : ""}
  `;
}

function renderStressGridDialogContent(sheet, activeType = "physical") {
  return `<div class="pc-hp-grid-dialog-content pc-stress-grid-dialog-content"><div class="pc-stress-grid-dialog-body">${renderStressGridDialogBody(sheet, activeType)}</div></div>`;
}

function refreshStressGridDialog(sheet, root, activeType = null) {
  const rootElement = toElement(root);
  const active = normalizeStressType(activeType || sheet._stressGridDialogActive || qs(rootElement, ".pc-stress-grid-tab.active")?.dataset.stressTab);
  sheet._stressGridDialogActive = active;
  const body = qs(rootElement, ".pc-stress-grid-dialog-body");
  if (!body) return;
  body.innerHTML = renderStressGridDialogBody(sheet, active);
  renderDialogModeToggle(sheet, rootElement);
  bindStressGridDialog(sheet, rootElement);
}

async function setStressGridCell(sheet, stressType, index, value) {
  await sheet.actor.setPeasantStressCell?.(stressType, index, value);
}

async function changeStressGridSize(sheet, stressType, delta = 0) {
  await sheet.actor.resizePeasantStressGrid?.(stressType, delta);
}

function bindStressGridDialog(sheet, root) {
  const rootElement = toElement(root);
  if (!rootElement) return;

  stressGridControllers.get(rootElement)?.abort();
  const controller = new AbortController();
  stressGridControllers.set(rootElement, controller);
  const { signal } = controller;

  const setActiveTab = (activeType) => {
    const active = normalizeStressType(activeType);
    sheet._stressGridDialogActive = active;
    for (const tab of qsa(rootElement, ".pc-stress-grid-tab")) {
      const selected = tab.dataset.stressTab === active;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", selected ? "true" : "false");
    }
    for (const pane of qsa(rootElement, ".pc-stress-grid-pane")) {
      pane.classList.toggle("active", pane.dataset.stressPane === active);
    }
  };

  for (const tab of qsa(rootElement, ".pc-stress-grid-tab")) {
    tab.addEventListener("click", (ev) => {
      ev.preventDefault();
      setActiveTab(tab.dataset.stressTab);
    }, { signal });
  }

  if (!canModifySheetActor(sheet)) return;

  for (const button of qsa(rootElement, ".stress-add")) {
    button.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const stressType = button.dataset.stressType;
      await changeStressGridSize(sheet, stressType, 1);
    }, { signal });
  }

  for (const button of qsa(rootElement, ".stress-remove")) {
    button.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const stressType = button.dataset.stressType;
      await changeStressGridSize(sheet, stressType, -1);
    }, { signal });
  }

  for (const cell of qsa(rootElement, ".stress-cell")) {
    cell.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const stressType = cell.dataset.stressType;
      const index = Number.parseInt(cell.dataset.index, 10);
      if (!stressType || Number.isNaN(index)) return;
      const currentState = Number(sheet.actor?.system?.[`${stressType}${index}`]) || 0;
      await setStressGridCell(sheet, stressType, index, (currentState + 1) % 4);
    }, { signal });

    cell.addEventListener("contextmenu", async (ev) => {
      ev.preventDefault();
      const stressType = cell.dataset.stressType;
      const index = Number.parseInt(cell.dataset.index, 10);
      if (!stressType || Number.isNaN(index)) return;
      await setStressGridCell(sheet, stressType, index, 0);
    }, { signal });
  }

  for (const button of qsa(rootElement, ".pc-stress-grid-refresh")) {
    button.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const stressType = normalizeStressType(button.dataset.stressType);
      await sheet.actor.refreshPeasantStressTrack?.(stressType);
    }, { signal });
  }
}
