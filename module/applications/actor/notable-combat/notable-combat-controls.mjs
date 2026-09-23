import { showReadonlyDescriptionDialog } from "../controls/description-dialogs.mjs";
import { formatOptionalIntegerInput, parseOptionalInteger } from "../../../data/actor/helpers.mjs";
import { resolveItemIndex, resolveRowIndex, sanitizeOptionalIntegerInputElement } from "../controls/sheet-listener-helpers.mjs";
import { delegate, qs, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

const PC_SYSTEM_ID = "peasant-core";
export const PC_NOTABLE_COMBAT_TAG_VISIBILITY_SETTING = "notableCombatTagVisibility";

export function registerNotableCombatClientSettings() {
  game.settings.register(PC_SYSTEM_ID, PC_NOTABLE_COMBAT_TAG_VISIBILITY_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
}

export function setupNotableCombatControls(sheet, html, {
  blurActiveEditableInSheet,
  enqueueSheetUpdate,
  runQueuedInputUpdate,
  openCombatEditor
} = {}) {
  const root = toElement(html);
  if (!root) return;

  const enqueue = enqueueSheetUpdate ?? (async (_queueKey, _label, task) => task());
  const runQueued = runQueuedInputUpdate ?? (async (_input, _queueKey, _label, task) => task());

  setupNotableCombatTagVisibilityToggle(sheet, root);

  setupNotableCombatContextMenu(sheet, root, {
    blurActiveEditableInSheet,
    enqueue,
    openCombatEditor
  });

  delegate(root, "click", ".add-combat-btn", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    await enqueue("_combatSaveQueue", "Combat add", async () => {
      await sheet.actor.addPeasantNotableCombat?.();
    });
  });

  delegate(root, "click", ".combat-toggle-type", async (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    const row = target.closest(".combat-item");
    const index = resolveRowIndex(row, "data-combat-index");
    if (Number.isNaN(index)) return;
    await enqueue("_combatSaveQueue", "Combat type toggle", async () => {
      await sheet.actor.setPeasantNotableCombatType?.(index, "Custom");
    });
  });

  delegate(root, "change", ".combat-select", async (ev, select) => {
    if (!sheet.isEditMode) return;
    const newType = select.value || "skill";
    const row = select.closest(".combat-item");
    const index = resolveRowIndex(row, "data-combat-index");
    if (Number.isNaN(index)) return;
    await enqueue("_combatSaveQueue", "Combat type select", async () => {
      await sheet.actor.setPeasantNotableCombatType?.(index, newType);
    });
  });

  delegate(root, "input", ".combat-tohit", (ev, input) => {
    if (!sheet.isEditMode) return;
    sanitizeOptionalIntegerInputElement(input);
  });

  delegate(root, "input", ".combat-accuracy", (ev, input) => {
    if (!sheet.isEditMode) return;
    sanitizeOptionalIntegerInputElement(input, { allowSign: true });
  });

  delegate(root, "change", ".combat-class, .combat-rank, .combat-name, .combat-tohit, .combat-accuracy, .combat-special-grade", async (ev, input) => {
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
    if (index < 0) return;
    const row = input.closest(".combat-item");

    try {
      await runQueued(input, "_combatSaveQueue", "Combat main field change", async () => {
        const classEl = qs(row, ".combat-class");
        const rankEl = qs(row, ".combat-rank");
        const nameEl = qs(row, ".combat-name");
        const tohitEl = qs(row, ".combat-tohit");
        const accuracyEl = qs(row, ".combat-accuracy");
        const specialGradeEl = qs(row, ".combat-special-grade");

        const fields = {};
        if (classEl) fields.class = classEl.value;
        if (rankEl) fields.rank = rankEl.value;
        if (nameEl) fields.name = nameEl.value;
        if (tohitEl) fields.tohit = tohitEl.value;
        if (accuracyEl) fields.accuracy = accuracyEl.value;
        if (specialGradeEl) fields.specialGrade = specialGradeEl.value;

        const result = await sheet.actor.setPeasantNotableCombatMainFields?.(index, fields);
        const savedCombat = result?.combats?.[index] || {};
        if (tohitEl) tohitEl.value = formatOptionalIntegerInput(savedCombat.tohit ?? parseOptionalInteger(fields.tohit, { min: 1 }));
        if (accuracyEl) accuracyEl.value = formatOptionalIntegerInput(savedCombat.accuracy ?? parseOptionalInteger(fields.accuracy, { allowSign: true }), { showPlus: true });
      });
    } catch (err) {
      console.warn("Failed to persist combat field change:", err);
    }
  });

  delegate(root, "change", ".combat-uses-max", async (ev, input) => {
    if (!sheet.isEditMode) return;

    const index = resolveItemIndex(input, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
    if (index < 0) return;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat usesMax change", async () => {
        await sheet.actor.setPeasantNotableCombatUsesMax?.(index, input.value);
      });
    } catch (err) {
      console.warn("Failed to persist combat usesMax change:", err);
    }
  });

  delegate(root, "change", ".combat-uses-current", async (ev, input) => {
    const idx = resolveItemIndex(input, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
    if (idx < 0) return;

    const raw = Number.parseInt(input.value, 10) || 0;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat usesCurrent change", async () => {
        await sheet.actor.setPeasantNotableCombatUsesCurrent?.(idx, raw);
      });
    } catch (err) {
      console.warn("Failed to persist combat usesCurrent change:", err);
    }
  });

  delegate(root, "change", ".combat-tag-sections-current", async (ev, input) => {
    const idx = resolveCombatTagInputIndex(input);
    if (idx < 0) return;

    const raw = Number.parseInt(input.value, 10) || 0;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat sections current change", async () => {
        await sheet.actor.setPeasantNotableCombatSectionsCurrent?.(idx, raw);
      });
    } catch (err) {
      console.warn("Failed to persist combat sections current change:", err);
    }
  });

  delegate(root, "change", ".combat-tag-splitsecond-current", async (ev, input) => {
    const idx = resolveCombatTagInputIndex(input);
    if (idx < 0) return;

    const raw = Number.parseInt(input.value, 10) || 0;

    try {
      await runQueued(input, "_combatSaveQueue", "Combat split second current change", async () => {
        await sheet.actor.setPeasantNotableCombatSplitSecondCurrent?.(idx, raw);
      });
    } catch (err) {
      console.warn("Failed to persist combat split second current change:", err);
    }
  });

  delegate(root, "change", ".combat-tag-uses-current", async (ev, input) => {
    try {
      ev.preventDefault();
      await runQueued(input, "_combatSaveQueue", "Combat tag uses current change", async () => {
        const index = Number(input.dataset.index);
        if (Number.isNaN(index) || index < 0) return;

        const newVal = Math.max(0, Number.parseInt(input.value, 10) || 0);
        await sheet.actor.setPeasantNotableCombatTagUsesCurrent?.(index, newVal);
      });
    } catch (e) {
      pcLog.debug("combat-tag-uses-current change failed", e);
    }
  });

  delegate(root, "click", ".combat-name-view.combat-has-desc", async (ev, element) => {
    try {
      ev.preventDefault();
      ev.stopPropagation();
      const index = Number(element.dataset.index);
      if (Number.isNaN(index)) return;

      const combats = sheet.actor.system.notableCombats || [];
      const combat = combats[index] || {};
      const description = combat.description || "";
      const combatName = combat.name || "Combat";

      await showReadonlyDescriptionDialog(sheet, {
        title: `${combatName} - Description`,
        description
      });
    } catch (e) {
      pcLog.debug("combat-name-view click failed", e);
    }
  });
}

function getContextMenuClass() {
  return globalThis.foundry?.applications?.ux?.ContextMenu?.implementation
    ?? globalThis.ContextMenu?.implementation
    ?? globalThis.ContextMenu
    ?? null;
}

function getCombatIndexFromElement(element) {
  const row = element?.closest?.(".combat-view-item");
  return resolveRowIndex(row, "data-combat-index");
}

async function confirmNotableCombatDelete(combat) {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  const escapedName = foundry.utils.escapeHTML?.(combat?.name ?? "this notable combat")
    ?? String(combat?.name ?? "this notable combat").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  if (typeof DialogV2?.prompt === "function") {
    return !!await DialogV2.prompt({
      window: { title: "Delete Notable Combat" },
      position: { width: 320 },
      content: `<p>Delete <strong>${escapedName}</strong> from this actor?</p>`,
      ok: { label: "Delete", icon: "fa-solid fa-trash", callback: () => true },
      rejectClose: false
    });
  }
  return window.confirm(`Delete ${combat?.name ?? "this notable combat"} from this actor?`);
}

function setupNotableCombatContextMenu(sheet, root, {
  blurActiveEditableInSheet,
  enqueue,
  openCombatEditor
} = {}) {
  const ContextMenuClass = getContextMenuClass();
  if (!ContextMenuClass) return;

  const runActorAction = async (target, label, action) => {
    if (!sheet.canModifyActor) return;
    const index = getCombatIndexFromElement(target);
    if (Number.isNaN(index)) return;
    await blurActiveEditableInSheet?.();
    await enqueue("_combatSaveQueue", label, () => action(index));
  };

  new ContextMenuClass(root, "[data-pc-notable-combat-menu]", [], {
    eventName: "click",
    fixed: true,
    jQuery: false,
    relative: "target",
    onOpen: element => {
      globalThis.ui.context.menuItems = [
        {
          group: "combat",
          label: "Edit",
          icon: "fa-solid fa-pen-to-square",
          onClick: async (_event, target) => {
            if (!sheet.canModifyActor) return;
            const index = getCombatIndexFromElement(target);
            if (Number.isNaN(index)) return;
            await openCombatEditor?.(sheet, index);
          }
        },
        {
          group: "combat",
          label: "Duplicate",
          icon: "fa-solid fa-copy",
          onClick: (_event, target) => runActorAction(target, "Combat duplicate", index => (
            sheet.actor.duplicatePeasantNotableCombat?.(index)
          ))
        },
        {
          group: "combat",
          label: "Indent",
          icon: "fa-solid fa-arrow-right",
          onClick: (_event, target) => runActorAction(target, "Combat indent", index => (
            sheet.actor.changePeasantNotableCombatIndent?.(index, 1)
          ))
        },
        {
          group: "combat",
          label: "Outdent",
          icon: "fa-solid fa-arrow-left",
          onClick: (_event, target) => runActorAction(target, "Combat outdent", index => (
            sheet.actor.changePeasantNotableCombatIndent?.(index, -1)
          ))
        },
        {
          group: "combat",
          label: "Delete",
          icon: "fa-solid fa-trash",
          onClick: (_event, target) => runActorAction(target, "Combat delete", async index => {
            const combat = sheet.actor.system.notableCombats?.[index];
            if (!await confirmNotableCombatDelete(combat)) return;
            await sheet.actor.removePeasantNotableCombat?.(index);
          })
        },
        {
          group: "hotbar",
          label: "Add to Hotbar",
          icon: "fa-solid fa-thumbtack",
          onClick: async (_event, target) => {
            const index = getCombatIndexFromElement(target);
            if (Number.isNaN(index)) return;
            const combat = sheet.actor.system.notableCombats?.[index] || {};
            await game.peasantCore?.addNotableCombatToHotbar?.({
              actorUuid: sheet.actor.uuid,
              combatId: combat.id || "",
              combatIndex: index
            });
          }
        }
      ];
    }
  });
}

function setupNotableCombatTagVisibilityToggle(sheet, root) {
  const toggles = root.querySelectorAll?.("[data-pc-notable-combat-tags-toggle]") ?? [];
  if (!toggles.length) return;

  const collapsedCombats = sheet._pcNotableCombatCollapsedTags instanceof Set
    ? sheet._pcNotableCombatCollapsedTags
    : readPersistedCollapsedNotableCombats(sheet);
  sheet._pcNotableCombatCollapsedTags = collapsedCombats;

  const getRowAndKey = toggle => {
    const row = toggle.closest?.(".combat-view-item");
    const combatId = String(row?.dataset?.combatId ?? "").trim();
    const combatIndex = String(row?.dataset?.combatIndex ?? "").trim();
    return { row, key: combatId || (combatIndex ? `index:${combatIndex}` : "") };
  };

  const syncToggle = toggle => {
    const { row, key } = getRowAndKey(toggle);
    if (!row || !key) return;
    const collapsed = collapsedCombats.has(key);
    const label = collapsed ? "Show Notable Tags" : "Hide Notable Tags";
    row.classList.toggle("pc-notable-combat-tags-collapsed", collapsed);
    toggle.setAttribute("data-tooltip", label);
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.classList.toggle("fa-compress", !collapsed);
    toggle.classList.toggle("fa-expand", collapsed);
  };

  for (const toggle of toggles) syncToggle(toggle);
  delegate(root, "click", "[data-pc-notable-combat-tags-toggle]", async event => {
    event.preventDefault();
    event.stopPropagation();
    const toggle = event.target?.closest?.("[data-pc-notable-combat-tags-toggle]");
    const { key } = getRowAndKey(toggle);
    if (!key) return;
    if (collapsedCombats.has(key)) collapsedCombats.delete(key);
    else collapsedCombats.add(key);
    syncToggle(toggle);
    await persistCollapsedNotableCombats(sheet, collapsedCombats);
  });
}

function readPersistedCollapsedNotableCombats(sheet) {
  const actorUuid = String(sheet.actor?.uuid ?? "").trim();
  if (!actorUuid || typeof game === "undefined" || !game.settings?.get) return new Set();

  try {
    const stored = game.settings.get(PC_SYSTEM_ID, PC_NOTABLE_COMBAT_TAG_VISIBILITY_SETTING);
    const collapsedIds = stored?.[actorUuid];
    return new Set(Array.isArray(collapsedIds) ? collapsedIds.map(String).filter(Boolean) : []);
  } catch (error) {
    pcLog.warn("Peasant Core | Could not read notable combat tag visibility preferences.", error);
    return new Set();
  }
}

async function persistCollapsedNotableCombats(sheet, collapsedCombats) {
  const actorUuid = String(sheet.actor?.uuid ?? "").trim();
  if (!actorUuid || typeof game === "undefined" || !game.settings?.get || !game.settings?.set) return;

  try {
    const stored = game.settings.get(PC_SYSTEM_ID, PC_NOTABLE_COMBAT_TAG_VISIBILITY_SETTING);
    const next = stored && typeof stored === "object" && !Array.isArray(stored) ? { ...stored } : {};
    if (collapsedCombats.size) next[actorUuid] = [...collapsedCombats];
    else delete next[actorUuid];
    await game.settings.set(PC_SYSTEM_ID, PC_NOTABLE_COMBAT_TAG_VISIBILITY_SETTING, next);
  } catch (error) {
    pcLog.warn("Peasant Core | Could not save notable combat tag visibility preferences.", error);
  }
}

function resolveCombatTagInputIndex(input) {
  const element = toElement(input);
  let idx = Number.parseInt(element?.dataset?.index, 10);
  if (Number.isNaN(idx)) {
    const container = element?.closest?.(".combat-tags-inline");
    idx = Number.parseInt(container?.dataset?.combatIndex, 10);
  }
  return Number.isNaN(idx) ? -1 : idx;
}
