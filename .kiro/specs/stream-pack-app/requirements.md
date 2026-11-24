# Stream pack app: requirements

Source: the Streaming pack (`packs/streaming/pack.yaml`) was a model-based preview with no runnable app. This spec makes it a real third app: a small Node/TypeScript Stream pipeline with five bots, run by the same harness as Orders and the Ticket Desk. No contract change: it uses the same events and the same fake provider ledger.

## R1. A runnable Stream app
1. `apps/haunted-stream` holds a Node/TypeScript pipeline of five stages: ingest upload, transcode, publish, notify subscribers, archive (stage ids `fetch`, `classify`, `draft`, `reply`, `archive`).
2. `apps/haunted-stream/haunt.yaml` declares the same five stages and loads with `loadHauntConfig`.
3. The stage table in `packages/haunt/src/shared/catalog.ts` (`STREAM_STAGES`) and the YAML agree on ids and durations.

## R2. Same harness, no engine fork
1. The app plugs in as app id `stream`: `POST /api/app {app: "stream"}` works, `/api/state` lists the five stages, `/api/apps` lists it in the app switcher.
2. A wave on the Stream app uses the same lanes, tiers, intensity dial, chaos director and tournament as the other apps.
3. Side effects go to the existing fake provider (store, dispatch, notify); no provider or contract change.

## R3. Tiers and parts
1. Five bots (Rookie, Retrier, Journaler, Reconciler, Phoenix) plus the campaign Crew, built into `dist/stream-bots`.
2. Each bot declares the same parts as its Orders namesake; `--parts` reports them.
3. A Rookie that crashes after an effect repeats it; a Reconciler or Phoenix does not (idempotency keys and lookup).

## R4. Contract
1. A Stream wave passes the contract validator with zero violations.
2. Stream events carry only Stream stage ids; the `hello` event lists the five stages.

## R5. Pack creatures and curses
1. Faults land only on Stream stages. The Streaming pack's creatures (Buffer Wraith, CDN Kraken, DRM Gatekeeper, Render Gremlin, Cloud Banshee, Region Warden, Doppelganger, Poltergeist, Reaper) are the catalog creatures that act on the Stream stages (stall, timeout, status, crash, outage, duplicate, expire).
2. Curses (cursed catalog, cursed manifest) land on the Stream endpoints; curse hits are classified by Stream stage.
3. Creatures that exist only for orders (delivery world faults) are not offered on Stream.

## R6. Docs say what is true
1. README and `docs/PACKS.md` say the Streaming pack now has a real app; the other packs stay model-based.
2. `docs/TRACE.md` stays at 100 percent requirement coverage.

## R7. End to end
1. `npm run e2e` switches to Stream (after resetting the intensity dial), runs a wave, and checks that every order finishes and the validator reports zero violations on that wave.
