# Shared Skill and Notable Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The intended executor is **Sol**; execute inline with executing-plans unless the user explicitly requests delegation. This document is a handoff, not a request to create another task automatically.

**Goal:** Apply the selected compact Foundry-styled editor to separate Skills and Notables, with complete identity information, direct fixed-list classification fields plus Custom, visible Signature counts, alternate usages, readable inline tags, and bounded effect links.

**Architecture:** Extend the existing ApplicationV2 Notable editor into one shared editor with a small collection/entry adapter. Preserve legacy root fields and separate actor arrays; add alternate-usage data and resolve it into the existing roll payload shape. Keep normalization and resolution pure, mutations on PeasantActor, presentation in the editor/templates, and activation/replay in the current workflow owners.

**Tech Stack:** Foundry VTT 14, JavaScript ES modules, Handlebars, existing CSS/theme variables, native Foundry controls and Active Effects, current socket/undo infrastructure, direct Node assertion scripts. No package.json or new dependencies.

**Spec:** [Shared Skill and Notable Editor Design](../specs/2026-09-07-skill-and-notable-editor-design.md). Read it in full, including signature rules, execution limits, and both reference images. It travels with this plan and supersedes conflicting details in the raster concepts.

**Audit:** [September 7 plan audit](2026-09-07-skill-and-notable-editor-audit.md). This plan was amended after tracing legacy Signature saves, array-based undo, effect state operations, and healing types. Those fixes are required compatibility work, not optional cleanup.

**September 9 amendment:** The approved editor no longer includes Source Kind, Source, Source Properties, inherited-field bindings, or source lookup. Martial Skill and Signature expose Weapon Type, while Magic Gate exposes Gate Type. Each uses its fixed rulebook list plus Custom; custom text is stored directly in the corresponding scalar field. Type `Standard` is renamed to `Skill` with canonical stored value `skill`; `Other` becomes Custom through world migration version 10. Type choices are Category-specific, and version 11 replaces mismatched built-in Types with the Category default while retaining authored non-list Custom names. Signature is then promoted to a Category-limited Type through version 12. The shared editor and Notable lists remove Signature checkboxes; the actor Skills list retains its checkbox only as a Skill/Signature shortcut.

**September 10 amendment:** Magic replaces its former Skill choice with canonical Type `Spell`, followed by `Subskill`. Spell keeps Class, Rank, To-Hit, and Accuracy and exposes Gate Type. Subskill hides Class, Rank, To-Hit, Accuracy, Weapon Type, and Gate Type. Version 13 migrates existing Magic Skill entries to Spell in both collections without changing non-Magic Skills or sibling fields.

**Further September 10 amendment:** Martial replaces Skill with Weapon and adds Defense and Combat Trick, ordered Weapon, Defense, Combat Trick, Signature, Stance, Perk, Custom. Weapon uses Weapon Type; Defense uses Block/Parry/Dodge/Armor Defense Type; Combat Trick uses the combined Weapon/Defense list as Trick Type; and Martial Signature uses that same combined list as Signature Type. Each selector ends with Custom. Version 14 converts Martial Skill to Weapon, copies a blank Martial Signature Type from its existing Weapon Type while preserving Weapon Type, and removes legacy `sig`. The Skills-list Signature checkbox and handler are removed; Type is the sole Signature state.

**Characteristic mode and roll-layout amendment:** The Mode selector remains hidden for zero or one selected Characteristic, with canonical stored mode `single`. With two or three selected Characteristics it offers Mixed and Advantaged. When all four are selected, those same stored choices are labeled Omni Worst and Omni Best respectively; no migration or additional mode values are introduced. Missing, legacy, or `single` mode defaults to `mixed`. Returning to fewer than two selections resets the hidden mode to `single`. Save the Characteristics array and its normalized mode together so a checkbox change cannot leave stale mode data. Keep all four Characteristic checkboxes on one compact horizontal row, reducing only their inter-option gaps as needed. Keep Mode, To-Hit, and Accuracy on that same top-aligned line without clipping at the 560px minimum width. In Skill editors, the following compact advancement row places Usage and its options menu on the left and AP/SP on the right; Notable Usage remains a separate row below the identity controls.

**Usage authoring amendment:** Put `Usage` above the native select, matching the other labeled controls. The Usage Options ellipsis menu contains Add Usage, Make Default, Rename, Duplicate, Clear/Delete, and the later link commands; there is no separate Add Usage button or searchable usage browser. Keep the row visible for editable single-usage entries so Add Usage remains reachable, and hide it only for read-only entries with a single usage. Usage Notes and nested base/alternate usage descriptions are retired; version 20 deletes those stored fields while preserving whole-entry Description. When an alternate Notable usage is selected, Characteristics, Mode, To-Hit, and Accuracy remain directly editable and write sparse overrides without lock, Customize, or Restore controls. Skill alternates retain the explicit Customize/Restore Default treatment. Skill Usage shares its advancement row with AP/SP; Notable Usage does not.

**Separator styling amendment:** Match the equipment-card tab separator below the Category/Type header and below the Description/Details/Effects tabs. Do not render a separator immediately above those tabs. Use the shared `--color-tabs-border` token with the equipment fallback rather than the editor's former faint `0.34` border.

**Signature Uses styling amendment:** Present Signature counters inside the standard `pc-foundry-section` fieldset with a `Signature Uses` legend. Reuse the character sheet section border and legend treatment while retaining the compact horizontal wrapping counter layout. The editor-scoped counter rule must override Foundry's higher-specificity `.standard-form fieldset` column direction, no-wrap behavior, gap, and padding so the fieldset does not become a tall vertical stack. Keep every Current/Maximum numeric input at the compact 72px width. Size each Duress field wrapper to its longer label rather than a fixed width, then left-align the unchanged 72px input beneath it so the Duress Current/separator/Maximum group remains compact without truncating labels or widening the primary uses controls. Cap each Duress input at 72px so the editor's general `width: 100%` input rule cannot expand it to the wrapper width, and reduce its horizontal padding to 4px for a tighter interior. Prevent the `Duress Uses` checkbox label from flex-growing into unused row space and use a 3px checkbox-to-text gap so the toggle and Duress count group remain close together.

**Signature metadata removal amendment:** Remove the configurable counter label and recovery/note from the editor and current `signatureUsage` schema. Version 15 deletes legacy `signatureUsage.label` and `signatureUsage.note` from both Skills and Notables while preserving primary counts, Duress configuration/counts, and unrelated entry metadata. Current normalization and character-model pre-schema migration also discard these retired fields so later legacy imports cannot restore them. Signature Uses contains only Current, Maximum, Duress Uses, and the optional Duress Current/Maximum controls.

**Duress Uses naming amendment:** Label the optional counter switch `Duress Uses` and store it canonically as `signatureUsage.duressUses`. Version 16 copies legacy `signatureUsage.duressEnabled` into `duressUses` and removes the old key in both actor collections. Current normalization and character-model pre-schema migration perform the same rename for later legacy imports. Keep `duressCurrent` and `duressMax` unchanged.

**Tag section styling amendment:** In Details, wrap the tag controls in a Foundry-style fieldset whose `Tags` legend follows the native Scene Levels pattern: a `control` legend with a regular square-plus `icon inline-control` immediately after the title at a 4px gap. That button opens the existing tag chooser. Remove the separate toolbar, large Add Tag control, and Add Group control. Inside the fieldset, use the existing inventory/notable/effects visual pattern: one shared bordered panel, a dark `Tag` / `Summary` header band, and compact contiguous rows separated by thin dividers. Keep the chevron, canonical tag name, mechanical summary, and options menu in each row. On hover, focus, or while a row is expanded, apply the same light text and red glow used by the Description/Details/Effects tabs to only the chevron and canonical tag name. Do not draw an orange outline around the row or highlight its mechanical summary or options menu; suppress the summary button's native outline because the text glow provides the visible focus state. When a row expands, insert the existing edit draft as a full-width subrow directly beneath it without a card gap, rounded join, or separator seam. Use reduced padding and gaps in the expanded body, and start the mechanical controls immediately without an `Edit Tag:` or `Add New Tag:` heading. Do not expose or store layout-level Display Name or Note / Limit fields; version 17 removes existing `label` and `note` keys from tag layouts in base and alternate usages across both actor collections while preserving Custom tag `name` and `value`. Version 18 removes all stored organizational group rows from top-level, base-usage, and alternate-usage layouts in both actor collections while preserving tag-row order and payloads. Retain the current single-open-row, tag drag-ordering, and persistence behavior. Apply this shared interaction to both Skill and Notable editors: remove the visible Cancel button, and make a second click on the open row collapse it and discard its unsaved draft exactly as Cancel did. Escape remains the keyboard equivalent; Save Tag remains explicit.

**Tag list spacing amendment:** Keep the inventory header and first tag flush by omitting the first row's top divider. Override the legacy tag-list padding and minimum height to zero so no inset or trailing space makes the final row appear taller. Use a uniform 38px minimum row height with tighter vertical padding. Reduce the distance from the `Tags` legend to the list with 10px fieldset top padding and no additional browser top margin. When the Add Tag chooser is open, use a 4px top margin beneath the outer Tags legend.

**Compact tag-control amendment:** Remove the legacy minimum height and vertical padding from the expanded tag input area. Damage and Heal place their dice expression and Type on one wrapping row; Speed places its selector and conditional Max Uses on one row; Manifest Dome and Manifest Resistance place Duration or HALT beside the dice expression; and Custom places Name and Value together. Shared compact tag selectors use a stable responsive width equal to 25% of the available row, bounded from 120px through 140px, so they expand with the editor without responding to option text length. Resource Costs renders each cost as one compact wrapping row and keeps a small Add Cost action beneath the rows. Existing single-field tags remain single-line, Strengthen uses one guidance line, and the structurally complex Defense editor remains sectioned. These rows may wrap when the editor is too narrow, and no stored data or behavior changes.

**Shared editor window sizing amendment:** Keep Skill and Notable editor windows resizable, but prevent a non-minimized window from shrinking below the equipment-window width of 560px or the 420px minimum height. Existing internal panel scrolling remains responsible for content that does not fit at the minimum size.

**Shared editor top-spacing amendment:** Match the equipment window's title-bar-to-content spacing by suppressing Foundry's `standard-form` flex gap only on the outer shared Skill/Notable application. Retain the existing 12px window-content padding and all internal form, body, tab, and footer spacing.

**Tag chooser amendment:** Remove the visible Tag Type select from the Add Tag area. The legend square-plus reveals one searchable combobox inside a compact nested Foundry fieldset whose inline legend reads `Add Tag`; the input retains the `Search tags` placeholder. Its dropdown opens on focus or click with the full fixed tag catalog and narrows case-insensitively as the user types, matching the existing Active Effect change-key browser. Support pointer selection plus Arrow Up/Down, Enter, Escape, and Tab. A valid selection fills the visible field, stores the existing canonical tag type internally, closes the dropdown, and opens the unchanged tag-specific draft; reset clears the visible label. Typed text is filtering only and never creates an arbitrary tag, while Custom remains the explicit route for authored tag names. This changes no tag data or migration contract.

**Provisional tag-row amendment:** Choosing a tag that is not already stored appends a temporary row to the normal tag list and expands its draft directly beneath it, using the same row renderer, background, divider, chevron, name, and column alignment as stored tags. Its action reads `Add Tag`; stored rows continue to use `Save Tag`. The provisional row reserves the menu column but has no options control or drag behavior because it has no persisted identity. Clicking it again, pressing Escape, choosing another tag, leaving Details, or closing the editor discards the DOM-only row and draft. Only `Add Tag` writes data and causes the list to rerender the stored row. This requires no migration.

**Section add-control amendment:** Remove the large trailing Add controls from the actor-sheet Skills, Notable Combats, Active Effects, Combat Adjustments, Inventory, and Flexible Advantages sections and from the shared Skill/Notable editor Effects panel. Put the same native Scene Levels regular square-plus `icon inline-control` immediately after each section title in a `control` legend with a 4px gap, visible only while the corresponding sheet or editor is editable. Apply that legend pattern to the shared SIR Locations and National Origins settings groups as well. Preserve the existing add listeners, accessible labels, and settings-list end-drop behavior; the relocated control does not change stored data. The Item sheet's Effects Add button is outside this amendment and retains its current treatment.

## Global Constraints

- Target Foundry VTT 14; add no dependency, build system, front-end framework, or new Item document type.
- Keep `system.skills` and `system.notableCombats` separate; never merge, mirror, or auto-convert entries.
- Actual Peasant Core and Foundry styling is authoritative; concept images govern layout and interaction only.
- Keep the labels Category, Type, Weapon Type, Defense Type, Trick Type, Signature Type, Gate Type, Characteristics, Class, Rank, To-Hit, Accuracy, Signature, Signature Uses, Duress Uses, Usage, Uses, and Sections distinct.
- Preserve authored values and unrecognized legacy data; do not persist Active Effect-derived values over stored bases.
- Preserve unrelated dirty files and existing combat, Stress, Edge, undo, and manifestation behavior.
- Do not add tag enable/disable controls or a skill preview/simulator.
- Keep custom rules available in every category; category suggestions must not hide the full supported tag catalog.
- Switching a tab or usage, opening an editor, and renaming or duplicating a usage must not spend or replenish resources.
- Do not add automatic signature-family accounting, bridging charges, rest resets, Duress detection, or advancement calculations in this delivery.

## Execution order and reviewable deliveries

Complete the tasks in order, with three separate integration milestones: **A — authoring/UI (1–4)**, **B — usage resolution and execution (5–7)**, and **C — effect application and stable shortcuts (8–9)**. Task 10 verifies the completed system. Milestone A is a disposable-world authoring demo; it does not establish that newly configured usages, Duress spending or effects execute. Review its styling before extending the interactions. Keep incomplete activation options hidden; do not ship intermediate phases as the complete feature. Retain all accepted capabilities in the later milestones rather than mixing new effect/roll behavior into the first CSS/layout review.

Each task should produce a focused commit in an isolated implementation checkout when appropriate. Do not stage whole files containing unrelated user changes; inspect and stage only this feature's hunks. Do not commit the user's pre-existing work merely to prepare a worktree. The selected layout/category/counter requirements are user decisions. The extra resolution modes, Duress prompt behavior and conditional-offer machinery are implementation design choices in this plan and must be reported as such, not attributed to an explicit user request.

Before editing, record `git status --short` and inspect overlapping diffs. The September 7 checkout already contains many unrelated modified combat/editor/model files and dirty LevelDB pack files. Starting from a clean default branch can omit required current behavior; use the user-authorized current working-tree state when preparing isolation. Keep pack files untouched. Re-read applicable AGENTS.md and verify the function anchors below, because line numbers and recent work can change.

No task requires importing the complete rulebook into a compendium, converting Skill records to Item documents, changing the actor-list organization, or implementing every Custom rule as automation.

## Current implementation status — September 22, 2026

This status block is authoritative; the task-local checklists below remain the detailed implementation and regression recipe.

| Task | Status | Current result |
| --- | --- | --- |
| 1. Schema and composition | Implemented | Shared fields, normalization/resolution, migrations 10–20, stable IDs, alternate mechanics, and retired usage descriptions are present. |
| 2. Stable writes and counters | Implemented | Stable entry/usage patches and primary, Duress, and mechanical Uses consumption are present. |
| 3. Common editor and identity | Implemented | Skills and Notables use the same editor surface and current compact layout. The existing ApplicationV2 class remains in `notable-combat-tag-editor.mjs`; `skill-editor.mjs` supplies shared identity/context and the opener. This is a deliberate minimum-change deviation from the original move. |
| 4. Inline tags | Implemented | Inventory-style rows, searchable Add Tag chooser, compact editors, provisional add behavior, deletion, order, and group/metadata removal are present. |
| 5. Alternate usage authoring | Implemented | Stable-ID CRUD, explicit default, shared/local mechanics, current Usage placement, and collection-specific override controls are present. Usage Notes were removed instead of retained. |
| 6. Classification | Implemented | Fixed/custom Type and classification selectors plus Category normalization are present. Obsolete in-memory `usage.bindings` reconstruction and stale “usage notes” clear-dialog wording have been removed. |
| 7. Activation, spending, replay | Implemented | The shared dispatcher supports Check, Targeted Use, and Reference across both collections, including activation of the editor's visible usage. Immutable selected-usage data and Signature eligibility survive manual values, multi-target outcomes, Edge, Stress, and Undo. The automated matrix covers success/failure, untrained checks, exhausted counters, both Signature pools, canceled preflight, stable replay, and deleted references; live Foundry exercise remains in Task 10. |
| 8. Conditions and effects | Implemented | Explicit per-tag and per-link gates, inert scoped definitions, immutable per-target chat offers, permission-checked application, separate Skill-effect undo, and applied-offer reroll rollback are implemented. Automatic Heal, Damage, and Manifest handlers respect Manual gates; unsupported limits stay manual. Live Foundry exercise remains in Task 10. |
| 9. Stable links | Implemented (automated-only) | The selected usage has a stable-ID Copy Link and Add to Hotbar action, a custom rich-text enricher, and a public activation API. Existing Notable macro behavior is unchanged. Focused regressions cover stale IDs, permission checks, renames, reordering, duplicate labels, special characters, and ready-time API registration; live Foundry exercise remains in Task 10. |
| 10. Full verification | Pending | The direct Node suite passes 100/100 test files; a fresh Task 10 Foundry/runtime matrix and handoff record still remain. |

## File map

All paths below are repository-relative to `C:/Users/smelo/AppData/Local/FoundryVTT/Data/systems/peasant-core`.

| File / area | Responsibility |
| --- | --- |
| New `module/data/actor/skill-entry-fields.mjs` | Fresh shared schema field factories; preserve root mechanical paths. |
| New `module/data/actor/skill-entries.mjs` | Entry/usage normalization, stable references, pure usage composition, tag updates and duplication. |
| New `module/data/actor/skill-entry-conditions.mjs` | Bounded event eligibility and effect-offer data, no expression parser. |
| `module/data/actor/character.mjs`, `module/documents/actor.mjs` | Schema integration, authored/state writes, IDs, counters, existing public wrappers. |
| New `module/applications/actor/skills/skill-editor-adapter.mjs` | Resolve collection + stable ID, read stored/effective data, send small patches to actor. |
| New `module/applications/actor/skills/skill-editor.mjs` | Shared identity/context preparation and `openSkillEditor` wrapper. The existing ApplicationV2 class remains in the Notable editor module and consumes this shared context. |
| New `templates/actor/apps/skill-editor-body.hbs`, `skill-editor-footer.hbs` | Shared header, tabs, counters, usage selector, inline rows. |
| Existing `module/applications/actor/notable-combat/notable-combat-tag-*.mjs` and `*-inputs.mjs` | Reused tag collectors, renderers, summaries, validation, drag interaction. |
| `module/applications/actor/notable-combat/notable-combat-tag-editor.mjs` | Retained public Notable opener forwarding to the common editor. |
| Skill/Notable actor-list templates, controls, and `module/data/actor/sheet-display/{skills,notable-combat}.mjs` | Keep separate lists; common Edit action, visible counters, resolved default-usage summaries. |
| New `module/applications/combat/skill-entry-use.mjs` | Stable-reference activation dispatcher and extracted existing Skill check flow. |
| Existing combat workflow, roll, manual-tag, Edge, Stress and undo owners | Carry selected usage/pool and immutable resolved payload through current execution paths. |
| New `module/applications/combat/skill-entry-effects.mjs` | Permission-checked effect offers and application using existing sockets/undo. |
| New `module/applications/skill-usage-links.mjs` | Copy Link enrichment, usage-specific hotbar/public API. |
| `peasant-core.css` | Narrow layout rules; reuse shared sheet theme. |
| New focused `tests/skill-entry-*.test.mjs` listed per task | Behavior checks using the existing direct Node convention. |

## Interface contract used across tasks

These names are proposed APIs, not claims that they already exist. Define them in the producing task; keep consumers consistent.

```js
// Plain data, suitable for chat flags and macro arguments.
// collection is exactly "skills" or "notableCombats".
// EntryRef = { collection, entryId }
// UseRef = { collection, entryId, usageId }
// SignaturePool = "primary" | "duress"

// skill-entry-fields.mjs — each call creates NEW DataField instances.
createSkillMechanicFields(fields); // -> object of the current mechanical fields
createSkillEditorFields(fields);   // -> object of the additions in spec section 6

// skill-entries.mjs — no Actor, game, DOM, or writes.
normalizeSkillEntry(entry, { collection, createId }); // -> normalized clone, unknown fields retained
resolveSkillUsage(entry, usageId = entry.defaultUsageId || "base");
// -> { ok: true, usageId, usage, data } | { ok: false, error }
// data has root identity/counters plus exactly the chosen resolved mechanical payload.
duplicateSkillUsage(entry, usageId, { createId }); // -> { entry, usageId } (new clones)
setSkillTagData(data, tagType, tagData, { mode = "add", customId = null } = {});
// -> { ok, changed, data, error? }; mode: add | edit | remove

// PeasantActor — resolve stable identity against the LATEST stored entry at each write.
ensurePeasantEntryIds(collection); // -> Promise<{ changed }>
updatePeasantEntry(ref, patch, { usageId = null, unset = [], state = false, render = true } = {});
// -> Promise<{ ok, changed, entry? }>; null scope patches the root entry.
// Alternate scope patches that usage, found by ID at write time.
// Base scope maps mechanics to root fields and metadata to baseUsage.
// unset accepts only rollOverrides.characteristics/characteristicMode/tohit/accuracy
// in an alternate usage. Arrays replace only inside the selected scope.
setPeasantEntryUses(ref, { pool = "primary", current, max } = {});
consumePeasantEntryUses(ref, { usageId = "base", pool = "primary" } = {});
// -> Promise<{ ok, changed, entry?, spent? }>; spent records actual changed pools

// skill-editor-adapter.mjs
createSkillEditorAdapter(sheet, ref);
// -> { ref, readSource(), readEffective(), update(patch, options) }
// read* -> entry or null; update delegates to actor.updatePeasantEntry.

// skill-editor.mjs
openSkillEditor(sheet, ref, { usageId = null } = {}); // -> Promise<ApplicationV2 | null>

// skill-entry-use.mjs
startPeasantEntryUse({ actor, ref, usageId = null, pool = null, sheet = null,
  promptForTargets = true, replayContext = null }); // -> Promise<existing roll result or false>
performPeasantSkillCheck({ actor, usageContext, sheet = null,
  edgeChainContext = null, edgeExplodeReroll = null }); // -> Promise<roll outcome>
// usageContext = { version: 1, ref: UseRef, data, modifiers, signaturePool, resolution }
// data is a snapshot of resolved entry fields BEFORE transient combatMods.
// modifiers is a snapshot of actor.system.combatMods; pass it explicitly and apply once.
// Never store an Actor/Sheet/function in either snapshot.

// skill-entry-conditions.mjs
isSkillRuleEligible(when, { success = false, hit = false, manual = false } = {}); // -> boolean
isSkillEditorDefinition(effect); // -> boolean, reads the peasant-core definition marker

// skill-entry-effects.mjs
offerSkillEntryEffects({ actor, usageContext, outcome, chatMessage }); // -> Promise<void>
applySkillEffectOffer({ messageUuid, linkId, targetUuid, operationId }); // -> Promise<{ ok, changed, error? }>

// skill-usage-links.mjs — exposed as game.peasantCore.useSkillEntry
useSkillEntry({ actorUuid, collection, entryId, usageId }); // -> Promise<roll result or false>
```

Do not make editor instances, display labels, DOM indexes, or the user's currently selected tab part of a persisted reference. Preserve old public functions and old chat contexts as compatibility wrappers/readers.

## Task 1: Compatible schema and pure usage composition — Implemented

**Files:** Create `module/data/actor/skill-entry-fields.mjs`, `module/data/actor/skill-entries.mjs`, `tests/skill-entry-data.test.mjs`. Modify `module/data/actor/character.mjs` at Skills/Notable schemas; `module/documents/actor.mjs` at default constructors/normalizers; `module/data/actor/combat-tags.mjs` and `module/migration/world.mjs` at Custom normalization; `tests/sir-number-model.test.mjs` only to extend its DataField stubs for newly used field classes.

**Interfaces:** Produce the two field factories, `normalizeSkillEntry`, `resolveSkillUsage`, and `duplicateSkillUsage`. Later tasks consume their data shapes exactly as specified above.

- [ ] Write a direct Node test for a legacy Notable retaining its root fields and explicit zero, plus a genuinely blank alternate that does not inherit its Damage. Inject deterministic IDs; do not make normalization depend on Foundry at import time.

```js
import assert from "node:assert/strict";
import { normalizeSkillEntry, resolveSkillUsage, duplicateSkillUsage }
  from "../module/data/actor/skill-entries.mjs";
let sequence = 0;
const createId = () => `id-${++sequence}`;
const legacy = {
  id: "musket", name: "Musket", sig: true, usesCurrent: 0, usesMax: 4,
  accuracy: 0, tohit: 8, damage: { enabled: true, flat: 6 },
  rangeRate: [4, 8, null, null], customTags: [{ name: "Reload", value: "Manual" }],
  privateLegacyValue: "keep"
};
const entry = normalizeSkillEntry(legacy, { collection: "notableCombats", createId });
assert.equal(entry.usesCurrent, 0);
assert.equal(entry.accuracy, 0);
assert.equal(entry.privateLegacyValue, "keep");
assert.deepEqual(normalizeSkillEntry(entry, { collection: "notableCombats", createId }), entry);
assert.equal(resolveSkillUsage(entry, "base").data.damage.flat, 6);
assert.equal(resolveSkillUsage(entry, "missing").ok, false);
const blank = normalizeSkillEntry({ ...entry, usages: [{ id: "assess", name: "Assess", mechanics: {} }] },
  { collection: "notableCombats", createId });
assert.equal(resolveSkillUsage(blank, "assess").data.damage.enabled, false);
const copy = duplicateSkillUsage(entry, "base", { createId });
assert.equal(copy.entry.usesCurrent, 0);
assert.notEqual(copy.usageId, "base");
assert.deepEqual(legacy.customTags, [{ name: "Reload", value: "Manual" }]);
```

- [ ] Run `node tests/skill-entry-data.test.mjs`; verify failure is the missing new module/export, then implement.
- [ ] Extract the existing mechanical field definitions intact into `createSkillMechanicFields(fields)`. Include all legacy compatibility fields, Resource Costs, Speed, Range-Rate, Defense subfields, custom tags, enabled-as-presence fields, Uses, Sections, and tagOrder. Spread a fresh result into both root entry schemas and the alternate `mechanics` SchemaField. Do not include identity or nested usages in that factory.

```js
// Character schema integration pattern; preserve existing scalar definitions.
skills: new fields.ArrayField(new fields.SchemaField({
  // Existing Skill identity/progression fields stay here.
  ...createSkillMechanicFields(fields),
  ...createSkillEditorFields(fields)
}), { initial: [] })
```

- [ ] Define all additions from spec section 6, including `weaponType`, `gateType`, optional Duress metadata, baseUsage, typed rule/link/layout arrays, and sparse rollOverrides. Source, Source Properties, and binding fields are explicitly absent. Preserve key absence versus custom null. Add `id`, `img`, `effectIds` to Skills without changing existing field paths. Do not reuse one DataField instance between schemas.
- [ ] Normalize clones by filling only missing defaults. Preserve existing Notable IDs; give new Skills stable IDs through an injected ID generator at a write boundary. Normalize Custom IDs without deleting name/value or collapsing duplicate names. Keep `base` reserved and reject duplicate alternate IDs at authored saves; legacy duplicate IDs may receive fresh IDs while preserving entries.
- [ ] Check the older Custom-tag normalizer in `module/migration/world.mjs` as well as `combat-tags.mjs`; both currently rebuild `{name,value}`. Preserve existing Custom IDs if an older world's pending migrations run. Add world migration version 10 for both actor collections: missing/blank/`standard` Type becomes `skill`, legacy `Other` becomes transitional `Custom`, and authored non-list values remain unchanged. Add version 11 to replace built-in Types invalid for their Category using that stage's Category defaults; preserve non-list Custom names. Add version 12 to convert legacy `sig:true` entries according to spec section 6, including clearing Signature while retaining valid Type for Magic; perform the same conversion in character-model pre-schema migration so the legacy field survives document loading. Add version 13 to convert only Magic Skill entries to Spell while preserving Gate Type and sibling fields. Add version 14 to convert only Martial Skill entries to Weapon, seed blank Martial Signature Type from Weapon Type without clearing Weapon Type, and remove `sig` from all migrated entries. Add version 15 to remove `signatureUsage.label` and `signatureUsage.note` from both collections without altering any remaining Signature state or unrelated metadata. Add version 16 to rename `signatureUsage.duressEnabled` to `duressUses` and remove the old key without changing Duress counts or sibling data. Add version 17 to remove layout-level tag `label` and `note` from top-level, base-usage, and alternate-usage layouts in both collections without changing Custom tag identity or values. Add version 18 to remove organizational group rows from every top-level, base-usage, and alternate-usage layout in both collections while retaining all tag rows in their existing order. Add version 20 to remove nested base-usage and alternate-usage `description` fields from both collections while preserving entry-level descriptions and all other usage data. Include old-world and per-version fixtures so each migration stage cannot be skipped.
- [ ] Compose a usage from entry identity, including every classification scalar, plus its mechanics. Base reads root mechanics. Alternates start blank, copy explicit shared tag blocks unless replaced, apply only present roll overrides, then attach entry-level Signature state and resolved Uses/Sections scope. Do not merge nested Damage objects in a way that leaks base values into a blank alternate.
- [ ] Extend the test with shared/local tag replacement, custom null/zero overrides, all selected Characteristics, local-counter duplication starting at zero, retained effect references, and unknown fields. Add a schema-instantiation assertion using the DataField/ArrayField/SchemaField stubs in `tests/sir-number-model.test.mjs`; extend the field stub inventory with ObjectField for sparse overrides. Assert independent field instances and round-trip root paths, not a snapshot of CSS or source text.
- [ ] Run the focused test, `node --check` on touched `.mjs` files, and `git diff --check`. Deliverable: old entries survive adoption and the pure resolver chooses exactly one usage without changing data.

## Task 2: Stable writes and Signature accounting — Implemented

**Files:** Modify `module/documents/actor.mjs` (source getters/setters, ID helpers, both signature setters/consumers, Type changes); `module/applications/actor/skills/skill-row-controls.mjs`; create `tests/skill-entry-counters.test.mjs`.

**Interfaces:** Consume Task 1 normalization/composition. Produce `ensurePeasantEntryIds`, `updatePeasantEntry`, `setPeasantEntryUses`, `consumePeasantEntryUses`. Keep `consumePeasantSkillUse`, `consumePeasantCombatUse`, and existing counter setters as wrappers for the primary/base case, preserving their expected result fields.

- [ ] Build an actor harness following `tests/notable-combat-duplicate.test.mjs` and `tests/skill-force-pass.test.mjs`, with stored source distinct from effect-modified display values. Add these behavioral assertions before implementation:

```js
// actor and ref are initialized by the test harness with an exhausted 0/3 Signature.
await actor.setPeasantEntryUses(ref, { max: 5 });
assert.equal(actor.system._source[ref.collection][0].usesCurrent, 0);
await actor.setPeasantEntryUses(ref, { current: 4 });
await actor.setPeasantEntryUses(ref, { max: 2 });
assert.equal(actor.system._source[ref.collection][0].usesCurrent, 2);
await actor.consumePeasantEntryUses(ref, { usageId: "base", pool: "primary" });
assert.equal(actor.system._source[ref.collection][0].usesCurrent, 1);
await actor.updatePeasantEntry(ref, { name: "Renamed" });
assert.equal(actor.system._source[ref.collection][0].usesCurrent, 1);
```

- [ ] Run `node tests/skill-entry-counters.test.mjs` and confirm the new-method failure.
- [ ] Resolve entries by `{collection,entryId}` immediately before writes. Reuse `getActorSourceSystem`, `getPeasantSkillsForUpdate`, `getPeasantNotableCombatsForUpdate`, `updatePeasantSourceData`, and `updatePeasantStateData`. Allow only the two collections. Return `{ok:false,changed:false}` for a removed entry; never substitute the current occupant of an old index.
- [ ] Merge partial authored patches into the latest stored entry. Keep source/state work serialized through the existing write queue where available; if an actor-level queue is needed, use one promise chain for these entry mutations, not a new event system. Full-array writes must start from the latest source inside that queue.
- [ ] Remove the actor Skills-list Signature checkbox and its handler. No shared editor, Skill list, or Notable list renders a Signature checkbox; authors select Signature only through Type. Remove obsolete whole-row Signature collectors and boolean setters rather than maintaining a second write path.
- [ ] Implement selected-usage patching and explicit override removal. Reject unknown scopes and immutable ID edits. This exact call must preserve the usage's other overrides and all sibling usages:

```js
await actor.updatePeasantEntry(ref, {}, {
  usageId: "night", unset: ["rollOverrides.accuracy"]
});
// Test: accuracy key absent, existing tohit override retained, counters unchanged.
```

Do not implement Restore with an empty object merge or a stale whole-usages-array replacement. A per-client promise chain is not a distributed lock; runtime remote mutations still require the existing authoritative owner/GM route. Do not claim multi-client atomicity from the local queue.
- [ ] Normalize current/max through one policy used by both collections and the existing row controls:

```js
const nextMax = max === undefined ? previousMax : Math.max(0, Math.trunc(Number(max) || 0));
const requestedCurrent = current === undefined ? previousCurrent : Math.trunc(Number(current) || 0);
const nextCurrent = Math.max(0, Math.min(nextMax, requestedCurrent));
// Never use `if (!current) current = max`; exhausted zero is intentional state.
```

- [ ] Add optional Duress state and explicit selected-pool consumption. A consume mutation decrements the selected Signature pool if positive and the usage's existing mechanical Uses pool according to existing commitment semantics, at most once each. Sections retain their current manual behavior. Return the actual changed pools for honest chat/undo reporting. Keep zero non-negative and preserve existing permissive activation behavior.
- [ ] Derive current Signature behavior only from Type. Migration may read legacy `sig`, but current normalization, roll/chat behavior, and counter spending must not write or depend on it. Switching to another Type or category preserves current/max, Class/Rank, and mechanics even while the counters are hidden. Keep explicit clear/remove actions separate.
- [ ] Test both collections, every Signature migration case, both Signature pools, absence of current `sig` state and checkbox handlers, max grow/shrink, negative/invalid inputs, reordering during an open edit, concurrent name-edit/count-spend, deleted references, state-write markers, and a derived buff not becoming a stored base. Include the existing row maximum setter so the old refill behavior cannot survive in one UI.
- [ ] Run focused checks and existing duplicate/list/tree tests. Deliverable: stable entry writes and one shared counter policy without any collection synchronization.

## Task 3: Common native editor and complete identity header — Implemented

**Files:** Create `module/applications/actor/skills/skill-editor-adapter.mjs`, `skill-editor.mjs`, `templates/actor/apps/skill-editor-body.hbs`, `skill-editor-footer.hbs`, `tests/skill-entry-editor.test.mjs`. Modify the existing Notable editor opener, Skill description/edit controls in `module/applications/actor/skills/skill-advantage-description-editors.mjs` and `skill-row-controls.mjs`, both actor-list templates, both sheet-display context modules, and narrow `peasant-core.css` selectors. Update template preload references in `module/init.mjs` only if needed.

**Interfaces:** Consume Task 2 actor APIs. Produce `createSkillEditorAdapter` and `openSkillEditor`; retain `openNotableCombatTagEditor(sheet,index)` as a wrapper. Add a Skill Edit action that resolves its stable ID before opening; preserve existing read-description behavior.

- [ ] Retain the existing ApplicationV2 class in `notable-combat-tag-editor.mjs`, preserving its lifecycle, ProseMirror saving, image picker/popout, tabs, and effect controls. Share it through the stable adapter plus the identity/context and opener helpers in `skill-editor.mjs`. Replace direct collection/index reads and writes with the adapter. Do not create a fake Skill copy in `notableCombats` or duplicate the large editor class.

```js
// Legacy public opener forwards after ensuring IDs at this explicit edit boundary.
await sheet.actor.ensurePeasantEntryIds("notableCombats");
const entry = sheet.actor.getPeasantNotableCombatsForUpdate()[index];
return entry ? openSkillEditor(sheet, { collection: "notableCombats", entryId: entry.id }) : null;
```

- [ ] Update the common template using spec section 2's header order. Skill/Weapon/Defense/Combat Trick/Signature/Spell/Custom show Class and Rank; Spellcraft/Gate show Class only; Perk/TM show Grade only; Stance/Cantrip/Historic/Subskill show no progression control. Signature shows the primary and optional Duress counters without a checkbox anywhere, inside the standard character-sheet fieldset headed `Signature Uses`; explicitly retain its compact horizontal wrapping layout against Foundry's standard-form fieldset defaults. Preserve hidden values across Type changes and let the name occupy released header space. Order the equal-width metadata columns as Category, Type, then the applicable classification selector; Type remains no wider than Category. Preserve applicable Characteristics, To-Hit and Accuracy; Subskill hides To-Hit and Accuracy. Hide Mode for fewer than two Characteristics; show Mixed/Advantaged for two or three and relabel those choices Omni Worst/Omni Best for all four without changing their stored values. Keep all Characteristic choices on one compact line with Mode, To-Hit, and Accuracy top-aligned beside them. Match the equipment-card tab-border treatment below the identity header and below the primary tabs, with no separator above the tabs. In Skills, place Usage/options on the left and AP/SP on the right of one compact advancement row; keep Resource Costs separate. In Notables, keep Usage on its own row and allow selected-usage roll controls to be edited directly without Skill-only locks. Native buttons/inputs and shared CSS classes are the styling baseline.
- [ ] Build small patch handlers per field or field group. Reading a hidden tab must not be required to save a header field. Type choices and order are Martial: Weapon, Defense, Combat Trick, Signature, Stance, Perk, Custom; Magic: Spellcraft, Gate, TM, Cantrip, Historic, Spell, Subskill, Custom; Tradewrite/Mundane: Skill, Signature, Custom; ordinary unclassified: Skill, Custom. Custom remains available in every Category. A migrated unclassified Signature shows Signature as its current option without making Signature generally selectable while blank. Retain an allowed or authored non-list Custom Type when Category changes; use Weapon for Martial, Skill for Tradewrite/Mundane/unclassified, and Spellcraft for Magic, with Skill ↔ Weapon and Weapon → Spell rename mappings. Save Category and normalized Type together; Type is the only current Signature state. Martial Weapon shows Weapon Type, Martial Defense shows Defense Type, Martial Combat Trick shows Trick Type, Martial Signature shows Signature Type, and Magic Gate/Spell show Gate Type. Every classification selector uses a blank hidden, disabled placeholder selected only while its stored value is empty; it does not appear in the opened list, and after a real choice the blank value cannot be selected again. Each fixed list ends with Custom. A non-list stored value selects Custom and exposes an inline text input. Store trimmed custom text directly in the active scalar; selecting Custom alone does not save until a nonblank name is entered. Retain all inactive classification scalars and Signature counter values across Category and Type changes and add no source lookup or inheritance behavior. Restore Uses is an explicit counter menu action.
- [ ] Preserve focus and caret across actor rerenders; refresh a counter value when a roll changes it without replacing an unrelated unsaved text field. A deleted entry closes the editor with a brief message. Check owner permission before rendering writable controls, using the existing sheet conventions.
- [ ] Add adapter/context tests with a fake actor whose `skills` and `notableCombats` share names. Editing the Skill must call `updatePeasantEntry({collection:'skills',entryId:...}, patch)` only; assert no Notable mutation. Test blank Accuracy versus `0`, all characteristic chips, Mixed/Advantaged for two or three selections, Omni Worst/Omni Best for all four with unchanged stored values, Single-to-Mixed and return-to-Single normalization, every Type-specific progression-control combination, and inactive Type data preserved. A Characteristics field-group patch must persist the array and normalized mode together. Test method behavior and form patch generation rather than asserting exact template strings.
- [ ] Run `node tests/skill-entry-editor.test.mjs`, syntax and whitespace checks. In Foundry, log in as Codex if available and reload the changed system before inspecting both editors beside an existing Item sheet. Capture a narrow and normal-width screenshot as evidence; verify shared fonts, tabs, borders, padding, input heights, native window controls, and complete header content.
- [ ] Deliverable: same working editor style for both separate lists, including visible Signature current/max. Correct any visual drift here before continuing; no user approval pause is required for routine CSS corrections within this spec.

## Task 4: Inline tag rows — Implemented

**Files:** Modify common editor/templates; `module/applications/actor/notable-combat/notable-combat-tag-list.mjs`, `notable-combat-tag-save-controls.mjs`, `notable-combat-tag-remove-controls.mjs`, `notable-combat-tag-selection-controls.mjs`, `notable-combat-tag-editor-state.mjs`, `notable-combat-drag-drop.mjs`, existing input helpers/collectors where callback signatures require it; `module/data/actor/skill-entries.mjs`, `module/documents/actor.mjs`, scoped CSS. Create `tests/skill-entry-tags.test.mjs`.

**Interfaces:** Produce `setSkillTagData`; existing public Notable tag setters delegate to it. Reused control setup functions accept an optional `saveTag(tagType,tagData,options)` / `removeTag(tagType,options)` callback; the old actor/index behavior remains their compatibility default. Common editor callbacks resolve the active usage by ID.

- [ ] Extract the tag mutation switch from `setPeasantNotableCombatTag` and the matching remove path into the pure helper, preserving every current tag's normalization and prerequisites. Do not rewrite the dice/resource/defense input engines. Custom operations use persistent custom IDs; legacy index wrappers translate at the call boundary.

```js
const edited = setSkillTagData(data, "heal", {
  heal: { enabled: true, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 4, type: "Temporary" }
}, { mode: "edit" });
assert.equal(edited.data.heal.flat, 4);
assert.equal(data.heal.flat, 2); // input snapshot remains unchanged
assert.equal(setSkillTagData({ stability: false }, "strengthen", {}, { mode: "add" }).ok, false);
```

- [ ] Replace cloud chips with readable rows in one inventory-style bordered panel. Use a dark `Tag` / `Summary` header and contiguous divider-separated rows, reuse the existing formatter to summarize actual stored configuration, show the true tag type when a display label differs, and expand existing controls as a full-width subrow beneath the selected row. Eliminate the permanent add-tag form and redundant footer Add Tag control; copy the native Scene Levels regular square-plus inline control immediately after `Tags` in the fieldset legend to open the single searchable combobox inside a compact nested Foundry fieldset with the inline legend `Add Tag`. Do not retain a visible Tag Type select.
- [ ] Keep row editor state `{usageId,tagKey,draft}` local until explicit Save. Save patches only that usage's mechanical tag data; layout rows contain identity/order only and expose no Display Name, Note / Limit, or redundant Add/Edit Tag heading. A newly chosen tag first appears as a DOM-only provisional row rendered in the normal list with an `Add Tag` action, no menu, and no drag behavior. Clicking the open row again, pressing Escape, selecting another tag, or leaving Details removes that provisional row and discards only its draft; do not render a separate Cancel button. Validation failure keeps input/focus. Escape closes the chooser/editor appropriately without activating a usage. Do not render enable/disable toggles.
- [ ] Keep one flat, heading-free tag list. Version 18 removes stored group rows while preserving tag order and content. Reorder uses one canonical insertion gap, and Move Up/Down works without dragging. Synchronize base typed tagOrder for legacy summaries.
- [ ] Use the full current catalog. Re-selecting a unique typed tag opens it for editing; Custom permits multiple independent rows and identical Custom names. Effect links and conditions use IDs/keys, not row indexes. Deleting a tag also removes only its dangling local layout/condition references.
- [ ] Test all existing tag types round-trip through helper operations; explicitly cover multiple resource entries including HP damage type, flat versus dice healing, diceBonus versus flat, Dome duration, Resistance HALT, Range-Rate null segments, Strengthen/Stability, and deleting/reordering same-named Custom rows. Verify legacy group removal changes no tag payload values, recipients, or relative tag order.
- [ ] Run `node tests/skill-entry-tags.test.mjs`, existing `tests/notable-combat-drag-slots.test.mjs`, syntax and whitespace checks. Inspect short/long Details layouts, keyboard editing, and the native chooser opened from the legend square-plus in Foundry. Deliverable: compact inline editing with full current mechanics intact.

## Task 5: Alternate usage authoring and shared state

**Files:** Modify `skill-entries.mjs`, common editor/templates, `skill-editor-adapter.mjs`, both sheet-display contexts and narrow CSS. Create `tests/skill-entry-usages.test.mjs`.

**Interfaces:** Consume normalization, resolver and duplication from Task 1. Complete editor usage CRUD, explicit default selection, shared-tag/local replacement controls, and stored `defaultUsageId`. Do not dispatch new automation from selecting a usage.

**Implemented September 13, 2026:** Task 5 authoring is complete. The selected usage remains editor-local, actor-list display resolves the explicit stored default, and no Task 7 activation mode is exposed. Usage Notes and their stored nested descriptions were removed. Usage Options owns Add Usage and the other management commands. Skill Usage is inline with AP/SP, while Notable Usage remains below identity; Notable alternates directly edit sparse roll overrides, whereas Skills retain Customize/Restore Default. Verification is direct-Node/static plus user-guided visual iteration; the formal live Foundry matrix remains part of Task 10.

- [x] Test primary counters and identity are invariant under duplicate/switch; sparse roll overrides retain explicit null/zero:

```js
const entry = normalizeSkillEntry({ id: "aid", name: "First Aid", sig: true,
  usesCurrent: 2, usesMax: 3, accuracy: 1, characteristics: ["Mental"],
  usages: [{ id: "night", name: "Night care", mechanics: {},
    rollOverrides: { accuracy: 0, tohit: null } }] }, { collection: "skills", createId });
const night = resolveSkillUsage(entry, "night");
assert.equal(night.data.accuracy, 0);
assert.equal(night.data.tohit, null);
assert.equal(night.data.usesCurrent, 2);
assert.deepEqual(night.data.characteristics, ["Mental"]);
assert.equal(entry.accuracy, 1);
```

- [x] Implement the persistent-position native Usage dropdown with configured names and a Usage Options menu containing Add Usage plus the native menu commands, with keyboard access supplied by the browser. Keep it visible for editable single-usage entries so the Usage Options menu is reachable; hide it for read-only single-usage views. Keep selection local to the editor; set the actor-list default only through an explicit Make Default action.
- [x] Add blank, duplicate, rename, and delete operations. Base cannot be deleted as a structural record; it can be renamed and cleared explicitly. On deleting a default alternate, require the deletion dialog to select/confirm Base as the replacement default; existing pins to the deleted alternate remain unavailable rather than silently following the new default. Use existing native delete styling.
- [x] On duplication, regenerate usage/rule/custom/link IDs and remap their internal references. Preserve every entry-level classification scalar and linked effect definition ID. Primary/Duress Signature pools stay entry-level. Shared Uses/Sections stay shared; duplicated explicitly local pools start at zero current. Do not clone Actor effects merely by duplicating a usage.
- [x] Add explicit shared-tag marking, a Shared section, and whole-tag local replacement. Always edit one canonical original. `custom` shares/replaces the whole Custom block; label that command Share Custom notes rather than implying independent per-note sharing. Skill alternate roll fields use Customize/Restore Default and the Task 2 scoped unset operation. Notable alternates expose the selected usage's sparse roll fields directly, with no lock controls.
- [x] Guard switching away from an unsaved inline tag row with Save / Discard / Cancel behavior. Close the current draft only after a successful awaited save; preserve the previous usage on failure/cancel. Usage prose has no draft because that feature and its stored data were retired. Avoid storing transient selectedUsage on the actor.
- [x] Test default versus editor selection, same-named usage IDs, invalid pins, changing max while a usage editor has a stale snapshot, effect reference remapping, shared replacement not stacking, and no state writes from navigation. Run `node tests/skill-entry-usages.test.mjs` plus focused data/editor/tag tests. Deliverable: multiple usages can be authored safely; only completed existing activation modes are exposed until Task 7.

## Task 6: Entry classification integration — Implemented

**Files:** Modify `module/data/actor/skill-entry-fields.mjs`, `module/data/actor/skill-entries.mjs`, the shared editor/context, the two sheet-display modules, and focused data/editor tests. Do not create `skill-entry-values.mjs` or an inheritance subsystem.

**Interfaces:** Consume Task 1 composition. `weaponType`, `defenseType`, `trickType`, `signatureType`, and `gateType` are trimmed entry-level strings carried into every resolved usage and runtime snapshot. They classify an entry but never resolve another entry or modify mechanics.

- [ ] Add direct Node coverage for the blank hidden, disabled placeholders, every exact fixed list, Custom as the final choice, non-list stored values selecting Custom, exact Category-specific Type order/defaults, mismatch normalization, and Category-plus-Type visibility. Weapon Type runs from Unarmed through Crossbow; Defense Type is Block, Parry, Dodge, Armor; Trick Type and Signature Type concatenate those lists; Gate Type runs from Raw through Lunaris.
- [ ] Store a custom value directly in the active classification scalar. Do not add parallel custom-name schema fields. Preserve every classification scalar across category/type changes so hidden data is not destroyed.
- [ ] Remove Source Kind, Source, Source Properties, source pickers, inherited-field bindings, Use Source commands, cycle handling, name lookup, and source-link tests from the editor and data contract. Classification fields never copy To-Hit, Accuracy, dice, damage types, or other mechanics.
- [ ] Keep Gate Physicality and Type Bonus readable in usage rules; no new damage-type automation is implied. Retain manual To-Hit and Characteristics semantics from spec section 3, without automatic advancement recalculation.
- [ ] Verify base/alternate composition carries the classification fields and that legacy unshipped source/binding fields are retired without disturbing unrelated unknown fields. Run focused data/editor tests. Deliverable: fixed/custom type classification works with no source-link behavior.

## Task 7: Usage-aware activation, Signature spending, and replay

**Files:** Create `module/applications/combat/skill-entry-use.mjs`, `tests/skill-entry-use.test.mjs`, `tests/skill-entry-replay.test.mjs`. Modify only required seams in `module/applications/actor/controls/roll-actions.mjs`, `module/applications/combat/notable-combat-workflow.mjs`, `notable-combat-rolls.mjs`, `range-rate-dialog.mjs`, `manual-combat-tag-rolls.mjs`, `edge-chain-rolls.mjs`, `module/applications/chat-undo.mjs`, and relevant chat/Stress context transport owners found by tracing existing `notableCombatPostRoll` and `stressRoll` flags.

**Interfaces:** Produce `startPeasantEntryUse` and `performPeasantSkillCheck`. Existing `startNotableCombatRoll`, `performNotableCombatRoll`, `executeResolvedNotableCombatRoll`, manual tag and range callbacks gain an optional `usageContext` while their old call signatures remain valid. Resolve it once at activation; forward it through every branch and persist a plain-data copy for replay.

**First slice implemented September 13, 2026:** `startPeasantEntryUse` now resolves the selected/default usage into a versioned plain-data snapshot, retains the selected primary/Duress pool, and delegates Skill checks and Notable combat rolls through their existing engines. Actor-row activation uses stable entry IDs; new Edge contexts replay the original usage snapshot and refuse deleted entries. Roll undo records only changed counter leaves for stable references, so later renames, alternate-usage edits, and row reordering survive Undo. The focused tests cover default alternate routing, explicit Duress choice/cancel, net-one whole-chain Edge spending, deleted replay references, modifier snapshotting at the initial roll boundary, and leaf-scoped undo conflicts. Remaining work in this task is explicit Reference output, cross-resolution action dispatch, selected-usage manual tag actions, modifier snapshot transport through every downstream damage/heal/manifest branch, and the complete Edge/Stress/manual regression matrix.

**Second slice implemented September 14, 2026:** explicit Check and Targeted Use dispatch now works from either Skills or Notables, while Reference posts the selected usage description and tag summaries without prompting for or spending a Signature pool. Actor-row manual Damage/Heal/Manifest values resolve the default usage without triggering sibling tags or spending entry uses. Manual and automated damage/heal/Manifest paths receive the captured combat-modifier snapshot, and their Edge contexts/checkpoints retain stable entry/usage references across replay. Legacy index/Notable contexts remain readable. Focused tests now cover cross-collection resolution, Reference output, targeted Skill whole-chain Edge replay, selected-usage manual rolls, manual whole-chain Edge replay, and downstream modifier leaf behavior. The full 75-file direct Node suite passes; Foundry runtime/visual verification remains pending.

**Third slice implemented September 14, 2026:** stable usage validation now runs before Edge Entire Chain, Edge Individual Die, or deferred Stress can spend replay resources. Deleting the selected entry or alternate usage after the original roll leaves that original committed use intact, reports the stale reference, and spends neither Edge nor Stress. Focused integration coverage also confirms a Duress-selected whole-chain replay has exactly one net Duress spend, undo restores only that pool, and later classification or usage edits remain intact while the replay uses its immutable original mechanics snapshot. Legacy replay contexts without `usageContext` are unchanged. The remaining Task 7 work is the editor-selected activation control and the untested portions of the usage-aware failure/cancel matrix.

**Fourth slice implemented September 14, 2026:** the shared Skill/Notable editor footer now activates the usage currently visible in that editor. Its label is `Use <usage name>` for an alternate or `Use <entry name>` for Base. Activation first resolves any open tag draft through the existing Save / Discard / Cancel guard, saves the visible main fields, and delegates by stable entry and usage IDs through `startPeasantEntryUse`; it does not close the editor or replace the explicit Description save action. The remaining Task 7 work is the untested portion of the usage-aware failure/cancel matrix and live Foundry verification.

**Fifth slice implemented September 14, 2026:** Signature eligibility is now captured at activation with the rest of the immutable usage data. Counter consumption accepts that explicit snapshot-derived decision while preserving its current-Type default for legacy callers. Editing an entry from Signature to another Type after the original roll can no longer make Edge refund the original charge without re-spending it, and changing a formerly non-Signature entry to Signature cannot invent a replay charge. The regression exercises the real targeted Skill Edge path plus the actor counter boundary; later Type and other classification edits remain intact. The remaining Task 7 work is the untested portion of the failed/untrained, multi-target, zero-counter, and cancellation matrix plus live Foundry verification.

**Sixth slice implemented September 15, 2026:** the remaining automated Task 7 matrix now covers a failed untrained selected-usage check, exhausted Signature use without refill or state write, one net usage spend for a shared multi-target Manifest attack, and no spend when Manifest replacement preflight is canceled. The untrained path also carries its exact `Untrained Skill Roll` label into the shared Edge context in both current and legacy entry paths. Task 7 implementation is complete; its live Foundry exercise remains part of Task 10.

- [ ] Before editing, trace each direct `actor.system.skills[index]` / `notableCombats[combatIndex]` lookup along the chosen workflow, manual values, Range-Rate callbacks and replay. Record the touched seams in the implementation commit. Reuse damage/healing/manifestation/defense handlers and existing undo checkpoints; do not copy the combat engine into the new dispatcher.
- [ ] Add failing integration tests using the current workflow mock patterns. Core expectations: a pin to Night care reads Night care, root Skill and same-named Notable never substitute for one another, and the selected Signature pool is spent once net.

```js
// Harness starts at Daily 2/3 and Duress 1/1; mocked rolls commit once.
await startPeasantEntryUse({ actor, ref, usageId: "treatment", pool: "duress", sheet });
assert.equal(readEntry().usesCurrent, 2);
assert.equal(readEntry().signatureUsage.duressCurrent, 0);
assert.equal(lastChatContext.ref.usageId, "treatment");
assert.equal(lastChatContext.signaturePool, "duress");
// Integration harness supplies the original persisted message and current test user.
// Exercise the REAL Edge entrypoint, not a helper that calls normal activation again.
await applyEdgeChainRoll({ messageId: originalMessage.id, requesterUserId: game.user.id });
assert.equal(readEntry().usesCurrent, 2);
assert.equal(readEntry().signatureUsage.duressCurrent, 0);
await applyRollUndoRecords(getAvailableRollUndoRecords(currentChainMessage));
assert.equal(readEntry().signatureUsage.duressCurrent, 1);
```

- [ ] Extract the existing trained/untrained Skill roll code into `performPeasantSkillCheck`, preserving force-pass labels, modifiers, chat, Edge context, and undo. Actor-row click delegates with the explicit default usage; the editor delegates with its visible selected usage. Do not add a second Signature-spend callback around a workflow that already spends it.
- [ ] Create `usageContext` from the selected resolved usage data before preflight. Keep data before transient combat modifiers, snapshot actor.system.combatMods as modifiers, and pass that snapshot to the existing To-Hit/Accuracy, damage, heal and manifestation seams that currently reread combatMods. Apply it once, including on replay; do not calculate from the editor's displayed modified numbers and add modifiers again. For an enabled Duress pool, obtain an explicit choice using the existing native preflight dialog style unless a pool is already provided. No state writes occur during selection; cancel returns false. Preserve the chosen pool and resolved snapshot through retries and rerolls.
- [ ] Dispatch legacy Skills through the existing check path and legacy Notables through the existing combat path. Check performs a check plus eligible supported post-check actions; Targeted Use uses the existing target/combat workflow; Reference posts readable prose/summaries and spends nothing. Expose only valid actions for passive/reference entries. Category and presence of a tag never silently select a different resolution mode.
- [ ] Replace workflow entry rereads with `usageContext.data` where present, while using `usageContext.ref` for actual counter writes. Legacy calls without context resolve base/default at the boundary. Range prompts and manual Damage/Heal/Manifest buttons carry the selected usage; manual value rolls do not spend Signature or trigger all sibling tags.
- [ ] Route Signature and mechanical Uses through the Task 2 actor method at the existing commitment point inside `captureActorRollUndo`. Preserve native sections/split-second/manual counter behavior. Add opt-in `entryCounterRefs` to capture options and an `entryCounters` record field for new contexts; keep legacy array-snapshot readers unchanged. Extract only current counter leaves for the supplied stable entry references and omit their whole collection array from the new record. Do not drop any unrelated resource undo record.

```js
// New record extension; use ref+usageId to resolve the live entry when undoing.
entryCounters: [{
  collection: "skills", entryId: "aid", usageId: "base",
  path: "usesCurrent", before: 2, after: 1
}]
```

Allowed paths are usesCurrent, signatureUsage.duressCurrent, tagUses.current, sections.current, and speed.splitSecondCurrent. Entry-level Signature paths always use base scope; explicit local mechanical pools use their usage ID. Extend `canUndoRecord`, `collectRollUndoRecords`, permission checks, and `applyRollUndoRecords`. Before changing anything, simulate all records in reverse against current counters: each after value must match, each entry must exist, and each restored value must fit its current maximum. Then patch only the matched leaves through state writes. Refuse conflicting/newer counter state instead of replacing newer data. This preflight must handle several records for the same counter in one chain without falsely rejecting intermediate values.
- [ ] Add a regression using `captureActorRollUndo` and `applyRollUndoRecords`: spend a Signature use, rename the entry, edit another usage, reorder the list, and then Undo. Expect the count restored and all later authoring/order changes preserved. Also test a deleted entry and a subsequent unrelated spend; neither may overwrite or resurrect an entry. This is required because current undo treats arrays as one changed path and would restore the old entire list.

Use this complete core regression inside `tests/skill-entry-replay.test.mjs`; extend it with actual Edge/Stress integration using the existing replay-test harnesses. It must fail against the current whole-array capture behavior:

```js
import assert from "node:assert/strict";
globalThis.foundry = { utils: { deepClone: structuredClone, randomID: () => "counter-undo" } };
globalThis.game = { user: { isGM: true }, actors: new Map() };
const actor = {
  id: "fixture", uuid: "Actor.fixture", name: "Fixture", effects: [],
  system: { _source: { skills: [
    { id: "aid", name: "First Aid", sig: true, usesCurrent: 2, usesMax: 3, usages: [] },
    { id: "other", name: "Other skill", sig: false, usesCurrent: 0, usesMax: 0 }
  ] } },
  async update(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/^system\./, "").split(".");
      let object = this.system._source;
      for (const part of parts.slice(0, -1)) object = object[part] ??= {};
      object[parts.at(-1)] = structuredClone(value);
    }
  },
  async updatePeasantStateData(patch) { return this.update(patch); }
};
game.actors.set(actor.id, actor);
globalThis.fromUuid = async uuid => uuid === actor.uuid ? actor : null;
const { captureActorRollUndo, applyRollUndoRecords } = await import("../module/applications/chat-undo.mjs");
const getEntry = () => actor.system._source.skills.find(entry => entry.id === "aid");
const captured = await captureActorRollUndo(actor, "Signature use", async () => {
  getEntry().usesCurrent = 1;
}, { entryCounterRefs: [{ collection: "skills", entryId: "aid" }] });
assert.equal(captured.undoRecords.length, 1);
assert.equal(Object.hasOwn(captured.undoRecords[0].before, "system.skills"), false);
assert.equal(captured.undoRecords[0].entryCounters.length, 1);
getEntry().name = "First Aid revised";
getEntry().usages.push({ id: "night", name: "Night care" });
actor.system._source.skills.reverse();
const undone = await applyRollUndoRecords(captured.undoRecords);
assert.equal(undone.ok, true);
assert.equal(getEntry().usesCurrent, 2);
assert.equal(getEntry().name, "First Aid revised");
assert.equal(getEntry().usages[0].id, "night");
assert.equal(actor.system._source.skills[0].id, "other");
```

Apply the new counter leaf through `updatePeasantStateData` after resolving its current array index from stable IDs; the test's state writer supports this established actor method. Do not require a fake actor to reimplement the counter-undo algorithm being tested.
- [ ] Version new chat/replay context as `usageContext.version = 1`. Keep readers for old Skill index and Notable ID/index contexts. New contexts use stable entry/usage IDs and the original resolved snapshot. Do not replace them with the editor's current selection or a newly edited Gate value. Missing entry on replay reports unavailable and does not spend a neighboring entry. Existing applied/processing/undone guards and target-specific rollback remain in force.
- [ ] Test successful/failed/untrained checks, targeted/multi-target outcomes, canceled preflight, zero counters, primary versus Duress, failed-save force pass, deferred Stress decline/close/retry, Edge entire/individual rerolls, undo after replay, classification edits after a roll, manual tag rolls, and deleted IDs. Assert net spends and restored state, not merely function call counts.
- [ ] Run both new tests and the existing focused suites for Skill force pass, Edge Skill replay, Stress retry/replay, manifestation casting, Dome duration, and Resistance HALT. Deliverable: chosen usage and pool survive every supported execution path while old entry points keep working.

## Task 8: Explicit conditions and scoped effect offers

**Files:** Create `module/data/actor/skill-entry-conditions.mjs`, `module/applications/combat/skill-entry-effects.mjs`, `tests/skill-entry-effects.test.mjs`; modify shared editor/Effects context, Task 7 dispatch/checkpoint seams, `module/applications/chat-listeners.mjs`, `module/socket/remote-prompts.mjs`, and `module/applications/chat-undo.mjs` for registration/transport and effect undo records. Add narrowly scoped definition guards in `module/data/active-effect/_module.mjs`, `state-operations.mjs`, `key-policy.mjs`, `module/documents/actor.mjs`, and definition-aware controls in `module/applications/active-effect/active-effect-config.mjs`.

**Interfaces:** Produce `isSkillRuleEligible`, `isSkillEditorDefinition`, `offerSkillEntryEffects`, `applySkillEffectOffer`. Consume immutable Task 7 context and current success/hit/target outcomes. A linked document is referenced once by ID from tags and Effects.

**First slice implemented September 21, 2026:** `isSkillRuleEligible` now implements only the approved Always, Successful check, Hit, and Manual events, and `isSkillEditorDefinition` recognizes the marker in both live and source flags. Marked definitions are inert across Foundry-native actor change preparation, Peasant virtual HALT and grid-health calculation, active change-key collection, and immediate state-operation hooks. The Active Effect document rejects attempts to enable a stored definition, and the actor-sheet generic toggle explains the blocked action. Focused tests cover both flag shapes, every gate, enabled-definition leakage into each calculation path, generic Enable, and ordinary-effect compatibility. Effect authoring/link validation, chat offers/application, duration start, and Skill-effect undo remain.

**Second slice implemented September 21, 2026:** the shared editor now renders Whole Skill/Whole Notable and selected-usage effect scopes while retaining native effect documents, search, sort, and whole-entry `effectIds`. Usage effects are created disabled with the definition marker, linked through the actor's queued source-write boundary, and configured with only the approved event, recipient, application, and optional tag association values. Exact duplicate links, missing definitions, invalid tags, and unsupported values are rejected. Tag menus reopen the same linked Active Effect, collapsed tags show their configured condition, Unlink removes only the selected-usage reference and its rule references, and confirmed definition deletion clears references across both actor entry collections. Missing references remain visible and removable. Chat offers/application, duration start, and Skill-effect undo remain.

**Third slice implemented September 22, 2026:** final Skill-check and targeted outcomes now produce per-recipient chat offers from immutable marked-definition snapshots. Applying an offer checks the stored message, requesting user's message/target permission, saved target, operation status, and forbidden state keys; target-local serialization and generated-effect operation metadata prevent duplicate creation and recover uncertain chat updates. Applied copies start duration at application, retain origin identity, and are captured in distinct Skill-effect undo records rather than the Spell-effect filter. Old offers retire on Undo or Edge supersession. Until complete replay re-offering/rollback is implemented, Edge, Stress, and Fall rerolls explicitly refuse a chain with an already-applied Skill effect offer; a user can finish rerolls before accepting the offer. Focused and full direct Node checks pass. Remaining Task 8 work includes complete replay re-offering/rollback coverage, UI/runtime verification, and the broader rule/tag condition fixtures; do not mark Task 8 complete yet.

**Fourth slice implemented September 22, 2026:** pending offers on in-place Skill-check cards are recomputed from the saved usage context after Edge Individual Die, Edge Explode, deferred Stress, and Blessing of Fall. Fresh eligible outcomes receive new operation IDs; ineligible outcomes clear old offers, so superseded buttons cannot apply. Focused tests cover success-to-success, success-to-failure, failed-to-success, and old-button rejection. This does not remove the applied-offer replay guard or cover per-target in-place replay; those still require effect rollback and per-target outcome fixtures. Task 8 remains incomplete.

**Fifth slice implemented September 22, 2026:** when downstream combat replay returns a per-target final outcome, the in-place reroll refreshes pending offers on the attack card from those exact target results. A regression changes eligibility from one target to another and rejects the original target's button. If the old post-roll undo was the attack card's entire undo record, successful replay reopens its current undo state before attaching fresh offers; otherwise the card would remain retired. Replays that do not rebuild downstream outcomes still retain their previous pending offers, and rerolls after an applied offer remain blocked until rollback on failed reruns is covered. Task 8 remains incomplete.

**Sixth slice implemented September 22, 2026:** the combat replay planner now returns its already-computed final per-target outcomes when downstream options are unchanged. In-place Edge Individual Die, Edge Explode, and Blessing of Fall use those outcomes to replace pending effect-offer operation IDs without rerunning downstream effects. A no-replay regression rejects the previous offer ID. Rerolls after an applied offer remain guarded pending safe rollback coverage; Task 8 remains incomplete.

**Task 8 completed September 22, 2026:** the applied-offer guard was replaced with reversible Skill-effect undo on Edge Individual Die, Edge Explode, Entire Chain, deferred Stress, and Blessing of Fall rerolls. Successful rerolls retire the old applied copy and issue a new outcome-scoped offer; failed rerolls restore the prior copy and offer state. Tag conditions and unsupported limit notes are authored per tag, checked against saved outcomes at manual application, shown beside the tag and in chat, and cleared/remapped with tag/usage changes. Automatic Heal, Damage, and Manifest Dome/Resistance handlers honor Manual gates; Manifest preflights do not prompt for gated-off casts. Direct Node regression coverage passes; Foundry visual/runtime verification is reserved for Task 10, not claimed here.

**Completion review hardening:** a partially failed undo now compensates records already attempted, including an applied Skill effect deleted before a later record throws. The GM effect-offer socket handler derives requester identity from Socketlib's authenticated sender context, never from payload data; simultaneous requests from different users keep separate permission results. Direct Node regressions cover both cases.

- [x] Write the pure eligibility test first:

```js
assert.equal(isSkillRuleEligible("success", { success: false }), false);
assert.equal(isSkillRuleEligible("success", { success: true }), true);
assert.equal(isSkillRuleEligible("hit", { success: true, hit: false }), false);
assert.equal(isSkillRuleEligible("manual", { success: true }), false);
assert.equal(isSkillRuleEligible("manual", { manual: true }), true);
```

- [x] Implement only Always / Successful check / Hit / Manual conditions. Conditions reference explicit tag keys and/or effectLinkIds and combine by AND with a linked effect's own event. Layout order never gates anything. Validate/remap both reference lists on deletion/duplication. Associate a Details row with the link's optional tagKey so it opens the same Effects configuration. Show the configured condition beside each affected collapsed tag. Keep unsupported rule text as clearly manual Custom content.
- [x] A manual gated application reads the saved final success/hit/target outcome from the original chat context and sets only manual:true before testing every rule. It must not infer success from clicking Apply, use a new check result, or bypass a success/hit gate. Legacy standalone manual value rolls keep their existing meaning and do not masquerade as eligible gated applications.
- [x] Feed eligibility into existing supported handlers at their normal stage. Pre-use costs/timing are not moved behind a success condition. Reject authored success/hit gates on a pre-use cost/timing tag with an inline explanation instead of creating impossible execution order. Evaluate target outcomes separately; one successful target must not unlock effects on failed targets. A tag with an unsupported limit uses a Manual gate, not unrestricted automatic application with an advisory note; the First Aid fixture demonstrates this for Heal when its Temporary HP limit cannot be enforced by the current handler.
- [x] Add Whole Skill/Whole Notable and selected-usage Effects sections. Keep native effect document editing/search/sort and existing whole-entry `effectIds` behavior. New usage definitions are disabled with `flags.peasant-core.skillEditorDefinition = true`. Link from a tag and from Effects to the same configuration. Unlink never silently deletes a shared definition. Reject duplicate identical links within a scope rather than applying the same definition twice accidentally.
- [x] Enforce definition isolation below the UI. `isSkillEditorDefinition(effect)` checks the marker on current/source flags. Exclude marked definitions from native change filtering, virtual HALT, grid-health and state-operation application; prevent generic Enable actions from activating them. Existing unmarked Skill effects retain all current behavior. Do not start/expire a definition's configured duration while stored; start the applied copy using current Foundry v14 duration/start fields at application. Reject immediate state-operation change keys in new offers using the existing `isPeasantActiveEffectStateKey` classifier; asynchronous native state-operation hooks are not made undo-safe just by wrapping document creation.
- [x] Implement Manual and Offer in chat only. Offer records must contain the resolved origin, link ID, exact eligible target UUIDs, template snapshot, and an operation ID in the originating message flags. Applying revalidates the requesting user's permission, the eligible target and operation status; it does not accept arbitrary effect data from the browser button. Use the existing owner/GM socket route, return explicit success/failure, and attach effect creation undo records.

```js
// Template-to-applied-copy boundary, inside the permission-checked handler.
const applied = foundry.utils.deepClone(offer.template);
delete applied._id;
applied.disabled = false;
delete applied.flags?.["peasant-core"]?.skillEditorDefinition;
// Add origin/use/link/operation metadata; create through the existing actor effect path.
```

- [x] Serialize application per offer/target under the same authoritative owner/GM, with persisted processing/applied state. Repeated clicks return the prior result or unchanged status. Chat update failure after creation must be recoverable by finding the created effect's operation metadata, not creating another effect. Integrate rollback/replay so repeated eligible results do not duplicate effects. Existing Dome/Resistance uses its specialized handler, not this template-copy path.
- [x] Extend `captureActorRollUndo` with `includeSkillEffects` and a separate `skillEffects: {before,after}` record extension for generated type:skill documents carrying flags.peasant-core.skillUseOrigin. Current includeSpellEffects filters out Skill effects and cannot undo an offered Staunched effect. Extend record recognition, transport and rollback to this extension, preserve created IDs where appropriate, and do not capture/delete unrelated native effects. Keep existing spellEffects behavior intact. On Undo or replay, retire the old offer; a fresh eligible replay creates a new offer identity, and old chat buttons cannot apply a superseded result.
- [x] Test failed success gates, per-target eligibility, manual-only notes, missing effects, disabled templates not affecting the source, duplicate clicks/remote retries, permission denial, effect definition edited after offer creation, unlink versus delete, and Undo/replay. Confirm First Aid's Heal limit is visible; do not claim automated Bleed removal or temporary-HP limit enforcement unless using an already applicable supported handler.
- [ ] Include tests for a template enabled from a generic effect list, forbidden immediate state-operation keys, template duration not running while stored, Skill-effect-only undo records being retained when record.before is empty, old offer buttons after a replay, and manual application after a failed check. Those cases cannot be satisfied by template styling or spellEffect-only undo tests.
- [ ] Run `node tests/skill-entry-effects.test.mjs`, the new use/replay tests, and existing effect/manifestation/undo tests touched by integration. Deliverable: actual scoped effect offers with explicit manual boundaries; no generic scripting system.

## Task 9: Stable usage links and hotbar compatibility — Implemented (automated-only)

**Files:** Create `module/applications/skill-usage-links.mjs`, `tests/skill-entry-links.test.mjs`; modify `module/applications/notable-combat-hotbar.mjs`, `module/applications/combat/api.mjs`, `module/init.mjs`, shared editor menus, and the existing enriched-content click registration seam.

**Interfaces:** Produce `useSkillEntry({actorUuid,collection,entryId,usageId})`, exposed under `game.peasantCore`. Consume Task 7 dispatcher. Keep old Notable macros and `rollNotableCombatHotbarMacro` working, including explicit-missing-ID behavior.

- [x] Register the API with the existing `registerPeasantCombatApi()` lifecycle, including ready-time registration after Foundry's game object replacement. Do not register it only on the early game object.
- [x] Encode Copy Link with an explicit custom enricher format and escape both link labels and attributes. Use URI component encoding for each identifier so delimiters cannot be injected:

```text
@PeasantUsage[actorUuid|collection|entryId|usageId]{display label}
```

The parser decodes each component, allows only the two collections, and passes the four identifiers to `useSkillEntry`. Display names are never executable input. Register with the existing Foundry TextEditor enrichment/click conventions; do not implement a second rich-text editor.

- [x] Generate usage-specific macro commands that call `game.peasantCore.useSkillEntry` with serialized identifiers. Reuse Notable hotbar permission/deduplication patterns. Two usages of one entry get distinct macros; renaming a usage keeps the same target identity. Explicit stale usage IDs notify and return false.
- [x] Test these cases using the harness style from `tests/notable-combat-hotbar.test.mjs`:

```js
await useSkillEntry({ actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "treatment" });
assert.equal(lastDispatch.ref.collection, "skills");
assert.equal(lastDispatch.usageId, "treatment");
await useSkillEntry({ actorUuid: actor.uuid, collection: "skills", entryId: "aid", usageId: "deleted" });
assert.equal(dispatchCount, 1); // stale explicit ID must not run Base
```

- [x] Cover renaming/reordering, duplicate labels, copied enriched links, special characters, missing actor/entry, permission restrictions, existing explicit-ID Notable macros, and API availability after ready. Run `node tests/skill-entry-links.test.mjs` and `node tests/notable-combat-hotbar.test.mjs`. Deliverable: stable usage shortcuts without changing actor-list membership. Successful execution of legacy index-only macros remains a live compatibility check in Task 10; the old index fallback path was not changed by Task 9.

## Task 10: Full verification and implementation handoff record

**Files:** Create `docs/superpowers/plans/2026-09-07-skill-and-notable-editor-validation.md` during implementation; change source only to fix failures attributable to this feature. Do not create/update real game content as part of documentation verification.

**Interfaces:** Consume every prior task. Produce recorded test outcomes and Foundry visual/runtime evidence with version/date and clear limitations.

- [x] Run the focused `tests/skill-entry-*.test.mjs` scripts, then syntax-check every touched JS module and run `git diff --check`. Use direct Node commands; do not add npm just to run tests. PowerShell example for all direct test files, preserving individual exit codes:

```powershell
$pcTestFailures = @()
$pcTests = Get-ChildItem -LiteralPath tests -Filter '*.test.mjs' | Sort-Object Name
foreach ($pcTest in $pcTests) {
  & node $pcTest.FullName
  if ($LASTEXITCODE -ne 0) { $pcTestFailures += $pcTest.Name }
}
if ($pcTestFailures.Count -gt 0) {
  throw ('Failed tests: ' + ($pcTestFailures -join ', '))
}
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed' }
```

- [x] Run the full direct Node suite once integration is complete. Separate pre-existing failures from introduced failures using the recorded baseline; never describe a partially passing suite as passing. No need to repeat unchanged full suites after documentation-only edits.
- [ ] Reload Foundry 14 and inspect as Codex if available. Use disposable fixtures for all spec section 9 examples in **both** collections. Demonstrate Musket, Dome, First Aid, a signature First Aid, a Martial Signature with Duress, Alchemy, and passive/special Types. Inspect Description, Details, Effects and the actor-list counter displays.
- [ ] Verify long names, 520px width and normal width, multiple Characteristics including Social, blank versus zero/negative Accuracy, inline validation, keyboard Add/Edit/Move controls, collapse/expand, unsaved draft handling, category/Type changes, legacy group removal, and native sheet styling beside an unchanged current Item sheet.
- [ ] Exercise primary/Duress choices, canceled activation, alternate usage roll, manual tag value, default versus pinned usage, Edge entire and individual replay, deferred Stress retry, effect offer/permission/double click, and Undo in Foundry where feasible. Confirm exactly one net spend and no refill on editing or duplication. Confirm active Dome HP/duration remains in the live effect rather than overwriting configuration.
- [ ] Import a disposable legacy actor fixture with tags, effects, exhausted Signature counts, AP/SP, special Types and old hotbar references. Save/reload/reorder it; compare serialized authored data and verify the original root paths and both separate lists survive. Also test an actor with effect-modified values to catch persisting derived values.
- [ ] Record actual screenshots, browser/runtime checks performed, commands and failures in the validation document. If no live Foundry access is available, label visual/runtime verification incomplete; Node tests alone do not establish styling or live permission behavior.
- [ ] Review the final diff against the spec coverage table below, remove only this feature's orphaned code/templates, and preserve unrelated edits. Report the changed behavior, tested boundaries, remaining manual signature-family rules, and deferred automation without claiming more than was implemented.

## Coverage checklist

| Requirement | Task(s) |
| --- | --- |
| Separate Skills/Notables, same editor, legacy fields preserved | 1–3 |
| Actual native styling, compact complete identity, AP/SP preserved | 3, 10 |
| Category, Type, all fixed/custom classification fields, all Characteristics, Accuracy | 1, 3, 6 |
| Signature Type only, visible current/max, optional Duress, zero preserved | 1–3, 7, 10 |
| No new family synchronization or implicit refills | 2, 5, 7 |
| Full existing tag catalog, inline editing, tag-only ordering, no tag toggles | 4 |
| Alternate usages, shared/local values, safe duplication | 1, 5 |
| Direct classification fields; no source inheritance | 6 |
| Default/pinned activation, single net spend, Edge/Stress/undo | 7, 9–10 |
| Conditional tag summaries, scoped effects, manual rule boundaries | 8 |
| Native references/hotbar, stable IDs after rename/reorder | 9 |
| Musket, Dome, First Aid, Signature and Tradewrite coverage | 10 |
| No preview/simulator or new generic rules engine | All tasks |

## Prompt to give Sol

For a bounded first implementation/demo, give Sol this prompt first:

```text
Implement milestone A (Tasks 1–4) of docs/superpowers/plans/2026-09-07-skill-and-notable-editor.md, reading its design spec and audit. Preserve separate Skills and Notables, current Foundry styling, all existing entry data, and visible Signature counters. Include the approved direct classification fields and fixed lists plus Custom, with no Source fields or inheritance subsystem. Use Signature Type as the only Signature control and expose no Signature checkbox. Treat this as an authoring/UI milestone: expose only completed runtime actions and demonstrate it with disposable fixtures. Complete its focused checks and visual review, then report the milestone result and the remaining execution/effect work.
```

For the complete implementation, the full-scope prompt remains:

```text
Implement docs/superpowers/plans/2026-09-07-skill-and-notable-editor.md using its companion design spec and local AGENTS.md. Keep Skills and Notables separate and preserve current Peasant Core/Foundry styling. Use the approved fixed-list Weapon, Defense, Trick, Signature, and Gate classifications plus Custom; do not add generic Source fields, links, or inheritance. Use Type as the sole Signature state and expose no Signature checkbox. Work task by task, keeping changes narrow and testing each completed behavior. Pay particular attention to Signature current/max and optional Duress counts, preserving exhausted zero, shared counts across usages, and one net spend through Edge/Stress replay and Undo. Read the current dirty worktree before changing files; do not discard or stage unrelated work. Start with Tasks 1–4 and verify the shared editor visually in Foundry before extending usages and effects. Continue through the remaining tasks, recording actual validation and any live-runtime limitations. Do not add excluded features or automatic signature-family accounting.
```

Planning status: document prepared from the current source and selected concepts; no implementation changes or runtime-test claims are made by creating this plan.
