export function configureChatListeners() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const $html = $(html);
    const mosButtons = $html.find(".mos-toggle");

    mosButtons.on("click", function(event) {
      event.preventDefault();
      event.stopPropagation();

      const rollId = $(this).attr("data-roll-id");
      const messageContainer = $(this).closest(".skill-roll-card");
      const details = messageContainer.find(`.roll-details[data-roll-id="${rollId}"]`);

      if (details.length > 0) {
        details.css("display", details.css("display") === "none" ? "block" : "none");
      }
    });
  });
}
