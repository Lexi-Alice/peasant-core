import { qsa, qs, toElement } from "./dom.mjs";
import { configureRollUndoChatContext } from "./chat-undo.mjs";
import {
  configureEdgeChainRollChatContext,
  configureEdgeExplodeRollChatContext,
  configureEdgeIndividualDieRollChatContext,
  configureFallBlessingRollChatContext,
  configureStressRollChatContext
} from "./combat/edge-chain-rolls.mjs";
import { configureEdgeLocationRollChatContext } from "./combat/edge-location-rolls.mjs";
import { configureSkillEffectOfferChatContext } from "./combat/skill-entry-effects.mjs";

export function getChatMessageSpeakerImage(message) {
  const actorImage = String(message?.speakerActor?.img || "").trim();
  if (actorImage) return actorImage;

  const avatar = String(message?.author?.avatar || "").trim();
  return avatar && avatar !== globalThis.CONST?.DEFAULT_TOKEN ? avatar : "";
}

export function addChatMessageSpeakerImage(message, html) {
  const root = toElement(html);
  const sender = qs(root, ".message-header .message-sender");
  if (!sender) return null;

  const existing = qs(sender, ".pc-chat-speaker-image");
  if (existing) return existing;

  const src = getChatMessageSpeakerImage(message);
  if (!src) return null;

  const image = document.createElement("img");
  image.className = "pc-chat-speaker-image";
  image.src = src;
  image.alt = "";
  image.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const actor = message?.speakerActor;
    const subject = String(actor?.img || "").trim() ? actor : message?.author;
    const ImagePopout = globalThis.foundry?.applications?.apps?.ImagePopout;
    if (!ImagePopout) return;

    new ImagePopout({
      src,
      uuid: subject?.uuid,
      window: { title: subject?.name || "" }
    }).render({ force: true });
  });
  sender.classList.add("pc-chat-message-sender-with-image");
  sender.prepend(image);
  return image;
}

export function configureChatListeners() {
  configureStressRollChatContext();
  configureFallBlessingRollChatContext();
  configureEdgeChainRollChatContext();
  configureEdgeIndividualDieRollChatContext();
  configureEdgeExplodeRollChatContext();
  configureRollUndoChatContext();
  configureEdgeLocationRollChatContext();
  configureSkillEffectOfferChatContext();

  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = toElement(html);
    if (!root) return;
    addChatMessageSpeakerImage(message, root);

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
