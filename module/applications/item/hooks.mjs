import { PEASANT_ITEM_DATA_MODELS, PEASANT_ITEM_TYPES } from "../../data/item/_module.mjs";
import { pcLog } from "../../utils/logging.mjs";

export function configurePeasantItemSheetHooks({
  sheetClass,
  itemClass,
  itemDataModels = PEASANT_ITEM_DATA_MODELS,
  documentSheetConfig
} = {}) {
  Hooks.once("init", () => {
    CONFIG.Item.documentClass = itemClass;
    Object.assign(CONFIG.Item.dataModels, itemDataModels);

    CONFIG.Item.typeLabels = {
      ...CONFIG.Item.typeLabels,
      weapon: "TYPES.Item.weapon",
      equipment: "TYPES.Item.equipment",
      tool: "TYPES.Item.tool",
      consumable: "TYPES.Item.consumable",
      loot: "TYPES.Item.loot"
    };

    CONFIG.Item.typeIcons = {
      ...CONFIG.Item.typeIcons,
      weapon: "fa-solid fa-sword",
      equipment: "fa-solid fa-shield-halved",
      tool: "fa-solid fa-toolbox",
      consumable: "fa-solid fa-flask",
      loot: "fa-solid fa-coins"
    };

    if (!documentSheetConfig) {
      throw new Error("Peasant Core requires Foundry's DocumentSheetConfig.");
    }

    documentSheetConfig.registerSheet(Item, "peasant-core", sheetClass, {
      types: [...PEASANT_ITEM_TYPES],
      makeDefault: true,
      label: "Peasant Core Item Sheet"
    });

    pcLog.debug("Peasant Core: item types registered:", PEASANT_ITEM_TYPES);
  });
}
