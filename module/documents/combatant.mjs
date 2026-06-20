import { PC_SKIP_INITIATIVE_REANCHOR_OPTION } from "../data/combat-turn-order.mjs";

const hasOwn = function(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
};

export class PeasantCombatant extends Combatant {
  static async _onUpdateOperation(documents, operation, user) {
    await super._onUpdateOperation(documents, operation, user);
    if (user?.id !== game.userId || !game.user?.isGM) return;
    if (operation?.options?.[PC_SKIP_INITIATIVE_REANCHOR_OPTION]) return;
    if (!operation?.parent) return;

    const hasInitiativeUpdate = Array.from(operation.updates || [])
      .some(update => hasOwn(update, "initiative"));
    if (!hasInitiativeUpdate) return;

    operation.parent.setupTurns();
    if (typeof operation.parent.reanchorCurrentPhaseTurn === "function") {
      await operation.parent.reanchorCurrentPhaseTurn();
    } else {
      ui.combat?.render?.(true);
    }
  }
}
