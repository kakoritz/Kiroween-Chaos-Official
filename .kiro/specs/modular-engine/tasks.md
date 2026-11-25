# Modular engine: tasks

Rule: one PR per phase, spec ticks only when done, `npm run verify` green before push, owner merges. Estimates are for planning, not promises.

## M0. Safety net (0.5 d)
- [x] 0.1 Tag `v1-fixed-stages` on main (done).
- [x] 0.2 Golden tests: stage table per app, fault-to-stage table per app, event hash of one seeded wave per app. They must pass unchanged through M1 to M3.
- [x] 0.3 Size check: list every place that names stages (script `tools/stage-literals.mjs`), commit the report to the spec.

## M1. Registry (1 d)
- [x] 1.1 `AppDef` and registry; built-ins register.
- [x] 1.2 `APPS`, `APP_STAGES`, `isAppId` read the registry; `AppId` loosens to `string`.
- [x] 1.3 Manifest loader and validator with plain error messages (R3.3).
- [x] 1.4 `--app <dir>` registers an app at live start (R3.2). The `custom` bot command takes the app's stages in M5 (generic bot).
- [x] 1.5 `/api/apps` and the mock server list the registry (R3.4).

## M2. Role-based faults (1 d)
- [x] 2.1 `FaultDef.applies`; convert catalog; resolver `facesStage`.
- [x] 2.2 Per-app deny list.
- [x] 2.3 Golden equivalence test passes (R2.3).
- [x] 2.4 A fresh test app gets faults by role only (R2.4).

## M3. Contract (0.5 d) , OWNER APPROVAL GATE
- [x] 3.1 Schema: `stageId` pattern, `orderId` pattern, `hello.stages` documented.
- [x] 3.2 Version bump; PROTOCOL.md; validator; fixtures old and new.
- [x] 3.3 Owner approved the contract change (2026-11-25).

## M4. UI follows the manifest (1 d)
- [x] 4.1 Stage labels, icons, animations, verbs from state with role fallbacks.
- [x] 4.2 Vocab from manifest; review labels default generic.
- [x] 4.3 Remove name literals from `arena-ui/src`; lint test guards it (R7.4).

## M5. Blocks and generic bot (1.5 d)
- [x] 5.1 Block library (22 blocks) in `packages/haunt/src/blocks/library.ts`, the one source of truth (data, browser-safe); docs/BLOCKS.md is generated from it in M7.
- [x] 5.2 `use:` composition with overrides; composition checks (R4.4).
- [x] 5.3 Generic bot for any manifest at the five tiers plus Crew (`apps/generic`, `dist/generic-bots`), run as real processes in tests. Contract check of a live generic wave runs in `validate:live` (overnight).
- [x] 5.4 Workflow Lab and manifest are two views: `labToYaml` exports, `configToLab` imports (tested on every preset and on a block flow) (R4.5).
- [x] 5.5 Block-alone mode: `blockAsApp` runs any block as a one-stage app (R4.6).

## M5b. Alone, then chained (2 d)
- [x] 5b.1 `runBlock` and `BlockCard`; results files (R12.1, R12.2).
- [x] 5b.2 Chain wizard page `chain.html` (library with alone cards, order, rename, YAML both ways, Test chain). Checked once in headless Chrome (rookie chain gives a grade and a blame table); the overnight e2e gets a check in M7 (R12.3, R12.6).
- [x] 5b.3 Chain blame report and chain checks (R12.4, R12.5).
- [x] 5b.4 Custom blocks (inline stages), `npm run block:add -- <haunt.yaml> <stage>` writes `blocks/user.yaml`; the unknown-fault fuzz pool lands by role, so it hits custom blocks too (R13). Casebook fingerprints of unknown shapes on custom blocks are checked in M7.
- [x] 5b.5 Tests for each, including a chain that passes its blocks alone and still gets a warning.

## M6. Stream and the example app (1.5 d)
- [ ] 6.1 Stream manifest from blocks (11 stages), ledger tables.
- [ ] 6.2 Nine creatures and two curses land correctly (R6.2, R6.3).
- [ ] 6.3 Five tier bots plus Crew; Rookie duplicate vs Reconciler (R6.4).
- [ ] 6.4 Keep the upload app as `haunted-upload` or retire with a note (R6.5).
- [ ] 6.5 `examples/coffee-shop` config-only app runs a wave and a tournament (R6.6).

## M7. Docs and judge self-check (1 d)
- [ ] 7.1 `docs/MODULAR.md`, `INTEGRATE.md`, `BLOCKS.md` (generated), `STREAM.md`.
- [ ] 7.2 Update README, START-HERE, OWN-BOT, PACKS; docs-truth test.
- [ ] 7.3 `docs/JUDGE-CHECK.md` and `npm run judge:check` (R10).
- [ ] 7.4 Fix every gap found, or record an accepted limit.

## Drop order if time slips
Last in, first out: 6.4, 5b.4, 5.5, 5.4, 7.4 partial. The wizard (5b.2) and block cards (5b.1) stay. Never drop M0 to M4, 6.1 to 6.3, 7.1 to 7.3.

## Dates (planning, today is Nov 25)
M0 to M2 by Nov 27, M3 PR Nov 28, M4 and M5 by Nov 30, M5b Dec 1, M6 Dec 2, M7 Dec 2 to 3, buffer and demo work Dec 2 to 3. Submit Dec 3.
