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

export function setupCombatModifierControls(sheet, html, { blurActiveEditableInSheet, enqueueSheetUpdate, runQueuedInputUpdate } = {}) {
  const getCombatHaltBuffsForUpdate = () => sheet.actor.getPeasantCombatHaltBuffsForUpdate?.() ?? sanitizeCombatHaltBuffs(sheet.actor?.system?.combatMods?.haltBuffs);
  const hasCombatHaltBuffType = (buffs, type) => buffs.some(buff => sanitizeCombatHaltBuffType(buff?.type) === type);
  const hasCombatCostBuffResource = (buffs, resourceType) => {
    const safeType = sanitizeCombatCostResourceType(resourceType);
    return buffs.some(buff =>
      sanitizeCombatHaltBuffType(buff?.type) === COMBAT_HALT_BUFF_TYPE_COST &&
      sanitizeCombatCostResourceType(buff?.resourceType) === safeType
    );
  };
  setupHaltInputSanitizer(html);
  setupHaltHardLocationToggle(sheet, html);
  const refreshCombatModifierHighlights = () => {
    html.find(".combat-modifiers .combat-mod-input").each((_, inputEl) => {
      const $input = $(inputEl);
      let hasMod = false;

      if ($input.hasClass("combat-halt-buff-input")) {
        hasMod = normalizeHaltSlashValue($input.val()) !== "0/0/0/0";
      } else if (inputEl.type === "number") {
        hasMod = (Number.parseInt($input.val(), 10) || 0) !== 0;
      }

      $input.toggleClass("has-mod", hasMod);
    });
  };
  refreshCombatModifierHighlights();

  html.on("input change", ".combat-modifiers .combat-mod-input", () => {
    refreshCombatModifierHighlights();
  });

  html.on("click", ".add-combat-halt-buff", async (ev) => {
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
            <select name="combatBuffType" class="pc-macro-input" style="width: 100%;">
              ${optionsHtml}
            </select>
          </div>
          <div class="form-group combat-cost-type-group" style="margin-bottom: 10px; display: none;">
            <label style="display: block; margin-bottom: 5px;">Resource Type</label>
            <select name="combatCostResourceType" class="pc-macro-input" style="width: 100%;">
              ${resourceOptionsHtml}
            </select>
          </div>
          <div class="form-group combat-custom-group" style="margin-bottom: 10px; display: none;">
            <label style="display: block; margin-bottom: 5px;">Custom Name</label>
            <input type="text" name="combatCustomBuffName" class="pc-macro-input" style="width: 100%;" placeholder="Custom Buff">
            <label style="display: block; margin-bottom: 5px; margin-top: 8px;">Value</label>
            <input type="number" name="combatCustomBuffValue" class="pc-macro-input" style="width: 100%;" value="0">
          </div>
        </form>
      `,
      buttons: {
        add: {
          icon: '<i class="fas fa-plus"></i>',
          label: "Add",
          callback: async (dlgHtml) => {
            const selectedType = sanitizeCombatHaltBuffType(dlgHtml.find('[name="combatBuffType"]').val());
            const selectedResourceType = sanitizeCombatCostResourceType(dlgHtml.find('[name="combatCostResourceType"]').val());
            const customName = String(dlgHtml.find('[name="combatCustomBuffName"]').val() ?? "").trim() || "Custom";
            const customValue = Number.parseInt(dlgHtml.find('[name="combatCustomBuffValue"]').val(), 10) || 0;
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
        const typeSelect = dlgHtml.find('[name="combatBuffType"]');
        const resourceGroup = dlgHtml.find(".combat-cost-type-group");
        const customGroup = dlgHtml.find(".combat-custom-group");
        const refreshVisibility = () => {
          const selectedType = sanitizeCombatHaltBuffType(typeSelect.val());
          resourceGroup.css("display", selectedType === COMBAT_HALT_BUFF_TYPE_COST ? "" : "none");
          customGroup.css("display", selectedType === COMBAT_HALT_BUFF_TYPE_CUSTOM ? "" : "none");
        };
        typeSelect.on("change", refreshVisibility);
        refreshVisibility();
      }
    }, { classes: ["peasant-macro-dialog"] });
  });

  html.on("click", ".remove-combat-halt-buff", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditable) return;
    const index = Number.parseInt($(ev.currentTarget).data("buffIndex"), 10);
    if (!Number.isFinite(index) || index < 0) return;

    await enqueueSheetUpdate?.("_combatSaveQueue", "Remove combat HALT buff", async () => {
      await sheet.actor.removePeasantCombatHaltBuff?.(index, { render: false });
    });
    sheet.render(false);
  });

  html.on("input", ".combat-halt-buff-input", (ev) => {
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

  html.on("change blur", ".combat-halt-buff-input", async (ev) => {
    if (!sheet.isEditable) return;
    const input = $(ev.currentTarget);
    const index = Number.parseInt(input.data("buffIndex"), 10);
    if (!Number.isFinite(index) || index < 0) return;
    const normalized = normalizeHaltSlashValue(input.val());
    if (normalized !== input.val()) input.val(normalized);

    await runQueuedInputUpdate?.(input, "_combatSaveQueue", "Combat HALT buff values change", async () => {
      await sheet.actor.setPeasantCombatHaltBuffValues?.(index, input.val(), { render: false });
    });
    refreshCombatModifierHighlights();
    sheet.render(false);
  });

  html.on("change", ".combat-flat-buff-input, .combat-cost-buff-value, .combat-custom-buff-value", async (ev) => {
    if (!sheet.isEditable) return;
    const input = $(ev.currentTarget);
    const index = Number.parseInt(input.data("buffIndex"), 10);
    if (!Number.isFinite(index) || index < 0) return;
    const normalizedValue = Number.parseInt(input.val(), 10) || 0;
    if (String(normalizedValue) !== String(input.val())) input.val(normalizedValue);

    await runQueuedInputUpdate?.(input, "_combatSaveQueue", "Combat numeric buff value change", async () => {
      await sheet.actor.setPeasantCombatHaltBuffValue?.(index, normalizedValue, { render: false });
    });
    refreshCombatModifierHighlights();
    sheet.render(false);
  });

  html.on("change blur", ".combat-custom-buff-name", async (ev) => {
    if (!sheet.isEditable) return;
    const input = $(ev.currentTarget);
    const index = Number.parseInt(input.data("buffIndex"), 10);
    if (!Number.isFinite(index) || index < 0) return;
    const normalizedName = String(input.val() ?? "").trim() || "Custom";
    if (normalizedName !== input.val()) input.val(normalizedName);

    await runQueuedInputUpdate?.(input, "_combatSaveQueue", "Combat custom buff name change", async () => {
      await sheet.actor.setPeasantCombatCustomBuffName?.(index, normalizedName, { render: false });
    });
    sheet.render(false);
  });

  html.on("change", ".combat-cost-buff-resource", async (ev) => {
    if (!sheet.isEditable) return;
    const select = $(ev.currentTarget);
    const index = Number.parseInt(select.data("buffIndex"), 10);
    if (!Number.isFinite(index) || index < 0) return;
    const selectedResourceType = sanitizeCombatCostResourceType(select.val());

    await runQueuedInputUpdate?.(select, "_combatSaveQueue", "Combat cost buff resource type change", async () => {
      const result = await sheet.actor.setPeasantCombatCostBuffResource?.(index, selectedResourceType, { render: false });
      if (result?.reason === "duplicate-cost") ui.notifications?.info?.(`${result.resourceType || selectedResourceType} cost buff already exists.`);
    });
    sheet.render(false);
  });

  setupReflexAoeSaveControls(sheet, html);
}

function setupHaltInputSanitizer(html) {
  const normalizeHaltValue = (raw) => normalizeHaltSlashValueEditable(raw);
  const finalizeHaltValue = (raw) => normalizeHaltSlashValue(raw);

  const haltInputs = html.find('input[name="system.haltValues"], input[name="system.naturalHaltValues"]');
  haltInputs.each((_, el) => {
    const normalized = normalizeHaltValue(el.value);
    if (normalized !== el.value) el.value = normalized;
  });

  haltInputs.on("keydown", (ev) => {
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

  haltInputs.on("input", (ev) => {
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

  haltInputs.on("change blur", (ev) => {
    const input = ev.currentTarget;
    const finalized = finalizeHaltValue(input.value || "");
    if (finalized !== input.value) input.value = finalized;
  });
}

function setupHaltHardLocationToggle(sheet, html) {
  html.find(".halt-letter").click(async (ev) => {
    if (!sheet.isEditMode) return;
    const el = $(ev.currentTarget);
    const loc = el.data("loc");
    const type = el.data("type");

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

  html.on("click", ".reflex-aoe-add", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    const defaultTarget = getDefaultReflexAoeSaveTarget();
    await sheet.actor.setPeasantReflexAoeSave?.(true, String(defaultTarget));
    setTimeout(() => {
      const input = sheet._getSheetJQ().find(".reflex-aoe-save-input").first();
      if (!input.length) return;
      try {
        input.trigger("focus");
        input[0]?.select?.();
      } catch (e) {
        /* ignore */
      }
    }, 40);
  });

  html.on("click", ".reflex-aoe-remove", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await sheet.actor.setPeasantReflexAoeSave?.(false);
  });

  html.on("input", ".reflex-aoe-save-input", (ev) => {
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

  html.on("change blur", ".reflex-aoe-save-input", (ev) => {
    if (!sheet.isEditMode) return;
    const input = $(ev.currentTarget);
    const raw = String(input.val() ?? "").trim();
    if (!raw) {
      input.val("");
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    const normalized = Number.isFinite(parsed) ? String(Math.max(2, parsed)) : "";
    if (normalized !== raw) input.val(normalized);
  });
}
