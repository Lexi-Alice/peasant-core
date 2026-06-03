import { escapeHtml } from "../../../utils/chat.mjs";
import { delegate, qs, qsa, toElement } from "../../dom.mjs";
import { renderSheetResourceDialog } from "./resource-dialogs.mjs";

const openWoundsDialogs = new Set();

function isSameDialogActor(sheet, actor) {
  const sheetActor = sheet?.actor;
  return !!sheetActor && (
    sheetActor === actor
    || sheetActor.uuid === actor?.uuid
    || (!!sheetActor.id && sheetActor.id === actor?.id)
  );
}

export function setupWoundsControls(sheet, html, { readOnly = !!sheet?.isReadOnlyObserver } = {}) {
  delegate(html, "click", ".toggle-wounds-menu", (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    openWoundsDialog(sheet, target, null, { readOnly });
  });
}

function bindWoundTagHover(tagEl) {
  if (!tagEl || tagEl.dataset.pcWoundHoverBound === "true") return;
  tagEl.dataset.pcWoundHoverBound = "true";

  const removeBtn = tagEl.querySelector(".pc-remove-condition, .remove-condition");
  const setTagHoverState = (active) => {
    tagEl.classList.toggle("tag-hover-active", !!active);
    if (!active) {
      tagEl.style.removeProperty("background");
      tagEl.style.removeProperty("background-color");
      tagEl.style.removeProperty("border-color");
      tagEl.style.removeProperty("color");
      return;
    }

    const hoverSource = removeBtn || tagEl;
    const hoverStyles = (hoverSource.ownerDocument?.defaultView ?? window).getComputedStyle(hoverSource);
    const hoverBg = hoverStyles.getPropertyValue("--button-hover-background-color").trim() || "rgba(206, 122, 28, 0.85)";
    const hoverBorder = hoverStyles.getPropertyValue("--button-hover-border-color").trim() || "#e0b15b";
    const hoverText = hoverStyles.getPropertyValue("--button-hover-text-color").trim() || "#fff4db";

    tagEl.style.setProperty("background", hoverBg, "important");
    tagEl.style.setProperty("background-color", hoverBg, "important");
    tagEl.style.setProperty("border-color", hoverBorder, "important");
    tagEl.style.setProperty("color", hoverText, "important");
  };
  const setRemoveHoverState = (active) => {
    if (!removeBtn) return;
    removeBtn.classList.toggle("tag-hover-active", !!active);
  };

  tagEl.addEventListener("mouseenter", () => setTagHoverState(true));
  tagEl.addEventListener("mouseleave", () => setTagHoverState(false));

  if (!removeBtn) return;

  removeBtn.addEventListener("mouseenter", () => {
    setTagHoverState(false);
    setRemoveHoverState(true);
  });
  removeBtn.addEventListener("mouseleave", () => {
    setRemoveHoverState(false);
    if (tagEl.matches(":hover")) setTagHoverState(true);
  });
  removeBtn.addEventListener("focusin", () => {
    setTagHoverState(false);
    setRemoveHoverState(true);
  });
  removeBtn.addEventListener("focusout", () => {
    setRemoveHoverState(false);
    setTimeout(() => {
      if (tagEl.matches(":hover")) setTagHoverState(true);
    }, 0);
  });
}

function getDialogWindowPosition(html, width) {
  const el = toElement(html);
  if (!el?.isConnected || typeof el.getBoundingClientRect !== "function") return null;

  const rect = el.getBoundingClientRect();
  if (!rect || (rect.width <= 0 && rect.height <= 0)) return null;

  return {
    width,
    left: Math.round(rect.left),
    top: Math.round(rect.top)
  };
}

function openWoundsDialog(sheet, trigger = null, position = null, { readOnly = !!sheet?.isReadOnlyObserver } = {}) {
  const dialog = renderSheetResourceDialog(sheet, "wounds", {
    title: "Active Wounds",
    ...(position ? { position } : {}),
    content: `
      <div class="pc-resource-form pc-wounds-form">
        <div class="pc-wounds-list">
          ${renderActiveWounds(sheet.actor, { readOnly })}
        </div>
      </div>
    `,
    buttons: readOnly ? {} : {
      add: {
        icon: "fa-solid fa-plus",
        label: "Add Wound",
        callback: (html) => {
          openAddWoundDialog(sheet, trigger, getDialogWindowPosition(html, 320));
        }
      }
    },
    render: (html) => {
      bindWoundsDialog(sheet, html, { readOnly });
    }
  }, trigger, {
    width: 300,
    height: 260,
    classes: ["pc-wounds-dialog"]
  });

  const registration = { sheet, dialog };
  openWoundsDialogs.add(registration);
  if (typeof dialog?.close === "function") {
    const closeDialog = dialog.close.bind(dialog);
    dialog.close = (...args) => {
      openWoundsDialogs.delete(registration);
      return closeDialog(...args);
    };
  }

  return dialog;
}

export function refreshOpenWoundsDialogsForActor(actor) {
  if (!actor) return;
  for (const registration of Array.from(openWoundsDialogs)) {
    const { sheet, dialog } = registration;
    if (!isSameDialogActor(sheet, actor)) continue;

    const root = toElement(dialog);
    if (!root?.isConnected) {
      openWoundsDialogs.delete(registration);
      continue;
    }

    refreshWoundsDialog(sheet, root);
  }
}

function refreshWoundsDialog(sheet, root) {
  const rootElement = toElement(root);
  const list = qs(rootElement, ".pc-wounds-list");
  if (!list) return;

  const readOnly = !!sheet?.isReadOnlyObserver;
  list.innerHTML = renderActiveWounds(sheet.actor, { readOnly });
  bindWoundsDialog(sheet, rootElement, { readOnly });
}

function bindWoundsDialog(sheet, html, { readOnly = !!sheet?.isReadOnlyObserver } = {}) {
  for (const tagEl of qsa(html, ".pc-wound-tag")) {
    bindWoundTagHover(tagEl);
  }

  if (readOnly) return;

  for (const button of qsa(html, ".pc-remove-condition")) {
    button.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const key = button.dataset.condition;

      try {
        await sheet.actor.clearPeasantCondition?.(key);
      } catch (err) {
        console.warn("Failed to remove condition:", err);
        return;
      }
    });
  }
}

function openAddWoundDialog(sheet, trigger = null, position = null) {
  const dialogContent = `
    <div class="pc-resource-form pc-add-wound-form">
      <label class="pc-resource-single-field">
        <span>Select Wound Type</span>
        <select name="woundType" class="pc-select">
          <option value="wounded">Wounded</option>
          <optgroup label="--- Disabled ---">
            <option value="disabled:head">Disabled Head</option>
            <option value="disabled:rightArm">Disabled Right Arm</option>
            <option value="disabled:leftArm">Disabled Left Arm</option>
            <option value="disabled:rightLeg">Disabled Right Leg</option>
            <option value="disabled:leftLeg">Disabled Left Leg</option>
            <option value="disabled:torso">Disabled Torso</option>
          </optgroup>
          <optgroup label="--- Crippled ---">
            <option value="crippled:head">Crippled Head</option>
            <option value="crippled:rightArm">Crippled Right Arm</option>
            <option value="crippled:leftArm">Crippled Left Arm</option>
            <option value="crippled:rightLeg">Crippled Right Leg</option>
            <option value="crippled:leftLeg">Crippled Left Leg</option>
            <option value="crippled:torso">Crippled Torso</option>
          </optgroup>
        </select>
      </label>
    </div>
  `;

  return renderSheetResourceDialog(sheet, "add-wound", {
    title: "Add Wound",
    ...(position ? { position } : {}),
    content: dialogContent,
    buttons: {
      add: {
        icon: "fa-solid fa-plus",
        label: "Add",
        default: true,
        callback: async (html) => {
          const woundType = qs(html, '[name="woundType"]')?.value;
          const position = getDialogWindowPosition(html, 300);
          await sheet.actor.addPeasantWound?.(woundType);
          openWoundsDialog(sheet, trigger, position);
          return true;
        }
      },
      cancel: {
        icon: "fa-solid fa-xmark",
        label: "Cancel"
      }
    },
    default: "add"
  }, trigger, {
    width: 320,
    height: 260,
    classes: ["pc-add-wound-dialog"]
  });
}

function renderActiveWounds(actor, { readOnly = false } = {}) {
  const conditions = actor?.system?.conditions || {};
  const entries = [];

  if (conditions.wounded) {
    entries.push({ key: "wounded", label: "WOUNDED" });
  }

  const locMappings = [
    { key: "head", label: "Head" },
    { key: "rightArm", label: "Right Arm" },
    { key: "leftArm", label: "Left Arm" },
    { key: "rightLeg", label: "Right Leg" },
    { key: "leftLeg", label: "Left Leg" },
    { key: "torso", label: "Torso" },
    { key: "arms", label: "Arms" },
    { key: "legs", label: "Legs" }
  ];

  for (const loc of locMappings) {
    const status = String(conditions[loc.key] || "");
    if (!status) continue;
    entries.push({
      key: loc.key,
      label: `${status.charAt(0).toUpperCase()}${status.slice(1)} ${loc.label}`
    });
  }

  if (!entries.length) return `<div class="pc-resource-empty">No active wounds</div>`;

  return entries.map((entry) => `
    <div class="pc-wound-tag"${readOnly ? ` tabindex="0"` : ""}>
      <span>${escapeHtml(entry.label)}</span>
      ${readOnly ? "" : `<button type="button" class="pc-remove-condition" data-condition="${escapeHtml(entry.key)}" title="Remove ${escapeHtml(entry.label)}" aria-label="Remove ${escapeHtml(entry.label)}">&times;</button>`}
    </div>
  `).join("");
}
