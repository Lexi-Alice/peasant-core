import { showReadonlyDescriptionDialog } from "../controls/description-dialogs.mjs";
import { delegate, qsa, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export function setupAdvantageRowControls(sheet, html, { blurActiveEditableInSheet, collectAdvantagesFromDOM, enqueueSheetUpdate } = {}) {
  const root = toElement(html);
  if (!root) return;

  delegate(root, "click", ".add-advantage-btn", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    await enqueueSheetUpdate?.("_advantageSaveQueue", "Advantage add", async () => {
      const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
      await sheet.actor.addPeasantFlexibleAdvantage?.(adv.names, adv.descriptions);
    });
  });

  delegate(root, "click", ".advantage-delete", async (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    const li = target.closest(".advantage-item");
    const index = resolveRowIndex(li, "data-advantage-index");
    if (Number.isNaN(index)) return;
    await blurActiveEditableInSheet?.();
    await enqueueSheetUpdate?.("_advantageSaveQueue", "Advantage delete", async () => {
      const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
      await sheet.actor.removePeasantFlexibleAdvantage?.(index, adv.names, adv.descriptions);
    });
  });

  delegate(root, "change", ".advantage-input", async (ev, input) => {
    if (!sheet.isEditMode) return;
    let index = Number.parseInt(input.dataset.index, 10);
    if (Number.isNaN(index)) {
      const li = input.closest(".advantage-item");
      index = resolveRowIndex(li, "data-advantage-index");
    }
    if (Number.isNaN(index)) return;
    await enqueueSheetUpdate?.("_advantageSaveQueue", "Advantage field change", async () => {
      const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
      while (adv.names.length <= index) adv.names.push("");
      while (adv.descriptions.length <= index) adv.descriptions.push("");
      await sheet.actor.setPeasantFlexibleAdvantages?.(adv.names, adv.descriptions);
    });
  });

  delegate(root, "click", ".advantage-name-wrapper, .advantage-name-view.advantage-has-desc", async (ev, current) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      const target = ev.target;
      const wrapper = current.classList.contains("advantage-name-wrapper") ? current : current.closest(".advantage-name-wrapper");
      const nameSpan = current.classList.contains("advantage-name-view")
        ? current
        : current.querySelector(".advantage-name-view.advantage-has-desc");

      let index = Number(wrapper?.dataset.index);
      if (Number.isNaN(index)) index = Number(nameSpan?.dataset.index);
      if (Number.isNaN(index)) index = Number(target?.closest?.(".advantage-name-view.advantage-has-desc")?.dataset.index);
      if (Number.isNaN(index)) return;

      const names = sheet.actor.system.flexibleAdvantages || [];
      const descriptions = sheet.actor.system.flexibleAdvantageDescriptions || [];
      const nameEntry = names[index];
      const advantageName = (typeof nameEntry === "string"
        ? nameEntry
        : String(nameEntry?.name ?? "")
      ).trim() || "Flexible Advantage";
      const description = String(descriptions[index] ?? "");

      await showReadonlyDescriptionDialog(sheet, {
        title: `${advantageName} - Description`,
        description
      });
    } catch (e) {
      pcLog.debug("advantage-name-view click failed", e);
    }
  });
}

export function setupAdvantageDeleteBackupHandler(sheet, html, { blurActiveEditableInSheet, collectAdvantagesFromDOM, enqueue } = {}) {
  const root = toElement(html);
  for (const button of qsa(root, ".advantage-delete")) {
    button.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      const li = button.closest(".advantage-item");
      const index = resolveRowIndex(li, "data-advantage-index");
      if (Number.isNaN(index)) return;
      await blurActiveEditableInSheet?.();
      await enqueue("_advantageSaveQueue", "Advantage delete backup", async () => {
        const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
        await sheet.actor.removePeasantFlexibleAdvantage?.(index, adv.names, adv.descriptions);
      });
    });
  }
}

function resolveRowIndex(row, attr) {
  const element = toElement(row);
  let index = Number.parseInt(element?.getAttribute(attr), 10);
  if (Number.isNaN(index) && element?.parentElement) index = Array.from(element.parentElement.children).indexOf(element);
  return index;
}
