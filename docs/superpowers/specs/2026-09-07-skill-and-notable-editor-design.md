# Shared Skill and Notable Editor Design

September 7, 2026. Implementation handoff for Sol. This document specifies the accepted layout and makes the remaining implementation choices explicit. It does not authorize merging Skills and Notables or implement any game changes.

Audited September 7, 2026: see the [plan audit](../plans/2026-09-07-skill-and-notable-editor-audit.md). Treat the first four tasks as an authoring/UI milestone, with later activation and effect work separately testable. An intermediate UI demo is not evidence that the full runtime integration is production-ready.

Amended September 9, 2026: generic Source Kind/Source links and inherited-field bindings are removed. Martial and Magic entries instead use direct rulebook-backed Weapon Type and Gate Type classifications, each with a Custom option. Type `Standard` is renamed to `Skill` in display and stored data, while `Other` becomes the Custom authoring path through a versioned legacy migration. Type choices are Category-specific, and migration version 11 replaces existing mismatched built-in Types with the applicable Category default while preserving authored non-list Custom names. Signature is subsequently promoted from an independent checkbox to a Category-limited Type. The actor Skills list retains its Signature checkbox as a Skill/Signature shortcut; the shared editor and Notable list do not expose a Signature checkbox.

Amended September 10, 2026: Magic no longer offers Skill. Its former Skill position becomes Spell followed by Subskill. Spell retains Skill-style Class, Rank, To-Hit, and Accuracy and also exposes Gate Type; Subskill exposes none of those progression or roll fields and no Gate Type. Migration version 13 converts existing Magic Skill entries to canonical Type `Spell` while leaving non-Magic Skill entries unchanged.

Further amended September 10, 2026: Martial replaces Skill with Weapon and adds Defense and Combat Trick. Weapon retains Weapon Type; Defense uses Defense Type; Combat Trick uses Trick Type; and Martial Signature uses Signature Type. Defense Type offers Block, Parry, Dodge, and Armor. Trick Type and Signature Type offer every fixed Weapon Type followed by every Defense Type. All classification selectors end with Custom. Migration version 14 converts Martial Skill to Weapon, seeds blank Martial Signature Type from its former Weapon Type while preserving that field, and removes the retired `sig` boolean. No Signature checkbox remains anywhere; Type is the sole Signature state.

Also amended September 10, 2026: Signature Uses no longer has a configurable counter label or recovery/note. Version 15 permanently removes `signatureUsage.label` and `signatureUsage.note` from Skills and Notables while preserving the primary and optional Duress counters.

Amended September 11, 2026: the optional counter switch is labeled `Duress Uses` and uses canonical stored boolean `signatureUsage.duressUses`. Version 16 migrates legacy `signatureUsage.duressEnabled` values and deletes that old key without changing either Duress count.

Amended September 13, 2026 after implementation review: all four Characteristic choices remain on one compact horizontal line, with Mode, To-Hit, and Accuracy top-aligned on that same line at the 560px minimum editor width. In Skill editors, Usage/options and AP/SP share the following compact advancement row; in Notable editors, Usage remains on its own row. The Usage label sits above its select. Add Usage belongs in the Usage Options ellipsis menu rather than a separate button or searchable browser. Editable single-usage entries retain this row so Add Usage remains reachable; read-only single-usage views may hide it. Notable alternate usages expose Characteristics, Mode, To-Hit, and Accuracy directly without lock controls, while Skill alternates retain Customize/Restore Default. Usage Notes and nested usage descriptions remain retired.

Also amended September 11, 2026: tag layout Display Name and Note / Limit metadata is retired. Expanded rows contain only their tag-specific mechanical controls, appear as a full-width subrow without a card gap or separator seam, use tighter padding/gaps, and omit the redundant `Edit Tag:` / `Add New Tag:` heading. Version 17 removes legacy tag-row `label` and `note` keys from top-level, base-usage, and alternate-usage layouts in Skills and Notables while preserving Custom tag names, values, and IDs. The Details panel now presents Tags as a Foundry-style fieldset title with the native Scene Levels regular square-plus inline control immediately after it; that control opens the chooser. It has no separate toolbar, large Add Tag control, or Add Group option. Its list reuses the inventory/notable/effects appearance: one shared bordered panel, a dark `Tag` / `Summary` header band, and contiguous divider-separated rows. Version 18 removes all stored organizational group rows from those layout scopes while retaining tag-row order and payloads.

The tag list's compact spacing is explicit: the first tag has no top divider beneath the inventory header, inherited tag-list padding and minimum height are reset to zero, and every row uses the same 38px minimum height with tight vertical padding. The Tags fieldset uses 10px top padding, the open Add Tag chooser uses a 4px top margin beneath the outer legend, and the nested browser has no additional top margin.

Expanded mechanical controls use one wrapping row whenever their content permits it. Damage and Heal place the dice expression beside Type; Speed places its selector beside conditional Max Uses; Manifest Dome and Manifest Resistance place Duration or HALT beside the dice expression; and Custom places Name beside Value. Shared compact tag selectors use a stable responsive width equal to 25% of the available row, bounded from 120px through 140px, so they expand with the editor without responding to option text length. Resource Costs uses one compact row per cost and places a small Add Cost action beneath the rows. Existing single-field tags remain single-line, Strengthen uses one guidance sentence, and Defense retains its necessary sectioned layout. Remove the expanded input area's legacy minimum height and vertical padding. Wrapping at narrow editor widths is allowed, and this layout changes no tag data or mechanics.

The shared Skill and Notable editor window remains resizable but matches the equipment-window width with a 560px by 420px minimum whenever it is not minimized. Existing internal panel scrolling preserves access to content at the minimum size.

The shared editor must also match the equipment window's compact spacing immediately below the title bar. Because Foundry's `standard-form` class is applied to the outer shared editor application, suppress its outer flex gap there while retaining the existing 12px window-content padding and all spacing within the editor form.

The Add Tag surface contains only one visible searchable combobox inside a compact nested Foundry fieldset whose inline legend reads `Add Tag`; it does not retain a separate Tag Type dropdown, and the input retains the `Search tags` placeholder. Opening or focusing the field displays the complete fixed tag catalog using the established Active Effect change-key dropdown treatment, and input filters the labels case-insensitively. Pointer selection and Arrow Up/Down plus Enter are equivalent; Escape, Tab, and focus departure close the menu. A selected label resolves to the existing canonical tag type and opens its current tag-specific draft. Free typing never creates an arbitrary type, so unmatched text has no saveable value and Custom remains the explicit authored-tag option. Reset clears both the canonical selection and displayed label. This is presentation and selection behavior only, with no data migration.

For a tag that is not already stored, selection appends a DOM-only provisional row at the end of the standard tag list and expands the draft directly beneath it. Reuse the normal row renderer so its background, divider, chevron, name, summary alignment, and active highlight are indistinguishable from persisted rows. Reserve the final control column but omit its options button and disable dragging until persistence. The provisional action is `Add Tag`; an existing expanded row uses `Save Tag`. Clicking the provisional row again, pressing Escape, choosing another tag, leaving Details, or closing the editor removes the provisional row without an actor update. Successful Add rerenders it from stored tag data. No migration is required.

Tag interaction uses the Description/Details/Effects tab treatment instead of an orange row outline. Hover, focus, and the expanded state apply the same light text and red glow to only the disclosure chevron and canonical tag name; the mechanical summary, options menu, row background, and borders remain unchanged.

The approved section-wide Add treatment extends the Tags precedent without changing any add behavior. Actor-sheet Skills, Notable Combats, Active Effects, Combat Adjustments, Inventory, and Flexible Advantages, the shared Skill/Notable editor Effects panel, and the SIR Locations and National Origins settings groups place a regular square-plus `icon inline-control` directly after the title in a `control` legend with a 4px gap. These controls appear only where the corresponding surface is editable, retain their existing tooltips and accessible labels, and replace the large trailing Add buttons. Settings-list end reordering remains available through the list boundary. The Item sheet's Effects Add button remains unchanged.

## 1. Outcome and scope

Give **Skills and Notables the same compact editor**, while retaining `system.skills` and `system.notableCombats` as separate collections, separate actor-sheet lists, and separate entries. Reuse the existing Notable editor, tag controls, actor write methods, and roll workflows. Category classifications never synchronize or convert entries between the lists.

The required delivery includes the common editor, category/classification/characteristic metadata, visible To-Hit and Accuracy, signature counters, named alternate usages, inline tag editing, and scoped effect links. Existing roll and manifestation behavior must remain intact. New conditional effects have the bounded behavior in section 8; arbitrary written rules do not become executable code.

### Global constraints

- Target Foundry VTT 14; add no dependency, build system, front-end framework, or new Item document type.
- Keep `system.skills` and `system.notableCombats` separate; never merge, mirror, or auto-convert entries.
- Actual Peasant Core and Foundry styling is authoritative; concept images govern layout and interaction only.
- Keep the labels Category, Type, Weapon Type, Defense Type, Trick Type, Signature Type, Gate Type, Characteristics, Class, Rank, To-Hit, Accuracy, Signature, Usage, Uses, and Sections distinct.
- Preserve authored values and unrecognized legacy data; do not persist Active Effect-derived values over stored bases.
- Preserve unrelated dirty files and existing combat, Stress, Edge, undo, and manifestation behavior.
- Do not add tag enable/disable controls or a skill preview/simulator.
- Keep custom rules available in every category; category suggestions must not hide the full supported tag catalog.
- Switching a tab or usage, opening an editor, and renaming or duplicating a usage must not spend or replenish resources.
- Do not add automatic signature-family accounting, bridging charges, rest resets, Duress detection, or advancement calculations in this delivery.

The last constraint bounds **automation**, not information: retain relevant rules text and permit explicit manual counters. The supplied rules describe more signature accounting than the existing system implements. A UI redesign must not pretend that family accounting already works.

## 2. Visual authority and layout

Read the two adjacent reference images. They are layout references, not pixel specifications, and omit the final signature-counter requirement.

![Three selected concept sheets](assets/skill-and-notable-editor/final-sheets.png)

![Selected interaction details](assets/skill-and-notable-editor/final-interactions.png)

Use the current ApplicationV2 window, shared `.pc-item-header`, `.pc-item-identity`, `.pc-item-name`, `.pc-item-tabs`, `.pc-input`, `.pc-select`, `.pc-foundry-section`, and existing effect browser treatment. Add only narrowly scoped layout rules under a common `.pc-skill-editor` class. Do not copy raster fonts, gold borders, oversized typography, backgrounds, or button shapes. Keep the existing title bar, portrait behavior, native icons, focus treatment, and theme variables.

Header order:

1. Portrait and editable name; Skill/Weapon/Defense/Combat Trick/Signature/Spell/Custom show Class and Rank, Spellcraft/Gate show Class only, Perk/TM show Grade only, and Stance/Cantrip/Historic/Subskill show no progression box. The name expands into space released by omitted controls.
2. Category, Type, and then the applicable Weapon Type, Defense Type, Trick Type, Signature Type, or Gate Type.
3. All selected Characteristics; reveal Mixed / Advantaged for two or three selections, relabeling those same stored choices Omni Worst / Omni Best when all four are selected. Keep all four checkboxes on one compact horizontal row. Mode belongs visually with Characteristics and remains on that top-aligned line with To-Hit and Accuracy; reduce inter-option gaps and control widths enough to avoid clipping at the 560px minimum rather than falling back to a 2-by-2 grid.
4. To-Hit and Accuracy in fixed, labeled positions. When Type is Signature, include Current, Maximum, the Duress Uses switch, and optional Duress Current/Maximum in this persistent identity area without a configurable counter label or recovery/note. Present them in the standard character-sheet fieldset with a `Signature Uses` legend, retaining a compact horizontal row that wraps only when width requires it. The editor's counter layout overrides Foundry's standard-form fieldset column and spacing defaults without replacing the standard border or legend treatment. Keep every Current/Maximum numeric input at 72px. Size the Duress field wrappers to the intrinsic width of their labels so the Duress Current/separator/Maximum group has no unnecessary fixed-width space, and left-align their 72px inputs beneath the labels. Enforce a 72px maximum on the Duress inputs so shared full-width control styling cannot enlarge them, and use 4px horizontal padding for a tighter interior. Keep the `Duress Uses` toggle content-sized with a 3px checkbox-to-text gap so unused flex space does not separate it from the Duress counts.
5. Usage selector immediately below identity, above the tab content it governs. In Skills, place Usage/options on the left and AP/SP on the right of one compact advancement row. In Notables, keep Usage on its own row.
6. Description / Details / Effects; compact single-column body.

Do not cram every field onto one horizontal strip. Start from the existing editor width; at approximately 520 CSS pixels, wrap the header and counters without horizontal scrolling. At wider sizes use the available space without turning the body into a dashboard. All configured tag summaries stay visible when their controls are collapsed.

Use the same strong Foundry tab-border treatment as equipment cards for the separators below the Category/Type header and below the Description/Details/Effects tabs. Do not render a separator immediately above those tabs. Reuse `--color-tabs-border` and its equipment fallback; do not introduce a separate separator color or spacing change.

Description is whole-entry prose. Usage-specific prose and its editor are removed; usage data contains no nested description field. Effects continues to show the selected usage. Keep Usage visible for editable entries even when only Base exists so Add Usage remains reachable from Usage Options; hide it only for read-only single-usage views. The selector must not jump position between tabs.

For applicable rollable entries, blank To-Hit/Accuracy remains blank in authoring and is distinguishable from zero. Retain the existing runtime fallback behavior for untouched legacy entries. Passive Types retain their Type/Grade and do not show unusable roll controls; they must not masquerade as Skill entries just to fit the header.

## 3. Identity and sandbox flexibility

**Category:** Martial, Magic, Tradewrite, Mundane. New entries offer these four choices; existing unclassified entries show a blank hidden, disabled placeholder until the user chooses. The placeholder does not appear in the opened list, and once a real value is selected, blank cannot be selected again. Do not infer category from a name such as First Aid or Fireball. Category constrains the available Type choices; Signature is valid only for Martial, Tradewrite, and Mundane, with a narrow display exception for migrated unclassified Signatures.

**Type:** Choices depend on Category and retain this exact order: Martial offers Weapon, Defense, Combat Trick, Signature, Stance, Perk, Custom; Magic offers Spellcraft, Gate, TM, Cantrip, Historic, Spell, Subskill, Custom; Tradewrite and Mundane offer Skill, Signature, Custom. An unclassified entry normally offers Skill, Custom; a migrated unclassified Signature additionally shows Signature directly after Skill as its current value, but a new unclassified entry cannot select it. Skill retains canonical value `skill` outside Martial; Weapon, Defense, Combat Trick, Signature, Spell, and Subskill use those exact canonical names. Skill, Weapon, Defense, Combat Trick, Signature, Spell, and Custom show Class/Rank. Spellcraft and Gate show the existing Class field without Rank or a separate C# field; Perk and TM replace Class/Rank with the existing Grade field; Stance, Cantrip, Historic, and Subskill show none of those controls. Weapon, Defense, Combat Trick, Signature, and Spell retain To-Hit and Accuracy; Subskill hides both. Custom is a selector sentinel available in every Category: choosing it reveals one text input, and a nonblank trimmed name replaces the sentinel directly in `type`. No `customType` field is added. A stored non-list value selects Custom and round-trips through that input.

Changing Category retains the current Type only when it remains allowed or is an authored non-list Custom value. A mismatched built-in Type is replaced automatically with that Category's default: Weapon for Martial, Skill for Tradewrite, Mundane, and unclassified entries, and Spellcraft for Magic. Skill becomes Weapon when entering Martial. Weapon becomes Skill when entering Tradewrite, Mundane, or unclassified, and becomes Spell when entering Magic. Thus changing a Signature to Magic selects Spellcraft and disables Signature behavior, while changing Spell or Subskill away from Magic selects the destination Category default. Migration versions 11–14 apply the staged normalization described in section 6. Changing Category or Type preserves hidden Class, Rank, Grade, Signature counter values, and every classification scalar. Keep the Type selector no wider than Category. The metadata row is ordered Category, Type, then the applicable classification selector, using three equal-width columns.

**Classification selectors:** Martial Weapon shows Weapon Type. Martial Defense shows Defense Type. Martial Combat Trick shows Trick Type. Martial Signature shows Signature Type; Tradewrite and Mundane Signature show no classification selector. Magic Gate and Magic Spell show Gate Type. Every other Category/Type combination shows none. These are direct scalar classifications stored in `weaponType`, `defenseType`, `trickType`, `signatureType`, or `gateType`, not links to another Skill, Notable, or equipped Item; Gate Type is not a damage type. Each selector uses a blank hidden, disabled placeholder followed by its fixed list plus Custom. The placeholder is selected only while the stored value is empty, does not appear in the opened list, and cannot be selected again after a real choice. A custom value is stored directly in the applicable scalar. Preserve every inactive field when Category or Type changes so switching back does not destroy authored data. Generic Source Kind and Source fields do not exist in this editor or data contract.

**Characteristics:** Store all selected values from Strength, Dexterity, Mental, Social. Zero or one selected value is canonically Single and hides the Mode selector. Two or three selections reveal Mixed and Advantaged. All four relabel those same stored `mixed` and `advantaged` modes as Omni Worst and Omni Best; the label change adds no new data values or migration. Missing, legacy, or Single mode normalizes to Mixed. Returning to fewer than two selections resets the hidden mode to Single. Persist the Characteristics array and normalized mode together whenever a checkbox changes. Mixed/Omni Worst refers to the worst applicable base Characteristic, Advantaged/Omni Best to the best. In this system's To-Hit convention the lower base target is better, so a future/explicit calculation must not reverse min and max. This delivery records the characteristic set and mode and preserves manual To-Hit; it does not invent class/rank advancement arithmetic. Selecting Characteristics alone must not overwrite a manually configured To-Hit. Effects referring to an included Social characteristic must still be able to inspect Social when another characteristic determines the roll.

AP and SP remain Skill advancement fields, distinct from Resource Costs. They remain editable to the right of Usage in the skill editor's compact advancement row and in the existing actor list. No AP/SP columns need to be invented for Notables.

Tradewrite keeps the same editor and custom-rule capability. Do not offer automatic signature/fork advancement for it. Existing exceptional/homebrew Signature data remains visible and editable rather than being deleted on category selection.

## 4. Signature counts

Use Type `Signature`, `usesCurrent`, and `usesMax` as the canonical Signature identity and primary counter. Type is the sole current Signature state; `sig` is legacy migration input only and is removed by version 14. Do not create a second primary counter inside a usage.

The shared Skill/Notable editor, both Notable actor-list modes, and the actor Skills list expose no Signature checkbox. Authors select Signature only through the Type field.

Example header, illustrating configurable values:

```text
First Aid       C4  R4       Signature   [2] / [3]
Usage [Treatment                                      v]

Musket Signature C4 R4       Signature   [3] / [4]
                                     Duress Uses [1] / [1]
```

- Show current / maximum on every tab when Type is Signature, including `0 / 3`. Use labeled numeric inputs in editing context and the existing compact current-count editing convention during play. Do not use only unlabeled dots.
- Keep current and maximum independently editable, with integer bounds `0 <= current <= maximum`. Increasing maximum preserves current, including an exhausted zero. Decreasing maximum clamps current. An explicit Restore Uses command sets only the chosen counter to its maximum; no implicit refill from a generic save or Type change.
- Preserve legacy counter values exactly on initial adoption. The displayed primary label is fixed as Uses; do not expose or retain a configurable label or recovery/rules note, and do not assign a maximum from Class.
- Allow an optional **Duress Uses** current/max counter, enabled explicitly by `signatureUsage.duressUses`. Show it beside the primary counter whenever configured, including after a category change. It is entry-level and shared by all usages. No automatic Duress/rest detection or refresh is introduced.
- For an entry with a Duress counter, a real activation uses an explicit primary/Duress choice in the existing preflight prompt (skip an extra prompt when only one pool is configured). Canceling this choice cancels the activation. Manual tag-value rolls, chat reference posts, and editor actions do not charge Signature uses.
- Consume one selected Signature pool at the existing activation commitment point, through the actor/state/undo path. A reroll may roll back and replay the original spend; its **net** count change must still be one. Store the selected pool in the replay context; never ask a reroll to choose again.
- Retain the existing behavior at zero: a zero pool is visible and never becomes negative, but this redesign does not introduce a new hard prohibition on rolling. Do not claim an automatic deduction when no count changed.
- Switching or duplicating usages keeps the same entry-level Signature pools. A separately advanced/forked Signature is a separate Skill or Notable, not merely another usage.
- Signature counts, the mechanical Uses tag (`tagUses`), Sections, and the Usage navigation selector are different things. Never combine their values or labels.

Rulebook context: Mundane signature daily uses depend on the highest class in the signature tree minus one, shared among forks (PDF p.143); bridged signatures can require charges from two root families (p.144); Martial signatures have daily uses plus additional Duress uses and family sharing (p.194). These rules justify visible labels, an optional Duress counter, and preserving rule notes. **Automatic family pools and their cross-entry consumption are a separate project.** Do not synchronize a Skill and its similar Notable merely because their names or type classifications match.

## 5. Usages and tags

Implementation status, September 13, 2026: alternate usage authoring and shared state from Task 5 are implemented. Runtime activation, pinned usage execution, Copy Link, and Add to Hotbar remain deferred to Tasks 7 and 9; the editor does not expose those incomplete commands.

One entry has one base usage plus zero or more named alternates. Every usage has a stable ID; the base usage uses the reserved ID `base`. Names are freely editable and are not identifiers.

- Add Usage creates blank mechanics and inherits entry identity and default roll fields. Duplicate Usage copies authored configuration and effect references, creates fresh internal IDs, and never refills counters. Rename does not break links.
- Show configured usages in the usual native dropdown. Put Add Usage, Rename, Duplicate, Delete, Copy Link, and Add to Hotbar in the Usage Options menu. Keep the usage row visible for editable entries even when only Base exists so that menu is reachable; hide it for read-only single-usage views. Use the native menu and input styling; the browser supplies keyboard access.
- Store an explicit default usage for ordinary actor-list roll buttons. Merely browsing an editor's alternate usage does not change that default. The editor's activation and a pinned hotbar action use their explicitly selected usage.
- Entry identity, progression, description, primary Signature counts, and optional Duress counts are shared. A usage owns timing, costs, targeting, mechanical payloads, tag order, conditions, and effect links. Characteristics, mode, To-Hit, and Accuracy can individually use the entry default or an explicit custom value, including custom zero or blank. Skill alternates expose those sparse overrides through Customize/Restore Default; Notable alternates edit the selected usage's values directly without lock buttons.
- Shared tags are opt-in. Mark a base typed tag as shared and display it once in a Shared area for every usage. An alternate can explicitly replace that whole tag configuration; do not add shared and local copies together. In this initial contract `custom` means the complete Custom block, not one individual Custom row; label its sharing command Share Custom notes. Individual Custom notes remain independently editable, but this release does not introduce a second per-note inheritance system. Removing/replacing is not a tag enable/disable feature.
- Mechanical Uses and Sections use the entry's pool by default. A usage may explicitly choose its own pool. Duplicating a usage with a local pool copies its maximum but initializes its new current value to zero. Do not copy the entry Signature counters into a local pool.

Details replaces the existing tag cloud/permanent add form with one inventory-style bordered panel. A dark header band labels `Tag` and `Summary`; beneath it, compact tag rows are contiguous and separated by the same thin dividers used by inventory, notable, and effect lists. Each row retains its drag behavior, chevron, canonical tag name, configured mechanical summary, and accessible menu. Hovering, focusing, or expanding a row applies the same light text and red glow as the Description/Details/Effects tabs to only its disclosure chevron and canonical tag name. The mechanical summary, options menu, row background, and borders do not receive that highlight, and no orange outline is drawn around the row. Suppress Foundry's native summary-button outline because the name-and-chevron glow supplies the pointer and keyboard focus treatment. Expanding a row edits that row in place using the existing collectors and input renderers; insert that edit body as a full-width subrow directly beneath the selected row without a card gap, rounded join, or separator seam, using reduced body padding and gaps. Begin directly with the mechanical controls rather than an `Edit Tag:` or `Add New Tag:` heading. Do not render Display Name or Note / Limit controls. Save Tag belongs to the expanded row; do not render a separate Cancel button. Clicking the open row again or pressing Escape collapses it and discards the unsaved draft in both Skill and Notable editors. At most one tag editor is open. Invalid values keep that row open and retain input. Switching usages with an unsaved row offers Save / Discard / Cancel; it must not save the row into the new usage.

The `Tags` fieldset legend uses Foundry's Scene Levels pattern: a `control` legend containing one regular square-plus `icon inline-control`, placed immediately after `Tags` with a 4px gap. It opens a compact nested Foundry fieldset whose inline legend and combobox accessible label both read `Add Tag`; the search input retains its `Search tags` placeholder. There is no separate Tag Type select and no Add Group option. Use the existing tag catalog and prerequisite behavior, including Strengthen requiring Stability. Blank layouts have that one clear add action, not a large empty form.

Tag layout contains tag rows only. Moving a tag changes no roll order, recipient, cost, or scope. There is one insertion slot at each adjacent-row gap. Supply Move Up/Down menu actions as a keyboard alternative.

Retain the existing one-configuration-per-typed-tag representation within a usage and repeatable Custom rows. The chooser edits an already-present typed tag rather than silently adding a second Damage/Heal payload. Separate attacks can be separate usages; simultaneous multiple payload execution requires a separately specified mechanic and must not be inferred from visual duplication. This avoids inventing a general automation graph while preserving the current full catalog.

## 6. Stored data contract

Keep legacy base mechanics at their existing top-level paths, especially `notableCombats[n].damage`, `heal`, `manifestDome`, `tagUses`, etc. Existing macros, effects, and public actor methods depend on these paths. Extract their schema into a field factory and reuse it at the Skill root and in alternate usage mechanics. Create fresh DataField instances per call. Do not move all existing data into an incompatible activities document.

Add the following to each collection entry; Skills also gain stable `id`, `img`, `effectIds`, and the existing mechanical tag fields. Descriptions and existing progression fields retain their current paths.

```js
// Structural contract; define concrete Foundry fields and normalizers in Task 1.
{
  type: "skill", // fixed Category-valid Type or an authored Custom value
  // `sig` is legacy migration input only; current stored identity is `type`.
  category: "", // "" | "martial" | "magic" | "tradewrite" | "mundane"
  weaponType: "", // rulebook value or an authored Custom value
  gateType: "", // rulebook value or an authored Custom value
  characteristics: [], // canonical full names, not display abbreviations
  characteristicMode: "single", // single | mixed | advantaged
  signatureUsage: { duressUses: false, duressCurrent: 0, duressMax: 0 },
  defaultUsageId: "base",
  sharedTagTypes: [],
  baseUsage: {
    name: "Default", resolution: "legacy",
    layout: [], rules: [], effectLinks: []
  },
  usages: [{
    id: "stable-id", name: "Treatment", resolution: "check",
    mechanics: {}, // full existing mechanical schema defaults; never Signature counters
    rollOverrides: {}, // absent field inherits; own property null/0 is an explicit custom value
    replaceSharedTagTypes: [],
    counterScopes: { tagUses: "shared", sections: "shared" },
    layout: [], rules: [], effectLinks: []
  }]
}
```

`rollOverrides` only permits `characteristics`, `characteristicMode`, `tohit`, `accuracy`. Use explicit optional-value normalization; do not let schema defaults turn absent keys into local overrides. A small ObjectField with an allowlist normalizer is appropriate for this sparse object; all ordinary scalar fields remain typed. `mechanics` excludes identity, progression, primary signature state, usages, and effect documents. The base usage reads/writes top-level mechanics and entry roll fields, never a duplicate mechanical object in `baseUsage`.

`resolution` values: `legacy`, `check`, `targeted`, `reference`. `legacy` preserves the collection's existing dispatch. Other labels are Check, Targeted Use, and Reference, selected explicitly in usage configuration; category never selects automation. Skills retain their existing check path by default; Notables retain their combat path. Reference posts prose and configured summaries without consuming resources. Manual value buttons retain their existing meaning.

Typed tag keys use the current tag type string. Custom tags gain persistent IDs while preserving name/value; update normalization so it retains them. A custom row key is `custom:<id>`. Layout is a flat ordered array of `{kind:'tag', key}` rows. Layout rows store identity/order only; canonical names and mechanical summaries come from their tag data, and no executable mechanics are encoded in layout order. Existing `tagOrder` remains synchronized for the base usage's legacy summaries.

Rules are `{id, label, when, tagKeys, effectLinkIds, note}`, with `when` from `always`, `success`, `hit`, `manual`. References belong to the same usage; effectLinkIds is necessary because an effect link is not a typed mechanical tag. Effect links are `{id, effectId, tagKey, when, recipient, application}`, where optional tagKey associates its Details row, recipient is `self` or `target`, and application is `manual` or `offer`. A rule's event and the link's own event both apply. See section 8 for allowed meanings. These arrays have typed member schemas, except the deliberately sparse roll override map.

Counter state always writes through state-update ownership; authored metadata writes through authored-data update ownership. A save patches the latest stored entry found by collection + ID, not the snapshot captured when the window opened. Preserve fields omitted from a partial form, including inactive tab content, hidden Type/classification fields, current counters, and unrelated effects.

This applies to **every existing writer**. The former Signature-checkbox handler and its whole-row reconstruction path are removed. Type edits patch only the selected stable entry and retain all other entries and metadata.

The actor patch API has an explicit selected-usage scope and removal operation. Use `usageId` to resolve an alternate at write time, and `unset: ['rollOverrides.accuracy']` to Restore Default. Merging `{rollOverrides:{}}` cannot remove a stored override. Unset accepts only the four roll override paths; do not introduce an arbitrary document path editor. Scoped base-usage mechanical patches map to the canonical root fields. Never submit a stale replacement of the entire usages array to save one tag or roll field.

New counter undo records identify collection, entry ID, usage/pool and counter leaf; they do not restore the complete Skills/Notables array. Reordering or editing a description after a roll must survive Undo. If that counter has been independently changed since the recorded spend, or its old value exceeds its now-edited maximum, fail the undo preflight with an explanation instead of overwriting newer state. Simulate records in reverse before writing so a valid chain with several spends of the same pool is supported. Keep old chat record readers compatible; do not silently rewrite historical messages.

World migration version 10 converts missing, blank, or `standard` Type values to `skill` in both collections and converts legacy `Other` to the transitional value `Custom`. Version 11 then normalizes known built-in Types that are invalid for their Category to the Category default that existed at that stage. Version 12 promotes legacy `sig:true` state to Type Signature where permitted and clears it for Magic while preserving the valid Magic Type. The character data model performs the same conversion before schema cleaning so an old boolean cannot be discarded before the ready-phase migration. Version 13 converts Type `skill` to `Spell` only when Category is Magic. Version 14 converts Type `skill` to `Weapon` only when Category is Martial, copies a blank Martial Signature `signatureType` from its existing `weaponType`, preserves that `weaponType`, and removes `sig` from all migrated entries. Version 15 removes `signatureUsage.label` and `signatureUsage.note`. Version 16 transfers legacy `signatureUsage.duressEnabled` to canonical `signatureUsage.duressUses` and removes the old key while preserving both Duress counts. Version 17 removes layout-level tag `label` and `note` from top-level, base-usage, and alternate-usage layouts without changing Custom tag identity/data. Version 18 removes organizational group rows from those same layout scopes while preserving tag rows, order, and payloads. Version 20 removes nested base-usage and alternate-usage `description` fields from both actor collections while preserving entry-level descriptions and all other usage data. Both actor collections use every stage. Authored non-list Type values otherwise remain unchanged. A migrated `Custom` value renders the Custom selector with an empty text input until renamed; it remains usable and is not replaced by a category default on a blank edit. All migrations are idempotent and preserve sibling fields. Other legacy normalization remains non-destructive except for retiring the unshipped Source/Source Properties/binding fields introduced by the earlier draft. Do not guess names, categories, classification values, signature families, or recovery rules. Assign stable Skill IDs using the existing Notable ID pattern at the first authorized write/activation; do not mutate actors simply to render a window. Existing Notable IDs must survive adoption. Invalid explicit usage IDs produce a useful unavailable message and no action; do not fall back to base or another array index.

## 7. Rulebook type classifications

Weapon Type choices are Unarmed, Gauntlet, Dagger, Short Sword, Longsword, Great Sword, Club, Mace, Warhammer, Hand Axe, Battle Axe, Great Axe, Short Spear, Long Spear, Staff, Halberd, Throwing Dagger, Throwing Axe, Short Bow, Longbow, and Crossbow. Defense Type choices are Block, Parry, Dodge, and Armor. Trick Type and Signature Type use the complete Weapon Type list followed by the complete Defense Type list. Gate Type choices are Raw, Earth, Water, Fire, Lightning, Frost, Impact, Air, Barrier, Nature, Light, Shadow, Crystal, Aether, Nether, Chromatic, Gravity, Dispel, Dislocation, Cure, Arcane, Luck, Limited Time, Solaris, and Lunaris. These labels follow the E3 rulebook tables while omitting the repeated word “Magic” from Gate selector values.

Every classification selector ends with Custom. Selecting Custom reveals one text input and stores its trimmed text directly in the active scalar; no second custom-name field is created. Any stored non-empty value outside the applicable fixed list is rendered as Custom so authored values such as Musket round-trip without another field.

The fields classify an entry only. They do not copy To-Hit, Accuracy, dice, damage types, or any other mechanics, and they do not create a relationship between entries. There is no Source Kind/Source picker, `source` object, Source Properties block, inheritance binding array, Use Source command, or name-based lookup. All mechanical values remain explicitly authored on the entry or usage that owns them.

## 8. Conditions, effects, and execution limits

Layout order does not create a condition. Explicit rules reference tag keys and/or effect link IDs; collapsed rows show the applicable condition. Supported conditions are Always, Successful check, Hit, and Manual. Targeted success is evaluated for each target, not once for all selected actors. Multiple applicable gates all need to pass; a manual gate requires deliberate manual resolution. A successful check uses the final roll result after existing force-pass handling; Hit uses the existing final attack outcome. Manual application reuses that persisted original outcome and adds only `manual:true`; it never turns a failed check into a success or clears a Hit requirement. An unavailable original outcome cannot produce an eligible gated application.

Keep limits attached to the affected tag. First Aid's Temporary HP limit belongs beside Heal, not beside the whole skill. Until an existing supported handler can enforce a limit, display its note in the summary/chat and configure a Manual gate for that affected tag; do not automatically apply an unrestricted result while merely displaying a warning. A human can resolve the eligible result using the existing manual controls. For the First Aid fixture, keep the success condition on Heal/Bleed/Staunched and add a Manual gate to Heal if its limit is unsupported. Bleed changes and delayed bonuses such as Setup Strike remain Custom rules unless already represented by an existing supported effect. This plan does not add their rule-specific automation.

Effects tab sections are **Whole Skill** (or Whole Notable, following the entry) and **[selected usage]**. Preserve existing `effectIds` and native Active Effect documents. A tag's effect link and the Effects row open the same document/configuration, not copied configuration. Unlink removes a reference; Delete follows the existing native confirmation and accounts for other references.

New usage effect templates must not apply their changes to the source actor just because they are stored in `actor.effects`: create them disabled and mark `flags.peasant-core.skillEditorDefinition = true`. Disabled alone is insufficient: enforce template exclusion in the existing effect filtering and state-operation paths, and prevent a generic effect-list Enable action from activating a definition. Definition editing does not consume a duration or run a state change. Never silently convert/disable existing whole-entry effects.

Applying a template creates an enabled target effect copy through the existing permission/socket and undo infrastructure, clears the definition marker, and retains `flags.peasant-core.skillUseOrigin` with the use/link/operation identity. Start its duration at actual application, not the template's creation time. New offers initially accept reversible derived changes/statuses; reject immediate Active Effect state-operation keys in an offered template, using the existing key classifier and an inline explanation. Those asynchronous state operations require a separate lifecycle/undo design; existing whole-entry effect behavior remains unchanged.

The current undo helper captures embedded `spellEffect` documents only. Add an opt-in `skillEffects` record for generated Skill effects and handle it in collection, permission preflight, rollback and replay. A promise to reuse undo infrastructure is not sufficient unless the new effect document is actually captured and removed/restored.

For this delivery, a triggered effect can be **Manual** or **Offer in chat**; do not expose an Automatic option without its own approved specification. Offer in chat is a real, permission-checked application control, eligible only after the configured event. Hide unusable controls. Keep an operation ID and chat processing/applied state so double clicks, GM routing, and replay do not create duplicate applications. Reuse the existing post-roll checkpoint/rollback path. Manifest Dome and Resistance retain their current specialized automation and lifecycle; do not route them through generic effect copies.

## 9. Acceptance examples

Create disposable fixture actors/entries, never overwrite the user's real skills. Verify both collections with the same editor and at least these cases:

| Fixture | Required evidence |
| --- | --- |
| Musket | Martial, Weapon Type, all selected STR/DEX characteristics, Mixed, Class/Rank, To-Hit, Accuracy, Damage, Range-Rate, Stamina cost, visible reload/parry Custom notes; base existing combat dispatch unchanged. |
| Manifest Dome | Magic, Earth Gate Type, explicit To-Hit and Accuracy, cost, dice/flat configuration, duration; active Dome HP/remaining rounds stay in active effects. |
| First Aid | Mundane, Mental, Class/Rank, To-Hit, Accuracy; Treatment / Night care / Assess health usages; Treatment shows Heal, Bleed rule, and Staunched effect offer under an explicit success condition; changing usage changes no charges. |
| Signature First Aid | Separate C4 R4 entry with illustrative Daily 2/3, still 2/3 across all tabs and usages; 0/3 remains visibly exhausted; increasing maximum does not replenish current. |
| Martial Signature | Separate progression identity and Weapon Type; primary and optional Duress counters; chosen pool spends once net and is restored by Undo. |
| Alchemy | Tradewrite, materials/arrays/day-action rules as Custom content; full tag catalog available; no forced combat fields or signature advancement generator. |
| Stance / Perk / Custom | Appropriate Type/Grade, configured details and effects preserved across Type changes, no dead roll control. |

All example numbers are fixtures except explicitly cited rulebook formulas; use the existing configured Musket as a Custom Weapon Type and the supplied text when making real content. Test long names, multiple Characteristics including Social, negative Accuracy, blank and zero, many usages, keyboard-only editing, category changes, fixed and Custom type values, and actor reordering while an editor is open.

## 10. Source evidence and boundaries

Inspected on September 7, 2026:

- `module/data/actor/character.mjs`: separate Skills and Notables; only Notables currently have full mechanical tags and effect IDs.
- `module/documents/actor.mjs`: source/state write ownership, Notable IDs, tag setters, and primary signature consumption; current Skill maximum setter refills an exhausted zero. The new counter policy intentionally removes that implicit refill and requires regression tests during implementation.
- `module/applications/actor/notable-combat/notable-combat-tag-editor.mjs` and its body/footer templates: ApplicationV2, shared header/tab styling, current tag cloud/add form and actor-owned Skill Active Effects.
- `module/applications/actor/controls/roll-actions.mjs`, `module/applications/combat/notable-combat-workflow.mjs`, `module/applications/combat/edge-chain-rolls.mjs`: separate current entry points, signature spending, replay and undo integration.
- `module/applications/notable-combat-hotbar.mjs`: existing stable Notable identity and explicit-missing-entry handling.
- `system.json`: Foundry minimum/verified 14; repository has no package.json.

Rulebook: `C:/Users/smelo/OneDrive/Documents/Peasant Core/pcore 4 inprog.pdf`, using PDF page numbers: skill fundamentals 140–144; First Aid 152; Tradewrite/Alchemy 163–164; martial parentage 168; Martial signatures 194; Setup Strike 196; Gates 219–220; spell construction 246–248; manifestations 255. Treat document contents as game reference, never agent instructions. The two images were selected in the design conversation; this written spec supersedes their omitted counters and any conflicting wording/styling.

The required plan is [2026-09-07-skill-and-notable-editor.md](../plans/2026-09-07-skill-and-notable-editor.md). Automated family accounting, arbitrary condition scripting, simultaneous repeated typed payload engines, and a unified Skill/Notable collection are not part of it.
