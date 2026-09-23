import { pcLog } from "../../../utils/logging.mjs";
import { delegate, qs, qsa, toElement } from "../../dom.mjs";
import { renderSheetResourceDialog } from "./resource-dialogs.mjs";
import { computeBaseAttrToHits } from "../../../data/actor/attributes.mjs";
import { applyToHitFloor } from "../../../dice/roll-targets.mjs";

export function setupBlessingControls(sheet, html) {
  delegate(html, "click", ".attr-label[data-attr] > span, .attr-label[data-attr]", (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();

    if (!sheet.isEditMode) return;

    const label = target.closest(".attr-label[data-attr]");
    openBlessingDialog(sheet, label);
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

function openBlessingDialog(sheet, trigger) {
  const blessing = sheet.actor.system.blessing || { type: "" };
  const fallUses = sheet.actor.system.fallBlessingUses || { value: 0, max: 1 };
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
        <div class="pc-blessing-grid pc-blessing-fall-uses"${blessing.type === "fall" ? "" : " hidden"}>
          <label><span>Uses</span><input type="number" name="fallBlessingUsesValue" value="${Math.max(0, Number(fallUses.value) || 0)}" min="0" step="1" inputmode="numeric"></label>
          <label><span>Maximum</span><input type="number" name="fallBlessingUsesMax" value="${Math.max(0, Number(fallUses.max) || 0)}" min="0" step="1" inputmode="numeric"></label>
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
          await sheet.actor.setPeasantBlessing?.(chosenType);
          if (chosenType === "fall") {
            await sheet.actor.setPeasantFallBlessingUses?.({
              value: qs(form, "input[name=fallBlessingUsesValue]")?.value,
              max: qs(form, "input[name=fallBlessingUsesMax]")?.value
            });
          }
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
          const fallFields = qs(html, ".pc-blessing-fall-uses");
          if (fallFields) fallFields.hidden = ev.currentTarget.value !== "fall";
        });
      }
    }
  }, trigger, {
    width: 360,
    height: 280,
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

    const baseToHits = computeBaseAttrToHits(sheet.actor.system);
    const attrCombatMods = sheet.actor.system.combatMods || {};
    const attrToHitMod = parseInt(attrCombatMods.toHit) || 0;
    const mapping = Object.fromEntries(Object.entries(baseToHits).map(([characteristic, value]) => (
      [characteristic, applyToHitFloor(value, attrToHitMod, 2).toHit]
    )));

    const toHitElements = qsa(root, ".attr-tohit-clickable[data-characteristic]");
    Object.entries(mapping).forEach(([char, val]) => {
      const toHit = toHitElements.find((element) => element.dataset.characteristic === char);
      if (toHit) toHit.textContent = `${val}+`;
    });
  } catch (domErr) {
    pcLog.debug("Failed to update characteristic to-hit display", domErr);
  }
}
