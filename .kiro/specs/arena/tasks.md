# Tasks: Arena

Do after Phase 1 of [haunted-house tasks](../haunted-house/tasks.md) (hero crash works headless).

## Phase A: Playable race
- [ ] A1. Pipeline module with eight stages and the five policy tiers. (A1, Lanes)
- [ ] A2. Wave manager and five lane workers with an event log. (A8)
- [ ] A3. Canvas arena: lanes, sprites, work, cheer, fail animations, progress bars. (A1)
- [ ] A4. Rank board, ledger panel, score engine. (A1.5, A7)

## Phase B: Chaos
- [ ] B1. Chaos director and SDK hook points, nested fault stack. (A3)
- [ ] B2. Six monkeys end to end: Crash, Timeout, 404, Missing file, Duplicate, Power outage. (A4)
- [ ] B3. Monkey animations and the stack badge. (A3)
- [ ] B4. Random chaos mode with frequency slider and seed. (A6)
- [ ] B5. Mini boss schedule and warning banner. (A5)
- [ ] B6. Remaining monkeys from the catalog. (A4)

## Phase C: Inspect and learn
- [ ] C1. Stage inspector popup with live stream, Chaos button and replay. (A2)
- [ ] C2. Rule-based reviewer: postmortem and hardening spec writer. (A9)
- [ ] C3. Wave-over-wave score delta view. (A9.4)
- [ ] C4. Optional LLM pass for suggested diffs. (A9.5)

## Phase D: Show
- [ ] D1. Demo mode 3-minute script. (A10)
- [ ] D2. Sound effects. (A1)
- [ ] D3. Perf check at 5 lanes, 60 fps. (Acceptance 1)
- [ ] D4. Record the video, write the Devpost text.

## Cut line
If time is short, ship A, B1 to B5, C1, C2, D1. Everything else is polish.

## Lane split (see docs/SWIMLANES.md)

This spec is **Lane B, Visuals** (`packages/arena-ui/`), built against `contract/CONTRACT.md` and the mock server.

Backend items in this file belong to **Lane A** and are tracked in `.kiro/specs/harness/tasks.md`: A1 (pipeline and tiers), A2 (wave manager, event log), A4 score engine, B1 (chaos director), B2 and B6 (monkey behavior), B4 (random mode engine), B5 (boss schedule), C2 and C4 (reviewer).

Lane B owns: A3, the rank board and ledger panel views, B3, the B4 slider UI, the B5 banner, C1, C3 views, D1, D2, D3, D4, plus a report viewer for the harness HTML report.

## Win-the-hackathon items for Lane B (see docs/WINNING.md)
- [ ] W1. UI works in all three contract modes: `mock`, `live`, `browser`. No mode-specific code.
- [ ] W2. A mode badge and an "Open in demo mode" button so judges land on a running show in under 5 seconds.
- [ ] W3. App switcher: Haunted Orders and Haunted Inbox, same arena, different stage names and sprites. Stage names come from `/api/state`, not hard-coded.
- [ ] W4. Report viewer with the before and after (wave 1 vs wave 2) side by side.
- [ ] W5. Kiro Crew app page that hosts the arena (see harness H6.9).
- [ ] W6. Polish pass: consistent palette, sound with a mute button, motion that follows reduced-motion, readable at 1080p video capture.
- [ ] W7. Accessibility: keyboard Chaos, color-blind safe states (icons plus color).
- [ ] W8. Video capture helper: a "present mode" that hides cursor chrome and shows a clean frame.

## Frankenstein theme (category change, see docs/WINNING.md)
- [ ] F1. Lab look: dark lab, lightning, sparks, tesla coils, stitched-thread borders. Characters are creatures, not ghosts.
- [ ] F2. Each creature shows its parts as visible limbs: Journal, Idempotency Keys, Retry, Circuit Breaker, Offline Queue. Missing parts are bare bones with loose stitches. The part list comes from `/api/state`.
- [ ] F3. "Stitch" animation: when a part is added (event `part_stitched`), a needle sews it on with a lightning flash, score ticks up.
- [ ] F4. Resume plays an "It's alive!" moment. Death plays a flat-line.
- [ ] F5. Monkeys styled as lab accidents and an angry mob. Bosses are storms.
- [ ] F6. Lab sound set generated in code: crackle, thunder, zap, sting.
