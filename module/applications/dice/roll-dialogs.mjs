import { performSkillRoll, performUntrainedSkillRoll, performSavingRoll } from "../../dice/rolls.mjs";
import { renderDialogCompat } from "../dialogs.mjs";

function styleMacroDialog(html) {
  html.closest(".app.dialog, .window-app, .application").addClass("peasant-macro-dialog-force");
  html.find('input[type="number"], input[type="text"]').addClass("pc-macro-input").each((_, el) => {
    el.style.setProperty("background", "var(--color-cool-4, #302831)", "important");
    el.style.setProperty("color", "var(--input-text-color, #e0e0e0)", "important");
    el.style.setProperty("border", "1px solid var(--color-cool-4, #302831)", "important");
    el.style.setProperty("border-radius", "3px", "important");
    el.style.setProperty("box-shadow", "none", "important");
    el.style.setProperty("outline", "none", "important");
  });
}

function clickDefaultButton(html) {
  html.closest(".dialog").find('button.default, button[data-button="roll"]').click();
}

function focusAndSelect(input) {
  if (!input) return;
  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
}

function bindToHitAccuracyNavigation(html) {
  const inputs = html.find('input[type="number"]');
  const toHitInput = html.find("#to-hit")[0];
  const accuracyInput = html.find("#accuracy")[0];
  focusAndSelect(toHitInput);

  inputs.on("keydown", (event) => {
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

function bindSingleNumberSubmit(html, selector) {
  const input = html.find(selector)[0];
  focusAndSelect(input);
  html.find(selector).on("keydown", (event) => {
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

  return renderDialogCompat({
    title,
    content: `
      <div class="skill-roll-dialog" style="display: flex; gap: 10px;">
        <div style="flex: 1;">
          <label>To-Hit:</label>
          <input type="number" class="pc-macro-input" id="to-hit" name="to-hit" value="${lastToHit}" min="1" max="20" style="width: 100%;" data-nav-order="0" autofocus />
        </div>
        <div style="flex: 1;">
          <label>Accuracy:</label>
          <input type="number" class="pc-macro-input" id="accuracy" name="accuracy" value="${lastAccuracy}" style="width: 100%;" data-nav-order="1" />
        </div>
      </div>
    `,
    buttons: {
      roll: {
        icon: '<i class="fas fa-dice"></i>',
        label: "Roll",
        callback: async (html) => {
          const toHit = parseInt(html.find("#to-hit").val()) || 7;
          const accuracy = parseInt(html.find("#accuracy").val()) || 0;

          await game.user.setFlag("peasant-core", toHitFlag, toHit);
          await game.user.setFlag("peasant-core", accuracyFlag, accuracy);
          await rollFn({ toHit, accuracy, skillName, speaker: ChatMessage.getSpeaker() });
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel",
        cssClass: "cancel-button-red"
      }
    },
    default: "roll",
    render: (html) => {
      styleMacroDialog(html);
      bindToHitAccuracyNavigation(html);
    }
  }, { classes: ["peasant-macro-dialog"] });
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

  return renderDialogCompat({
    title: "Saving Roll",
    content: `
      <div class="saving-roll-dialog">
        <div>
          <label>To-Hit:</label>
          <input type="number" class="pc-macro-input" id="to-hit" name="to-hit" value="${lastToHit}" min="1" max="20" style="width: 100%;" />
        </div>
      </div>
    `,
    buttons: {
      roll: {
        icon: '<i class="fas fa-dice"></i>',
        label: "Roll",
        callback: async (html) => {
          const toHit = parseInt(html.find("#to-hit").val()) || 7;
          await game.user.setFlag("peasant-core", "lastSavingToHit", toHit);
          await performSavingRoll({ toHit, skillName: "Saving Roll", speaker: ChatMessage.getSpeaker() });
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel",
        cssClass: "cancel-button-red"
      }
    },
    default: "roll",
    render: (html) => {
      styleMacroDialog(html);
      bindSingleNumberSubmit(html, "#to-hit");
    }
  }, { classes: ["peasant-macro-dialog"] });
}
