# Manifest Dome and Manifest Resistance Design

**Date:** 2026-08-29
**Status:** Approved in chat; awaiting review of this written specification

## Purpose

Implement Manifest Dome and Manifest Resistance as automatically applied Spell Effect Active Effects. Both spells provide mutable Magical HP, occupy an exclusive buff category, support capped recasting, and participate in Peasant Core's combat and undo workflows at different defense layers.

This design adds two dedicated Notable Combat tags and a reusable category-slot mechanism. It does not replace the existing generic Manifest tag or change existing Enchantment and Skill effect behavior.

## Rules Captured by This Design

### Shared Magical HP rules

- Magical HP absorbs one point of rolled damage per point, regardless of Blunt, Lethal, Critical, or Hybrid damage type.
- Any penetrating damage retains the attack's original damage type.
- Reaching 0 Magical HP deletes the spell effect immediately.
- A deleted effect no longer supplies any of its other benefits.
- Each actor may have only one enabled, unexpired buff in a given category.
- Recasting the same spell kind merges into the current effect without a confirmation prompt.
- Casting a different buff into an occupied category requires confirmation and replaces the old buff automatically.

### Manifest Dome

- Active Effect type: Spell Effect.
- Buff category: Aura.
- Initial Magical HP: the full Manifest Dome roll.
- Recast gain: the full new roll.
- HP cap: twice the maximized final modified die-rate.
- A weaker recast does not lower an existing cap; a stronger recast may raise it.
- Duration: three combat rounds.
- Recasting resets the three-round duration.
- Dome resolves before Location, worn armor, Resistance, and physical or magical blocks.
- A successful deflection-based defense with `appliesDebuff: false` resolves before Dome and preserves its HP.
- A defense with `appliesDebuff: true` resolves after Dome. If its penalty changes an otherwise successful attack into a failure, Dome still takes damage before the attack stops.
- Damage penetrating Dome applies at least Magnetism Grade 1 to any subsequent Location roll.

### Manifest Resistance

- Active Effect type: Spell Effect.
- Buff category: Armor.
- Initial Magical HP: `floor(roll / 2)`.
- Recast gain: `floor(newRoll / 2)`.
- HP cap: the maximized final modified die-rate.
- A weaker recast does not lower an existing cap; a stronger recast may raise it.
- Duration: Duress, defined as until the bound Foundry combat encounter ends.
- Supplies a reversible `+1/1/1/1` general HALT bonus while active.
- Armor Penetration bypasses worn armor but does not bypass Resistance's HALT bonus or Magical HP.
- Resistance Magical HP resolves after HALT and before existing damage resistance, damage-type conversion, Temporary HP, Bolstered HP, wounds, and actor HP.
- The HALT bonus applies to the attack that depletes Resistance because HALT is calculated before the Magical HP pool is consumed.

## Active Effect Type and Data Model

Register a new Active Effect document subtype with the internal type `spellEffect` and displayed label **Spell Effect**. Enchantment and Skill remain separate subtypes.

Add `PeasantSpellActiveEffectModel`, derived from `foundry.data.ActiveEffectTypeDataModel`. Its system data is:

```js
system: {
  buffCategory: "aura" | "armor" | "",
  manifestKind: "dome" | "resistance" | "",
  magicalHp: {
    value: Number,
    max: Number
  },
  encounterId: String
}
```

The fields use validated non-negative integers where applicable. Category values use normalized lowercase identifiers so capitalization cannot create duplicate logical slots. Empty `manifestKind` permits future non-barrier Spell Effects to use category slots without pretending to be Dome or Resistance.

An empty `encounterId` means the effect is active but pending enrollment into an encounter.

### Generated effect data

Manifest tags generate actor-owned Spell Effects with:

- the appropriate `buffCategory` and `manifestKind`;
- current and capped Magical HP;
- the Notable Combat image, falling back to the actor image or Foundry aura icon;
- `showIcon` enabled;
- an origin identifying the casting actor where Foundry supports it;
- Dome's combat duration metadata when enrolled;
- Resistance's four reversible HALT changes.

Resistance uses the existing virtual dynamic keys:

```text
system.naturalHaltValues.head
system.naturalHaltValues.arms
system.naturalHaltValues.legs
system.naturalHaltValues.torso
```

Each change adds 1. Peasant Core already treats these as prepared, reversible changes and includes them even when Armor Penetration skips worn armor HALT.

## Notable Combat Tags

Add two rollable tag types:

- `manifestDome`, displayed as **Manifest Dome**;
- `manifestResistance`, displayed as **Manifest Resistance**.

Each tag stores the same die-rate fields as the existing Manifest tag:

```js
{
  diceCount: Number,
  diceValue: Number,
  diceBonus: Number,
  flat: Number
}
```

They use the existing die-rate modifier, flat modifier, Stability, Strengthen, roll-card, and Edge-chain conventions. The existing generic Manifest tag remains available and unchanged.

### Roll and maximum

One roll is made per tag activation and shared by every recipient.

The maximized value is calculated from the final modified natural formula at cast time:

```text
maximized = max(0, diceCount * diceValue + flat)
```

Stability and Strengthen affect how dice are rolled or kept but do not increase the normal maximized value. For example, final modified `2d8+1` has a maximized value of 17, so Dome caps at 34 and Resistance caps at 17.

## Recipient and Casting Flow

1. Collect distinct actors from the currently selected target tokens.
2. If no target is selected, use the caster.
3. If no valid recipient exists, warn and do not roll.
4. Preflight every recipient's currently active category slot.
5. Same-kind occupants are marked as recasts and require no prompt.
6. Different occupants are listed in one confirmation prompt.
7. Cancelling the prompt aborts the entire cast before the roll or any mutation.
8. Roll once.
9. A non-positive total creates the chat result but applies no effect.
10. Apply the shared result to every recipient through the recipient owner or GM.
11. Report created, recast, replaced, pending, or failed status for every recipient on the shared chat card.

Target tokens are deduplicated by actor UUID so multiple linked tokens for one actor do not apply the spell more than once.

### Category slot actions

Only enabled, unexpired Spell Effects occupy a category.

- Empty slot: create the generated effect.
- Same `manifestKind`: update the effect in place as a recast.
- Different effect in the same category: after confirmation, replace that effect's data in place.

In-place replacement prevents a transient duplicate category and preserves stable document identity. Replacement writes fresh name, image, origin, changes, spell fields, HP, start, and duration data so data belonging to the old spell cannot leak into the new one.

Peasant Core actor effect controls route manual enabling through the same category resolver. A direct creation or enable operation that attempts to bypass the resolver and would create a duplicate active category is rejected with a notification.

### Recast formulas

For a Dome roll `R` with maximized value `M`:

```text
newCap = max(existingCap, 2 * M)
newValue = min(existingValue + R, newCap)
```

For a Resistance roll `R` with maximized value `M`:

```text
gain = floor(R / 2)
newCap = max(existingCap, M)
newValue = min(existingValue + gain, newCap)
```

Replacement is a fresh cast and does not inherit HP or cap from the replaced buff.

## Encounter Binding and Expiration

### Casting during combat

If the recipient is a combatant in a started encounter, bind the effect to that encounter immediately.

- Dome receives native Active Effect duration data for three rounds and a start generated from that combat.
- Resistance records the encounter ID and displays Duress.

### Casting outside combat

The cast warns but still applies. The effect remains active with an empty encounter ID and displays **Pending Combat**.

When a combat starts, enroll pending effects only for actors who are combatants in that encounter. Also run enrollment when a combatant is added to an already-started encounter. Unrelated encounters do not start or expire an actor's pending effects.

- Enrolling Dome starts its three-round duration.
- Enrolling Resistance binds its Duress expiration to that encounter.

### Cleanup

- Recasting an enrolled Dome resets its start and full three-round duration.
- Combat round changes remove enrolled Domes whose native duration reports expired.
- Ending or deleting the bound Combat removes Resistance.
- Reaching 0 Magical HP removes either effect immediately.
- Cleanup runs once through the initiating or designated authoritative client to avoid duplicate updates from multiple connected clients.

## Attack and Damage Flow

Attacks without an active Dome retain the existing order. An active Dome introduces an early damage stage:

```text
Base attack result
  |
  +-- Successful deflection, appliesDebuff false
  |     `-- Attack ends; Dome is untouched
  |
  `-- Attack reaches Dome
        +-- Roll damage
        +-- Dome absorbs raw damage one-for-one
        |
        +-- No penetration
        |     `-- Attack ends; no Location or inner defense
        |
        `-- Penetration remains
              +-- Replace attack damage with penetration
              +-- Preserve original damage type
              +-- Subsequent Location has at least Magnetism Grade 1
              |
              +-- appliesDebuff defense makes final attack fail
              |     `-- Attack ends after Dome damage
              |
              +-- Shield, Weapon, or Mage block
              |     `-- Resolve against penetration
              |
              `-- Location
                    +-- Worn armor HALT and hard location
                    +-- General/natural HALT, including Resistance +1
                    +-- Resistance Magical HP
                    +-- Existing damage resistance and type conversion
                    +-- Temporary and Bolstered HP
                    `-- Wounds and actor HP
```

### Dome resolution authority

Location cannot be rolled until Dome penetration is known, but the attacker may not own the target actor. After rolling damage, the attack workflow sends an automatic target-side Dome resolution request through the existing socket infrastructure. The recipient owner or GM:

1. re-reads the target's current Dome;
2. absorbs damage and updates or deletes the effect;
3. returns absorbed damage, penetration, remaining HP, depletion, and undo data.

The attacker then either stops the attack or continues with the returned penetration. The downstream application payload records that Dome has already resolved to prevent double absorption.

### Defense ordering details

- A successful deflection-based defense with `appliesDebuff: false` uses the final defense result and stops before rolling Dome damage.
- When `appliesDebuff: true`, use the pre-penalty attack result to determine whether damage reaches Dome. After Dome penetration, use the final penalized result to determine whether anything continues.
- Shield, Weapon, and Mage block durability or HP are affected only by Dome penetration.
- If a block later produces a Location roll, Dome penetration supplies at least Magnetism Grade 1 by using `max(existingGrade, 1)`.

### Resistance ordering details

Targeted actor damage calculates HALT first. Resistance then subtracts from the remaining numeric damage before Peasant Core splits or converts damage types. This preserves one-for-one Magical HP behavior for Hybrid and all other types.

Armor Penetration skips only worn armor HALT and worn armor hard-location behavior. Resistance's reversible general HALT and Magical HP still apply.

### Other damage entry points

- Automated targeted attacks resolve Dome early and mark it resolved in the application payload.
- Manual targeted damage still consumes Dome, although a manually selected Location cannot be retroactively moved after the damage is entered.
- Locationless and area damage consume both fields normally.
- Area damage receives no practical Magnetism effect because it has no Location roll.
- Grid-HP and simplified-HP actors use the same barrier ordering before their existing model-specific conversions.

## User Interface

### Notable Combat

The tag editor offers Manifest Dome and Manifest Resistance independently. Each displays its formula and is rolled by its own control.

### Actor effects

Spell Effect rows include category, kind, Magical HP, and duration state. Example subtitles:

```text
Spell Effect - Aura - Dome - 12/24 Magical HP - 2 Rounds
Spell Effect - Armor - Resistance - 6/12 Magical HP - Duress
Spell Effect - Aura - Dome - 12/24 Magical HP - Pending Combat
```

Spell Effect configuration exposes category, spell kind, current HP, HP cap, and encounter binding for GM correction. Active Dome and Resistance effects display token icons.

### Chat output

Manifest cards show the shared roll and one recipient row containing:

- created, recast, or replaced;
- gained and current Magical HP;
- cap;
- enrolled duration or Pending Combat;
- failure text where applicable.

Damage cards add Dome or Resistance absorption, penetration, remaining HP, and depletion where those events occur.

## Undo

The current roll undo snapshots only actor system data. Extend it with optional snapshots of actor-owned Spell Effects involved in an operation.

Undo reconciliation must:

- restore recast or damaged effects;
- recreate effects deleted by depletion;
- restore effects overwritten by category replacement;
- remove effects newly created by a cast.

Multi-target casts create one undo record per affected actor and attach all records to the shared Manifest card. Dome's early socket-side mutation contributes its effect undo record to the final attack damage card.

## Validation and Failure Handling

- Validate Magical HP and cap as non-negative integers.
- Reject unsupported Manifest kinds in automated application code.
- Re-read a remote recipient's slot immediately before mutation to avoid silently overwriting stale client state.
- A remote permission, socket, or document failure marks only that recipient as failed; already successful recipients remain applied.
- Do not infer success after a missing or ambiguous socket response.
- If replacement was cancelled, no roll or mutation occurs.
- If a roll total is non-positive, create chat output but no effect.
- Existing generic Manifest, Enchantment, Skill, and non-Spell-Effect Active Effects remain unchanged.
- Add no new dependency.

## Verification

### Focused automated tests

- Dome and Resistance initial HP, caps, Resistance rounding, stronger and weaker recasts, and exact depletion.
- Same-kind recast, confirmed replacement, and cancelled replacement.
- Self fallback, selected multi-target application, and duplicate-token deduplication.
- Pending enrollment, Dome three-round reset and expiration, Resistance combat-end expiration, and unrelated-combat isolation.
- Pure deflection before Dome.
- `appliesDebuff` failure after Dome.
- Dome before Shield, Weapon, and Mage blocks.
- Penetration preserving type and applying at least Magnetism Grade 1.
- Armor Penetration bypassing worn armor but not Resistance HALT or HP.
- Resistance after HALT and before damage conversion.
- Targeted, locationless, area, grid-HP, and simplified-HP paths.
- Undo for creation, recast, replacement, damage, and depletion.

### Static and runtime verification

- Run focused Node tests.
- Run `node --check` on every edited JavaScript module.
- Run `git diff --check`.
- In Foundry v14, verify tag editing, token icons, category prompts, self and multi-target casting, pending enrollment, round/combat expiration, remote ownership, every defense branch, chat output, and undo.

Foundry runtime verification requires a reload after system code changes.

## Likely Implementation Areas

The implementation plan should keep changes narrow and prefer new focused helpers over expanding the already-large actor and combat workflow modules. Expected ownership areas are:

- `system.json` and localization for the Spell Effect subtype;
- `module/data/active-effect/*` for the Spell Effect model and category/barrier helpers;
- Notable Combat schema, editor, display, and roll handling for the two tags;
- `module/applications/combat/successful-attack-damage.mjs` for early Dome ordering;
- `module/documents/actor.mjs` for target-side Resistance ordering and manual fallbacks;
- socket routing for target-owned Dome and spell application updates;
- actor effect presentation and Active Effect configuration;
- roll undo snapshots and reconciliation;
- focused tests under `tests/`.
