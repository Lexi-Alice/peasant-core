import assert from "node:assert/strict";

class ActiveEffectConfig {
  async _renderChange() {
    return "";
  }
}

const hooks = new Map();
globalThis.foundry = {
  applications: { sheets: { ActiveEffectConfig } },
  data: { fields: {} }
};
globalThis.Hooks = {
  on(name, callback) {
    hooks.set(name, callback);
  },
  once() {}
};

const { configurePeasantActiveEffectSheetEnhancements } = await import(
  "../module/applications/active-effect/active-effect-config.mjs"
);

function createTabPart(tab, protectedInputs = []) {
  const insertions = [];
  return {
    nodeType: 1,
    insertions,
    matches(selector) {
      if (selector === "form") return false;
      if (selector === '[data-tab="changes"]') return tab === "changes";
      if (selector === 'section.tab.changes[data-tab="changes"]') return tab === "changes";
      return false;
    },
    querySelector(selector) {
      if (selector === "form") return null;
      if (selector === '[data-tab="changes"]') return null;
      if (selector === "[data-pc-spell-effect-fields]") return insertions.length ? {} : null;
      if (selector === "footer.form-footer, .form-footer, footer") return null;
      return null;
    },
    querySelectorAll(selector) {
      return selector === "[data-pc-protected-halt-input]" ? protectedInputs : [];
    },
    insertAdjacentHTML(position, html) {
      insertions.push({ position, html });
    }
  };
}

class DAEActiveEffectConfig {
  constructor() {
    this.document = {
      type: "spellEffect",
      system: { encounterId: "combat" }
    };
  }
}

configurePeasantActiveEffectSheetEnhancements();
const renderActiveEffectConfig = hooks.get("renderActiveEffectConfig");
const app = new DAEActiveEffectConfig();
const detailsPart = createTabPart("details");
const durationPart = createTabPart("duration");
const changesPart = createTabPart("changes");

renderActiveEffectConfig(app, detailsPart);
assert.equal(detailsPart.insertions.length, 0);

renderActiveEffectConfig(app, durationPart);
assert.equal(durationPart.insertions.length, 0);

renderActiveEffectConfig(app, changesPart);
renderActiveEffectConfig(app, changesPart);
assert.equal(changesPart.insertions.length, 0);

const changesNavigation = createTabPart("changes-navigation");
const rootChangesPart = createTabPart("changes");
const fullSheet = {
  nodeType: 1,
  matches(selector) {
    return selector === "form";
  },
  querySelector(selector) {
    if (selector === '[data-tab="changes"]') return changesNavigation;
    if (selector === 'section.tab.changes[data-tab="changes"]') return rootChangesPart;
    return null;
  }
};

renderActiveEffectConfig(app, fullSheet);
assert.equal(changesNavigation.insertions.length, 0);
assert.equal(rootChangesPart.insertions.length, 0);
