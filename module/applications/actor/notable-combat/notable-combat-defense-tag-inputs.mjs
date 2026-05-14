import {
  COMBAT_DEFENSE_BLOCK_TYPES,
  COMBAT_DEFENSE_RESPONSE_OPTIONS,
  getCombatDefenseResponseKey,
  normalizeCombatDefense,
  normalizeCombatDefenseEffectivenessEntry,
  parseCombatDefenseMosPer
} from "../../../data/actor/combat-defense.mjs";
import { escapeHtml } from "../../../utils/chat.mjs";

export function renderDefenseTagInputs($area, combatData, { inputStyle, selectStyle } = {}) {
  const defenseData = normalizeCombatDefense(combatData.defense);
  const isBlock = !!defenseData.block;
  const responseOptionsHtml = COMBAT_DEFENSE_RESPONSE_OPTIONS.map((option) => `
    <div class="defense-response-option">
      <div class="defense-checkbox-cell" style="flex: 0 0 24px; text-align: center; display: flex; align-items: center; justify-content: center;">
        <input type="checkbox" class="tag-defense-response" data-defense-key="${option.key}" ${defenseData.responses.includes(option.label) ? "checked" : ""}>
      </div>
      <span>${option.label}</span>
    </div>
  `).join("");

  $area.html(`
    <div class="defense-tag-editor">
      <div class="defense-section">
        <div class="defense-section-label">Can respond to?</div>
        <div class="defense-response-list">${responseOptionsHtml}</div>
      </div>
      <div class="defense-section">
        <div class="defense-section-label">Effectiveness vs?</div>
        <div class="defense-effectiveness-grid">
          <div class="defense-effectiveness-head">Targeting Type</div>
          <div class="defense-effectiveness-head">MoS Per</div>
          <div class="defense-effectiveness-head">Accuracy Penalty</div>
          <div class="defense-effectiveness-rows"></div>
        </div>
      </div>
      <div class="defense-section">
        <div class="defense-toggle-row">
          <span>Block?</span>
          <div class="defense-checkbox-cell" style="flex: 0 0 24px; text-align: center; display: flex; align-items: center; justify-content: center;">
            <input type="checkbox" class="tag-defense-block" ${isBlock ? "checked" : ""}>
          </div>
        </div>
        <div class="defense-structure-fields" style="display:${isBlock ? "grid" : "none"};">
          <label class="defense-inline-field" style="grid-column: 1 / -1;">
            <span>Type</span>
            <select class="tag-defense-block-type" style="${selectStyle}width:140px;">
              ${COMBAT_DEFENSE_BLOCK_TYPES.map((blockType) => `<option value="${escapeHtml(blockType)}" ${defenseData.blockType === blockType ? "selected" : ""}>${escapeHtml(blockType)}</option>`).join("")}
            </select>
          </label>
          <label class="defense-inline-field defense-hardness-field" style="display:${defenseData.blockType === "Mage" ? "none" : "flex"};">
            <span class="defense-hardness-label" style="display:${defenseData.blockType === "Mage" ? "none" : "inline"};">Hardness</span>
            <input type="number" class="tag-defense-hardness" value="${defenseData.hardness || ""}" style="${inputStyle}width:72px; display:${defenseData.blockType === "Mage" ? "none" : "inline-block"};" min="0" step="1" placeholder="0">
          </label>
          <label class="defense-inline-field">
            <span>HP</span>
            <input type="number" class="tag-defense-hp" value="${defenseData.hp || ""}" style="${inputStyle}width:72px;" min="0" step="1" placeholder="0">
          </label>
        </div>
      </div>
      <div class="defense-section">
        <div class="defense-toggle-row">
          <span>Applies debuff?</span>
          <div class="defense-checkbox-cell" style="flex: 0 0 24px; text-align: center; display: flex; align-items: center; justify-content: center;">
            <input type="checkbox" class="tag-defense-applies-debuff" ${defenseData.appliesDebuff ? "checked" : ""}>
          </div>
        </div>
        <div class="defense-debuff-fields" style="display:${defenseData.appliesDebuff ? "block" : "none"};">
          <label class="defense-inline-field" style="margin-top:10px; justify-content:flex-start;">
            <span>To-Hit</span>
            <input type="number" class="tag-defense-debuff-tohit" value="${defenseData.debuffToHit || ""}" style="${inputStyle}width:72px;" step="1" placeholder="0">
          </label>
          <div class="defense-toggle-row defense-inline-toggle-row" style="margin-top:10px;">
            <span>Applies before?</span>
            <div class="defense-checkbox-cell" style="flex: 0 0 24px; text-align: center; display: flex; align-items: center; justify-content: center;">
              <input type="checkbox" class="tag-defense-applies-before" ${defenseData.appliesBefore ? "checked" : ""}>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  let defenseState = normalizeCombatDefense(defenseData);

  const captureDefenseEffectivenessRows = () => {
    for (const option of COMBAT_DEFENSE_RESPONSE_OPTIONS) {
      const $row = $area.find(`.defense-effectiveness-row[data-defense-key="${option.key}"]`);
      if (!$row.length) continue;
      defenseState.effectiveness[option.key] = {
        mosPer: parseCombatDefenseMosPer($row.find(".tag-defense-mos-per").val()),
        accuracyPenalty: Number.parseInt($row.find(".tag-defense-accuracy-penalty").val(), 10) || 0
      };
    }
  };

  const getSelectedDefenseResponses = () => COMBAT_DEFENSE_RESPONSE_OPTIONS
    .filter((option) => $area.find(`.tag-defense-response[data-defense-key="${option.key}"]`).is(":checked"))
    .map((option) => option.label);

  const renderDefenseEffectivenessRows = () => {
    captureDefenseEffectivenessRows();
    defenseState.responses = getSelectedDefenseResponses();
    const $rows = $area.find(".defense-effectiveness-rows");

    if (defenseState.responses.length === 0) {
      $rows.html(`
        <div class="defense-effectiveness-empty">
          Select at least one targeting type above.
        </div>
      `);
      return;
    }

    const rowsHtml = defenseState.responses.map((label) => {
      const key = getCombatDefenseResponseKey(label);
      const entry = normalizeCombatDefenseEffectivenessEntry(defenseState.effectiveness[key]);
      return `
        <div class="defense-effectiveness-row" data-defense-key="${key}">
          <div class="defense-effectiveness-type">${label}</div>
          <input type="number" class="tag-defense-mos-per" value="${entry.mosPer || ""}" style="${inputStyle}width:88px;" step="0.25" min="0" placeholder="0">
          <input type="number" class="tag-defense-accuracy-penalty" value="${entry.accuracyPenalty || ""}" style="${inputStyle}width:110px;" step="1" placeholder="0">
        </div>
      `;
    }).join("");

    $rows.html(rowsHtml);
  };

  const updateDefenseStructureVisibility = () => {
    const blockSelected = !!$area.find(".tag-defense-block").is(":checked");
    $area.find(".defense-structure-fields").toggle(blockSelected);
    if (!blockSelected) return;
    const blockType = String($area.find(".tag-defense-block-type").val() || "Shield").trim();
    const isMage = blockType === "Mage";
    $area.find(".defense-hardness-field").css("display", isMage ? "none" : "flex");
  };

  const updateDefenseDebuffVisibility = () => {
    const appliesDebuff = !!$area.find(".tag-defense-applies-debuff").is(":checked");
    $area.find(".defense-debuff-fields").toggle(appliesDebuff);
  };

  $area.off(".defenseTagEditor");
  $area.on("change.defenseTagEditor", ".tag-defense-response", () => {
    renderDefenseEffectivenessRows();
  });
  $area.on("input.defenseTagEditor change.defenseTagEditor", ".tag-defense-mos-per, .tag-defense-accuracy-penalty", () => {
    captureDefenseEffectivenessRows();
  });
  $area.on("change.defenseTagEditor", ".tag-defense-block", () => {
    updateDefenseStructureVisibility();
  });
  $area.on("change.defenseTagEditor", ".tag-defense-block-type", () => {
    updateDefenseStructureVisibility();
  });
  $area.on("change.defenseTagEditor", ".tag-defense-applies-debuff", () => {
    updateDefenseDebuffVisibility();
  });
  $area.on("mousedown.defenseTagEditor", ".tag-defense-response, .tag-defense-block, .tag-defense-applies-before, .tag-defense-applies-debuff", (ev) => {
    // Match the sheet's feel more closely by preventing mouse clicks from leaving
    // the checkbox focused, which causes the persistent highlight in this popup.
    if (ev.button === 0) ev.preventDefault();
  });

  renderDefenseEffectivenessRows();
  updateDefenseStructureVisibility();
  updateDefenseDebuffVisibility();
}
