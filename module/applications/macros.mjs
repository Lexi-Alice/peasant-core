// Mark macro-related dialogs with a stable class so CSS can style them
// without replacing Foundry's default dialog classes.
import { qsa, toElement } from "./dom.mjs";
import { pcLog } from "../utils/logging.mjs";

function _isPeasantMacroDialogTitle(title) {
  const t = String(title ?? "").trim().toLowerCase();
  return t === "skill roll"
    || t === "saving roll"
    || t === "untrained skill roll"
    || t === "range-rate"
    || t.includes(" attacks you!")
    || t.includes(" hits you!")
    || t.endsWith(" - description");
}

function _applyPeasantMacroFieldStyling(scope, windowEl = null) {
  if (!scope) return;
  if (windowEl) {
    windowEl.classList.add("peasant-macro-dialog", "peasant-macro-dialog-force");
  }

  const applyInputStyles = () => {
    for (const el of qsa(scope, 'input[type="number"], input[type="text"], textarea, select')) {
      el.classList.add("pc-macro-input");
      if (el.tagName === "SELECT") el.classList.add("pc-select");
      else if (el.tagName === "TEXTAREA") el.classList.add("pc-textarea");
      else el.classList.add("pc-input");
    }
  };

  const applyButtonIcons = () => {
    for (const btn of qsa(scope, ".dialog-buttons button, .form-footer button, footer button")) {
      if (!btn || btn.querySelector("i, svg")) continue;

      const action = String(btn.getAttribute("data-action") || btn.getAttribute("data-button") || "")
        .trim()
        .toLowerCase();
      const text = String(btn.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      let iconClass = "";
      if (action === "roll" || text === "roll") iconClass = "fa-solid fa-dice";
      else if (action === "cancel" || action === "close" || text === "cancel" || text === "close") iconClass = "fa-solid fa-xmark";
      if (!iconClass) continue;

      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.setAttribute("aria-hidden", "true");
      btn.prepend(icon);
    }
  };

  applyInputStyles();
  applyButtonIcons();
  setTimeout(applyInputStyles, 0);
  setTimeout(applyButtonIcons, 0);
  setTimeout(applyInputStyles, 50);
  setTimeout(applyButtonIcons, 50);
}

function _getApplicationElement(appOrElement) {
  return toElement(appOrElement);
}

function _stylePeasantMacroDialog(app, html) {
  try {
    const title = String(app?.title ?? app?.options?.title ?? "").trim().toLowerCase();
    if (!_isPeasantMacroDialogTitle(title)) return;

    const htmlEl = toElement(html);
    const windowEl = _getApplicationElement(app);
    const dialogEl = windowEl ?? htmlEl?.closest?.(".application, dialog") ?? null;

    const scope = dialogEl ?? htmlEl;
    if (!scope) return;
    _applyPeasantMacroFieldStyling(scope, dialogEl);
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to mark/style macro dialog", e);
  }
}

Hooks.on('renderApplicationV2', (app, html) => {
  _stylePeasantMacroDialog(app, html);
});

// Keep world macro script commands in sync with system macro source files.
// This prevents stale world macro code from continuing to call deprecated APIs.
async function _syncPeasantSystemMacros() {
  if (!game.user?.isGM) return;

  const targets = [
    { name: "Skill Roll", path: "macros/skill-roll.js" },
    { name: "Untrained Skill Roll", path: "macros/untrained-skill-roll.js" },
    { name: "Saving Roll", path: "macros/saving-roll.js" },
    { name: "Location Table", path: "macros/location-table.js" },
    { name: "Consciousness Check", path: "macros/consciousness-check.js" }
  ];

  const normalize = (text) => String(text ?? "").replace(/\r\n/g, "\n").trim();
  const systemId = game.system?.id || "peasant-core";

  for (const target of targets) {
    try {
      const url = `systems/${systemId}/${target.path}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        pcLog.debug(`Peasant Core | Macro sync skipped for ${target.name} (source missing): ${url}`);
        continue;
      }

      const source = await response.text();
      const desired = normalize(source);
      if (!desired) continue;

      const macros = game.macros?.filter?.((m) => m?.type === "script" && m?.name === target.name) || [];
      for (const macro of macros) {
        const current = normalize(macro.command);
        if (current === desired) continue;
        await macro.update({ command: source });
        pcLog.debug(`Peasant Core | Synced world macro "${macro.name}" from ${target.path}`);
      }
    } catch (err) {
      pcLog.debug(`Peasant Core | Macro sync failed for ${target.name}`, err);
    }
  }
}

Hooks.once("ready", () => {
  // Delay slightly so world collections are fully available.
  setTimeout(() => {
    _syncPeasantSystemMacros().catch((err) => pcLog.debug("Peasant Core | Macro sync task failed", err));
  }, 200);
});
