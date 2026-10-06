import { showReadonlyDescriptionDialog } from "../controls/description-dialogs.mjs";
import { formatOptionalIntegerInput, parseOptionalInteger } from "../../../data/actor/helpers.mjs";
import { resolveSkillUsage } from "../../../data/actor/skill-entries.mjs";
import { getActorSourceSystem, resolveItemIndex, resolveRowIndex, sanitizeOptionalIntegerInputElement } from "../controls/sheet-listener-helpers.mjs";
import { delegate, toElement } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";

const PC_SYSTEM_ID = "peasant-core";
export const PC_NOTABLE_COMBAT_TAG_VISIBILITY_SETTING = "notableCombatTagVisibility";
export const PC_SKILL_TAG_VISIBILITY_SETTING = "skillTagVisibility";

export function registerNotableCombatClientSettings() {
  for (const key of [PC_NOTABLE_COMBAT_TAG_VISIBILITY_SETTING, PC_SKILL_TAG_VISIBILITY_SETTING]) {
    game.settings.register(PC_SYSTEM_ID, key, {
      scope: "client", config: false, type: Object, default: {}
    });
  }
}

export function setupNotableCombatControls(sheet, html, {
  blurActiveEditableInSheet,
  enqueueSheetUpdate,
  runQueuedInputUpdate,
  openCombatEditor,
  collection = "notableCombats"
} = {}) {
  const element = toElement(html);
  const root = element?.querySelector?.(`[data-entry-collection="${collection}"]`) ?? element;
  if (!root) return;
  const isSkills = collection === "skills";
  const prefix = isSkills ? "Skill" : "NotableCombat";
  const queueKey = isSkills ? "_skillsSaveQueue" : "_combatSaveQueue";
  const enqueue = enqueueSheetUpdate ?? (async (_queueKey, _label, task) => task());
  const runQueued = runQueuedInputUpdate ?? (async (_input, _queueKey, _label, task) => task());

  setupNotableCombatTagVisibilityToggle(sheet, root, collection);
  setupNotableCombatContextMenu(sheet, root, {
    blurActiveEditableInSheet, enqueue, openCombatEditor, collection, prefix, queueKey
  });

  delegate(root, "click", isSkills ? ".add-skill-btn" : ".add-combat-btn", async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    await blurActiveEditableInSheet?.();
    await enqueue(queueKey, "Entry add", () => sheet.actor[`addPeasant${prefix}`]?.());
  });

  delegate(root, "click", ".combat-toggle-type", async (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sheet.isEditMode) return;
    const resolveIndex = entryIndexResolver(sheet, target, collection);
    await blurActiveEditableInSheet?.();
    await enqueue(queueKey, "Entry type toggle", () => {
      const index = resolveIndex();
      if (index >= 0) return sheet.actor[`setPeasant${prefix}Type`]?.(index, "Custom");
    });
  });

  delegate(root, "change", ".combat-select", async (_ev, select) => {
    if (!sheet.isEditMode) return;
    const resolveIndex = entryIndexResolver(sheet, select, collection);
    const type = select.value || "skill";
    await enqueue(queueKey, "Entry type select", () => {
      const index = resolveIndex();
      if (index >= 0) return sheet.actor[`setPeasant${prefix}Type`]?.(index, type);
    });
  });

  delegate(root, "input", ".combat-tohit, .combat-ap, .combat-sp, .combat-accuracy", (_ev, input) => {
    if (sheet.isEditMode) sanitizeOptionalIntegerInputElement(input, { allowSign: input.dataset.field === "accuracy" });
  });

  delegate(root, "change", ".combat-class, .combat-rank, .combat-name, .combat-tohit, .combat-accuracy, .combat-special-grade, .combat-ap, .combat-sp", async (_ev, input) => {
    if (!sheet.isEditMode) return;
    const field = input.dataset.field;
    if (!["class", "rank", "name", "tohit", "accuracy", "specialGrade", ...(isSkills ? ["ap", "sp"] : [])].includes(field)) return;
    const resolveIndex = entryIndexResolver(sheet, input, collection);
    const value = input.value;
    await runQueued(input, queueKey, "Entry main field change", async () => {
      const index = resolveIndex();
      if (index < 0) return;
      const result = await sheet.actor[`setPeasant${prefix}MainFields`]?.(index, { [field]: value });
      if (!result?.ok || !["tohit", "accuracy", "ap", "sp"].includes(field)) return;
      const saved = result[isSkills ? "skills" : "combats"]?.[index];
      const resolved = saved ? resolveSkillUsage(saved) : null;
      const raw = resolved?.ok ? resolved.data[field] : value;
      const parsed = parseOptionalInteger(raw, field === "accuracy" ? { allowSign: true } : { min: field === "tohit" ? 1 : 0 });
      input.value = formatOptionalIntegerInput(parsed, { showPlus: field === "accuracy" });
    });
  });

  for (const [selector, method, editOnly] of [
    [".combat-uses-max", "UsesMax", true],
    [".combat-uses-current:not(.combat-tag-uses-current):not(.combat-uses-max)", "UsesCurrent", false]
  ]) {
    delegate(root, "change", selector, async (_ev, input) => {
      if (editOnly && !sheet.isEditMode) return;
      const resolveIndex = entryIndexResolver(sheet, input, collection);
      const value = input.value;
      await runQueued(input, queueKey, "Entry uses change", () => {
        const index = resolveIndex();
        if (index >= 0) return sheet.actor[`setPeasant${prefix}${method}`]?.(index, value);
      });
    });
  }

  for (const [selector, type, currentField, maxField] of [
    [".combat-tag-uses-current", "tagUses", "current", "max"],
    [".combat-tag-sections-current", "sections", "current", "max"],
    [".combat-tag-splitsecond-current", "speed", "splitSecondCurrent", "splitSecondMax"]
  ]) {
    delegate(root, "change", selector, async (_ev, input) => {
      const resolveIndex = entryIndexResolver(sheet, input, collection);
      const value = input.value;
      await runQueued(input, queueKey, "Entry tag counter change", async () => {
        const index = resolveIndex();
        if (index < 0) return;
        await sheet.actor.ensurePeasantEntryIds?.(collection);
        const entry = getActorSourceSystem(sheet.actor)[collection]?.[index];
        if (!entry?.id) return;
        const resolved = resolveSkillUsage(entry);
        if (!resolved.ok) return;
        const current = Math.max(0, Math.min(Number.parseInt(value, 10) || 0, Number(resolved.data[type]?.[maxField]) || 0));
        const local = resolved.usageId !== "base" && (type === "speed" || resolved.usage.counterScopes?.[type] === "local");
        const patch = { [type]: { [currentField]: current } };
        await sheet.actor.updatePeasantEntry?.({ collection, entryId: entry.id }, local ? { mechanics: patch } : patch,
          local ? { usageId: resolved.usageId } : {});
      });
    });
  }

  delegate(root, "click", ".combat-name-view.combat-has-desc", async (ev, name) => {
    ev.preventDefault();
    ev.stopPropagation();
    const index = entryIndexResolver(sheet, name, collection)();
    const entry = sheet.actor.system[collection]?.[index];
    if (!entry) return;
    await showReadonlyDescriptionDialog(sheet, {
      title: `${entry.name || "Skill"} - Description`, description: entry.description || ""
    });
  });
}

function entryIndexResolver(sheet, element, collection) {
  const row = element?.closest?.(".combat-view-item") ?? element?.closest?.(".combat-item");
  const index = resolveItemIndex(element, { dataKey: "index", rowSelector: ".combat-item", rowAttr: "data-combat-index" });
  const rowIndex = row ? resolveRowIndex(row, "data-combat-index") : index;
  const source = getActorSourceSystem(sheet.actor)[collection] ?? [];
  const entry = source[rowIndex];
  const id = row?.dataset?.combatId || entry?.id;
  return () => {
    const entries = getActorSourceSystem(sheet.actor)[collection] ?? [];
    return id ? entries.findIndex(candidate => candidate?.id === id) : entries.indexOf(entry);
  };
}

function getContextMenuClass() {
  return globalThis.foundry?.applications?.ux?.ContextMenu?.implementation
    ?? globalThis.ContextMenu?.implementation ?? globalThis.ContextMenu ?? null;
}

async function confirmNotableCombatDelete(combat, collection) {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  const escapedName = foundry.utils.escapeHTML?.(combat?.name ?? "this skill")
    ?? String(combat?.name ?? "this skill").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  if (typeof DialogV2?.prompt === "function") {
    return !!await DialogV2.prompt({
      window: { title: collection === "skills" ? "Delete Skill" : "Delete Notable Combat" },
      position: { width: 320 },
      content: `<p>Delete <strong>${escapedName}</strong> from this actor?</p>`,
      ok: { label: "Delete", icon: "fa-solid fa-trash", callback: () => true },
      rejectClose: false
    });
  }
  return window.confirm(`Delete ${combat?.name ?? "this skill"} from this actor?`);
}

function setupNotableCombatContextMenu(sheet, root, {
  blurActiveEditableInSheet, enqueue, openCombatEditor, collection, prefix, queueKey
} = {}) {
  const ContextMenuClass = getContextMenuClass();
  if (!ContextMenuClass) return;
  const runActorAction = async (target, label, action) => {
    if (!sheet.canModifyActor) return;
    const resolveIndex = entryIndexResolver(sheet, target, collection);
    await blurActiveEditableInSheet?.();
    await enqueue(queueKey, label, () => {
      const index = resolveIndex();
      if (index >= 0) return action(index, resolveIndex);
    });
  };

  new ContextMenuClass(root, "[data-pc-notable-combat-menu]", [], {
    eventName: "click", fixed: true, jQuery: false, relative: "target",
    onOpen: () => {
      const isSkills = collection === "skills";
      globalThis.ui.context.menuItems = [
        {
          group: "combat", label: "Edit", icon: "fa-solid fa-pen-to-square",
          onClick: (_event, target) => runActorAction(target, "Entry edit", index => openCombatEditor?.(sheet, index))
        },
        {
          group: "combat", label: "Duplicate", icon: "fa-solid fa-copy",
          onClick: (_event, target) => runActorAction(target, "Entry duplicate", index => sheet.actor[`duplicatePeasant${prefix}`]?.(index))
        },
        ...[["Indent", 1, "right"], ["Outdent", -1, "left"]].map(([label, delta, direction]) => ({
          group: "combat", label, icon: `fa-solid fa-arrow-${direction}`,
          onClick: (_event, target) => runActorAction(target, label, index => (
            sheet.actor[`changePeasant${prefix}Indent`]?.(index, delta, { includeHidden: sheet.isEditMode })
          ))
        })),
        {
          group: "combat", label: "Delete", icon: "fa-solid fa-trash",
          onClick: (_event, target) => runActorAction(target, "Entry delete", async (index, resolveIndex) => {
            const entry = getActorSourceSystem(sheet.actor)[collection]?.[index];
            if (!await confirmNotableCombatDelete(entry, collection)) return;
            const currentIndex = resolveIndex();
            if (currentIndex >= 0) await sheet.actor[`removePeasant${prefix}`]?.(currentIndex);
          })
        },
        {
          group: "hotbar", label: "Add to Hotbar", icon: "fa-solid fa-thumbtack",
          onClick: async (_event, target) => {
            const resolveIndex = entryIndexResolver(sheet, target, collection);
            await sheet.actor.ensurePeasantEntryIds?.(collection);
            const index = resolveIndex();
            const entry = getActorSourceSystem(sheet.actor)[collection]?.[index];
            if (!entry?.id) return;
            if (isSkills) {
              await game.peasantCore?.addSkillUsageToHotbar?.({
                actorUuid: sheet.actor.uuid, collection, entryId: entry.id, usageId: entry.defaultUsageId || "base"
              });
            } else {
              await game.peasantCore?.addNotableCombatToHotbar?.({
                actorUuid: sheet.actor.uuid, combatId: entry.id, combatIndex: index
              });
            }
          }
        },
        ...(isSkills ? [{
          group: "hotbar", label: "Duplicate to Notables", icon: "fa-solid fa-copy",
          onClick: (_event, target) => runActorAction(target, "Duplicate Skill to Notables", async index => {
            const entry = getActorSourceSystem(sheet.actor).skills?.[index];
            const result = await sheet.actor.duplicatePeasantSkillToNotables?.(entry.id);
            if (!result?.ok) ui.notifications?.error?.(result?.error || "Could not duplicate the Skill to Notables.");
          })
        }] : [])
      ];
    }
  });
}

function setupNotableCombatTagVisibilityToggle(sheet, root, collection) {
  const toggles = root.querySelectorAll?.("[data-pc-notable-combat-tags-toggle]") ?? [];
  if (!toggles.length) return;
  const isSkills = collection === "skills";
  const stateKey = isSkills ? "_pcSkillExpandedTags" : "_pcNotableCombatCollapsedTags";
  const setting = isSkills ? PC_SKILL_TAG_VISIBILITY_SETTING : PC_NOTABLE_COMBAT_TAG_VISIBILITY_SETTING;
  const preferenceKey = `${game.user?.id}:${sheet.actor?.uuid}`;
  const ids = sheet[stateKey] instanceof Set ? sheet[stateKey] : readTagPreferences(setting, preferenceKey);
  sheet[stateKey] = ids;

  const getRowAndKey = toggle => {
    const row = toggle.closest?.(".combat-view-item");
    const id = String(row?.dataset?.combatId ?? "").trim();
    const index = String(row?.dataset?.combatIndex ?? "").trim();
    return { row, key: id || (index ? `index:${index}` : "") };
  };
  const syncToggle = toggle => {
    const { row, key } = getRowAndKey(toggle);
    if (!row || !key) return;
    const collapsed = isSkills ? !ids.has(key) : ids.has(key);
    const label = `${collapsed ? "Show" : "Hide"} ${isSkills ? "Skill" : "Notable"} Tags`;
    row.classList.toggle("pc-notable-combat-tags-collapsed", collapsed);
    toggle.setAttribute("data-tooltip", label);
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.classList.toggle("fa-compress", !collapsed);
    toggle.classList.toggle("fa-expand", collapsed);
  };
  for (const toggle of toggles) syncToggle(toggle);
  delegate(root, "click", "[data-pc-notable-combat-tags-toggle]", async (event, toggle) => {
    event.preventDefault();
    event.stopPropagation();
    const { key } = getRowAndKey(toggle);
    if (!key) return;
    if (ids.has(key)) ids.delete(key);
    else ids.add(key);
    syncToggle(toggle);
    await persistTagPreferences(setting, preferenceKey, ids);
  });
}

function readTagPreferences(setting, key) {
  if (!key || typeof game === "undefined" || !game.settings?.get) return new Set();
  try {
    const stored = game.settings.get(PC_SYSTEM_ID, setting)?.[key];
    return new Set(Array.isArray(stored) ? stored.map(String).filter(Boolean) : []);
  } catch (error) {
    pcLog.warn("Peasant Core | Could not read tag visibility preferences.", error);
    return new Set();
  }
}

async function persistTagPreferences(setting, key, ids) {
  if (!key || typeof game === "undefined" || !game.settings?.get || !game.settings?.set) return;
  try {
    const stored = game.settings.get(PC_SYSTEM_ID, setting);
    const next = stored && typeof stored === "object" && !Array.isArray(stored) ? { ...stored } : {};
    if (ids.size) next[key] = [...ids];
    else delete next[key];
    await game.settings.set(PC_SYSTEM_ID, setting, next);
  } catch (error) {
    pcLog.warn("Peasant Core | Could not save tag visibility preferences.", error);
  }
}
