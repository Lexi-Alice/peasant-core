import { setupFixedWindowDrag } from "../controls/draggable.mjs";
import { escapeHtml } from "../../../utils/chat.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export async function openNotableCombatDescriptionEditor(sheet, index, { sheetDocument, sheetBody, onSaveCallback } = {}) {
  try {
    if (Number.isNaN(index) || index === undefined || index === null) return;

    const doc = sheetDocument ?? sheet?._getElementDocument?.(sheet?.element?.[0] ?? sheet?.element) ?? document;
    const body = sheetBody ?? doc?.body ?? document.body;
    const combatData = sheet.actor.system.notableCombats?.[index] || {};
    const existing = combatData.description || "";
    const combatName = combatData.name || "Combat";

    const containerId = `peasant-combat-desc-${sheet.id}-${index}-container`;
    const editorId = `peasant-combat-desc-${sheet.id}-${index}`;

    $(`#${containerId}`).remove();

    const $container = $(`
      <div id="${containerId}" class="peasant-skill-floating app window-app application peasant-core" style="position:fixed;top:15%;left:50%;transform:translateX(-50%);width:580px;max-width:90%;z-index:4000;background:#1a1a1a;border:1px solid #444;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.7);overflow:visible;">
        <header class="window-header flexrow peasant-combat-drag-handle peasant-desc-header">
          <h4 class="window-title popup-handle-title">Combat Description: ${escapeHtml(combatName)}</h4>
          <button type="button" class="peasant-combat-close header-control icon fa-solid fa-xmark" title="Close" aria-label="Close"></button>
        </header>
        <div class="window-content" style="padding:12px;background:#1a1a1a;">
          <div class="form-group">
            <prose-mirror name="combatDescription" class="inventory-editor peasant-desc-editor" data-document-uuid="${sheet.actor?.uuid || ""}"></prose-mirror>
          </div>
        </div>
        <footer class="window-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid #333;background:#222;border-radius:0 0 8px 8px;">
          <button type="button" class="peasant-combat-save" style="background:#16a34a;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Save</button>
          <button type="button" class="peasant-combat-cancel" style="background:#8b0000;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;">Cancel</button>
        </footer>
      </div>
    `);

    $(body).append($container);

    const containerEl = $container[0];
    const headerEl = $container.find(".peasant-combat-drag-handle")[0];
    const cleanupDrag = setupFixedWindowDrag(containerEl, headerEl, {
      dragDocument: doc,
      ignoreSelector: ".peasant-combat-close"
    });

    const proseMirrorEl = $container.find('prose-mirror[name="combatDescription"]')[0];
    if (proseMirrorEl && (typeof proseMirrorEl.value !== "undefined")) {
      proseMirrorEl.value = existing;
    } else {
      const $fallback = $(`<textarea id="${editorId}-fallback" style="width:100%;min-height:200px;background:transparent;color:#e0e0e0;border:none;border-radius:0;padding:8px;resize:vertical;font-family:inherit;">${escapeHtml(existing)}</textarea>`);
      $container.find(".form-group").empty().append($fallback);
    }

    $container.on("click", ".peasant-combat-save", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      let newContent = "";
      try {
        if (proseMirrorEl && (typeof proseMirrorEl.value !== "undefined")) {
          newContent = String(proseMirrorEl.value ?? "");
        } else {
          const $fallback = $container.find(`#${editorId}-fallback`);
          if ($fallback.length) newContent = String($fallback.val() || "");
        }
      } catch (getContentErr) {
        console.warn("Error getting combat editor content:", getContentErr);
        const $fallback = $container.find(`#${editorId}-fallback`);
        if ($fallback.length) newContent = String($fallback.val() || "");
      }

      try {
        await sheet.actor.setPeasantNotableCombatDescription?.(index, newContent);

        if (typeof onSaveCallback === "function") {
          onSaveCallback();
        }
      } catch (saveErr) {
        console.error("Failed to save combat description:", saveErr);
        ui.notifications?.error?.("Failed to save combat description. See console for details.");
      }

      cleanupDrag();
      $container.remove();
      sheet.render(false);
    });

    $container.on("click", ".peasant-combat-cancel", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      cleanupDrag();
      $container.remove();
    });

    $container.on("click", ".peasant-combat-close", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      cleanupDrag();
      $container.remove();
    });

    const escHandler = (ev) => {
      if (ev.key === "Escape") {
        cleanupDrag();
        $container.remove();
        doc.removeEventListener("keydown", escHandler);
      }
    };
    doc.addEventListener("keydown", escHandler);
  } catch (e) {
    pcLog.debug("openCombatDescEditor failed", e);
  }
}
