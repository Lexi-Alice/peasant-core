// Mark macro-related dialogs with a stable class so CSS can style them
// without replacing Foundry's default dialog classes.
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

function _applyPeasantMacroFieldStyling($scope, $window = $()) {
  if (!$scope?.length) return;
  if ($window?.length) {
    $window.addClass("peasant-macro-dialog peasant-macro-dialog-force");
  }

  const sampleInput = document.querySelector(
    '.window-app.peasant-core .actor-sheet .combat-input,' +
    '.window-app.peasant-core .actor-sheet .skill-input,' +
    '.window-app.peasant-core .actor-sheet .resource-input,' +
    '.window-app.peasant-core .actor-sheet input[type="number"],' +
    '.window-app.peasant-core .actor-sheet input[type="text"]:not(.character-name)'
  );
  const sampleStyle = sampleInput ? getComputedStyle(sampleInput) : null;
  const fallbackBackground = "var(--color-cool-4, #302831)";
  const fallbackText = "var(--input-text-color, #e0e0e0)";
  const fallbackBorder = "1px solid var(--color-cool-4, #302831)";
  const backgroundValue = sampleStyle?.backgroundColor || fallbackBackground;
  const textValue = sampleStyle?.color || fallbackText;
  const borderColor = sampleStyle?.borderTopColor;
  const borderWidth = sampleStyle?.borderTopWidth && sampleStyle.borderTopWidth !== "0px" ? sampleStyle.borderTopWidth : "1px";
  const borderStyle = sampleStyle?.borderTopStyle && sampleStyle.borderTopStyle !== "none" ? sampleStyle.borderTopStyle : "solid";
  const borderValue = borderColor ? `${borderWidth} ${borderStyle} ${borderColor}` : fallbackBorder;
  const radiusValue = sampleStyle?.borderRadius || "3px";
  const paddingValue = sampleStyle?.padding || "6px 8px";

  const applyInputStyles = () => {
    const $inputs = $scope.find('input[type="number"], input[type="text"], select');
    $inputs.addClass("pc-macro-input");
    for (const el of $inputs.toArray()) {
      el.style.setProperty("background", backgroundValue, "important");
      el.style.setProperty("color", textValue, "important");
      el.style.setProperty("border", borderValue, "important");
      el.style.setProperty("border-radius", radiusValue, "important");
      el.style.setProperty("padding", paddingValue, "important");
      el.style.setProperty("box-shadow", "none", "important");
      el.style.setProperty("outline", "none", "important");
    }
  };

  const applyButtonIcons = () => {
    const $buttons = $scope.find(".dialog-buttons button, .form-footer button, footer button");
    for (const btn of $buttons.toArray()) {
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

function _stylePeasantMacroWindowElement(element) {
  if (!element) return;
  const el = element instanceof jQuery ? element[0] : element;
  if (!el) return;
  const titleText = String(
    el.querySelector?.('.window-title')?.textContent
    || el.querySelector?.('.window-header h4')?.textContent
    || ""
  ).trim().toLowerCase();
  if (!_isPeasantMacroDialogTitle(titleText)) return;
  const $window = $(el);
  const $scope = $window;
  _applyPeasantMacroFieldStyling($scope, $window);
}

function _getApplicationElement(appOrElement) {
  const source = appOrElement?.element ?? appOrElement;
  if (!source) return null;
  if (source instanceof HTMLElement) return source;
  if (source instanceof jQuery) return source[0] ?? null;
  if (Array.isArray(source)) return _getApplicationElement(source[0]);
  return source?.[0] instanceof HTMLElement ? source[0] : null;
}

function _stylePeasantMacroDialog(app, html) {
  try {
    const title = String(app?.title ?? app?.options?.title ?? "").trim().toLowerCase();
    if (!_isPeasantMacroDialogTitle(title)) return;

    const $html = html
      ? (html instanceof jQuery ? html : $(html))
      : $();
    let $window = $();
    const windowEl = _getApplicationElement(app);
    if (windowEl) $window = $(windowEl);
    if (!$window.length && $html.length) {
      $window = $html.closest(".window-app, .application");
    }

    const $scope = $window.length ? $window : $html;
    if (!$scope.length) return;
    _applyPeasantMacroFieldStyling($scope, $window);
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to mark/style macro dialog", e);
  }
}

Hooks.on('renderDialog', (app, html) => {
  _stylePeasantMacroDialog(app, html);
});
Hooks.on('renderApplication', (app, html) => {
  _stylePeasantMacroDialog(app, html);
});
Hooks.on('renderApplicationV2', (app, html) => {
  _stylePeasantMacroDialog(app, html);
});

Hooks.once('ready', () => {
  try {
    // Immediate pass for any already-open macro dialogs.
    document.querySelectorAll('.window-app, .application').forEach((el) => _stylePeasantMacroWindowElement(el));

    // DOM-level fallback for any render paths that bypass standard hooks.
    if (window.__peasantMacroDialogObserver) return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          _stylePeasantMacroWindowElement(node);
          node.querySelectorAll?.('.window-app, .application').forEach((el) => _stylePeasantMacroWindowElement(el));
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__peasantMacroDialogObserver = observer;
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to start macro dialog observer", e);
  }
});

// Keep world macro script commands in sync with system macro source files.
// This prevents stale world macro code from continuing to call deprecated APIs.
async function _syncPeasantSystemMacros() {
  if (!game.user?.isGM) return;

  const targets = [
    { name: "Skill Roll", path: "macros/skill-roll.js" },
    { name: "Untrained Skill Roll", path: "macros/untrained-skill-roll.js" },
    { name: "Saving Roll", path: "macros/saving-roll.js" },
    { name: "Consciousness Check", path: "macros/consciousness-check.js" },
    { name: "Notable Combats to Chat", path: "macros/notable-combats-chat.js" }
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
