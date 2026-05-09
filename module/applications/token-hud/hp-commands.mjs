import { parseHpValueCommand } from "../../data/actor/hp-commands.mjs";
import { getBarBrawlInputAttribute } from "../../integrations/bar-brawl.mjs";
import { pcLog } from "../../utils/logging.mjs";

const HP_COMMAND_HELP = "Use +# or -# (optional: L, B, C, H for damage; G for greater heal).";

function isHealthAttribute(attribute) {
  return String(attribute || "").split(".").pop() === "health";
}

function looksLikeHpCommand(raw) {
  return /^[+-]/.test(String(raw).trim()) || /[a-zA-Z]/.test(String(raw));
}

function getCoreInputAttribute(tokenDocument, inputName) {
  if (!inputName || !tokenDocument?.getBarAttribute) return "";
  return tokenDocument.getBarAttribute(inputName)?.attribute ?? "";
}

function getAttrPathForInput(token, input) {
  if (!input) return "";
  const tokenDoc = token?.document;
  const coreAttr = getCoreInputAttribute(tokenDoc, input.name);
  if (coreAttr) return coreAttr;

  const barBrawlAttr = getBarBrawlInputAttribute(tokenDoc, input.name);
  if (barBrawlAttr) return barBrawlAttr;

  return input.dataset?.attribute || input.dataset?.source || "";
}

function setHealthInputHint(input) {
  try {
    input.setAttribute("placeholder", "+5G / -3L");
    input.setAttribute("title", "HP command: -#(L/B/C/H) or +#(G)");
  } catch (e) { /* ignore */ }
}

async function applyHpValueCommandToActor(actor, raw) {
  if (!actor) return { ok: false, message: "Actor not found." };
  if (typeof actor.applyPeasantHpValueCommand !== "function") {
    return { ok: false, message: "Peasant Core HP command workflow is not available for this actor." };
  }
  return actor.applyPeasantHpValueCommand(raw);
}

function registerTokenHudPrototypeOverrides(tokenHudClass) {
  Hooks.once("ready", () => {
    try {
      const proto = tokenHudClass?.prototype;
      if (proto && !proto._peasantHpOverride) {
        const handlerNames = [
          "_onAttributeUpdate",
          "_onBarInput",
          "_onBarChange",
          "_onInputChange",
          "_onUpdateInput"
        ];

        for (const name of handlerNames) {
          const orig = proto[name];
          if (typeof orig !== "function") continue;

          proto[name] = async function (event) {
            try {
              const input = event?.currentTarget || event?.target;
              const raw = input?.value ?? "";
              const token = this?.object;
              const barKey = input?.name?.split(".")[0] || input?.dataset?.bar || "";
              const barAttr = token?.document?.[barKey]?.attribute || token?.[barKey]?.attribute || "";
              const attrPath = input?.dataset?.attribute || input?.dataset?.source || barAttr || "";

              if (isHealthAttribute(attrPath)) {
                const cmd = parseHpValueCommand(raw);

                if (cmd) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation();
                  if (token?.actor?.isOwner) {
                    const result = await applyHpValueCommandToActor(token.actor, raw);
                    if (!result.ok) ui.notifications?.warn?.(result.message);
                    const healthVal = token.actor.system.health?.value ?? result.value ?? "";
                    if (input) input.value = healthVal;
                  }
                  try { this.render(); } catch (e) { /* ignore */ }
                  return;
                }

                if (looksLikeHpCommand(raw)) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation();
                  const healthVal = token?.actor?.system?.health?.value ?? "";
                  if (input) input.value = healthVal;
                  return;
                }
              }
            } catch (e) {
              pcLog.debug("TokenHUD health override failed:", e);
            }

            return orig.call(this, event);
          };
        }
        proto._peasantHpOverride = true;
      }
    } catch (e) {
      pcLog.debug("Failed to override TokenHUD HP handler:", e);
    }

    try {
      const proto = tokenHudClass?.prototype;
      if (proto && !proto._peasantHpParseOverride && typeof proto._parseAttributeInput === "function") {
        const origParse = proto._parseAttributeInput;
        proto._parseAttributeInput = function (attribute, attr, value) {
          try {
            const raw = String(value ?? "").trim();
            const actor = this?.object?.actor;

            if (isHealthAttribute(attribute) && raw) {
              const isCommand = /^[+-]/.test(raw);
              const hasLetters = /[a-zA-Z]/.test(raw);

              if (isCommand) {
                const cmd = parseHpValueCommand(raw);
                if (cmd && actor?.isOwner) {
                  try { void applyHpValueCommandToActor(actor, raw); } catch (e) { /* ignore */ }
                } else if (hasLetters) {
                  ui.notifications?.warn?.(HP_COMMAND_HELP);
                }

                const current = actor?.system?.health?.value ?? attr?.value ?? 0;
                return { attribute, value: current, delta: 0, isDelta: false, isBar: true };
              }

              if (hasLetters) {
                ui.notifications?.warn?.(HP_COMMAND_HELP);
                const current = actor?.system?.health?.value ?? attr?.value ?? 0;
                return { attribute, value: current, delta: 0, isDelta: false, isBar: true };
              }
            }
          } catch (e) {
            pcLog.debug("TokenHUD _parseAttributeInput HP override failed:", e);
          }
          return origParse.call(this, attribute, attr, value);
        };
        proto._peasantHpParseOverride = true;
      }
    } catch (e) {
      pcLog.debug("Failed to override TokenHUD _parseAttributeInput:", e);
    }
  });
}

function registerTokenHudRenderHook() {
  Hooks.on("renderTokenHUD", (hud, html, data) => {
    try {
      const token = hud?.object;
      const actor = token?.actor;
      if (!actor || !actor.isOwner) return;

      const hudEl = html?.[0] || html;
      if (!hudEl) return;

      if (!hudEl.dataset.peasantHpHooked) {
        hudEl.dataset.peasantHpHooked = "1";

        hudEl.addEventListener("keydown", (ev) => {
          const input = ev.target;
          if (!input || input.tagName !== "INPUT") return;
          if (ev.key === "Enter") {
            ev.preventDefault();
            ev.currentTarget?.blur?.();
          }
        }, true);

        hudEl.addEventListener("change", async (ev) => {
          const input = ev.target;
          if (!input || input.tagName !== "INPUT") return;

          const attrPath = getAttrPathForInput(token, input);
          if (!isHealthAttribute(attrPath)) return;

          const raw = input.value;
          const cmd = parseHpValueCommand(raw);

          if (cmd) {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            const result = await applyHpValueCommandToActor(actor, raw);
            if (!result.ok) ui.notifications?.warn?.(result.message);
            const healthVal = actor.system.health?.value ?? result.value ?? "";
            input.value = healthVal;
            try { hud?.render(); } catch (e) { /* ignore */ }
            return;
          }

          if (looksLikeHpCommand(raw)) {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            ui.notifications?.warn?.(HP_COMMAND_HELP);
            const healthVal = actor.system.health?.value ?? "";
            input.value = healthVal;
          }
        }, true);
      }

      const inputs = hudEl.querySelectorAll(".attribute input");
      for (const input of inputs) {
        const attrPath = getAttrPathForInput(token, input);
        if (isHealthAttribute(attrPath)) setHealthInputHint(input);
      }
    } catch (e) { pcLog.debug("renderTokenHUD hp input hook failed", e); }
  });
}

export function registerTokenHudHpCommandHooks({ tokenHudClass } = {}) {
  registerTokenHudPrototypeOverrides(tokenHudClass);
  registerTokenHudRenderHook();
}
