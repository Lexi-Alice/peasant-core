import { pcLog } from "../../../utils/logging.mjs";

export function setupBlessingControls(sheet, html) {
  html.find(".blessing-menu").addClass("hidden");

  html.on("click", ".attr-label[data-attr] > span, .attr-label[data-attr]", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    if (!sheet.isEditMode) return;

    const $label = $(ev.currentTarget).closest(".attr-label[data-attr]");
    const attr = $label.data("attr");
    const menu = html.find(".blessing-menu");
    if (!menu.length) {
      pcLog.debug("Blessing menu element not found in DOM");
      return;
    }

    positionBlessingMenu(html, menu, $label);
    loadBlessingState(sheet, menu, attr);
    menu.removeClass("hidden");
    if (menu[0]) menu[0].style.display = "";
  });

  html.on("click", ".characteristic-label", async (ev) => {
    try {
      if (!sheet.isEditMode) return;
      ev.preventDefault();
      ev.stopPropagation();

      const el = $(ev.currentTarget);
      const characteristic = el.data("characteristic");

      try {
        const result = await sheet.actor.togglePeasantToHitPenaltyTarget?.(characteristic);
        updateCharacteristicToHitDisplay(sheet, html, result?.target ?? "");
      } catch (err) {
        console.warn("Failed to update toHitPenaltyTarget", err);
      }

      await sheet.render(true);
    } catch (err) {
      console.error("Error handling characteristic-label click:", err);
    }
  });

  html.find(".blessing-menu").on("change", "input[name=blessingType]", (ev) => {
    const $input = $(ev.currentTarget);
    const menu = $input.closest(".blessing-menu");
    const isChecked = $input.is(":checked");
    if (isChecked) {
      menu.find("input[name=blessingType]").not($input).prop("checked", false);
    } else {
      const anyChecked = menu.find("input[name=blessingType]:checked").length > 0;
      if (!anyChecked) menu.data("blessingTarget", "");
    }
  });

  html.find(".blessing-menu").on("click", ".clear-blessing", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const menu = html.find(".blessing-menu");
    try {
      await sheet.actor.clearPeasantBlessing?.();
    } catch (err) {
      console.warn("Failed to clear blessing:", err);
    }
    menu.addClass("hidden");
    sheet.render(false);
  });

  html.find(".blessing-menu").on("click", ".close-blessing", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    html.find(".blessing-menu").addClass("hidden");
  });

  html.find(".blessing-menu").on("click", ".apply-blessing", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const menu = html.find(".blessing-menu");
    const chosenType = menu.find("input[name=blessingType]:checked").val() || "";
    const chosenTarget = menu.data("blessingTarget") || "";

    if (chosenType && (chosenType === "spring" || chosenType === "fall" || chosenType === "summer")) {
      if (!chosenTarget) {
        ui.notifications.warn("Please select a basic attribute target for this Blessing.");
        return;
      }
    }

    await sheet.actor.setPeasantBlessing?.(chosenType, chosenTarget);

    menu.addClass("hidden");
    sheet.render(false);
  });
}

function positionBlessingMenu(html, menu, $label) {
  const container = html.find(".attributes-table");
  if (container.length) {
    menu.appendTo(container);
    menu.css({ position: "absolute", display: "block", visibility: "hidden" });
    const labelPos = $label.position();
    const nudgeDown = 12;
    const menuWidth = menu.outerWidth() || 260;
    const menuHeight = menu.outerHeight() || 160;
    const containerWidth = container.innerWidth() || html.width() || 720;

    let left = Math.min(containerWidth - menuWidth - 6, Math.max(6, labelPos.left || 0));
    let top = (labelPos.top || 0) + $label.outerHeight() + nudgeDown;

    const containerHeight = container.innerHeight() || html.height() || 700;
    if (top + menuHeight > containerHeight - 6) {
      top = Math.max(6, (labelPos.top || 0) - menuHeight - 6);
    }

    menu.css({
      position: "absolute",
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      visibility: "",
      display: ""
    });
    return;
  }

  const sheetOffset = html.offset() || { top: 0, left: 0 };
  const labelOffset = $label.offset() || { top: 0, left: 0 };
  const extraOffset = 18;
  const top = (labelOffset.top - sheetOffset.top) + $label.outerHeight() + 6 + extraOffset;
  let left = (labelOffset.left - sheetOffset.left) || 0;
  const menuWidth = menu.outerWidth() || 260;
  const containerWidth = html.width() || (html[0] && html[0].clientWidth) || 720;
  left = Math.min(containerWidth - menuWidth - 10, Math.max(6, left));
  const menuHeight = menu.outerHeight() || 200;
  const containerHeight = html.height() || (html[0] && html[0].clientHeight) || 700;
  const maxTop = Math.max(6, containerHeight - menuHeight - 10);
  const finalTop = Math.min(maxTop, top);
  menu.css({ top: `${finalTop}px`, left: `${left}px`, position: "absolute" });
}

function loadBlessingState(sheet, menu, attr) {
  const blessing = sheet.actor.system.blessing || { type: "", target: "" };
  menu.find("input[name=blessingType]").prop("checked", false);
  if (blessing.type) menu.find(`input[name=blessingType][value=${blessing.type}]`).prop("checked", true);
  menu.data("blessingTarget", blessing.target || attr);

  try {
    menu.find(".apply-blessing").prop("disabled", false).show();
  } catch (err) {
    pcLog.debug("Blessing menu apply button missing or cannot be shown", err);
  }
}

function updateCharacteristicToHitDisplay(sheet, html, newTarget) {
  try {
    const labels = html.find(".characteristic-label");
    labels.removeClass("blessed");
    if (newTarget) {
      html.find(`.characteristic-label[data-characteristic="${newTarget}"]`).addClass("blessed");
    }

    const build = sheet.actor.system.build || 0;
    const reflex = sheet.actor.system.reflex || 0;
    const intuition = sheet.actor.system.intuition || 0;
    const learn = sheet.actor.system.learn || 0;
    const charisma = sheet.actor.system.charisma || 0;

    const blessing = sheet.actor.system.blessing || { type: null, target: null };
    const isSummer = blessing.type === "summer" && blessing.target;
    const blessedValue = isSummer ? ({ build, reflex, intuition, learn, charisma }[blessing.target] || 0) : 0;

    const strBase = isSummer ? (22 - build - reflex - blessedValue) : (18 - build - reflex);
    const dexBase = isSummer ? (22 - reflex - intuition - blessedValue) : (18 - reflex - intuition);
    const mntBase = isSummer ? (22 - intuition - learn - blessedValue) : (18 - intuition - learn);
    const socBase = isSummer ? (22 - intuition - charisma - blessedValue) : (18 - intuition - charisma);

    const mapping = {
      Strength: newTarget === "Strength" ? (strBase - 1) : strBase,
      Dexterity: newTarget === "Dexterity" ? (dexBase - 1) : dexBase,
      Mental: newTarget === "Mental" ? (mntBase - 1) : mntBase,
      Social: newTarget === "Social" ? (socBase - 1) : socBase
    };

    Object.entries(mapping).forEach(([char, val]) => {
      const toHit = html.find(`.attr-tohit-clickable[data-characteristic="${char}"]`);
      if (toHit.length) toHit.text(`${val}+`);
    });
  } catch (domErr) {
    pcLog.debug("Failed to update characteristic to-hit display", domErr);
  }
}
