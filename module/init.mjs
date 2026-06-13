// Peasant Core System Initialization
import { configurePeasantCombat } from "./documents/_module.mjs";
import { PEASANT_ACTIVE_EFFECT_DATA_MODELS } from "./data/active-effect/_module.mjs";
import { configureChatListeners } from "./applications/chat-listeners.mjs";
import { configureCombatTracker } from "./applications/combat-tracker.mjs";
import { drawLocationTableLikeMacro } from "./applications/actor/location-table.mjs";
import { registerPeasantCombatApi } from "./applications/combat/api.mjs";
import { PC_INVENTORY_MIGRATION_STATE_SETTING, exportCurrentWorldInventoryBackup, migrateWorldLegacyInventoryData } from "./migration/inventory.mjs";
import { PC_WORLD_MIGRATION_VERSION_SETTING, migrateWorldNotableCombatData } from "./migration/world.mjs";
import { registerPeasantCoreSettingsMenus } from "./settings.mjs";
import { initializePeasantSockets, registerPeasantSocketHandler } from "./socket/remote-prompts.mjs";
import { registerPeasantCoreApi } from "./utils/api.mjs";
import { registerDebugLoggingSetting } from "./utils/logging.mjs";

initializePeasantSockets();

// Initialize the system
Hooks.once('init', () => {
  console.log('Peasant Core | System initialized');
  configurePeasantCombat();
  configureChatListeners();
  configureCombatTracker();
  Object.assign(CONFIG.ActiveEffect.dataModels, PEASANT_ACTIVE_EFFECT_DATA_MODELS);
  CONFIG.ActiveEffect.typeLabels = {
    ...CONFIG.ActiveEffect.typeLabels,
    enchantment: "TYPES.ActiveEffect.enchantment",
    skill: "TYPES.ActiveEffect.skill"
  };
  registerDebugLoggingSetting();
  registerPeasantCoreSettingsMenus();

  game.settings.register("peasant-core", PC_WORLD_MIGRATION_VERSION_SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register("peasant-core", PC_INVENTORY_MIGRATION_STATE_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // Register Handlebars helpers
  Handlebars.registerHelper('multiply', function(a, b) {
    return a * b;
  });
});

Hooks.once('ready', () => {
  console.log('Peasant Core | Setting up combat system');
  initializePeasantSockets();
  registerPeasantCoreApi({
    drawLocationTable: drawLocationTableLikeMacro,
    exportCurrentWorldInventory: exportCurrentWorldInventoryBackup
  });
  registerPeasantCombatApi();
  registerPeasantSocketHandler();
  void (async () => {
    await migrateWorldLegacyInventoryData();
    await migrateWorldNotableCombatData();
  })();
  if (game?.combats) {
    game.combats.forEach(combat => combat.setupTurns());
    if (ui?.combat) ui.combat.render(true);
  }
});
