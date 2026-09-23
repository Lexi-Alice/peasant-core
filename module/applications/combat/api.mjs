import { registerPeasantCoreApi } from "../../utils/api.mjs";
import { performConsciousnessCheck, performSavingRoll, performSkillRoll, performUntrainedSkillRoll } from "../../dice/rolls.mjs";
import { showDefensePromptDialog } from "./defense-prompt-dialog.mjs";
import {
  applyEdgeChainRoll,
  applyEdgeExplodeRoll,
  applyEdgeIndividualDieRoll,
  applyFallBlessingAccuracy,
  edgeChainRollFromMessage,
  edgeExplodeRollFromMessage,
  edgeIndividualDieRollFromMessage,
  fallBlessingAccuracyFromMessage,
  applyStressRoll,
  stressRollFromMessage
} from "./edge-chain-rolls.mjs";
import { applyEdgeLocationRoll, edgeLocationRollFromMessage } from "./edge-location-rolls.mjs";
import { showIncomingHitPrompt, applyIncomingHeal, applyIncomingHit } from "./incoming-hit.mjs";
import { rollManualCombatTag } from "./manual-combat-tag-rolls.mjs";
import { performNotableCombatRoll, planNotableCombatEdgeExplodeReplay, replayNotableCombatPostRollEffects, startNotableCombatRoll } from "./notable-combat-workflow.mjs";
import { closeActiveRemotePrompt } from "./remote-prompt-registry.mjs";
import { performPeasantSkillCheck, startPeasantEntryUse } from "./skill-entry-use.mjs";
import { useSkillEntry } from "../skill-usage-links.mjs";

async function showDefensePrompt(payload = {}) {
  return showDefensePromptDialog(payload, { rollNotableCombat: startNotableCombatRoll });
}

export function registerPeasantCombatApi() {
  registerPeasantCoreApi({
    performConsciousnessCheck,
    performSavingRoll,
    performSkillRoll,
    performUntrainedSkillRoll,
    showDefensePrompt,
    showIncomingHitPrompt,
    applyIncomingHeal,
    applyIncomingHit,
    applyEdgeChainRoll,
    edgeChainRollFromMessage,
    applyEdgeExplodeRoll,
    edgeExplodeRollFromMessage,
    applyEdgeIndividualDieRoll,
    edgeIndividualDieRollFromMessage,
    applyFallBlessingAccuracy,
    fallBlessingAccuracyFromMessage,
    applyStressRoll,
    stressRollFromMessage,
    applyEdgeLocationRoll,
    edgeLocationRollFromMessage,
    rollManualCombatTag,
    closeRemotePrompt: closeActiveRemotePrompt,
    performNotableCombatRoll,
    planNotableCombatEdgeExplodeReplay,
    replayNotableCombatPostRollEffects,
    startNotableCombatRoll,
    performPeasantSkillCheck,
    startPeasantEntryUse,
    useSkillEntry
  });
}
