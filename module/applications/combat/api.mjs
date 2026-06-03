import { registerPeasantCoreApi } from "../../utils/api.mjs";
import { showDefensePromptDialog } from "./defense-prompt-dialog.mjs";
import { showIncomingHitPrompt, applyIncomingHeal, applyIncomingHit } from "./incoming-hit.mjs";
import { startNotableCombatRoll } from "./notable-combat-workflow.mjs";
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
    closeRemotePrompt: closeActiveRemotePrompt,
    startNotableCombatRoll
  });
}
