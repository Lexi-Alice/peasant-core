import { qs, qsa } from "../../dom.mjs";

const PC_ACTIVE_EFFECT_TYPES = Object.freeze(["base", "enchantment"]);

async function getPassiveEffectFromElement(sheet, element) {
  const row = element?.closest?.("[data-pc-passive-effect]");
  if (!row) return null;

  const uuid = String(row.dataset.effectUuid ?? "").trim();
  if (uuid && typeof fromUuid === "function") {
    try {
      const effect = await fromUuid(uuid);
      if (effect?.documentName === "ActiveEffect") return effect;
    } catch (err) {
      /* Fall back to actor-owned lookup. */
    }
  }

  const id = String(row.dataset.effectId ?? "").trim();
  return id ? sheet?.actor?.effects?.get?.(id) ?? null : null;
}

function getPassiveEffectFromElementSync(sheet, element) {
  const row = element?.closest?.("[data-pc-passive-effect]");
  if (!row) return null;

  const uuid = String(row.dataset.effectUuid ?? "").trim();
  if (uuid) {
    if (typeof fromUuidSync === "function") {
      try {
        const effect = fromUuidSync(uuid);
        if (effect?.documentName === "ActiveEffect") return effect;
      } catch (err) {
        /* Fall back to collection lookup. */
      }
    }

    for (const effect of sheet?.actor?.effects ?? []) {
      if (effect?.uuid === uuid) return effect;
    }
    for (const item of sheet?.actor?.items ?? []) {
      for (const effect of item?.effects ?? []) {
        if (effect?.uuid === uuid) return effect;
      }
    }
  }

  const id = String(row.dataset.effectId ?? "").trim();
  if (!id) return null;
  return sheet?.actor?.effects?.get?.(id)
    ?? Array.from(sheet?.actor?.items ?? []).find(item => item?.effects?.get?.(id))?.effects?.get?.(id)
    ?? null;
}

function applyPassiveEffectsSearch(root) {
  const browser = qs(root, "[data-pc-passive-effects-browser]");
  if (!browser) return;

  const input = qs(browser, "[data-pc-passive-effects-search]");
  const query = String(input?.value ?? "").trim().toLowerCase();
  let matchingRows = 0;
  let totalRows = 0;

  for (const row of qsa(browser, "[data-pc-passive-effect]")) {
    totalRows += 1;
    const matches = !query || String(row.dataset.search ?? "").includes(query);
    row.hidden = !matches;
    if (matches) matchingRows += 1;
  }

  const section = qs(browser, "[data-pc-passive-effects-section]");
  if (section) section.hidden = !!query && matchingRows === 0 && totalRows > 0;

  const empty = qs(browser, ".pc-passive-effects-search-empty");
  if (empty) empty.hidden = !query || totalRows === 0 || matchingRows > 0;
}

function syncPassiveEffectToggleState(control, disabled) {
  const row = control?.closest?.("[data-pc-passive-effect]");
  row?.classList.toggle("pc-passive-effect-disabled", disabled);

  if (!control) return;
  control.classList.toggle("fa-toggle-off", disabled);
  control.classList.toggle("fa-toggle-on", !disabled);
  control.classList.toggle("active", !disabled);
  control.setAttribute("aria-pressed", disabled ? "false" : "true");

  const label = disabled ? "Enable Effect" : "Disable Effect";
  control.dataset.tooltip = label;
  control.setAttribute("aria-label", label);
}

function syncPassiveEffectRowState(row, disabled) {
  if (!row) return;
  row.classList.toggle("pc-passive-effect-disabled", disabled);
  syncPassiveEffectToggleState(qs(row, "[data-pc-passive-effect-toggle]"), disabled);
}

async function togglePassiveEffect(sheet, control) {
  if (!sheet?.canModifyActor) return;
  const effect = await getPassiveEffectFromElement(sheet, control);
  if (typeof effect?.update !== "function") {
    ui.notifications?.warn?.("Unable to toggle that effect from this sheet.");
    return;
  }

  const nextDisabled = control.getAttribute("aria-pressed") === "true";
  try {
    await effect.update({ disabled: nextDisabled });
    syncPassiveEffectToggleState(control, nextDisabled);
  } catch (err) {
    console.warn("Failed to toggle active effect:", err);
    ui.notifications?.error?.("Failed to toggle effect. See console for details.");
  }
}

function getContextMenuClass() {
  return foundry?.applications?.ux?.ContextMenu?.implementation
    ?? globalThis.ContextMenu?.implementation
    ?? globalThis.ContextMenu
    ?? null;
}

function openPassiveEffectSheet(effect, { mode = null } = {}) {
  const sheet = effect?.sheet;
  if (!sheet || typeof sheet.render !== "function") return;
  const modes = sheet.constructor?.MODES ?? {};
  if (mode === "edit" && modes.EDIT !== undefined) return sheet.render({ force: true, mode: modes.EDIT });
  return sheet.render(true);
}

async function duplicatePassiveEffect(sheet, effect) {
  if (!effect || !sheet?.canModifyActor) return null;
  const effectName = effect.name ?? effect.label ?? "Active Effect";
  const name = game.i18n?.format?.("DOCUMENT.CopyOf", { name: effectName })
    ?? `Copy of ${effectName}`;

  let duplicate = null;
  if (typeof effect.clone === "function") {
    duplicate = await effect.clone({ name }, { save: true, addSource: true });
  } else {
    const source = effect.toObject?.() ?? effect._source ?? null;
    const parent = effect.parent;
    if (!source || typeof parent?.createEmbeddedDocuments !== "function") return null;
    const data = foundry.utils.deepClone(source);
    delete data._id;
    data.name = name;
    const created = await parent.createEmbeddedDocuments("ActiveEffect", [data]);
    duplicate = created?.[0] ?? null;
  }

  if (duplicate && typeof sheet.render === "function") await sheet.render({ preserveScroll: true });
  return duplicate;
}

async function deletePassiveEffect(sheet, effect) {
  if (!effect || !sheet?.canModifyActor) return;
  if (typeof effect.deleteDialog === "function") {
    await effect.deleteDialog({}, { render: false });
  } else {
    await effect.delete();
  }
  if (typeof sheet.render === "function") await sheet.render({ preserveScroll: true });
}

async function setPassiveEffectDisabled(sheet, target, effect, disabled) {
  effect ??= await getPassiveEffectFromElement(sheet, target);
  if (typeof effect?.update !== "function") {
    ui.notifications?.warn?.("Unable to toggle that effect from this sheet.");
    return;
  }

  try {
    await effect.update({ disabled });
    syncPassiveEffectRowState(target?.closest?.("[data-pc-passive-effect]"), disabled);
  } catch (err) {
    console.warn("Failed to toggle active effect:", err);
    ui.notifications?.error?.("Failed to toggle effect. See console for details.");
  }
}

async function openCreatePassiveEffectDialog(sheet) {
  if (!sheet?.canModifyActor || !sheet.isEditMode) return;

  const ActiveEffectClass = globalThis.ActiveEffect?.implementation ?? globalThis.ActiveEffect;
  if (typeof ActiveEffectClass?.createDialog !== "function") {
    ui.notifications?.warn?.("Unable to open the active effect creation dialog.");
    return;
  }

  const actorName = sheet.actor?.name || "Actor";
  const created = await ActiveEffectClass.createDialog(
    {
      type: "base",
      name: `${actorName} Effect`,
      img: sheet.actor?.img || "icons/svg/aura.svg",
      origin: sheet.actor?.uuid
    },
    { parent: sheet.actor },
    {
      types: PC_ACTIVE_EFFECT_TYPES,
      window: { title: "Create Active Effect" }
    }
  );
  if (created && typeof sheet.render === "function") await sheet.render({ preserveScroll: true });
}

function getPassiveEffectContextOptions(sheet, effect) {
  const disabled = !!effect?.disabled;
  return [
    {
      label: "Edit",
      icon: "fa-solid fa-pen-to-square",
      onClick: () => openPassiveEffectSheet(effect, { mode: "edit" })
    },
    {
      label: "Duplicate",
      icon: "fa-solid fa-copy",
      onClick: async () => duplicatePassiveEffect(sheet, effect)
    },
    {
      label: "Delete",
      icon: "fa-solid fa-trash",
      onClick: async () => deletePassiveEffect(sheet, effect)
    },
    {
      label: disabled ? "Enable" : "Disable",
      icon: disabled ? "fa-solid fa-check" : "fa-solid fa-xmark",
      cssClass: "pc-passive-effect-menu-separator",
      class: "pc-passive-effect-menu-separator",
      separator: true,
      onClick: async (_event, target) => setPassiveEffectDisabled(sheet, target, effect, !disabled)
    }
  ];
}

function setupPassiveEffectContextMenu(sheet, browser) {
  if (!sheet?.canModifyActor) return;

  const ContextMenuClass = getContextMenuClass();
  if (!ContextMenuClass) return;

  new ContextMenuClass(browser, "[data-pc-passive-effect-menu]", [], {
    eventName: "click",
    fixed: true,
    jQuery: false,
    relative: "target",
    onOpen: element => {
      const effect = getPassiveEffectFromElementSync(sheet, element);
      if (!effect) return;
      ui.context.menuItems = getPassiveEffectContextOptions(sheet, effect);
    }
  });
}

export function setupActorEffectControls(sheet, html, { readOnly = false } = {}) {
  const root = html?.[0] ?? html;
  const browser = qs(root, "[data-pc-passive-effects-browser]");
  if (!browser) return;

  const search = qs(browser, "[data-pc-passive-effects-search]");
  search?.addEventListener("input", () => applyPassiveEffectsSearch(root));

  if (!readOnly) {
    qs(browser, "[data-pc-passive-effect-add]")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await openCreatePassiveEffectDialog(sheet);
    });

    for (const control of qsa(browser, "[data-pc-passive-effect-toggle]")) {
      control.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await togglePassiveEffect(sheet, control);
      });
    }
    setupPassiveEffectContextMenu(sheet, browser);
  }

  applyPassiveEffectsSearch(root);
}
