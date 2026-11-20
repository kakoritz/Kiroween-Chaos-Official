> **First draft, partly superseded.** The rules in `.kiro/specs/engine/` and the files in `contract/` win. Rooms became the creature and fault catalog, SQLite became JSONL, and the task list is replaced by `.kiro/specs/harness/tasks.md`. See `docs/SPEC-MAP.md`.

# Tasks

Order matters. The hero demo comes first, the rest widens it.

## Phase 1: Hero demo (must ship)

- [ ] 1. Scaffold TypeScript, Vitest, lint, `npm run demo` stub. (R8)
- [ ] 2. Fake provider with idempotency keys and its own ledger. (R7)
- [ ] 3. SDK: journal, `step()`, `effect()`, replay and reconcile. (R3)
- [ ] 4. Naive bot and Survivor bot for the order workflow. (R3)
- [ ] 5. Chaos controller and named crash points, real SIGKILL. (R2)
- [ ] 6. Runner with auto-restart and event bus. (R2, R4)
- [ ] 7. Crypt room end to end: naive 2 charges, survivor 1 charge. (R1)
- [ ] 8. Property test over all crash points. (Testing)

## Phase 2: See it

- [ ] 9. Report builder: HTML and JSON, journal vs ledger table. (R4)
- [ ] 10. UI floor plan, ghosts, ledger panel over SSE. (R5)
- [ ] 11. Kill button and demo mode (90 s script). (R5)
- [ ] 12. Generated sound effects. (R5)

## Phase 3: Widen it

- [ ] 13. Cellar room with quarantine and resume. (R1, R3.5)
- [ ] 14. Mirror Hall room. (R1, R3.4)
- [ ] 15. Poltergeist room. (R1.2)
- [ ] 16. Locked Door room with "DIED but safe" verdict. (R1.2)
- [ ] 17. SDK docs and `haunt` CLI. (R6)

## Phase 4: Win it

- [ ] 18. Determinism test and CI. (Acceptance 3)
- [ ] 19. README with GIF of the hero demo, and "How Kiro built this". (R8)
- [ ] 20. Record the 3-minute demo video from demo mode.
- [ ] 21. Devpost text: problem, solution, Kiro usage, category.

## Kiro usage plan

- **Specs:** this folder drives the build. Each task is run from `tasks.md`.
- **Steering:** `.kiro/steering/product.md` and `tech.md` keep the style and rules fixed.
- **Hooks:** on save of `src/sdk/**`, run the property test. On save of `rooms/**`, run that room.
- **Story for judges:** Kiro was used to build a tool whose whole point is surviving crashes, and the spec itself states the crash behavior as testable requirements.
