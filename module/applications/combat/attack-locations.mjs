import { doesPromptResultCountAsActiveDefense } from "../../data/actor/defense-results.mjs";
import {
  createChosenLocationTableMessage,
  createLocationRollFromSkillOption,
  getTargetedDamageLocationDisplay,
  rollAutomatedAttackLocation,
  showLocationBySkillPrompt
} from "../actor/location-table.mjs";
import { isChainCancelledResult } from "./prompt-dialogs.mjs";

function normalizeMagnetismGrade(rawGrade) {
  const grade = Number.parseInt(rawGrade, 10);
  return Number.isFinite(grade) ? Math.max(0, grade) : 0;
}

function createMagnetismTorsoLocationRoll(magnetismGrade) {
  return {
    rawText: "Torso",
    location: "Torso",
    locationDisplay: getTargetedDamageLocationDisplay("Torso"),
    isAP: false,
    byMagnetism: true,
    magnetismGrade
  };
}

export async function resolveAttackLocationForTarget({
  actor = null,
  attackerToken = null,
  combat = null,
  target = null,
  attackRoll = null,
  defensePromptResult = null,
  magnetismGrade = 0
} = {}) {
  const targetLabel = target?.targetName || target?.actor?.name || "";
  const defendedByReflex = doesPromptResultCountAsActiveDefense(defensePromptResult);
  const selectableMoS = Number(attackRoll?.rollResult?.totalMoS) || 0;
  const resolvedMagnetismGrade = normalizeMagnetismGrade(magnetismGrade);

  if (selectableMoS >= 1) {
    const promptResult = await showLocationBySkillPrompt({
      maxMoS: selectableMoS,
      attackerName: actor?.name || attackerToken?.name || "Attacker",
      targetLabel,
      magnetismGrade: resolvedMagnetismGrade
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

  if (resolvedMagnetismGrade > 0) {
    const forcedLocation = createMagnetismTorsoLocationRoll(resolvedMagnetismGrade);
    await createChosenLocationTableMessage(forcedLocation);
    return forcedLocation;
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
