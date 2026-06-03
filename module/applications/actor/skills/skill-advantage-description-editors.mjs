import { renderPeasantDescriptionEditor } from "../controls/description-editor-app.mjs";
import { delegate, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export function setupSkillAdvantageDescriptionEditors(sheet, html) {
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
          const result = await sheet.actor.setPeasantFlexibleAdvantageDescription?.(index, newContent);
          if (result?.flexibleAdvantageDescriptions) {
            sheet._lastFlexibleAdvantageDescriptionsSnapshot = JSON.parse(JSON.stringify(result.flexibleAdvantageDescriptions));
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

function resolveRowIndex(row, attr) {
  const element = toElement(row);
  let index = Number.parseInt(element?.getAttribute(attr), 10);
  if (Number.isNaN(index) && element?.parentElement) index = Array.from(element.parentElement.children).indexOf(element);
  return index;
}
