import { escapeHtml } from "../../../utils/chat.mjs";
import { delegate, qs, qsa, toElement } from "../../dom.mjs";
import { renderSheetResourceDialog } from "./resource-dialogs.mjs";

export function setupWoundsControls(sheet, html) {
  delegate(html, "click", ".toggle-wounds-menu", (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    openWoundsDialog(sheet, target);
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

function openWoundsDialog(sheet, trigger = null, position = null) {
  return renderSheetResourceDialog(sheet, "wounds", {
    title: "Active Wounds",
    ...(position ? { position } : {}),
    content: `
      <div class="pc-resource-form pc-wounds-form">
        <div class="pc-wounds-list">
          ${renderActiveWounds(sheet.actor)}
        </div>
      </div>
    `,
    buttons: {
      add: {
        icon: "fa-solid fa-plus",
        label: "Add Wound",
        callback: (html) => {
          openAddWoundDialog(sheet, trigger, getDialogWindowPosition(html, 320));
        }
      }
    },
    render: (html) => {
      for (const tagEl of qsa(html, ".pc-wound-tag")) {
        bindWoundTagHover(tagEl);
      }

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

          button.closest(".pc-wound-tag")?.remove();
          const list = qs(html, ".pc-wounds-list");
          if (list && !qs(list, ".pc-wound-tag")) {
            list.innerHTML = `<div class="pc-resource-empty">No active wounds</div>`;
          }

          sheet.render(false);
        });
      }
    }
  }, trigger, {
    width: 300,
    height: 260,
    classes: ["pc-wounds-dialog"]
  });
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
          sheet.render(false);
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

function renderActiveWounds(actor) {
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
    <div class="pc-wound-tag">
      <span>${escapeHtml(entry.label)}</span>
      <button type="button" class="pc-remove-condition" data-condition="${escapeHtml(entry.key)}" title="Remove ${escapeHtml(entry.label)}" aria-label="Remove ${escapeHtml(entry.label)}">&times;</button>
    </div>
  `).join("");
}
