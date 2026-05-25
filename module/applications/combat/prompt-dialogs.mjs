import { normalizeAppliedDamageType } from "../../data/actor/targeted-damage.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { renderDialogV2 } from "../dialogs.mjs";

function showWaitingForDefenderResponseDialog() {
  let dialogApp = null;
  let dotInterval = null;
  let abortResolved = false;
  let closedProgrammatically = false;
  let abortResolve = null;

  const abortPromise = new Promise((resolve) => {
    abortResolve = resolve;
  });

  const resolveAbort = () => {
    if (abortResolved) return;
    abortResolved = true;
    abortResolve?.({ chainCancelled: true, selection: "close" });
  };

  const content = `
    <div class="pc-waiting-dialog-body">
    </div>
  `;

  dialogApp = renderDialogV2({
    title: "Waiting for Defender Response",
    content,
    buttons: {
      wait: {
        label: "Waiting",
        callback: async () => true
      }
    },
    default: "wait",
    render: (html) => {
      const viewportWidth = Number(window?.innerWidth) || 480;
      const stableDialogWidth = Math.max(320, Math.min(380, viewportWidth - 32));
      html.css({
        width: `${stableDialogWidth}px`,
        minWidth: `${stableDialogWidth}px`,
        maxWidth: `${Math.max(300, viewportWidth - 32)}px`
      });
      html.find(".window-content, .dialog-content, form, .standard-form").css({ overflow: "hidden" });
      html.find(".dialog-buttons, .form-footer, footer").hide();
      const renderedWindow = html.closest(".application, dialog")[0] || html[0];
      $(renderedWindow)
        .find('.header-control, [data-action="close"], [data-button="close"]')
        .off(".pcWaitingClose")
        .on("click.pcWaitingClose", () => {
          if (!closedProgrammatically) resolveAbort();
        });
      const bodyEl = html.find(".pc-waiting-dialog-body")[0];
      if (bodyEl) {
        bodyEl.replaceChildren();
        const dotsEl = document.createElement("div");
        dotsEl.className = "pc-waiting-dialog-dots";
        dotsEl.setAttribute("aria-hidden", "true");
        for (let i = 0; i < 3; i += 1) {
          const dot = document.createElement("span");
          dot.textContent = "\u25CF";
          dot.style.display = "inline-block";
          dot.style.minWidth = "12px";
          dot.style.lineHeight = "1";
          dot.style.fontSize = "22px";
          dot.style.fontWeight = "700";
          dot.style.color = "var(--button-hover-border-color, #c9b183)";
          dot.style.textShadow = "0 0 8px rgba(201, 177, 131, 0.25)";
          dot.style.opacity = "0.4";
          dot.style.transform = "translateY(0)";
          dot.style.transition = "transform 140ms ease, opacity 140ms ease";
          dotsEl.appendChild(dot);
        }
        bodyEl.appendChild(dotsEl);
      }

      const dots = Array.from(html.find(".pc-waiting-dialog-dots span"));
      if (dotInterval) {
        clearInterval(dotInterval);
        dotInterval = null;
      }
      if (dots.length) {
        let activeIndex = 0;
        const paintDots = () => {
          dots.forEach((dot, index) => {
            const isActive = index === activeIndex;
            dot.style.transform = isActive ? "translateY(-7px)" : "translateY(0)";
            dot.style.opacity = isActive ? "1" : "0.4";
          });
        };
        paintDots();
        dotInterval = window.setInterval(() => {
          activeIndex = (activeIndex + 1) % dots.length;
          paintDots();
        }, 220);
      }
    }
  }, { classes: ["pc-waiting-dialog", "peasant-macro-dialog-force"] });

  return {
    abortPromise,
    close: async () => {
      closedProgrammatically = true;
      if (dotInterval) {
        clearInterval(dotInterval);
        dotInterval = null;
      }
      try {
        await dialogApp?.close?.();
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to close waiting dialog", e);
      }
    }
  };
}

export async function showFlexibleDamageTypePrompt({
  combatName = "Attack"
} = {}) {
  const content = `
    <form class="pc-flexible-damage-type-form">
      <div class="form-group" style="margin-bottom: 10px;">
        <label style="display:block; margin-bottom:5px; color:#b0b0b0;">Damage Type:</label>
        <select class="pc-defense-prompt-select pc-select pc-dialog-field-full" name="flexibleDamageType">
          <option value="blunt">Blunt</option>
          <option value="lethal">Lethal</option>
        </select>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;

    const finalize = (result = {}) => {
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
      title: `Choose Damage Type: ${combatName}`,
      content,
      buttons: {
        select: {
          label: "Select",
          callback: async (html) => {
            const selectedType = String(html.find('[name="flexibleDamageType"]').val() || "blunt").trim().toLowerCase();
            finalize({
              selected: true,
              damageType: normalizeAppliedDamageType(selectedType, "blunt"),
              chainCancelled: false
            });
            return true;
          }
        },
        cancel: {
          label: "Cancel",
          callback: async () => {
            finalize({
              selected: false,
              damageType: null,
              chainCancelled: true
            });
            return true;
          }
        }
      },
      default: "select",
      render: (html) => {
        const viewportWidth = Number(window?.innerWidth) || 480;
        const stableDialogWidth = Math.max(340, Math.min(400, viewportWidth - 32));
        html.css({
          width: `${stableDialogWidth}px`,
          minWidth: `${stableDialogWidth}px`,
          maxWidth: `${Math.max(320, viewportWidth - 32)}px`
        });
        html.find(".window-content, .dialog-content").css({ overflowX: "hidden" });

        renderedWindow = html.closest(".application, dialog")[0] || html[0];
        $(renderedWindow)
          .find('.header-control, [data-action="close"], [data-button="close"]')
          .off(".pcFlexibleDamageClose")
          .on("click.pcFlexibleDamageClose", () => finalize({
            selected: false,
            damageType: null,
            chainCancelled: true
          }));

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) {
              finalize({
                selected: false,
                damageType: null,
                chainCancelled: true
              });
            }
          }, 150);
        }
      }
    }, { classes: ["pc-flexible-damage-dialog", "peasant-macro-dialog-force"] });
  });
}

export async function showForcePassPromptDialog({
  actor = null,
  rollLabel = "Skill Roll",
  stressCost = 0
} = {}) {
  if (!actor || stressCost <= 0) return { forced: false, selection: "no", spendType: "general" };

  const content = `
    <form class="pc-force-pass-form">
      <div class="form-group" style="margin-bottom: 10px;">
        <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; color:#b0b0b0;">
          <span>Spend ${stressCost} stress to force pass?</span>
          <select class="pc-defense-prompt-select pc-select pc-dialog-field-md" name="forcePassStressType">
            <option value="physical">Physical Stress</option>
            <option value="mental">Mental Stress</option>
            <option value="general">General Stress</option>
          </select>
        </label>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;

    const finalize = (result = { forced: false, selection: "no", spendType: "general", chainCancelled: false }) => {
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
      title: rollLabel,
      content,
      buttons: {
        yes: {
          label: "Yes",
          callback: async (html) => {
            const spendType = String(html.find('[name="forcePassStressType"]').val() || "general").trim().toLowerCase();
            finalize({ forced: true, selection: "yes", spendType });
            return true;
          }
        },
        no: {
          label: "No",
          callback: async () => {
            finalize({ forced: false, selection: "no", spendType: "general" });
            return true;
          }
        }
      },
      default: "yes",
      render: (html) => {
        const viewportWidth = Number(window?.innerWidth) || 480;
        const stableDialogWidth = Math.max(380, Math.min(430, viewportWidth - 32));
        html.css({
          width: `${stableDialogWidth}px`,
          minWidth: `${stableDialogWidth}px`,
          maxWidth: `${Math.max(340, viewportWidth - 32)}px`
        });
        html.find(".window-content, .dialog-content").css({ overflowX: "hidden" });

        renderedWindow = html.closest(".application, dialog")[0] || html[0];
        $(renderedWindow)
          .find('.header-control, [data-action="close"], [data-button="close"]')
          .off(".pcForcePassClose")
          .on("click.pcForcePassClose", () => finalize({ forced: false, selection: "close", spendType: "general", chainCancelled: true }));

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) {
              finalize({ forced: false, selection: "close", spendType: "general", chainCancelled: true });
            }
          }, 150);
        }
      }
    }, { classes: ["pc-force-pass-dialog", "peasant-macro-dialog-force"] });
  });
}

export async function withWaitingForDefenderResponse(promiseFactory, { enabled = true, onAbort = null } = {}) {
  let waitingDialog = null;
  try {
    const remotePromise = Promise.resolve().then(() => promiseFactory());
    if (!enabled) return await remotePromise;

    waitingDialog = showWaitingForDefenderResponseDialog();
    const raced = await Promise.race([
      remotePromise.then((value) => ({ kind: "result", value }), (error) => ({ kind: "error", error })),
      waitingDialog.abortPromise.then((value) => ({ kind: "abort", value }))
    ]);

    if (raced.kind === "error") throw raced.error;
    if (raced.kind === "abort" && typeof onAbort === "function") {
      try {
        await onAbort();
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to cancel remote prompt after local abort", e);
      }
    }
    return raced.value;
  } finally {
    await waitingDialog?.close?.();
  }
}

export function isChainCancelledResult(result) {
  return !!result?.chainCancelled;
}
