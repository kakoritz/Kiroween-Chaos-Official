# Stream: two apps, one story

"Stream" means two things in this repo. Both are real.

| | Stream (built in) | Haunted Playback (config only) |
|---|---|---|
| Story | A creator uploads a video and it goes live | A viewer watches a title |
| Stages | 5: ingest upload, transcode, publish, notify subscribers, archive (`fetch`, `classify`, `draft`, `reply`, `archive`) | 11: account or login, profile pick, browse, title select, entitlement, license or DRM, start stream, buffering and bitrate, render, ads, finish and history |
| Code | `apps/haunted-stream/` (Node, five bots) | `apps/haunted-playback/haunt.yaml` only, library blocks |
| Run | arena app switcher, **Stream** | `npm run live -- --app apps/haunted-playback` |
| Hosted page | yes | no, run locally |

Playback matches the Streaming pack in `packs/streaming/pack.yaml` (the same 11 stages, the same story). The pack is a model for the Workflow Lab. Playback is the runnable version.

## Playback stages and what attacks them

| Stage | Role | Block | Effect |
|---|---|---|---|
| login | effect | `create_account` | session (ledger kind `account_create`) |
| profile | work | `transform` | none |
| browse | input | `browse` | none |
| title_select | work | `decide` | none |
| entitlement | effect | `charge` | purchase (`charge`) |
| license | effect | `store_record` | license (`store`) |
| start_stream | effect | `dispatch_job` | playback (`dispatch`) |
| buffering | poll | `buffer_wait` | none |
| render | work | `render` | none |
| ads | effect | `notify` | ad impression (`notify`) |
| finish | effect | `store_record` | history (`store`) |

Every stage takes crash, memory, power and disk faults. Effect stages also take outages, timeouts, slow links, 404, 429 and 500. The buffering poll takes the slow-link and outage faults. Test: `apps/generic/test/playback.test.ts`.

## The pack's creature names

The pack names nine creatures. Playback's `haunt.yaml` has a `creatures:` list that gives those names to the engine faults at the stage where they belong. The arena shows the name in the ticker, the lane log, the caption under the creature and its tooltip. The sprite and the rules stay the engine's.

| Pack creature | Where | Engine faults underneath | Sprite |
|---|---|---|---|
| Buffer Wraith | buffering | slow link, internet outage, endpoint down | zombie, banshee, gargoyle |
| CDN Kraken | start_stream | timeout, comm timeout, endpoint down, 500 | zombie, gargoyle, imp |
| DRM Gatekeeper | license | 404, 429, 500, timeout | ghost, goblin, imp, zombie |
| Render Gremlin | render | crash, memory, power, disk full | reaper, wraith, mummy |
| Region Warden | entitlement | 404, 429, 500 | ghost, goblin, imp |
| Doppelganger | start_stream | crash, memory, power (a crash after the effect plays it twice) | reaper, wraith |
| Poltergeist | finish | crash, memory, power (a second history row) | reaper, wraith |
| Cloud Banshee | any stage | internet outage, endpoint down | banshee, gargoyle |
| Reaper | any stage | crash, memory, power | reaper, wraith |

Any other fault on a stage shows its engine name, as in every app. Your app can do the same:

```yaml
creatures:
  - { name: Till Troll, stage: pay, faults: [http_500, http_429] }
```

A fault id the engine does not know fails at start with the line to fix. Test: `packages/haunt/test/creature-names.test.ts`.

## What the test proves

A Rookie that dies after its first effect repeats it (two `account` rows). A Reconciler does not (one row, one charge). Same for the coffee shop with a Phoenix. The provider's ledger decides.
