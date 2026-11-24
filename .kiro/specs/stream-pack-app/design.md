# Stream pack app: design

## Shape
The app is one more row in the app table, not a new engine. Three places know an app: the stage table (`shared/catalog.ts`), the live catalog and server (`core/src/live`), and the bot command (`live/runtime.ts`). Orders and the Ticket Desk plug in the same way.

## Stages (five)
| id | label | role | provider call |
|---|---|---|---|
| fetch | Ingest upload | effect | `store` (index 1) |
| classify | Transcode | work | none |
| draft | Publish | effect | `dispatch` |
| reply | Notify subscribers | effect | `notify` (index 1) |
| archive | Archive | effect | `store` (index 2) |

Stage ids come from the contract's closed `stageId` enum (`contract/events.schema.json`), so the app needs no contract change: `fetch`, `classify`, `draft`, `reply` and `archive` are enum members no other app uses, and the labels carry the meaning. `STAGE_SERVICE` maps `fetch` and `archive` to `store`, `draft` to `dispatch`, `reply` to `notify`.

## Bot
`apps/haunted-stream/src/pipeline.ts` is a `StreamPipeline` with the same `run(orderId)` contract as the orders `Pipeline`: it calls `sdk.order`, `sdk.stage` and `s.effect`, so the journal, keys, retry, breaker and offline queue come from the shared SDK unchanged. `defineBot` takes an optional `pipeline` factory (and stage list for the progress heartbeat); the orders bots pass none and behave as before. One file per tier in `apps/haunted-stream/src/bots`, built by `tools/build-bots.mjs` to `dist/stream-bots/<tier>.js`.

Work unit: a video job (`ord-NNNN.json`, `{id, title, durationS, owner}`), written per lane by `writeStreamJobs` (the same lane-folder protocol as orders and the inbox).

## Harness wiring
- `AppId` gains `stream` in `shared/catalog` and `live/catalog`; `APPS`, `APP_VOCAB` (unit "video", repeat kind `store`), `APP_STAGES`.
- Fault catalog: Stream stage ids join `ALL`, `EFFECT_STAGES` and `CALL_STAGES`, so provider faults land on them. Orders-only world creatures are hidden for Stream (`apps` field).
- `live/runtime.ts` `makeBotCommand`: for app `stream` it spawns `dist/stream-bots/<tier>.js` after writing jobs.
- `live/server.ts`: one `isAppId` check replaces the three `orders|inbox` checks.
- Tournament plan: `STREAM_PLAN_STAGES` and a pool of generic faults.

## Left out
Pack-specific creature names are not new catalog creatures; the pack's names map onto catalog art (`packs/streaming/pack.yaml`). No new provider endpoints. The mock server and the in-page demo stay Orders and Inbox only.

## Contract note
The only contract file touched is `contract/events.schema.json`: `stream` is added to the two `app` enums (`hello.app` and `wave_start.detail.app`), an additive change. Stage ids and order ids already fit the schema (`fetch`, `classify`, `draft`, `reply`, `archive`; `ord-NNNN`). Lane B should approve it per `docs/SWIMLANES.md`.
