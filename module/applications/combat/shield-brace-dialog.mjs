import { renderDialogV2 } from "../dialogs.mjs";

export async function showShieldBracePrompt({
  attackCombatName = "Attack",
  defense = {}
} = {}) {
  const content = `
    <div>Shield: ${Math.max(0, Number(defense.hp) || 0)} HP / ${Math.max(0, Number(defense.hardness) || 0)} Hardness</div>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;

    const finalize = (action) => {
      if (settled) return action;
      settled = true;
      if (closeWatcher) {
        clearInterval(closeWatcher);
        closeWatcher = null;
      }
      resolve(action);
      return action;
    };

    renderDialogV2({
      title: `Shield Block vs ${String(attackCombatName || "Attack").trim() || "Attack"}`,
      content,
      buttons: {
        normal: { label: "Block Normally", icon: "fa-solid fa-shield-halved", callback: () => finalize("normal") },
        braced: { label: "Brace", icon: "fa-solid fa-shield", callback: () => finalize("braced") }
      },
      position: { width: 320, height: "auto" },
      default: "normal",
      render: (html) => {
        renderedWindow = html.closest(".application, dialog")[0] || html[0];
        $(renderedWindow)
          .find('.header-control, [data-action="close"], [data-button="close"]')
          .off(".pcShieldBraceClose")
          .on("click.pcShieldBraceClose", () => finalize("cancel"));

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (!settled && renderedWindow && !renderedWindow.isConnected) finalize("cancel");
          }, 150);
        }
      }
    }, { classes: ["pc-shield-brace-dialog", "peasant-macro-dialog-force"] });
  });
}
