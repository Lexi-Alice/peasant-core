import { renderDialogV2 } from "../dialogs.mjs";
import { qs, qsa, toElement } from "../dom.mjs";
import { escapeHtml, getCurrentMessageMode } from "../../utils/chat.mjs";
import { pcLog } from "../../utils/logging.mjs";
import {
  getTargetedDamageConditionKey,
  getTargetedDamageLocationDisplay,
  isArmorPenLocationLike,
  normalizeAppliedDamageType
} from "../../data/actor/targeted-damage.mjs";

export {
  getTargetedDamageConditionKey,
  getTargetedDamageLocationDisplay,
  isArmorPenLocationLike,
  normalizeAppliedDamageType
};

const LOCATION_BY_SKILL_OPTIONS = Object.freeze([
  { key: "table", label: "Table", mode: "table" },
  { key: "torso", label: "Torso", location: "Torso", isAP: false, rawText: "Torso" },
  { key: "rightArm", label: "Right Arm", location: "RightArm", isAP: false, rawText: "Right Arm" },
  { key: "leftArm", label: "Left Arm", location: "LeftArm", isAP: false, rawText: "Left Arm" },
  { key: "rightLeg", label: "Right Leg", location: "RightLeg", isAP: false, rawText: "Right Leg" },
  { key: "leftLeg", label: "Left Leg", location: "LeftLeg", isAP: false, rawText: "Left Leg" },
  { key: "apTorso", label: "Armor Pen Torso", location: "Torso", isAP: true, rawText: "Armor Pen Torso" },
  { key: "apRightArm", label: "Armor Pen Right Arm", location: "RightArm", isAP: true, rawText: "Armor Pen Right Arm" },
  { key: "apLeftArm", label: "Armor Pen Left Arm", location: "LeftArm", isAP: true, rawText: "Armor Pen Left Arm" },
  { key: "apRightLeg", label: "Armor Pen Right Leg", location: "RightLeg", isAP: true, rawText: "Armor Pen Right Leg" },
  { key: "apLeftLeg", label: "Armor Pen Left Leg", location: "LeftLeg", isAP: true, rawText: "Armor Pen Left Leg" },
  { key: "head", label: "Head", location: "Head", isAP: false, rawText: "Head" },
  { key: "headPen", label: "Armor Pen Head", location: "Head", isAP: true, rawText: "Armor Pen Head" }
]);

const LOCATION_BY_SKILL_OPTION_MAP = Object.freeze(
  LOCATION_BY_SKILL_OPTIONS.reduce((map, option) => {
    map[option.key] = option;
    return map;
  }, {})
);

const LOCATION_TABLE_ARMOR_PEN_RESULTS = Object.freeze([
  "Armor Pen Torso",
  "Armor Pen Left Arm",
  "Armor Pen Right Arm",
  "Armor Pen Left Leg",
  "Armor Pen Right Leg",
  "Armor Pen Head"
]);

const LOCATION_RESULT_TEXT_ALIASES = Object.freeze({
  "head pen": ["head pen", "armor pen head"],
  "armor pen head": ["armor pen head", "head pen"]
});

function normalizeMagnetismGrade(rawGrade) {
  const grade = Number.parseInt(rawGrade, 10);
  return Number.isFinite(grade) ? Math.max(0, grade) : 0;
}

export function getLocationBySkillOptions(maxMoS, { magnetismGrade = 0 } = {}) {
  const mos = Number(maxMoS) || 0;
  const grade = normalizeMagnetismGrade(magnetismGrade);
  const thresholdBump = Math.max(0, grade - 1);
  if (mos < 1) return grade > 0 ? [] : [LOCATION_BY_SKILL_OPTION_MAP.table];

  const orderedKeys = [];
  if (mos >= 5 + thresholdBump) orderedKeys.push("headPen");
  if (mos >= 4 + thresholdBump) orderedKeys.push("head");
  if (mos >= 3 + thresholdBump) orderedKeys.push("apTorso", "apRightArm", "apLeftArm", "apRightLeg", "apLeftLeg");
  if (mos >= 2 + thresholdBump) orderedKeys.push("rightArm", "leftArm", "rightLeg", "leftLeg");
  if (mos >= 1 + thresholdBump) orderedKeys.push("torso");
  if (grade <= 0) orderedKeys.push("table");

  return orderedKeys
    .map((key) => LOCATION_BY_SKILL_OPTION_MAP[key])
    .filter(Boolean);
}

export function createLocationRollFromSkillOption(option) {
  if (!option || option.mode === "table" || !option.location) return null;
  return {
    rawText: String(option.rawText || option.label || getTargetedDamageLocationDisplay(option.location)).trim() || getTargetedDamageLocationDisplay(option.location),
    location: option.location,
    locationDisplay: getTargetedDamageLocationDisplay(option.location),
    isAP: !!option.isAP,
    bySkill: true
  };
}

export async function showLocationBySkillPrompt({
  maxMoS = 0,
  attackerName = "Attacker",
  targetLabel = "",
  magnetismGrade = 0
} = {}) {
  const options = getLocationBySkillOptions(maxMoS, { magnetismGrade });
  if (!options.length) return { option: null, selection: "magnetism" };

  const tableOption = options.find((option) => option.mode === "table") || null;
  const optionsHtml = options.map((option) => (
    `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`
  )).join("");
  const targetNote = targetLabel ? `<div style="color:#b0b0b0; margin-bottom:10px;">Target: ${escapeHtml(targetLabel)}</div>` : "";
  const content = `
    <form class="pc-location-by-skill-form">
      ${targetNote}
      <div class="form-group" style="margin-bottom: 10px;">
        <label style="display:block; margin-bottom:5px; color:#b0b0b0;">Select Location:</label>
        <select class="pc-defense-prompt-select pc-select pc-dialog-field-full" name="locationBySkillChoice">
          ${optionsHtml}
        </select>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;

    const fallbackSelection = tableOption ? "table" : "magnetism";
    const finalize = (result = { option: tableOption, selection: fallbackSelection, cancelled: true, chainCancelled: false }) => {
      if (settled) return result;
      settled = true;
      if (closeWatcher) {
        clearInterval(closeWatcher);
        closeWatcher = null;
      }
      resolve(result);
      return result;
    };

    renderDialogV2({
      title: "Location by Skill",
      content,
      buttons: {
        select: {
          label: "Select",
          callback: async (html) => {
            const selectedKey = String(qs(html, '[name="locationBySkillChoice"]')?.value || "").trim();
            const option = options.find((entry) => entry.key === selectedKey) || tableOption;
            finalize({
              option,
              selection: option?.mode === "table" ? "table" : "location",
              cancelled: false
            });
            return true;
          }
        }
      },
      default: "select",
      render: (html) => {
        const dialogElement = toElement(html);
        if (!dialogElement) return;
        const viewportWidth = Number(window?.innerWidth) || 480;
        const stableDialogWidth = Math.max(340, Math.min(400, viewportWidth - 32));
        dialogElement.style.width = `${stableDialogWidth}px`;
        dialogElement.style.minWidth = `${stableDialogWidth}px`;
        dialogElement.style.maxWidth = `${Math.max(320, viewportWidth - 32)}px`;
        for (const contentEl of qsa(dialogElement, ".window-content, .dialog-content")) {
          contentEl.style.overflowX = "hidden";
        }

        renderedWindow = dialogElement.closest(".application, dialog") || dialogElement;
        for (const closeButton of qsa(renderedWindow, '.header-control, [data-action="close"], [data-button="close"]')) {
          closeButton.addEventListener("click", () => {
            finalize({ option: tableOption, selection: "close", cancelled: true, chainCancelled: true });
          });
        }

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) {
              finalize({ option: tableOption, selection: "close", cancelled: true, chainCancelled: true });
            }
          }, 150);
        }
      }
    }, { classes: ["pc-location-by-skill-dialog", "peasant-macro-dialog-force"] });
  });
}

export function getLocationRollTable() {
  const names = ["Location", "Location Table"];
  for (const name of names) {
    const table = game.tables?.getName?.(name);
    if (table) return table;
  }
  return null;
}

function getTableResultLabel(result) {
  return String(result?.name || result?.description || result?._source?.name || result?._source?.description || result?._source?.text || "").trim();
}

export function normalizeLocationResultText(rawText) {
  const text = String(rawText || "").trim();
  const normalized = text.toLowerCase();
  const isAP = normalized.includes("armor pen") || normalized.includes("head pen");
  let location = "Torso";

  if (normalized.includes("head")) location = "Head";
  else if (normalized.includes("right arm")) location = "RightArm";
  else if (normalized.includes("left arm")) location = "LeftArm";
  else if (normalized.includes("right leg")) location = "RightLeg";
  else if (normalized.includes("left leg")) location = "LeftLeg";
  else if (normalized.includes("torso")) location = "Torso";

  return {
    rawText: text || getTargetedDamageLocationDisplay(location),
    location,
    locationDisplay: getTargetedDamageLocationDisplay(location),
    isAP
  };
}

export function registerLocationArmorPenChatHook() {
  try {
    return Hooks.once("createChatMessage", (message) => {
      try {
        highlightArmorPenLocationResultInChatMessage(message);
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to highlight armor pen location result", e);
      }
    });
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to register location-table chat styling hook", e);
    return null;
  }
}

export async function createChosenLocationTableMessage(locationRoll) {
  if (!locationRoll?.rawText) return null;

  const table = getLocationRollTable();
  if (!table) return null;

  const normalizedTarget = String(locationRoll.rawText || "").trim().toLowerCase();
  const candidateTargets = LOCATION_RESULT_TEXT_ALIASES[normalizedTarget] || [normalizedTarget];
  const result = Array.from(table.results || []).find((entry) => {
    const candidate = getTableResultLabel(entry).toLowerCase();
    return candidateTargets.includes(candidate);
  });
  if (!result) return null;

  let hookId = registerLocationArmorPenChatHook();
  try {
    return await table.toMessage([result], {
      messageData: {
        flavor: `Chooses a result from the ${foundry.utils.escapeHTML(table.name)} table`,
        speaker: ChatMessage.getSpeaker()
      },
      messageOptions: {
        messageMode: getCurrentMessageMode()
      }
    });
  } catch (e) {
    if (hookId !== null) {
      try { Hooks.off("createChatMessage", hookId); } catch (_) {}
    }
    console.warn("Peasant Core | Failed to create chosen location table message", e);
    return null;
  }
}

export function highlightArmorPenLocationResultInChatMessage(message) {
  const content = String(message?.content || "");
  if (!content) return false;

  let modifiedContent = content;
  let hasArmorPen = false;

  for (const location of LOCATION_TABLE_ARMOR_PEN_RESULTS) {
    if (!content.includes(location)) continue;
    hasArmorPen = true;
    const regex = new RegExp(`(>${location}<)`, "g");
    modifiedContent = modifiedContent.replace(regex, ` style="color: #dc2626; font-weight: bold;"$1`);
  }

  if (!hasArmorPen || modifiedContent === content) return false;
  void message.update({ content: modifiedContent });
  return true;
}

export async function drawLocationTableLikeMacro({ messageMode = null, rollMode = null } = {}) {
  const table = getLocationRollTable();
  if (!table) {
    ui.notifications?.warn?.("Location table not found. Expected a rollable table named 'Location' or 'Location Table'.");
    return null;
  }

  let hookId = registerLocationArmorPenChatHook();

  try {
    const draw = await table.draw({ displayChat: false });
    const firstResult = Array.isArray(draw?.results) ? draw.results[0] : null;
    const rawText = getTableResultLabel(firstResult);
    if (!rawText) {
      ui.notifications?.warn?.("Could not resolve a hit location from the location table.");
      return null;
    }
    await table.toMessage(draw.results, {
      roll: draw.roll,
      messageOptions: {
        messageMode: messageMode || rollMode || getCurrentMessageMode()
      }
    });
    return {
      ...normalizeLocationResultText(rawText),
      roll: draw?.roll || null,
      draw
    };
  } catch (e) {
    if (hookId !== null) {
      try { Hooks.off("createChatMessage", hookId); } catch (_) {}
    }
    console.warn("Peasant Core | Failed to draw location table", e);
    ui.notifications?.warn?.("Could not roll from the location table.");
    return null;
  }
}

export async function rollAutomatedAttackLocation({ actor, attackerToken = null, combatName = "", targetLabel = "" } = {}) {
  return await drawLocationTableLikeMacro({ messageMode: getCurrentMessageMode() });
}
