import {
  COMBAT_COST_RESOURCE_TYPES,
  COMBAT_HALT_BUFF_TYPE_COST,
  COMBAT_HALT_BUFF_TYPE_CUSTOM,
  COMBAT_HALT_BUFF_TYPE_FLAT,
  COMBAT_HALT_BUFF_TYPE_HALT,
  COMBAT_HALT_BUFF_TYPE_NATURAL,
  normalizeHaltSlashValue,
  normalizeHaltSlashValueEditable,
  sanitizeCombatCostResourceType,
  sanitizeCombatHaltBuffs,
  sanitizeCombatHaltBuffType
} from "../../../data/actor/combat-modifiers.mjs";
import { computeBaseSaves } from "../../../data/actor/attributes.mjs";
import { applyToHitFloor } from "../../../dice/roll-targets.mjs";
import { delegate, qs, qsa, readStringInput, toElement } from "../../dom.mjs";

export function setupCombatModifierControls(sheet, html, { blurActiveEditableInSheet, enqueueSheetUpdate, runQueuedInputUpdate } = {}) {
  const root = toElement(html);
  if (!root) return;

  const getCombatHaltBuffsForUpdate = () => sheet.actor.getPeasantCombatHaltBuffsForUpdate?.() ?? sanitizeCombatHaltBuffs(sheet.actor?.system?.combatMods?.haltBuffs);
  const hasCombatHaltBuffType = (buffs, type) => buffs.some(buff => sanitizeCombatHaltBuffType(buff?.type) === type);
  const hasCombatCostBuffResource = (buffs, resourceType) => {
    const safeType = sanitizeCombatCostResourceType(resourceType);
    return buffs.some(buff =>
      sanitizeCombatHaltBuffType(buff?.type) === COMBAT_HALT_BUFF_TYPE_COST &&
      sanitizeCombatCostResourceType(buff?.resourceType) === safeType
    );
  };
  setupHaltInputSanitizer(root);
  setupHaltHardLocationToggle(sheet, root);
  const refreshCombatModifierHighlights = () => {
    for (const inputEl of qsa(root, ".combat-modifiers .combat-mod-input")) {
      let hasMod = false;

      if (inputEl.classList.contains("combat-halt-buff-input")) {
        hasMod = normalizeHaltSlashValue(inputEl.value) !== "0/0/0/0";
      } else if (inputEl.type === "number") {
        hasMod = (Number.parseInt(inputEl.value, 10) || 0) !== 0;
      }

      inputEl.classList.toggle("has-mod", hasMod);
    }
  };
  refreshCombatModifierHighlights();

  delegate(root, "input", ".combat-modifiers .combat-mod-input", refreshCombatModifierHighlights);
  delegate(root, "change", ".combat-modifiers .combat-mod-input", refreshCombatModifierHighlights);

  delegate(root, "click", ".add-combat-halt-buff", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditable) return;
    await blurActiveEditableInSheet?.();

    const existing = getCombatHaltBuffsForUpdate();
    const options = [];
    const availableCostResourceTypes = COMBAT_COST_RESOURCE_TYPES.filter(type => !hasCombatCostBuffResource(existing, type));
    if (!hasCombatHaltBuffType(existing, COMBAT_HALT_BUFF_TYPE_HALT)) options.push({ type: COMBAT_HALT_BUFF_TYPE_HALT, label: "HALT" });
    if (!hasCombatHaltBuffType(existing, COMBAT_HALT_BUFF_TYPE_NATURAL)) options.push({ type: COMBAT_HALT_BUFF_TYPE_NATURAL, label: "Nat HALT" });
    if (!hasCombatHaltBuffType(existing, COMBAT_HALT_BUFF_TYPE_FLAT)) options.push({ type: COMBAT_HALT_BUFF_TYPE_FLAT, label: "Flat" });
    if (availableCostResourceTypes.length > 0) options.push({ type: COMBAT_HALT_BUFF_TYPE_COST, label: "Resource Cost" });
    options.push({ type: COMBAT_HALT_BUFF_TYPE_CUSTOM, label: "Custom" });

    if (!options.length) {
      ui.notifications?.info?.("No additional buff types available.");
      return;
    }

    const optionsHtml = options.map(opt => `<option value="${opt.type}">${opt.label}</option>`).join("");
    const resourceOptionsHtml = availableCostResourceTypes
      .map(type => `<option value="${type}">${type}</option>`)
      .join("");
    sheet._renderDialog({
      title: "Add Buff",
      content: `
        <form>
          <div class="form-group" style="margin-bottom: 10px;">
            <label style="display: block; margin-bottom: 5px;">Buff Type</label>
            <select name="combatBuffType" class="pc-macro-input pc-select pc-dialog-field-full">
              ${optionsHtml}
            </select>
          </div>
          <div class="form-group combat-cost-type-group" style="margin-bottom: 10px; display: none;">
            <label style="display: block; margin-bottom: 5px;">Resource Type</label>
            <select name="combatCostResourceType" class="pc-macro-input pc-select pc-dialog-field-full">
              ${resourceOptionsHtml}
            </select>
          </div>
          <div class="form-group combat-custom-group" style="margin-bottom: 10px; display: none;">
            <label style="display: block; margin-bottom: 5px;">Custom Name</label>
            <input type="text" name="combatCustomBuffName" class="pc-macro-input pc-input pc-dialog-field-full" placeholder="Custom Buff">
            <label style="display: block; margin-bottom: 5px; margin-top: 8px;">Value</label>
            <input type="number" name="combatCustomBuffValue" class="pc-macro-input pc-input pc-dialog-field-full" value="0" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*">
          </div>
        </form>
      `,
      buttons: {
        add: {
          icon: '<i class="fas fa-plus"></i>',
          label: "Add",
          callback: async (dlgHtml) => {
            const dialogRoot = toElement(dlgHtml);
            const selectedType = sanitizeCombatHaltBuffType(readStringInput(dialogRoot, '[name="combatBuffType"]'));
            const selectedResourceType = sanitizeCombatCostResourceType(readStringInput(dialogRoot, '[name="combatCostResourceType"]'));
            const customName = readStringInput(dialogRoot, '[name="combatCustomBuffName"]').trim() || "Custom";
            const customValue = Number.parseInt(readStringInput(dialogRoot, '[name="combatCustomBuffValue"]'), 10) || 0;
            const result = await sheet.actor.addPeasantCombatHaltBuff?.(selectedType, {
              resourceType: selectedResourceType,
              customName,
              value: customValue
            });
            if (result?.reason === "duplicate-cost") {
              ui.notifications?.info?.(`${result.resourceType || selectedResourceType} cost buff already exists.`);
            }
            sheet.render(false);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "add",
      render: (dlgHtml) => {
        const dialogRoot = toElement(dlgHtml);
        const typeSelect = qs(dialogRoot, '[name="combatBuffType"]');
        const resourceGroup = qs(dialogRoot, ".combat-cost-type-group");
        const customGroup = qs(dialogRoot, ".combat-custom-group");
        const refreshVisibility = () => {
          const selectedType = sanitizeCombatHaltBuffType(typeSelect?.value);
          if (resourceGroup) resourceGroup.style.display = selectedType === COMBAT_HALT_BUFF_TYPE_COST ? "" : "none";
          if (customGroup) customGroup.style.display = selectedType === COMBAT_HALT_BUFF_TYPE_CUSTOM ? "" : "none";
        };
        typeSelect?.addEventListener("change", refreshVisibility);
        refreshVisibility();
      }
    }, { classes: ["peasant-macro-dialog"] });
  });

  delegate(root, "click", ".remove-combat-halt-buff", async (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditable) return;
    const index = Number.parseInt(target.dataset.buffIndex, 10);
    if (!Number.isFinite(index) || index < 0) return;

    await enqueueSheetUpdate?.("_combatSaveQueue", "Remove combat HALT buff", async () => {
      await sheet.actor.removePeasantCombatHaltBuff?.(index, { render: false });
    });
    sheet.render(false);
  });

  delegate(root, "input", ".combat-halt-buff-input", (ev) => {
    if (!sheet.isEditable) return;
    const inputEl = ev.currentTarget;
    const before = String(inputEl.value ?? "");
    const pos = inputEl.selectionStart ?? before.length;
    const normalized = normalizeHaltSlashValueEditable(before);
    if (normalized !== before) {
      const delta = normalized.length - before.length;
      const nextPos = Math.max(0, Math.min(normalized.length, pos + delta));
      inputEl.value = normalized;
      try { inputEl.setSelectionRange(nextPos, nextPos); } catch (e) { /* ignore */ }
    }
  });

  const handleCombatHaltBuffCommit = async (ev, input) => {
    if (!sheet.isEditable) return;
    const index = Number.parseInt(input.dataset.buffIndex, 10);
    if (!Number.isFinite(index) || index < 0) return;
    const normalized = normalizeHaltSlashValue(input.value);
    if (normalized !== input.value) input.value = normalized;

    await runQueuedInputUpdate?.(input, "_combatSaveQueue", "Combat HALT buff values change", async () => {
      await sheet.actor.setPeasantCombatHaltBuffValues?.(index, input.value, { render: false });
    });
    refreshCombatModifierHighlights();
    sheet.render(false);
  };
  delegate(root, "change", ".combat-halt-buff-input", handleCombatHaltBuffCommit);
  delegate(root, "blur", ".combat-halt-buff-input", handleCombatHaltBuffCommit, true);

  delegate(root, "change", ".combat-flat-buff-input, .combat-cost-buff-value, .combat-custom-buff-value", async (ev, input) => {
    if (!sheet.isEditable) return;
    const index = Number.parseInt(input.dataset.buffIndex, 10);
    if (!Number.isFinite(index) || index < 0) return;
    const normalizedValue = Number.parseInt(input.value, 10) || 0;
    if (String(normalizedValue) !== String(input.value)) input.value = String(normalizedValue);

    await runQueuedInputUpdate?.(input, "_combatSaveQueue", "Combat numeric buff value change", async () => {
      await sheet.actor.setPeasantCombatHaltBuffValue?.(index, normalizedValue, { render: false });
    });
    refreshCombatModifierHighlights();
    sheet.render(false);
  });

  const handleCustomBuffNameCommit = async (ev, input) => {
    if (!sheet.isEditable) return;
    const index = Number.parseInt(input.dataset.buffIndex, 10);
    if (!Number.isFinite(index) || index < 0) return;
    const normalizedName = String(input.value ?? "").trim() || "Custom";
    if (normalizedName !== input.value) input.value = normalizedName;

    await runQueuedInputUpdate?.(input, "_combatSaveQueue", "Combat custom buff name change", async () => {
      await sheet.actor.setPeasantCombatCustomBuffName?.(index, normalizedName, { render: false });
    });
    sheet.render(false);
  };
  delegate(root, "change", ".combat-custom-buff-name", handleCustomBuffNameCommit);
  delegate(root, "blur", ".combat-custom-buff-name", handleCustomBuffNameCommit, true);

  delegate(root, "change", ".combat-cost-buff-resource", async (ev, select) => {
    if (!sheet.isEditable) return;
    const index = Number.parseInt(select.dataset.buffIndex, 10);
    if (!Number.isFinite(index) || index < 0) return;
    const selectedResourceType = sanitizeCombatCostResourceType(select.value);

    await runQueuedInputUpdate?.(select, "_combatSaveQueue", "Combat cost buff resource type change", async () => {
      const result = await sheet.actor.setPeasantCombatCostBuffResource?.(index, selectedResourceType, { render: false });
      if (result?.reason === "duplicate-cost") ui.notifications?.info?.(`${result.resourceType || selectedResourceType} cost buff already exists.`);
    });
    sheet.render(false);
  });

  setupReflexAoeSaveControls(sheet, root);
}

function setupHaltInputSanitizer(html) {
  const normalizeHaltValue = (raw) => normalizeHaltSlashValueEditable(raw);
  const finalizeHaltValue = (raw) => normalizeHaltSlashValue(raw);

  const haltInputs = qsa(html, 'input[name="system.haltValues"], input[name="system.naturalHaltValues"]');
  for (const el of haltInputs) {
    const normalized = normalizeHaltValue(el.value);
    if (normalized !== el.value) el.value = normalized;
  }

  for (const inputElement of haltInputs) {
    inputElement.addEventListener("keydown", (ev) => {
      if (ev.key !== "Backspace" && ev.key !== "Delete") return;
      const input = ev.currentTarget;
      const value = input.value || "";
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? start;
      if (start !== end) return;
      if (ev.key === "Backspace" && start > 0 && value[start - 1] === "/") {
        ev.preventDefault();
      }
      if (ev.key === "Delete" && value[start] === "/") {
        ev.preventDefault();
      }
    });

    inputElement.addEventListener("input", (ev) => {
      const input = ev.currentTarget;
      const before = input.value || "";
      const pos = input.selectionStart ?? before.length;
      const normalized = normalizeHaltValue(before);
      if (normalized !== before) {
        const delta = normalized.length - before.length;
        const nextPos = Math.max(0, Math.min(normalized.length, pos + delta));
        input.value = normalized;
        try { input.setSelectionRange(nextPos, nextPos); } catch (e) { /* ignore */ }
      }
    });

    const finalizeInput = (ev) => {
      const input = ev.currentTarget;
      const finalized = finalizeHaltValue(input.value || "");
      if (finalized !== input.value) input.value = finalized;
    };
    inputElement.addEventListener("change", finalizeInput);
    inputElement.addEventListener("blur", finalizeInput);
  }
}

function setupHaltHardLocationToggle(sheet, html) {
  delegate(html, "click", ".halt-letter", async (ev, target) => {
    if (!sheet.isEditMode) return;
    const loc = target.dataset.loc;
    const type = target.dataset.type;

    await sheet.actor.togglePeasantHardLocation?.(loc, type);
  });
}

function setupReflexAoeSaveControls(sheet, html) {
  const getDefaultReflexAoeSaveTarget = () => {
    const combatMods = sheet.actor.system.combatMods || { toHit: 0 };
    const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
    const baseSaves = computeBaseSaves(sheet.actor.system);
    const reflexBase = Number.isFinite(baseSaves.reflex) ? baseSaves.reflex : 7;
    return applyToHitFloor(reflexBase, toHitMod, 2).toHit;
  };

  delegate(html, "click", ".reflex-aoe-add", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    const defaultTarget = getDefaultReflexAoeSaveTarget();
    await sheet.actor.setPeasantReflexAoeSave?.(true, String(defaultTarget));
    setTimeout(() => {
      const input = qs(toElement(sheet.element), ".reflex-aoe-save-input");
      if (!input) return;
      try {
        input.focus();
        input.select?.();
      } catch (e) {
        /* ignore */
      }
    }, 40);
  });

  delegate(html, "click", ".reflex-aoe-remove", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await sheet.actor.setPeasantReflexAoeSave?.(false);
  });

  delegate(html, "input", ".reflex-aoe-save-input", (ev) => {
    if (!sheet.isEditMode) return;
    const inputEl = ev.currentTarget;
    const before = String(inputEl.value ?? "");
    const digitsOnly = before.replace(/[^\d]/g, "");
    if (digitsOnly !== before) {
      const pos = inputEl.selectionStart ?? before.length;
      const delta = digitsOnly.length - before.length;
      inputEl.value = digitsOnly;
      const nextPos = Math.max(0, Math.min(digitsOnly.length, pos + delta));
      try { inputEl.setSelectionRange(nextPos, nextPos); } catch (e) { /* ignore */ }
    }
    sheet._scheduleEditAutosaveChange(inputEl, 260);
  });

  const normalizeReflexAoeInput = (ev, input) => {
    if (!sheet.isEditMode) return;
    const raw = String(input.value ?? "").trim();
    if (!raw) {
      input.value = "";
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    const normalized = Number.isFinite(parsed) ? String(Math.max(2, parsed)) : "";
    if (normalized !== raw) input.value = normalized;
  };
  delegate(html, "change", ".reflex-aoe-save-input", normalizeReflexAoeInput);
  delegate(html, "blur", ".reflex-aoe-save-input", normalizeReflexAoeInput, true);
}
