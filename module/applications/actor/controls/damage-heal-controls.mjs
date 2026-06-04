import { applyTargetedDamageWorkflow } from "../../combat/targeted-damage-workflow.mjs";
import { delegate, qs } from "../../dom.mjs";
import { renderSheetResourceDialog } from "./resource-dialogs.mjs";

export function setupDamageHealControls(sheet, html) {
  delegate(html, "click", ".damage-toggle", (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    openDamageDialog(sheet, target);
  });

  delegate(html, "click", ".heal-toggle", (ev, target) => {
    ev.preventDefault();
    ev.stopPropagation();
    openHealDialog(sheet, target);
  });
}

function openDamageDialog(sheet, trigger) {
  return renderSheetResourceDialog(sheet, "damage", {
    title: "Take Damage",
    content: `
      <div class="pc-resource-form pc-damage-form">
        <div class="pc-resource-grid pc-damage-grid">
          <label>
            <span>Type</span>
            <select name="damageType" class="pc-select">
              <option value="blunt">Blunt</option>
              <option value="hybrid">Hybrid</option>
              <option value="lethal">Lethal</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            <span>Amount</span>
            <input type="number" name="damageAmount" class="pc-input" value="5" min="1" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*">
          </label>
          <label>
            <span>Location</span>
            <select name="damageLocation" class="pc-select">
              <option value="Head">Head</option>
              <option value="Torso" selected>Torso</option>
              <option value="RightArm">Right Arm</option>
              <option value="LeftArm">Left Arm</option>
              <option value="RightLeg">Right Leg</option>
              <option value="LeftLeg">Left Leg</option>
            </select>
          </label>
        </div>
        <div class="pc-resource-checks">
          <label data-tooltip="Ignore HALT and Hard Location (unless Natural)" aria-label="Ignore HALT and Hard Location unless Natural">
            <input type="checkbox" name="damageAP">
            <span>Armor Pen?</span>
          </label>
          <label data-tooltip="Multiply armor HALT using the actor's Armor Charge multiplier" aria-label="Multiply armor HALT using the actor's Armor Charge multiplier">
            <input type="checkbox" name="damageArmorCharge">
            <span>Armor Charge?</span>
          </label>
        </div>
      </div>
    `,
    buttons: {
      apply: {
        icon: "fa-solid fa-swords",
        label: "Apply Damage",
        default: true,
        callback: async (html) => {
          const type = qs(html, "[name=damageType]")?.value;
          const amount = Number(qs(html, "[name=damageAmount]")?.value);
          const location = qs(html, "[name=damageLocation]")?.value || "Torso";
          const isAP = !!qs(html, "[name=damageAP]")?.checked;
          const useArmorCharge = !!qs(html, "[name=damageArmorCharge]")?.checked;

          const result = await applyTargetedDamageWorkflow(sheet.actor, {
            amount,
            type,
            location,
            isAP,
            useArmorCharge,
            chatSpeaker: ChatMessage.getSpeaker({ actor: sheet.actor })
          });

          if (!result.ok) {
            ui.notifications?.warn?.(result.message || "Failed to apply damage.");
            return false;
          }

          return true;
        }
      }
    },
    default: "apply"
  }, trigger, {
    width: 380,
    height: 230,
    classes: ["pc-damage-dialog"]
  });
}

function openHealDialog(sheet, trigger) {
  return renderSheetResourceDialog(sheet, "heal", {
    title: "Heal Damage",
    content: `
      <div class="pc-resource-form pc-heal-form">
        <div class="pc-resource-grid pc-heal-grid">
          <label>
            <span>Amount</span>
            <input type="number" name="healAmount" class="pc-input" value="5" min="1" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*">
          </label>
          <label>
            <span>Type</span>
            <select name="healType" class="pc-select">
              <option value="temporary">Temporary Heal</option>
              <option value="greater">Greater Heal</option>
            </select>
          </label>
        </div>
      </div>
    `,
    buttons: {
      apply: {
        icon: "fa-solid fa-heart",
        label: "Apply Healing",
        default: true,
        callback: async (html) => {
          const amount = Number(qs(html, "[name=healAmount]")?.value) || 0;
          const healType = qs(html, "[name=healType]")?.value;
          if (!amount) return false;

          const result = typeof sheet.actor.applyPeasantHeal === "function"
            ? await sheet.actor.applyPeasantHeal(amount, healType)
            : { ok: false, message: "Peasant Core healing workflow is not available for this actor." };

          if (!result.ok) {
            ui.notifications?.warn?.(result.message);
            return false;
          }

          return true;
        }
      }
    },
    default: "apply"
  }, trigger, {
    width: 320,
    height: 180,
    classes: ["pc-heal-dialog"]
  });
}
