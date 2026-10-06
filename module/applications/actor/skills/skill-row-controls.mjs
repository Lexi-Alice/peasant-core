import { getActorSourceSystem } from "../controls/sheet-listener-helpers.mjs";
import { qsa, toElement } from "../../dom.mjs";
import { openSkillEditor } from "./skill-editor.mjs";
import { setupNotableCombatControls } from "../notable-combat/notable-combat-controls.mjs";

export function setupSkillRowControls(sheet, html, { blurActiveEditableInSheet, enqueue, runQueued } = {}) {
  const root = toElement(html);
  if (!root) return;
  setupRankInputControls(root);
  setupNotableCombatControls(sheet, root, {
    collection: "skills", blurActiveEditableInSheet, enqueueSheetUpdate: enqueue, runQueuedInputUpdate: runQueued,
    openCombatEditor: async (_sheet, index) => {
      await sheet.actor.ensurePeasantEntryIds?.("skills");
      const entryId = getActorSourceSystem(sheet.actor).skills?.[index]?.id;
      if (entryId) await openSkillEditor(sheet, { collection: "skills", entryId });
    }
  });
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
