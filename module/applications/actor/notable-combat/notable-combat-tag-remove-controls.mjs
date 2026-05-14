export function setupNotableCombatTagRemoveControls(sheet, $container, combatIndex, { onChanged } = {}) {
  const removeNotableCombatTag = async (buttonEl) => {
    setRemoveButtonChipDraggable(buttonEl, true);

    try {
      const $button = $(buttonEl);
      const tagType = $button.data("tag-type");
      const rawCustomIndex = $button.data("custom-index");
      const customIndex = Number.isInteger(rawCustomIndex) ? rawCustomIndex : parseInt(rawCustomIndex, 10);
      if (!tagType) return;

      const result = await sheet.actor.removePeasantNotableCombatTag?.(combatIndex, tagType, { customIndex });
      if (result?.changed) onChanged?.();
    } catch (err) {
      console.error("Failed to remove notable combat tag:", err);
      ui.notifications?.error?.("Failed to remove tag. See console for details.");
    }
  };

  $container.on("pointerdown", ".remove-tag-btn", async (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    setRemoveButtonChipDraggable(ev.currentTarget, false);
    ev.stopPropagation();
    await removeNotableCombatTag(ev.currentTarget);
  });

  $container.on("pointerup mouseup pointercancel mouseleave blur", ".remove-tag-btn", (ev) => {
    setRemoveButtonChipDraggable(ev.currentTarget, true);
  });

  $container.on("dragstart", ".remove-tag-btn", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });

  $container.on("click", ".remove-tag-btn", async (ev) => {
    const detail = ev.originalEvent?.detail ?? ev.detail ?? 0;
    if (detail > 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    await removeNotableCombatTag(ev.currentTarget);
  });
}

function setRemoveButtonChipDraggable(buttonEl, enabled) {
  const chipEl = buttonEl?.closest?.(".editor-tag-draggable");
  if (!chipEl) return;
  chipEl.draggable = !!enabled;
  if (enabled) {
    chipEl.removeAttribute("data-remove-pressed");
  } else {
    chipEl.setAttribute("data-remove-pressed", "true");
  }
}
