import { qsa } from "../../dom.mjs";

const TextEditorImplementation = foundry.applications.ux.TextEditor.implementation;

export function hasDescriptionText(description) {
  return !!String(description ?? "").replace(/<[^>]*>/g, "").trim();
}

export async function showReadonlyDescriptionDialog(sheet, { title, description }) {
  if (!hasDescriptionText(description)) return false;
  const enrichedContent = await TextEditorImplementation.enrichHTML(description, { async: true });

  sheet._renderDialog({
    title,
    content: `<div class="pc-readonly-description" style="padding:10px;min-height:100px;color:#e0e0e0;background:transparent;border:1px solid var(--color-border);border-radius:4px;overflow-wrap:anywhere;word-break:break-word;white-space:normal;">${enrichedContent}</div>`,
    position: { width: 720 },
    buttons: {},
    default: null,
    render: (html) => {
      for (const contentEl of qsa(html, ".window-content, .dialog-content")) {
        contentEl.style.overflowX = "hidden";
      }
      for (const descriptionEl of qsa(html, ".pc-readonly-description")) {
        descriptionEl.style.maxHeight = "70vh";
        descriptionEl.style.overflowY = "auto";
      }
    }
  }, { classes: ["pc-readonly-description-dialog"] });

  return true;
}
