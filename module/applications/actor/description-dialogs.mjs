const TextEditorImplementation = foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;

export function hasDescriptionText(description) {
  return !!String(description ?? "").replace(/<[^>]*>/g, "").trim();
}

export async function showReadonlyDescriptionDialog(sheet, { title, description }) {
  if (!hasDescriptionText(description)) return false;
  const enrichedContent = await TextEditorImplementation.enrichHTML(description, { async: true });

  sheet._renderDialog({
    title,
    content: `<div class="pc-readonly-description" style="padding:10px;min-height:100px;color:#e0e0e0;background:var(--background);border:1px solid var(--color-border);border-radius:4px;overflow-wrap:anywhere;word-break:break-word;white-space:normal;">${enrichedContent}</div>`,
    position: { width: 720 },
    buttons: {},
    default: null,
    render: (html) => {
      html.find(".window-content, .dialog-content").css({ overflowX: "hidden" });
      html.find(".pc-readonly-description").css({ maxHeight: "70vh", overflowY: "auto" });
    }
  }, { classes: ["pc-readonly-description-dialog"] });

  return true;
}
