export function setupNotableCombatTagEditorLifecycle($container, { sheetDocument, cleanupDrag, onClose } = {}) {
  const closeEditor = () => {
    cleanupDrag?.();
    $container.remove();
    sheetDocument?.removeEventListener?.("keydown", escHandler);
    onClose?.();
  };

  function escHandler(ev) {
    if (ev.key === "Escape") closeEditor();
  }

  $container.on("click", ".peasant-tag-done", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeEditor();
  });

  $container.on("click", ".peasant-tag-close", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeEditor();
  });

  sheetDocument?.addEventListener?.("keydown", escHandler);

  return closeEditor;
}
