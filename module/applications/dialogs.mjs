function getApplicationElement(appOrElement) {
  if (!appOrElement) return null;
  if (appOrElement?.nodeType === 1 && typeof appOrElement.querySelector === "function") return appOrElement;
  if (appOrElement?.element?.nodeType === 1 && typeof appOrElement.element.querySelector === "function") return appOrElement.element;
  if (appOrElement?.element?.[0]?.nodeType === 1 && typeof appOrElement.element[0].querySelector === "function") return appOrElement.element[0];
  if (appOrElement?.[0]?.nodeType === 1 && typeof appOrElement[0].querySelector === "function") return appOrElement[0];
  return null;
}

function normalizeDialogIcon(icon) {
  if (!icon || typeof icon !== "string") return icon;
  const trimmed = icon.trim();
  const classMatch = trimmed.match(/class\s*=\s*["']([^"']+)["']/i);
  return (classMatch?.[1] || trimmed)
    .replace(/\bfas\b/g, "fa-solid")
    .replace(/\bfar\b/g, "fa-regular")
    .replace(/\bfab\b/g, "fa-brands");
}

export function renderDialogV2(data, options = {}) {
  const DialogV2Class = foundry?.applications?.api?.DialogV2;

  if (!DialogV2Class) {
    throw new Error("Peasant Core requires Foundry's DialogV2.");
  }

  const configuredButtons = Object.entries(data?.buttons ?? {}).map(([action, button]) => ({
    action,
    label: button?.label ?? action,
    icon: normalizeDialogIcon(button?.icon),
    class: button?.cssClass,
    default: data?.default === action,
    callback: async (event, buttonEl, dialogApp) => {
      if (typeof button?.callback !== "function") return action;
      const dialogElement = getApplicationElement(dialogApp)
        ?? buttonEl?.closest?.(".application, dialog")
        ?? null;
      const jq = dialogElement ? $(dialogElement) : $(buttonEl?.form ?? buttonEl);
      return button.callback(jq);
    }
  }));

  const buttons = configuredButtons.length > 0
    ? configuredButtons
    : [{
      action: "close",
      label: game?.i18n?.localize?.("Close") || "Close",
      default: true,
      callback: () => "close"
    }];

  const classes = Array.isArray(options?.classes) ? options.classes.filter(Boolean) : [];
  const position = data?.position ?? options?.position;

  const dialog = new DialogV2Class({
    classes,
    window: {
      title: data?.title ?? "",
      ...(data?.window ?? {})
    },
    content: data?.content ?? "",
    buttons,
    modal: data?.modal ?? false,
    rejectClose: data?.rejectClose ?? false,
    submit: data?.submit ?? (result => result),
    ...(position ? { position } : {})
  });

  const renderOptions = { force: true, ...(options?.render ?? {}) };
  if (options?.window) {
    renderOptions.window = { ...(options.window ?? {}), ...(renderOptions.window ?? {}) };
  }
  const runRender = () => {
    const dialogElement = getApplicationElement(dialog);
    if (!dialogElement) return;
    const jq = $(dialogElement);
    if (typeof data?.render === "function") data.render(jq);
  };

  const renderPromise = typeof options?.parent?.renderChild === "function"
    ? options.parent.renderChild(dialog, renderOptions)
    : dialog.render(renderOptions);

  Promise.resolve(renderPromise)
    .then(runRender)
    .catch((err) => console.error("Peasant Core | Failed to render DialogV2.", err));
  return dialog;
}
