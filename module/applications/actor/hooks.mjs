import { refreshOpenHpGridDialogsForActor } from "./controls/health-stress/hp-grid-dialog.mjs";
import { refreshOpenStressGridDialogsForActor } from "./controls/health-stress/stress-grid-dialog.mjs";
import { registerHpBufferOverlayHooks } from "../token-hud/hp-buffer-overlay.mjs";
import { registerTokenHudHpCommandHooks } from "../token-hud/hp-commands.mjs";
import { refreshOpenWoundsDialogsForActor } from "./controls/wounds-controls.mjs";
import { pcLog } from "../../utils/logging.mjs";

function getActorUpdateKeys(changed = {}) {
  const keys = new Set(Object.keys(changed ?? {}));
  try {
    for (const key of Object.keys(foundry.utils.flattenObject(changed ?? {}))) keys.add(key);
  } catch (err) {
    /* Fall back to top-level keys. */
  }
  return keys;
}

function hasChangedPath(keys, prefixes) {
  for (const key of keys) {
    for (const prefix of prefixes) {
      if (key === prefix || key.startsWith(`${prefix}.`)) return true;
    }
  }
  return false;
}

function hasStressGridChange(keys) {
  for (const key of keys) {
    if (/^system\.(physical|mental|general)(StressCount|\d+)$/.test(key)) return true;
  }
  return false;
}

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
        bar: ["health", "stamina", "attunement", "capacity", "edge", "armorCharge"],
        value: []
      }
    };

    pcLog.debug("Peasant Core: trackableAttributes set:", CONFIG.Actor.trackableAttributes);
  });

  registerTokenHudHpCommandHooks({ tokenHudClass });
  registerHpBufferOverlayHooks();

  Hooks.on("updateActor", (actor, changed) => {
    if (!isPeasantCharacterType(actor?.type)) return;

    const keys = getActorUpdateKeys(changed);
    if (hasChangedPath(keys, ["system.hp", "flags.peasant-core.simplifiedHp"])) {
      refreshOpenHpGridDialogsForActor(actor);
    }
    if (hasStressGridChange(keys)) {
      refreshOpenStressGridDialogsForActor(actor);
    }
    if (hasChangedPath(keys, ["system.conditions"])) {
      refreshOpenWoundsDialogsForActor(actor);
    }
  });

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
