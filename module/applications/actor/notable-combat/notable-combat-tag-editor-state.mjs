export function createNotableCombatTagEditorState($container) {
  const state = {
    mode: "add",
    tagType: "",
    customIndex: -1
  };

  const syncUi = () => {
    const isEditing = state.mode === "edit" && !!state.tagType;
    const $addButton = $container.find(".peasant-tag-add");
    const $addLabel = $addButton.find("span").first();
    if ($addLabel.length) $addLabel.text(isEditing ? "Save Tag" : "Add Tag");
    else $addButton.text(isEditing ? "Save Tag" : "Add Tag");
    $container.find(".add-tag-section-label").text(isEditing ? "Edit Tag:" : "Add New Tag:");
  };

  const reset = ({ clearForm = false } = {}) => {
    state.mode = "add";
    state.tagType = "";
    state.customIndex = -1;
    syncUi();
    if (clearForm) {
      $container.find(".tag-type-select").val("");
      $container.find(".tag-input-area").html(`<p style="color:#666;font-style:italic;font-size:12px;">Select a tag type above.</p>`);
    }
  };

  const beginEdit = (tagType, customIndex = -1) => {
    state.mode = "edit";
    state.tagType = String(tagType || "");
    state.customIndex = Number.isInteger(customIndex) ? customIndex : parseInt(customIndex, 10);
    if (Number.isNaN(state.customIndex)) state.customIndex = -1;
    syncUi();
  };

  const setTagType = (tagType) => {
    state.tagType = String(tagType || "");
  };

  return { state, syncUi, reset, beginEdit, setTagType };
}
