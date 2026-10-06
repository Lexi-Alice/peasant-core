import { setupNotableCombatTagEditorDrag } from "./notable-combat-drag-drop.mjs";
import { getActiveNotableCombatEditorTags } from "./notable-combat-tag-display.mjs";
import { createNotableCombatTagEditorState } from "./notable-combat-tag-editor-state.mjs";
import { renderNotableCombatTagInputs } from "./notable-combat-tag-input-helpers.mjs";
import { renderNotableCombatTagList } from "./notable-combat-tag-list.mjs";
import { setupNotableCombatTagRemoveControls } from "./notable-combat-tag-remove-controls.mjs";
import { setupNotableCombatTagSaveControls } from "./notable-combat-tag-save-controls.mjs";
import { setupNotableCombatTagSelectionControls } from "./notable-combat-tag-selection-controls.mjs";
import { renderSheetOwnedApplication } from "../controls/sheet-owned-apps.mjs";
import { createSkillEditorAdapter } from "../skills/skill-editor-adapter.mjs";
import { setupSkillUsageSelectionControls } from "../skills/skill-usage-controls.mjs";
import {
  buildSkillEditorFieldPatch,
  buildSkillEditorPatch,
  normalizeSkillEditorUsageSelection,
  prepareSkillEditorIdentity,
  resolveSkillEditorTypedValue
} from "../skills/skill-editor.mjs";
import { formatOptionalIntegerInput, sanitizeOptionalIntegerInputValue } from "../../../data/actor/helpers.mjs";
import { getNotableCombatEffectImage } from "../../../data/actor/notable-combat-image.mjs";
import { delegate, markVerticalDropBoundary, qs, qsa } from "../../dom.mjs";
import { pcLog } from "../../../utils/logging.mjs";
import { moveSkillLayoutRow, resolveSkillUsage } from "../../../data/actor/skill-entries.mjs";
import { skillEffectNeedsReview } from "../../../data/actor/skill-entry-conditions.mjs";
import { startPeasantEntryUse } from "../../combat/skill-entry-use.mjs";
import { createPeasantUsageLink } from "../../skill-usage-links.mjs";
import { renderDialogModeToggle } from "../controls/health-stress/dialog-mode-toggle.mjs";

const ApplicationV2 = foundry?.applications?.api?.ApplicationV2;
const HandlebarsApplicationMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;
const FilePickerClass = foundry?.applications?.apps?.FilePicker;
const ImagePopoutClass = foundry?.applications?.apps?.ImagePopout;

if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error("Peasant Core requires Foundry's ApplicationV2 and HandlebarsApplicationMixin.");
}

const NotableCombatTagEditorBase = HandlebarsApplicationMixin(ApplicationV2);
const TAG_EDITOR_BODY_TEMPLATE = "systems/peasant-core/templates/actor/apps/skill-editor-body.hbs";
const TAG_EDITOR_FOOTER_TEMPLATE = "systems/peasant-core/templates/actor/apps/skill-editor-footer.hbs";
const TAG_EDITOR_TABS = new Set(["description", "details", "effects"]);
const RANK_NAVIGATION_KEYS = new Set(["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", "Enter", "Home", "End"]);
const COMBAT_TYPE_OPTIONS = Object.freeze([
  { value: "skill", label: "Skill" },
  { value: "Weapon", label: "Weapon" },
  { value: "Defense", label: "Defense" },
  { value: "Combat Trick", label: "Combat Trick" },
  { value: "Signature", label: "Signature" },
  { value: "Stance", label: "Stance" },
  { value: "Perk", label: "Perk" },
  { value: "Style", label: "Style" },
  { value: "Cantrip", label: "Cantrip" },
  { value: "Historic", label: "Historic" },
  { value: "TM", label: "TM" },
  { value: "Spellcraft", label: "Spellcraft" },
  { value: "Gate", label: "Gate" },
  { value: "Spell", label: "Spell" },
  { value: "Subskill", label: "Subskill" },
  { value: "custom", label: "Custom" }
]);

function getSkillEditorFieldGroup(target) {
  if (!target?.matches) return null;
  const fields = [
    [".pc-entry-name-input, .pc-notable-combat-name-input", "name"],
    [".pc-entry-class-input, .pc-notable-combat-class-input", "class"],
    [".pc-entry-rank-input, .pc-notable-combat-rank-input", "rank"],
    [".pc-entry-tohit-input, .pc-notable-combat-tohit-input", "tohit"],
    [".pc-entry-accuracy-input, .pc-notable-combat-accuracy-input", "accuracy"],
    [".pc-entry-special-grade-input, .pc-notable-combat-special-grade-input", "specialGrade"],
    [".pc-entry-category-select", "category"],
    [".pc-entry-type-select, .pc-entry-type-custom, .pc-notable-combat-type-select", "type"],
    [".pc-entry-weapon-type-select, .pc-entry-weapon-type-custom", "weaponType"],
    [".pc-entry-defense-type-select, .pc-entry-defense-type-custom", "defenseType"],
    [".pc-entry-trick-type-select, .pc-entry-trick-type-custom", "trickType"],
    [".pc-entry-signature-type-select, .pc-entry-signature-type-custom", "signatureType"],
    [".pc-entry-gate-type-select, .pc-entry-gate-type-custom", "gateType"],
    ["[data-pc-entry-characteristic]", "characteristics"],
    [".pc-entry-characteristic-mode-select", "characteristicMode"],
    [".pc-entry-signature-current, .pc-entry-signature-max", "primaryUses"],
    [".pc-entry-duress-uses", "duressUses"],
    [".pc-entry-duress-current, .pc-entry-duress-max", "duressUseCounts"],
    [".pc-entry-ap-input", "ap"],
    [".pc-entry-sp-input", "sp"]
  ];
  return fields.find(([selector]) => target.matches(selector))?.[1] ?? null;
}
const PC_NOTABLE_COMBAT_EFFECT_TYPE = "skill";
const PC_NOTABLE_EFFECT_DRAG_PREFIX = "peasant-core.notable-combat-effect-sort";
const PC_NOTABLE_EFFECT_DRAG_BLOCK_SELECTOR = "input, select, textarea, a, [data-pc-notable-combat-effect-menu]";
const PC_NOTABLE_EFFECT_SORT_MODES = Object.freeze({
  manual: {
    next: "alpha",
    label: "Sort Manually",
    icon: "fa-solid fa-arrow-down-short-wide"
  },
  alpha: {
    next: "manual",
    label: "Sort Alphabetically",
    icon: "fa-solid fa-arrow-down-a-z"
  }
});

let NotableCombatDescriptionMenuClass = null;
let notableCombatDescriptionPluginListenerRegistered = false;

function getNotableCombatDescriptionMenuClass() {
  const BaseMenu = foundry?.prosemirror?.plugins?.ProseMirrorMenu;
  if (!BaseMenu) return null;
  if (NotableCombatDescriptionMenuClass) return NotableCombatDescriptionMenuClass;

  NotableCombatDescriptionMenuClass = class PeasantNotableCombatDescriptionMenu extends BaseMenu {
    _onResize() {
      // Match the item description toolbar by letting controls wrap without adding toolbar save.
    }
  };
  return NotableCombatDescriptionMenuClass;
}

function configureNotableCombatDescriptionPlugins(event) {
  const editor = event.target;
  if (!editor?.matches?.("prose-mirror.pc-notable-combat-description-editor")) return;
  if (!editor.closest?.(".pc-notable-combat-tag-editor")) return;

  const prosemirror = foundry?.prosemirror;
  const MenuClass = getNotableCombatDescriptionMenuClass();
  const plugins = event.plugins ?? event.detail;
  if (!prosemirror?.defaultSchema || !MenuClass || !plugins) return;

  plugins.menu = MenuClass.build(prosemirror.defaultSchema, {
    destroyOnSave: editor.hasAttribute("toggled")
  });
}

function registerNotableCombatDescriptionEditor() {
  if (notableCombatDescriptionPluginListenerRegistered) return;
  const document = globalThis.document;
  if (!document?.addEventListener) return;
  document.addEventListener("plugins", configureNotableCombatDescriptionPlugins, { capture: true });
  notableCombatDescriptionPluginListenerRegistered = true;
}

function getDefaultCombatImage() {
  return foundry?.utils?.getProperty?.(CONFIG, "Item.documentClass.DEFAULT_ICON")
    || foundry?.utils?.getProperty?.(CONFIG, "Item.defaultIcon")
    || "icons/svg/sword.svg";
}

function getDefaultEffectIcon() {
  return foundry?.utils?.getProperty?.(CONFIG, "ActiveEffect.documentClass.DEFAULT_ICON")
    || foundry?.utils?.getProperty?.(CONFIG, "ActiveEffect.defaultIcon")
    || "icons/svg/aura.svg";
}

function formatSearchText(...parts) {
  return parts.map(part => String(part ?? "").trim().toLowerCase()).filter(Boolean).join(" ");
}

function getContextMenuClass() {
  return foundry?.applications?.ux?.ContextMenu?.implementation
    ?? globalThis.ContextMenu?.implementation
    ?? globalThis.ContextMenu
    ?? null;
}

function getDialogElement(dialog) {
  return dialog?.element?.nodeType === 1 ? dialog.element : dialog?.element?.[0] ?? null;
}

function escapeDialogText(value) {
  return foundry?.utils?.escapeHTML?.(String(value ?? ""))
    ?? String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function promptUsageName({ title, label, value = "", actionLabel }) {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt === "function") {
    return DialogV2.prompt({
      window: { title },
      position: { width: 360 },
      content: `<label class="form-group"><span>${escapeDialogText(label)}</span><input type="text" name="usageName" value="${escapeDialogText(value)}" autocomplete="off"></label>`,
      ok: {
        label: actionLabel,
        icon: "fa-solid fa-check",
        callback: (_event, _button, dialog) => String(getDialogElement(dialog)?.querySelector?.('[name="usageName"]')?.value ?? "").trim()
      },
      rejectClose: false
    });
  }
  const result = globalThis.window?.prompt?.(label, value);
  return result === null || result === undefined ? null : String(result).trim();
}

async function confirmUsageAction({ title, content, label, icon = "fa-solid fa-trash" }) {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt === "function") {
    return !!await DialogV2.prompt({
      window: { title },
      position: { width: 360 },
      content,
      ok: { label, icon, callback: () => true },
      rejectClose: false
    });
  }
  return !!globalThis.window?.confirm?.(content.replace(/<[^>]*>/g, ""));
}

function getSkillEffectConditionLabel(when) {
  return ({ always: "On Use", success: "Successful", failure: "Failed", hit: "Hit", manual: "Requires review" })[when] ?? "On Use";
}

function addSkillTagConditionLabels(tags, usage) {
  const links = Array.isArray(usage?.effectLinks) ? usage.effectLinks : [];
  const rules = Array.isArray(usage?.rules) ? usage.rules : [];
  return tags.map(tag => {
    const conditions = [];
    const tagLinks = links.filter(link => link?.tagKey === tag.key);
    for (const link of tagLinks) if (link.when !== "always") conditions.push(getSkillEffectConditionLabel(link.when));
    const linkIds = new Set(tagLinks.map(link => link.id));
    for (const rule of rules) {
      if (rule?.tagKeys?.includes?.(tag.key) || rule?.effectLinkIds?.some?.(id => linkIds.has(id))) {
        if (rule.when !== "always") conditions.push(getSkillEffectConditionLabel(rule.when));
      }
    }
    const limits = rules.filter(rule => rule?.tagKeys?.includes?.(tag.key) && rule.note)
      .map(rule => String(rule.note).trim()).filter(Boolean);
    const label = [...new Set(conditions)].join(" AND ");
    return { ...tag, condition: [label, ...limits.map(note => `Limit: ${note}`)].filter(Boolean).join(" — ") };
  });
}

async function promptSkillTagCondition(tagKey, usage) {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== "function") return null;
  const authored = (usage?.rules ?? []).filter(rule => rule?.editorTagKey === tagKey);
  const when = authored.find(rule => rule.when !== "manual")?.when
    ?? "always";
  const limitNote = authored.find(rule => rule.note)?.note ?? "";
  const legacyReviewOnly = authored.some(rule => rule.when === "manual" && !String(rule.note ?? "").trim());
  const option = (value, label) => `<option value="${value}"${when === value ? " selected" : ""}>${label}</option>`;
  return DialogV2.prompt({
    window: { title: "Tag Condition / Limit" },
    position: { width: 420 },
    content: `<div class="standard-form">
      <label class="form-group"><span>Condition</span><select name="when">${[
        option("always", "On Use"), option("success", "Successful check"),
        option("failure", "Failed check"), option("hit", "Hit")
      ].join("")}</select></label>
      <label class="form-group"><span>Unsupported limit (requires review)</span>
        <input type="text" name="limitNote" value="${escapeDialogText(limitNote)}" placeholder="Optional limit note"></label>
      <p class="hint">A limit note blocks unsupported tag automation and requires Offer in Chat for linked effects.</p>
      ${legacyReviewOnly ? '<p class="hint">This legacy tag requires review. Saving without a limit note removes that gate.</p>' : ""}
    </div>`,
    ok: {
      label: "Save Condition", icon: "fa-solid fa-floppy-disk",
      callback: (_event, _button, dialog) => {
        const element = getDialogElement(dialog);
        return {
          when: element?.querySelector?.('[name="when"]')?.value ?? "always",
          limitNote: element?.querySelector?.('[name="limitNote"]')?.value ?? ""
        };
      }
    },
    rejectClose: false
  });
}

async function promptSkillEffectLink(link, tags, rules = []) {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== "function") return null;
  const option = (value, label, selected) => `<option value="${escapeDialogText(value)}"${selected ? " selected" : ""}>${escapeDialogText(label)}</option>`;
  const tagOptions = [option("", "No associated tag", !link?.tagKey), ...tags.map(tag => (
    option(tag.key, `${tag.label}${skillEffectNeedsReview({ ...link, tagKey: tag.key }, rules) ? " (Offer in Chat)" : ""}`,
      link?.tagKey === tag.key)
  ))].join("");
  const selectOptions = (values, current) => values.map(([value, label]) => option(value, label, current === value)).join("");
  const currentApplication = link?.application === "manual" ? "offer" : link?.application ?? "automatic";
  return DialogV2.prompt({
    window: { title: "Configure Usage Effect" },
    position: { width: 420 },
    content: `<div class="standard-form">
      <label class="form-group"><span>Tag</span><select name="tagKey">${tagOptions}</select></label>
      <label class="form-group"><span>Condition</span><select name="when">${selectOptions([
        ["always", "On Use"], ["success", "Successful check"], ["failure", "Failed check"],
        ["hit", "Hit"], ["passive", "Passive"]
      ], link?.when ?? "success")}</select></label>
      <label class="form-group" data-pc-effect-link-setting><span>Recipient</span><select name="recipient">${selectOptions([
        ["self", "Self"], ["target", "Target"]
      ], link?.recipient ?? "self")}</select></label>
      <label class="form-group" data-pc-effect-link-setting><span>Application</span><select name="application">${selectOptions([
        ["automatic", "Automatic"], ["offer", "Offer in Chat"]
      ], currentApplication)}</select></label>
      <p class="hint" data-pc-effect-link-setting>A tag marked Offer in Chat has a limit or review gate. It overrides Automatic while retaining your chosen Application.</p>
    </div>`,
    render: (_event, dialog) => {
      const element = getDialogElement(dialog);
      const condition = qs(element, '[name="when"]');
      const syncSettings = () => {
        for (const setting of qsa(element, "[data-pc-effect-link-setting]")) {
          setting.hidden = condition?.value === "passive";
        }
      };
      condition?.addEventListener?.("change", syncSettings);
      syncSettings();
    },
    ok: {
      label: "Save Link",
      icon: "fa-solid fa-floppy-disk",
      callback: (_event, _button, dialog) => {
        const element = getDialogElement(dialog);
        const tagKey = element?.querySelector?.('[name="tagKey"]')?.value ?? "";
        const application = element?.querySelector?.('[name="application"]')?.value ?? "automatic";
        const when = element?.querySelector?.('[name="when"]')?.value ?? "success";
        return {
          tagKey,
          when,
          recipient: when === "passive" ? "self" : element?.querySelector?.('[name="recipient"]')?.value ?? "self",
          application: when === "passive" ? "automatic" : application
        };
      }
    },
    rejectClose: false
  });
}

function getNotableCombatEffectIds(combatData) {
  if (!Array.isArray(combatData?.effectIds)) return [];
  const seen = new Set();
  const ids = [];
  for (const id of combatData.effectIds) {
    const value = String(id ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

export function prepareNotableCombatEffectContext(actor, combatData, {
  groupedByType = true,
  selectedUsageId = "base",
  sortMode = "manual"
} = {}) {
  const typeLabel = "Skill";
  const conditionGroups = [
    ["always", "On Use"], ["success", "Successful Check"], ["failure", "Failed Check"],
    ["hit", "Hit"], ["passive", "Passive"]
  ];
  const createEffectRow = ({ id, index, scope, link = null }) => {
    const effect = actor?.effects?.get?.(id);
    const missing = !effect;
    const status = missing ? "Missing" : (scope === "usage" && link?.when !== "passive"
      ? "Template" : (effect.disabled ? "Disabled" : "Enabled"));
    const name = effect?.name ?? effect?.label ?? "Missing Effect";
    const condition = link?.when === "passive" ? "Passive"
      : link?.when === "success" ? "Successful"
      : link?.when === "failure" ? "Failed"
      : link?.when === "hit" ? "Hit"
        : link?.when === "manual" ? "Requires review"
          : "On Use";
    const application = scope === "usage" && skillEffectNeedsReview(link, selectedUsage?.rules)
      ? "offer" : link?.application;
    return {
      id,
      linkId: link?.id ?? "",
      scope,
      conditionKey: conditionGroups.some(([key]) => key === link?.when) ? link.when : "always",
      type: PC_NOTABLE_COMBAT_EFFECT_TYPE,
      typeLabel,
      name,
      icon: effect?.img || effect?.icon || getDefaultEffectIcon(),
      disabled: !!effect?.disabled,
      missing,
      status,
      subtitle: scope === "usage" ? (link?.when === "passive" ? "Passive" : `${condition} - ${application === "offer" || application === "manual" ? "Offer in Chat" : "Automatic"}`) : `${typeLabel} - ${status}`,
      searchText: formatSearchText(name, typeLabel, status, condition, application),
      sort: Number.isFinite(Number(effect?.sort)) ? Number(effect.sort) : index,
      sortName: formatSearchText(name, typeLabel),
      sortable: scope === "whole" && !missing
    };
  };
  const selectedUsage = selectedUsageId === "base"
    ? combatData?.baseUsage
    : combatData?.usages?.find?.(usage => usage?.id === selectedUsageId);
  const effects = (selectedUsage?.effectLinks ?? []).map((link, index) => createEffectRow({
    id: String(link?.effectId ?? "").trim(),
    index,
    scope: "usage",
    link
  }));
  const effectSections = conditionGroups.map(([type, label]) => ({
    type, label, icon: "fa-solid fa-layer-group", visible: true,
    effects: effects.filter(effect => effect.conditionKey === type)
  })).filter(section => section.effects.length > 0);
  const sortConfig = PC_NOTABLE_EFFECT_SORT_MODES[sortMode] ?? PC_NOTABLE_EFFECT_SORT_MODES.manual;

  return {
    effects,
    effectSections,
    effectFlatSection: {
      type: "all",
      label: "All Effects",
      icon: "fa-solid fa-bolt",
      visible: effects.length > 0,
      effects
    },
    hasEffects: effects.length > 0,
    effectsGroupedByType: groupedByType,
    effectGroupToggle: {
      active: groupedByType,
      pressed: groupedByType ? "true" : "false",
      label: groupedByType ? "Grouped by Condition" : "Flat List"
    },
    effectSortToggle: {
      mode: sortMode,
      label: sortConfig.label,
      icon: sortConfig.icon
    }
  };
}

function getNotableCombatEffectFromElement(actor, element) {
  const id = element?.closest?.("[data-pc-notable-combat-effect]")?.dataset?.effectId;
  return id ? actor?.effects?.get?.(id) ?? null : null;
}

function getNotableCombatEffectReferenceFromElement(actor, element) {
  const row = element?.closest?.("[data-pc-notable-combat-effect]");
  const effectId = String(row?.dataset?.effectId ?? "").trim();
  const linkId = String(row?.dataset?.effectLinkId ?? "").trim();
  if (!row || (!effectId && !linkId)) return null;
  return {
    effect: actor?.effects?.get?.(effectId) ?? null,
    effectId,
    linkId,
    scope: row.dataset.effectScope === "usage" ? "usage" : "whole"
  };
}

function getNotableCombatEffectSortDragData(event) {
  const raw = event?.dataTransfer?.getData?.("text/plain") ?? "";
  if (!raw.startsWith(`${PC_NOTABLE_EFFECT_DRAG_PREFIX}:`)) return null;
  const [, actorUuid, effectId] = raw.match(/^peasant-core\.notable-combat-effect-sort:(.+):([^:]+)$/) ?? [];
  return actorUuid && effectId ? { actorUuid, effectId } : null;
}

function clearNotableCombatEffectDragMarkers(root) {
  for (const row of qsa(root, "[data-pc-notable-combat-effect]")) {
    row.classList.remove("drag-over-top", "drag-over-bottom");
  }
}

function isNotableCombatEffectDropAfter(row, clientY) {
  const rect = row.getBoundingClientRect();
  return clientY >= rect.top + (rect.height / 2);
}

function getNotableCombatEffectRowsInList(list) {
  return qsa(list, "[data-pc-notable-combat-effect]:not([hidden])");
}

function getNotableCombatEffectDropTargetRow(target, list) {
  return target?.closest?.("[data-pc-notable-combat-effect]") ?? getNotableCombatEffectRowsInList(list).at(-1) ?? null;
}

function normalizeRankInputValue(raw) {
  const match = String(raw || "").match(/[1234uU]/);
  return match ? match[0] : "";
}

function finalizeRankInputValue(raw) {
  const normalized = normalizeRankInputValue(raw);
  return normalized === "" ? "1" : normalized;
}

function getCombatTypeOptions(activeType) {
  const current = String(activeType || "skill");
  const selectedValue = COMBAT_TYPE_OPTIONS.some(option => option.value === current) ? current : "custom";
  return COMBAT_TYPE_OPTIONS.map(option => ({
    ...option,
    selected: option.value === selectedValue
  }));
}

registerNotableCombatDescriptionEditor();

export async function openNotableCombatTagEditor(sheet, index) {
  try {
    if (Number.isNaN(index) || index === undefined || index === null) return;
    await sheet.actor.ensurePeasantEntryIds?.("notableCombats");
    const entry = sheet.actor.getPeasantNotableCombatsForUpdate?.()[index];
    return entry?.id
      ? openPeasantSkillEditor(sheet, { collection: "notableCombats", entryId: entry.id })
      : null;
  } catch (e) {
    pcLog.debug("openCombatTagEditor failed", e);
  }
}

export async function openPeasantSkillEditor(sheet, ref, options = {}) {
  try {
    const key = `skill-editor-${ref.collection}-${ref.entryId}`;
    const existing = sheet?._pcOwnedApplications?.[key];
    if (existing) {
      existing.render({ force: false });
      return existing;
    }
    const adapter = createSkillEditorAdapter(sheet, ref);
    let entry = adapter.readSource();
    if (!entry) return null;
    await adapter.update({}, { render: false });
    entry = adapter.readSource();
    const applicationOptions = typeof sheet?._withDetachedOptions === "function"
      ? sheet._withDetachedOptions({
        position: {
          width: 560,
          height: "auto"
        },
        ...options
      })
      : {
        position: {
          width: 560,
          height: "auto"
        },
        ...options
      };
    const application = new PeasantNotableCombatTagEditorApp(sheet, adapter, applicationOptions);
    return renderSheetOwnedApplication(sheet, key, application);
  } catch (e) {
    pcLog.debug("openSkillEditor failed", e);
  }
}

class PeasantNotableCombatTagEditorApp extends NotableCombatTagEditorBase {
  _saveQueue = Promise.resolve(true);
  _dirtyMainInputs = new Set();
  _descriptionSaveTimer = null;
  _pcNotableCombatEffectsGroupedByType = true;
  _pcNotableCombatEffectSortMode = "manual";
  _pcNotableCombatEffectDragState = null;

  constructor(sheet, adapter, options = {}) {
    const entry = adapter.readSource() ?? {};
    const entryName = entry.name || (adapter.ref.collection === "skills" ? "Skill" : "Notable");
    const appOptions = foundry.utils.mergeObject({
      id: `peasant-skill-editor-${sheet.id}-${adapter.ref.collection}-${adapter.ref.entryId}`,
      classes: ["peasant-core", "peasant-tag-editor", "pc-notable-combat-tag-editor", "pc-skill-editor", "standard-form"],
      position: {
        width: 560,
        height: "auto"
      },
      window: {
        title: `${adapter.ref.collection === "skills" ? "Skill" : "Notable"}: ${entryName}`,
        icon: "fa-solid fa-bolt",
        resizable: true
      }
    }, options, { inplace: false });
    super(appOptions);

    this.sheet = sheet;
    this.adapter = adapter;
    this.ref = adapter.ref;
    this._controlsBound = false;
    this._boundElement = null;
    this._tagEditor = null;
    this._tagSaveControls = null;
    this._activeTab = "description";
    this._selectedUsageId = normalizeSkillEditorUsageSelection(entry, options.usageId);
    this._actorUpdateHookId = Hooks.on("updateActor", actor => {
      if (actor?.id !== this.sheet.actor?.id) return;
      const current = this._getCombatData();
      if (!current) {
        ui.notifications?.warn?.("This Skill or Notable no longer exists.");
        void this.close();
        return;
      }
      this._syncCounterInputs(current);
    });
  }

  _canEdit() {
    return !!this.sheet?.canModifyActor;
  }

  get isEditMode() {
    return !!this.sheet?.isEditMode;
  }

  _canEditFields() {
    return this._canEdit() && this.isEditMode;
  }

  _queueSave(callback) {
    const save = this._saveQueue.then(callback);
    this._saveQueue = save.catch(error => {
      console.error("Failed to save Skill/Notable edits:", error);
      ui.notifications?.error?.("Could not save changes. Your edits have been kept.");
      return false;
    });
    return this._saveQueue;
  }

  _hasPendingEdits($container = $(this.element)) {
    const descriptionEditor = $container[0]?.querySelector?.('prose-mirror[name="combatDescription"]');
    return !!(this._dirtyMainInputs.size || this._tagSaveControls?.isDirty()
      || (descriptionEditor && this._getDescriptionContent($container) !== (this._getCombatData()?.description || "")));
  }

  async _flushPendingEdits($container = $(this.element)) {
    if (!this._canEditFields() || !$container[0] || !this._getCombatData()) return true;
    clearTimeout(this._descriptionSaveTimer);
    do {
      await this._saveQueue;
      if (!this._canEditFields()) return false;
      while (this._dirtyMainInputs.size) {
        if (!this._canEditFields() || !await this._saveMainFields($container, this._dirtyMainInputs.values().next().value)) return false;
      }
      if (!await this._saveDescription($container)) return false;
      if ((await this._tagSaveControls?.saveCurrent({ notify: true })) === false) return false;
      await this._saveQueue;
      if (!this._canEditFields()) return false;
    } while (this._hasPendingEdits($container));
    return true;
  }

  _renderModeToggle() {
    renderDialogModeToggle(this.sheet, this.element);
  }

  async close(options = {}) {
    if (!await this._flushPendingEdits()) return false;
    return super.close(options);
  }

  get combatIndex() {
    return this._getEntryIndex();
  }

  static get DEFAULT_OPTIONS() {
    return foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
      window: {
        minimizable: true,
        resizable: true
      }
    }, { inplace: false });
  }

  _getHeaderControls() {
    const superControls = typeof super._getHeaderControls === "function" ? super._getHeaderControls() : [];
    const controls = Array.isArray(superControls) ? [...superControls] : [];
    // Match the actor sheet: keep the first visible label, or action for unlabeled controls.
    const seenLabels = new Set();
    const seenActions = new Set();
    const deduped = [];
    for (const control of controls) {
      if (!control || typeof control !== "object") continue;
      const labelKey = String(control.label ?? "").trim().toLowerCase();
      const actionKey = String(control.action ?? "").trim().toLowerCase();
      if (labelKey) {
        if (seenLabels.has(labelKey)) continue;
        seenLabels.add(labelKey);
      } else if (actionKey) {
        if (seenActions.has(actionKey)) continue;
        seenActions.add(actionKey);
      }
      deduped.push(control);
    }
    return deduped;
  }

  static get PARTS() {
    return {
      body: {
        template: TAG_EDITOR_BODY_TEMPLATE
      },
      footer: {
        template: TAG_EDITOR_FOOTER_TEMPLATE
      }
    };
  }

  async _prepareContext(options) {
    if (this.element && !await this._flushPendingEdits()) throw new Error("Complete the current edits before refreshing the editor.");
    const context = await super._prepareContext(options);
    const combatData = this._getCombatData();
    if (!combatData) {
      ui.notifications?.warn?.("This Skill or Notable no longer exists.");
      this.close();
      return context;
    }
    this._selectedUsageId = normalizeSkillEditorUsageSelection(combatData, this._selectedUsageId);
    const rank = String(combatData.rank ?? "0").trim();
    const combatName = combatData.name || "";
    const combatType = String(combatData.type || "skill");
    const entryKindLabel = this.ref.collection === "skills" ? "Skill" : "Notable";
    const effectContext = prepareNotableCombatEffectContext(this.sheet.actor, combatData, {
      groupedByType: this._areNotableCombatEffectsGroupedByType(),
      selectedUsageId: this._selectedUsageId,
      sortMode: this._getNotableCombatEffectSortMode()
    });
    const identityContext = prepareSkillEditorIdentity(combatData, {
      collection: this.ref.collection,
      effectiveEntry: this.adapter.readEffective(),
      selectedUsageId: this._selectedUsageId,
      editable: this._canEdit()
    });
    return Object.assign(context, {
      ...identityContext,
      entryKindLabel,
      combatName,
      combatClassInput: Number.parseInt(combatData.class, 10) || 1,
      combatRankInput: rank || "0",
      combatToHitInput: formatOptionalIntegerInput(combatData.tohit),
      combatAccuracyInput: formatOptionalIntegerInput(combatData.accuracy, { showPlus: true }),
      combatType,
      combatTypeOptions: getCombatTypeOptions(combatType),
      combatImageAlt: combatName || "Notable Combat",
      combatImageSrc: String(combatData.img || "").trim() || getDefaultCombatImage(),
      combatDescription: combatData.description || "",
      descriptionHTML: await (foundry?.applications?.ux?.TextEditor?.implementation?.enrichHTML?.(
        combatData.description || "", { async: true }
      ) ?? combatData.description ?? ""),
      documentUuid: this.sheet.actor?.uuid || "",
      canManageEntry: this._canEdit(),
      editable: this._canEditFields(),
      ...effectContext
    });
  }

  async _onRender(context, options) {
    if (typeof super._onRender === "function") await super._onRender(context, options);

    const $container = $(this.element);
    this._renderModeToggle();
    this.element?.classList?.toggle("editable", this._canEditFields());
    this.element?.classList?.toggle("interactable", this._canEdit() && !this.isEditMode);
    this.element?.classList?.toggle("locked", !this._canEdit());
    for (const control of this.element?.querySelectorAll?.("[data-pc-roll-override]") ?? []) control.disabled = !this._canEditFields();
    if (!this._controlsBound || this._boundElement !== $container[0]) {
      this._tagEditor = createNotableCombatTagEditorState($container);
      this._bindTagEditorControls($container);
      this._boundElement = $container[0];
      this._controlsBound = true;
    }
    this._dirtyMainInputs.clear();

    this._renderCurrentTags($container);
    this._syncDescriptionEditorFromData($container);
    this._applyActiveTab($container);
    this._bindNotableCombatEffectControls($container);
  }

  _bindTagEditorControls($container) {
    const buildTagInputs = (tagType) => {
      renderNotableCombatTagInputs($container, tagType, this._getSelectedUsageData(), {
        tagEditorState: this._tagEditor.state
      });
      for (const input of $container[0]?.querySelectorAll?.(".tag-input-area input, .tag-input-area select, .tag-input-area textarea, .tag-input-area button") ?? []) {
        input.disabled = !this._canEditFields();
      }
    };

    this._bindLayoutControls($container);
    this._bindNotableCombatEffectControls($container);

    setupNotableCombatTagSelectionControls($container, {
      tagEditor: this._tagEditor,
      buildTagInputs,
      beforeSelect: () => this._tagSaveControls?.saveCurrent({ notify: true }) ?? true,
      openDescriptionEditor: () => this._showDescriptionTab($container),
      onBeginEdit: (row, selection) => {
        this._showTagDraft($container, row, selection);
        this._tagSaveControls?.beginDraft({ isNew: !row });
        if (!row) void this._tagSaveControls?.saveCurrent();
      },
      onCancel: () => this._hideTagDraft($container)
    });
    setupSkillUsageSelectionControls($container[0], {
      onSelect: usageId => void this._selectUsage(usageId, $container)
    });

    const removeTagFromElement = setupNotableCombatTagRemoveControls(this.sheet, $container, this.combatIndex, {
      removeTag: async (tagType, { customId } = {}) => {
        if (!this._canEdit() || !await this._prepareToLeaveUsage($container)) return { ok: false };
        return this.adapter.setTag(tagType, {}, {
          usageId: this._getTagWriteUsageId(tagType), mode: "remove", customId, render: false
        });
      },
      onChanged: () => {
        this._renderCurrentTags($container);
        this._syncDescriptionEditorFromData($container);
      }
    });
    this._setupTagContextMenu($container[0], { removeTagFromElement });

    this._tagSaveControls = setupNotableCombatTagSaveControls(this.sheet, $container, this.combatIndex, {
      tagEditor: this._tagEditor,
      canSave: () => this._canEditFields(),
      getCombatData: () => this._getSelectedUsageData(),
      saveTag: (tagType, tagData, options) => this._saveTag(tagType, tagData, options),
      onChanged: () => {
        if (!this._tagEditor.state.tagType) this._hideTagDraft($container);
        this._renderCurrentTags($container);
      }
    });
    this._setupUsageContextMenu($container[0]);
  }

  _bindLayoutControls($container) {
    $container.on("click", "[data-pc-notable-combat-tab]", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._setActiveTab(ev.currentTarget?.dataset?.pcNotableCombatTab, $container);
    });

    $container.on("click", "[data-pc-notable-combat-open-effect]", (ev) => {
      this._onOpenNotableCombatEffectClick(ev);
    });

    $container.on("change", 'prose-mirror[name="combatDescription"]', () => void this._saveDescription($container));
    $container.on("input", 'prose-mirror[name="combatDescription"]', () => {
      if (!this._canEditFields()) return;
      clearTimeout(this._descriptionSaveTimer);
      this._descriptionSaveTimer = setTimeout(() => void this._saveDescription($container), 400);
    });
    $container.on("focusout", 'prose-mirror[name="combatDescription"]', () => {
      clearTimeout(this._descriptionSaveTimer);
      void this._saveDescription($container);
    });
    $container.on("input change", "input, select, textarea", ev => {
      if (this._canEditFields() && getSkillEditorFieldGroup(ev.currentTarget)) this._dirtyMainInputs.add(ev.currentTarget);
    });

    $container.on("click", "[data-pc-entry-use]", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await this._useSelectedUsage($container, ev.currentTarget);
    });

    $container.on("click", "[data-pc-roll-override]", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await this._toggleRollOverride(ev.currentTarget?.dataset?.pcRollOverride);
    });

    $container.on("click", "[data-pc-add-tag-toggle]", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const chooser = $container[0]?.querySelector?.("[data-pc-tag-chooser]");
      if (chooser) chooser.hidden = !chooser.hidden;
      if (!chooser?.hidden) chooser.querySelector("input")?.focus?.();
    });

    $container.on("keydown", "[data-pc-tag-draft]", async (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      await this._tagSaveControls?.saveCurrent();
      this._tagSaveControls?.beginDraft();
      this._tagEditor?.reset({ clearForm: true });
      this._hideTagDraft($container);
      const chooser = $container[0]?.querySelector?.("[data-pc-tag-chooser]");
      if (chooser) chooser.hidden = true;
    });

    $container.on("input", ".pc-notable-combat-tohit-input", (ev) => {
      ev.currentTarget.value = sanitizeOptionalIntegerInputValue(ev.currentTarget.value);
    });

    $container.on("input", ".pc-notable-combat-accuracy-input", (ev) => {
      ev.currentTarget.value = sanitizeOptionalIntegerInputValue(ev.currentTarget.value, { allowSign: true });
    });

    $container.on("keydown", ".pc-notable-combat-rank-input", (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (RANK_NAVIGATION_KEYS.has(ev.key)) return;
      if (!/^[1234uU]$/.test(ev.key)) ev.preventDefault();
    });

    $container.on("input", ".pc-notable-combat-rank-input", (ev) => {
      const before = ev.currentTarget.value || "";
      const normalized = normalizeRankInputValue(before);
      if (normalized !== before) ev.currentTarget.value = normalized;
    });

    $container.on("blur", ".pc-notable-combat-rank-input", (ev) => {
      const finalValue = finalizeRankInputValue(ev.currentTarget.value);
      if (finalValue !== ev.currentTarget.value) ev.currentTarget.value = finalValue;
    });

    $container.on("change", ".pc-notable-combat-name-input, .pc-notable-combat-class-input, .pc-notable-combat-rank-input, .pc-notable-combat-tohit-input, .pc-notable-combat-accuracy-input, .pc-notable-combat-special-grade-input", async (ev) => {
      await this._saveMainFields($container, ev.currentTarget);
    });

    $container.on("change", ".pc-entry-category-select, .pc-entry-type-select, .pc-entry-type-custom, .pc-entry-weapon-type-select, .pc-entry-weapon-type-custom, .pc-entry-defense-type-select, .pc-entry-defense-type-custom, .pc-entry-trick-type-select, .pc-entry-trick-type-custom, .pc-entry-signature-type-select, .pc-entry-signature-type-custom, .pc-entry-gate-type-select, .pc-entry-gate-type-custom, [data-pc-entry-characteristic], .pc-entry-characteristic-mode-select, .pc-entry-signature-current, .pc-entry-signature-max, .pc-entry-duress-uses, .pc-entry-duress-current, .pc-entry-duress-max, .pc-entry-ap-input, .pc-entry-sp-input", async (ev) => {
      const typeChoice = ev.currentTarget?.closest?.(".pc-skill-editor-type-choice");
      const typeSelect = typeChoice?.querySelector?.("select");
      const customInput = typeChoice?.querySelector?.("input");
      if (typeSelect && customInput) {
        customInput.hidden = typeSelect.value !== "custom";
        if (ev.currentTarget === typeSelect && typeSelect.value === "custom") {
          await this._saveMainFields($container, ev.currentTarget);
          customInput.focus();
          return;
        }
      }
      await this._saveMainFields($container, ev.currentTarget);
      if (ev.currentTarget?.matches?.(".pc-entry-category-select, .pc-entry-type-select, [data-pc-entry-characteristic], .pc-entry-duress-uses")) {
        await this.render({ force: true });
      }
    });

    $container.on("click", ".pc-notable-combat-toggle-type", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await this._switchToSpecialType();
    });

    $container.on("click", "[data-pc-notable-combat-image-picker]", async (ev) => {
      await this._openCombatImagePicker(ev, $container);
    });

    $container.on("click", "[data-pc-notable-combat-image-frame]", (ev) => {
      if (ev.target?.closest?.("[data-pc-notable-combat-image-picker]")) return;
      if (this._canEditFields()) return;
      ev.preventDefault();
      this._openCombatImagePopout();
    });
  }

  async _toggleRollOverride(field) {
    if (!this._canEditFields() || this._selectedUsageId === "base") return;
    if (!await this._prepareToLeaveUsage()) return;
    if (!["characteristics", "characteristicMode", "tohit", "accuracy"].includes(field)) return;
    const usage = this._getSelectedUsage();
    const entry = this._getCombatData();
    if (!usage || !entry) return;
    const customized = Object.prototype.hasOwnProperty.call(usage.rollOverrides ?? {}, field);
    const result = customized
      ? await this.adapter.update({}, { usageId: this._selectedUsageId, unset: [`rollOverrides.${field}`], render: false })
      : await this.adapter.update({ rollOverrides: { [field]: structuredClone(entry[field]) } }, { usageId: this._selectedUsageId, render: false });
    if (result?.ok) await this.render({ force: true });
  }

  async _selectUsage(usageId, $container = $(this.element)) {
    const nextUsageId = normalizeSkillEditorUsageSelection(this._getCombatData(), usageId);
    if (nextUsageId === this._selectedUsageId) return true;
    if (!await this._prepareToLeaveUsage($container)) {
      for (const select of $container[0]?.querySelectorAll?.("[data-pc-usage-select]") ?? []) select.value = this._selectedUsageId;
      return false;
    }
    this._selectedUsageId = nextUsageId;
    await this.render({ force: true });
    return true;
  }

  _hasOpenTagDraft($container = $(this.element)) {
    const draft = $container[0]?.querySelector?.("[data-pc-tag-draft]");
    return !!draft && !draft.hidden;
  }

  async _prepareToLeaveUsage($container = $(this.element)) {
    if (!await this._flushPendingEdits($container)) return false;
    this._tagEditor?.reset({ clearForm: true });
    this._hideTagDraft($container);
    return true;
  }

  async _useSelectedUsage($container = $(this.element), button = null) {
    if (!this._canEdit() || !await this._prepareToLeaveUsage($container)) return false;
    if (button) button.disabled = true;
    try {
      const result = await startPeasantEntryUse({
        actor: this.sheet.actor,
        ref: this.ref,
        usageId: this._selectedUsageId,
        sheet: this.sheet
      });
      if (result) await this.render({ force: true });
      return result;
    } catch (error) {
      console.error("Failed to use the selected Skill or Notable usage:", error);
      ui.notifications?.error?.("Failed to use the selected usage. See console for details.");
      return false;
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  async _addUsage() {
    if (!this._canEdit()) return;
    const $container = $(this.element);
    if (!await this._prepareToLeaveUsage($container)) return;
    const name = await promptUsageName({ title: "Add Usage", label: "Usage Name", value: "New Usage", actionLabel: "Add Usage" });
    if (name === null) return;
    const result = await this.adapter.manageUsage("add", { name, render: false });
    if (!result?.ok) return ui.notifications?.error?.("Could not add the usage.");
    this._selectedUsageId = result.usageId;
    await this.render({ force: true });
  }

  async _renameUsage() {
    if (!await this._prepareToLeaveUsage()) return;
    const usage = this._getSelectedUsage();
    if (!usage) return;
    const name = await promptUsageName({ title: "Rename Usage", label: "Usage Name", value: usage.name, actionLabel: "Rename" });
    if (name === null) return;
    const result = await this.adapter.manageUsage("rename", { usageId: this._selectedUsageId, name, render: false });
    if (result?.ok) await this.render({ force: true });
  }

  async _duplicateUsage() {
    if (!await this._prepareToLeaveUsage($(this.element))) return;
    const result = await this.adapter.manageUsage("duplicate", { usageId: this._selectedUsageId, render: false });
    if (!result?.ok) return ui.notifications?.error?.("Could not duplicate the usage.");
    this._selectedUsageId = result.usageId;
    await this.render({ force: true });
  }

  async _makeDefaultUsage() {
    if (!await this._prepareToLeaveUsage()) return;
    const result = await this.adapter.manageUsage("default", { usageId: this._selectedUsageId, render: false });
    if (result?.ok) await this.render({ force: true });
  }

  async _deleteUsage() {
    if (this._selectedUsageId === "base") return;
    if (!await this._prepareToLeaveUsage($(this.element))) return;
    const usage = this._getSelectedUsage();
    if (!usage) return;
    const isDefault = this._getCombatData()?.defaultUsageId === this._selectedUsageId;
    const replacement = isDefault ? " Base will become the default usage." : "";
    const confirmed = await confirmUsageAction({
      title: "Delete Usage",
      content: `<p>Delete <strong>${escapeDialogText(usage.name || "Untitled Usage")}</strong>?${replacement}</p>`,
      label: "Delete"
    });
    if (!confirmed) return;
    const result = await this.adapter.manageUsage("delete", {
      usageId: this._selectedUsageId,
      replacementDefaultId: isDefault ? "base" : null,
      render: false
    });
    if (!result?.ok) return ui.notifications?.error?.(result?.error || "Could not delete the usage.");
    this._selectedUsageId = "base";
    await this.render({ force: true });
  }

  async _clearUsage() {
    if (!await this._prepareToLeaveUsage($(this.element))) return;
    const usage = this._getSelectedUsage();
    if (!usage) return;
    const confirmed = await confirmUsageAction({
      title: "Clear Usage",
      content: `<p>Clear all authored mechanics from <strong>${escapeDialogText(usage.name || "Untitled Usage")}</strong>?</p>`,
      label: "Clear"
    });
    if (!confirmed) return;
    const result = await this.adapter.manageUsage("clear", { usageId: this._selectedUsageId, render: false });
    if (result?.ok) await this.render({ force: true });
  }

  _selectedUsageShortcut() {
    const entry = this._getCombatData();
    const usage = this._getSelectedUsage();
    if (!entry || !usage || !this.sheet.actor?.uuid) return null;
    return {
      payload: {
        actorUuid: this.sheet.actor.uuid,
        collection: this.ref.collection,
        entryId: this.ref.entryId,
        usageId: this._selectedUsageId
      },
      label: `${entry.name || "Skill"}: ${usage.name || "Default"}`
    };
  }

  async _copySelectedUsageLink() {
    const shortcut = this._selectedUsageShortcut();
    if (!shortcut) return false;
    try {
      await game.clipboard.copyPlainText(createPeasantUsageLink(shortcut.payload, shortcut.label));
      ui.notifications?.info?.("Usage link copied.");
      return true;
    } catch (error) {
      ui.notifications?.warn?.("Could not copy the usage link.");
      return false;
    }
  }

  async _addSelectedUsageToHotbar() {
    const shortcut = this._selectedUsageShortcut();
    if (!shortcut) return false;
    return game.peasantCore?.addSkillUsageToHotbar?.(shortcut.payload) ?? false;
  }

  _bindNotableCombatEffectControls($container) {
    const root = $container[0];
    const browser = qs(root, "[data-pc-notable-combat-effects-browser]");
    if (!browser) return;

    if (browser.dataset.pcNotableCombatEffectsBound === "true") {
      this._applyNotableCombatEffectGroupMode(root);
      return;
    }
    browser.dataset.pcNotableCombatEffectsBound = "true";

    delegate(browser, "input", "[data-pc-notable-combat-effects-search]", () => this._applyNotableCombatEffectSearch(root));

    if (root.dataset.pcNotableCombatEffectAddBound !== "true") {
      root.dataset.pcNotableCombatEffectAddBound = "true";
      delegate(root, "click", "[data-pc-notable-combat-add-effect]", async (event, control) => {
        event.preventDefault();
        event.stopPropagation();
        await this._createNotableCombatEffect($container, {
          scope: "usage"
        });
      });
    }

    delegate(browser, "click", "[data-pc-notable-combat-effects-group-toggle]", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._pcNotableCombatEffectsGroupedByType = !this._areNotableCombatEffectsGroupedByType();
      this._applyNotableCombatEffectGroupMode(root);
    });

    delegate(browser, "click", "[data-pc-notable-combat-effects-sort-toggle]", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const mode = this._getNotableCombatEffectSortMode();
      this._pcNotableCombatEffectSortMode = PC_NOTABLE_EFFECT_SORT_MODES[mode].next;
      this._sortNotableCombatEffectRows(root);
      this._syncNotableCombatEffectSortToggle(root);
      this._syncNotableCombatEffectDragState(root);
      this._applyNotableCombatEffectSearch(root);
    });

    this._setupNotableCombatEffectContextMenu(browser);
    this._setupNotableCombatEffectManualSortControls(root, browser);
    this._applyNotableCombatEffectGroupMode(root);
  }

  _onOpenNotableCombatEffectClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const effect = getNotableCombatEffectFromElement(this.sheet.actor, event.currentTarget);
    this._openNotableCombatEffectSheet(effect);
  }

  _setupTagContextMenu(root, { removeTagFromElement } = {}) {
    const ContextMenuClass = getContextMenuClass();
    if (!ContextMenuClass || !root) return;
    new ContextMenuClass(root, "[data-pc-tag-menu]", [], {
      eventName: "click",
      fixed: true,
      jQuery: false,
      relative: "target",
      onOpen: element => {
        const row = element?.closest?.(".pc-skill-tag-row");
        if (!row) return;
        const tagType = row.dataset.tagType;
        const usage = this._getSelectedUsage();
        const items = [
          {
            label: "Edit",
            icon: "fa-solid fa-pen-to-square",
            onClick: () => row.querySelector("[data-pc-tag-edit]")?.click()
          },
          {
            label: "Condition / Limit",
            icon: "fa-solid fa-list-check",
            onClick: () => this._configureTagCondition(row.dataset.tagKey)
          }
        ];
        for (const link of usage?.effectLinks?.filter(candidate => candidate?.tagKey === row.dataset.tagKey) ?? []) {
          const effect = this.sheet.actor?.effects?.get?.(link.effectId);
          if (!effect) continue;
          items.push({
            label: `Edit Linked Effect: ${effect.name ?? effect.label ?? "Effect"}`,
            icon: "fa-solid fa-bolt",
            onClick: () => this._openNotableCombatEffectSheet(effect, { mode: "edit" })
          });
        }
        if (this._selectedUsageId !== "base" && ["tagUses", "sections"].includes(tagType)) {
          const localPool = usage?.counterScopes?.[tagType] === "local";
          items.push({
            label: localPool ? "Use Shared Pool" : "Use Local Pool",
            icon: localPool ? "fa-solid fa-link" : "fa-solid fa-code-branch",
            onClick: () => this._toggleUsageCounterScope(tagType, localPool ? "shared" : "local")
          });
        }
        items.push(
          {
            label: "Move Up",
            icon: "fa-solid fa-arrow-up",
            onClick: () => this._moveTagByOffset(row.dataset.tagKey, -1)
          },
          {
            label: "Move Down",
            icon: "fa-solid fa-arrow-down",
            onClick: () => this._moveTagByOffset(row.dataset.tagKey, 1)
          }
        );
        items.push(
          {
            label: "Delete",
            icon: "fa-solid fa-trash",
            onClick: () => removeTagFromElement?.(row)
          }
        );
        ui.context.menuItems = items;
      }
    });
  }

  async _toggleUsageCounterScope(pool, scope) {
    const result = await this.adapter.manageUsage("counter-scope", {
      usageId: this._selectedUsageId,
      pool,
      scope,
      render: false
    });
    if (result?.ok) await this.render({ force: true });
  }

  _setupUsageContextMenu(root) {
    const ContextMenuClass = getContextMenuClass();
    if (!ContextMenuClass || !root) return;
    new ContextMenuClass(root, "[data-pc-usage-menu]", [], {
      eventName: "click",
      fixed: true,
      jQuery: false,
      relative: "target",
      onOpen: () => {
        const isBase = this._selectedUsageId === "base";
        const isDefault = this._getCombatData()?.defaultUsageId === this._selectedUsageId;
        const items = [{
          group: "usage",
          label: "Add Usage",
          icon: "fa-solid fa-plus",
          onClick: () => this._addUsage()
        }];
        items.push(
          {
            group: "usage",
            label: "Rename",
            icon: "fa-solid fa-pen-to-square",
            onClick: () => this._renameUsage()
          },
          {
            group: "usage",
            label: "Duplicate",
            icon: "fa-solid fa-copy",
            onClick: () => this._duplicateUsage()
          }
        );
        if (isBase) {
          items.push({
            group: "usage",
            label: "Clear",
            icon: "fa-solid fa-eraser",
            onClick: () => this._clearUsage()
          });
        } else {
          items.push({
            group: "usage",
            label: "Delete",
            icon: "fa-solid fa-trash",
            onClick: () => this._deleteUsage()
          });
        }
        if (!isDefault) {
          items.push({
            group: "shortcut",
            label: "Make Default",
            icon: "fa-solid fa-star",
            onClick: () => this._makeDefaultUsage()
          });
        }
        items.push({
          group: "shortcut",
          label: "Copy Link",
          icon: "fa-solid fa-link",
          onClick: () => this._copySelectedUsageLink()
        });
        items.push({
          group: "shortcut",
          label: "Add to Hotbar",
          icon: "fa-solid fa-thumbtack",
          onClick: () => this._addSelectedUsageToHotbar()
        });
        ui.context.menuItems = items;
      }
    });
  }

  _getNotableCombatEffectSortMode() {
    if (!PC_NOTABLE_EFFECT_SORT_MODES[this._pcNotableCombatEffectSortMode]) this._pcNotableCombatEffectSortMode = "manual";
    return this._pcNotableCombatEffectSortMode;
  }

  _areNotableCombatEffectsGroupedByType() {
    return this._pcNotableCombatEffectsGroupedByType !== false;
  }

  _syncNotableCombatEffectSortToggle(root) {
    const toggle = qs(root, "[data-pc-notable-combat-effects-sort-toggle]");
    if (!toggle) return;

    const mode = this._getNotableCombatEffectSortMode();
    const config = PC_NOTABLE_EFFECT_SORT_MODES[mode];
    toggle.classList.add("active");
    toggle.dataset.sortMode = mode;
    toggle.setAttribute("aria-pressed", "true");
    toggle.dataset.tooltip = config.label;
    toggle.setAttribute("aria-label", config.label);
    qs(toggle, "i")?.setAttribute("class", config.icon);
  }

  _canReorderNotableCombatEffects() {
    return this._canEdit() && this._getNotableCombatEffectSortMode() === "manual";
  }

  _syncNotableCombatEffectDragState(root) {
    const browser = qs(root, "[data-pc-notable-combat-effects-browser]");
    if (!browser) return;

    const enabled = this._canReorderNotableCombatEffects();
    browser.dataset.pcNotableCombatEffectsSortMode = this._getNotableCombatEffectSortMode();
    browser.classList.toggle("pc-inventory-manual-sort", enabled);
    for (const row of qsa(browser, "[data-pc-notable-combat-effect]")) {
      const sortable = enabled && row.dataset.effectScope !== "usage";
      row.draggable = sortable;
      row.classList.toggle("pc-inventory-sortable", sortable);
      if (!sortable) row.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
    }
  }

  _sortNotableCombatEffectRows(root) {
    const browser = qs(root, "[data-pc-notable-combat-effects-browser]");
    if (!browser) return;

    const mode = this._getNotableCombatEffectSortMode();
    for (const list of qsa(browser, ".pc-item-effects-items")) {
      const rows = qsa(list, "[data-pc-notable-combat-effect]");
      rows.sort((left, right) => {
        if (mode === "alpha") {
          const byName = String(left.dataset.sortAlpha ?? "").localeCompare(String(right.dataset.sortAlpha ?? ""));
          if (byName !== 0) return byName;
        }
        const byManual = (Number(left.dataset.sortManual) || 0) - (Number(right.dataset.sortManual) || 0);
        if (byManual !== 0) return byManual;
        return String(left.dataset.sortAlpha ?? "").localeCompare(String(right.dataset.sortAlpha ?? ""));
      });
      list.append(...rows);
    }
  }

  _applyNotableCombatEffectSearch(root) {
    const browser = qs(root, "[data-pc-notable-combat-effects-browser]");
    if (!browser) return;

    const input = qs(browser, "[data-pc-notable-combat-effects-search]");
    const query = String(input?.value ?? "").trim().toLowerCase();
    const activeView = qs(browser, "[data-pc-notable-combat-effects-view]:not([hidden])") ?? browser;
    let matchingRows = 0;
    let totalRows = 0;

    for (const section of qsa(activeView, "[data-pc-notable-combat-effects-section]")) {
      const rows = qsa(section, "[data-pc-notable-combat-effect]");
      let sectionMatches = 0;
      for (const row of rows) {
        totalRows += 1;
        const matches = !query || String(row.dataset.search ?? "").includes(query);
        row.hidden = !matches;
        if (matches) {
          sectionMatches += 1;
          matchingRows += 1;
        }
      }
      section.hidden = !!query && sectionMatches === 0;
    }

    const empty = qs(browser, ".pc-notable-combat-effects-search-empty");
    if (empty) empty.hidden = !query || totalRows === 0 || matchingRows > 0;
  }

  _applyNotableCombatEffectGroupMode(root) {
    const browser = qs(root, "[data-pc-notable-combat-effects-browser]");
    if (!browser) return;

    const grouped = this._areNotableCombatEffectsGroupedByType();
    const activeView = grouped ? "grouped" : "flat";
    browser.dataset.pcNotableCombatEffectsGrouped = grouped ? "true" : "false";

    for (const view of qsa(browser, "[data-pc-notable-combat-effects-view]")) {
      view.hidden = view.dataset.pcNotableCombatEffectsView !== activeView;
    }

    const toggle = qs(browser, "[data-pc-notable-combat-effects-group-toggle]");
    if (toggle) {
      toggle.classList.toggle("active", grouped);
      toggle.setAttribute("aria-pressed", grouped ? "true" : "false");
      const label = grouped ? "Grouped by Condition" : "Flat List";
      toggle.dataset.tooltip = label;
      toggle.setAttribute("aria-label", label);
    }

    this._sortNotableCombatEffectRows(root);
    this._syncNotableCombatEffectSortToggle(root);
    this._syncNotableCombatEffectDragState(root);
    this._applyNotableCombatEffectSearch(root);
  }

  async _reorderNotableCombatEffect(sourceEffect, targetRow, { sortBefore = false } = {}) {
    const targetEffect = getNotableCombatEffectFromElement(this.sheet.actor, targetRow);
    if (!sourceEffect || !targetEffect || targetRow?.dataset?.effectScope === "usage" || sourceEffect.id === targetEffect.id) return;

    const list = targetRow?.closest?.(".pc-item-effects-items");
    if (!list) return;

    const siblings = [];
    for (const row of getNotableCombatEffectRowsInList(list)) {
      if (row.dataset.effectScope === "usage") continue;
      const sibling = getNotableCombatEffectFromElement(this.sheet.actor, row);
      if (sibling && sibling.id !== sourceEffect.id) siblings.push(sibling);
    }

    const sortUpdates = foundry.utils.performIntegerSort?.(sourceEffect, {
      target: targetEffect,
      siblings,
      sortBefore
    });
    if (!sortUpdates?.length) return;

    const updateData = sortUpdates.map(({ target, update }) => ({
      ...update,
      _id: target.id ?? target._id
    }));
    await this.sheet.actor.updateEmbeddedDocuments("ActiveEffect", updateData);
  }

  _setupNotableCombatEffectManualSortControls(root, browser) {
    delegate(browser, "dragstart", "[data-pc-notable-combat-effect]", (event, row) => {
      if (!this._canReorderNotableCombatEffects()
        || row.dataset.effectScope === "usage"
        || event.target?.closest?.(PC_NOTABLE_EFFECT_DRAG_BLOCK_SELECTOR)) {
        event.preventDefault();
        return;
      }

      const effect = getNotableCombatEffectFromElement(this.sheet.actor, row);
      const list = row.closest(".pc-item-effects-items");
      if (!effect || !list) {
        event.preventDefault();
        return;
      }

      row.classList.add("dragging");
      this._pcNotableCombatEffectDragState = {
        actorUuid: this.sheet.actor?.uuid,
        effectId: effect.id,
        list
      };

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `${PC_NOTABLE_EFFECT_DRAG_PREFIX}:${this.sheet.actor.uuid}:${effect.id}`);
        const dragImage = qs(row, ".pc-item-effect-row") ?? row;
        const box = dragImage.getBoundingClientRect();
        event.dataTransfer.setDragImage(dragImage, Math.min(box.width - 6, 48), box.height / 2);
      }
    });

    delegate(browser, "dragend", "[data-pc-notable-combat-effect]", (_event, row) => {
      row.classList.remove("dragging");
      clearNotableCombatEffectDragMarkers(root);
      this._pcNotableCombatEffectDragState = null;
    });

    delegate(browser, "dragover", ".pc-item-effects-items, [data-pc-notable-combat-effect]", (event, target) => {
      if (!this._canReorderNotableCombatEffects() || !this._pcNotableCombatEffectDragState) return;

      const list = target.closest?.(".pc-item-effects-items");
      if (!list || list !== this._pcNotableCombatEffectDragState.list) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearNotableCombatEffectDragMarkers(root);

      const targetRow = getNotableCombatEffectDropTargetRow(event.target, list);
      if (!targetRow || targetRow.dataset.effectScope === "usage" || targetRow.dataset.effectId === this._pcNotableCombatEffectDragState.effectId) return;
      const rows = getNotableCombatEffectRowsInList(list).filter(row => row.dataset.effectScope !== "usage");
      markVerticalDropBoundary(rows, targetRow, isNotableCombatEffectDropAfter(targetRow, event.clientY));
    });

    delegate(browser, "dragleave", ".pc-item-effects-items", () => {
      clearNotableCombatEffectDragMarkers(root);
    });

    delegate(browser, "drop", ".pc-item-effects-items, [data-pc-notable-combat-effect]", async (event, target) => {
      const dragData = getNotableCombatEffectSortDragData(event);
      if (!this._canReorderNotableCombatEffects() || !this._pcNotableCombatEffectDragState || dragData?.actorUuid !== this.sheet.actor?.uuid) return;

      const list = target.closest?.(".pc-item-effects-items");
      if (!list || list !== this._pcNotableCombatEffectDragState.list) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      clearNotableCombatEffectDragMarkers(root);

      const sourceEffect = this.sheet.actor?.effects?.get?.(dragData.effectId);
      const targetRow = getNotableCombatEffectDropTargetRow(event.target, list);
      if (!sourceEffect || !targetRow || targetRow.dataset.effectScope === "usage" || targetRow.dataset.effectId === sourceEffect.id) {
        this._pcNotableCombatEffectDragState = null;
        return;
      }

      try {
        await this._reorderNotableCombatEffect(sourceEffect, targetRow, {
          sortBefore: !isNotableCombatEffectDropAfter(targetRow, event.clientY)
        });
      } finally {
        this._pcNotableCombatEffectDragState = null;
      }
    });
  }

  _setupNotableCombatEffectContextMenu(browser) {
    if (!this.sheet?.canModifyActor) return;

    const ContextMenuClass = getContextMenuClass();
    if (!ContextMenuClass) return;

    new ContextMenuClass(browser, "[data-pc-notable-combat-effect-menu]", [], {
      eventName: "click",
      fixed: true,
      jQuery: false,
      relative: "target",
      onOpen: element => {
        const reference = getNotableCombatEffectReferenceFromElement(this.sheet.actor, element);
        if (!reference) return;
        ui.context.menuItems = this._getNotableCombatEffectContextOptions(reference);
      }
    });
  }

  _getNotableCombatEffectContextOptions(reference) {
    const effect = reference?.effect;
    const options = [];
    if (effect) options.push({
        label: "Edit",
        icon: "fa-solid fa-pen-to-square",
        onClick: () => this._openNotableCombatEffectSheet(effect, { mode: "edit" })
      },
      {
        label: "Duplicate",
        icon: "fa-solid fa-copy",
        onClick: async () => this._duplicateNotableCombatEffect(effect, reference)
      });
    if (reference?.scope === "usage") options.push({
      label: "Configure Link",
      icon: "fa-solid fa-link",
      onClick: async () => this._configureNotableCombatEffectLink(reference)
    });
    if (!effect && reference?.scope === "whole") options.push({
      label: "Remove Reference",
      icon: "fa-solid fa-link-slash",
      onClick: async () => {
        await this._setCurrentNotableCombatEffectIds(
          this._getCurrentNotableCombatEffectIds().filter(id => id !== reference.effectId)
        );
        await this.render({ force: true });
      }
    });
    if (effect) options.push({
        label: "Delete",
        icon: "fa-solid fa-trash",
        onClick: async () => this._deleteNotableCombatEffect(effect)
      });
    return options;
  }

  _openNotableCombatEffectSheet(effect, { mode = null } = {}) {
    const sheet = effect?.sheet;
    if (!sheet || typeof sheet.render !== "function") return;
    const modes = sheet.constructor?.MODES ?? {};
    if (mode === "edit" && modes.EDIT !== undefined) return sheet.render({ force: true, mode: modes.EDIT });
    return sheet.render(true);
  }

  _getCurrentNotableCombatEffectIds() {
    return getNotableCombatEffectIds(this._getCombatData());
  }

  async _setCurrentNotableCombatEffectIds(effectIds) {
    const seen = new Set();
    const ids = [];
    for (const id of effectIds) {
      const value = String(id ?? "").trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      ids.push(value);
    }
    await this.adapter.update({ effectIds: ids }, { render: false });
    return ids;
  }

  async _addNotableCombatEffectId(effectId) {
    await this._setCurrentNotableCombatEffectIds([...this._getCurrentNotableCombatEffectIds(), effectId]);
  }

  async _createNotableCombatEffect($container = $(this.element), { scope = "whole" } = {}) {
    if (!this._canEditFields() || !await this._prepareToLeaveUsage($container)) return;

    const combatData = this._getCombatData();
    const combatName = String(combatData.name || "").trim() || "Skill";
    const usageDefinition = scope === "usage";
    const created = await this.sheet.actor?.createEmbeddedDocuments?.("ActiveEffect", [{
      type: PC_NOTABLE_COMBAT_EFFECT_TYPE,
      name: usageDefinition ? `${combatName} Usage Effect` : `${combatName} Effect`,
      img: getNotableCombatEffectImage(this.sheet.actor, combatData),
      origin: this.sheet.actor?.uuid,
      ...(usageDefinition ? {
        disabled: true,
        flags: { "peasant-core": { skillEditorDefinition: true } }
      } : {})
    }]);
    const effect = created?.[0] ?? null;
    if (!effect) return;

    if (usageDefinition) {
      const linked = await this.adapter.manageEffectLink("link", {
        usageId: this._selectedUsageId,
        effectLink: {
          effectId: effect.id,
          tagKey: "",
          when: "success",
          recipient: "self",
          application: "automatic"
        },
        render: false
      });
      if (!linked?.ok) {
        await effect.delete?.({ render: false });
        ui.notifications?.error?.(linked?.error || "Could not link the usage effect.");
        return;
      }
    } else {
      await this._addNotableCombatEffectId(effect.id);
    }
    await this.render({ force: true });
    this._openNotableCombatEffectSheet(effect, { mode: "edit" });
  }

  async _duplicateNotableCombatEffect(effect, reference = { scope: "whole" }) {
    if (!effect || !this.sheet?.canModifyActor) return null;
    const effectName = effect.name ?? effect.label ?? "Active Effect";
    const name = game.i18n?.format?.("DOCUMENT.CopyOf", { name: effectName })
      ?? `Copy of ${effectName}`;

    let duplicate = null;
    const duplicateData = {
      name,
      type: PC_NOTABLE_COMBAT_EFFECT_TYPE
    };
    if (typeof effect.clone === "function") {
      duplicate = await effect.clone(duplicateData, { save: true, addSource: true });
    } else {
      const source = effect.toObject?.() ?? effect._source ?? null;
      if (!source) return null;
      const data = foundry.utils.deepClone(source);
      delete data._id;
      foundry.utils.mergeObject(data, duplicateData);
      const created = await this.sheet.actor?.createEmbeddedDocuments?.("ActiveEffect", [data]);
      duplicate = created?.[0] ?? null;
    }

    if (duplicate) {
      if (reference.scope === "usage") {
        const sourceLink = this._getSelectedUsage()?.effectLinks?.find(link => link.id === reference.linkId);
        const linked = await this.adapter.manageEffectLink("link", {
          usageId: this._selectedUsageId,
          effectLink: { ...sourceLink, id: "", effectId: duplicate.id },
          render: false
        });
        if (!linked?.ok) {
          await duplicate.delete?.({ render: false });
          ui.notifications?.error?.(linked?.error || "Could not link the duplicated usage effect.");
          return null;
        }
      } else {
        await this._addNotableCombatEffectId(duplicate.id);
      }
      await this.render({ force: true });
    }
    return duplicate;
  }

  async _configureNotableCombatEffectLink(reference) {
    const link = this._getSelectedUsage()?.effectLinks?.find(candidate => candidate.id === reference?.linkId);
    if (!link) return ui.notifications?.error?.("The usage effect link is unavailable.");
    const tags = getActiveNotableCombatEditorTags(this._getSelectedUsageData());
    const patch = await promptSkillEffectLink(link, tags, this._getSelectedUsage()?.rules ?? []);
    if (!patch) return;
    const result = await this.adapter.manageEffectLink("link", {
      usageId: this._selectedUsageId,
      effectLink: { ...link, ...patch },
      render: false
    });
    if (!result?.ok) return ui.notifications?.error?.(result?.error || "Could not update the usage effect link.");
    await this.render({ force: true });
  }

  async _configureTagCondition(tagKey) {
    if (!this._canEdit()) return;
    if (!await this._prepareToLeaveUsage()) return;
    const patch = await promptSkillTagCondition(tagKey, this._getSelectedUsage());
    if (!patch) return;
    const result = await this.adapter.manageUsage("condition", {
      usageId: this._selectedUsageId, tagKey, ...patch, render: false
    });
    if (!result?.ok) return ui.notifications?.error?.(result?.error || "Could not save the tag condition.");
    await this.render({ force: true });
  }

  async _deleteNotableCombatEffect(effect) {
    if (!effect || !this.sheet?.canModifyActor) return;
    const id = effect.id;
    if (typeof effect.deleteDialog === "function") {
      await effect.deleteDialog({}, { render: false });
    } else {
      await effect.delete();
    }
    if (!this.sheet.actor?.effects?.get?.(id)) {
      await this.sheet.actor?.removePeasantEffectReferences?.(id, { render: false });
      await this.render({ force: true });
    }
  }

  _getCombatData() {
    return this.adapter.readSource();
  }

  _getSelectedUsage() {
    const entry = this._getCombatData();
    if (!entry) return null;
    return this._selectedUsageId === "base"
      ? { id: "base", ...(entry.baseUsage ?? {}) }
      : entry.usages?.find(usage => usage.id === this._selectedUsageId) ?? null;
  }

  _getSelectedUsageData() {
    const entry = this._getCombatData();
    if (!entry) return null;
    const resolved = resolveSkillUsage(entry, this._selectedUsageId);
    return resolved.ok ? resolved.data : entry;
  }

  _getTagWriteUsageId(tagType) {
    if (this._selectedUsageId === "base") return "base";
    const usage = this._getSelectedUsage();
    if (["tagUses", "sections"].includes(tagType) && usage?.counterScopes?.[tagType] !== "local") return "base";
    return this._selectedUsageId;
  }

  _syncCounterInputs(entry = this._getCombatData()) {
    const root = this.element;
    if (!root || !entry) return;
    const values = [
      [".pc-entry-signature-current", entry.usesCurrent],
      [".pc-entry-signature-max", entry.usesMax],
      [".pc-entry-duress-current", entry.signatureUsage?.duressCurrent],
      [".pc-entry-duress-max", entry.signatureUsage?.duressMax]
    ];
    for (const [selector, value] of values) {
      const input = root.querySelector(selector);
      if (input && document.activeElement !== input && !this._dirtyMainInputs.has(input)) input.value = value ?? 0;
    }
  }

  _getEntryIndex() {
    const entries = this.ref.collection === "skills"
      ? this.sheet.actor.getPeasantSkillsForUpdate?.()
      : this.sheet.actor.getPeasantNotableCombatsForUpdate?.();
    return Array.isArray(entries)
      ? entries.findIndex(entry => String(entry?.id ?? "") === this.ref.entryId)
      : -1;
  }

  _renderCurrentTags($container = $(this.element), { provisionalTag = null } = {}) {
    const draftOpen = this._hasOpenTagDraft($container);
    this._returnTagDraft($container);
    const $list = $container.find("[data-pc-local-tags-list] > .current-tags-list");
    const usage = this._getSelectedUsage();
    const selectedTags = getActiveNotableCombatEditorTags(this._getSelectedUsageData());
    renderNotableCombatTagList($list, addSkillTagConditionLabels(selectedTags, usage), {
      editable: this._canEditFields(), interactable: this._canEdit(), provisionalTag
    });
    if (draftOpen) {
      const state = this._tagEditor?.state;
      const key = state?.tagType === "custom" ? `custom:${state.customId}` : state?.tagType;
      const row = Array.from($container[0]?.querySelectorAll?.(".current-tag-item") ?? [])
        .find(item => item.dataset.tagKey === key);
      if (row) this._showTagDraft($container, row);
    }

    setupNotableCombatTagEditorDrag(this.sheet, $container, this.combatIndex, {
      reorderTag: (draggedKey, targetKey, options) => this._reorderTag(draggedKey, targetKey, options),
      onChanged: () => this._renderCurrentTags($container)
    });
  }

  _returnTagDraft($container = $(this.element)) {
    const root = $container[0];
    const draft = root?.querySelector?.("[data-pc-tag-draft]");
    const home = root?.querySelector?.("[data-pc-tag-draft-home]");
    if (draft && home && draft.parentElement !== home) home.append(draft);
  }

  _showTagDraft($container, row = null, { tagType = "", label = "" } = {}) {
    const root = $container[0];
    const draft = root?.querySelector?.("[data-pc-tag-draft]");
    if (!draft) return;
    if (!row && tagType) {
      this._renderCurrentTags($container, {
        provisionalTag: {
          kind: "tag",
          type: tagType,
          key: `provisional:${tagType}`,
          label: label || tagType,
          summary: ""
        }
      });
      row = root.querySelector("[data-pc-tag-provisional]");
    }
    draft.hidden = false;
    if (row?.parentElement) row.insertAdjacentElement("afterend", draft);
    const chooser = root.querySelector("[data-pc-tag-chooser]");
    if (chooser) chooser.hidden = true;
  }

  _hideTagDraft($container = $(this.element)) {
    const root = $container[0];
    const provisional = root?.querySelector?.("[data-pc-tag-provisional]");
    this._returnTagDraft($container);
    const draft = root?.querySelector?.("[data-pc-tag-draft]");
    if (draft) draft.hidden = true;
    if (!provisional) return;
    provisional.remove();
    const list = root.querySelector("[data-pc-local-tags-list] > .current-tags-list")
      ?? root.querySelector(".current-tags-list");
    if (list && !list.querySelector(".current-tag-item")) {
      list.innerHTML = '<div class="pc-skill-tag-empty">No details configured.</div>';
    }
  }

  async _saveTag(tagType, tagData, { mode = "add", customId = "" } = {}) {
    if (!this._canEditFields()) return { ok: false, changed: false };
    const result = await this.adapter.setTag(
      tagType,
      tagData,
      { usageId: this._getTagWriteUsageId(tagType), mode, customId, render: false }
    );
    return result;
  }

  async _reorderTag(draggedKey, targetKey, { insertAfter = false } = {}) {
    const entry = this._getCombatData();
    if (!entry) return { ok: false, changed: false };
    if (this._selectedUsageId !== "base") {
      const usage = this._getSelectedUsage();
      if (!usage) return { ok: false, changed: false };
      const working = { layout: structuredClone(usage.layout ?? []) };
      if (working.layout.length === 0) {
        working.layout = getActiveNotableCombatEditorTags(this._getSelectedUsageData())
          .filter(row => row.kind === "tag")
          .map(row => ({ kind: "tag", key: row.key }));
      }
      const moved = moveSkillLayoutRow(working, draggedKey, targetKey, { insertAfter });
      if (JSON.stringify(moved.layout) === JSON.stringify(usage.layout ?? [])) return { ok: true, changed: false };
      return this.adapter.update({ layout: moved.layout }, { usageId: this._selectedUsageId, render: false });
    }
    const working = structuredClone(entry);
    if (!Array.isArray(working.baseUsage?.layout) || working.baseUsage.layout.length === 0) {
      working.baseUsage ??= {};
      working.baseUsage.layout = getActiveNotableCombatEditorTags(entry)
        .filter(row => row.kind === "tag")
        .map(row => ({ kind: "tag", key: row.key }));
    }
    const moved = moveSkillLayoutRow(working, draggedKey, targetKey, { insertAfter });
    if (JSON.stringify(moved.baseUsage?.layout) === JSON.stringify(entry.baseUsage?.layout)) {
      return { ok: true, changed: false };
    }
    return this.adapter.update({ baseUsage: { layout: moved.baseUsage.layout } }, { render: false });
  }

  async _moveTagByOffset(tagKey, offset) {
    const entry = this._getCombatData();
    if (!entry) return;
    const keys = getActiveNotableCombatEditorTags(this._getSelectedUsageData())
      .filter(row => row.kind === "tag")
      .map(row => row.key);
    const index = keys.indexOf(tagKey);
    const targetIndex = index + offset;
    if (index < 0 || targetIndex < 0 || targetIndex >= keys.length) return;
    const result = await this._reorderTag(tagKey, keys[targetIndex], { insertAfter: offset > 0 });
    if (result?.changed) this._renderCurrentTags($(this.element));
  }

  _syncDescriptionEditorFromData($container = $(this.element)) {
    const editor = $container[0]?.querySelector?.('prose-mirror[name="combatDescription"]');
    if (!editor) return;
    const description = this._getCombatData()?.description || "";
    const previousSaved = editor.dataset.pcSavedDescription ?? "";
    if (editor.dataset.pcDescriptionReady === "true" && String(editor.value ?? "") !== previousSaved) return;
    editor.value = description;
    editor.dataset.pcSavedDescription = description;
    editor.dataset.pcDescriptionReady = "true";
  }

  _getDescriptionContent($container = $(this.element)) {
    const editor = $container[0]?.querySelector?.('prose-mirror[name="combatDescription"]');
    if (!editor) throw new Error("Combat description editor did not render.");
    if (typeof editor.save === "function" && (typeof editor.isDirty !== "function" || editor.isDirty())) {
      editor.save();
    }
    return String(editor.value ?? "");
  }

  _saveDescription($container = $(this.element)) {
    return this._queueSave(() => this._persistDescription($container));
  }

  async _persistDescription($container) {
    if (!this._canEditFields()) return true;
    const editor = $container[0]?.querySelector?.('prose-mirror[name="combatDescription"]');
    if (!editor) return true;
    try {
      const description = this._getDescriptionContent($container);
      if (description === (this._getCombatData()?.description || "")) return true;
      const result = await this.adapter.update({ description }, { render: false });
      if (!result?.ok) throw new Error("The edited entry no longer exists.");
      if (editor) {
        editor.dataset.pcSavedDescription = description;
        editor.dataset.pcDescriptionReady = "true";
      }
      return true;
    } catch (err) {
      console.error("Failed to save combat description:", err);
      ui.notifications?.error?.("Failed to save combat description. See console for details.");
      return false;
    }
  }

  _saveMainFields($container = $(this.element), target = null) {
    return this._queueSave(() => this._persistMainFields($container, target));
  }

  async _persistMainFields($container, target = null) {
    if (!this._canEditFields()) return true;
    const root = $container[0];
    const previous = this._getCombatData();
    if (!previous) return;
    const previousRollData = this._getSelectedUsageData() ?? previous;
    const fieldGroup = getSkillEditorFieldGroup(target);
    const dirtyInputs = [...this._dirtyMainInputs].filter(input => !fieldGroup || getSkillEditorFieldGroup(input) === fieldGroup);
    for (const input of dirtyInputs) this._dirtyMainInputs.delete(input);
    const nameEl = root?.querySelector?.(".pc-entry-name-input, .pc-notable-combat-name-input");
    const classEl = root?.querySelector?.(".pc-entry-class-input, .pc-notable-combat-class-input");
    const rankEl = root?.querySelector?.(".pc-entry-rank-input, .pc-notable-combat-rank-input");
    const tohitEl = root?.querySelector?.(".pc-entry-tohit-input, .pc-notable-combat-tohit-input");
    const accuracyEl = root?.querySelector?.(".pc-entry-accuracy-input, .pc-notable-combat-accuracy-input");
    const specialGradeEl = root?.querySelector?.(".pc-entry-special-grade-input, .pc-notable-combat-special-grade-input");
    const checkedCharacteristics = Array.from(root?.querySelectorAll?.("[data-pc-entry-characteristic]:checked") ?? [], input => input.value);
    const value = selector => root?.querySelector?.(selector)?.value;
    const checked = selector => root?.querySelector?.(selector)?.checked;
    const typedValue = (selectSelector, customSelector, previousValue) => resolveSkillEditorTypedValue(
      value(selectSelector),
      value(customSelector),
      previousValue
    );

    if (rankEl) {
      rankEl.value = finalizeRankInputValue(rankEl.value);
    }

    const patch = buildSkillEditorPatch({
      name: nameEl?.value ?? previous.name,
      category: value(".pc-entry-category-select") ?? previous.category,
      weaponType: typedValue(".pc-entry-weapon-type-select", ".pc-entry-weapon-type-custom", previous.weaponType),
      defenseType: typedValue(".pc-entry-defense-type-select", ".pc-entry-defense-type-custom", previous.defenseType),
      trickType: typedValue(".pc-entry-trick-type-select", ".pc-entry-trick-type-custom", previous.trickType),
      signatureType: typedValue(".pc-entry-signature-type-select", ".pc-entry-signature-type-custom", previous.signatureType),
      gateType: typedValue(".pc-entry-gate-type-select", ".pc-entry-gate-type-custom", previous.gateType),
      type: typedValue(".pc-entry-type-select, .pc-notable-combat-type-select", ".pc-entry-type-custom", previous.type),
      specialGrade: specialGradeEl?.value ?? previous.specialGrade,
      class: classEl?.value ?? previous.class,
      rank: rankEl?.value ?? previous.rank,
      characteristics: root?.querySelector?.("[data-pc-entry-characteristic]") ? checkedCharacteristics : previousRollData.characteristics,
      characteristicMode: value(".pc-entry-characteristic-mode-select") ?? previousRollData.characteristicMode,
      tohit: tohitEl?.value ?? previousRollData.tohit,
      accuracy: accuracyEl?.value ?? previousRollData.accuracy,
      usesCurrent: value(".pc-entry-signature-current") ?? previous.usesCurrent,
      usesMax: value(".pc-entry-signature-max") ?? previous.usesMax,
      duressUses: root?.querySelector?.(".pc-entry-duress-uses") ? checked(".pc-entry-duress-uses") : previous.signatureUsage?.duressUses,
      duressCurrent: value(".pc-entry-duress-current") ?? previous.signatureUsage?.duressCurrent,
      duressMax: value(".pc-entry-duress-max") ?? previous.signatureUsage?.duressMax,
      ap: value(".pc-entry-ap-input") ?? previous.ap,
      sp: value(".pc-entry-sp-input") ?? previous.sp
    }, { collection: this.ref.collection, previous });

    const { usesCurrent, usesMax, signatureUsage, ...completeSourcePatch } = patch;
    const { duressCurrent, duressMax, ...signatureMetadata } = signatureUsage;
    completeSourcePatch.signatureUsage = signatureMetadata;
    const sourcePatch = fieldGroup
      ? buildSkillEditorFieldPatch(patch, fieldGroup)
      : completeSourcePatch;
    if (fieldGroup === "category" || fieldGroup === "type") {
      for (const [field, selector] of Object.entries({
        weaponType: ".pc-entry-weapon-type-select",
        defenseType: ".pc-entry-defense-type-select",
        trickType: ".pc-entry-trick-type-select",
        signatureType: ".pc-entry-signature-type-select",
        gateType: ".pc-entry-gate-type-select"
      })) {
        if (root?.querySelector?.(selector)) sourcePatch[field] = patch[field];
      }
    }
    const rollFields = new Set(["characteristics", "characteristicMode", "tohit", "accuracy"]);

    try {
      let result = { ok: true, changed: false, entry: previous };
      if (this._selectedUsageId !== "base" && fieldGroup && rollFields.has(fieldGroup)) {
        result = await this.adapter.update({ rollOverrides: { [fieldGroup]: patch[fieldGroup] } }, {
          usageId: this._selectedUsageId,
          render: false
        });
        if (!result?.ok) throw new Error("The edited usage no longer exists.");
      } else if (Object.keys(sourcePatch).length > 0) {
        const entryPatch = this._selectedUsageId !== "base" && !fieldGroup
          ? Object.fromEntries(Object.entries(sourcePatch).filter(([key]) => !rollFields.has(key)))
          : sourcePatch;
        result = await this.adapter.update(entryPatch, { render: false });
        if (!result?.ok) throw new Error("The edited entry no longer exists.");
        if (this._selectedUsageId !== "base" && !fieldGroup) {
          const usage = this._getSelectedUsage();
          const rollOverrides = Object.fromEntries(
            [...rollFields]
              .filter(key => Object.prototype.hasOwnProperty.call(usage?.rollOverrides ?? {}, key))
              .map(key => [key, patch[key]])
          );
          if (Object.keys(rollOverrides).length) {
            result = await this.adapter.update({ rollOverrides }, { usageId: this._selectedUsageId, render: false });
            if (!result?.ok) throw new Error("The edited usage no longer exists.");
          }
        }
      }
      if (!fieldGroup || fieldGroup === "primaryUses") {
        result = await this.sheet.actor.setPeasantEntryUses?.(this.ref, { current: usesCurrent, max: usesMax }) ?? result;
        if (!result?.ok) throw new Error("The edited entry no longer exists.");
      }
      if (fieldGroup === "duressUseCounts" || (!fieldGroup && (signatureMetadata.duressUses || duressMax > 0 || duressCurrent > 0))) {
        result = await this.sheet.actor.setPeasantEntryUses?.(this.ref, { pool: "duress", current: duressCurrent, max: duressMax }) ?? result;
        if (!result?.ok) throw new Error("The edited entry no longer exists.");
      }
      const savedCombat = this._getCombatData() ?? result.entry;
      const savedRollData = this._getSelectedUsageData() ?? savedCombat;
      const syncInput = (input, value) => {
        if (input && !this._dirtyMainInputs.has(input)) input.value = value;
      };
      if (!fieldGroup || fieldGroup === "name") syncInput(nameEl, savedCombat.name || "");
      if (!fieldGroup || fieldGroup === "class") syncInput(classEl, Number.parseInt(savedCombat.class, 10) || 1);
      if (!fieldGroup || fieldGroup === "rank") syncInput(rankEl, String(savedCombat.rank ?? "0"));
      if (!fieldGroup || fieldGroup === "tohit") syncInput(tohitEl, formatOptionalIntegerInput(savedRollData.tohit));
      if (!fieldGroup || fieldGroup === "accuracy") syncInput(accuracyEl, formatOptionalIntegerInput(savedRollData.accuracy, { showPlus: true }));
      if (!fieldGroup || fieldGroup === "specialGrade") syncInput(specialGradeEl, Number.parseInt(savedCombat.specialGrade, 10) || "");
      if (!fieldGroup || fieldGroup === "primaryUses") {
        const currentEl = root?.querySelector?.(".pc-entry-signature-current");
        const maxEl = root?.querySelector?.(".pc-entry-signature-max");
        syncInput(currentEl, savedCombat.usesCurrent ?? 0);
        syncInput(maxEl, savedCombat.usesMax ?? 0);
      }
      if (!fieldGroup || fieldGroup === "duressUseCounts") {
        const currentEl = root?.querySelector?.(".pc-entry-duress-current");
        const maxEl = root?.querySelector?.(".pc-entry-duress-max");
        syncInput(currentEl, savedCombat.signatureUsage?.duressCurrent ?? 0);
        syncInput(maxEl, savedCombat.signatureUsage?.duressMax ?? 0);
      }
      return true;
    } catch (err) {
      for (const input of dirtyInputs) this._dirtyMainInputs.add(input);
      console.warn("Failed to persist combat field change:", err);
      ui.notifications?.error?.("Could not save the field. Your edit has been kept.");
      return false;
    }
  }

  async _switchToSpecialType() {
    if (!this._canEditFields()) return;
    try {
      await this.adapter.update({ type: "Custom" }, { render: false });
      await this.render({ force: true });
    } catch (err) {
      console.warn("Failed to switch combat to special type:", err);
    }
  }

  async _setCombatType(type) {
    if (!this._canEditFields()) return;
    const nextType = String(type || "skill");
    try {
      await this.adapter.update({ type: nextType }, { render: false });
      await this.render({ force: true });
    } catch (err) {
      console.warn("Failed to change combat type:", err);
    }
  }

  async _openCombatImagePicker(event, $container = $(this.element)) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!this._canEditFields()) return;
    if (!FilePickerClass) return;

    const picker = new FilePickerClass({
      type: "image",
      current: this._getCombatData()?.img || getDefaultCombatImage(),
      callback: async path => this._setCombatImage(path, $container)
    });
    picker.render(true);
  }

  _openCombatImagePopout() {
    const src = this._getCombatData()?.img || getDefaultCombatImage();
    if (!src) return;
    try {
      if (ImagePopoutClass) {
        const popout = new ImagePopoutClass({
          src,
          uuid: this.sheet.actor?.uuid,
          window: { title: `${this._getCombatData()?.name || "Skill"} - Image` }
        });
        popout.render(true);
      } else {
        window.open(src, "_blank");
      }
    } catch (err) {
      window.open(src, "_blank");
    }
  }

  async _setCombatImage(path, $container = $(this.element)) {
    const nextPath = String(path ?? "").trim();
    if (!nextPath || !this._canEditFields()) return;

    await this.adapter.update({ img: nextPath }, { render: false });
    const image = $container[0]?.querySelector?.(".pc-notable-combat-image-frame .pc-item-image");
    if (image) image.src = nextPath;
  }

  _showDescriptionTab($container = $(this.element)) {
    void this._setActiveTab("description", $container).then(() => {
      const editor = $container[0]?.querySelector?.('prose-mirror[name="combatDescription"]');
      editor?.focus?.();
    });
  }

  async _setActiveTab(tab, $container = $(this.element)) {
    const normalized = String(tab ?? "").trim();
    if (!TAG_EDITOR_TABS.has(normalized)) return;
    if (!await this._flushPendingEdits($container)) return;
    const leavingProvisionalTag = this._activeTab === "details"
      && normalized !== "details"
      && !!$container[0]?.querySelector?.("[data-pc-tag-provisional]");
    if (leavingProvisionalTag) {
      this._tagEditor?.reset({ clearForm: true });
      this._hideTagDraft($container);
    }
    this._activeTab = normalized;
    this._applyActiveTab($container);
  }

  _applyActiveTab($container = $(this.element)) {
    const activeTab = TAG_EDITOR_TABS.has(this._activeTab) ? this._activeTab : "description";
    const root = $container[0];
    if (!root) return;

    for (const tabButton of root.querySelectorAll("[data-pc-notable-combat-tab]")) {
      const active = tabButton.dataset.pcNotableCombatTab === activeTab;
      tabButton.classList.toggle("active", active);
      tabButton.setAttribute("aria-selected", active ? "true" : "false");
      tabButton.tabIndex = active ? 0 : -1;
    }

    for (const panel of root.querySelectorAll("[data-pc-notable-combat-panel]")) {
      const active = panel.dataset.pcNotableCombatPanel === activeTab;
      panel.classList.toggle("active", active);
      panel.toggleAttribute("hidden", !active);
      panel.setAttribute("aria-hidden", active ? "false" : "true");
    }

    const footer = root.querySelector(".pc-skill-editor-footer");
    if (footer) {
      const hasVisibleControl = Array.from(footer.querySelectorAll("button")).some(control => !control.hidden);
      footer.toggleAttribute("hidden", !hasVisibleControl);
    }
  }

  _onClose(options) {
    clearTimeout(this._descriptionSaveTimer);
    if (this._actorUpdateHookId != null) Hooks.off("updateActor", this._actorUpdateHookId);
    this._actorUpdateHookId = null;
    if (typeof super._onClose === "function") super._onClose(options);
    if (options?.ownedSheetClosing || options?.ownedReplacement) return;
    this.sheet?.render?.(false);
  }
}
