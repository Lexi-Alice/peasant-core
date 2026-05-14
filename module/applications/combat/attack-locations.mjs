import { doesPromptResultCountAsActiveDefense } from "../../data/actor/defense-results.mjs";
import {
  createChosenLocationTableMessage,
  createLocationRollFromSkillOption,
  rollAutomatedAttackLocation,
  showLocationBySkillPrompt
} from "../actor/location-table.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";

export async function resolveAttackLocationForTarget({
  actor = null,
  attackerToken = null,
  combat = null,
  target = null,
  attackRoll = null,
  defensePromptResult = null
} = {}) {
  const targetLabel = target?.targetName || target?.actor?.name || "";
  const defendedByReflex = doesPromptResultCountAsActiveDefense(defensePromptResult);
  const selectableMoS = Number(attackRoll?.rollResult?.totalMoS) || 0;

  if (selectableMoS >= 1) {
    const promptResult = await showLocationBySkillPrompt({
      maxMoS: selectableMoS,
      attackerName: actor?.name || attackerToken?.name || "Attacker",
      targetLabel
    });
    if (isChainCancelledResult(promptResult)) {
      return { chainCancelled: true };
    }
    const selectedOption = promptResult?.option || null;
    if (selectedOption && selectedOption.mode !== "table") {
      const selectedLocation = createLocationRollFromSkillOption(selectedOption);
      await createChosenLocationTableMessage(selectedLocation);

      return selectedLocation;
    }
  }

  let locationRoll = await rollAutomatedAttackLocation({
    actor,
    attackerToken,
    combatName: combat?.name || "Combat",
    targetLabel
  });

  if (defendedByReflex && locationRoll?.location === "Head") {
    ui.notifications?.info?.("Head deflected by the defensive reflex. Rerolling location.");
    const rerolledLocation = await rollAutomatedAttackLocation({
      actor,
      attackerToken,
      combatName: combat?.name || "Combat",
      targetLabel
    });
    if (rerolledLocation) locationRoll = rerolledLocation;
  }

  return locationRoll;
}
