import {
  COMBAT_DEFENSE_BLOCK_TYPES,
  COMBAT_DEFENSE_RESPONSE_OPTIONS,
  COMBAT_DEFENSE_SHIELD_ARM_OPTIONS,
  getCombatDefenseResponseKey,
  normalizeCombatDefense,
  normalizeCombatDefenseEffectivenessEntry,
  parseCombatDefenseMosPer
} from "../../../data/actor/combat-defense.mjs";
import { escapeHtml } from "../../../utils/chat.mjs";
import {
  PC_TAG_DECIMAL_ATTRS,
  PC_TAG_INPUT_CLASS,
  PC_TAG_INTEGER_ATTRS,
  PC_TAG_SELECT_CLASS
} from "./notable-combat-tag-form-controls.mjs";

export function renderDefenseTagInputs($area, combatData) {
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
            <select class="tag-defense-block-type ${PC_TAG_SELECT_CLASS}" style="width:140px;">
              ${COMBAT_DEFENSE_BLOCK_TYPES.map((blockType) => `<option value="${escapeHtml(blockType)}" ${defenseData.blockType === blockType ? "selected" : ""}>${escapeHtml(blockType)}</option>`).join("")}
            </select>
          </label>
          <label class="defense-inline-field defense-shield-arm-field" style="grid-column: 1 / -1; display:${defenseData.blockType === "Shield" ? "flex" : "none"};">
            <span>Shield Arm</span>
            <select class="tag-defense-shield-arm ${PC_TAG_SELECT_CLASS}" style="width:140px;">
              ${COMBAT_DEFENSE_SHIELD_ARM_OPTIONS.map((option) => `<option value="${escapeHtml(option.key)}" ${defenseData.shieldArm === option.key ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
          <label class="defense-inline-field defense-hardness-field" style="display:${defenseData.blockType === "Shield" || defenseData.blockType === "Weapon" ? "flex" : "none"};">
            <span class="defense-hardness-label">Hardness</span>
            <input type="number" class="tag-defense-hardness ${PC_TAG_INPUT_CLASS} pc-tag-input-lg" value="${defenseData.hardness || ""}" min="0" step="1" placeholder="0" ${PC_TAG_INTEGER_ATTRS}>
          </label>
          <label class="defense-inline-field defense-hp-field" style="display:${defenseData.blockType === "Weapon" ? "none" : "flex"};">
            <span>HP</span>
            <input type="number" class="tag-defense-hp ${PC_TAG_INPUT_CLASS} pc-tag-input-lg" value="${defenseData.hp || ""}" min="0" step="1" placeholder="0" ${PC_TAG_INTEGER_ATTRS}>
          </label>
          <div class="defense-toggle-row defense-mastery-bonus-row" style="grid-column: 1 / -1; display:${defenseData.blockType === "Weapon" ? "flex" : "none"}; margin-top:10px;">
            <span>Mastery Bonus?</span>
            <div class="defense-checkbox-cell" style="flex: 0 0 24px; text-align: center; display: flex; align-items: center; justify-content: center;">
              <input type="checkbox" class="tag-defense-mastery-bonus" ${defenseData.masteryBonus ? "checked" : ""}>
            </div>
          </div>
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
            <input type="number" class="tag-defense-debuff-tohit ${PC_TAG_INPUT_CLASS} pc-tag-input-lg" value="${defenseData.debuffToHit || ""}" step="1" placeholder="0" ${PC_TAG_INTEGER_ATTRS}>
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
          <input type="number" class="tag-defense-mos-per ${PC_TAG_INPUT_CLASS} pc-tag-input-xl" value="${entry.mosPer || ""}" step="0.25" min="0" placeholder="0" ${PC_TAG_DECIMAL_ATTRS}>
          <input type="number" class="tag-defense-accuracy-penalty ${PC_TAG_INPUT_CLASS} pc-tag-input-xxl" value="${entry.accuracyPenalty || ""}" step="1" placeholder="0" ${PC_TAG_INTEGER_ATTRS}>
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
    const isShield = blockType === "Shield";
    const isWeapon = blockType === "Weapon";
    $area.find(".defense-shield-arm-field").css("display", isShield ? "flex" : "none");
    $area.find(".defense-hardness-field").css("display", (isShield || isWeapon) ? "flex" : "none");
    $area.find(".defense-hp-field").css("display", isWeapon ? "none" : "flex");
    $area.find(".defense-mastery-bonus-row").css("display", isWeapon ? "flex" : "none");
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
  $area.on("mousedown.defenseTagEditor", ".tag-defense-response, .tag-defense-block, .tag-defense-applies-before, .tag-defense-applies-debuff, .tag-defense-mastery-bonus", (ev) => {
    // Match the sheet's feel more closely by preventing mouse clicks from leaving
    // the checkbox focused, which causes the persistent highlight in this popup.
    if (ev.button === 0) ev.preventDefault();
  });

  renderDefenseEffectivenessRows();
  updateDefenseStructureVisibility();
  updateDefenseDebuffVisibility();
}
