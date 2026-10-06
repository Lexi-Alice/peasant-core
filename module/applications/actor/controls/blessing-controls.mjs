import { pcLog } from "../../../utils/logging.mjs";
import { delegate, qsa, toElement } from "../../dom.mjs";
import { computeBaseAttrToHits } from "../../../data/actor/attributes.mjs";
import { applyToHitFloor } from "../../../dice/roll-targets.mjs";
import { createSheetUpdateQueue } from "./sheet-listener-helpers.mjs";

export function setupBlessingControls(sheet, html) {
  const enqueueSheetUpdate = createSheetUpdateQueue(sheet);
  for (const input of qsa(html, ".pc-blessing-choice")) {
    input.addEventListener("change", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;

      const type = input.checked ? input.dataset.blessingType : "";
      for (const choice of qsa(html, ".pc-blessing-choice")) {
        choice.checked = choice.dataset.blessingType === type;
      }
      try {
        await enqueueSheetUpdate("_blessingSaveQueue", "Blessing", () => sheet.actor.setPeasantBlessing(type));
      } catch (err) {
        console.warn("Failed to save blessing:", err);
        for (const choice of qsa(html, ".pc-blessing-choice")) {
          choice.checked = choice.dataset.blessingType === sheet.actor.system.blessing?.type;
        }
        globalThis.ui?.notifications?.warn?.("Failed to save blessing. See console for details.");
      }
    });
  }

  for (const input of qsa(html, ".pc-fall-blessing-uses-input")) {
    input.addEventListener("change", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode || sheet.actor.system.blessing?.type !== "fall") return;

      const field = input.dataset.fallUseField;
      const value = input.value;
      try {
        const uses = await enqueueSheetUpdate("_blessingSaveQueue", "Blessing of Fall uses", () => sheet.actor.setPeasantFallBlessingUses({ [field]: value }));
        if (input.value === value) input.value = String(uses[field]);
      } catch (err) {
        console.warn("Failed to save Blessing of Fall uses:", err);
        input.value = String(sheet.actor.system.fallBlessingUses?.[field] ?? 0);
        globalThis.ui?.notifications?.warn?.("Failed to save Blessing of Fall uses. See console for details.");
      }
    });
  }

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
