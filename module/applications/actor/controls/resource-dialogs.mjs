export function renderSheetResourceDialog(sheet, key, data, trigger, {
  width = 320,
  height = 220,
  classes = []
} = {}) {
  sheet._pcResourceDialogs ??= {};
  closeSheetResourceDialog(sheet, key);

  const position = typeof sheet._getDialogPositionNearTrigger === "function"
    ? sheet._getDialogPositionNearTrigger(trigger, width, height)
    : { width };

  const dialog = sheet._renderDialog({
    ...data,
    position: data?.position ?? position
  }, {
    classes: Array.from(new Set([
      "peasant-core",
      "pc-resource-dialog",
      ...classes
    ]))
  });

  sheet._pcResourceDialogs[key] = dialog;
  if (typeof dialog?.close === "function") {
    const closeDialog = dialog.close.bind(dialog);
    dialog.close = (...args) => {
      if (sheet._pcResourceDialogs?.[key] === dialog) delete sheet._pcResourceDialogs[key];
      return closeDialog(...args);
    };
  }

  return dialog;
}

export function closeSheetResourceDialog(sheet, key) {
  const dialog = sheet?._pcResourceDialogs?.[key];
  if (!dialog) return;

  try {
    dialog.close?.();
  } catch (e) {
    /* ignore close failures during replacement */
  }

  delete sheet._pcResourceDialogs[key];
}

export function closeSheetResourceDialogs(sheet) {
  const dialogs = sheet?._pcResourceDialogs;
  if (!dialogs) return;

  for (const key of Object.keys(dialogs)) {
    closeSheetResourceDialog(sheet, key);
  }
}
