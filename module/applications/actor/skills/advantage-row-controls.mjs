import { showReadonlyDescriptionDialog } from "../controls/description-dialogs.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export function setupAdvantageRowControls(sheet, html, { blurActiveEditableInSheet, collectAdvantagesFromDOM, enqueueSheetUpdate } = {}) {
  html.on("click", ".add-advantage-btn", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    await enqueueSheetUpdate?.("_advantageSaveQueue", "Advantage add", async () => {
      const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
      await sheet.actor.addPeasantFlexibleAdvantage?.(adv.names, adv.descriptions);
    });
    sheet.render(true);
  });

  html.on("click", ".advantage-delete", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    const li = $(ev.currentTarget).closest(".advantage-item");
    const index = resolveRowIndex(li, "data-advantage-index");
    if (Number.isNaN(index)) return;
    await blurActiveEditableInSheet?.();
    await enqueueSheetUpdate?.("_advantageSaveQueue", "Advantage delete", async () => {
      const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
      await sheet.actor.removePeasantFlexibleAdvantage?.(index, adv.names, adv.descriptions);
    });
    sheet.render(true);
  });

  html.on("change", ".advantage-input", async (ev) => {
    if (!sheet.isEditMode) return;
    const input = $(ev.currentTarget);
    let index = parseInt(input.data("index"));
    if (Number.isNaN(index)) {
      const li = input.closest(".advantage-item");
      index = resolveRowIndex(li, "data-advantage-index");
    }
    if (Number.isNaN(index)) return;
    await enqueueSheetUpdate?.("_advantageSaveQueue", "Advantage field change", async () => {
      const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
      while (adv.names.length <= index) adv.names.push("");
      while (adv.descriptions.length <= index) adv.descriptions.push("");
      await sheet.actor.setPeasantFlexibleAdvantages?.(adv.names, adv.descriptions, { render: false });
    });
  });

  html.on("click", ".advantage-name-wrapper, .advantage-name-view.advantage-has-desc", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      const $current = $(ev.currentTarget);
      const $target = $(ev.target);
      const $wrapper = $current.hasClass("advantage-name-wrapper") ? $current : $current.closest(".advantage-name-wrapper");
      const $nameSpan = $current.hasClass("advantage-name-view") ? $current : $current.find(".advantage-name-view.advantage-has-desc").first();

      let index = Number($wrapper.data("index"));
      if (Number.isNaN(index)) index = Number($nameSpan.data("index"));
      if (Number.isNaN(index)) index = Number($target.closest(".advantage-name-view.advantage-has-desc").data("index"));
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
  html.find(".advantage-delete").off("click").click(async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    const li = $(ev.currentTarget).closest(".advantage-item");
    const index = resolveRowIndex(li, "data-advantage-index");
    if (Number.isNaN(index)) return;
    await blurActiveEditableInSheet?.();
    await enqueue("_advantageSaveQueue", "Advantage delete backup", async () => {
      const adv = collectAdvantagesFromDOM?.() ?? { names: [], descriptions: [] };
      await sheet.actor.removePeasantFlexibleAdvantage?.(index, adv.names, adv.descriptions);
    });
    sheet.render(true);
  });
}

function resolveRowIndex(row, attr) {
  let index = parseInt(row.attr(attr));
  if (Number.isNaN(index)) index = row.index();
  return index;
}
