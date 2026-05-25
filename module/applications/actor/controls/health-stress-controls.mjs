import { getActorBolsteredMax, getActorHealthMax, isSimplifiedHpActor } from "../../../data/actor/helpers.mjs";
import { qs, qsa } from "../../dom.mjs";
import { openHpGridDialog } from "./health-stress/hp-grid-dialog.mjs";
import { applyStressDamage, applyStressHeal, normalizeStressType, openStressGridDialog, setStressGridSize } from "./health-stress/stress-grid-dialog.mjs";
import { renderSheetResourceDialog } from "./resource-dialogs.mjs";

export { openHpGridDialog } from "./health-stress/hp-grid-dialog.mjs";
export { applyStressDamage, applyStressHeal, normalizeStressType, openStressGridDialog, setStressGridSize } from "./health-stress/stress-grid-dialog.mjs";

function parseInputInteger(input, fallback = 0) {
  const value = Number.parseInt(input?.value, 10);
  return Number.isFinite(value) ? value : fallback;
}

function parseDataInteger(element, key) {
  const value = Number.parseInt(element?.dataset?.[key], 10);
  return Number.isFinite(value) ? value : NaN;
}

export function setupHealthStressControls(sheet, html) {
  for (const input of qsa(html, "input[name='system.bolsteredHp']")) {
    input.addEventListener("change", async () => {
      let newValue = parseInputInteger(input, 0);
      const maxBolstered = getActorBolsteredMax(sheet.actor);
      newValue = Math.max(0, Math.min(newValue, maxBolstered));
      input.value = String(newValue);
      await sheet.actor.setPeasantBolsteredHp?.(newValue);
    });
  }

  for (const input of qsa(html, "input[name='system.temporaryHp.value']")) {
    input.addEventListener("change", async () => {
      let newValue = parseInputInteger(input, 0);
      const maxTempHp = sheet.actor.system.temporaryHp?.max || 0;
      newValue = Math.max(0, Math.min(newValue, maxTempHp));
      input.value = String(newValue);
      await sheet.actor.setPeasantTemporaryHpValue?.(newValue);
    });
  }

  for (const input of qsa(html, ".pc-portrait-thp-input")) {
    input.addEventListener("change", async () => {
      const newValue = Math.max(0, parseInputInteger(input, 0));
      input.value = String(newValue);
      await sheet.actor.setPeasantTemporaryHpValue?.(newValue, { expandMax: true });
    });
  }

  for (const input of qsa(html, ".pc-portrait-bhp-input")) {
    input.addEventListener("change", async () => {
      const maxBolstered = getActorBolsteredMax(sheet.actor);
      const newValue = Math.max(0, Math.min(parseInputInteger(input, 0), maxBolstered));
      input.value = String(newValue);
      await sheet.actor.setPeasantBolsteredHp?.(newValue);
    });
  }

  for (const button of qsa(html, ".pc-hp-grid-open")) {
    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      openHpGridDialog(sheet, ev.currentTarget);
    });
  }

  for (const button of qsa(html, ".pc-stress-grid-open")) {
    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openStressGridDialog(sheet, ev.currentTarget?.dataset?.stressType, ev.currentTarget);
    });
  }

  for (const input of qsa(html, ".pc-portrait-stress-count-input")) {
    input.addEventListener("change", async () => {
      const stressType = normalizeStressType(input.dataset.stressType);
      const newCount = Math.max(0, parseInputInteger(input, 0));
      input.value = String(newCount);
      await setStressGridSize(sheet, stressType, newCount);
      sheet.render(false);
    });
  }

  for (const input of qsa(html, "input[name='system.health.max']")) {
    input.addEventListener("change", async () => {
      if (!isSimplifiedHpActor(sheet.actor)) return;
      let newMax = parseInputInteger(input, 1);
      newMax = Math.max(1, newMax);
      input.value = String(newMax);
      await sheet.actor.setPeasantSimplifiedHealthMax?.(newMax);
    });
  }

  for (const input of qsa(html, "input[name='system.health.value']")) {
    input.addEventListener("change", async () => {
      if (!isSimplifiedHpActor(sheet.actor)) return;
      const maxHealth = getActorHealthMax(sheet.actor);
      let newValue = parseInputInteger(input, 0);
      newValue = Math.max(0, Math.min(newValue, maxHealth));
      input.value = String(newValue);
      await sheet.actor.setPeasantSimplifiedHealthValue?.(newValue);
    });
  }

  for (const button of qsa(html, ".hp-col-plus")) {
    button.addEventListener("click", async () => {
      await sheet.actor.resizePeasantHpGrid?.(0, 1);
    });
  }

  for (const button of qsa(html, ".hp-col-minus")) {
    button.addEventListener("click", async () => {
      await sheet.actor.resizePeasantHpGrid?.(0, -1);
    });
  }

  for (const button of qsa(html, ".hp-row-plus")) {
    button.addEventListener("click", async () => {
      await sheet.actor.resizePeasantHpGrid?.(1, 0);
    });
  }

  for (const button of qsa(html, ".hp-row-minus")) {
    button.addEventListener("click", async () => {
      await sheet.actor.resizePeasantHpGrid?.(-1, 0);
    });
  }

  for (const cell of qsa(html, ".hp-cell:not(.stress-cell)")) {
    cell.addEventListener("click", async () => {
      const row = parseDataInteger(cell, "row");
      const col = parseDataInteger(cell, "col");
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      await sheet.actor.cyclePeasantHpGridCell?.(row, col);
      sheet.render(false);
    });
  }

  for (const cell of qsa(html, ".hp-cell:not(.stress-cell)")) {
    cell.addEventListener("contextmenu", async (ev) => {
      ev.preventDefault();
      const row = parseDataInteger(cell, "row");
      const col = parseDataInteger(cell, "col");
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      await sheet.actor.setPeasantHpGridCell?.(row, col, 0);
      sheet.render(false);
    });
  }

  for (const button of qsa(html, ".stress-add")) {
    button.addEventListener("click", async () => {
      await sheet.actor.resizePeasantStressGrid?.(button.dataset.stressType, 1);
    });
  }

  for (const button of qsa(html, ".stress-remove")) {
    button.addEventListener("click", async () => {
      await sheet.actor.resizePeasantStressGrid?.(button.dataset.stressType, -1);
    });
  }

  for (const cell of qsa(html, ".stress-cell")) {
    cell.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const stressType = cell.dataset.stressType;
      const index = parseDataInteger(cell, "index");
      if (!stressType || Number.isNaN(index)) return;
      await sheet.actor.cyclePeasantStressCell?.(stressType, index);
    });
  }

  for (const cell of qsa(html, ".stress-cell")) {
    cell.addEventListener("contextmenu", async (ev) => {
      ev.preventDefault();
      const stressType = cell.dataset.stressType;
      const index = parseDataInteger(cell, "index");
      if (!stressType || Number.isNaN(index)) return;
      await sheet.actor.setPeasantStressCell?.(stressType, index, 0);
    });
  }

  for (const section of qsa(html, ".pc-stress-bar-section")) {
    section.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const stressType = section.dataset.stressType;
      if (!stressType) return;
      await applyStressDamage(sheet, stressType, 1);
      sheet.render(false);
    });
  }

  for (const section of qsa(html, ".pc-stress-bar-section")) {
    section.addEventListener("contextmenu", async (ev) => {
      ev.preventDefault();
      const stressType = section.dataset.stressType;
      if (!stressType) return;
      await applyStressHeal(sheet, stressType, 1);
      sheet.render(false);
    });
  }

  for (const button of qsa(html, ".stress-damage-toggle")) {
    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const stressType = normalizeStressType(button.dataset.stressType);
      if (!stressType) return;
      openStressAmountDialog(sheet, stressType, "damage", button);
    });
  }

  for (const button of qsa(html, ".stress-heal-toggle")) {
    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const stressType = normalizeStressType(button.dataset.stressType);
      if (!stressType) return;
      openStressAmountDialog(sheet, stressType, "heal", button);
    });
  }

  for (const button of qsa(html, ".stress-refresh")) {
    button.addEventListener("click", async () => {
      await sheet.actor.refreshPeasantStressTrack?.(button.dataset.stressType);
    });
  }

}

function openStressAmountDialog(sheet, stressType, mode, trigger) {
  const label = `${String(stressType || "stress").charAt(0).toUpperCase()}${String(stressType || "stress").slice(1)} Stress`;
  const isHeal = mode === "heal";
  const title = `${isHeal ? "Heal" : "Take"} ${label}`;
  const actionLabel = isHeal ? "Apply Stress Healing" : "Apply Stress";
  const icon = isHeal ? "fa-solid fa-heart" : "fa-solid fa-swords";
  const key = `stress-${mode}-${stressType}`;

  return renderSheetResourceDialog(sheet, key, {
    title,
    content: `
      <div class="pc-resource-form pc-stress-form">
        <label class="pc-resource-single-field">
          <span>Amount</span>
          <input type="number" name="stressAmount" class="pc-input" value="1" min="1" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*">
        </label>
      </div>
    `,
    buttons: {
      apply: {
        icon,
        label: actionLabel,
        default: true,
        callback: async (html) => {
          const amount = Number(qs(html, "[name=stressAmount]")?.value) || 0;
          if (amount <= 0) return false;

          if (isHeal) await applyStressHeal(sheet, stressType, amount);
          else await applyStressDamage(sheet, stressType, amount);

          sheet.render(false);
          return true;
        }
      }
    },
    default: "apply"
  }, trigger, {
    width: 300,
    height: 160,
    classes: ["pc-stress-dialog"]
  });
}
