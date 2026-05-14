// Peasant Core System Initialization
import { configurePeasantCombat } from "./documents/_module.mjs";
import { configureChatListeners } from "./applications/chat-listeners.mjs";
import { configureCombatTracker } from "./applications/combat-tracker.mjs";
import { PC_WORLD_MIGRATION_VERSION_SETTING, migrateWorldNotableCombatData } from "./migration/world.mjs";
import { initializePeasantSockets, registerPeasantSocketHandler } from "./socket/remote-prompts.mjs";
import { registerDebugLoggingSetting } from "./utils/logging.mjs";

initializePeasantSockets();

// Initialize the system
Hooks.once('init', () => {
  console.log('Peasant Core | System initialized');
  configurePeasantCombat();
  configureChatListeners();
  configureCombatTracker();
  registerDebugLoggingSetting();

  game.settings.register("peasant-core", PC_WORLD_MIGRATION_VERSION_SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  // Register Handlebars helpers
  Handlebars.registerHelper('multiply', function(a, b) {
    return a * b;
  });
});

Hooks.once('ready', () => {
  console.log('Peasant Core | Setting up combat system');
  registerPeasantSocketHandler();
  void migrateWorldNotableCombatData();
  if (game?.combats) {
    game.combats.forEach(combat => combat.setupTurns());
    if (ui?.combat) ui.combat.render(true);
  }
});
