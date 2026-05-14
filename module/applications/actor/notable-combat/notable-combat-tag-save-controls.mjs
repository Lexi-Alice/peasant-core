import { collectNotableCombatTagData } from "./notable-combat-tag-data.mjs";

export function setupNotableCombatTagSaveControls(sheet, $container, combatIndex, {
  tagEditor,
  getCombatData,
  openDescriptionEditor,
  onChanged
} = {}) {
  const tagEditorState = tagEditor.state;

  $container.on("click", ".peasant-tag-add", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const tagType = $container.find(".tag-type-select").val();
    if (!tagType) {
      ui.notifications?.warn?.("Please select a tag type first.");
      return;
    }

    if (tagType === "description") {
      openDescriptionEditor?.();
      return;
    }
    const { tagAdded, tagData, warning } = collectNotableCombatTagData($container, tagType, { combatData: getCombatData() });

    if (!tagAdded) {
      ui.notifications?.warn?.(warning);
      return;
    }

    const wasEditingTag = tagEditorState.mode === "edit";
    const actorTagMode = tagType === "custom" && tagEditorState.tagType === "custom" ? tagEditorState.mode : "add";
    const result = await sheet.actor.setPeasantNotableCombatTag(combatIndex, tagType, tagData, {
      mode: actorTagMode,
      customIndex: tagEditorState.customIndex
    });
    if (!result?.changed) {
      ui.notifications?.warn?.("Please enter valid values for the tag.");
      return;
    }

    tagEditor.reset({ clearForm: true });
    onChanged?.();

    ui.notifications?.info?.(wasEditingTag ? "Tag updated successfully." : "Tag added successfully.");
  });
}
