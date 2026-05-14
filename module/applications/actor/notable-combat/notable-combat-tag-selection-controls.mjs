export function setupNotableCombatTagSelectionControls($container, { tagEditor, buildTagInputs, openDescriptionEditor } = {}) {
  const tagEditorState = tagEditor.state;

  $container.on("change", ".tag-type-select", (ev) => {
    const tagType = $(ev.currentTarget).val();
    if (!tagType) {
      tagEditor.reset();
      buildTagInputs(tagType);
      return;
    }
    if (!(tagEditorState.mode === "edit" && tagEditorState.tagType === tagType)) {
      tagEditor.reset();
      tagEditor.setTagType(tagType);
    }
    buildTagInputs(tagType);
  });

  $container.on("contextmenu", ".current-tag-item", (ev) => {
    if ($(ev.target).closest(".remove-tag-btn").length) return;
    ev.preventDefault();
    ev.stopPropagation();

    const $item = $(ev.currentTarget);
    const tagType = String($item.data("tag-type") || "").trim();
    if (!tagType) return;
    if (tagType === "description") {
      openDescriptionEditor?.();
      return;
    }
    const rawCustomIndex = $item.data("custom-index");
    const customIndex = Number.isInteger(rawCustomIndex) ? rawCustomIndex : parseInt(rawCustomIndex, 10);

    tagEditor.beginEdit(tagType, customIndex);
    $container.find(".tag-type-select").val(tagType);
    buildTagInputs(tagType);

    const $focusTarget = $container.find(".tag-input-area").find("input, select, textarea").filter(":visible").first();
    if ($focusTarget.length) $focusTarget.trigger("focus");
  });

  $container.on("click", ".edit-description-tag", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openDescriptionEditor?.();
  });
}
