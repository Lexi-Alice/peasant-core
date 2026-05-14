import { setupFixedWindowDrag } from "../controls/draggable.mjs";
import { escapeHtml } from "../../../utils/chat.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export function setupSkillAdvantageDescriptionEditors(sheet, html, { sheetDocument, sheetBody } = {}) {
  const doc = sheetDocument ?? sheet?._getElementDocument?.(html?.[0]) ?? document;
  const body = sheetBody ?? doc?.body ?? document.body;

  const openSkillDescEditor = async (index) => {
    try {
      if (Number.isNaN(index) || index === undefined || index === null) return;

      pcLog.debug("Opening skill description editor for index:", index);
      pcLog.debug("Actor system.skills:", sheet.actor.system.skills);
      pcLog.debug("Skill at index:", sheet.actor.system.skills?.[index]);

      const skillData = sheet.actor.system.skills?.[index] || {};
      const existing = skillData.description || "";
      const skillName = skillData.name || "Skill";

      pcLog.debug("Existing description:", existing);

      const containerId = `peasant-skill-desc-${sheet.id}-${index}-container`;
      const editorId = `peasant-skill-desc-${sheet.id}-${index}`;

      $(`#${containerId}`).remove();
      const $container = $(`
        <div id="${containerId}" class="peasant-skill-floating app window-app application peasant-core" style="position:fixed;top:15%;left:50%;transform:translateX(-50%);width:580px;max-width:90%;z-index:4000;background:#1a1a1a;border:1px solid #444;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.7);overflow:visible;">
          <header class="window-header flexrow peasant-skill-drag-handle peasant-desc-header">
            <h4 class="window-title popup-handle-title">Skill Description: ${escapeHtml(skillName)}</h4>
            <button type="button" class="peasant-skill-close header-control icon fa-solid fa-xmark" title="Close" aria-label="Close"></button>
          </header>
          <div class="window-content" style="padding:12px;background:#1a1a1a;">
            <div class="form-group">
              <prose-mirror name="skillDescription" class="inventory-editor peasant-desc-editor" data-document-uuid="${sheet.actor?.uuid || ""}"></prose-mirror>
            </div>
          </div>
          <footer class="window-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid #333;background:#222;border-radius:0 0 8px 8px;">
            <button type="button" class="peasant-skill-save" style="background:#16a34a;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Save</button>
            <button type="button" class="peasant-skill-cancel" style="background:#8b0000;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;">Cancel</button>
          </footer>
        </div>
      `);

      $(body).append($container);

      const containerEl = $container[0];
      const headerEl = $container.find(".peasant-skill-drag-handle")[0];
      const cleanupSkillDrag = setupFixedWindowDrag(containerEl, headerEl, {
        dragDocument: doc,
        ignoreSelector: ".peasant-skill-close"
      });

      const proseMirrorEl = $container.find('prose-mirror[name="skillDescription"]')[0];
      if (proseMirrorEl && (typeof proseMirrorEl.value !== "undefined")) {
        proseMirrorEl.value = existing;
      } else {
        const $fallback = $(`<textarea id="${editorId}-fallback" style="width:100%;height:280px;background:transparent;color:#e0e0e0;border:none;padding:10px;border-radius:0;resize:vertical;font-family:inherit;">${escapeHtml(existing)}</textarea>`);
        $container.find(".form-group").empty().append($fallback);
      }

      $container.on("click", ".peasant-skill-save", async (ev) => {
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
          console.warn("Error getting editor content:", getContentErr);
          const $fallback = $container.find(`#${editorId}-fallback`);
          if ($fallback.length) newContent = String($fallback.val() || "");
        }

        pcLog.debug("Saving skill description, content:", newContent);
        pcLog.debug("Saving skill description, content length:", newContent.length);

        try {
          pcLog.debug("Updating actor with skill description for index:", index);
          const result = await sheet.actor.setPeasantSkillDescription?.(index, newContent);
          pcLog.debug("Actor update complete");

          if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
        } catch (saveErr) {
          console.error("Failed to save skill description:", saveErr);
          ui.notifications?.error?.("Failed to save skill description. See console for details.");
        }

        cleanupSkillDrag();
        $container.remove();
        sheet.render(false);
      });

      $container.on("click", ".peasant-skill-cancel", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        cleanupSkillDrag();
        $container.remove();
      });

      $container.on("click", ".peasant-skill-close", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        cleanupSkillDrag();
        $container.remove();
      });

      const escHandler = (ev) => {
        if (ev.key === "Escape") {
          cleanupSkillDrag();
          $container.remove();
          doc.removeEventListener("keydown", escHandler);
        }
      };
      doc.addEventListener("keydown", escHandler);
    } catch (e) {
      pcLog.debug("openSkillDescEditor failed", e);
    }
  };

  html.on("click", ".skill-desc-btn", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      const btn = $(ev.currentTarget);
      const row = btn.closest(".skill-item");
      const index = resolveRowIndex(row, "data-skill-index");
      if (Number.isNaN(index)) return;
      pcLog.debug("Opening skill description editor for index", index);
      await openSkillDescEditor(index);
    } catch (e) {
      pcLog.debug("skill-desc-btn handler failed", e);
    }
  });

  try {
    html.find(".skill-desc-btn").off("click").click((ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
        const btn = $(ev.currentTarget);
        const row = btn.closest(".skill-item");
        const index = resolveRowIndex(row, "data-skill-index");
        if (Number.isNaN(index)) return;
        openSkillDescEditor(index);
      } catch (e) {
        pcLog.debug("fallback skill-desc click failed", e);
      }
    });
  } catch (e) {
    /* ignore */
  }

  const openAdvantageDescEditor = async (index) => {
    try {
      if (Number.isNaN(index) || index === undefined || index === null) return;

      const advantageEntry = sheet.actor.system.flexibleAdvantages?.[index];
      const advantageName = (typeof advantageEntry === "string"
        ? advantageEntry
        : String(advantageEntry?.name ?? "")
      ).trim() || "Flexible Advantage";
      const existingDescription = String(sheet.actor.system.flexibleAdvantageDescriptions?.[index] ?? "");

      const containerId = `peasant-adv-desc-${sheet.id}-${index}-container`;
      const editorId = `peasant-adv-desc-${sheet.id}-${index}`;
      $(`#${containerId}`).remove();

      const $container = $(`
        <div id="${containerId}" class="peasant-skill-floating app window-app application peasant-core" style="position:fixed;top:15%;left:50%;transform:translateX(-50%);width:580px;max-width:90%;z-index:4000;background:#1a1a1a;border:1px solid #444;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.7);overflow:visible;">
          <header class="window-header flexrow peasant-skill-drag-handle peasant-desc-header">
            <h4 class="window-title popup-handle-title">Flexible Advantage Description: ${escapeHtml(advantageName)}</h4>
            <button type="button" class="peasant-skill-close header-control icon fa-solid fa-xmark" title="Close" aria-label="Close"></button>
          </header>
          <div class="window-content" style="padding:12px;background:#1a1a1a;">
            <div class="form-group">
              <prose-mirror name="advantageDescription" class="inventory-editor peasant-desc-editor" data-document-uuid="${sheet.actor?.uuid || ""}"></prose-mirror>
            </div>
          </div>
          <footer class="window-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid #333;background:#222;border-radius:0 0 8px 8px;">
            <button type="button" class="peasant-skill-save" style="background:#16a34a;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Save</button>
            <button type="button" class="peasant-skill-cancel" style="background:#8b0000;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;">Cancel</button>
          </footer>
        </div>
      `);

      const $popupHost = getApplicationJQuery(sheet);
      const $host = $popupHost.length ? $popupHost : $(body);
      $host.append($container);

      const containerEl = $container[0];
      const headerEl = $container.find(".peasant-skill-drag-handle")[0];
      const cleanupAdvantageDrag = setupFixedWindowDrag(containerEl, headerEl, {
        dragDocument: doc,
        ignoreSelector: ".peasant-skill-close"
      });

      const proseMirrorEl = $container.find('prose-mirror[name="advantageDescription"]')[0];
      if (proseMirrorEl && (typeof proseMirrorEl.value !== "undefined")) {
        proseMirrorEl.value = existingDescription;
      } else {
        const $fallback = $(`<textarea id="${editorId}-fallback" style="width:100%;height:280px;background:transparent;color:#e0e0e0;border:none;padding:10px;border-radius:0;resize:vertical;font-family:inherit;">${escapeHtml(existingDescription)}</textarea>`);
        $container.find(".form-group").empty().append($fallback);
      }

      let escHandler = null;
      const cleanup = () => {
        if (escHandler) {
          doc.removeEventListener("keydown", escHandler);
          escHandler = null;
        }
        cleanupAdvantageDrag();
        $container.remove();
      };

      $container.on("click", ".peasant-skill-save", async (ev) => {
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
          console.warn("Error getting advantage description content:", getContentErr);
        }

        try {
          await sheet.actor.setPeasantFlexibleAdvantageDescription?.(index, newContent);

          const row = getSheetJQ(sheet).find(`.advantage-item[data-advantage-index="${index}"]`);
          row.find(".advantage-description-hidden").val(newContent);
        } catch (saveErr) {
          console.error("Failed to save flexible advantage description:", saveErr);
          ui.notifications?.error?.("Failed to save flexible advantage description.");
        }

        cleanup();
        sheet.render(false);
      });

      $container.on("click", ".peasant-skill-cancel", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        cleanup();
      });

      $container.on("click", ".peasant-skill-close", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        cleanup();
      });

      escHandler = (ev) => {
        if (ev.key === "Escape") cleanup();
      };
      doc.addEventListener("keydown", escHandler);
    } catch (e) {
      pcLog.debug("openAdvantageDescEditor failed", e);
    }
  };

  html.on("click", ".advantage-desc-btn", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      const btn = $(ev.currentTarget);
      const row = btn.closest(".advantage-item");
      const index = resolveRowIndex(row, "data-advantage-index");
      if (Number.isNaN(index)) return;
      await openAdvantageDescEditor(index);
    } catch (e) {
      pcLog.debug("advantage-desc-btn handler failed", e);
    }
  });
}

function resolveRowIndex(row, attr) {
  let index = parseInt(row.attr(attr));
  if (Number.isNaN(index)) index = row.index();
  return index;
}

function getApplicationElement(appOrElement) {
  const source = appOrElement?.element ?? appOrElement;
  if (!source) return null;
  if (source.nodeType === 1 && typeof source.querySelector === "function") return source;
  if (source instanceof jQuery) return source[0] ?? null;
  if (Array.isArray(source)) return getApplicationElement(source[0]);
  const first = source?.[0];
  return first?.nodeType === 1 && typeof first.querySelector === "function" ? first : null;
}

function getApplicationJQuery(appOrElement) {
  const element = getApplicationElement(appOrElement);
  return element ? $(element) : $();
}

function getSheetJQ(sheet) {
  try {
    const jq = sheet?._getSheetJQ?.();
    if (jq?.length) return jq;
  } catch (e) {
    /* ignore */
  }
  return sheet?.element ?? $();
}
