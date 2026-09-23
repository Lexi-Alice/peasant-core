# Manifest Dome and Manifest Resistance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Manifest Dome and Manifest Resistance as target-applied, category-exclusive Spell Effect Active Effects whose Magical HP resolves at the approved points in Peasant Core's Foundry VTT v14 combat pipeline.

**Architecture:** Put normalized spell definitions, HP arithmetic, slot lookup, and actor-owned effect mutations in one focused Active Effect domain module. Keep casting, socket requests, lifecycle hooks, and chat presentation in small application modules, then call those APIs surgically from the existing Notable Combat, attack, actor-damage, effect-list, and undo owners. Dome is resolved by the target owner or GM before Location; Resistance is resolved inside the target actor's damage methods after HALT. All mutations use the existing socket and chat-undo infrastructure.

**Tech Stack:** JavaScript ES modules, Foundry VTT v14 ActiveEffect type data models and document hooks, socketlib with the existing raw-socket fallback, Handlebars actor templates, Node `node:assert/strict` test scripts.

**Spec:** [`docs/superpowers/specs/2026-08-29-manifest-dome-resistance-design.md`](../specs/2026-08-29-manifest-dome-resistance-design.md)

## Global Constraints

- Preserve the unrelated dirty LevelDB files under `packs/peasant-core-macro/` and `packs/peasant-core-table/`; never stage or modify them as part of this feature.
- Do not change the existing generic `manifest` tag or existing Base, Enchantment, and Skill Active Effect behavior.
- Add no dependency. Use the socketlib integration and raw system socket already present.
- Keep all category and kind identifiers lowercase: `aura`, `armor`, `dome`, and `resistance`.
- Treat only enabled, unexpired, actor-owned `spellEffect` documents as category occupants.
- All automated spell-effect writes must pass one private document-operation option, `peasantCoreSpellEffectWrite: true`, so duplicate-slot hooks can distinguish approved writes from direct bypass attempts.
- Casting replacement updates the incumbent document in place. Manual enabling is not a cast: after confirmation, disable the incumbent first and then enable the selected existing effect, preserving the manually configured document.
- Use the lexicographically first active GM as lifecycle authority. If no GM is active, lifecycle hooks do not mutate effects; casting and damage still route through the target owner or GM as normal.
- Attach effect undo records before returning from any remote mutation. Never infer success from a missing, deferred, or ambiguous response.
- Use focused commits after each task. Stage only the files listed for that task.

---

### Task 1: Register the Spell Effect type and implement pure barrier rules

**Files:**

- Create: `module/data/active-effect/spell-effects.mjs`
- Modify: `module/data/active-effect/_module.mjs`
- Modify: `module/init.mjs`
- Modify: `system.json`
- Modify: `lang/en.json`
- Test: `tests/spell-effects.test.mjs`

- [ ] **Step 1: Write the failing pure-domain tests**

Create `tests/spell-effects.test.mjs` with table-driven assertions for:

- `getManifestSpellDefinition("manifestDome")` and `getManifestSpellDefinition("manifestResistance")`;
- maximized `2d8+1 === 17`, with negative results clamped to `0`;
- fresh Dome HP/cap, fresh rounded-down Resistance HP/cap;
- stronger and weaker recasts preserving or raising the cap correctly;
- replacement acting as a fresh cast;
- one-for-one absorption, overflow preserving the supplied damage type, and exact depletion;
- enabled/unexpired category occupancy and disabled/expired exclusion;
- recipient deduplication by actor UUID with self fallback.

The public pure API exercised by the test is:

```js
export const MANIFEST_SPELL_DEFINITIONS;
export function getManifestSpellDefinition(rollTypeOrKind);
export function getManifestMaximizedValue({ diceCount, diceValue, flat });
export function resolveManifestSpellHp({ kind, rollTotal, maximized, existing, replacement });
export function absorbMagicalHp({ damage, hp, damageType });
export function isActiveSpellEffect(effect);
export function findActiveSpellEffectInCategory(actor, category, { excludeId } = {});
export function collectManifestSpellRecipients({ caster, targets });
```

Representative expectations:

```js
assert.deepEqual(
  resolveManifestSpellHp({ kind: "resistance", rollTotal: 11, maximized: 16 }),
  { gain: 5, value: 5, max: 16 }
);
assert.deepEqual(
  absorbMagicalHp({ damage: 9, hp: 4, damageType: "lethal" }),
  { absorbed: 4, penetration: 5, remainingHp: 0, depleted: true, damageType: "lethal" }
);
```

- [ ] **Step 2: Run the test and confirm it fails for the missing module**

Run:

```powershell
node tests/spell-effects.test.mjs
```

Expected: Node reports that `module/data/active-effect/spell-effects.mjs` cannot be found.

- [ ] **Step 3: Implement the minimum pure domain module**

In `module/data/active-effect/spell-effects.mjs`:

- define immutable mappings for both roll types and both kinds;
- normalize non-negative integers at every arithmetic boundary;
- calculate Dome gain as the full roll and cap as `2 * maximized`;
- calculate Resistance gain as `Math.floor(rollTotal / 2)` and cap as `maximized`;
- on a recast, use `Math.max(existing.max, castCap)` and clamp the summed value;
- on replacement or first cast, ignore incumbent HP;
- match occupants by `effect.type`, `disabled`, `duration.expired`, and normalized `effect.system.buffCategory`;
- deduplicate target entries by `actor.uuid`, falling back to `actor.id`, and only fall back to the caster when the target list contains no valid actor.

Use this definition shape so every caller shares the same identifiers:

```js
export const MANIFEST_SPELL_DEFINITIONS = Object.freeze({
  manifestDome: Object.freeze({
    rollType: "manifestDome",
    kind: "dome",
    category: "aura",
    label: "Manifest Dome",
    durationLabel: "3 Rounds"
  }),
  manifestResistance: Object.freeze({
    rollType: "manifestResistance",
    kind: "resistance",
    category: "armor",
    label: "Manifest Resistance",
    durationLabel: "Duress"
  })
});
```

- [ ] **Step 4: Add the typed Active Effect model and registration**

Add `PeasantSpellActiveEffectModel` to `module/data/active-effect/_module.mjs` with this schema:

```js
static defineSchema() {
  const fields = foundry.data.fields;
  return {
    ...super.defineSchema(),
    buffCategory: new fields.StringField({ initial: "", choices: ["", "aura", "armor"] }),
    manifestKind: new fields.StringField({ initial: "", choices: ["", "dome", "resistance"] }),
    magicalHp: new fields.SchemaField({
      value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
    }),
    encounterId: new fields.StringField({ initial: "" })
  };
}
```

Then:

- export it through `PEASANT_ACTIVE_EFFECT_DATA_MODELS` as `spellEffect`;
- add `"spellEffect": {}` under `documentTypes.ActiveEffect` in `system.json`;
- add `"TYPES.ActiveEffect.spellEffect": "Spell Effect"` to `lang/en.json`;
- add `spellEffect: "TYPES.ActiveEffect.spellEffect"` to `CONFIG.ActiveEffect.typeLabels` in `module/init.mjs`.

- [ ] **Step 5: Run focused and static verification**

Run:

```powershell
node tests/spell-effects.test.mjs
node --check module/data/active-effect/spell-effects.mjs
node --check module/data/active-effect/_module.mjs
node --check module/init.mjs
git diff --check
```

Expected: the test prints its pass message; every syntax and diff check exits `0`.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- module/data/active-effect/spell-effects.mjs module/data/active-effect/_module.mjs module/init.mjs system.json lang/en.json tests/spell-effects.test.mjs
git commit -m "feat: add spell effect barrier model"
```

---

### Task 2: Add Manifest Dome and Resistance Notable Combat tags

**Files:**

- Modify: `module/data/actor/combat-tags.mjs`
- Modify: `module/data/actor/character.mjs`
- Modify: `module/documents/actor.mjs`
- Modify: `module/applications/actor/notable-combat/notable-combat-standard-tag-inputs.mjs`
- Modify: `module/applications/actor/notable-combat/notable-combat-tag-data.mjs`
- Modify: `module/applications/actor/notable-combat/notable-combat-tag-display.mjs`
- Modify: `module/data/actor/sheet-display/notable-combat.mjs`
- Modify: `templates/actor/apps/notable-combat-tag-editor-body.hbs`
- Test: `tests/manifest-spell-tags.test.mjs`

- [ ] **Step 1: Write the failing tag-registration test**

Create `tests/manifest-spell-tags.test.mjs` and assert that `manifestDome` and `manifestResistance` occur exactly once, in that order immediately after `manifest`, in `COMBAT_VIEW_TAG_TYPES`, `COMBAT_EDITOR_TAG_TYPES`, and `COMBAT_FULL_TAG_ORDER`. Also assert that both definitions resolve through `getManifestSpellDefinition` while generic `manifest` does not.

- [ ] **Step 2: Run the test and confirm the new tags are absent**

Run:

```powershell
node tests/manifest-spell-tags.test.mjs
```

Expected: an assertion reports that `manifestDome` is missing.

- [ ] **Step 3: Add stored fields and actor defaults**

In `module/data/actor/character.mjs`, add `manifestDome` and `manifestResistance` schemas next to `manifest`, each with `enabled`, `diceCount`, `diceValue`, `diceBonus`, and `flat` fields identical to the generic Manifest schema.

In `module/documents/actor.mjs`, add both fields to:

- `createDefaultPeasantCombatEntry`;
- the nested merge/normalization section;
- `removePeasantNotableCombatTag`;
- `setPeasantNotableCombatTag`.

In `PeasantCharacterModel.migrateData`, run the existing `migrateDiceBonus` normalization for both new stored fields so imported or older serialized formula values are cleaned consistently with Damage, Heal, and generic Manifest.

Use the exact stored keys `manifestDome` and `manifestResistance`; do not alias either to `manifest`.

- [ ] **Step 4: Add editor, parse, and display cases**

Add both tags to the three combat-tag arrays and the editor select. Mirror the existing Manifest dice inputs and parsing, changing only the stored key and displayed labels:

```text
Manifest Dome
Manifest Resistance
```

Update `module/data/actor/sheet-display/notable-combat.mjs` so each new tag:

- applies the existing combat die-rate and flat modifiers;
- displays the final modified formula;
- sets `rollable: true`;
- keeps generic Manifest unchanged.

- [ ] **Step 5: Verify the tag paths**

Run:

```powershell
node tests/manifest-spell-tags.test.mjs
node --check module/data/actor/combat-tags.mjs
node --check module/data/actor/character.mjs
node --check module/documents/actor.mjs
node --check module/applications/actor/notable-combat/notable-combat-standard-tag-inputs.mjs
node --check module/applications/actor/notable-combat/notable-combat-tag-data.mjs
node --check module/applications/actor/notable-combat/notable-combat-tag-display.mjs
node --check module/data/actor/sheet-display/notable-combat.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- module/data/actor/combat-tags.mjs module/data/actor/character.mjs module/documents/actor.mjs module/applications/actor/notable-combat/notable-combat-standard-tag-inputs.mjs module/applications/actor/notable-combat/notable-combat-tag-data.mjs module/applications/actor/notable-combat/notable-combat-tag-display.mjs module/data/actor/sheet-display/notable-combat.mjs templates/actor/apps/notable-combat-tag-editor-body.hbs tests/manifest-spell-tags.test.mjs
git commit -m "feat: add manifest barrier combat tags"
```

---

### Task 3: Implement actor-owned Spell Effect mutation and category-slot enforcement

**Files:**

- Modify: `module/data/active-effect/spell-effects.mjs`
- Modify: `module/applications/actor/controls/effects-controls.mjs`
- Modify: `module/init.mjs`
- Test: `tests/spell-effect-slots.test.mjs`

- [ ] **Step 1: Write failing slot-action and mutation tests**

Create actor/effect test doubles in `tests/spell-effect-slots.test.mjs` and cover:

- empty slot creates a new effect;
- same-kind recast updates HP/cap and retains the effect ID;
- approved different-kind replacement updates the incumbent ID with fresh source data;
- stale replacement approval fails if the incumbent ID changed after preflight;
- unapproved replacement fails without mutation;
- exact zero HP deletes the effect;
- unsupported kind fails;
- encounter lookup prefers a started `game.combat` containing the actor, then the lowest-ID started containing combat, otherwise returns pending data;
- manual enable replaces the active slot only after confirmation;
- the hook validator rejects a direct duplicate create or enable.

Exercise these exported runtime APIs:

```js
export function getManifestSpellSlotAction(actor, { kind, category, expectedOccupantId });
export function buildManifestSpellEffectSource(input);
export async function applyManifestSpellEffectToActor(actor, input);
export async function absorbActorSpellEffect(actor, { kind, damage, damageType });
export function getManifestSpellEncounterData(actor, kind);
export async function enableSpellEffectWithCategoryResolution(effect);
export function validateSpellEffectSlotWrite(effect, changes, options);
export function configurePeasantSpellEffectSlotGuards();
```

- [ ] **Step 2: Run the test and confirm the runtime exports are missing**

```powershell
node tests/spell-effect-slots.test.mjs
```

Expected: Node reports missing exports from `spell-effects.mjs`.

- [ ] **Step 3: Build canonical effect source and mutation functions**

Extend `spell-effects.mjs` so `buildManifestSpellEffectSource` always writes a complete generated source:

```js
{
  name,
  type: "spellEffect",
  img,
  origin,
  disabled: false,
  transfer: false,
  showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
  changes,
  start,
  duration,
  system: {
    buffCategory: definition.category,
    manifestKind: definition.kind,
    magicalHp: { value, max },
    encounterId
  },
  flags: { core: { overlay: false }, "peasant-core": { generatedManifestSpell: true } }
}
```

For Resistance, generate four additive changes with value `1` for:

```text
system.naturalHaltValues.head
system.naturalHaltValues.arms
system.naturalHaltValues.legs
system.naturalHaltValues.torso
```

Use `CONST.ACTIVE_EFFECT_MODES.ADD`. Dome has no changes. Build replacement updates from the same full source and explicitly clear obsolete duration keys and changes so Resistance-to-Dome and Dome-to-Resistance replacement cannot leak state.

Use Foundry v14's current source shape: `start` is the object returned by `ActiveEffect.implementation.getEffectStart(combat)`, while an enrolled Dome has `duration: { value: 3, units: "rounds", expiry: null, expired: false }`. Pending effects and Resistance use an indefinite duration with `value: null`; Resistance lifetime remains governed by `system.encounterId`. `getManifestSpellEncounterData` must select only a started combat in which the recipient actor is an actual combatant.

The generated name is the definition label, the origin is the casting actor UUID, and the image is the Notable Combat image with caster image and `CONFIG.ActiveEffect.documentClass.DEFAULT_ICON` fallbacks in that order.

Apply document writes with `{ peasantCoreSpellEffectWrite: true }`. Re-read the current category slot immediately before mutation and compare it with `expectedOccupantId` for confirmed replacements.

- [ ] **Step 4: Add duplicate-slot hooks and actor-row enable routing**

Register `preCreateActiveEffect` and `preUpdateActiveEffect` hooks from `module/init.mjs`. Reject an enabled Spell Effect write when another enabled/unexpired actor-owned Spell Effect already occupies the normalized category, unless the private write option is present.

When rejecting a user-originated write, notify the initiating client which category is occupied and identify the incumbent effect.

In `module/applications/actor/controls/effects-controls.mjs`:

- add `spellEffect` to the actor creation type choices;
- keep disabling direct;
- route enabling a Spell Effect through `enableSpellEffectWithCategoryResolution`;
- show one confirmation when a different active effect occupies the category;
- on confirmation, disable the incumbent before enabling the selected effect;
- on cancellation, leave both documents unchanged.

- [ ] **Step 5: Run focused verification**

```powershell
node tests/spell-effect-slots.test.mjs
node --check module/data/active-effect/spell-effects.mjs
node --check module/applications/actor/controls/effects-controls.mjs
node --check module/init.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- module/data/active-effect/spell-effects.mjs module/applications/actor/controls/effects-controls.mjs module/init.mjs tests/spell-effect-slots.test.mjs
git commit -m "feat: enforce spell effect buff slots"
```

---

### Task 4: Extend roll undo to reconcile changed Spell Effects

**Files:**

- Modify: `module/applications/chat-undo.mjs`
- Test: `tests/chat-undo-spell-effects.test.mjs`

- [ ] **Step 1: Write failing effect-snapshot undo tests**

Create `tests/chat-undo-spell-effects.test.mjs` with mock actors implementing `effects`, `update`, `createEmbeddedDocuments`, `updateEmbeddedDocuments`, and `deleteEmbeddedDocuments`. Cover undo of:

- effect creation by deleting the created ID;
- recast/damage by restoring the prior source;
- in-place replacement by restoring name, image, changes, duration, and system data;
- depletion by recreating the deleted effect with its original ID;
- a mixed actor-system and effect mutation;
- an operation that changes nothing and therefore creates no record;
- unrelated Spell Effects remaining untouched.

- [ ] **Step 2: Run the test and confirm current undo ignores effects**

```powershell
node tests/chat-undo-spell-effects.test.mjs
```

Expected: creation/deletion/replacement assertions fail because current records contain only actor-system paths.

- [ ] **Step 3: Add changed-effect snapshots to undo records**

Change the capture signature without breaking existing callers:

```js
export async function captureActorRollUndo(
  actor,
  label,
  operation,
  { includeSpellEffects = false } = {}
)
```

When enabled:

- snapshot actor-owned `spellEffect` sources before and after using `effect.toObject()` or `effect._source`;
- diff by `_id` and retain only IDs whose sources changed, appeared, or disappeared;
- store `spellEffects: { before: [], after: [] }` on the record;
- make `canUndoRecord` accept a system diff, an effect diff, or both.

During undo, reconcile only recorded effect IDs:

1. delete IDs present only in `after`;
2. update IDs present in both to the full `before` source;
3. recreate IDs present only in `before` with `{ keepId: true, peasantCoreSpellEffectWrite: true }`;
4. then restore actor-system paths.

Reverse record order as the existing implementation does.

- [ ] **Step 4: Verify undo behavior and existing undo users**

```powershell
node tests/chat-undo-spell-effects.test.mjs
node tests/edge-location-rolls.test.mjs
node --check module/applications/chat-undo.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- module/applications/chat-undo.mjs tests/chat-undo-spell-effects.test.mjs
git commit -m "feat: include spell effects in roll undo"
```

---

### Task 5: Cast both Manifest tags with one roll and automatic target application

**Files:**

- Create: `module/applications/combat/manifest-spell-effects.mjs`
- Modify: `module/applications/combat/manual-combat-tag-rolls.mjs`
- Modify: `module/socket/remote-prompts.mjs`
- Modify: `module/init.mjs`
- Test: `tests/manifest-spell-casting.test.mjs`

- [ ] **Step 1: Write failing casting-plan and chat tests**

In `tests/manifest-spell-casting.test.mjs`, test pure helpers exported from the new application module:

```js
export function buildManifestSpellCastPreflight({ caster, targets, rollType });
export function buildManifestSpellApplicationPayload(input);
export function renderManifestSpellRecipientRows(results);
```

Cover self fallback, actor-UUID target deduplication, silent same-kind recasts, one combined list of different occupants, cancellation before roll, pending/enrolled labeling, non-positive roll status, and per-recipient created/recast/replaced/failed rows.

- [ ] **Step 2: Run the test and confirm the application module is missing**

```powershell
node tests/manifest-spell-casting.test.mjs
```

Expected: Node reports the new module cannot be found.

- [ ] **Step 3: Extract reusable manual-roll evaluation**

In `manual-combat-tag-rolls.mjs`:

- export `getManualCombatTagRollData`;
- support `manifestDome` and `manifestResistance` through their matching combat field;
- include the final modified `maximized` value calculated before Stability/Strengthen doubling;
- include both new roll types in Stability and Strengthen eligibility;
- keep generic Manifest behavior unchanged;
- split the existing evaluation and card rendering just enough that Manifest spell preflight can occur before `new Roll(...).evaluate()`.

Both new roll types use the existing `pc-manifest-roll-card` class and their definition labels; do not create a second dice-card renderer.

Do not duplicate the Stability/Strengthen dice algorithm.

- [ ] **Step 4: Implement preflight, confirmation, one-roll application, and chat rows**

The Manifest spell branch of `rollManualCombatTag` must execute in this order:

1. collect current target-token actors, deduplicated by UUID, or use the caster;
2. inspect each recipient's category slot;
3. show one confirmation listing every different occupant;
4. if cancelled, return `{ cancelled: true }` without rolling, creating chat, or mutating;
5. warn once if any recipient will be pending, listing those recipients, but continue;
6. evaluate exactly one roll;
7. create the normal roll card;
8. if total is positive, apply the same total/maximized values to all recipients;
9. append one escaped recipient-status row per result;
10. attach every returned undo record to the shared card;
11. attach the existing Edge chain using the new roll type.

Every different-occupant payload includes `expectedOccupantId` and `replacementApproved: true`. Each application calls `applyManifestSpellEffectToActor` inside:

```js
captureActorRollUndo(actor, label, operation, { includeSpellEffects: true })
```

- [ ] **Step 5: Add remote target-owner/GM application routing**

Extend `module/socket/remote-prompts.mjs` with an `applyManifestSpellEffect` socketlib handler and matching raw-socket type. Register these APIs:

```js
game.peasantCore.applyManifestSpellEffect
game.peasantCore.applyManifestSpellEffectForUser
```

Use `getPreferredDefensePromptRecipientUser` for the target actor. Apply locally only when the current user can modify the actor; otherwise execute as the preferred owner/GM. Treat a raw-socket deferred response as failed for the current chat status because it cannot confirm mutation or return undo data.

- [ ] **Step 6: Run focused verification**

```powershell
node tests/manifest-spell-casting.test.mjs
node tests/spell-effects.test.mjs
node tests/spell-effect-slots.test.mjs
node --check module/applications/combat/manifest-spell-effects.mjs
node --check module/applications/combat/manual-combat-tag-rolls.mjs
node --check module/socket/remote-prompts.mjs
node --check module/init.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- module/applications/combat/manifest-spell-effects.mjs module/applications/combat/manual-combat-tag-rolls.mjs module/socket/remote-prompts.mjs module/init.mjs tests/manifest-spell-casting.test.mjs
git commit -m "feat: cast manifest barriers on targets"
```

---

### Task 6: Bind effects to encounters and expose their state in the UI

**Files:**

- Create: `module/data/active-effect/spell-effect-lifecycle.mjs`
- Modify: `module/init.mjs`
- Modify: `module/data/actor/sheet-display/effects.mjs`
- Modify: `module/applications/active-effect/active-effect-config.mjs`
- Test: `tests/spell-effect-lifecycle.test.mjs`

- [ ] **Step 1: Write failing lifecycle decision and subtitle tests**

Create `tests/spell-effect-lifecycle.test.mjs` around pure exports:

```js
export function getPendingSpellEffectEnrollment(effect, actor, combat);
export function shouldRemoveSpellEffectForCombat(effect, combat, event);
export function formatSpellEffectSubtitle(effect);
```

Cover:

- pending effects ignore unrelated combats;
- only actual combatants enroll;
- Dome enrollment supplies encounter ID and three rounds;
- Dome recast timing resets to three rounds;
- expired bound Dome is selected on round change;
- Resistance binds as Duress and is selected on bound combat end/delete;
- Resistance ignores other combat endings;
- subtitles for pending Dome, enrolled Dome rounds, and Resistance Duress.

- [ ] **Step 2: Run the test and confirm the lifecycle module is missing**

```powershell
node tests/spell-effect-lifecycle.test.mjs
```

Expected: Node reports the new module cannot be found.

- [ ] **Step 3: Implement authoritative enrollment and cleanup hooks**

In `spell-effect-lifecycle.mjs`, register:

- `combatStart`: enroll pending effects for combatant actors;
- `createCombatant`: enroll that actor if the parent combat has started;
- `combatRound`: delete bound Dome effects whose native `duration.expired` is true;
- `deleteCombat`: delete Resistance effects whose `system.encounterId` equals the deleted combat ID.

Guard every mutation with the first-active-GM authority rule and deduplicate actor IDs. Reuse `getManifestSpellEncounterData` from Task 3. Dome enrollment writes `start: ActiveEffect.implementation.getEffectStart(combat)` and `duration: { value: 3, units: "rounds", expiry: null, expired: false }`. Resistance gets no finite round duration, only the encounter ID. Register once from `module/init.mjs`.

- [ ] **Step 4: Add actor effect subtitles**

Update `module/data/actor/sheet-display/effects.mjs` to recognize `spellEffect` and append normalized category, kind, HP, and duration state. Example exact output:

```text
Spell Effect - Aura - Dome - 12/24 Magical HP - 2 Rounds
Spell Effect - Armor - Resistance - 6/12 Magical HP - Duress
Spell Effect - Aura - Dome - 12/24 Magical HP - Pending Combat
```

Include this data in effect search text. Leave non-Spell-Effect subtitles unchanged.

- [ ] **Step 5: Inject Spell Effect correction fields into ActiveEffectConfig**

Extend the existing `renderActiveEffectConfig` enhancement. Only when `app.document.type === "spellEffect"`, inject labeled controls bound to:

```text
system.buffCategory
system.manifestKind
system.magicalHp.value
system.magicalHp.max
system.encounterId
```

Use Aura/Armor and Dome/Resistance selects plus non-negative integer inputs. Bind once per rendered element with a data attribute. Keep the existing key browser and DAE handling intact.

- [ ] **Step 6: Run focused verification**

```powershell
node tests/spell-effect-lifecycle.test.mjs
node --check module/data/active-effect/spell-effect-lifecycle.mjs
node --check module/data/actor/sheet-display/effects.mjs
node --check module/applications/active-effect/active-effect-config.mjs
node --check module/init.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit Task 6**

```powershell
git add -- module/data/active-effect/spell-effect-lifecycle.mjs module/init.mjs module/data/actor/sheet-display/effects.mjs module/applications/active-effect/active-effect-config.mjs tests/spell-effect-lifecycle.test.mjs
git commit -m "feat: manage manifest barrier lifecycles"
```

---

### Task 7: Consume Resistance after HALT and before damage conversion

**Files:**

- Modify: `module/data/active-effect/spell-effects.mjs`
- Modify: `module/documents/actor.mjs`
- Modify: `module/applications/combat/incoming-hit-requests.mjs`
- Modify: `module/applications/combat/targeted-damage-workflow.mjs`
- Test: `tests/manifest-resistance-damage.test.mjs`

- [ ] **Step 1: Write failing Resistance-stage tests**

Create `tests/manifest-resistance-damage.test.mjs` using mock actor/effect documents and test:

- absorption occurs after a supplied HALT result;
- Armor Penetration removes only supplied worn-armor HALT, while natural HALT and Resistance still apply;
- Resistance consumes the remaining numeric damage before Hybrid/type splitting;
- locationless and generic damage have zero HALT but still consume Resistance first;
- exact depletion deletes the effect while returning the absorption result;
- a depleting attack's HALT includes the effect's +1 because the effect is consumed afterward;
- grid and simplified callers receive the same post-Resistance numeric damage.

Extract and test one pure pre-conversion helper:

```js
export function resolveResistanceDamageStage({
  damage,
  naturalHalt,
  armorHalt,
  isArmorPenetrating,
  ignoreHaltReduction,
  resistanceHp
});
```

- [ ] **Step 2: Run the test and confirm the Resistance stage is absent**

```powershell
node tests/manifest-resistance-damage.test.mjs
```

Expected: missing-export or assertion failure.

- [ ] **Step 3: Insert Resistance in all actor damage entry points**

In `applyPeasantTargetedDamage`:

1. compute natural and worn-armor HALT exactly as today;
2. let AP skip only worn-armor HALT and hard-location state;
3. call `absorbActorSpellEffect(this, { kind: "resistance", damage: netDamage, damageType: normalizedType })`;
4. replace `netDamage` with returned penetration;
5. call `splitDamageCounts` only afterward.

In `applyPeasantLocationlessDamage` and `applyPeasantDamage`, consume Resistance before current resistance/scaling/type conversion and before Temporary/Bolstered HP. Return a consistent `resistance` result object from all three methods.

Because the four `naturalHaltValues` changes remain prepared during HALT calculation, the +1/1/1/1 bonus applies to the hit that deletes the Resistance effect.

- [ ] **Step 4: Capture Resistance effect changes in incoming-hit undo and chat**

Change `applyIncomingHit` to call:

```js
captureActorRollUndo(defenderActor, label, operation, { includeSpellEffects: true })
```

Pass the returned Resistance data through shield-arm, weapon-overflow, targeted, and locationless result objects. Update the targeted damage card builder so a Resistance absorption creates a card even when damage reaches no wound/event, and render absorbed, penetration, remaining HP, and depletion.

- [ ] **Step 5: Run focused and regression verification**

```powershell
node tests/manifest-resistance-damage.test.mjs
node tests/chat-undo-spell-effects.test.mjs
node tests/active-effect-grid-health-max.test.mjs
node tests/shield-durability.test.mjs
node --check module/data/active-effect/spell-effects.mjs
node --check module/documents/actor.mjs
node --check module/applications/combat/incoming-hit-requests.mjs
node --check module/applications/combat/targeted-damage-workflow.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit Task 7**

```powershell
git add -- module/data/active-effect/spell-effects.mjs module/documents/actor.mjs module/applications/combat/incoming-hit-requests.mjs module/applications/combat/targeted-damage-workflow.mjs tests/manifest-resistance-damage.test.mjs
git commit -m "feat: absorb damage with manifest resistance"
```

---

### Task 8: Add target-authoritative Dome absorption and manual damage fallback

**Files:**

- Modify: `module/applications/combat/manifest-spell-effects.mjs`
- Modify: `module/socket/remote-prompts.mjs`
- Modify: `module/init.mjs`
- Modify: `module/documents/actor.mjs`
- Modify: `module/applications/combat/targeted-damage-workflow.mjs`
- Modify: `module/applications/combat/incoming-hit-requests.mjs`
- Modify: `module/applications/actor/controls/damage-heal-controls.mjs`
- Test: `tests/manifest-dome-absorption.test.mjs`

- [ ] **Step 1: Write failing Dome request and fallback tests**

Create `tests/manifest-dome-absorption.test.mjs` and cover:

- target-side re-read and one-for-one absorption;
- no active Dome returns unchanged penetration and no mutation;
- exact depletion deletes and returns effect undo;
- penetration retains Blunt/Lethal/Critical/Hybrid type;
- penetration returns `minimumMagnetismGrade: 1`;
- full absorption returns `minimumMagnetismGrade: 0`;
- an ambiguous/deferred remote response is not treated as success;
- `domeAlreadyResolved: true` bypasses actor-method fallback;
- targeted, locationless, and generic manual damage consume Dome once before Resistance.

- [ ] **Step 2: Run the test and confirm Dome request APIs are missing**

```powershell
node tests/manifest-dome-absorption.test.mjs
```

Expected: missing-export or assertion failure.

- [ ] **Step 3: Add target-side Dome application and socket routing**

Export from `manifest-spell-effects.mjs`:

```js
export async function applyManifestDomeAbsorption(payload);
export async function requestManifestDomeAbsorptionForTarget(input);
```

`applyManifestDomeAbsorption` resolves the actor from the existing target identifiers, wraps `absorbActorSpellEffect` in effect-aware undo capture, and returns:

```js
{
  handled: true,
  applied: true,
  absorbed,
  penetration,
  damageType,
  remainingHp,
  depleted,
  minimumMagnetismGrade,
  undoRecords
}
```

Add `absorbManifestDome` socketlib/raw handlers and `game.peasantCore.absorbManifestDomeForUser`. Route to the preferred target owner or GM, with the same local-permission and ambiguous-response rules as casting.

- [ ] **Step 4: Add actor-method Dome fallback and the resolved marker**

Add `domeAlreadyResolved = false` to targeted and locationless damage option objects, and a compatible optional fourth argument/options object to `applyPeasantDamage`. When false, consume Dome before any Location/HALT/Resistance processing available to that entry point. A manual targeted Location remains unchanged and the returned magnetism is informational.

Thread `domeAlreadyResolved` through:

- `applyTargetedDamageWorkflow`;
- `requestIncomingHitApplicationForTarget` payload construction;
- `applyIncomingHitToActor`;
- shield-arm, weapon-overflow, mage/locationless, and ordinary targeted branches.

Automated attacks will set this marker after the early Dome stage in Task 9.

Wrap the direct sheet damage action in `module/applications/actor/controls/damage-heal-controls.mjs` with `captureActorRollUndo(..., { includeSpellEffects: true })` and attach its records to the returned damage card. Automated incoming-hit paths retain their outer capture and must not add a second nested record.

- [ ] **Step 5: Run focused verification**

```powershell
node tests/manifest-dome-absorption.test.mjs
node tests/manifest-resistance-damage.test.mjs
node tests/chat-undo-spell-effects.test.mjs
node --check module/applications/combat/manifest-spell-effects.mjs
node --check module/socket/remote-prompts.mjs
node --check module/init.mjs
node --check module/documents/actor.mjs
node --check module/applications/combat/targeted-damage-workflow.mjs
node --check module/applications/combat/incoming-hit-requests.mjs
node --check module/applications/actor/controls/damage-heal-controls.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit Task 8**

```powershell
git add -- module/applications/combat/manifest-spell-effects.mjs module/socket/remote-prompts.mjs module/init.mjs module/documents/actor.mjs module/applications/combat/targeted-damage-workflow.mjs module/applications/combat/incoming-hit-requests.mjs module/applications/actor/controls/damage-heal-controls.mjs tests/manifest-dome-absorption.test.mjs
git commit -m "feat: resolve manifest dome on target actors"
```

---

### Task 9: Reorder automated attacks around Dome and defenses

**Files:**

- Modify: `module/data/actor/defense-results.mjs`
- Modify: `module/applications/combat/notable-combat-workflow.mjs`
- Modify: `module/applications/combat/successful-attack-damage.mjs`
- Modify: `module/applications/combat/incoming-hit-requests.mjs`
- Modify: `module/applications/combat/automated-damage-rolls.mjs`
- Test: `tests/manifest-dome-attack-order.test.mjs`

- [ ] **Step 1: Write failing defense-order decision tests**

Create `tests/manifest-dome-attack-order.test.mjs` around exported pure helpers:

```js
export function doesAttackReachManifestDome({ attackRoll, preDefenseRollResult, defensePromptResult });
export function getPostDomeMagnetismGrade(existingGrade, domeResult);
export function shouldContinueAfterManifestDome({ attackRoll, defensePromptResult, domeResult });
```

Cover:

- successful non-block deflection with `appliesDebuff: false` does not reach Dome;
- failed or absent deflection reaches Dome only when the relevant attack result succeeded;
- `appliesDebuff: true` uses the pre-penalty success to reach Dome;
- after Dome penetration, a non-block final defense failure stops;
- Shield, Weapon, and Mage block failures continue against penetration;
- zero penetration stops every branch;
- penetrating damage upgrades magnetism with `Math.max(existingGrade, 1)`;
- no active/handled Dome leaves magnetism unchanged.

- [ ] **Step 2: Run the test and confirm the ordering helpers are absent**

```powershell
node tests/manifest-dome-attack-order.test.mjs
```

Expected: missing-export or assertion failure.

- [ ] **Step 3: Preserve explicit pre-defense attack results**

In `notable-combat-workflow.mjs`, pass `preDefenseRollResult` as an explicit argument to every initial and Edge-replay call of `resolveSuccessfulAttackDamageForTarget`:

- single target: the roll result captured before penalties;
- multi-target: the shared base attack result before target-specific penalties;
- replay: the checkpoint's base attack result.

Do not rely on a property attached after damage resolution.

- [ ] **Step 4: Implement the defense-order helpers**

In `defense-results.mjs`, define successful pre-Dome deflection as:

```js
defensePromptResult.selection === "defense"
  && defensePromptResult.defenseRoll?.rollResult?.isSuccess
  && !normalizeCombatDefense(defensePromptResult.selectedDefense).block
  && !normalizeCombatDefense(defensePromptResult.selectedDefense).appliesDebuff
```

That exception stops before damage is rolled. For `appliesDebuff: true`, use `preDefenseRollResult`; otherwise use the final attack result. Keep existing Shield/Weapon/Mage helper behavior intact.

- [ ] **Step 5: Add one reusable Dome stage inside the attack module**

In `successful-attack-damage.mjs`, add a local helper that:

1. checks whether the target currently has an active Dome;
2. checks `doesAttackReachManifestDome`;
3. accepts or creates the branch's damage roll;
4. sends its displayed total to `requestManifestDomeAbsorptionForTarget`;
5. attaches returned undo records to the damage card immediately;
6. returns the existing roll, penetration, type, minimum magnetism, and undo records.

Call that stage after each branch has calculated its actual rolled damage but before the branch's inner defense:

- Shield: Dome penetration becomes shield input;
- Weapon: Dome penetration becomes hardness input and any overflow Location uses at least grade 1;
- Mage: Dome penetration becomes Mage HP input;
- AoE/Area/Tile: apply reflex/glance halving first, then Dome, with no practical Location magnetism;
- ordinary targeted attack with Dome: roll damage before Location, consume Dome, stop on zero, then resolve Location with upgraded magnetism;
- ordinary targeted attack without Dome: preserve the existing Location-before-damage order byte-for-byte as far as practical.

After Dome penetration, stop a non-block `appliesDebuff` defense whose final penalized attack failed. Block failures proceed into their current block branch.

- [ ] **Step 6: Mark every downstream automated application as already resolved**

Pass `domeAlreadyResolved: true` whenever the early Dome stage handled an active Dome. Use the penetration as `damageAmountOverride`, preserving the already-resolved damage type. This prevents actor methods from consuming Dome twice. Before passing application data to `attachLocationRollWorkflowData`, merge the early Dome and downstream application undo records so Edge Location rerolls restore the complete prior hit, not only the inner damage stage.

Update the automated damage card with escaped barrier rows. Include Dome absorbed, penetration, remaining HP, and depletion from the early stage, plus any Resistance result returned by ordinary, shield-arm, weapon-overflow, Mage/locationless, or area application. If Dome absorbs all damage, keep the roll card and its undo flag even though no Location or incoming-hit application occurs.

- [ ] **Step 7: Run focused and combat regression tests**

```powershell
node tests/manifest-dome-attack-order.test.mjs
node tests/manifest-dome-absorption.test.mjs
node tests/manifest-resistance-damage.test.mjs
node tests/edge-location-rolls.test.mjs
node tests/shield-durability.test.mjs
node --check module/data/actor/defense-results.mjs
node --check module/applications/combat/notable-combat-workflow.mjs
node --check module/applications/combat/successful-attack-damage.mjs
node --check module/applications/combat/incoming-hit-requests.mjs
node --check module/applications/combat/automated-damage-rolls.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 8: Commit Task 9**

```powershell
git add -- module/data/actor/defense-results.mjs module/applications/combat/notable-combat-workflow.mjs module/applications/combat/successful-attack-damage.mjs module/applications/combat/incoming-hit-requests.mjs module/applications/combat/automated-damage-rolls.mjs tests/manifest-dome-attack-order.test.mjs
git commit -m "feat: resolve dome before location and blocks"
```

---

### Task 10: Run the complete automated and Foundry v14 acceptance pass

**Files:**

- Modify only if a verified defect is found in files already owned by Tasks 1-9.

- [ ] **Step 1: Run every Node test**

Run:

```powershell
Get-ChildItem -LiteralPath tests -Filter '*.test.mjs' | Sort-Object Name | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw "Failed: $($_.Name)" } }
```

Expected: every test prints its pass message and the command exits `0`.

- [ ] **Step 2: Syntax-check every edited JavaScript module**

Run the explicit checks from Tasks 1-9 again, then:

```powershell
git diff --check
git status --short
```

Expected: no syntax or whitespace errors. `git status --short` may still show the user's pre-existing `packs/` changes, which remain unstaged and untouched.

- [ ] **Step 3: Reload Foundry v14 and verify data/UI basics**

Using the `Codex` user when available:

- create and edit each new Notable Combat tag;
- verify formulas include die-rate/flat modifiers and Stability/Strengthen rolls but caps use the normal maximized final formula;
- cast with no target and with multiple selected tokens, including duplicate linked tokens;
- confirm the cast rolls once and applies automatically;
- confirm same-kind recasts do not prompt;
- confirm one combined prompt for mixed-category replacements and no roll/mutation on cancel;
- verify Spell Effect fields, token icons, actor-row subtitles, and category-slot enforcement.

- [ ] **Step 4: Verify lifecycle and remote ownership**

- cast both effects outside combat, observe the warning and Pending Combat state;
- start a combat containing the actor and confirm enrollment;
- add a pending actor to an already-started combat and confirm enrollment;
- confirm unrelated combats do not enroll or expire the effects;
- confirm Dome resets to three rounds on recast and expires after three rounds;
- confirm Resistance remains through rounds and is removed when its bound combat ends or is deleted;
- cast and damage an actor owned by another connected user and confirm mutations/undo occur on the owner or GM side.

- [ ] **Step 5: Verify every defense and damage branch**

- successful non-block `appliesDebuff: false` deflection preserves Dome;
- `appliesDebuff: true` defense that turns success into failure still damages Dome, then stops overflow;
- Shield, Weapon, and Mage blocks receive only Dome penetration;
- penetrating targeted attacks roll Location afterward with at least Magnetism Grade 1;
- AP bypasses worn armor but not Resistance HALT or Magical HP;
- Resistance applies after HALT and before Hybrid/type conversion, Temporary HP, Bolstered HP, wounds, and actor HP;
- targeted, locationless, AoE, grid-HP, and simplified-HP paths consume barriers exactly once;
- actors without Dome retain Location-before-damage behavior.

- [ ] **Step 6: Verify chat and undo**

- shared cast cards list created/recast/replaced/pending/failed status per actor;
- damage cards show Dome and Resistance absorption, penetration, remaining HP, and depletion;
- undo removes newly created effects;
- undo restores recast HP/cap;
- undo restores an overwritten category occupant;
- undo recreates effects deleted by exact depletion;
- an early remote Dome mutation and downstream Resistance/actor damage are all restored from the final damage card.

- [ ] **Step 7: Fix only acceptance defects, then rerun the relevant focused test and full suite**

For each defect, first add or tighten a focused test that fails, implement the smallest correction, then repeat Steps 1-2 and the affected Foundry scenario.

- [ ] **Step 8: Commit acceptance fixes only if Step 7 changed code**

Stage exact corrected files and their tests, then commit:

```powershell
git commit -m "fix: complete manifest barrier acceptance"
```

Skip this commit when acceptance required no correction.

## Completion Criteria

- Every rule in the approved specification has a focused automated assertion or an explicit Foundry v14 acceptance check above.
- All Node tests, syntax checks, and `git diff --check` pass.
- Foundry v14 verifies self/multi-target casting, pending and enrolled lifecycles, category prompts, remote target ownership, all defense orderings, both HP models, chat output, and effect-aware undo.
- Generic Manifest and existing Active Effect types remain unchanged.
- No unrelated `packs/` file is staged.
