import { collectNotableCombatTagData } from "./notable-combat-tag-data.mjs";
import { getCombatCustomTags } from "../../../data/actor/combat-tags.mjs";

export function setupNotableCombatTagSaveControls(sheet, $container, combatIndex, {
  tagEditor,
  getCombatData,
  onChanged,
  saveTag,
  canSave = () => true
} = {}) {
  const tagEditorState = tagEditor.state;
  let dirty = false;
  let pending = Promise.resolve(true);
  const markDirty = () => { if (canSave()) dirty = true; };
  const persist = async ({ notify = false } = {}) => {
    if (!canSave() || !dirty) return true;
    const tagType = tagEditorState.tagType;
    if (!tagType || tagType === "description") {
      dirty = false;
      return true;
    }
    const combatData = getCombatData();
    const removedCosts = tagType === "resourceCosts" && combatData.resourceCosts?.length > 0
      && $container[0]?.querySelectorAll(".resource-cost-row").length === 0;
    const { tagAdded, tagData, warning } = removedCosts ? { tagAdded: true, tagData: {} }
      : collectNotableCombatTagData($container, tagType, { combatData });

    if (!tagAdded) {
      if (notify) ui.notifications?.warn?.(warning);
      return false;
    }

    const actorTagMode = removedCosts ? "remove" : (tagType === "custom" ? tagEditorState.mode : "add");
    // New input during the document write remains dirty for the next save.
    dirty = false;
    const result = typeof saveTag === "function"
      ? await saveTag(tagType, tagData, {
        mode: actorTagMode,
        customId: tagEditorState.customId,
        customIndex: tagEditorState.customIndex
      })
      : await sheet.actor.setPeasantNotableCombatTag(combatIndex, tagType, tagData, {
        mode: actorTagMode,
        customIndex: tagEditorState.customIndex
      });
    if (!result?.ok) {
      dirty = true;
      ui.notifications?.error?.(result?.error || "Could not save the tag.");
      return false;
    }
    if (tagType === "custom" && actorTagMode === "add") {
      const tags = getCombatCustomTags(getCombatData());
      tagEditor.beginEdit(tagType, tags.length - 1, tags.at(-1)?.id);
    }
    if (actorTagMode === "remove") tagEditor.reset({ clearForm: true });
    if (result.changed) onChanged?.();
    return true;
  };
  const saveCurrent = (options = {}) => {
    const save = pending.then(async () => {
      do {
        if (!await persist(options)) return false;
      } while (dirty && canSave());
      return true;
    }).catch(error => {
      dirty = true;
      console.error("Failed to autosave the tag:", error);
      ui.notifications?.error?.("Could not save the tag. Your draft has been kept.");
      return false;
    });
    pending = save;
    return save;
  };
  $container.on("input", ".tag-input-area", markDirty);
  $container.on("change", ".tag-input-area", () => {
    markDirty();
    void saveCurrent();
  });
  return { saveCurrent, markDirty, isDirty: () => dirty, beginDraft({ isNew = false } = {}) { dirty = canSave() && isNew; } };
}
