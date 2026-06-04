export const PC_INVENTORY_MIGRATION_STATE_SETTING = "inventoryMigrationState";
export const PC_INVENTORY_MIGRATION_VERSION = 1;

const PC_SYSTEM_ID = "peasant-core";
const PC_EXPORT_DIRECTORY = "assets/peasant-core/exports";
const PC_LEGACY_INVENTORY_FLAG = "legacyInventoryConvertedVersion";
const PC_LEGACY_INVENTORY_SOURCE_FLAG = "legacyInventorySource";

function getFilePickerClass() {
  return CONFIG?.ux?.FilePicker
    ?? foundry?.applications?.apps?.FilePicker
    ?? globalThis.FilePicker
    ?? null;
}

function hasMeaningfulHtml(value) {
  const html = String(value ?? "");
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .length > 0;
}

function getWorldId() {
  return String(game?.world?.id || game?.world?.title || "world")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "world";
}

function getTimestamp() {
  return new Date().toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-");
}

function getMigrationState() {
  const state = game.settings.get(PC_SYSTEM_ID, PC_INVENTORY_MIGRATION_STATE_SETTING);
  return state && typeof state === "object" && !Array.isArray(state) ? state : {};
}

function itemToExportData(item) {
  try {
    return item?.toObject?.() ?? item?._source ?? {};
  } catch (err) {
    return item?._source ?? {};
  }
}

function actorToExportData(actor) {
  const system = actor?._source?.system ?? actor?.system ?? {};
  return {
    id: actor?.id ?? "",
    uuid: actor?.uuid ?? "",
    name: actor?.name ?? "",
    type: actor?.type ?? "",
    legacyInventory: String(system.inventory ?? ""),
    items: Array.from(actor?.items ?? []).map(itemToExportData)
  };
}

async function ensureExportDirectory(filePicker) {
  if (typeof filePicker?.createDirectory !== "function") return;
  const parts = PC_EXPORT_DIRECTORY.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await filePicker.createDirectory("data", current, {});
    } catch (err) {
      const message = String(err?.message ?? err ?? "").toLowerCase();
      if (!message.includes("exist")) throw err;
    }
  }
}

export async function exportCurrentWorldInventoryBackup() {
  const filePicker = getFilePickerClass();
  if (!filePicker?.upload) throw new Error("Foundry FilePicker upload API is unavailable.");

  await ensureExportDirectory(filePicker);

  const filename = `inventory-export-${getWorldId()}-${getTimestamp()}.json`;
  const payload = {
    schema: "peasant-core.inventory-export.v1",
    exportedAt: new Date().toISOString(),
    system: {
      id: PC_SYSTEM_ID,
      version: game?.system?.version ?? ""
    },
    world: {
      id: game?.world?.id ?? "",
      title: game?.world?.title ?? ""
    },
    actors: Array.from(game?.actors ?? []).map(actorToExportData)
  };

  const json = JSON.stringify(payload, null, 2);
  const file = new File([new Blob([json], { type: "application/json" })], filename, { type: "application/json" });
  const response = await filePicker.upload("data", PC_EXPORT_DIRECTORY, file, {}, { notify: false });
  const path = response?.path ?? `${PC_EXPORT_DIRECTORY}/${filename}`;

  return {
    path,
    actorCount: payload.actors.length
  };
}

function actorHasLegacyInventorySourceItem(actor) {
  return Array.from(actor?.items ?? []).some(item => !!item?.getFlag?.(PC_SYSTEM_ID, PC_LEGACY_INVENTORY_SOURCE_FLAG));
}

function actorHasConvertedLegacyInventory(actor) {
  const convertedVersion = Number(actor?.getFlag?.(PC_SYSTEM_ID, PC_LEGACY_INVENTORY_FLAG) ?? 0);
  return convertedVersion >= PC_INVENTORY_MIGRATION_VERSION;
}

async function convertActorLegacyInventory(actor, convertedAt) {
  const rawInventory = String((actor?._source?.system ?? actor?.system ?? {}).inventory ?? "");
  if (actorHasConvertedLegacyInventory(actor)) return false;
  if (actorHasLegacyInventorySourceItem(actor)) {
    await actor.setFlag(PC_SYSTEM_ID, PC_LEGACY_INVENTORY_FLAG, PC_INVENTORY_MIGRATION_VERSION);
    return false;
  }
  if (!hasMeaningfulHtml(rawInventory)) return false;

  await actor.createEmbeddedDocuments("Item", [{
    name: "Legacy Inventory Notes",
    type: "loot",
    img: "icons/svg/item-bag.svg",
    system: {
      description: rawInventory,
      category: "resource",
      quantity: 1,
      value: 0,
      currency: "gp"
    },
    flags: {
      [PC_SYSTEM_ID]: {
        [PC_LEGACY_INVENTORY_SOURCE_FLAG]: {
          actorId: actor.id,
          convertedAt,
          migrationVersion: PC_INVENTORY_MIGRATION_VERSION
        }
      }
    }
  }], { render: false });

  await actor.setFlag(PC_SYSTEM_ID, PC_LEGACY_INVENTORY_FLAG, PC_INVENTORY_MIGRATION_VERSION);
  return true;
}

export async function migrateWorldLegacyInventoryData() {
  if (!game.user?.isGM) return;

  const state = getMigrationState();
  if (Number(state.version ?? 0) >= PC_INVENTORY_MIGRATION_VERSION && state.exported && state.converted) return;

  let exportResult;
  try {
    exportResult = await exportCurrentWorldInventoryBackup();
  } catch (err) {
    console.error("Peasant Core | Failed to export actor inventory backup. Legacy inventory conversion skipped.", err);
    ui.notifications?.error?.("Peasant Core inventory backup failed. Legacy inventory conversion was skipped; see console for details.");
    return;
  }

  const convertedAt = new Date().toISOString();
  let convertedActors = 0;
  let hadFailures = false;

  for (const actor of game.actors ?? []) {
    try {
      if (await convertActorLegacyInventory(actor, convertedAt)) convertedActors += 1;
    } catch (err) {
      hadFailures = true;
      console.error(`Peasant Core | Failed to convert legacy inventory for ${actor?.name ?? "actor"}:`, err);
    }
  }

  if (hadFailures) {
    ui.notifications?.warn?.("Peasant Core exported an inventory backup, but some legacy inventory notes were not converted. See console for details.");
    await game.settings.set(PC_SYSTEM_ID, PC_INVENTORY_MIGRATION_STATE_SETTING, {
      version: 0,
      exported: true,
      converted: false,
      path: exportResult.path,
      actorCount: exportResult.actorCount,
      convertedActors,
      failedAt: convertedAt
    });
    return;
  }

  await game.settings.set(PC_SYSTEM_ID, PC_INVENTORY_MIGRATION_STATE_SETTING, {
    version: PC_INVENTORY_MIGRATION_VERSION,
    exported: true,
    converted: true,
    path: exportResult.path,
    actorCount: exportResult.actorCount,
    convertedActors,
    completedAt: convertedAt
  });

  console.log(`Peasant Core | Exported actor inventories to ${exportResult.path}. Converted ${convertedActors} legacy inventory note item(s).`);
}
