import { renderPeasantDescriptionEditor } from "../controls/description-editor-app.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export async function openNotableCombatDescriptionEditor(sheet, index, { onSaveCallback } = {}) {
  try {
    if (Number.isNaN(index) || index === undefined || index === null) return;

    const combatData = sheet.actor.system.notableCombats?.[index] || {};
    const existing = combatData.description || "";
    const combatName = combatData.name || "Combat";

    return renderPeasantDescriptionEditor(sheet, `combat-desc-${index}`, {
      id: `peasant-combat-desc-${sheet.id}-${index}`,
      title: `Combat Description: ${combatName}`,
      editorName: "combatDescription",
      existing,
      documentUuid: sheet.actor?.uuid || "",
      errorLogMessage: "Failed to save combat description:",
      errorMessage: "Failed to save combat description. See console for details.",
      save: async (newContent) => {
        await sheet.actor.setPeasantNotableCombatDescription?.(index, newContent);
        if (typeof onSaveCallback === "function") onSaveCallback();
      }
    });
  } catch (e) {
    pcLog.debug("openCombatDescEditor failed", e);
  }
}
