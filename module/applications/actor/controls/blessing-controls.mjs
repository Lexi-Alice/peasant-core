import { pcLog } from "../../../utils/logging.mjs";
import { delegate, qs, qsa, toElement } from "../../dom.mjs";
import { renderSheetResourceDialog } from "./resource-dialogs.mjs";

export function setupBlessingControls(sheet, html) {
  delegate(html, "click", ".attr-label[data-attr] > span, .attr-label[data-attr]", (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();

    if (!sheet.isEditMode) return;

    const label = target.closest(".attr-label[data-attr]");
    const attr = label?.dataset.attr;
    openBlessingDialog(sheet, attr, label);
  });

  delegate(html, "click", ".characteristic-label", async (ev, target) => {
    try {
      if (!sheet.isEditMode) return;
      ev.preventDefault();
      ev.stopPropagation();

      const characteristic = target.dataset.characteristic;

      try {
        const result = await sheet.actor.togglePeasantToHitPenaltyTarget?.(characteristic);
        updateCharacteristicToHitDisplay(sheet, html, result?.target ?? "");
      } catch (err) {
        console.warn("Failed to update toHitPenaltyTarget", err);
      }
    } catch (err) {
      console.error("Error handling characteristic-label click:", err);
    }
  });

}

function openBlessingDialog(sheet, attr, trigger) {
  const blessing = sheet.actor.system.blessing || { type: "", target: "" };
  const blessingTarget = blessing.target || attr || "";

  return renderSheetResourceDialog(sheet, "blessing", {
    title: "Blessings",
    content: `
      <div class="pc-resource-form pc-blessing-form">
        <div class="pc-blessing-grid">
          ${renderBlessingOption("spring", "Blessing of Spring", blessing.type)}
          ${renderBlessingOption("summer", "Blessing of Summer", blessing.type)}
          ${renderBlessingOption("fall", "Blessing of Fall", blessing.type)}
          ${renderBlessingOption("winter", "Blessing of Winter", blessing.type)}
        </div>
      </div>
    `,
    buttons: {
      apply: {
        icon: "fa-solid fa-check",
        label: "Apply",
        default: true,
        callback: async (html) => {
          const form = qs(html, ".pc-blessing-form");
          const chosenType = qs(form, "input[name=blessingType]:checked")?.value || "";
          const chosenTarget = blessingTarget;

          if (chosenType && (chosenType === "spring" || chosenType === "fall" || chosenType === "summer")) {
            if (!chosenTarget) {
              ui.notifications.warn("Please select a basic attribute target for this Blessing.");
              return false;
            }
          }

          await sheet.actor.setPeasantBlessing?.(chosenType, chosenTarget);
          return true;
        }
      },
      clear: {
        icon: "fa-solid fa-eraser",
        label: "Clear",
        callback: async () => {
          try {
            await sheet.actor.clearPeasantBlessing?.();
          } catch (err) {
            console.warn("Failed to clear blessing:", err);
            return false;
          }
          return true;
        }
      }
    },
    default: "apply",
    render: (html) => {
      for (const input of qsa(html, "input[name=blessingType]")) {
        input.addEventListener("change", (ev) => {
          if (!ev.currentTarget.checked) return;
          for (const otherInput of qsa(html, "input[name=blessingType]")) {
            if (otherInput !== ev.currentTarget) otherInput.checked = false;
          }
        });
      }
    }
  }, trigger, {
    width: 360,
    height: 220,
    classes: ["pc-blessing-dialog"]
  });
}

function renderBlessingOption(type, label, selectedType) {
  const checked = type === selectedType ? " checked" : "";
  return `
    <label>
      <input type="checkbox" name="blessingType" value="${type}"${checked}>
      <span>${label}</span>
    </label>
  `;
}

function updateCharacteristicToHitDisplay(sheet, html, newTarget) {
  try {
    const root = toElement(html);
    if (!root) return;
    for (const label of qsa(root, ".characteristic-label")) {
      label.classList.toggle("blessed", !!newTarget && label.dataset.characteristic === newTarget);
    }

    const build = sheet.actor.system.build || 0;
    const reflex = sheet.actor.system.reflex || 0;
    const intuition = sheet.actor.system.intuition || 0;
    const learn = sheet.actor.system.learn || 0;
    const charisma = sheet.actor.system.charisma || 0;

    const blessing = sheet.actor.system.blessing || { type: null, target: null };
    const isSummer = blessing.type === "summer" && blessing.target;
    const blessedValue = isSummer ? ({ build, reflex, intuition, learn, charisma }[blessing.target] || 0) : 0;

    const strBase = isSummer ? (22 - build - reflex - blessedValue) : (18 - build - reflex);
    const dexBase = isSummer ? (22 - reflex - intuition - blessedValue) : (18 - reflex - intuition);
    const mntBase = isSummer ? (22 - intuition - learn - blessedValue) : (18 - intuition - learn);
    const socBase = isSummer ? (22 - intuition - charisma - blessedValue) : (18 - intuition - charisma);

    const mapping = {
      Strength: newTarget === "Strength" ? (strBase - 1) : strBase,
      Dexterity: newTarget === "Dexterity" ? (dexBase - 1) : dexBase,
      Mental: newTarget === "Mental" ? (mntBase - 1) : mntBase,
      Social: newTarget === "Social" ? (socBase - 1) : socBase
    };

    const toHitElements = qsa(root, ".attr-tohit-clickable[data-characteristic]");
    Object.entries(mapping).forEach(([char, val]) => {
      const toHit = toHitElements.find((element) => element.dataset.characteristic === char);
      if (toHit) toHit.textContent = `${val}+`;
    });
  } catch (domErr) {
    pcLog.debug("Failed to update characteristic to-hit display", domErr);
  }
}
