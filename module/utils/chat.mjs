export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[s]));
}

export function renderChatCardImage(imageSrc) {
  const src = String(imageSrc || "").trim();
  return src ? `<img class="pc-chat-card-image" src="${escapeHtml(src)}" alt="">` : "";
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

function normalizeMessageMode(mode, fallback = "public") {
  const key = String(mode ?? "").trim().toLowerCase();
  return MESSAGE_MODES[key] || fallback;
}

export function getCurrentMessageMode() {
  try {
    return normalizeMessageMode(game.settings.get("core", "messageMode"));
  } catch (e) {
    return "public";
  }
}

export function getCurrentRollMode() {
  return getCurrentMessageMode();
}

export function applyMessageMode(chatData, mode) {
  const messageMode = normalizeMessageMode(mode || getCurrentMessageMode());
  return ChatMessage.applyMode(chatData, messageMode) || chatData;
}

export function applyRollMode(chatData, rollMode) {
  return applyMessageMode(chatData, rollMode);
}
