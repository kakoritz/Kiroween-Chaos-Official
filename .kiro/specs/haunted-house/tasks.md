> **First draft, partly superseded.** The rules in `.kiro/specs/engine/` and the files in `contract/` win. Rooms became the creature and fault catalog, SQLite became JSONL, and the task list is replaced by `.kiro/specs/harness/tasks.md`. See `docs/SPEC-MAP.md`.

# Tasks

Order matters. The hero demo comes first, the rest widens it.

## Phase 1: Hero demo (must ship)

- [x] 1. Scaffold TypeScript, Vitest, lint, `npm run demo` stub. (R8)
- [x] 2. Fake provider with idempotency keys and its own ledger. (R7)
- [x] 3. SDK: journal, `step()`, `effect()`, replay and reconcile. (R3)
- [x] 4. Naive bot and Survivor bot for the order workflow. (R3)
- [x] 5. Chaos controller and named crash points, real SIGKILL. (R2)
- [x] 6. Runner with auto-restart and event bus. (R2, R4)
- [x] 7. Crypt room end to end: naive 2 charges, survivor 1 charge. (R1)
- [x] 8. Property test over all crash points. (Testing)

## Phase 2: See it

- [x] 9. Report builder: HTML and JSON, journal vs ledger table. (R4)
- [x] 10. UI floor plan, ghosts, ledger panel over SSE. (R5)
- [x] 11. Kill button and demo mode (90 s script). (R5)
- [x] 12. Generated sound effects. (R5)

## Phase 3: Widen it

- [x] 13. Cellar room with quarantine and resume. (R1, R3.5) *(superseded: the creature and fault catalog replaced rooms; see docs/SPEC-MAP.md)*
- [x] 14. Mirror Hall room. (R1, R3.4) *(superseded: the creature and fault catalog replaced rooms; see docs/SPEC-MAP.md)*
- [x] 15. Poltergeist room. (R1.2) *(superseded: the creature and fault catalog replaced rooms; see docs/SPEC-MAP.md)*
- [x] 16. Locked Door room with "DIED but safe" verdict. (R1.2) *(superseded: the creature and fault catalog replaced rooms; see docs/SPEC-MAP.md)*
- [x] 17. SDK docs and `haunt` CLI. (R6) *(SDK built; the CLI is `haunt sweep` and friends, see runtime.md section 13)*

## Phase 4: Win it

- [x] 18. Determinism test and CI. (Acceptance 3)
- [x] 19. README with GIF of the hero demo, and "How Kiro built this". (R8)
- [ ] 20. Record the 3-minute demo video from demo mode.
- [ ] 21. submission text: problem, solution, Kiro usage, category.

## Kiro usage plan

- **Specs:** this folder drives the build. Each task is run from `tasks.md`.
- **Steering:** `.kiro/steering/product.md` and `tech.md` keep the style and rules fixed.
- **Hooks:** on save of `src/sdk/**`, run the property test. On save of `rooms/**`, run that room.
- **Story for judges:** Kiro was used to build a tool whose whole point is surviving crashes, and the spec itself states the crash behavior as testable requirements.
