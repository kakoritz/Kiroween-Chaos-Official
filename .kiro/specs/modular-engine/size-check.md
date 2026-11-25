# Modular engine: size check (M0.3)

Run: `node tools/stage-literals.mjs` (add `--json` for the file list). It counts source files that name a stage id as a quoted string. Docs and specs are skipped.

| Group | Files | Literals |
|---|---|---|
| tests | 120 | 1104 |
| haunt engine | 35 | 478 |
| core | 15 | 161 |
| apps | 4 | 99 |
| tools | 2 | 36 |
| arena-ui | 9 | 29 |
| other | 2 | 13 |
| **total** | **187** | |

Non-test files with the most literals (the real work): `chaos/catalog.ts` 100, `shared/catalog.ts` 89, `haunted-inbox/bot/run.py` 73, `pipeline/pipeline.ts` 54, `sim/fixtures-v11.ts` 36, `tournament/curses.ts` 31, `provider/provider.ts` 31, `sim/plan.ts` 30, `sim/fixtures.ts` 26, `chaos/director.ts` 22, `tournament/rounds.ts` 20, `bot/runtime.ts` 20, `runner/provider.ts` 19, `lab/model.ts` 19. 67 non-test files in all.

Reading:
- The 120 test files keep Orders ids on purpose; they stay valid (the built-in apps do not change).
- The engine work is about 35 files in `packages/haunt/src` and 15 in `packages/core/src`. Two files (`chaos/catalog.ts`, `shared/catalog.ts`) hold about a third of the engine literals; M1 and M2 start there.
- `arena-ui` has only 9 files and 29 literals, so M4 is the smallest phase.
- `haunted-inbox/bot/run.py` (73) is the Python Ticket Desk applying faults by its own stage name. It keeps its names (the design table's last row); the resolver treats its `desk` faults as id allow lists.

Plan check: the estimates in `tasks.md` hold. No phase grew.
