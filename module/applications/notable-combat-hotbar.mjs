import { applyToHitAccuracy } from "../dice/roll-targets.mjs";
import { formatOptionalIntegerInput, parseOptionalInteger } from "../data/actor/helpers.mjs";
import { getEffectiveSkillCombatModifiers } from "../data/actor/combat-modifiers.mjs";
import { isRollableSkillType } from "../data/actor/skill-entry-types.mjs";
import { withPeasantActorSourceWriteContext } from "../data/actor/source-system.mjs";
import { registerPeasantCoreApi } from "../utils/api.mjs";
import { pcLog } from "../utils/logging.mjs";
import { toElement } from "./dom.mjs";
import { startPeasantEntryUse } from "./combat/skill-entry-use.mjs";

const HOTBAR_FLAG = "notableCombatHotbar";
const USAGE_HOTBAR_FLAG = "skillUsageHotbar";
const EMPTY_COMBAT_STATS = { toHit: "", accuracy: "" };

function getDefaultCombatImage() {
  return foundry?.utils?.getProperty?.(CONFIG, "Item.documentClass.DEFAULT_ICON")
    || foundry?.utils?.getProperty?.(CONFIG, "Item.defaultIcon")
    || "icons/svg/sword.svg";
}

function getCombatImage(combat) {
  return String(combat?.img || "").trim() || getDefaultCombatImage();
}

function getActorNotableCombats(actor) {
  return Array.isArray(actor?.system?.notableCombats) ? actor.system.notableCombats : [];
}

function resolveNotableCombatIndex(actor, { combatId = "", combatIndex = null } = {}) {
  const combats = getActorNotableCombats(actor);
  const id = String(combatId ?? "").trim();
  if (id) return combats.findIndex((combat) => String(combat?.id ?? "").trim() === id);

  const index = Number.parseInt(combatIndex, 10);
  return Number.isInteger(index) && index >= 0 && index < combats.length ? index : -1;
}

function createNotableCombatId(actor) {
  return actor?.constructor?.createPeasantNotableCombatId?.()
    || foundry?.utils?.randomID?.(16)
    || `combat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureNotableCombatId(actor, combatIndex) {
  const combats = getActorNotableCombats(actor);
  const combat = combats[combatIndex] || null;
  const current = String(combat?.id ?? "").trim();
  if (current) return current;
  if (!combat || !actor?.isOwner) return "";

  const nextCombats = foundry.utils.deepClone(combats);
  const id = createNotableCombatId(actor);
  nextCombats[combatIndex] = { ...nextCombats[combatIndex], id };

  if (typeof actor.setPeasantNotableCombats === "function") {
    await actor.setPeasantNotableCombats(nextCombats, { render: false });
  } else {
    await actor.update({ "system.notableCombats": nextCombats }, withPeasantActorSourceWriteContext({ render: false }));
  }
  return id;
}

function formatCombatStats(actor, combat) {
  if (!isRollableSkillType(combat?.type)) return EMPTY_COMBAT_STATS;

  const combatMods = getEffectiveSkillCombatModifiers(actor);
  const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
  const accuracyMod = Number.parseInt(combatMods.accuracy, 10) || 0;
  const tohitValue = parseOptionalInteger(combat?.tohit, { min: 1 });
  const accuracyValue = parseOptionalInteger(combat?.accuracy, { allowSign: true });
  const baseTohit = tohitValue ?? 7;
  const baseAccuracy = accuracyValue ?? 0;
  const combatCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
  return {
    toHit: `${combatCalc.toHit}+`,
    accuracy: combatCalc.accuracy === 0
      ? ""
      : `${formatOptionalIntegerInput(combatCalc.accuracy, { showPlus: true })} Acc`
  };
}

async function resolveActor(actorUuid) {
  const uuid = String(actorUuid ?? "").trim();
  if (!uuid) return null;
  try {
    return await fromUuid(uuid);
  } catch (err) {
    pcLog.debug("Peasant Core | Failed to resolve hotbar actor", err);
    return null;
  }
}

export async function rollNotableCombatHotbarMacro({ actorUuid = "", combatId = "", combatIndex = null, usageId = null } = {}) {
  const actor = await resolveActor(actorUuid);
  if (!actor) {
    ui.notifications?.warn?.("Notable combat actor could not be found.");
    return false;
  }
  if (!actor.isOwner) {
    ui.notifications?.warn?.(`You do not have permission to roll notable combats for ${actor.name}.`);
    return false;
  }

  await actor.ensurePeasantEntryIds?.("notableCombats");
  const resolvedIndex = resolveNotableCombatIndex(actor, { combatId, combatIndex });
  if (resolvedIndex < 0) {
    ui.notifications?.warn?.("That notable combat could not be found on the actor.");
    return false;
  }

  const entryId = String(getActorNotableCombats(actor)[resolvedIndex]?.id || "").trim();
  if (!entryId) return false;
  return startPeasantEntryUse({
    actor,
    ref: { collection: "notableCombats", entryId },
    usageId,
    promptForTargets: true
  });
}

async function createNotableCombatMacroData(data) {
  const actor = await resolveActor(data.actorUuid);
  if (!actor) {
    ui.notifications?.warn?.("Notable combat actor could not be found.");
    return null;
  }
  if (!actor.isOwner) {
    ui.notifications?.warn?.(`You do not have permission to create notable combat macros for ${actor.name}.`);
    return null;
  }

  const combatIndex = Number.parseInt(data.combatIndex, 10);
  if (!Number.isInteger(combatIndex) || combatIndex < 0) {
    ui.notifications?.warn?.("That notable combat could not be found on the actor.");
    return null;
  }

  const combats = getActorNotableCombats(actor);
  const combat = combats[combatIndex] || null;
  if (!combat) {
    ui.notifications?.warn?.("That notable combat could not be found on the actor.");
    return null;
  }

  const combatId = String(data.combatId || await ensureNotableCombatId(actor, combatIndex)).trim();
  const flagData = {
    actorUuid: actor.uuid,
    combatId,
    combatIndex,
    usageId: combat.defaultUsageId || "base"
  };
  const command = `await game.peasantCore.rollNotableCombatHotbarMacro(${JSON.stringify(flagData)});`;
  return {
    type: "script",
    scope: "actor",
    name: combat.name || "Notable Combat",
    img: getCombatImage(combat),
    command,
    flags: {
      "peasant-core": {
        [HOTBAR_FLAG]: flagData
      }
    }
  };
}

async function createOrUpdateNotableCombatMacro(data, slot) {
  const macroData = await createNotableCombatMacroData(data);
  if (!macroData) return false;

  const flagData = macroData.flags["peasant-core"][HOTBAR_FLAG];
  let macro = game.macros?.find?.((candidate) => {
    if (candidate?.type !== "script" || !candidate?.isAuthor) return false;
    const flags = candidate.getFlag?.("peasant-core", HOTBAR_FLAG);
    return candidate.command === macroData.command
      || (flags?.actorUuid === flagData.actorUuid && flags?.combatId === flagData.combatId);
  });

  if (macro) {
    await macro.update({
      name: macroData.name,
      img: macroData.img,
      command: macroData.command,
      [`flags.peasant-core.${HOTBAR_FLAG}`]: flagData
    });
  } else {
    macro = await Macro.create(macroData);
  }

  await game.user.assignHotbarMacro(macro, slot);
  return true;
}

export async function addNotableCombatToHotbar(data) {
  const page = Number.isInteger(ui?.hotbar?.page) ? ui.hotbar.page : 1;
  const slot = game.user?.getHotbarMacros?.(page)?.find(({ macro }) => !macro)?.slot ?? null;

  if (!slot) {
    ui.notifications?.warn?.("The current hotbar page has no empty slots.");
    return false;
  }

  try {
    return await createOrUpdateNotableCombatMacro(data, slot);
  } catch (err) {
    console.error("Peasant Core | Failed to create notable combat hotbar macro", err);
    ui.notifications?.warn?.("Failed to create notable combat hotbar macro. See console for details.");
    return false;
  }
}

export async function addSkillUsageToHotbar({ actorUuid, collection, entryId, usageId } = {}) {
  const page = Number.isInteger(ui?.hotbar?.page) ? ui.hotbar.page : 1;
  const slot = game.user?.getHotbarMacros?.(page)?.find(({ macro }) => !macro)?.slot ?? null;
  if (!slot) {
    ui.notifications?.warn?.("The current hotbar page has no empty slots.");
    return false;
  }

  const actor = await resolveActor(actorUuid);
  if (!actor) {
    ui.notifications?.warn?.("Skill or Notable actor could not be found.");
    return false;
  }
  if (!actor.isOwner) {
    ui.notifications?.warn?.(`You do not have permission to create Skill or Notable macros for ${actor.name}.`);
    return false;
  }
  const key = String(collection ?? "");
  const id = String(entryId ?? "");
  const selectedId = String(usageId ?? "");
  const entry = ["skills", "notableCombats"].includes(key)
    ? actor.system?.[key]?.find(candidate => String(candidate?.id ?? "") === id)
    : null;
  const usage = selectedId === "base"
    ? entry?.baseUsage
    : entry?.usages?.find(candidate => String(candidate?.id ?? "") === selectedId);
  if (!entry || !id || !usage || !selectedId) {
    ui.notifications?.warn?.("That Skill, Notable, or usage is unavailable.");
    return false;
  }

  const flagData = { actorUuid: actor.uuid, collection: key, entryId: id, usageId: selectedId };
  const macroData = {
    type: "script",
    scope: "actor",
    name: selectedId === "base" ? entry.name : `${entry.name}: ${usage.name || "Usage"}`,
    img: getCombatImage(entry),
    command: `await game.peasantCore.useSkillEntry(${JSON.stringify(flagData)});`,
    flags: { "peasant-core": { [USAGE_HOTBAR_FLAG]: flagData } }
  };
  try {
    let macro = game.macros?.find?.(candidate => {
      if (candidate?.type !== "script" || !candidate?.isAuthor) return false;
      const flags = candidate.getFlag?.("peasant-core", USAGE_HOTBAR_FLAG);
      return candidate.command === macroData.command
        || (flags?.actorUuid === flagData.actorUuid && flags?.collection === key
          && flags?.entryId === id && flags?.usageId === selectedId);
    });
    if (macro) {
      await macro.update({
        name: macroData.name,
        img: macroData.img,
        command: macroData.command,
        [`flags.peasant-core.${USAGE_HOTBAR_FLAG}`]: flagData
      });
    } else {
      macro = await Macro.create(macroData);
    }
    await game.user.assignHotbarMacro(macro, slot);
    return true;
  } catch (error) {
    console.error("Peasant Core | Failed to create usage hotbar macro", error);
    ui.notifications?.warn?.("Failed to create usage hotbar macro. See console for details.");
    return false;
  }
}

function getNotableCombatFlagData(macro) {
  const data = macro?.getFlag?.("peasant-core", HOTBAR_FLAG);
  return data && typeof data === "object" ? data : null;
}

async function getHotbarDisplayData(macro, flagData) {
  const actor = await resolveActor(flagData?.actorUuid);
  const combatIndex = actor ? resolveNotableCombatIndex(actor, flagData) : -1;
  const combat = combatIndex >= 0 ? getActorNotableCombats(actor)[combatIndex] : null;
  if (!actor || !combat) {
    return {
      name: macro?.name || "Notable Combat",
      img: macro?.img || getDefaultCombatImage(),
      stats: EMPTY_COMBAT_STATS,
      missing: true
    };
  }

  return {
    name: combat.name || macro?.name || "Notable Combat",
    img: getCombatImage(combat),
    stats: formatCombatStats(actor, combat),
    missing: false
  };
}

function upsertHotbarOverlay(slot, displayData) {
  if (!slot?.isConnected) return;
  slot.classList.add("pc-notable-combat-hotbar");
  slot.classList.toggle("pc-notable-combat-hotbar-missing", !!displayData.missing);
  slot.classList.toggle("pc-notable-combat-hotbar-no-accuracy", !displayData.stats.accuracy);
  slot.classList.toggle("pc-notable-combat-hotbar-no-stats", !displayData.stats.toHit && !displayData.stats.accuracy);
  slot.dataset.tooltipText = displayData.name;
  slot.setAttribute("aria-label", displayData.name);

  let img = slot.querySelector("img.slot-icon");
  if (!img) {
    img = document.createElement("img");
    img.className = "slot-icon";
    slot.prepend(img);
  }
  img.src = displayData.img;
  img.alt = displayData.name;

  slot.querySelector(".pc-notable-hotbar-skill-icon")?.remove();
  slot.querySelector(".pc-notable-hotbar-stats")?.remove();

  let label = slot.querySelector(".pc-notable-hotbar-label");
  if (!label) {
    label = document.createElement("span");
    label.className = "pc-notable-hotbar-label";
    slot.append(label);
  }

  let labelText = label.querySelector(".pc-notable-hotbar-label-text");
  if (!labelText) {
    label.textContent = "";
    labelText = document.createElement("span");
    labelText.className = "pc-notable-hotbar-label-text";
    label.append(labelText);
  }
  labelText.textContent = displayData.name;
  updateHotbarLabelClamp(label, labelText);

  let toHit = slot.querySelector(".pc-notable-hotbar-tohit");
  if (!toHit) {
    toHit = document.createElement("span");
    toHit.className = "pc-notable-hotbar-tohit";
    slot.append(toHit);
  }
  toHit.textContent = displayData.stats.toHit;
  toHit.hidden = !displayData.stats.toHit;

  let accuracy = slot.querySelector(".pc-notable-hotbar-accuracy");
  if (!accuracy) {
    accuracy = document.createElement("span");
    accuracy.className = "pc-notable-hotbar-accuracy";
    slot.append(accuracy);
  }
  accuracy.textContent = displayData.stats.accuracy;
  accuracy.hidden = !displayData.stats.accuracy;
}

function updateHotbarLabelClamp(label, labelText) {
  const update = () => {
    if (!label?.isConnected || !labelText?.isConnected) return;
    const height = label.getBoundingClientRect?.().height || label.clientHeight || 0;
    if (!height) return;

    const style = getComputedStyle(labelText);
    const fontSize = Number.parseFloat(style.fontSize) || 9;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize;
    const lines = Math.max(1, Math.floor((height + 0.5) / lineHeight));
    labelText.style.setProperty("--pc-notable-hotbar-label-lines", String(lines));
  };

  update();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(update);
}

async function decorateNotableCombatHotbar(app, html) {
  const root = toElement(html);
  if (!root || root.id !== "hotbar") return;
  const slots = Array.isArray(app?.slots) ? app.slots : [];

  await Promise.all(slots.map(async (slotData) => {
    const flagData = getNotableCombatFlagData(slotData?.macro);
    if (!flagData) return;
    const slot = root.querySelector(`.slot[data-slot="${slotData.slot}"]`);
    if (!slot) return;
    const displayData = await getHotbarDisplayData(slotData.macro, flagData);
    upsertHotbarOverlay(slot, displayData);
  }));
}

function getAssignedNotableCombatMacroFlagData() {
  const hotbarSlots = ui?.hotbar?.slots;
  const slotMacros = Array.isArray(hotbarSlots)
    ? hotbarSlots.map((slot) => slot?.macro)
    : Object.values(hotbarSlots ?? {}).map((slot) => slot?.macro ?? slot);
  const userMacros = Object.values(game.user?.hotbar ?? {}).map((entry) => {
    if (entry?.getFlag) return entry;
    const id = typeof entry === "string" ? entry : String(entry?.macro ?? entry?.id ?? "");
    if (!id) return null;
    return game.macros?.get?.(id) || game.macros?.find?.((macro) => macro.id === id || macro.uuid === id) || null;
  });
  const macros = [...slotMacros, ...userMacros].filter((macro) => macro);
  return macros
    .map((macro) => getNotableCombatFlagData(macro))
    .filter((data) => data);
}

function hasNotableCombatHotbarMacroForActor(actor) {
  const actorUuid = String(actor?.uuid ?? "");
  if (!actorUuid) return false;
  return getAssignedNotableCombatMacroFlagData()
    .some((data) => data.actorUuid === actorUuid);
}

function isNotableCombatHotbarActorUpdate(changes) {
  const keys = new Set(Object.keys(changes ?? {}));
  try {
    for (const key of Object.keys(foundry.utils.flattenObject(changes ?? {}))) keys.add(key);
  } catch (err) {
    /* Fall back to top-level keys. */
  }

  for (const key of keys) {
    if (key === "name" || key === "img") return true;
    if (key === "system.combatMods" || key.startsWith("system.combatMods.")) return true;
    if (key === "system.notableCombats" || key.startsWith("system.notableCombats.")) return true;
  }
  return false;
}

function refreshNotableCombatHotbar() {
  const hotbar = ui?.hotbar;
  if (!hotbar) return;
  if (hotbar.rendered) hotbar.render(true);
}

export function registerPeasantNotableCombatHotbarApi() {
  registerPeasantCoreApi({
    addNotableCombatToHotbar,
    addSkillUsageToHotbar,
    rollNotableCombatHotbarMacro
  });
}

registerPeasantNotableCombatHotbarApi();
Hooks.once("ready", registerPeasantNotableCombatHotbarApi);

Hooks.on("renderApplicationV2", (app, html) => {
  if (app?.id !== "hotbar") return;
  void decorateNotableCombatHotbar(app, html).catch((err) => {
    pcLog.debug("Peasant Core | Failed to decorate notable combat hotbar", err);
  });
});

Hooks.on("updateActor", (actor, changes) => {
  if (!isNotableCombatHotbarActorUpdate(changes)) return;
  if (!hasNotableCombatHotbarMacroForActor(actor)) return;
  refreshNotableCombatHotbar();
});
