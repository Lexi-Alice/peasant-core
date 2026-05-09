export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[s]));
}

const MESSAGE_MODES = Object.freeze({
  roll: "public",
  public: "public",
  gmroll: "gm",
  gm: "gm",
  blindroll: "blind",
  blind: "blind",
  selfroll: "self",
  self: "self"
});

const LEGACY_ROLL_MODES = Object.freeze({
  public: "roll",
  roll: "roll",
  gm: "gmroll",
  gmroll: "gmroll",
  blind: "blindroll",
  blindroll: "blindroll",
  self: "selfroll",
  selfroll: "selfroll"
});

function normalizeMode(mode, mapping, fallback) {
  const key = String(mode ?? "").trim().toLowerCase();
  return mapping[key] || fallback;
}

function getCurrentMessageMode() {
  try {
    return normalizeMode(game?.settings?.get?.("core", "messageMode"), MESSAGE_MODES, "public");
  } catch (e) {
    return "public";
  }
}

function getCurrentLegacyRollMode() {
  try {
    return normalizeMode(game?.settings?.get?.("core", "rollMode"), LEGACY_ROLL_MODES, "roll");
  } catch (e) {
    return "roll";
  }
}

export function getCurrentRollMode() {
  if (typeof ChatMessage?.applyMode === "function") return getCurrentMessageMode();
  return getCurrentLegacyRollMode();
}

export function applyRollMode(chatData, rollMode) {
  if (typeof ChatMessage?.applyMode === "function") {
    const mode = normalizeMode(rollMode || getCurrentMessageMode(), MESSAGE_MODES, "public");
    return ChatMessage.applyMode(chatData, mode) || chatData;
  }

  const mode = normalizeMode(rollMode || getCurrentLegacyRollMode(), LEGACY_ROLL_MODES, "roll");
  if (typeof ChatMessage?.applyRollMode === "function") {
    ChatMessage.applyRollMode(chatData, mode);
  } else {
    switch (mode) {
      case "gmroll":
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
        break;
      case "blindroll":
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
        chatData.blind = true;
        break;
      case "selfroll":
        chatData.whisper = [game.user?.id].filter(Boolean);
        break;
      default:
        break;
    }
  }
  chatData.rollMode = mode;
  return chatData;
}
