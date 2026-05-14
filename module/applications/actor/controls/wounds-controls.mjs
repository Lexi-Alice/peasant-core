export function setupWoundsControls(sheet, html) {
  if (sheet._woundsMenuOpen) {
    html.find(".wounds-menu").removeClass("hidden");
  }

  html.find(".toggle-wounds-menu").click((ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const menu = html.find(".wounds-menu");
    menu.toggleClass("hidden");
    sheet._woundsMenuOpen = !menu.hasClass("hidden");
  });

  html.find(".close-wounds").click((ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    html.find(".wounds-menu").addClass("hidden");
    sheet._woundsMenuOpen = false;
  });

  html.find(".wounds-menu .wound-tag").each((_, tagEl) => {
    bindWoundTagHover(tagEl);
  });

  html.find(".remove-condition").click(async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const key = $(ev.currentTarget).data("condition");

    try {
      await sheet.actor.clearPeasantCondition?.(key);
    } catch (err) {
      console.warn("Failed to remove condition:", err);
      return;
    }

    const hasRemaining = sheet.actor.hasPeasantConditions?.() ?? false;
    sheet._woundsMenuOpen = hasRemaining;
    html.find(".wounds-menu").toggleClass("hidden", !hasRemaining);

    sheet.render(false);
  });

  html.find(".add-wound-btn").click((ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openAddWoundDialog(sheet);
  });
}

function bindWoundTagHover(tagEl) {
  const removeBtn = tagEl.querySelector(".remove-condition");
  const setTagHoverState = (active) => {
    tagEl.classList.toggle("tag-hover-active", !!active);
    if (!active) {
      tagEl.style.removeProperty("background");
      tagEl.style.removeProperty("background-color");
      tagEl.style.removeProperty("border-color");
      tagEl.style.removeProperty("color");
      return;
    }

    const hoverSource = removeBtn || tagEl;
    const hoverStyles = getComputedStyle(hoverSource);
    const hoverBg = hoverStyles.getPropertyValue("--button-hover-background-color").trim() || "rgba(206, 122, 28, 0.85)";
    const hoverBorder = hoverStyles.getPropertyValue("--button-hover-border-color").trim() || "#e0b15b";
    const hoverText = hoverStyles.getPropertyValue("--button-hover-text-color").trim() || "#fff4db";

    tagEl.style.setProperty("background", hoverBg, "important");
    tagEl.style.setProperty("background-color", hoverBg, "important");
    tagEl.style.setProperty("border-color", hoverBorder, "important");
    tagEl.style.setProperty("color", hoverText, "important");
  };
  const setRemoveHoverState = (active) => {
    if (!removeBtn) return;
    removeBtn.classList.toggle("tag-hover-active", !!active);
  };

  tagEl.addEventListener("mouseenter", () => setTagHoverState(true));
  tagEl.addEventListener("mouseleave", () => setTagHoverState(false));

  if (!removeBtn) return;

  removeBtn.addEventListener("mouseenter", () => {
    setTagHoverState(false);
    setRemoveHoverState(true);
  });
  removeBtn.addEventListener("mouseleave", () => {
    setRemoveHoverState(false);
    if (tagEl.matches(":hover")) setTagHoverState(true);
  });
  removeBtn.addEventListener("focusin", () => {
    setTagHoverState(false);
    setRemoveHoverState(true);
  });
  removeBtn.addEventListener("focusout", () => {
    setRemoveHoverState(false);
    setTimeout(() => {
      if (tagEl.matches(":hover")) setTagHoverState(true);
    }, 0);
  });
}

function openAddWoundDialog(sheet) {
  const dialogContent = `
    <form>
      <div class="form-group" style="margin-bottom: 10px;">
        <label style="display: block; margin-bottom: 5px; color: #b0b0b0;">Select Wound Type:</label>
        <select name="woundType" style="width: 100%; padding: 8px 10px; min-height: 38px; font-size: 14px;">
          <option value="wounded">Wounded</option>
          <optgroup label="--- Disabled ---">
            <option value="disabled:head">Disabled Head</option>
            <option value="disabled:rightArm">Disabled Right Arm</option>
            <option value="disabled:leftArm">Disabled Left Arm</option>
            <option value="disabled:rightLeg">Disabled Right Leg</option>
            <option value="disabled:leftLeg">Disabled Left Leg</option>
            <option value="disabled:torso">Disabled Torso</option>
          </optgroup>
          <optgroup label="--- Crippled ---">
            <option value="crippled:head">Crippled Head</option>
            <option value="crippled:rightArm">Crippled Right Arm</option>
            <option value="crippled:leftArm">Crippled Left Arm</option>
            <option value="crippled:rightLeg">Crippled Right Leg</option>
            <option value="crippled:leftLeg">Crippled Left Leg</option>
            <option value="crippled:torso">Crippled Torso</option>
          </optgroup>
        </select>
      </div>
    </form>
  `;

  sheet._renderDialog({
    title: "Add Wound",
    content: dialogContent,
    buttons: {
      add: {
        icon: '<i class="fas fa-plus"></i>',
        label: "Add",
        callback: async (html) => {
          const woundType = html.find('[name="woundType"]').val();
          await sheet.actor.addPeasantWound?.(woundType);
          sheet._woundsMenuOpen = true;
          sheet.render(false);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel"
      }
    },
    default: "add"
  });
}
