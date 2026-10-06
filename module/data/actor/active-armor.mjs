import { getEquippedArmorEffects } from "./equipped-armor.mjs";
import { getArmorChargeValue } from "./targeted-damage.mjs";

export function getEquippedArmorGrade(actor) {
  return getEquippedArmorEffects(actor).grade;
}

export function getActiveArmorChargeCapacity(actor) {
  const max = Number(actor?.system?.armorCharge?.max);
  return Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
}

export function canSpendActiveArmorCharge(actor) {
  return !!getEquippedArmorGrade(actor) && getActiveArmorChargeCapacity(actor) > 0 && getArmorChargeValue(actor) > 0;
}
