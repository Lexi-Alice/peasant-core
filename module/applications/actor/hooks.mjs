import { registerHpBufferOverlayHooks } from "../token-hud/hp-buffer-overlay.mjs";
import { registerTokenHudHpCommandHooks } from "../token-hud/hp-commands.mjs";
import { pcLog } from "../../utils/logging.mjs";

export function configurePeasantActorSheetHooks({
  sheetClass,
  actorClass,
  characterModel,
  documentSheetConfig,
  tokenHudClass,
  isPeasantCharacterType
} = {}) {
  Hooks.once("init", () => {
    CONFIG.Actor.documentClass = actorClass;
    CONFIG.Actor.dataModels.character = characterModel;

    if (!documentSheetConfig) {
      throw new Error("Peasant Core requires Foundry's DocumentSheetConfig.");
    }
    const coreActorSheetClass = CONFIG.Actor.sheetClasses?.character?.core?.cls;
    if (coreActorSheetClass) documentSheetConfig.unregisterSheet(Actor, "core", coreActorSheetClass);
    documentSheetConfig.registerSheet(Actor, "peasant-core", sheetClass, {
      types: ["character"],
      makeDefault: true,
      label: "Peasant Core Character Sheet"
    });

    CONFIG.Actor.trackableAttributes = {
      character: {
        bar: ["health", "stamina", "attunement", "capacity", "edge"],
        value: []
      }
    };

    pcLog.debug("Peasant Core: trackableAttributes set:", CONFIG.Actor.trackableAttributes);
  });

  registerTokenHudHpCommandHooks({ tokenHudClass });
  registerHpBufferOverlayHooks();

  Hooks.on("preCreateToken", (token) => {
    if (isPeasantCharacterType(token.actor?.type) && !token.bar1?.attribute) {
      token.updateSource({ "bar1.attribute": "stamina" });
    }
  });

  Hooks.on("renderTokenConfig", (app, html, data) => {
    pcLog.debug("Token Config Data:", data);
    pcLog.debug("Available bar attributes:", data.barAttributes);
  });

  Hooks.on("renderPrototypeTokenConfig", (app, html, data) => {
    pcLog.debug("Prototype Token Config Data:", data);
    pcLog.debug("Available bar attributes:", data.barAttributes);
  });
}
