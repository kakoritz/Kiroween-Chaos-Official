# Modular engine: requirements

Status: SPEC ONLY. Nothing here is built yet. Rollback point: git tag `v1-fixed-stages` (the full working product before this work).

## Why
The pitch is "any app or service plugs in and gets attacked." Today that is only half true. The chaos catalog, the contract's `stageId` list, the arena and the vocab all know three apps by name (Orders, Ticket Desk, Stream). A new service cannot bring its own stage names. This spec removes that limit and adds composable **blocks** so an app is a composition of reusable parts.

## Terms
- **Block**: one reusable step definition: id, label, role (`input` | `work` | `effect` | `poll`), effects it causes (kind, keyed), default duration, hook points it supports. Examples: `login`, `fetch_upload`, `transcode`, `charge`, `notify`.
- **App manifest**: an ordered composition of blocks plus app-level data (id, label, vocab, ledger, targets). Lives in `haunt.yaml`. Stage ids come from the blocks (optionally renamed per app).
- **Registry**: the runtime list of known apps, built from built-ins and from any `apps/*/haunt.yaml` or `--app <dir>` given at start. Replaces the hard-coded `APPS` constant.
- **Role-based faults**: a fault says which roles/effect kinds it can land on, not which stage names.

## R1. Apps declare their own stages
1. An app manifest declares any number of stages (1 to 24), each with an id matching `^[a-z][a-z0-9_]{1,31}$`, a label, a role and optional effects.
2. The `hello` event carries the declared stages (id, label, role, effects). The arena and harness read the stage list from it.
3. `contract/events.schema.json`: `stageId` becomes the pattern above instead of a fixed enum. `orderId` accepts a per-app prefix (`^[a-z]{2,6}-[0-9]{4}$`). The change is additive: every existing event stays valid.
4. A contract version bump (1.x to 1.y) is advertised in `hello`; `contract/PROTOCOL.md` and the validator document and enforce it. Owner approval is required before merge (contract change).
5. The three built-in apps keep their current stage ids; their wave results do not change.

## R2. Faults attach by role, not by name
1. Each fault in the catalog declares `applies`: roles and/or effect kinds (for example `http_500` applies to `effect` stages; `slow_stage` to `work`; `missing_file` to `input`).
2. An app may add per-stage allow or deny lists in its manifest (for example a stage that is not retryable).
3. The built-in apps get the same fault set on the same stages as today (golden test over all three apps).
4. A new app gets a sensible fault set from its roles alone, with no catalog edit.
5. Creatures shown for a fault are chosen from the fault, so a new app inherits the creature art.

## R3. Registry and discovery
1. `APPS`, `APP_STAGES`, vocab and the app switcher read from the registry.
2. `npm run live -- --app ./path` (and the `custom` bot command) registers an app from a directory with a valid `haunt.yaml`.
3. An invalid manifest fails at start with a plain message naming the file, the field and the fix.
4. `GET /api/apps` lists every registered app with its stages. The arena switcher shows them with no code change.

## R4. Blocks and composition
1. A block library (YAML, data only) ships at least 16 blocks covering the four roles. Every block validates against the block schema.
2. A manifest may reference a block (`use: charge`) and override label, duration, effect key and id.
3. An app may also define a stage inline with no block (no lock-in).
4. Composition is checked: ids unique, at least one `input`-or-`effect` stage, effect keys unique per order, hooks valid for the role.
5. The Workflow Lab exports and imports the same manifest, so a flow built in the browser can be attacked in the arena.
6. Block-alone mode: one block can be run as a one-stage app, to test it in isolation before chaining.

## R5. Generic bot from a manifest
1. For any manifest, the engine can build a runnable generic bot at the five tiers (Rookie to Phoenix), as the packs engine does today. It runs with the fake provider ledger.
2. The generic bot passes the contract validator with zero violations for every shipped manifest.
3. Real bots (Node, Python, own bot) keep working with no change if they use the built-in ids.

## R6. Stream, finished, on the new engine
1. Stream is rebuilt as a composition of blocks, telling one story: a viewer watching a title (login, profile, browse, title select, entitlement, license, start stream, buffering, render, ads, finish). 11 stages, matching `packs/streaming/pack.yaml`.
2. All nine pack creatures land on stages they belong to; each creature has a real effect in a run.
3. Two curses (catalog 404, manifest 500) work on Stream endpoints.
4. Five tier bots plus the campaign Crew run Stream; Rookie shows a duplicate playback or history row after a crash; Reconciler and Phoenix do not.
5. The old 5-stage upload app is kept as a second example (`haunted-upload`) or retired with a note; it never silently disappears.
6. A fourth, tiny app (`examples/coffee-shop`, 5 blocks, config file only, no engine code) proves a new service plugs in.

## R7. UI and vocab follow the manifest
1. Stage names, icons, work animations and verbs come from the manifest (with role defaults if missing).
2. App wording (unit, id prefix, review labels) comes from the manifest vocab with sane defaults.
3. A new app shows a lively lane, tournament, Casebook and improve loop with no UI edit.
4. No stage-name string literal remains in `packages/arena-ui/src` outside the three built-in manifests and tests.

## R8. Scoring, Casebook, improve loop, tournament
1. Scoring, tournament rounds, Casebook entries and fix specs work for any app.
2. Fix specs name the app's own stage ids and effect kinds.
3. Review labels for a new app default to generic ones (Reliability, Speed, Data safety) unless the manifest overrides.

## R9. Documentation
1. `docs/MODULAR.md`: what a block, a manifest and the registry are; how a fault finds its stage; a diagram.
2. `docs/INTEGRATE.md`: five steps to plug in your own service (manifest, bot, run, read the report, apply the fix).
3. `docs/BLOCKS.md`: the block library, generated from the YAML (one source of truth).
4. `docs/STREAM.md`: the Stream story, stages, creatures, curses, tiers.
5. `docs/JUDGE-QA.md`: the questions a judge is likely to ask and where the answer lives (R10).
6. README, START-HERE, OWN-BOT and PACKS no longer say names are fixed; a docs-truth test checks it.

## R10. Self-evaluation against the judges
1. A checklist file `docs/JUDGE-CHECK.md` scores the project on each Kiroween scoring area (Skeleton Crew fit, Kiro use, completeness, originality, polish, usefulness), each with evidence links and a status.
2. A script `npm run judge:check` verifies every evidence link exists and every claim has a test or a file.
3. Every gap the check finds becomes a task or a written, accepted limit.

## R11. Safety net
1. Rollback tag `v1-fixed-stages` exists on the old product.
2. Main stays green after every phase PR. No phase merges with a failing `npm run verify`.
3. Overnight checks run on every phase branch; a regression in Orders, Ticket Desk or the tournament blocks the next phase.

## R12. Test blocks alone, then chain them (wizard flow)
1. Any block can be tested alone: the harness runs a one-block app, attacks it with every fault that fits its role, and gives it a block score card (survived, repeats, recovery time, faults it failed).
2. Block score cards are saved per block and tier in `blocks/results/`, so a block carries its record into every flow that uses it.
3. A chain wizard in the arena: pick blocks from the library, order them, rename them, set options, then press Test chain. It builds the manifest (R4) and runs the same arena, tournament and Casebook on it.
4. A chain score shows each block's share of the failures, so the player sees which block broke the chain.
5. Chain checks warn when a chain is weak although its blocks passed alone (for example two effects with no shared key, or a poll after an effect with no timeout).
6. The wizard and the manifest file are two views of the same data; saving in one updates the other.

## R13. Unknown blocks (bring your own, unseen)
1. A player can add a custom block with any id, role and effects, with no library entry, and test it alone or in a chain.
2. Unknown-fault fuzzing (the existing fuzz pool) runs against custom blocks the same as library blocks; the Casebook records the unknown shapes by fingerprint.
3. A custom block can be promoted to the library file with one command (`npm run block:add`).
4. A block may be backed by a real process (your code) or by the generic model; the score card says which.

## Out of scope
- A visual graph editor with branches and loops (chains are ordered lists).
- A fourth language runtime. Real bots remain Node, Python, or any process speaking the event format.
- Changes to the fake provider's wire format.
- Video, TTS, screenshots, Devpost media (last phase, on the owner's word).
