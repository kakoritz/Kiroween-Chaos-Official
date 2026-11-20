# Contract v1

The only thing both lanes depend on. `contractVersion: 1`.

Server: `http://127.0.0.1:7070`. The UI folder is served at `/`. No auth, localhost only.

## IDs

- `lane`: `1` to `5`
- `stage`: `intake | account | payment | confirmation | dispatch | updates | tracking | handoff`
- `monkey`: see catalog below
- `order`: string like `ord-1042`
- `wave`: integer from 1

## REST

| Call | Purpose |
|---|---|
| `GET /api/state` | Full snapshot: waves, lanes, orders, scores, boss schedule, chaos mode |
| `POST /api/wave/start` `{orders, seed?, tiers?: "race"\|"allPhoenix"}` | Start a wave |
| `POST /api/wave/stop` | Stop the wave |
| `POST /api/chaos` `{lane, monkey?, scope?: "inner"\|"outer"}` | Throw chaos. No monkey means random |
| `POST /api/chaos/mode` `{mode: "off"\|"manual"\|"random", frequency: 0..1, seed?}` | Chaos mode |
| `GET /api/lane/:lane/stage/:stage?order=` | Inspector data for one stage run |
| `GET /api/lane/:lane/log?order=&since=` | Log lines for a lane |
| `GET /api/ledger` | Provider ledger counts per lane and order |
| `GET /api/waves/:n/report` | Wave report JSON |
| `GET /api/waves/:n/postmortem` | Reviewer output (markdown) |
| `GET /api/monkeys` | Monkey catalog with family, label, description |
| `GET /api/health` | `{ok, contractVersion, mode: "mock"\|"live"}` |

Errors: `{error: {code, message}}` with a normal HTTP status.

## SSE

`GET /api/events` streams events. Supports `?since=<seq>` to resume. Each message is one JSON event.

### Event envelope

```json
{ "seq": 812, "ts": 1760000000123, "wave": 1, "lane": 3, "order": "ord-1042",
  "stage": "payment", "type": "stage_start", "detail": {} }
```

### Event types and `detail`

| type | detail |
|---|---|
| `wave_start` / `wave_end` | `{orders, seed, mode}` |
| `stage_start` | `{attempt}` |
| `stage_progress` | `{pct: 0..100, label}` |
| `stage_done` | `{ms, skipped: bool}` (skipped true when replayed from the journal) |
| `stage_fail` | `{error, retryable}` |
| `chaos` | `{monkey, scope, depth, injectedAt: "before"\|"during"\|"after_effect"\|"recovery", source: "user"\|"random"\|"boss"}` |
| `recover_start` / `recover_done` | `{action, ms, depth}` |
| `effect` | `{kind: "charge"\|"email"\|"dispatch", key, amount?}` |
| `repeat` | `{kind, key, count}` (a duplicate side effect, from the ledger) |
| `boss_warning` | `{boss, startsInMs}` |
| `boss_start` / `boss_end` | `{boss, durationMs}` |
| `score` | `{delta, total, reason}` |
| `order_done` | `{clean: bool, ms}` |
| `process_dead` / `process_up` | `{reason}` |

Rule: every animation the UI plays must be driven by an event. The UI never guesses.

## Monkey catalog (ids)

`timeout`, `comm_timeout`, `internet_outage`, `slow_link`, `http_404`, `http_429`, `http_500`, `endpoint_down`, `missing_file`, `duplicate_request`, `malformed_payload`, `crash`, `out_of_memory`, `disk_full`, `power_outage`, `hazard_event`, `driver_unreachable`.

Bosses: `boss_power_outage`, `boss_internet_outage`, `boss_hazard_storm`.

## Fixtures

`contract/fixtures/`:
- `calm.jsonl`: one clean wave, five lanes.
- `hero-crash.jsonl`: Rookie double-charges, Phoenix recovers once.
- `stacked-chaos.jsonl`: three nested monkeys on lane 5, survived.
- `boss-power.jsonl`: boss warning, all lanes hit.
- `meltdown.jsonl`: deep nest, one lane dies.

Fixtures are real event streams the mock server replays. Lane A generates them. They must validate against `contract/events.schema.json`.

## Versioning

- `contractVersion` is in `/api/health` and the first SSE message.
- Add fields freely. The UI ignores unknown fields.
- Rename, remove or change meaning: bump the version, both lanes sign off.
