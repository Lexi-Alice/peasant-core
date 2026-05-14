import { getActorBolsteredMax, getActorHealthMax, isSimplifiedHpActor } from "../../../data/actor/helpers.mjs";
import { openHpGridDialog } from "./health-stress/hp-grid-dialog.mjs";
import { applyStressDamage, applyStressHeal, normalizeStressType, openStressGridDialog, setStressGridSize } from "./health-stress/stress-grid-dialog.mjs";

export { openHpGridDialog } from "./health-stress/hp-grid-dialog.mjs";
export { applyStressDamage, applyStressHeal, normalizeStressType, openStressGridDialog, setStressGridSize } from "./health-stress/stress-grid-dialog.mjs";

export function setupHealthStressControls(sheet, html) {
  html.find("input[name='system.bolsteredHp']").on("change", async (ev) => {
    const input = $(ev.currentTarget);
    let newValue = parseInt(input.val()) || 0;
    const maxBolstered = getActorBolsteredMax(sheet.actor);
    newValue = Math.max(0, Math.min(newValue, maxBolstered));
    input.val(newValue);
    await sheet.actor.setPeasantBolsteredHp?.(newValue);
  });

  html.find("input[name='system.temporaryHp.value']").on("change", async (ev) => {
    const input = $(ev.currentTarget);
    let newValue = parseInt(input.val()) || 0;
    const maxTempHp = sheet.actor.system.temporaryHp?.max || 0;
    newValue = Math.max(0, Math.min(newValue, maxTempHp));
    input.val(newValue);
    await sheet.actor.setPeasantTemporaryHpValue?.(newValue);
  });

  html.find(".pc-portrait-thp-input").on("change", async (ev) => {
    const input = $(ev.currentTarget);
    const newValue = Math.max(0, Number.parseInt(input.val(), 10) || 0);
    input.val(newValue);
    await sheet.actor.setPeasantTemporaryHpValue?.(newValue, { expandMax: true });
  });

  html.find(".pc-portrait-bhp-input").on("change", async (ev) => {
    const input = $(ev.currentTarget);
    const maxBolstered = getActorBolsteredMax(sheet.actor);
    const newValue = Math.max(0, Math.min(Number.parseInt(input.val(), 10) || 0, maxBolstered));
    input.val(newValue);
    await sheet.actor.setPeasantBolsteredHp?.(newValue);
  });

  html.find(".pc-hp-grid-open").off("click.peasantHpGrid").on("click.peasantHpGrid", (ev) => {
    ev.preventDefault();
    openHpGridDialog(sheet, ev.currentTarget);
  });

  html.find(".pc-stress-grid-open").off("click.peasantStressGrid").on("click.peasantStressGrid", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openStressGridDialog(sheet, ev.currentTarget?.dataset?.stressType, ev.currentTarget);
  });

  html.find(".pc-portrait-stress-count-input").off("change.peasantPortraitStressCount").on("change.peasantPortraitStressCount", async (ev) => {
    const input = $(ev.currentTarget);
    const stressType = normalizeStressType(input.data("stressType"));
    const newCount = Math.max(0, parseInt(input.val(), 10) || 0);
    input.val(newCount);
    await setStressGridSize(sheet, stressType, newCount);
    sheet.render(false);
  });

  html.find("input[name='system.health.max']").on("change", async (ev) => {
    if (!isSimplifiedHpActor(sheet.actor)) return;
    const input = $(ev.currentTarget);
    let newMax = parseInt(input.val()) || 1;
    newMax = Math.max(1, newMax);
    input.val(newMax);
    await sheet.actor.setPeasantSimplifiedHealthMax?.(newMax);
  });

  html.find("input[name='system.health.value']").on("change", async (ev) => {
    if (!isSimplifiedHpActor(sheet.actor)) return;
    const input = $(ev.currentTarget);
    const maxHealth = getActorHealthMax(sheet.actor);
    let newValue = parseInt(input.val()) || 0;
    newValue = Math.max(0, Math.min(newValue, maxHealth));
    input.val(newValue);
    await sheet.actor.setPeasantSimplifiedHealthValue?.(newValue);
  });

  html.find(".hp-col-plus").click(async () => {
    await sheet.actor.resizePeasantHpGrid?.(0, 1);
  });

  html.find(".hp-col-minus").click(async () => {
    await sheet.actor.resizePeasantHpGrid?.(0, -1);
  });

  html.find(".hp-row-plus").click(async () => {
    await sheet.actor.resizePeasantHpGrid?.(1, 0);
  });

  html.find(".hp-row-minus").click(async () => {
    await sheet.actor.resizePeasantHpGrid?.(-1, 0);
  });

  html.find(".hp-cell:not(.stress-cell)").click(async (ev) => {
    const cell = $(ev.currentTarget);
    const row = parseInt(cell.data("row"));
    const col = parseInt(cell.data("col"));
    if (Number.isNaN(row) || Number.isNaN(col)) return;
    await sheet.actor.cyclePeasantHpGridCell?.(row, col);
    sheet.render(false);
  });

  html.find(".hp-cell:not(.stress-cell)").on("contextmenu", async (ev) => {
    ev.preventDefault();
    const cell = $(ev.currentTarget);
    const row = parseInt(cell.data("row"));
    const col = parseInt(cell.data("col"));
    if (Number.isNaN(row) || Number.isNaN(col)) return;
    await sheet.actor.setPeasantHpGridCell?.(row, col, 0);
    sheet.render(false);
  });

  html.find(".stress-add").click(async (ev) => {
    const stressType = $(ev.currentTarget).data("stress-type");
    await sheet.actor.resizePeasantStressGrid?.(stressType, 1);
  });

  html.find(".stress-remove").click(async (ev) => {
    const stressType = $(ev.currentTarget).data("stress-type");
    await sheet.actor.resizePeasantStressGrid?.(stressType, -1);
  });

  html.find(".stress-cell").click(async (ev) => {
    ev.preventDefault();
    const cell = ev.currentTarget;
    const stressType = cell.dataset.stressType;
    const index = parseInt(cell.dataset.index);
    if (!stressType || Number.isNaN(index)) return;
    await sheet.actor.cyclePeasantStressCell?.(stressType, index);
  });

  html.find(".stress-cell").on("contextmenu", async (ev) => {
    ev.preventDefault();
    const cell = ev.currentTarget;
    const stressType = cell.dataset.stressType;
    const index = parseInt(cell.dataset.index);
    if (!stressType || Number.isNaN(index)) return;
    await sheet.actor.setPeasantStressCell?.(stressType, index, 0);
  });

  html.find(".pc-stress-bar-section").on("click", async (ev) => {
    ev.preventDefault();
    const stressType = ev.currentTarget?.dataset?.stressType;
    if (!stressType) return;
    await applyStressDamage(sheet, stressType, 1);
    sheet.render(false);
  });

  html.find(".pc-stress-bar-section").on("contextmenu", async (ev) => {
    ev.preventDefault();
    const stressType = ev.currentTarget?.dataset?.stressType;
    if (!stressType) return;
    await applyStressHeal(sheet, stressType, 1);
    sheet.render(false);
  });

  html.find(".stress-damage-toggle").click((ev) => {
    const stressType = $(ev.currentTarget).data("stress-type");
    sheet.valueStressType = stressType;
    const label = `${String(stressType || "stress").charAt(0).toUpperCase()}${String(stressType || "stress").slice(1)} Stress`;
    html.find(".stress-damage-title").text(`Take ${label}`);
    const controls = html.find(".stress-damage-controls");
    const opening = controls.hasClass("hidden");
    controls.toggleClass("hidden");
    if (opening) sheet._positionSheetPopupNearTrigger(html, ".stress-damage-controls", ev.currentTarget);
  });

  html.find(".close-stress-damage").click(() => {
    html.find(".stress-damage-controls").addClass("hidden");
  });

  html.find(".stress-heal-toggle").click((ev) => {
    const stressType = $(ev.currentTarget).data("stress-type");
    sheet.valueStressType = stressType;
    const label = `${String(stressType || "stress").charAt(0).toUpperCase()}${String(stressType || "stress").slice(1)} Stress`;
    html.find(".stress-heal-title").text(`Heal ${label}`);
    const controls = html.find(".stress-heal-controls");
    const opening = controls.hasClass("hidden");
    controls.toggleClass("hidden");
    if (opening) sheet._positionSheetPopupNearTrigger(html, ".stress-heal-controls", ev.currentTarget);
  });

  html.find(".close-stress-heal").click(() => {
    html.find(".stress-heal-controls").addClass("hidden");
  });

  html.find(".stress-refresh").click(async (ev) => {
    const stressType = $(ev.currentTarget).data("stress-type");
    await sheet.actor.refreshPeasantStressTrack?.(stressType);
  });

  html.find(".apply-stress-damage").click(async () => {
    const amount = Number(html.find("[name=stressAmount]").val()) || 0;
    const stressType = sheet.valueStressType;
    if (!stressType || amount <= 0) return;
    await applyStressDamage(sheet, stressType, amount);
    sheet.render(false);
  });

  html.find(".apply-stress-heal").click(async () => {
    const amount = Number(html.find("[name=stressHealAmount]").val()) || 0;
    const stressType = sheet.valueStressType;
    if (!stressType || amount <= 0) return;
    await applyStressHeal(sheet, stressType, amount);
    sheet.render(false);
  });
}
