export function renderSpeedTagInputs($area, combatData, { inputStyle, labelStyle, selectStyle } = {}) {
  const currentSpeed = combatData.speed || {};
  $area.html(`
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <label style="${labelStyle}">Speed:</label>
        <select class="tag-speed-type" style="${selectStyle}">
          <option value="">-- Select --</option>
          <option value="Full Round" ${currentSpeed.type === "Full Round" ? "selected" : ""}>Full Round</option>
          <option value="Standard" ${currentSpeed.type === "Standard" ? "selected" : ""}>Standard</option>
          <option value="Movement" ${currentSpeed.type === "Movement" ? "selected" : ""}>Movement</option>
          <option value="Reflex" ${currentSpeed.type === "Reflex" ? "selected" : ""}>Reflex</option>
          <option value="Instant" ${currentSpeed.type === "Instant" ? "selected" : ""}>Instant</option>
          <option value="Split Second" ${currentSpeed.type === "Split Second" ? "selected" : ""}>Split Second</option>
        </select>
      </div>
      <div class="split-second-uses" style="display:${currentSpeed.type === "Split Second" ? "flex" : "none"};align-items:center;gap:8px;">
        <label style="${labelStyle}">Max Uses:</label>
        <input type="number" class="tag-speed-max" value="${currentSpeed.splitSecondMax || ""}" style="${inputStyle}" min="1" placeholder="#">
      </div>
    </div>
  `);

  $area.on("change", ".tag-speed-type", function() {
    const $splitUses = $area.find(".split-second-uses");
    if ($(this).val() === "Split Second") {
      $splitUses.show();
    } else {
      $splitUses.hide();
    }
  });
}
