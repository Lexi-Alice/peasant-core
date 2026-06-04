import { renderPeasantDescriptionEditor } from "../controls/description-editor-app.mjs";
import { resolveRowIndex } from "../controls/sheet-listener-helpers.mjs";
import { delegate, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

function syncAdvantageDescriptionHiddenInput(sheet, root, index, description) {
  const value = String(description ?? "");
  const roots = new Set([
    root,
    sheet?._getSheetJQ?.()?.[0],
    sheet?.element
  ].filter(Boolean));

  for (const currentRoot of roots) {
    const row = currentRoot.querySelector?.(`.advantage-item[data-advantage-index="${index}"]`);
    const hidden = row?.querySelector?.(".advantage-description-hidden");
    if (!hidden) continue;
    hidden.value = value;
    hidden.defaultValue = value;
  }
}

export function setupSkillAdvantageDescriptionEditors(sheet, html, { enqueueSheetUpdate } = {}) {
  const root = toElement(html);
  if (!root) return;

  const openSkillDescEditor = async (index) => {
    try {
      if (Number.isNaN(index) || index === undefined || index === null) return;

      pcLog.debug("Opening skill description editor for index:", index);
      pcLog.debug("Actor system.skills:", sheet.actor.system.skills);
      pcLog.debug("Skill at index:", sheet.actor.system.skills?.[index]);

      const skillData = sheet.actor.system.skills?.[index] || {};
      const existing = skillData.description || "";
      const skillName = skillData.name || "Skill";

      pcLog.debug("Existing description:", existing);

      renderPeasantDescriptionEditor(sheet, `skill-desc-${index}`, {
        id: `peasant-skill-desc-${sheet.id}-${index}`,
        title: `Skill Description: ${skillName}`,
        editorName: "skillDescription",
        existing,
        documentUuid: sheet.actor?.uuid || "",
        errorLogMessage: "Failed to save skill description:",
        errorMessage: "Failed to save skill description. See console for details.",
        save: async (newContent) => {
          pcLog.debug("Saving skill description, content:", newContent);
          pcLog.debug("Saving skill description, content length:", newContent.length);
          pcLog.debug("Updating actor with skill description for index:", index);

          const result = await sheet.actor.setPeasantSkillDescription?.(index, newContent);
          pcLog.debug("Actor update complete");

          if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
        }
      });
    } catch (e) {
      pcLog.debug("openSkillDescEditor failed", e);
    }
  };

  delegate(root, "click", ".skill-desc-btn", async (ev, button) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      const row = button.closest(".skill-item");
      const index = resolveRowIndex(row, "data-skill-index");
      if (Number.isNaN(index)) return;
      pcLog.debug("Opening skill description editor for index", index);
      await openSkillDescEditor(index);
    } catch (e) {
      pcLog.debug("skill-desc-btn handler failed", e);
    }
  });

  const openAdvantageDescEditor = async (index) => {
    try {
      if (Number.isNaN(index) || index === undefined || index === null) return;

      const advantageEntry = sheet.actor.system.flexibleAdvantages?.[index];
      const advantageName = (typeof advantageEntry === "string"
        ? advantageEntry
        : String(advantageEntry?.name ?? "")
      ).trim() || "Flexible Advantage";
      const existingDescription = String(sheet.actor.system.flexibleAdvantageDescriptions?.[index] ?? "");

      renderPeasantDescriptionEditor(sheet, `advantage-desc-${index}`, {
        id: `peasant-adv-desc-${sheet.id}-${index}`,
        title: `Flexible Advantage Description: ${advantageName}`,
        editorName: "advantageDescription",
        existing: existingDescription,
        documentUuid: sheet.actor?.uuid || "",
        errorLogMessage: "Failed to save flexible advantage description:",
        errorMessage: "Failed to save flexible advantage description. See console for details.",
        save: async (newContent) => {
          const description = String(newContent ?? "");
          syncAdvantageDescriptionHiddenInput(sheet, root, index, description);
          const saveDescription = async () => {
            const result = await sheet.actor.setPeasantFlexibleAdvantageDescription?.(index, description);
            const current = sheet.actor.getPeasantFlexibleAdvantagesForUpdate?.() ?? null;
            if (!current) return result;
            syncAdvantageDescriptionHiddenInput(sheet, root, index, current.descriptions?.[index] ?? description);
            return result;
          };
          const result = enqueueSheetUpdate
            ? await enqueueSheetUpdate("_advantageSaveQueue", "Advantage description", saveDescription)
            : await saveDescription();
          const savedDescriptions = Array.isArray(result?.descriptions)
            ? result.descriptions
            : sheet.actor.system.flexibleAdvantageDescriptions;
          syncAdvantageDescriptionHiddenInput(sheet, root, index, savedDescriptions?.[index] ?? description);
          if (savedDescriptions) {
            sheet._lastFlexibleAdvantageDescriptionsSnapshot = JSON.parse(JSON.stringify(savedDescriptions));
          }
        }
      });
    } catch (e) {
      pcLog.debug("openAdvantageDescEditor failed", e);
    }
  };

  delegate(root, "click", ".advantage-desc-btn", async (ev, button) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      const row = button.closest(".advantage-item");
      const index = resolveRowIndex(row, "data-advantage-index");
      if (Number.isNaN(index)) return;
      await openAdvantageDescEditor(index);
    } catch (e) {
      pcLog.debug("advantage-desc-btn handler failed", e);
    }
  });
}
