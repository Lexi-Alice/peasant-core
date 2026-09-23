import { collectPeasantActiveEffectKeys, PeasantActiveEffectKeyBrowser } from "./active-effect-key-browser.mjs";
import { getPeasantActiveEffectKeyMetadata } from "../../data/active-effect/key-policy.mjs";

const ActiveEffectConfigBase = foundry?.applications?.sheets?.ActiveEffectConfig;
if (!ActiveEffectConfigBase) {
  throw new Error("Peasant Core requires Foundry's ActiveEffectConfig.");
}

const RENDER_CHANGE_PATCH_KEY = Symbol.for("peasant-core.active-effect-config.render-change-patch");
const KEY_BROWSER_BY_APP = new WeakMap();

function getApplicationElement(appOrElement) {
  const source = appOrElement?.element ?? appOrElement;
  if (!source) return null;
  if (source.nodeType === 1 && typeof source.querySelector === "function") return source;
  if (typeof jQuery !== "undefined" && source instanceof jQuery) return source[0] ?? null;
  if (Array.isArray(source)) return getApplicationElement(source[0]);
  const first = source?.[0];
  return first?.nodeType === 1 && typeof first.querySelector === "function" ? first : null;
}

function isDaeActiveEffectConfig(app, element = getApplicationElement(app)) {
  return app?.constructor?.name === "DAEActiveEffectConfig"
    || element?.classList?.contains("dae")
    || String(element?.id ?? "").startsWith("DAEActiveEffectConfig");
}

function updateKeyMetadataHint(input) {
  if (!input) return;
  const metadata = getPeasantActiveEffectKeyMetadata(input.value);
  for (const category of ["dynamic", "state", "unsupported"]) {
    input.classList.toggle(`pc-ae-key-input-${category}`, metadata.category === category);
  }
  input.title = metadata.title;
}

function markPeasantKeyInput(input) {
  if (!input) return;
  input.classList.add("pc-ae-key-input");
  input.autocomplete = "off";
  input.spellcheck = false;
  updateKeyMetadataHint(input);
}

function markChangeKeyInput(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html ?? "").trim();
  const changeElement = template.content.firstElementChild;
  if (!changeElement) return html;

  const keyInput = changeElement.querySelector("div.key input, .key input, input[name$='.key']");
  markPeasantKeyInput(keyInput);
  return changeElement.outerHTML;
}

function patchActiveEffectChangeRenderer() {
  const prototype = ActiveEffectConfigBase.prototype;
  if (prototype[RENDER_CHANGE_PATCH_KEY]) return;

  const originalRenderChange = prototype._renderChange;
  if (typeof originalRenderChange !== "function") {
    throw new Error("Peasant Core requires ActiveEffectConfig#_renderChange.");
  }

  Object.defineProperty(prototype, RENDER_CHANGE_PATCH_KEY, { value: true });
  prototype._renderChange = async function(context) {
    const html = await originalRenderChange.call(this, context);
    return markChangeKeyInput(html);
  };
}

function getKeyBrowser(app) {
  let browser = KEY_BROWSER_BY_APP.get(app);
  if (!browser) {
    browser = new PeasantActiveEffectKeyBrowser({
      keys: collectPeasantActiveEffectKeys({ effect: app.document })
    });
    KEY_BROWSER_BY_APP.set(app, browser);
  }
  return browser;
}

function destroyKeyBrowser(app) {
  const browser = KEY_BROWSER_BY_APP.get(app);
  if (!browser) return;
  browser.destroy();
  KEY_BROWSER_BY_APP.delete(app);
}

function onKeyInputInteraction(app, event) {
  const input = event.currentTarget;
  updateKeyMetadataHint(input);

  const browser = getKeyBrowser(app);
  browser.setInput(input);
  browser.update();
}

function bindKeyBrowser(app, element = getApplicationElement(app)) {
  if (!element || isDaeActiveEffectConfig(app, element)) {
    destroyKeyBrowser(app);
    return;
  }

  const browser = getKeyBrowser(app);
  browser.setKeys(collectPeasantActiveEffectKeys({ effect: app.document }));

  for (const input of element.querySelectorAll(".pc-ae-key-input")) {
    updateKeyMetadataHint(input);
    if (input.dataset.pcAeKeyBrowserBound === "true") continue;
    input.dataset.pcAeKeyBrowserBound = "true";
    input.addEventListener("focus", event => onKeyInputInteraction(app, event));
    input.addEventListener("click", event => onKeyInputInteraction(app, event));
    input.addEventListener("input", event => onKeyInputInteraction(app, event));
  }
}

function registerPeasantKeysWithDae(addAutoFields) {
  if (typeof addAutoFields !== "function") return;
  const fields = collectPeasantActiveEffectKeys().map(name => ({ name }));
  if (fields.length) addAutoFields(fields);
}

export function configurePeasantActiveEffectSheetEnhancements() {
  patchActiveEffectChangeRenderer();

  Hooks.on("renderActiveEffectConfig", (app, element) => {
    bindKeyBrowser(app, element);
  });
  Hooks.on("closeActiveEffectConfig", app => {
    destroyKeyBrowser(app);
  });
  Hooks.on("dae.addAutoFields", addAutoFields => {
    registerPeasantKeysWithDae(addAutoFields);
  });
  Hooks.once("dae.ready", api => {
    registerPeasantKeysWithDae(api?.addAutoFields);
  });
}
