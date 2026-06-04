import { ensureSlideToggleElement } from "../../../components/slide-toggle.mjs";
import { qs, toElement } from "../../../dom.mjs";

function canModifySheetActor(sheet) {
  return !!(sheet?.canModifyActor ?? (game.user?.isGM || sheet?.actor?.isOwner));
}

function syncModeToggleLabel(toggle) {
  const label = toggle.checked ? "Enter View Mode" : "Enter Edit Mode";
  toggle.dataset.tooltip = label;
  toggle.setAttribute("aria-label", label);
}

function positionModeToggle(header, toggle) {
  const firstHeaderControl = Array.from(header.children)
    .find(element => element.matches?.(".header-control, [data-action='close']"));
  if (firstHeaderControl?.parentElement === header) firstHeaderControl.before(toggle);
  else header.prepend(toggle);
}

function bindModeToggle(sheet, toggle) {
  toggle._pcDialogModeToggleController?.abort?.();
  const AbortControllerClass = toggle.ownerDocument?.defaultView?.AbortController ?? AbortController;
  const controller = new AbortControllerClass();
  toggle._pcDialogModeToggleController = controller;

  toggle.addEventListener("dblclick", event => event.stopPropagation(), { signal: controller.signal });
  toggle.addEventListener("pointerdown", event => event.stopPropagation(), { signal: controller.signal });
  toggle.addEventListener("change", async (event) => {
    if (!canModifySheetActor(sheet)) return;
    toggle.disabled = true;
    try {
      if (typeof sheet?._onChangeSheetMode === "function") await sheet._onChangeSheetMode(event, toggle);
    } finally {
      if (toggle.isConnected) {
        toggle.checked = !!sheet?.isEditMode;
        toggle.disabled = false;
        syncModeToggleLabel(toggle);
      }
    }
  }, { signal: controller.signal });
}

export function renderDialogModeToggle(sheet, root) {
  const rootElement = toElement(root);
  const header = qs(rootElement, ".window-header");
  if (!header) return;

  ensureSlideToggleElement(header.ownerDocument?.defaultView);

  let toggle = qs(header, "slide-toggle.mode-slider");
  if (!canModifySheetActor(sheet)) {
    toggle?.remove();
    return;
  }

  if (!toggle) {
    toggle = header.ownerDocument.createElement("slide-toggle");
    toggle.classList.add("mode-slider");
    bindModeToggle(sheet, toggle);
  }

  toggle.checked = !!sheet?.isEditMode;
  toggle.disabled = false;
  syncModeToggleLabel(toggle);
  positionModeToggle(header, toggle);
}
