# Skill and Notable editor validation — 2026-09-23

Status: **in progress**. This records checks actually performed for Task 10, not a claim that the full acceptance matrix is complete.

## Environment and fixture

- Foundry VTT 14, Build 368, in the reloaded Peasant Core Test World at `http://localhost:30000/game`; signed in as **Codex** (GM).
- Browser viewport: 1440 × 900. The open Notable editor measured 560 px wide, matching the later approved equipment-window minimum rather than the plan's older 520 px figure. A live screenshot of the editor beside the actor sheet and chat sidebar was inspected in this task; it was not saved as a repository asset.
- Created only the disposable actor `Codex QA — Skill/Notable 2026-09-23` (`Actor.z8bgtVDNk57HHEUv`). Existing user actors and Skills were not edited. The actor, QA hotbar slots 1–2, and test chat messages remain in the world for inspection.

## Live checks performed

| Surface | Observation |
| --- | --- |
| Shared Skill editor | Created `Codex QA Musket` in `skills` as Martial / Weapon with Custom Weapon Type `Musket`, STR and DEX, Mixed. Custom text persisted after close/reopen when entered with normal keystrokes and blur. The initial instant-fill automation path did not reliably persist; no application bug was inferred from that path. |
| User Test 1 — layout and persistence | **Original partial failure:** on `Codex QA` / `Codex QA Notable` / Default, custom Weapon Type was blank after Type changed to Custom and back to Weapon, at both narrow and wide widths (screenshots supplied). A focused Node regression reproduced the pending-text loss; the Type/Category save now includes the currently visible subtype field. **User-reported Foundry retest passed:** the Type round trip works, and the custom Weapon Type remains after closing and reopening the editor. |
| User Test 2 — Treatment usage effect creation | **Original failure:** attempting to add one Treatment effect produced many `First Aid Usage Effect` definitions (screenshot supplied). A focused Node regression reproduced duplicate Add Effect callbacks after the Effects browser was replaced during redraw. The outer-window Add Effect listener is now bound once; focused test passes. **User-reported Foundry retest passed:** effect creation no longer multiplies. Existing duplicate effect documents were not removed. |
| Alternate usage | Created `Night Shot`, then renamed it `Night Shot Mk II`. Direct editor use posted a Skill Roll. A copied `@PeasantUsage` link and a separate hotbar macro both still activated the selected usage after the rename. The old link/macro display label did not rename automatically, but its stable target ID worked. |
| Signature identity and counters | Created a Martial Signature Notable with primary and Duress pools. An earlier fixture showed primary 2/4 and Duress 1/2 across editor rerenders; raising maximum from 3 to 4 did not refill current. A canceled pool-selection prompt spent nothing. Choosing Duress changed only Duress 1→0 and posted a Notable Roll card. |
| Tags | Added a 2d8 Lethal Damage tag and one Resource Costs tag containing both Stamina 2 and Attunement 1. Both appeared as compact rows and persisted after closing and reopening the editor. The actor row showed their summaries. |
| Undo regression and fix | On the first live Undo, the Notable reverted to a blank C1R0 entry. The root cause was a nested array-index update for counter restoration in `chat-undo.mjs`. Undo now updates a freshly cloned complete list. After reloading Foundry, a new disposable Signature test spent Duress 1→0; right-click **Undo Roll Effects** restored Duress 0→1 while primary stayed 1/2, and the name, Martial/Signature/Dagger classification, To-Hit 3, and pool settings survived close/reopen. |
| Runtime diagnostics | No Peasant Core warnings or errors were present in the browser's warning/error log after the fix and retest. This does not certify all unrelated modules or workflows. |

## Automated checks

- `node tests/skill-entry-replay.test.mjs`: passed after the new complete-list regression test.
- `node tests/section-add-control-listeners.test.mjs`: passed with the Type-switch/custom Weapon Type regression.
- Direct `tests/skill-entry-*.test.mjs` loop: **12 files, 0 failures**.
- Full direct `tests/*.test.mjs` loop: **100 files, 0 failures**.
- `node --check` on **121** modified or untracked `.mjs` files: **0 failures**.
- `git diff --check`: passed. Git emitted existing line-ending conversion warnings, not whitespace errors.

The first focused loop failed in `skill-entry-use.test.mjs` because its mock did not update `actor.system` when a full source list was written. The mock was corrected to synchronize its visible system data as Foundry does; the focused and full loops then passed.

During the Test 2 duplicate-listener fix, the first full loop failed class-label assertions in `notable-combat-tree.test.mjs` and `skill-entry-editor.test.mjs`. Both passed on immediate isolated rerun, and the next full 100-file loop passed without edits to those display paths. This may be transient; it is not counted as a Foundry runtime check.

## Still required for Task 10

- Complete disposable examples in both collections: full Musket mechanics; Manifest Dome and active effect state; First Aid, Signature First Aid, Alchemy, and Stance/Perk/Custom.
- Visual and keyboard review at the 560 px minimum and normal widths: long names, Social and multiple Characteristics, blank/zero/negative Accuracy, validation, Add/Edit/Move, collapse/expand, unsaved drafts, category/Type changes, and side-by-side Item-sheet comparison. No screenshot file has yet been retained.
- Live primary-pool spend, Edge entire/individual replay, deferred Stress retry, effect offers with permission and repeat-click checks, default/pinned usage, and a nonzero resource-cost Undo. The Duress and basic Undo paths above were exercised; these other paths were not.
- Import a disposable legacy actor with the specified tags/effects/counters/AP/SP/special Types and old hotbar references; save/reload/reorder it and compare authored source paths and effect-modified values.
- Final spec coverage and feature-only orphan review. Do not remove unrelated dirty-worktree changes or claim runtime coverage from the Node tests alone.
