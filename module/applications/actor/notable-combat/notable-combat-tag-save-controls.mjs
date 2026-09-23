import { collectNotableCombatTagData } from "./notable-combat-tag-data.mjs";

export function setupNotableCombatTagSaveControls(sheet, $container, combatIndex, {
  tagEditor,
  getCombatData,
  openDescriptionEditor,
  onChanged,
  saveTag
} = {}) {
  const tagEditorState = tagEditor.state;
  const saveCurrent = async () => {
    const tagType = $container.find(".tag-type-select").val();
    if (!tagType) {
      ui.notifications?.warn?.("Please choose a tag first.");
      return false;
    }

    if (tagType === "description") {
      openDescriptionEditor?.();
      return false;
    }
    const { tagAdded, tagData, warning } = collectNotableCombatTagData($container, tagType, { combatData: getCombatData() });

    if (!tagAdded) {
      ui.notifications?.warn?.(warning);
      return false;
    }

    const wasEditingTag = tagEditorState.mode === "edit";
    const actorTagMode = tagType === "custom" && tagEditorState.tagType === "custom" ? tagEditorState.mode : "add";
    const result = typeof saveTag === "function"
      ? await saveTag(tagType, tagData, {
        mode: actorTagMode,
        customId: tagEditorState.customId,
        customIndex: tagEditorState.customIndex
      })
      : await sheet.actor.setPeasantNotableCombatTag(combatIndex, tagType, tagData, {
        mode: actorTagMode,
        customIndex: tagEditorState.customIndex
      });
    if (!result?.changed) {
      ui.notifications?.warn?.("Please enter valid values for the tag.");
      return false;
    }

    tagEditor.reset({ clearForm: true });
    onChanged?.();

    ui.notifications?.info?.(wasEditingTag ? "Tag updated successfully." : "Tag added successfully.");
    return true;
  };

  $container.on("click", "[data-pc-tag-save]", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await saveCurrent();
  });
  return { saveCurrent };
}
