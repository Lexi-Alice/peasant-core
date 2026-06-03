import { showReadonlyDescriptionDialog } from "../controls/description-dialogs.mjs";
import { formatOptionalIntegerInput, parseOptionalInteger, sanitizeOptionalIntegerInputValue } from "../../../data/actor/helpers.mjs";
import { delegate, qs, qsa, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

export function setupSkillRowControls(sheet, html, { blurActiveEditableInSheet, enqueue, runQueued } = {}) {
  const root = toElement(html);
  if (!root) return;

  setupRankInputControls(root);

  delegate(root, "click", ".add-skill-btn", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    await enqueue("_skillsSaveQueue", "Skill add", async () => {
      await sheet.actor.addPeasantSkill?.();
    });
  });

  delegate(root, "click", ".skill-toggle-type", async (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = target.closest(".skill-item");
    const index = resolveRowIndex(row, "data-skill-index");
    if (Number.isNaN(index)) return;

    await enqueue("_skillsSaveQueue", "Skill type toggle", async () => {
      await sheet.actor.setPeasantSkillType?.(index, "Other");
    });
  });

  delegate(root, "change", ".skill-select", async (ev, select) => {
    if (!sheet.isEditMode) return;
    const newType = select.value || "standard";
    const row = select.closest(".skill-item");
    const index = resolveRowIndex(row, "data-skill-index");
    if (Number.isNaN(index)) return;

    await enqueue("_skillsSaveQueue", "Skill type select", async () => {
      await sheet.actor.setPeasantSkillType?.(index, newType);
    });
  });

  delegate(root, "click", ".skill-indent", async (ev, target) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      await blurActiveEditableInSheet?.();
      const row = target.closest(".skill-item");
      const index = resolveRowIndex(row, "data-skill-index");
      if (Number.isNaN(index)) return;
      await enqueue("_skillsSaveQueue", "Skill indent", async () => {
        await sheet.actor.changePeasantSkillIndent?.(index, 1);
      });
    } catch (e) {
      pcLog.debug("skill indent failed", e);
    }
  });

  delegate(root, "click", ".skill-outdent", async (ev, target) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      await blurActiveEditableInSheet?.();
      const row = target.closest(".skill-item");
      const index = resolveRowIndex(row, "data-skill-index");
      if (Number.isNaN(index)) return;
      await enqueue("_skillsSaveQueue", "Skill outdent", async () => {
        await sheet.actor.changePeasantSkillIndent?.(index, -1);
      });
    } catch (e) {
      pcLog.debug("skill outdent failed", e);
    }
  });

  delegate(root, "click", ".skill-delete", async (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = target.closest(".skill-item");
    const index = resolveRowIndex(row, "data-skill-index");
    if (Number.isNaN(index)) return;
    await enqueue("_skillsSaveQueue", "Skill delete", async () => {
      await sheet.actor.removePeasantSkill?.(index);
    });
  });

  delegate(root, "change", ".skill-sig-checkbox", async (ev, checkbox) => {
    if (!sheet.isEditMode) return;
    try {
      await enqueue("_skillsSaveQueue", "Skill sig change", async () => {
        const row = checkbox.closest(".skill-item");
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

      });
    } catch (err) {
      console.warn("Failed to persist SIG checkbox click:", err);
    }
  });

  delegate(root, "change", ".skill-uses-max", async (ev, input) => {
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".skill-item", rowAttr: "data-skill-index" });
    if (index < 0) return;

    const val = Number.isNaN(Number.parseInt(input.value, 10)) ? 0 : Number.parseInt(input.value, 10);
    try {
      await runQueued(input, "_skillsSaveQueue", "Skill usesMax change", async () => {
        const result = await sheet.actor.setPeasantSkillUsesMax?.(index, val);
        if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
      });
    } catch (err) {
      console.warn("Failed to persist usesMax change (per-field):", err);
    }
  });

  delegate(root, "input", ".skill-tohit, .skill-ap, .skill-sp", (ev, input) => {
    if (!sheet.isEditMode) return;
    sanitizeOptionalIntegerInputElement(input);
  });

  delegate(root, "input", ".skill-accuracy", (ev, input) => {
    if (!sheet.isEditMode) return;
    sanitizeOptionalIntegerInputElement(input, { allowSign: true });
  });

  delegate(root, "change", ".skill-tohit, .skill-accuracy", async (ev, input) => {
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".skill-item", rowAttr: "data-skill-index" });
    if (index < 0) return;
    const row = input.closest(".skill-item");

    try {
      await runQueued(input, "_skillsSaveQueue", "Skill to-hit/accuracy change", async () => {
        const tohitEl = qs(row, ".skill-tohit");
        const accEl = qs(row, ".skill-accuracy");
        const currentSkill = sheet.actor.system.skills?.[index] || {};
        const tohitVal = tohitEl ? (tohitEl.value || "") : (currentSkill.tohit || "");
        const accValRaw = accEl ? accEl.value : (currentSkill.accuracy || "");
        const accVal = (accValRaw === "" || accValRaw === null) ? "" : String(accValRaw);

        pcLog.debug("Persisting skill tohit/accuracy (index):", index, { tohit: tohitVal, accuracy: accVal });
        const result = await sheet.actor.setPeasantSkillToHitAccuracy?.(index, { tohit: tohitVal, accuracy: accVal });
        const savedSkill = result?.skills?.[index] || {};
        if (tohitEl) tohitEl.value = formatOptionalIntegerInput(savedSkill.tohit ?? parseOptionalInteger(tohitVal, { min: 1 }));
        if (accEl) accEl.value = formatOptionalIntegerInput(savedSkill.accuracy ?? parseOptionalInteger(accVal, { allowSign: true }), { showPlus: true });
        if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
      });
    } catch (err) {
      console.warn("Failed to persist skill tohit/accuracy change (per-field):", err);
    }
  });

  delegate(root, "change", ".skill-uses-current", async (ev, input) => {
    const idx = resolveItemIndex(input, { dataKey: "index", rowSelector: ".skill-item", rowAttr: "data-skill-index" });
    if (idx < 0) return;

    const raw = Number.isNaN(Number.parseInt(input.value, 10)) ? 0 : Number.parseInt(input.value, 10);

    try {
      await runQueued(input, "_skillsSaveQueue", "Skill usesCurrent change", async () => {
        const result = await sheet.actor.setPeasantSkillUsesCurrent?.(idx, raw);
        if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
      });
    } catch (err) {
      console.warn("Failed to persist usesCurrent change (per-field):", err);
    }
  });

  delegate(root, "change", ".skill-class, .skill-rank, .skill-name, .skill-ap, .skill-sp, .skill-special-grade", async (ev, input) => {
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".skill-item", rowAttr: "data-skill-index" });
    if (index < 0) return;
    const row = input.closest(".skill-item");

    try {
      await runQueued(input, "_skillsSaveQueue", "Skill main field change", async () => {
        const classEl = qs(row, ".skill-class");
        const rankEl = qs(row, ".skill-rank");
        const nameEl = qs(row, ".skill-name");
        const apEl = qs(row, ".skill-ap");
        const spEl = qs(row, ".skill-sp");
        const specialGradeEl = qs(row, ".skill-special-grade");

        const fields = {};
        if (classEl) fields.class = classEl.value;
        if (rankEl) fields.rank = rankEl.value;
        if (nameEl) fields.name = nameEl.value;
        if (apEl) fields.ap = apEl.value;
        if (spEl) fields.sp = spEl.value;
        if (specialGradeEl) fields.specialGrade = specialGradeEl.value;

        pcLog.debug("Persisting skill class/rank/name/ap/sp (index):", index, fields);
        const result = await sheet.actor.setPeasantSkillMainFields?.(index, fields);
        const savedSkill = result?.skills?.[index] || {};
        if (apEl) apEl.value = formatOptionalIntegerInput(savedSkill.ap ?? parseOptionalInteger(fields.ap, { min: 0 }));
        if (spEl) spEl.value = formatOptionalIntegerInput(savedSkill.sp ?? parseOptionalInteger(fields.sp, { min: 0 }));
        if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
      });
    } catch (err) {
      console.warn("Failed to persist skill class/rank/name/ap/sp change:", err);
    }
  });

  delegate(root, "click", ".skill-name-wrapper, .skill-name-view.skill-has-desc", async (ev, current) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      const target = ev.target;
      const wrapper = current.classList.contains("skill-name-wrapper") ? current : current.closest(".skill-name-wrapper");
      const nameSpan = current.classList.contains("skill-name-view")
        ? current
        : current.querySelector(".skill-name-view.skill-has-desc");

      let index = Number(wrapper?.dataset.index);
      if (Number.isNaN(index)) index = Number(nameSpan?.dataset.index);
      if (Number.isNaN(index)) index = Number(target?.closest?.(".skill-name-view.skill-has-desc")?.dataset.index);
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
  const root = toElement(html);
  for (const button of qsa(root, ".skill-delete")) {
    button.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!sheet.isEditMode) return;
      await blurActiveEditableInSheet?.();
      const row = button.closest(".skill-item");
      const index = resolveRowIndex(row, "data-skill-index");
      if (Number.isNaN(index)) return;
      await enqueue("_skillsSaveQueue", "Skill delete backup", async () => {
        await sheet.actor.removePeasantSkill?.(index);
      });
    });
  }
}

function setupRankInputControls(html) {
  for (const inputElement of qsa(html, ".skill-rank, .combat-rank")) {
    inputElement.addEventListener("keydown", (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const key = ev.key;
      const isNav = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", "Enter", "Home", "End"].includes(key);
      if (isNav) return;
      if (!/^[1234uU]$/.test(key)) {
        ev.preventDefault();
      }
    });

    inputElement.addEventListener("input", (ev) => {
      const input = ev.currentTarget;
      const before = input.value || "";
      const normalized = normalizeRankValue(before);
      if (normalized !== before) input.value = normalized;
    });

    const finalizeRank = (ev) => {
      const input = ev.currentTarget;
      const normalized = normalizeRankValue(input.value);
      const finalVal = normalized === "" ? "1" : normalized;
      if (finalVal !== input.value) input.value = finalVal;
    };
    inputElement.addEventListener("change", finalizeRank);
    inputElement.addEventListener("blur", finalizeRank);
  }
}

function normalizeRankValue(raw) {
  const match = String(raw || "").match(/[1234uU]/);
  return match ? match[0] : "";
}

function sanitizeOptionalIntegerInputElement(input, options = {}) {
  if (!input) return;
  const before = String(input.value ?? "");
  const normalized = sanitizeOptionalIntegerInputValue(before, options);
  if (normalized === before) return;

  const pos = input.selectionStart ?? before.length;
  const normalizedBeforeCursor = sanitizeOptionalIntegerInputValue(before.slice(0, pos), options);
  input.value = normalized;
  const nextPos = Math.max(0, Math.min(normalized.length, normalizedBeforeCursor.length));
  try { input.setSelectionRange(nextPos, nextPos); } catch (e) { /* ignore */ }
}

function collectSkillsFromDOMForSig(sheet) {
  const skillEls = qsa(toElement(sheet.element), ".skills-list .skill-item");
  const skills = [];
  const existing = JSON.parse(JSON.stringify(sheet.actor.system.skills || []));
  for (let i = 0; i < skillEls.length; i++) {
    const el = skillEls[i];
    const hasSelect = !!qs(el, ".skill-select");
    const base = existing[i] || {};
    if (!hasSelect) {
      const cls = Number.parseInt(qs(el, ".skill-class")?.value, 10) || 1;
      const rkRaw = (qs(el, ".skill-rank")?.value || "").trim();
      let rk;
      if (rkRaw.toLowerCase() === "u") {
        rk = rkRaw;
      } else {
        const rkNum = Number.parseInt(rkRaw, 10);
        rk = Number.isNaN(rkNum) ? (base.rank ?? 0) : rkNum;
      }
      const usesMaxInput = qs(el, ".skill-uses-max");
      const usesMaxVal = usesMaxInput ? (Number.isNaN(Number.parseInt(usesMaxInput.value, 10)) ? 0 : Number.parseInt(usesMaxInput.value, 10)) : (base.usesMax || 0);
      const usesCurrentInput = qs(el, ".skill-uses-current");
      const usesCurrentVal = usesCurrentInput
        ? (Number.isNaN(Number.parseInt(usesCurrentInput.value, 10)) ? 0 : Number.parseInt(usesCurrentInput.value, 10))
        : (base.usesCurrent !== undefined ? base.usesCurrent : (usesMaxVal || 0));
      const baseGrade = Number.isNaN(Number.parseInt(base.specialGrade, 10)) ? 0 : Number.parseInt(base.specialGrade, 10);
      skills.push({
        type: "standard",
        class: cls,
        specialGrade: baseGrade,
        rank: rk,
        sig: !!qs(el, ".skill-sig-checkbox")?.checked,
        name: qs(el, ".skill-name")?.value || "",
        tohit: qs(el, ".skill-tohit")?.value || "",
        accuracy: qs(el, ".skill-accuracy")?.value || "",
        ap: qs(el, ".skill-ap")?.value || "",
        sp: qs(el, ".skill-sp")?.value || "",
        usesMax: usesMaxVal,
        usesCurrent: usesCurrentVal,
        indent: Number.parseInt(el.getAttribute("data-indent"), 10) || 0,
        description: base.description || ""
      });
    } else {
      const gradeInput = qs(el, ".skill-special-grade");
      const baseGrade = Number.isNaN(Number.parseInt(base.specialGrade, 10)) ? 0 : Number.parseInt(base.specialGrade, 10);
      const gradeVal = gradeInput ? (Number.isNaN(Number.parseInt(gradeInput.value, 10)) ? 0 : Number.parseInt(gradeInput.value, 10)) : baseGrade;
      skills.push({
        type: qs(el, ".skill-select")?.value || "standard",
        specialGrade: Math.max(0, gradeVal),
        name: qs(el, ".skill-name")?.value || "",
        tohit: qs(el, ".skill-tohit")?.value || "",
        accuracy: qs(el, ".skill-accuracy")?.value || "",
        ap: qs(el, ".skill-ap")?.value || "",
        sp: qs(el, ".skill-sp")?.value || "",
        indent: Number.parseInt(el.getAttribute("data-indent"), 10) || 0,
        description: base.description || ""
      });
    }
  }
  return skills;
}

function resolveItemIndex(source, { dataKey = "index", rowSelector = null, rowAttr = null } = {}) {
  const element = toElement(source);
  let index = Number.parseInt(element?.dataset?.[dataKey], 10);
  if (!Number.isNaN(index)) return index;

  if (rowSelector) {
    const row = element?.closest?.(rowSelector);
    if (row) {
      if (rowAttr) {
        index = Number.parseInt(row.getAttribute(rowAttr), 10);
        if (!Number.isNaN(index)) return index;
      }
      index = row.parentElement ? Array.from(row.parentElement.children).indexOf(row) : -1;
      if (!Number.isNaN(index)) return index;
    }
  }

  return -1;
}

function resolveRowIndex(row, attr) {
  const element = toElement(row);
  let index = Number.parseInt(element?.getAttribute(attr), 10);
  if (Number.isNaN(index) && element?.parentElement) index = Array.from(element.parentElement.children).indexOf(element);
  return index;
}
