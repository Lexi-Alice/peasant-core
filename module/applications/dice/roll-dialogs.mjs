import { performSkillRoll, performUntrainedSkillRoll, performSavingRoll } from "../../dice/rolls.mjs";
import { qsa, qs, readNumberInput, toElement } from "../dom.mjs";
import { renderDialogV2 } from "../dialogs.mjs";

function clickDefaultButton(root) {
  const element = toElement(root);
  const dialog = element?.closest?.(".dialog, .application") ?? element;
  qs(dialog, 'button.default, button[data-button="roll"], button[data-action="roll"]')?.click();
}

function focusAndSelect(input) {
  if (!input) return;
  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
}

function bindToHitAccuracyNavigation(html) {
  const inputs = qsa(html, 'input[type="number"]');
  const toHitInput = qs(html, "#to-hit");
  const accuracyInput = qs(html, "#accuracy");
  focusAndSelect(toHitInput);

  for (const input of inputs) {
    input.addEventListener("keydown", (event) => {
      const currentInput = event.target;
      const key = event.key;

      if (key === "Enter") {
        event.preventDefault();
        clickDefaultButton(html);
        return;
      }

      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;
      if (key === "ArrowUp" || key === "ArrowDown") event.preventDefault();

      if (currentInput === toHitInput && (key === "ArrowRight" || key === "ArrowDown")) {
        event.preventDefault();
        accuracyInput?.focus();
        accuracyInput?.select();
      } else if (currentInput === accuracyInput && (key === "ArrowLeft" || key === "ArrowUp")) {
        event.preventDefault();
        toHitInput?.focus();
        toHitInput?.select();
      }
    });
  }
}

function bindSingleNumberSubmit(html, selector) {
  const input = qs(html, selector);
  focusAndSelect(input);
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    clickDefaultButton(html);
  });
}

async function promptToHitAccuracyRoll({
  title,
  toHitFlag,
  accuracyFlag,
  rollFn,
  skillName
}) {
  const lastToHit = game.user.getFlag("peasant-core", toHitFlag) || 7;
  const lastAccuracy = game.user.getFlag("peasant-core", accuracyFlag) || 0;

  return renderDialogV2({
    title,
    content: `
      <div class="skill-roll-dialog" style="display: flex; gap: 10px;">
        <div style="flex: 1;">
          <label>To-Hit:</label>
          <input type="number" class="pc-macro-input pc-input pc-dialog-field-full" id="to-hit" name="to-hit" value="${lastToHit}" min="1" max="20" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*" data-nav-order="0" autofocus />
        </div>
        <div style="flex: 1;">
          <label>Accuracy:</label>
          <input type="number" class="pc-macro-input pc-input pc-dialog-field-full" id="accuracy" name="accuracy" value="${lastAccuracy}" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*" data-nav-order="1" />
        </div>
      </div>
    `,
    buttons: {
      roll: {
        icon: '<i class="fas fa-dice"></i>',
        label: "Roll",
        callback: async (html) => {
          const toHit = readNumberInput(html, "#to-hit", 7);
          const accuracy = readNumberInput(html, "#accuracy", 0);

          await game.user.setFlag("peasant-core", toHitFlag, toHit);
          await game.user.setFlag("peasant-core", accuracyFlag, accuracy);
          await rollFn({ toHit, accuracy, skillName, speaker: ChatMessage.getSpeaker() });
        }
      }
    },
    default: "roll",
    render: (html) => {
      bindToHitAccuracyNavigation(html);
    }
  }, { classes: ["peasant-macro-dialog", "peasant-macro-dialog-force"] });
}

export async function promptSkillRoll() {
  return promptToHitAccuracyRoll({
    title: "Skill Roll",
    toHitFlag: "lastSkillToHit",
    accuracyFlag: "lastSkillAccuracy",
    rollFn: performSkillRoll,
    skillName: "Skill Roll"
  });
}

export async function promptUntrainedSkillRoll() {
  return promptToHitAccuracyRoll({
    title: "Untrained Skill Roll",
    toHitFlag: "lastUntrainedToHit",
    accuracyFlag: "lastUntrainedAccuracy",
    rollFn: performUntrainedSkillRoll,
    skillName: "Untrained Skill Roll"
  });
}

export async function promptSavingRoll() {
  const lastToHit = game.user.getFlag("peasant-core", "lastSavingToHit") || 7;

  return renderDialogV2({
    title: "Saving Roll",
    content: `
      <div class="saving-roll-dialog">
        <div>
          <label>To-Hit:</label>
          <input type="number" class="pc-macro-input pc-input pc-dialog-field-full" id="to-hit" name="to-hit" value="${lastToHit}" min="1" max="20" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*" />
        </div>
      </div>
    `,
    buttons: {
      roll: {
        icon: '<i class="fas fa-dice"></i>',
        label: "Roll",
        callback: async (html) => {
          const toHit = readNumberInput(html, "#to-hit", 7);
          await game.user.setFlag("peasant-core", "lastSavingToHit", toHit);
          await performSavingRoll({ toHit, skillName: "Saving Roll", speaker: ChatMessage.getSpeaker() });
        }
      }
    },
    default: "roll",
    render: (html) => {
      bindSingleNumberSubmit(html, "#to-hit");
    }
  }, { classes: ["peasant-macro-dialog", "peasant-macro-dialog-force"] });
}
