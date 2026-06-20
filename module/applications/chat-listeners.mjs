import { qsa, qs, toElement } from "./dom.mjs";
import { configureRollUndoChatContext } from "./chat-undo.mjs";
import { configureEdgeChainRollChatContext, configureEdgeExplodeRollChatContext } from "./combat/edge-chain-rolls.mjs";
import { configureEdgeLocationRollChatContext } from "./combat/edge-location-rolls.mjs";

export function configureChatListeners() {
  configureEdgeChainRollChatContext();
  configureEdgeExplodeRollChatContext();
  configureRollUndoChatContext();
  configureEdgeLocationRollChatContext();

  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = toElement(html);
    if (!root) return;

    for (const button of qsa(root, ".mos-toggle")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const rollId = button.dataset.rollId;
        const messageContainer = button.closest(".skill-roll-card");
        const details = qs(messageContainer, `.roll-details[data-roll-id="${rollId}"]`);

        if (details) {
          details.style.display = details.style.display === "none" ? "block" : "none";
        }
      });
    }
  });
}
