# E5 Audit Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair every confirmed correctness and wound-control finding from the thread audit, retain the E5 regressions in source control, and finish available integration verification.

**Architecture:** Repair the existing actor, incoming-hit, and Edge replay boundaries. Preserve explicit roll ownership separately from the parent attack context, reuse existing replay dice/checkpoints and document undo, and revalidate mutable state on its owning actor. Add no replacement combat engine or general transaction framework.

**Tech Stack:** Foundry VTT 14, JavaScript ES modules, standalone Node assertions, existing socketlib routing and Foundry document APIs.

**Spec:** `docs/superpowers/specs/2026-09-19-e4-to-e5-migration-design.md`, its eight implementation plans, and subsequent author decisions in this thread. The audit and the author's request to plan and implement its fixes approve this bounded repair scope.

## Global Constraints

- Preserve unrelated working-tree files and hunks. Do not create worktrees, branches, commits, pushes, or pull requests; do not stage files.
- Do not edit the original specification or implementation plans to record progress. Use a separate execution ledger.
- Use Ponytail full, existing Peasant Core patterns, and Foundry update/create/delete APIs. Add no dependencies.
- Keep removed Scar automation and Long Rest chat output removed. Retain the existing full-HP/zero-General-Stress wound recovery checkpoint.
- Keep Mage current and maximum barrier HP on its Active Effect. Use authored notable maximum only for creation/refresh. Zero HP deletes the barrier and Duress state. Use Current Barrier has no authored resource cost.
- Keep `system.defensiveReflexes.toHit`, targetless Blessings, bundled Fall spending, Tier 1 healing, and the original exclusions unchanged.
- Saves, raw damage/healing dice, initiative, and location cards cannot use Fall. One selected Fall use grants exactly +4 Accuracy.
- Run a failing behavior regression before each production repair, then its focused tests before proceeding. Use systematic debugging for failures and verification-before-completion for claims.
- Runtime verification must be distinguished from Node/static evidence. Honor the author's earlier option to skip interactive checking if the runtime cannot be safely exercised; report an unavailable runtime or owner session explicitly.

## Review Focus

- A defender and attacker have different Blessings, resources, permissions, and token actor UUIDs: the clicked roll's actor pays and receives Fall.
- Fall changes success/MoS on an already resolved attack, defense, or heal: existing downstream dice and choices remain fixed; newly enabled rolls may roll.
- A document flag update or replay fails, or two distinct messages spend the last Fall use: state restores and only one affordable operation succeeds.
- A barrier, armor grade, or charge changes while a prompt is pending: damage and costs use current owner state, cancellation terminates, and no free protection or lost resource survives.
- A simplified actor receives typed damage, or effective movement is floored to zero: E5 buffer absorption and authored movement remain correct.

---

### Task 1: Repair Fall ownership, replay, rollback, and shared-resource spending

**Files:**
- Modify: `module/applications/combat/edge-chain-rolls.mjs`
- Modify as needed: `module/applications/combat/notable-combat-workflow.mjs`
- Modify: `module/socket/remote-prompts.mjs`
- Modify as needed: `module/documents/actor.mjs` (Fall spending only)
- Test: `tests/e5-fall-blessing-roll.test.mjs`, `tests/e5-blessings.test.mjs`, relevant existing Edge replay tests.

**Interfaces:**
- Preserve `applyFallBlessingAccuracy(payload)`, `fallBlessingAccuracyFromMessage(messageId)`, and the existing GM route.
- Resolve the clicked roll owner from defense checkpoint `defenseTargetRef` when its stage is `defense`; otherwise use the actor-backed rerun reference. Resolve UUID before world actor ID locally and remotely, sharing the reference contract.
- Keep the parent attacker context for replay. Persist the paid defense modifier with its defense checkpoint/serialized defense state, so later Edge retains it without charging or modifying the attacker.
- Pass existing resolved value dice through `edgeIndividualDieReplay` to `replayNotableCombatPostRollEffects`.
- Serialize Fall validation/spend/replay/rollback per actor at the authoritative execution boundary, using the existing queue/routing patterns. A local queue must not imply protection across independent clients; direct-owner requests must use the authoritative route when needed. Preserve actor spending API validation.

- [ ] **Step 1: Write ownership regressions and observe failure.** A defender with Fall and one use, attacked by an actor without Fall, offers the action and spends only the defender's use. Reverse the Blessings and reject the action. A synthetic token actor with Fall and a base actor without it succeeds through GM validation using the token UUID. After defensive Fall, later Edge keeps the defender's +4 and leaves attacker Accuracy unchanged.
- [ ] **Step 2: Write replay and transaction regressions and observe failure.** Retain an existing healing die `[1]` when Fall changes Narrow Success to Success despite queued new randomness `[6]`; retain resolved damage dice, target, location and defense choice. Reject a setup flag write after the chain processing write and assert all processing flags/content/resources restore. Two distinct eligible messages with one shared use yield exactly one success and one +4 bonus. A failed replay followed by another queued action must refund before the next validation.
- [ ] **Step 3: Apply minimal repairs.** Use the roll-owner reference for eligibility, permission, cost, summary label, and rerun modifier ownership. Reuse Edge's value replay creation, put initial processing mutations inside rollback, and validate after acquiring the actor's transaction serialization. Release serialization on success/failure; preserve critical identity, bundled counts, force-pass restoration, and undo.
- [ ] **Step 4: Focused verification.** Run `node tests/e5-fall-blessing-roll.test.mjs`, `node tests/e5-blessings.test.mjs`, `node tests/edge-individual-skill-replay.test.mjs`, `node tests/edge-individual-checkpoints.test.mjs`, and `node tests/edge-save-check-transport.test.mjs`. Run `node --check` on each changed module. Expect all commands to exit 0; obtain independent task review before Task 2.

### Task 2: Repair barrier ownership, cancellation, costs, and stale Armor protection

**Files:**
- Modify: `module/applications/combat/incoming-hit-requests.mjs`
- Modify: `module/applications/combat/notable-combat-workflow.mjs` (Mage barrier-action failure)
- Modify as needed: `module/documents/actor.mjs` (targeted armor validation only), owning Armor helpers/transport.
- Test: `tests/e5-mage-block-workflow.test.mjs`, `tests/e5-shield-block-workflow.test.mjs`, `tests/e5-active-armor-workflow.test.mjs`.

**Interfaces:**
- Keep incoming-hit result shapes and stable entry/usage IDs.
- `applyIncomingMageBlock` supplies both `value` and `max` from `getMageBlockBarrierHp(effect)` to the existing resolver. Authored capacity changes affect the next create/refresh only.
- `requestIncomingHitApplicationForTarget` returns an explicitly handled cancellation without local/remote fallback.
- A failed Mage action restores its captured resource costs before returning failure; retain existing successful creation/refresh/use semantics.
- Owner-side Light protection requires a currently spendable charge and matching current Light grade. Preserve the original AP result through transport so rejecting a stale choice cannot retain its protection.

- [ ] **Step 1: Write barrier and cancellation regressions and observe failure.** Existing effect 35/40, authored maximum changed to 20, incoming damage 5 leaves the effect at 30/40. Refresh then uses 20. Cancel the local owner's Shield Brace once and assert exactly one prompt and no fallback/write. Delete a Mage barrier after refresh validation but before action execution; Stamina 5 with authored cost 3 remains 5, no new barrier, and no stranded cost undo.
- [ ] **Step 2: Write stale Light decision regressions and observe failure.** Submit a previously accepted Light charge decision after the last charge is spent, or after worn grade changes. The original AP hit remains AP and gains no Light protection; assert no invalid charge spend. Verify a still-valid Light choice protects and spends exactly once, including remote owner application and replay.
- [ ] **Step 3: Apply minimal repairs.** Read the live effect maximum, terminate cancellation, refund costs inside the failed-action path, and move penetration protection behind owner-side validation. Do not weaken cancellation/error distinction or write an authored skill HP field.
- [ ] **Step 4: Focused verification.** Run the three tests above plus `node tests/e5-mage-block-active-effects.test.mjs`, `node tests/e5-guard-broken.test.mjs`, `node tests/e5-weapon-block.test.mjs`, and `node tests/defense-prompt-usages.test.mjs`. Syntax-check changed modules. Expect exit 0; obtain independent task review before Task 3.

### Task 3: Repair simplified buffers, movement round-trip, and wound controls

**Files:**
- Modify: `module/documents/actor.mjs` (simplified damage and movement only)
- Modify as needed: `module/data/actor/damage.mjs`, `module/data/actor/equipped-armor.mjs`
- Modify: `module/applications/actor/controls/wounds-controls.mjs`
- Test: `tests/e5-damage-buffers.test.mjs`, `tests/equipped-armor-effects.test.mjs`, `tests/e5-wound-controls.test.mjs`.

**Interfaces:**
- Preserve generic, targeted, and locationless damage APIs and simplified result fields. Apply the shared typed Temporary HP absorber before converting remaining damage to scalar HP. Preserve Bolstered HP, resistance, Hard location semantics, scalar buffer cap, undo, and simplified exclusion from wound automation.
- Author clarification during execution: resistance applies to typed counts before Temporary HP in both representations. For each nonzero incoming grade, a positive multiplier yields `max(1, floor(count * multiplier))`; an exact zero multiplier yields zero. An absent grade remains zero. Use the shared resistance helper exactly once, then existing Hard/grid/scalar conversion. This replaces the old simplified weighted-scalar fractional rounding.
- `setPeasantMovement(rawValue)` preserves the existing source base when the requested effective movement equals the current floored display. Changed positive values retain the existing equipment/training inversion; avoid projecting derived effects into manual storage.
- Keep `.pc-remove-condition` for shared hover styling, but bind condition removal only to controls with `data-condition`. Render the empty-state message only if no ordinary or Devastating entries exist.

- [ ] **Step 1: Write scalar regressions and observe failure.** Health 7/max 10 with Temporary HP 3 receiving Critical 1 stays at health 7 and consumes all 3 Temporary HP. Temporary HP 1 fully absorbs Lethal 1. Cover generic, targeted and locationless routes, exact/full/mixed payments, residual scalar damage/Bolstered absorption, resistance and Hard behavior, and undo. No scalar wound conditions are introduced.
- [ ] **Step 1a: Verify the clarified resistance rule.** Observe RED before changing the shared helper. Positive fractional multipliers retain one typed point for every nonzero grade; exact zero remains immunity and consumes no buffer; absent grades never gain damage. Cover both HP representations and all three actor callers, including mixed grades and no-buffer/Hard cases. Add the narrow existing resistance/Manifest checks required by the affected helper.
- [ ] **Step 2: Write movement and wound regressions and observe failure.** Untrained Heavy/profile 0/manual Movement 1 displays 0 and saving 0 preserves manual 1; removing armor reveals 1. Saving a changed positive total correctly stores its manual base. A Devastating-only actor has its card and no empty message; clicking its decrement invokes only the count action. Test doubles retain every listener, like a real DOM; shared hover color and plus/count/minus-or-X layout remain intact.
- [ ] **Step 3: Apply minimal repairs at the shared actor/control boundaries.** Reuse typed absorption and existing source getters; do not add a second buffer algorithm, special hover palette, or new actor data field.
- [ ] **Step 4: Focused verification.** Run the three tests above plus `node tests/e5-active-armor.test.mjs`, `node tests/e5-wounds.test.mjs`, `node tests/e5-wound-accuracy.test.mjs`, `node tests/e5-rest-integration.test.mjs`, and `node tests/e5-scar-recovery.test.mjs`. Syntax-check changed modules. Expect exit 0; obtain independent task review before Task 4.

### Task 4: Retain regressions and complete integration verification

**Files:**
- Modify: `.gitignore` (narrow exceptions only)
- Verify: all repair modules/tests, original integration matrix, `packs/peasant-core-macro`, `packs/peasant-core-table`.

**Interfaces:**
- Keep every existing ignore rule except narrow unignores for `tests/e5-*.test.mjs`, the changed `tests/equipped-armor-effects.test.mjs`, and this new plan. Files become eligible for future source control without staging or committing them.
- Runtime/pack verification produces evidence or an explicit blocker; it does not change pack bytes or existing characters to manufacture a passing result.

- [ ] **Step 1: Add and inspect narrow ignore exceptions.** Verify `git check-ignore` no longer excludes the E5 tests or modified support test. Confirm `.vs/`, existing nested checkout, and unrelated ignored files remain outside this change.
- [ ] **Step 2: Run final verification once on the integrated code.** Discover every `tests/*.test.mjs` dynamically and run each directly with Node, reporting discovered/pass/fail counts. Run `node --check` for every repair-touched module and `git diff --check`. Review the repair diff against preserved pre-task snapshots, resolving every confirmed repair finding.
- [ ] **Step 3: Obtain a final independent review.** Review all task diffs together against this plan and the author's later decisions. Address any newly introduced correctness issues with focused regressions and verification.
- [ ] **Step 4: Inspect available Foundry/compendia verification.** Use Codex when available and reload before evaluating changes. Inspect actual macro/table entries read-only; confirm delegation to current source and ordinary location/AP results. Where accessible, exercise representative repaired owner/remote/replay/undo flows and UI. Report every skipped runtime matrix row and any missing session/permission/runtime blocker; do not equate Node results with live Foundry verification.
- [ ] **Step 5: Report completion with evidence.** Link this plan, list completed repair units and exact checks, identify remaining runtime-only checks/blockers, and confirm unrelated changes and removed Scar behavior were preserved. No Git history operations.
