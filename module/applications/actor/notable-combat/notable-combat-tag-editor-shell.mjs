import { escapeHtml } from "../../../utils/chat.mjs";

export function createNotableCombatTagEditorShell({ containerId, combatName }) {
  return $(`
    <div id="${containerId}" class="peasant-skill-floating application window-app peasant-core peasant-tag-editor" style="position:fixed;top:10%;left:50%;transform:translateX(-50%);width:480px;max-width:95%;z-index:4000;background:#1a1a1a;border:1px solid #444;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.7);overflow:visible;max-height:80vh;display:flex;flex-direction:column;">
      <header class="window-header flexrow peasant-tag-drag-handle peasant-tag-header">
        <h4 class="window-title popup-handle-title">Combat Tags: ${escapeHtml(combatName)}</h4>
        <button type="button" class="peasant-tag-close header-control icon fa-solid fa-xmark" title="Close" aria-label="Close"></button>
      </header>
      <div class="window-content" style="padding:12px;background:#1a1a1a;overflow-y:auto;flex:1;">
        <div class="current-tags-section" style="margin-bottom:16px;">
          <label style="color:#aaa;display:block;margin-bottom:8px;font-size:12px;font-weight:bold;">Current Tags:</label>
          <div class="current-tags-list" style="display:flex;flex-wrap:wrap;gap:4px;min-height:24px;"></div>
        </div>

        <hr style="border:none;border-top:1px solid #444;margin:12px 0;">

        <div class="add-tag-section">
          <label class="add-tag-section-label" style="color:#aaa;display:block;margin-bottom:8px;font-size:12px;font-weight:bold;">Add New Tag:</label>
          <div class="form-group" style="margin-bottom:12px;">
            <select class="tag-type-select" style="width:100%;padding:6px;background:#2a2a2a;border:1px solid #555;border-radius:4px;color:#e0e0e0;">
              <option value="">-- Choose a tag type --</option>
              <option value="description">Description</option>
              <option value="resourceCosts">Resource Costs</option>
              <option value="speed">Speed</option>
              <option value="range">Range</option>
              <option value="rangeRate">Range-Rate</option>
              <option value="damage">Damage</option>
              <option value="heal">Heal</option>
              <option value="manifest">Manifest</option>
              <option value="tagUses">Uses</option>
              <option value="sections">Sections</option>
              <option value="aoe">AoE</option>
              <option value="targetingType">Targeting Type</option>
              <option value="defense">Defense</option>
              <option value="reach">Reach</option>
              <option value="stability">Stability</option>
              <option value="strengthen">Strengthen</option>
              <option value="custom">Custom</option>
              <option value="self">Self</option>
            </select>
          </div>
          <div class="tag-input-area" style="min-height:40px;"></div>
        </div>
      </div>
      <footer class="window-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--pc-accent-border, var(--color-light-5, #9f8475));background:var(--background);border-radius:0 0 8px 8px;flex-shrink:0;">
        <button type="button" class="peasant-tag-add" style="background:#16a34a;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Add Tag</button>
        <button type="button" class="peasant-tag-done" style="background:#555;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;">Done</button>
      </footer>
    </div>
  `);
}
