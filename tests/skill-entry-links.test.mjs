import assert from "node:assert/strict";

const warnings = [];
const messages = [];
const entry = {
  id: "aid",
  name: "First Aid",
  type: "skill",
  baseUsage: { name: "Default", resolution: "reference", layout: [] },
  usages: [{
    id: "treatment", name: "Treatment", resolution: "reference",
    mechanics: { heal: { enabled: true, diceCount: 1, diceValue: 6, diceBonus: 0, flat: 0, type: "temporary" } },
    layout: [{ kind: "tag", key: "heal" }],
    rules: [{ id: "limit", when: "manual", tagKeys: ["heal"], effectLinkIds: [], note: "Once a day", editorTagKey: "heal" }],
    effectLinks: [{
      id: "treatment-link", effectId: "definition", tagKey: "heal", when: "success",
      recipient: "self", application: "automatic"
    }]
  }]
};
const actor = {
  uuid: "Actor.healer",
  name: "Healer",
  isOwner: true,
  system: { _source: { skills: [entry], notableCombats: [] }, skills: [entry], notableCombats: [] },
  async ensurePeasantEntryIds() { return { changed: false }; }
};

globalThis.foundry = { utils: { deepClone: structuredClone, randomID: () => "test-id" } };
globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
globalThis.game = {
  peasantCore: {},
  user: { id: "user-1" },
  settings: { get: () => "public" }
};
globalThis.ui = { notifications: { warn: message => warnings.push(message) } };
globalThis.fromUuid = async uuid => uuid === actor.uuid ? actor : null;
globalThis.ChatMessage = {
  getSpeaker: () => ({ actor: actor.uuid }),
  applyMode: data => data,
  async create(data) {
    messages.push(data);
    return { id: `message-${messages.length}`, ...data };
  }
};

const { registerPeasantCombatApi } = await import("../module/applications/combat/api.mjs");
registerPeasantCombatApi();

assert.equal(typeof game.peasantCore.useSkillEntry, "function", "ready-time combat API exposes stable usage activation");
const used = await game.peasantCore.useSkillEntry({
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "treatment"
});
assert.equal(used.referenced, true);
assert.match(messages[0].content, /Treatment/);

const stale = await game.peasantCore.useSkillEntry({
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "deleted"
});
assert.equal(stale, false, "an explicit missing usage never falls back to Base");
assert.equal(messages.length, 1);
assert.match(warnings.at(-1), /usage.*(unavailable|not found)/i);

const { createPeasantUsageLink, registerPeasantUsageEnricher } = await import(
  "../module/applications/skill-usage-links.mjs"
);
const specialLink = createPeasantUsageLink({
  actorUuid: "Actor.a|b]", collection: "skills", entryId: "aid|[]", usageId: "use|]"
}, "A & B } <test>");
assert.equal(specialLink,
  "@PeasantUsage[Actor.a%7Cb%5D|skills|aid%7C%5B%5D|use%7C%5D]{A%20%26%20B%20%7D%20%3Ctest%3E}");

const enriched = [];
globalThis.CONFIG = { TextEditor: { enrichers: enriched } };
foundry.applications = { ux: { TextEditor: { implementation: {
  decodeHTML: value => value.replace(/&amp;/g, "&").replace(/&#125;/g, "}").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
} } } };
globalThis.document = { createElement: tag => ({
  tagName: tag.toUpperCase(), dataset: {}, classList: { add() {} }, setAttribute() {}, textContent: ""
}) };
registerPeasantUsageEnricher();
assert.equal(enriched.length, 1);
const config = enriched[0];
const match = config.pattern.exec(specialLink);
const anchor = await config.enricher(match);
assert.equal(anchor.textContent, "A & B } <test>");
assert.equal(anchor.dataset.actorUuid, "Actor.a|b]");
assert.equal(anchor.dataset.entryId, "aid|[]");
assert.equal(anchor.dataset.usageId, "use|]");

config.pattern.lastIndex = 0;
const handWritten = await config.enricher(config.pattern.exec(
  "@PeasantUsage[Actor.healer|skills|aid|treatment]{50% complete}"
));
assert.equal(handWritten.textContent, "50% complete", "hand-authored labels need not be URI-escaped");

const playableLink = createPeasantUsageLink({
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "treatment"
}, "Treatment");
config.pattern.lastIndex = 0;
const playableAnchor = await config.enricher(config.pattern.exec(playableLink));
let clickHandler;
config.onRender({ addEventListener: (_type, callback) => { clickHandler = callback; } });
await clickHandler({
  preventDefault() {},
  target: { closest: () => playableAnchor }
});
assert.equal(messages.length, 2, "clicking an enriched usage link activates its stable target");

const copied = [];
const hotbarRequests = [];
ui.context = { menuItems: [] };
game.clipboard = { copyPlainText: async value => copied.push(value) };
game.peasantCore.addSkillUsageToHotbar = async value => { hotbarRequests.push(value); return true; };
globalThis.Hooks = { on: () => 1, off() {} };
globalThis.$ = value => [value];
globalThis.CONFIG.Item = {};
globalThis.CONFIG.ActiveEffect = {};
foundry.utils.mergeObject = (base, additions) => ({ ...base, ...additions });
foundry.utils.getProperty = () => null;
foundry.applications.api = {
  ApplicationV2: class {
    constructor(options) { this.options = options; }
    render() {}
    close() {}
  },
  HandlebarsApplicationMixin: Base => Base
};
let usageMenu;
foundry.applications.ux.ContextMenu = { implementation: class {
  constructor(_root, _selector, _items, options) { usageMenu = options; }
} };
const { openPeasantSkillEditor, prepareNotableCombatEffectContext } = await import(
  "../module/applications/actor/notable-combat/notable-combat-tag-editor.mjs"
);
const sheet = {
  id: "sheet-1", actor, canModifyActor: true,
  renderChild() {},
  async updatePeasantEntry() { return { ok: true }; }
};
actor.updatePeasantEntry = async () => ({ ok: true });
const editor = await openPeasantSkillEditor(sheet, { collection: "skills", entryId: "aid" }, { usageId: "treatment" });
assert.ok(editor);
assert.deepEqual(editor._getNotableCombatEffectContextOptions({
  scope: "usage", linkId: "treatment-link", effect: { id: "definition" }
}).map(option => option.label), ["Edit", "Duplicate", "Configure Link", "Delete"],
"The shared Skill/Notable usage-effect menu has no Unlink action");
const dialogs = [];
const dialogConfigs = [];
foundry.applications.api.DialogV2 = { prompt: async config => {
  dialogs.push(config.content);
  dialogConfigs.push(config);
  return null;
} };
await editor._configureTagCondition("heal");
await editor._configureNotableCombatEffectLink({ linkId: "treatment-link" });
assert.equal(dialogs.length, 2);
for (const html of dialogs) {
  assert.match(html, /<option value="failure"/);
  assert.doesNotMatch(html, /<option value="manual"/);
}
assert.match(dialogs[1], /<option value="automatic"/);
assert.match(dialogs[0], /<option value="always"[^>]*>On Use<\/option>/,
  "Existing tag Always behavior is labeled On Use");
assert.match(dialogs[1], /<option value="always"[^>]*>On Use<\/option>/,
  "Existing effect Always behavior is labeled On Use");
assert.ok(dialogs[1].indexOf('value="passive"') > dialogs[1].indexOf('value="hit"'),
  "Passive appears after Hit in the usage-effect Condition menu");
assert.match(dialogs[1], /<option value="automatic" selected/,
  "A limit-linked effect retains its chosen Automatic mode for when the limit is removed");
assert.match(dialogs[1], /Once a day|review/i,
  "The editor explains why a limit-linked effect needs chat review");
assert.match(dialogs[1], /<option value="heal"[^>]*>[^<]*Offer in Chat/,
  "The tag selector identifies tags that force an offer before a changed choice is saved");
const limitedFields = {
  '[name="tagKey"]': "heal",
  '[name="when"]': "success",
  '[name="recipient"]': "self",
  '[name="application"]': "automatic"
};
const savedLimitedLink = dialogConfigs[1].ok.callback(null, null, { element: {
  nodeType: 1,
  querySelector: selector => Object.hasOwn(limitedFields, selector) ? { value: limitedFields[selector] } : null
} });
assert.equal(savedLimitedLink.application, "automatic",
  "Saving a limit-forced link keeps the chosen mode while execution derives Offer in Chat");
const passiveFields = {
  '[name="tagKey"]': "",
  '[name="when"]': "passive",
  '[name="recipient"]': "target",
  '[name="application"]': "offer"
};
const savedPassiveLink = dialogConfigs[1].ok.callback(null, null, { element: {
  nodeType: 1,
  querySelector: selector => Object.hasOwn(passiveFields, selector) ? { value: passiveFields[selector] } : null
} });
assert.deepEqual([savedPassiveLink.when, savedPassiveLink.recipient, savedPassiveLink.application],
  ["passive", "self", "automatic"], "Passive ignores stale recipient/application controls");
const passiveSettingRows = [{ hidden: false }, { hidden: false }];
let changeCondition;
const conditionField = {
  value: "passive",
  addEventListener: (_event, callback) => { changeCondition = callback; }
};
const linkDialogRoot = {
  nodeType: 1,
  querySelector: selector => selector === '[name="when"]' ? conditionField : null,
  querySelectorAll: selector => selector === "[data-pc-effect-link-setting]" ? passiveSettingRows : []
};
dialogConfigs[1].render?.({ type: "render" }, { element: linkDialogRoot });
assert.deepEqual(passiveSettingRows.map(row => row.hidden), [true, true],
  "Passive hides Recipient and Application when the dialog opens");
conditionField.value = "always";
changeCondition?.();
assert.deepEqual(passiveSettingRows.map(row => row.hidden), [false, false],
  "On Use restores Recipient and Application when selected");
const effectRow = prepareNotableCombatEffectContext(actor, entry, { selectedUsageId: "treatment" })
  .effectSections.find(section => section.type === "usage").effects[0];
assert.match(effectRow.subtitle, /Offer in Chat/,
  "The usage row displays the effective review mode even when Automatic is stored");
entry.usages[0].rules[0].note = "";
await editor._configureTagCondition("heal");
assert.match(dialogs[2], /legacy tag requires review/i,
  "A legacy review-only gate remains visible when it has no limit note");
entry.usages[0].rules[0].note = "Once a day";
editor._setupUsageContextMenu({});
usageMenu.onOpen();
const copyAction = ui.context.menuItems.find(item => item.label === "Copy Link");
const hotbarAction = ui.context.menuItems.find(item => item.label === "Add to Hotbar");
assert.ok(copyAction, "the Usage Options menu offers a link for the selected usage");
assert.ok(hotbarAction, "the Usage Options menu offers a usage-specific hotbar action");
await copyAction.onClick();
assert.equal(copied[0], createPeasantUsageLink({
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "treatment"
}, "First Aid: Treatment"));
await hotbarAction.onClick();
assert.deepEqual(hotbarRequests[0], {
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "treatment"
});

entry.usages.unshift({ id: "duplicate", name: "Treatment", resolution: "reference", mechanics: {}, layout: [] });
entry.usages.find(usage => usage.id === "treatment").name = "Clinic";
const renamed = await game.peasantCore.useSkillEntry(playableAnchor.dataset);
assert.equal(renamed.usageContext.ref.usageId, "treatment", "copied links survive duplicate labels and reordering");
assert.equal(renamed.usageContext.usageName, "Clinic", "copied links survive usage renaming");

const countBeforeRejected = messages.length;
assert.equal(await game.peasantCore.useSkillEntry({
  actorUuid: "Actor.missing", collection: "skills", entryId: "aid", usageId: "treatment"
}), false);
assert.equal(await game.peasantCore.useSkillEntry({
  actorUuid: actor.uuid, collection: "skills", entryId: "missing", usageId: "treatment"
}), false);
actor.isOwner = false;
assert.equal(await game.peasantCore.useSkillEntry({
  actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "treatment"
}), false);
actor.isOwner = true;
assert.equal(messages.length, countBeforeRejected, "missing or unauthorized references create no chat use");

let createdLink = null;
const oldCreate = actor.createEmbeddedDocuments;
const oldManageLink = actor.managePeasantEntryEffectLink;
const oldSaveMain = editor._saveMainFields;
const oldRender = editor.render;
const oldOpenEffect = editor._openNotableCombatEffectSheet;
actor.createEmbeddedDocuments = async () => [{ id: "new-definition" }];
actor.managePeasantEntryEffectLink = async (_ref, _action, payload) => {
  createdLink = payload.effectLink;
  return { ok: true };
};
editor._saveMainFields = async () => true;
editor.render = async () => {};
editor._openNotableCombatEffectSheet = () => {};
await editor._createNotableCombatEffect({}, { scope: "usage" });
assert.deepEqual([createdLink.when, createdLink.application], ["success", "automatic"],
  "A new usage effect starts with Successful Check and Automatic application");
actor.createEmbeddedDocuments = oldCreate;
actor.managePeasantEntryEffectLink = oldManageLink;
editor._saveMainFields = oldSaveMain;
editor.render = oldRender;
editor._openNotableCombatEffectSheet = oldOpenEffect;

const replacementGame = { ...game, peasantCore: {} };
globalThis.game = replacementGame;
registerPeasantCombatApi();
assert.equal(typeof replacementGame.peasantCore.useSkillEntry, "function", "registration works after Foundry replaces game");
