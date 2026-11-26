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

The pack names nine creatures (Buffer Wraith, CDN Kraken, DRM Gatekeeper, Render Gremlin, Cloud Banshee, Region Warden, Doppelganger, Poltergeist, Reaper). They show in the Workflow Lab and the Casebook model. In the live arena a Playback stage is attacked by the engine's creatures (zombie, imp, ghost, reaper...) for the same fault. The behavior is what the pack names mean: a stalled buffer is a slow link, a CDN timeout is a timeout, a DRM denial is an HTTP status.

## What the test proves

A Rookie that dies after its first effect repeats it (two `account` rows). A Reconciler does not (one row, one charge). Same for the coffee shop with a Phoenix. The provider's ledger decides.
