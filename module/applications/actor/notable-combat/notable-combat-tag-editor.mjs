import { applyInheritedThemeClasses, setupFixedWindowDrag } from "../controls/draggable.mjs";
import { openNotableCombatDescriptionEditor } from "./notable-combat-description-editor.mjs";
import { setupNotableCombatTagEditorDrag } from "./notable-combat-drag-drop.mjs";
import { getActiveNotableCombatEditorTags } from "./notable-combat-tag-display.mjs";
import { setupNotableCombatTagEditorLifecycle } from "./notable-combat-tag-editor-lifecycle.mjs";
import { createNotableCombatTagEditorShell } from "./notable-combat-tag-editor-shell.mjs";
import { createNotableCombatTagEditorState } from "./notable-combat-tag-editor-state.mjs";
import { renderNotableCombatTagInputs } from "./notable-combat-tag-input-helpers.mjs";
import { renderNotableCombatTagList } from "./notable-combat-tag-list.mjs";
import { setupNotableCombatTagRemoveControls } from "./notable-combat-tag-remove-controls.mjs";
import { setupNotableCombatTagSaveControls } from "./notable-combat-tag-save-controls.mjs";
import { setupNotableCombatTagSelectionControls } from "./notable-combat-tag-selection-controls.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export function setupNotableCombatTagEditorControls(sheet, html, {
  sheetDocument = null,
  sheetBody = null
} = {}) {
  html.on("click", ".combat-desc-btn", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      const btn = $(ev.currentTarget);
      const row = btn.closest(".combat-item");
      let index = parseInt(row.attr("data-combat-index"));
      if (Number.isNaN(index)) index = row.index();
      if (Number.isNaN(index)) return;
      await openNotableCombatTagEditor(sheet, index, { sheetDocument, sheetBody });
    } catch (e) {
      pcLog.debug("combat-desc-btn handler failed", e);
    }
  });
}

export async function openNotableCombatTagEditor(sheet, index, {
  sheetDocument = null,
  sheetBody = null
} = {}) {
  try {
    if (Number.isNaN(index) || index === undefined || index === null) return;

    const resolvedDocument = sheetDocument ?? sheet?.element?.[0]?.ownerDocument ?? document;
    const resolvedBody = sheetBody ?? resolvedDocument?.body ?? document.body;
    const containerId = `peasant-combat-tag-${sheet.id}-${index}-container`;

    $(`#${containerId}`).remove();

    const getCombatData = () => sheet.actor.system.notableCombats?.[index] || {};
    const combatName = getCombatData().name || "Combat";
    const $container = createNotableCombatTagEditorShell({ containerId, combatName });

    applyInheritedThemeClasses($container, resolvedBody, sheet);

    $(resolvedBody).append($container);

    const containerEl = $container[0];
    const headerEl = $container.find(".peasant-tag-drag-handle")[0];
    const cleanupTagEditorDrag = setupFixedWindowDrag(containerEl, headerEl, {
      dragDocument: resolvedDocument,
      ignoreSelector: ".peasant-tag-close"
    });

    const openCombatDescEditor = (onSaveCallback) => openNotableCombatDescriptionEditor(sheet, index, {
      sheetDocument: resolvedDocument,
      sheetBody: resolvedBody,
      onSaveCallback
    });

    const tagEditor = createNotableCombatTagEditorState($container);
    const tagEditorState = tagEditor.state;

    const renderCurrentTags = () => {
      const combatData = getCombatData();
      const $list = $container.find(".current-tags-list");
      const activeTags = getActiveNotableCombatEditorTags(combatData);
      renderNotableCombatTagList($list, activeTags);

      setupNotableCombatTagEditorDrag(sheet, $container, index, { onChanged: renderCurrentTags });
    };

    renderCurrentTags();
    tagEditor.syncUi();

    const buildTagInputs = (tagType) => {
      renderNotableCombatTagInputs($container, tagType, getCombatData(), { tagEditorState });
    };

    setupNotableCombatTagSelectionControls($container, {
      tagEditor,
      buildTagInputs,
      openDescriptionEditor: () => openCombatDescEditor(renderCurrentTags)
    });

    setupNotableCombatTagRemoveControls(sheet, $container, index, { onChanged: renderCurrentTags });

    setupNotableCombatTagSaveControls(sheet, $container, index, {
      tagEditor,
      getCombatData,
      openDescriptionEditor: () => openCombatDescEditor(renderCurrentTags),
      onChanged: renderCurrentTags
    });

    setupNotableCombatTagEditorLifecycle($container, {
      sheetDocument: resolvedDocument,
      cleanupDrag: cleanupTagEditorDrag,
      onClose: () => sheet.render(false)
    });
  } catch (e) {
    pcLog.debug("openCombatTagEditor failed", e);
  }
}
