import { delegate, qs, qsa, toElement } from "../../dom.mjs";

export function setupNotableCombatTagSelectionControls(container, { tagEditor, buildTagInputs, openDescriptionEditor } = {}) {
  const root = toElement(container);
  if (!root) return;

  const tagEditorState = tagEditor.state;

  delegate(root, "change", ".tag-type-select", (ev, select) => {
    const tagType = select.value;
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

  delegate(root, "contextmenu", ".current-tag-item", (ev, item) => {
    if (ev.target?.closest?.(".remove-tag-btn")) return;
    ev.preventDefault();
    ev.stopPropagation();

    const tagType = String(item.dataset.tagType || "").trim();
    if (!tagType) return;
    if (tagType === "description") {
      openDescriptionEditor?.();
      return;
    }
    const rawCustomIndex = item.dataset.customIndex;
    const customIndex = Number.isInteger(rawCustomIndex) ? rawCustomIndex : Number.parseInt(rawCustomIndex, 10);

    tagEditor.beginEdit(tagType, customIndex);
    const tagTypeSelect = qs(root, ".tag-type-select");
    if (tagTypeSelect) tagTypeSelect.value = tagType;
    buildTagInputs(tagType);

    const focusTarget = qsa(qs(root, ".tag-input-area"), "input, select, textarea").find(isVisible);
    focusTarget?.focus?.();
  });

  delegate(root, "click", ".edit-description-tag", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openDescriptionEditor?.();
  });
}

function isVisible(element) {
  if (!element) return false;
  const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  return style?.display !== "none" && style?.visibility !== "hidden";
}
