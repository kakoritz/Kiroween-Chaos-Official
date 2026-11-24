# Packs: the reusable skeleton

Chaos Haunt is one skeleton: bots in lanes, a ledger as truth, a fault catalog, graded reports, fix specs. A **pack** is a small
data file that tells the skeleton what the steps of your app are, what can go wrong at each, what the creatures are called,
what the reviewers say, and what each protection means in your domain. A pack is **data, not a new engine**: adding an app
means writing one YAML file, not code.

This page describes the format, walks through the streaming pack, and shows how to add a third app in under 30 minutes.

Packs are **model-based**: the Workflow Lab sweeps a generic bot built from your stages and the protections you declare. The
results come from rules over those declarations, not from running your real code. Every pack screen says so
(`modelBased: true`). To test real code, run the three commands at the end of the Lab report (see "From model to real code").

## The format

`packs/<id>/pack.yaml` (the folder name must equal `id`):

| Key | Required | What it is |
|---|---|---|
| `id` | yes | Lowercase letters, digits, dash or underscore. Not `orders`, `inbox`, `payments` or `report` (built-in presets) |
| `title` | yes | Shown in the Lab, for example "Haunted Stream" |
| `modelBased` | no | Defaults to true. Keep it true until a real app backs the pack |
| `stages` | yes | The steps, in order. `kind` is `input`, `work`, `effect`, `poll` or `final`. An `effect` stage lists its `effects` (`kind`, and `keyed` when it carries an idempotency key) |
| `ledger` | no | The tables a real run would check (`- { id: sessions }`) |
| `faults` | yes | What can go wrong: `id`, `stage` (a stage id or `any`), `creature` (the display name), `art` (a creature the arena can draw), `mode`, `behavior` (the right behavior, in one line) |
| `curses` | no | Persistent traits: an endpoint that always misbehaves. `id`, `endpoint`, optional `stage` and `fault` |
| `reviews` | yes | `label` ("Viewer rating"), `subscores`, and optional `stages` mapping each subscore to the stage ids it is judged on |
| `bosses` | no | A night where several stages are hit together: `id`, `label`, `hits` (stage ids), `story` |
| `tiers` | yes | What each protection means here: `retry`, `journal`, `idempotency`, `breaker`, `offline_queue` |

`art` is one of: `reaper`, `wraith`, `banshee`, `zombie`, `ghost`, `goblin`, `imp`, `poltergeist`, `doppelganger`, `witch`,
`mummy`. `mode` is one of `duplicate`, `timeout`, `stall`, `status`, `crash`, `outage`, `expire`, `corrupt`, `misroute`;
it decides what the lab does at that stage (a duplicate is a repeated effect, an outage is a long dependency failure, and so
on). A curse `fault` is a catalog fault: `http_404`, `http_429`, `http_500`, `timeout`, `crash`, `power_outage`,
`internet_outage`, `missing_file`, `duplicate_request`, `malformed_payload`, `disk_full`. Validation errors name the path, for
example `faults[2].stage: must be a declared stage id or "any"`.

### How the lab consumes a pack

- **Stages and parts.** The generic bot is built from `stages`. The five tiers (Rookie to Phoenix) switch parts on:
  Rookie none, Retrier retry, Journaler retry and journal, Reconciler adds idempotency keys, Phoenix adds the breaker and
  the offline queue.
- **Faults** land on the stage the pack names, next to the generic creatures. `duplicate_storm` at `dedupe` is a duplicate
  request: with no idempotency key the ticket is created more than once.
- **Curses** are persistent traits. The cursed stage sees the fault in every cell of the sweep, not once. If the protection
  that would absorb it is missing (a retry for an HTTP error), every cell at that stage gets worse.
- **Bosses** are sweep scenarios. A boss night applies the pack faults of every stage it hits at the same time. Three or more
  stages failing together punish retries that have no breaker or queue (they finish late). A boss is survived when no hit
  ends in a failure, a halt or a repeated effect. Failed boss nights feed the "add this part" suggestions.
- **Reviews** become 1 to 5 star sub-scores, judged on the stages mapped in `reviews.stages`. A repeated effect caps a
  sub-score at 2 stars; a lost order is 1 star.
- **Tiers** text appears next to each "add this part" suggestion, so "add idempotency" reads "one stream per account and one
  history write per play" in the streaming pack.

## The streaming example

`packs/streaming/pack.yaml` (trimmed; the full file has 11 stages, 9 faults, 2 curses, 2 bosses):

```yaml
id: streaming
title: Haunted Stream
modelBased: true
stages:
  - { id: login, label: Account or login, kind: effect, effects: [{ kind: session, keyed: true }] }
  - { id: start_stream, label: Start stream, kind: effect, effects: [{ kind: playback, keyed: true }] }
  - { id: buffering, label: Buffering and bitrate, kind: poll }
  - { id: render, label: Render, kind: work }
faults:
  - { id: cdn_timeout, stage: start_stream, creature: CDN Kraken, art: zombie, mode: timeout, behavior: "Failover to a second CDN, circuit breaker" }
  - { id: double_play, stage: start_stream, creature: Doppelganger, art: doppelganger, mode: duplicate, behavior: "Idempotent session, one stream per account" }
curses:
  - { id: cursed_manifest, endpoint: manifest, stage: buffering, fault: http_500 }
reviews:
  label: Viewer rating
  subscores: [startup_time, buffering, render, ads, ease]
  stages: { startup_time: [login, start_stream], buffering: [buffering], render: [render] }
bosses:
  - { id: cdn_kraken, label: Kraken, hits: [start_stream, buffering, render], story: "CDN plus buffering plus render in one night" }
tiers:
  idempotency: "One stream per account and one history write per play (keys), so a retry never double-streams or re-buys"
```

What it teaches: the **double stream** after a blind retry. The Retrier repeats the playback and purchase effects; the
Reconciler's keys fix it; the Phoenix survives the Kraken night. The ticketing pack (`packs/ticketing/pack.yaml`) teaches the
same lesson in another domain: **duplicate tickets** (`webhook_retry_storm`, `duplicate_storm`) and lost replies.

## Add a third app in under 30 minutes

The proof that the skeleton is reusable: a new app is a new folder, and nothing else changes. Example: a **shop-desk** app.

1. **Scaffold (1 minute).** `npm run haunt -- pack new shop-desk --title "Haunted Shop"`. This writes
   `packs/shop-desk/pack.yaml` from a validated template (5 stages, 4 faults, a curse, a boss, a review, the five tier texts).
   It refuses a bad or existing id.
2. **Write the stages (5 to 10 minutes).** Replace the five template stages with the real steps of your app, in order. Mark
   every step that changes the outside world as `effect` and list what it writes. Say whether each effect carries an
   idempotency key (`keyed`). This is the part that needs thinking; the rest is words.
3. **Name the faults (5 to 10 minutes).** For each stage, ask "what goes wrong here?" and pick the closest `mode` and `art`.
   Write the right behavior in one line: it is the spec of the fix. Add one curse (the endpoint that always misbehaves) and
   one boss (the worst night).
4. **Say what the reviewers say (3 minutes).** Name the review and its sub-scores, and map each to stages in `reviews.stages`.
   Rewrite the five `tiers` lines in your domain's words.
5. **Check it (1 minute).** `npm run haunt -- pack check shop-desk` validates the pack and sweeps it: it prints the Rookie
   and Phoenix grade and how many bosses Phoenix survives. A healthy pack reads Rookie F, Phoenix A.
6. **Put it in the Workflow Lab (1 minute).** `npm run packs:embed` regenerates `packages/haunt/src/packs/embedded.ts` (the
   browser bundle has no file access, so it carries a copy of every `packs/*/pack.yaml`). Every pack folder becomes a Lab
   preset automatically; there is no list to edit. Never edit `embedded.ts` by hand: a test fails when it drifts, and
   `npm run packs:embed -- --check` tells you before that.
7. **Run it.** `npm run ui:build`, then open the Workflow Lab and pick the pack. You see the pack title, the creatures, the
   review sub-scores, the boss nights and curses, and "add this part" suggestions mapped to the reviewer rules (R1 to R8).

### From model to real code

The Lab report exports `haunt.yaml` and shows the three commands that run the real sweep on real code:

```
npm run haunt -- init          # writes haunt.yaml (from a pack: npm run haunt -- init --pack shop-desk)
npm run haunt -- validate      # checks haunt.yaml
npm run haunt -- sweep         # runs the real faults against your real bot and grades it
```

There is no `haunt` binary: always go through `npm run haunt --`. A pack argument is an id (`shop-desk`) or a path to a pack
folder or its `pack.yaml`; both work from any folder (relative paths are resolved from where you typed the command). Validate and sweep take `haunt.yaml` (`validate haunt.yaml`, `sweep --config haunt.yaml`). A pack stays labelled model-based until a real app backs it. Two real apps live
in this repo: `apps/haunted-orders` (Node) and `apps/haunted-inbox` (Python). The streaming and ticketing packs are
model-based demos.

## Reviewer rules in the Lab

"Add this part" names the rules that fired, so a suggestion is traceable to evidence:

| Rule | What it saw | Usually answered by |
|---|---|---|
| R1 | A side effect ran twice | idempotency |
| R2 | A short error ended an order that a retry would have saved | retry |
| R3 | A failing dependency was hammered | breaker |
| R4 | One unhandled error halted the whole lane | offline queue |
| R5 | A missing input file failed the order | offline queue |
| R6 | Recovery took longer than the target | journal |
| R7 | The journal and the ledger disagree | idempotency |
| R8 | A failure inside a failure was not handled | review the recovery code |

## Limits

- A pack describes a model. It does not prove your code is safe; the real sweep does.
- Creatures are drawn from the existing set (`art`). A new creature needs new art in the arena, which is not a pack change.
- `kind: effect` stages are the only ones with side effects; keep a stage to one idea, as the template does.
- Pack ids are lowercase; a folder name that differs from `id` is rejected.
