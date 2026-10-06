import { delegate, qs, qsa, toElement } from "../../dom.mjs";

export function setupNotableCombatTagSelectionControls(container, {
  tagEditor,
  buildTagInputs,
  openDescriptionEditor,
  onBeginEdit,
  onCancel,
  beforeSelect
} = {}) {
  const root = toElement(container);
  if (!root) return;

  const tagEditorState = tagEditor.state;

  const setTagOptionsOpen = (open) => {
    const search = qs(root, "[data-pc-tag-search]");
    const options = qs(root, "[data-pc-tag-options]");
    if (options) options.hidden = !open;
    search?.setAttribute?.("aria-expanded", open ? "true" : "false");
  };

  const filterTagOptions = () => {
    const search = qs(root, "[data-pc-tag-search]");
    const query = String(search?.value ?? "").trim().toLocaleLowerCase();
    const options = qsa(root, "[data-pc-tag-option]");
    let visibleCount = 0;
    for (const option of options) {
      option.hidden = !!query && !option.textContent.toLocaleLowerCase().includes(query);
      option.classList?.remove?.("selected");
      if (!option.hidden) visibleCount += 1;
    }
    const firstVisible = options.find(option => !option.hidden);
    firstVisible?.classList?.add?.("selected");
    const empty = qs(root, "[data-pc-tag-empty]");
    if (empty) empty.hidden = visibleCount > 0;
  };

  const applyTagType = async (tagType) => {
    if (beforeSelect && !await beforeSelect()) return;
    if (!tagType) {
      tagEditor.reset();
      buildTagInputs(tagType);
      onCancel?.();
      return;
    }
    const existing = (tagType === "custom"
      ? null
      : qsa(root, ".current-tag-item").find(item =>
        !item.hasAttribute?.("data-pc-tag-provisional") && item.dataset.tagType === tagType
      )) ?? null;
    if (existing) {
      tagEditor.beginEdit(tagType, -1, "");
    } else if (tagType === "custom" || !(tagEditorState.mode === "edit" && tagEditorState.tagType === tagType)) {
      tagEditor.reset();
      tagEditor.setTagType(tagType);
    }
    buildTagInputs(tagType);
    const option = qsa(root, "[data-pc-tag-option]").find(item => item.dataset.tagType === tagType);
    onBeginEdit?.(existing, { tagType, label: option?.textContent?.trim?.() || tagType });
  };

  delegate(root, "change", ".tag-type-select", (ev, select) => {
    applyTagType(select.value);
  });

  const openTagOptions = () => {
    filterTagOptions();
    setTagOptionsOpen(true);
  };

  delegate(root, "focusin", "[data-pc-tag-search]", openTagOptions);
  delegate(root, "click", "[data-pc-tag-search]", openTagOptions);

  delegate(root, "input", "[data-pc-tag-search]", () => {
    const selectedType = qs(root, ".tag-type-select");
    if (selectedType?.value) {
      selectedType.value = "";
      applyTagType("");
    }
    filterTagOptions();
    setTagOptionsOpen(true);
  });

  const chooseTagOption = (option) => {
    const tagType = String(option.dataset.tagType || "").trim();
    if (!tagType) return;
    const search = qs(root, "[data-pc-tag-search]");
    const selectedType = qs(root, ".tag-type-select");
    if (search) search.value = option.textContent.trim();
    if (selectedType) selectedType.value = tagType;
    setTagOptionsOpen(false);
    applyTagType(tagType);
  };

  delegate(root, "click", "[data-pc-tag-option]", (ev, option) => {
    ev.preventDefault();
    ev.stopPropagation();
    chooseTagOption(option);
  });

  delegate(root, "mousedown", "[data-pc-tag-option]", (ev) => {
    ev.preventDefault();
  });

  delegate(root, "focusout", "[data-pc-tag-search]", (ev, search) => {
    const combobox = search.closest?.("[data-pc-tag-combobox]");
    if (combobox?.contains?.(ev.relatedTarget)) return;
    setTagOptionsOpen(false);
  });

  delegate(root, "keydown", "[data-pc-tag-search]", (ev) => {
    const optionList = qs(root, "[data-pc-tag-options]");
    if (optionList?.hidden) return;
    const options = qsa(root, "[data-pc-tag-option]").filter(option => !option.hidden);
    const selectedIndex = options.findIndex(option => option.classList?.contains?.("selected"));
    switch (ev.key) {
      case "ArrowUp":
      case "ArrowDown": {
        if (!options.length) return;
        ev.preventDefault();
        const direction = ev.key === "ArrowUp" ? -1 : 1;
        const nextIndex = (selectedIndex + direction + options.length) % options.length;
        options.forEach(option => option.classList?.remove?.("selected"));
        options[nextIndex]?.classList?.add?.("selected");
        options[nextIndex]?.scrollIntoView?.({ block: "nearest" });
        break;
      }
      case "Enter": {
        const selected = options[selectedIndex];
        if (!selected) return;
        ev.preventDefault();
        chooseTagOption(selected);
        break;
      }
      case "Escape":
        ev.preventDefault();
        ev.stopPropagation();
        setTagOptionsOpen(false);
        break;
      case "Tab":
        setTagOptionsOpen(false);
        break;
    }
  });

  const beginTagEdit = async (ev, item) => {
    if (ev.target?.closest?.(".remove-tag-btn")) return;
    ev.preventDefault();
    ev.stopPropagation();
    const tagKey = item?.dataset?.tagKey;
    if (beforeSelect && !await beforeSelect()) return;
    item = qsa(root, ".current-tag-item").find(row => row.dataset.tagKey === tagKey) ?? item;

    if (ev.type === "click" && item.nextElementSibling?.matches?.("[data-pc-tag-draft]:not([hidden])")) {
      tagEditor.reset({ clearForm: true });
      onCancel?.();
      return;
    }

    const tagType = String(item.dataset.tagType || "").trim();
    if (!tagType) return;
    if (tagType === "description") {
      openDescriptionEditor?.();
      return;
    }
    const rawCustomIndex = item.dataset.customIndex;
    const customIndex = Number.isInteger(rawCustomIndex) ? rawCustomIndex : Number.parseInt(rawCustomIndex, 10);
    const customId = String(item.dataset.customId ?? "").trim();

    tagEditor.beginEdit(tagType, customIndex, customId);
    const tagTypeSelect = qs(root, ".tag-type-select");
    if (tagTypeSelect) tagTypeSelect.value = tagType;
    buildTagInputs(tagType);
    onBeginEdit?.(item);

    const focusTarget = qsa(qs(root, ".tag-input-area"), "input, select, textarea").find(element => !element.disabled && isVisible(element));
    focusTarget?.focus?.();
  };

  delegate(root, "contextmenu", ".current-tag-item", beginTagEdit);
  delegate(root, "click", "[data-pc-tag-edit]", (ev, button) => beginTagEdit(ev, button.closest(".current-tag-item")));

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
