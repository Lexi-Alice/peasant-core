import { renderPeasantDescriptionEditor } from "../controls/description-editor-app.mjs";
import { getActorSourceSystem, resolveRowIndex } from "../controls/sheet-listener-helpers.mjs";
import { delegate, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";
import { getFlexibleAdvantageDescription } from "../../../data/actor/flexible-advantages.mjs";

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
      const sourceSystem = getActorSourceSystem(sheet.actor);
      pcLog.debug("Actor source skills:", sourceSystem.skills);
      pcLog.debug("Skill at index:", sourceSystem.skills?.[index]);

      const skillData = sourceSystem.skills?.[index] || {};
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

      const sourceSystem = getActorSourceSystem(sheet.actor);
      const advantageEntry = sourceSystem.flexibleAdvantages?.[index];
      const advantageName = (typeof advantageEntry === "string"
        ? advantageEntry
        : String(advantageEntry?.name ?? "")
      ).trim() || "Flexible Advantage";
      const existingDescription = getFlexibleAdvantageDescription(sourceSystem.flexibleAdvantageDescriptions?.[index]);

      renderPeasantDescriptionEditor(sheet, `advantage-desc-${index}`, {
        id: `peasant-adv-desc-${sheet.id}-${index}`,
        title: `Flexible Advantage Description: ${advantageName}`,
        editorName: "advantageDescription",
        existing: existingDescription,
        documentUuid: sheet.actor?.uuid || "",
        errorLogMessage: "Failed to save flexible advantage description:",
        errorMessage: "Description not saved. Your text is still in the editor.",
        save: async (newContent) => {
          const description = String(newContent ?? "");
          const saveDescription = () => sheet.actor.setPeasantFlexibleAdvantageDescription?.(index, description);
          const result = enqueueSheetUpdate
            ? await enqueueSheetUpdate("_advantageSaveQueue", "Advantage description", saveDescription)
            : await saveDescription();
          if (!result?.ok) throw new Error("Flexible Advantage description could not be saved.");
          syncAdvantageDescriptionHiddenInput(sheet, root, index, result.descriptions[index]);
          sheet._lastFlexibleAdvantageDescriptionsSnapshot = [...result.descriptions];
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
