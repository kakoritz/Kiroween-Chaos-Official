# Modular engine: tasks

Rule: one PR per phase, spec ticks only when done, `npm run verify` green before push, owner merges. Estimates are for planning, not promises.

## M0. Safety net (0.5 d)
- [x] 0.1 Tag `v1-fixed-stages` on main (done).
- [ ] 0.2 Golden tests: stage table per app, fault-to-stage table per app, event hash of one seeded wave per app. They must pass unchanged through M1 to M3.
- [ ] 0.3 Size check: list every place that names stages (script `tools/stage-literals.mjs`), commit the report to the spec.

## M1. Registry (1 d)
- [ ] 1.1 `AppDef` and registry; built-ins register.
- [ ] 1.2 `APPS`, `APP_STAGES`, `isAppId` read the registry; `AppId` loosens to `string`.
- [ ] 1.3 Manifest loader and validator with plain error messages (R3.3).
- [ ] 1.4 `--app <dir>` and `custom` command register an app (R3.2).
- [ ] 1.5 `/api/apps` and the mock server list the registry (R3.4).

## M2. Role-based faults (1 d)
- [ ] 2.1 `FaultDef.applies`; convert catalog; resolver `facesStage`.
- [ ] 2.2 Per-app deny list.
- [ ] 2.3 Golden equivalence test passes (R2.3).
- [ ] 2.4 A fresh test app gets faults by role only (R2.4).

## M3. Contract (0.5 d) , OWNER APPROVAL GATE
- [ ] 3.1 Schema: `stageId` pattern, `orderId` pattern, `hello.stages` documented.
- [ ] 3.2 Version bump; PROTOCOL.md; validator; fixtures old and new.
- [ ] 3.3 Owner approves the PR before merge.

## M4. UI follows the manifest (1 d)
- [ ] 4.1 Stage labels, icons, animations, verbs from state with role fallbacks.
- [ ] 4.2 Vocab from manifest; review labels default generic.
- [ ] 4.3 Remove name literals from `arena-ui/src`; lint test guards it (R7.4).

## M5. Blocks and generic bot (1.5 d)
- [ ] 5.1 Block schema; 16+ blocks in `blocks/`.
- [ ] 5.2 `use:` composition with overrides; composition checks (R4.4).
- [ ] 5.3 Generic bot builder for any manifest at five tiers; contract-validator pass (R5).
- [ ] 5.4 Workflow Lab import and export of manifests (R4.5).
- [ ] 5.5 Block-alone mode (R4.6).

## M5b. Alone, then chained (2 d)
- [ ] 5b.1 `runBlock` and `BlockCard`; results files (R12.1, R12.2).
- [ ] 5b.2 Chain wizard panel: library, order, options, Test chain (R12.3, R12.6).
- [ ] 5b.3 Chain blame report and chain checks (R12.4, R12.5).
- [ ] 5b.4 Custom blocks, fuzz on custom blocks, `npm run block:add` (R13).
- [ ] 5b.5 Tests for each, including a chain that passes its blocks alone and still gets a warning.

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
