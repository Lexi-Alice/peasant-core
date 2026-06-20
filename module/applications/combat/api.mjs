import { registerPeasantCoreApi } from "../../utils/api.mjs";
import { showDefensePromptDialog } from "./defense-prompt-dialog.mjs";
import { applyEdgeChainRoll, applyEdgeExplodeRoll, edgeChainRollFromMessage, edgeExplodeRollFromMessage } from "./edge-chain-rolls.mjs";
import { applyEdgeLocationRoll, edgeLocationRollFromMessage } from "./edge-location-rolls.mjs";
import { showIncomingHitPrompt, applyIncomingHeal, applyIncomingHit } from "./incoming-hit.mjs";
import { rollManualCombatTag } from "./manual-combat-tag-rolls.mjs";
import { performNotableCombatRoll, planNotableCombatEdgeExplodeReplay, replayNotableCombatPostRollEffects, startNotableCombatRoll } from "./notable-combat-workflow.mjs";
import { closeActiveRemotePrompt } from "./remote-prompt-registry.mjs";

async function showDefensePrompt(payload = {}) {
  return showDefensePromptDialog(payload, { rollNotableCombat: startNotableCombatRoll });
}

export function registerPeasantCombatApi() {
  registerPeasantCoreApi({
    showDefensePrompt,
    showIncomingHitPrompt,
    applyIncomingHeal,
    applyIncomingHit,
    applyEdgeChainRoll,
    edgeChainRollFromMessage,
    applyEdgeExplodeRoll,
    edgeExplodeRollFromMessage,
    applyEdgeLocationRoll,
    edgeLocationRollFromMessage,
    rollManualCombatTag,
    closeRemotePrompt: closeActiveRemotePrompt,
    performNotableCombatRoll,
    planNotableCombatEdgeExplodeReplay,
    replayNotableCombatPostRollEffects,
    startNotableCombatRoll
  });
}
