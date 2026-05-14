import { showReadonlyDescriptionDialog } from "../controls/description-dialogs.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export function setupSkillRowControls(sheet, html, { blurActiveEditableInSheet, enqueue, runQueued } = {}) {
  setupRankInputControls(html);

  html.on("click", ".add-skill-btn", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    await enqueue("_skillsSaveQueue", "Skill add", async () => {
      await sheet.actor.addPeasantSkill?.();
    });
    sheet.render(true);
  });

  html.on("click", ".skill-toggle-type", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = $(ev.currentTarget).closest(".skill-item");
    const index = resolveRowIndex(row, "data-skill-index");
    if (Number.isNaN(index)) return;

    await enqueue("_skillsSaveQueue", "Skill type toggle", async () => {
      await sheet.actor.setPeasantSkillType?.(index, "Other");
    });
    sheet.render(true);
  });

  html.on("change", ".skill-select", async (ev) => {
    if (!sheet.isEditMode) return;
    const select = $(ev.currentTarget);
    const newType = select.val() || "standard";
    const row = select.closest(".skill-item");
    const index = resolveRowIndex(row, "data-skill-index");
    if (Number.isNaN(index)) return;

    await enqueue("_skillsSaveQueue", "Skill type select", async () => {
      await sheet.actor.setPeasantSkillType?.(index, newType);
    });
    sheet.render(true);
  });

  html.on("click", ".skill-indent", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      await blurActiveEditableInSheet?.();
      const row = $(ev.currentTarget).closest(".skill-item");
      const index = resolveRowIndex(row, "data-skill-index");
      if (Number.isNaN(index)) return;
      await enqueue("_skillsSaveQueue", "Skill indent", async () => {
        await sheet.actor.changePeasantSkillIndent?.(index, 1);
      });
      sheet.render(true);
    } catch (e) {
      pcLog.debug("skill indent failed", e);
    }
  });

  html.on("click", ".skill-outdent", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      await blurActiveEditableInSheet?.();
      const row = $(ev.currentTarget).closest(".skill-item");
      const index = resolveRowIndex(row, "data-skill-index");
      if (Number.isNaN(index)) return;
      await enqueue("_skillsSaveQueue", "Skill outdent", async () => {
        await sheet.actor.changePeasantSkillIndent?.(index, -1);
      });
      sheet.render(true);
    } catch (e) {
      pcLog.debug("skill outdent failed", e);
    }
  });

  html.on("click", ".skill-delete", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = $(ev.currentTarget).closest(".skill-item");
    const index = resolveRowIndex(row, "data-skill-index");
    if (Number.isNaN(index)) return;
    await enqueue("_skillsSaveQueue", "Skill delete", async () => {
      await sheet.actor.removePeasantSkill?.(index);
    });
    sheet.render(true);
  });

  html.on("change", ".skill-sig-checkbox", async (ev) => {
    if (!sheet.isEditMode) return;
    try {
      await enqueue("_skillsSaveQueue", "Skill sig change", async () => {
        const cb = $(ev.currentTarget);
        const row = cb.closest(".skill-item");
        const index = resolveRowIndex(row, "data-skill-index");
        const skills = collectSkillsFromDOMForSig(sheet);

        sheet._lastSkillsSnapshot = skills;

        try {
          pcLog.debug("SIG click persist: index", index, "skills snapshot:", skills.map(s => ({ name: s.name, sig: s.sig, usesCurrent: s.usesCurrent })));
        } catch (e) {
          /* ignore */
        }

        pcLog.debug("SIG persist update payload:", skills);
        try {
          const result = await sheet.actor.setPeasantSkills?.(skills);
          if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
        } catch (updateErr) {
          console.warn("SIG persist update failed:", updateErr);
          ui.notifications?.error?.("Failed to save signature toggle. See console for details.");
          throw updateErr;
        }

        try {
          pcLog.debug("SIG click persist complete; actor.skills now:", sheet.actor.system.skills.map(s => ({ name: s.name, sig: s.sig, usesCurrent: s.usesCurrent })));
        } catch (e) {
          /* ignore */
        }

        sheet.render(true);
      });
    } catch (err) {
      console.warn("Failed to persist SIG checkbox click:", err);
    }
  });

  html.on("change", ".skill-uses-max", async (ev) => {
    const input = $(ev.currentTarget);
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".skill-item", rowAttr: "data-skill-index" });
    if (index < 0) return;

    const val = Number.isNaN(parseInt(input.val())) ? 0 : parseInt(input.val());
    try {
      await runQueued(input, "_skillsSaveQueue", "Skill usesMax change", async () => {
        const result = await sheet.actor.setPeasantSkillUsesMax?.(index, val, { render: false });
        if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
      });
    } catch (err) {
      console.warn("Failed to persist usesMax change (per-field):", err);
    }
  });

  html.on("change", ".skill-tohit, .skill-accuracy", async (ev) => {
    const input = $(ev.currentTarget);
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".skill-item", rowAttr: "data-skill-index" });
    if (index < 0) return;
    const row = input.closest(".skill-item");

    try {
      await runQueued(input, "_skillsSaveQueue", "Skill to-hit/accuracy change", async () => {
        const tohitEl = row.find(".skill-tohit");
        const accEl = row.find(".skill-accuracy");
        const currentSkill = sheet.actor.system.skills?.[index] || {};
        const tohitVal = tohitEl.length ? (tohitEl.val() || "") : (currentSkill.tohit || "");
        const accValRaw = accEl.length ? accEl.val() : (currentSkill.accuracy || "");
        const accVal = (accValRaw === "" || accValRaw === null) ? "" : String(accValRaw);

        pcLog.debug("Persisting skill tohit/accuracy (index):", index, { tohit: tohitVal, accuracy: accVal });
        const result = await sheet.actor.setPeasantSkillToHitAccuracy?.(index, { tohit: tohitVal, accuracy: accVal }, { render: false });
        if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
      });
    } catch (err) {
      console.warn("Failed to persist skill tohit/accuracy change (per-field):", err);
    }
  });

  html.on("change", ".skill-uses-current", async (ev) => {
    const input = $(ev.currentTarget);

    const idx = resolveItemIndex(input, { dataKey: "index", rowSelector: ".skill-item", rowAttr: "data-skill-index" });
    if (idx < 0) return;

    const raw = Number.isNaN(parseInt(input.val())) ? 0 : parseInt(input.val());

    try {
      await runQueued(input, "_skillsSaveQueue", "Skill usesCurrent change", async () => {
        const result = await sheet.actor.setPeasantSkillUsesCurrent?.(idx, raw, { render: false });
        if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
      });
    } catch (err) {
      console.warn("Failed to persist usesCurrent change (per-field):", err);
    }
  });

  html.on("change", ".skill-class, .skill-rank, .skill-name, .skill-ap, .skill-sp, .skill-special-grade", async (ev) => {
    const input = $(ev.currentTarget);
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".skill-item", rowAttr: "data-skill-index" });
    if (index < 0) return;
    const row = input.closest(".skill-item");

    try {
      await runQueued(input, "_skillsSaveQueue", "Skill main field change", async () => {
        const classEl = row.find(".skill-class");
        const rankEl = row.find(".skill-rank");
        const nameEl = row.find(".skill-name");
        const apEl = row.find(".skill-ap");
        const spEl = row.find(".skill-sp");
        const specialGradeEl = row.find(".skill-special-grade");

        const fields = {};
        if (classEl.length) fields.class = classEl.val();
        if (rankEl.length) fields.rank = rankEl.val();
        if (nameEl.length) fields.name = nameEl.val();
        if (apEl.length) fields.ap = apEl.val();
        if (spEl.length) fields.sp = spEl.val();
        if (specialGradeEl.length) fields.specialGrade = specialGradeEl.val();

        pcLog.debug("Persisting skill class/rank/name/ap/sp (index):", index, fields);
        const result = await sheet.actor.setPeasantSkillMainFields?.(index, fields, { render: false });
        if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
      });
    } catch (err) {
      console.warn("Failed to persist skill class/rank/name/ap/sp change:", err);
    }
  });

  html.on("click", ".skill-name-wrapper, .skill-name-view.skill-has-desc", async (ev) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      const $current = $(ev.currentTarget);
      const $target = $(ev.target);
      const $wrapper = $current.hasClass("skill-name-wrapper") ? $current : $current.closest(".skill-name-wrapper");
      const $nameSpan = $current.hasClass("skill-name-view") ? $current : $current.find(".skill-name-view.skill-has-desc").first();

      let index = Number($wrapper.data("index"));
      if (Number.isNaN(index)) index = Number($nameSpan.data("index"));
      if (Number.isNaN(index)) index = Number($target.closest(".skill-name-view.skill-has-desc").data("index"));
      if (Number.isNaN(index)) return;

      const skills = sheet.actor.system.skills || [];
      const skill = skills[index] || {};
      const description = skill.description || "";
      const skillName = skill.name || "Skill";

      await showReadonlyDescriptionDialog(sheet, {
        title: `${skillName} - Description`,
        description
      });
    } catch (e) {
      pcLog.debug("skill-name-view click failed", e);
    }
  });
}

export function setupSkillDeleteBackupHandler(sheet, html, { blurActiveEditableInSheet, enqueue } = {}) {
  html.find(".skill-delete").off("click").click(async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = $(ev.currentTarget).closest(".skill-item");
    const index = resolveRowIndex(row, "data-skill-index");
    if (Number.isNaN(index)) return;
    await enqueue("_skillsSaveQueue", "Skill delete backup", async () => {
      await sheet.actor.removePeasantSkill?.(index);
    });
    sheet.render(true);
  });
}

function setupRankInputControls(html) {
  const rankInputs = html.find(".skill-rank, .combat-rank");
  rankInputs.on("keydown", (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const key = ev.key;
    const isNav = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", "Enter", "Home", "End"].includes(key);
    if (isNav) return;
    if (!/^[1234uU]$/.test(key)) {
      ev.preventDefault();
    }
  });

  rankInputs.on("input", (ev) => {
    const input = ev.currentTarget;
    const before = input.value || "";
    const normalized = normalizeRankValue(before);
    if (normalized !== before) input.value = normalized;
  });

  rankInputs.on("change blur", (ev) => {
    const input = ev.currentTarget;
    const normalized = normalizeRankValue(input.value);
    const finalVal = normalized === "" ? "1" : normalized;
    if (finalVal !== input.value) input.value = finalVal;
  });
}

function normalizeRankValue(raw) {
  const match = String(raw || "").match(/[1234uU]/);
  return match ? match[0] : "";
}

function collectSkillsFromDOMForSig(sheet) {
  const skillEls = sheet._getSheetJQ().find(".skills-list .skill-item") || [];
  const skills = [];
  const existing = JSON.parse(JSON.stringify(sheet.actor.system.skills || []));
  for (let i = 0; i < skillEls.length; i++) {
    const $el = $(skillEls[i]);
    const hasSelect = $el.find(".skill-select").length > 0;
    const base = existing[i] || {};
    if (!hasSelect) {
      const cls = parseInt($el.find(".skill-class").val()) || 1;
      const rkRaw = ($el.find(".skill-rank").val() || "").trim();
      let rk;
      if (rkRaw.toLowerCase() === "u") {
        rk = rkRaw;
      } else {
        const rkNum = parseInt(rkRaw);
        rk = Number.isNaN(rkNum) ? (base.rank ?? 0) : rkNum;
      }
      const usesMaxInput = $el.find(".skill-uses-max");
      const usesMaxVal = usesMaxInput.length ? (Number.isNaN(parseInt(usesMaxInput.val())) ? 0 : parseInt(usesMaxInput.val())) : (base.usesMax || 0);
      const usesCurrentInput = $el.find(".skill-uses-current");
      const usesCurrentVal = usesCurrentInput.length
        ? (Number.isNaN(parseInt(usesCurrentInput.val())) ? 0 : parseInt(usesCurrentInput.val()))
        : (base.usesCurrent !== undefined ? base.usesCurrent : (usesMaxVal || 0));
      const baseGrade = Number.isNaN(parseInt(base.specialGrade)) ? 0 : parseInt(base.specialGrade);
      skills.push({
        type: "standard",
        class: cls,
        specialGrade: baseGrade,
        rank: rk,
        sig: !!$el.find(".skill-sig-checkbox").is(":checked"),
        name: $el.find(".skill-name").val() || "",
        tohit: $el.find(".skill-tohit").val() || "",
        accuracy: $el.find(".skill-accuracy").val() || "",
        ap: $el.find(".skill-ap").val() || "",
        sp: $el.find(".skill-sp").val() || "",
        usesMax: usesMaxVal,
        usesCurrent: usesCurrentVal,
        indent: parseInt($el.attr("data-indent")) || 0,
        description: base.description || ""
      });
    } else {
      const gradeInput = $el.find(".skill-special-grade");
      const baseGrade = Number.isNaN(parseInt(base.specialGrade)) ? 0 : parseInt(base.specialGrade);
      const gradeVal = gradeInput.length ? (Number.isNaN(parseInt(gradeInput.val())) ? 0 : parseInt(gradeInput.val())) : baseGrade;
      skills.push({
        type: $el.find(".skill-select").val() || "standard",
        specialGrade: Math.max(0, gradeVal),
        name: $el.find(".skill-name").val() || "",
        tohit: $el.find(".skill-tohit").val() || "",
        accuracy: $el.find(".skill-accuracy").val() || "",
        ap: $el.find(".skill-ap").val() || "",
        sp: $el.find(".skill-sp").val() || "",
        indent: parseInt($el.attr("data-indent")) || 0,
        description: base.description || ""
      });
    }
  }
  return skills;
}

function resolveItemIndex($source, { dataKey = "index", rowSelector = null, rowAttr = null } = {}) {
  let index = Number.parseInt($source?.data?.(dataKey));
  if (!Number.isNaN(index)) return index;

  if (rowSelector) {
    const row = $source?.closest?.(rowSelector);
    if (row?.length) {
      if (rowAttr) {
        index = Number.parseInt(row.attr(rowAttr));
        if (!Number.isNaN(index)) return index;
      }
      index = row.index();
      if (!Number.isNaN(index)) return index;
    }
  }

  return -1;
}

function resolveRowIndex(row, attr) {
  let index = parseInt(row.attr(attr));
  if (Number.isNaN(index)) index = row.index();
  return index;
}
