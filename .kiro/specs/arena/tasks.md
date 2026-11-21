# Tasks: Arena

Do after Phase 1 of [haunted-house tasks](../haunted-house/tasks.md) (hero crash works headless).

## Phase A: Playable race
- [ ] UI-A1. Pipeline module with eight stages and the five policy tiers. (A1, Lanes)
- [ ] UI-A2. Wave manager and five lane workers with an event log. (A8)
- [x] UI-A3. Canvas arena: lanes, sprites, work, cheer, fail animations, progress bars. (A1)
- [x] UI-A4. Rank board, ledger panel, score engine. (A1.5, A7)

## Phase B: Chaos
- [ ] UI-B1. Chaos director and SDK hook points, nested fault stack. (A3)
- [ ] UI-B2. Six creatures end to end: Crash, Timeout, 404, Missing file, Duplicate, Power outage. (A4)
- [x] UI-B3. Creature animations and the stack badge. (A3)
- [x] UI-B4. Random chaos mode with frequency slider and seed. (A6)
- [x] UI-B5. Mini boss schedule and warning banner. (A5)
- [ ] UI-B6. Remaining creatures from the catalog. (A4)

## Phase C: Inspect and learn
- [ ] UI-C1. Stage inspector popup with live stream, Chaos button and replay. (A2)
- [ ] UI-C2. Rule-based reviewer: postmortem and hardening spec writer. (A9)
- [ ] UI-C3. Wave-over-wave score delta view. (A9.4)
- [ ] UI-C4. Optional LLM pass for suggested diffs. (A9.5)

## Phase D: Show
- [ ] UI-D1. Demo mode 3-minute script. (A10)
- [ ] UI-D2. Sound effects. (A1)
- [ ] UI-D3. Perf check at 5 lanes, 60 fps. (Acceptance 1)
- [ ] UI-D4. Record the video, write the Devpost text.

## Cut line
If time is short, ship A, B1 to B5, C1, C2, D1. Everything else is polish.

## Lane split (see docs/SWIMLANES.md)

This spec is **Lane B, Visuals** (`packages/arena-ui/`), built against `contract/CONTRACT.md` and the mock server.

Backend items in this file belong to **Lane A** and are tracked in `.kiro/specs/harness/tasks.md`: A1 (pipeline and tiers), A2 (wave manager, event log), A4 score engine, B1 (chaos director), B2 and B6 (creature behavior), B4 (random mode engine), B5 (boss schedule), C2 and C4 (reviewer).

Lane B owns: A3, the rank board and ledger panel views, B3, the B4 slider UI, the B5 banner, C1, C3 views, D1, D2, D3, D4, plus a report viewer for the harness HTML report.

## Win-the-hackathon items for Lane B (see docs/WINNING.md)
- [x] UI-W1. UI works in all three contract modes: `mock`, `live`, `browser`. No mode-specific code.
- [x] UI-W2. A mode badge and an "Open in demo mode" button so judges land on a running show in under 5 seconds.
- [ ] UI-W3. App switcher: Haunted Orders and Haunted Inbox, same arena, different stage names and sprites. Stage names come from `/api/state`, not hard-coded.
- [ ] UI-W4. Report viewer with the before and after (wave 1 vs wave 2) side by side.
- [ ] UI-W5. Kiro Crew app page that hosts the arena (see harness H6.9).
- [ ] UI-W6. Polish pass: consistent palette, sound with a mute button, motion that follows reduced-motion, readable at 1080p video capture.
- [ ] UI-W7. Accessibility: keyboard Chaos, color-blind safe states (icons plus color).
- [ ] UI-W8. Video capture helper: a "present mode" that hides cursor chrome and shows a clean frame.


## Skeleton Crew theme (see docs/WINNING.md)
- [x] UI-S1. Crypt look per ui-spec section 20 (stone floors, torch pools, cobwebs, fog).
- [x] UI-S2. Skeleton sprite built from bones in code, with poses: work, cheer, fail (collapse), recover (reassemble), dead.
- [x] UI-S3. Gear overlays for the five resilience parts. Gear list comes from `/api/state`.
- [x] UI-S4. Equip animation when `part_added` arrives: gear flies to the skeleton, score ticks up.
- [ ] UI-S5. Creature sprites and animations from the table in design.md. Start with Reaper, Zombie, Ghost, Wraith, Poltergeist, Doppelganger, plus the Lich boss.
- [ ] UI-S6. Orders as parchment scrolls: queue in the lane stats area, one drops into the hand at `order_start`.
- [ ] UI-S7. Sound set generated in code: bone rattle, creak, wail, thud, sting.


Task ids are prefixed `UI-` (for example `UI-A3`) so they do not collide with requirement ids or acceptance rows. `ui-spec.md` is the visual source of truth.

## Where to start (see docs/HANDOFF-VISUALS.md)
1. Read order in the handoff doc.
2. Build against fake events using the types in `contract/PROTOCOL.md` until Lane A merges H0.
3. Every outcome you must draw is listed in `.kiro/specs/engine/acceptance.md` table A.
4. Sprites for creatures: see the creature table in `ui-spec.md` section 7. Start with Reaper, Zombie, Ghost, Wraith, Poltergeist, Doppelganger, Lich.

## Art tasks (do first, see docs/ART-DIRECTION.md)
- [x] UI-ART0. Sprite lab page `packages/arena-ui/lab.html` showing every character, pose and creature animation with play buttons.
- [x] UI-ART1. Skeleton rig (SVG, pivots) with idle, walk, cheer, collapse, reassemble. Screenshot review gate.
- [x] UI-ART2. Five tier dressings. Screenshot review gate.
- [x] UI-ART3. Reaper, Zombie, Ghost, Wraith, Poltergeist, Doppelganger, Lich. Screenshot review gate.
- [ ] UI-ART4. Remaining creatures, crypt background layers, props.
- [ ] UI-ART5. Keep `docs/ASSETS.md` current: every CC0 asset with pack, author, licence (CC0 or Public Domain) and URL, added before the asset is committed. Re-style CC0 art to the style guide.

