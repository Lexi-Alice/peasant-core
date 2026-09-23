import { renderDialogV2 } from "../dialogs.mjs";

function describeResult(label, result = {}) {
  return `<div><strong>${label}</strong>: ${Number(result.hardnessApplied) || 0} Hardness, `
    + `${Number(result.shieldDamageApplied) || 0} shield damage, ${Number(result.armDamage) || 0} arm damage`
    + `${result.overkill ? " (Overkill)" : ""}</div>`;
}

export async function showShieldBracePrompt({
  actor = null,
  defense = {},
  damageAmount = 0,
  normalResult = {},
  bracedResult = {}
} = {}) {
  const content = `
    <div style="display:grid; gap:8px; color:#e0e0e0;">
      <div>Rolled damage: ${Math.max(0, Number(damageAmount) || 0)}</div>
      <div>Shield: ${Math.max(0, Number(defense.hp) || 0)} HP / ${Math.max(0, Number(defense.hardness) || 0)} Hardness</div>
      ${describeResult("Block Normally", normalResult)}
      ${describeResult("Brace", bracedResult)}
    </div>
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
      title: `Shield Block: ${actor?.name || "Defender"}`,
      content,
      buttons: {
        normal: { label: "Block Normally", callback: () => finalize("normal") },
        braced: { label: "Brace", callback: () => finalize("braced") },
        cancel: { label: "Cancel", callback: () => finalize("cancel") }
      },
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
