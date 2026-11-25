# Modular engine: design

## 1. Today (what is fixed)
| Place | Fixed thing |
|---|---|
| `contract/events.schema.json` | `stageId` enum of 30+ names; `orderId` prefix `ord|msg` |
| `packages/haunt/src/chaos/catalog.ts` | stage-name arrays (`ORDERS_ORDER`, `INBOX_ORDER`, `STREAM_ORDER`, `EFFECT_STAGES`, `CALL_STAGES`), `FaultDef.stages` lists |
| `packages/haunt/src/shared/catalog.ts` | `ORDERS_STAGES`, `INBOX_STAGES`, `STREAM_STAGES`, `APPS` constant |
| `packages/core/src/live/catalog.ts` | `AppId` union, `APP_STAGES`, `isAppId` |
| `packages/arena-ui` | vocab, panels and lane code that name stages (e.g. `payment`, `ship`) |
| mock server / in-page mock | app checks and lists |

Already generic: the pack engine (`packages/haunt/src/packs/*`) builds a bot from stages + five parts; `haunt.yaml` already declares roles, effects, durations; `LabModel` validates stage lists.

## 2. Target shape
```
blocks/*.yaml  --use-->  apps/<name>/haunt.yaml  --load-->  Registry  --serve-->  hello / /api/apps
                                                   |                                  |
                                      fault resolver (role + effect kind)       arena, scoring, Casebook
```

### 2.1 Block (data)
```yaml
id: charge
label: Take payment
role: effect
effects: [{ kind: charge, key: "charge:{order}", idempotent: required }]
duration: [600, 1200]
verb: Charging the card
hooks: [before_effect, after_effect_before_journal, after_journal, mid_stage]
```
Roles: `input` (reads a file or message), `work` (CPU or wait, no side effect), `effect` (calls the provider, journaled), `poll` (waits on an outside state).

### 2.2 App manifest (extends today's `haunt.yaml`)
```yaml
name: coffee-shop
label: Coffee Shop
vocab: { unit: order, idPrefix: cof }
stages:
  - { use: read_request }
  - { use: charge, id: pay }
  - { id: brew, label: Brew, role: work, duration: [800, 1500] }
  - { use: notify, id: ready }
```
Rules: ids unique; stage count 1 to 24; at most one `poll` run in a row is allowed to be long; effect keys unique.

### 2.3 Registry
`packages/haunt/src/registry/`: `AppDef = { id, label, stages: StageDef[], vocab, orderPrefix, source: 'builtin' | path }`. Built-ins register at import. `registerFromDir(dir)` loads and validates a manifest. The old `APPS` export becomes a live view of the registry so older code keeps compiling during migration. `AppId` becomes `string` (branded by registry lookup).

### 2.4 Fault resolver
`FaultDef.applies = { roles?: Role[]; effectKinds?: string[]; stageIds?: string[] }`. `facesStage(fault, stageDef)` replaces `fault.stages.includes(stage)`. Old per-name lists are converted by a script into `applies` and a golden test proves the three built-in apps get the identical fault-to-stage table as before (R2.3). Per-app `deny: { stage: [faultIds] }` handles the rare exception.

### 2.5 Contract change (additive, needs owner approval)
- `stageId`: `{ "type": "string", "pattern": "^[a-z][a-z0-9_]{1,31}$" }`.
- `orderId` pattern: `^[a-z]{2,6}-[0-9]{4}$`.
- `hello.stages[]`: `{ id, label, role, effects? }` required fields documented.
- `contractVersion` bump; validator accepts old and new; fixtures regenerate.

### 2.6 Generic bot
Reuse `packs` generic-bot builder. Input is a manifest, output is a runnable process or an in-process runner with the five tiers. The same builder serves the Workflow Lab preview, packs, block-alone mode and new apps.

### 2.7 UI
Arena reads `stages` and `vocab` from `/api/state`. Icon and work animation fall back by role (`input`: inbox, `work`: gear, `effect`: bolt, `poll`: hourglass). Lane popups, review card, Casebook and fix spec use stage labels from state, not constants.

## 2.8 Block-alone and chain testing
- **Alone:** `runBlock(blockId, tier, seed)` makes a one-stage manifest, runs the standard wave with all role-matching faults, and returns a `BlockCard { blockId, tier, survived, repeats, recoveryMs, failedFaults[] }`. Cards are written to `blocks/results/<block>.<tier>.json`.
- **Chain:** the wizard produces a manifest. A chain run is a normal wave. `chainReport` splits failures by stage id back to the block that produced it (`stage.useBlock`), giving per-block blame.
- **Chain checks:** pure functions over the manifest and the cards: unkeyed effect pairs, poll without timeout, effect after a failed-alone block, long chain with no input. They return warnings, never errors.
- **Wizard UI:** a new panel next to the Workflow Lab. Left: block library with its cards. Middle: ordered chain. Right: options and warnings. A Test chain button starts a wave. The Workflow Lab keeps its model view and shares the same manifest store.
- **Unknown blocks:** an inline stage with no `use:` is already legal (R4.3). Marked `custom: true`; the fuzz pool applies by role. `block:add` writes it to `blocks/` after validation.

## 3. Stream on the new engine
Eleven blocks: `login` (effect: session), `profile_pick` (work), `browse` (input), `title_select` (work), `entitlement` (effect: purchase), `license` (effect: license/DRM), `start_stream` (effect: playback), `buffering` (poll), `render` (work), `ads` (effect: ad_impression), `finish` (effect: history). Creatures map by role and effect kind: Buffer Wraith to `buffering` (stall), CDN Kraken to `start_stream` (timeout), DRM Gatekeeper to `license` (status), Render Gremlin to `render` (crash), Cloud Banshee any effect (outage), Region Warden to `entitlement` (status), Doppelganger to `start_stream` (duplicate), Poltergeist to `finish` (duplicate), Reaper any (expire/crash). Ledger tables: sessions, entitlements, playbacks, history. Bots: generic builder at five tiers, plus real Node tier files kept for the `custom` command example.

## 4. Migration order (keeps main green)
1. Registry and manifest loader with built-ins registered (no behavior change).
2. Fault resolver with golden equivalence test.
3. Contract + validator + fixtures (owner approval gate).
4. UI reads from state; remove name literals.
5. Blocks library + generic bot + Workflow Lab export.
6. Stream rebuild + coffee-shop example.
7. Docs, judge check.
Each step is one PR with its own tests; steps 1, 2 and 4 are refactors guarded by golden tests.

## 5. Risks and answers
| Risk | Answer |
|---|---|
| Regression in Orders, Ticket Desk | Golden tests (stage table, fault table, one full wave event hash per app) before any change |
| 83 files name `payment` | Most are tests and fixtures for Orders; they stay valid. A lint test fails on new literals in UI and engine code |
| Contract change breaks bots | Additive; old ids remain valid; validator fixtures for old and new |
| Schedule (8 days) | Each phase merges alone; phases 6 to 7 can ship after 1 to 5 and still tell the plug-in story; drop order in tasks.md |
| Python Ticket Desk applies faults by its own stage name (`desk` kind) | Desk manifest keeps those names; resolver treats `desk` faults as stage-id allow lists |
