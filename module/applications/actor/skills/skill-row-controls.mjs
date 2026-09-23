import { showReadonlyDescriptionDialog } from "../controls/description-dialogs.mjs";
import { formatOptionalIntegerInput, parseOptionalInteger } from "../../../data/actor/helpers.mjs";
import { getActorSourceSystem, resolveItemIndex, resolveRowIndex, sanitizeOptionalIntegerInputElement } from "../controls/sheet-listener-helpers.mjs";
import { delegate, qs, qsa, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";
import { openSkillEditor } from "./skill-editor.mjs";

export function setupSkillRowControls(sheet, html, { blurActiveEditableInSheet, enqueue, runQueued } = {}) {
  const root = toElement(html);
  if (!root) return;

  setupRankInputControls(root);

  delegate(root, "click", ".skill-edit-btn", async (ev, button) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = button.closest(".skill-item");
    const index = resolveRowIndex(row, "data-skill-index");
    if (Number.isNaN(index)) return;
    await sheet.actor.ensurePeasantEntryIds?.("skills");
    const skill = getActorSourceSystem(sheet.actor).skills?.[index];
    if (!skill?.id) return;
    await openSkillEditor(sheet, { collection: "skills", entryId: skill.id });
  });

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
      await sheet.actor.setPeasantSkillType?.(index, "Custom");
    });
  });

  delegate(root, "change", ".skill-select", async (ev, select) => {
    if (!sheet.isEditMode) return;
    const newType = select.value || "skill";
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
        const currentSkill = getActorSourceSystem(sheet.actor).skills?.[index] || {};
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
