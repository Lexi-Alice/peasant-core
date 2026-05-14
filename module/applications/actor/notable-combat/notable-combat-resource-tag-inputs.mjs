export function renderResourceCostTagInputs($area, combatData, { inputStyle, selectStyle } = {}) {
  const existingCosts = combatData.resourceCosts || [];
  let costsHtml = `<div class="resource-costs-container" style="display:flex;flex-direction:column;gap:8px;">`;
  costsHtml += `<div class="resource-costs-list" style="display:flex;flex-direction:column;gap:6px;">`;

  const costsToRender = existingCosts.length > 0 ? existingCosts : [{ type: "", value: 0, damageType: "" }];
  costsToRender.forEach((cost, idx) => {
    costsHtml += `
      <div class="resource-cost-row" data-cost-index="${idx}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <select class="tag-rc-type" style="${selectStyle}">
          <option value="">-- Type --</option>
          <option value="Stamina" ${cost.type === "Stamina" ? "selected" : ""}>Stamina</option>
          <option value="Attunement" ${cost.type === "Attunement" ? "selected" : ""}>Attunement</option>
          <option value="HP" ${cost.type === "HP" ? "selected" : ""}>HP</option>
          <option value="Physical Stress" ${cost.type === "Physical Stress" ? "selected" : ""}>Physical Stress</option>
          <option value="Mental Stress" ${cost.type === "Mental Stress" ? "selected" : ""}>Mental Stress</option>
        </select>
        <input type="number" class="tag-rc-value" value="${cost.value || ""}" style="${inputStyle}width:50px;" min="0" placeholder="#">
        <select class="tag-rc-dmgtype" style="${selectStyle}display:${cost.type === "HP" ? "inline-block" : "none"};">
          <option value="">-- Dmg Type --</option>
          <option value="Blunt" ${cost.damageType === "Blunt" ? "selected" : ""}>Blunt</option>
          <option value="Lethal" ${cost.damageType === "Lethal" ? "selected" : ""}>Lethal</option>
          <option value="Critical" ${cost.damageType === "Critical" ? "selected" : ""}>Critical</option>
        </select>
        <button type="button" class="remove-cost-row peasant-tag-cancel" title="Remove cost row">-</button>
      </div>
    `;
  });

  costsHtml += `</div>`;
  costsHtml += `<button type="button" class="add-cost-row peasant-tag-add">+ Add Cost</button>`;
  costsHtml += `</div>`;
  $area.html(costsHtml);

  $area.on("change", ".tag-rc-type", function() {
    const $row = $(this).closest(".resource-cost-row");
    const $dmgType = $row.find(".tag-rc-dmgtype");
    if ($(this).val() === "HP") {
      $dmgType.show();
    } else {
      $dmgType.hide().val("");
    }
  });

  $area.on("click", ".add-cost-row", function() {
    const $list = $area.find(".resource-costs-list");
    const newIdx = $list.find(".resource-cost-row").length;
    $list.append(`
      <div class="resource-cost-row" data-cost-index="${newIdx}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <select class="tag-rc-type" style="${selectStyle}">
          <option value="">-- Type --</option>
          <option value="Stamina">Stamina</option>
          <option value="Attunement">Attunement</option>
          <option value="HP">HP</option>
          <option value="Physical Stress">Physical Stress</option>
          <option value="Mental Stress">Mental Stress</option>
        </select>
        <input type="number" class="tag-rc-value" value="" style="${inputStyle}width:50px;" min="0" placeholder="#">
        <select class="tag-rc-dmgtype" style="${selectStyle}display:none;">
          <option value="">-- Dmg Type --</option>
          <option value="Blunt">Blunt</option>
          <option value="Lethal">Lethal</option>
          <option value="Critical">Critical</option>
        </select>
        <button type="button" class="remove-cost-row peasant-tag-cancel" title="Remove cost row">-</button>
      </div>
    `);
  });

  $area.on("click", ".remove-cost-row", function() {
    $(this).closest(".resource-cost-row").remove();
  });
}
