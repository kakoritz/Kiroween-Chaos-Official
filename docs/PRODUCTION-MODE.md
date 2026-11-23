# Production mode: what it does and does not guarantee

`haunt monkey` injects a few kinds of failure through the Haunt fault proxy (the Proxy adapter) while it watches a
steady-state measurement. This page says plainly what that does, and what it does not.

## What it is

A controller process. Your traffic goes through the Haunt proxy; the monkey tells the proxy to add latency, answer some
requests with an error, or answer one dependency path with 503. It measures a service-level indicator (SLI) with
synthetic probe requests and stops everything when the indicator crosses a threshold.

It is a library (`packages/haunt/src/monkey`) with a CLI wrapper:

```
haunt monkey --mode observe|staging|prod-guarded [--config file.yaml] [--dry-run]
             [--upstream URL] [--probe-path /api/items] [--audit file.jsonl] [--who name] [--control-port N]
haunt stop [--port N]
```

With no `--upstream` it runs against a tiny built-in demo target on 127.0.0.1. The hosted demo uses the demo target
only, never a third-party system.

## Modes

| Mode | Injects | Notes |
|---|---|---|
| `observe` | Nothing, ever, even if the plan lists faults | Measures the steady state only |
| `staging` | latency, error, dependency_down, drop, on allowlisted endpoints | Percent capped by `blast.maxPercent` |
| `prod-guarded` | Only latency, a small error rate, one dependency down | See the guard rails below |

`data_corruption` is a known fault name so it can be refused. It is refused in every mode.

## Guard rails (what the code enforces)

1. **Steady-state hypothesis.** An SLI (`success_rate` as a fraction, or `latency_p95_ms`) with a threshold, judged over
   a sliding window. The hypothesis must hold **before** anything is injected (baseline), or the run is refused. If it
   is breached later, every injection is removed and the report and audit log carry the reason.
2. **Allowlist.** Faults and endpoint prefixes not listed are refused and logged. `prod-guarded` additionally refuses
   anything but latency, error and dependency_down, and needs a non-empty endpoint allowlist.
3. **Blast radius.** `maxPercent`, `maxConcurrent` and `maxDurationMs`. `prod-guarded` has ceilings (10 percent, 3
   injections, 15 minutes) that a config file cannot raise; a config above them is refused as a whole.
4. **Synthetic traffic.** In `prod-guarded`, a plan item without `percent` matches only requests that carry the
   synthetic header (default `x-haunt-synthetic`), so real users are not touched. A plan item with `percent` is an
   explicit opt-in to a small share of real traffic, capped by the blast radius. Injected and delayed requests carry
   `x-haunt-injected` so they can be filtered in your logs.
5. **Schedule window.** `prod-guarded` requires a UTC hour window and refuses to start outside it. The window is checked
   at start only; the duration cap ends the run.
6. **Dry run.** `--dry-run` prints exactly what would be injected (the proxy rule, as JSON) and what would be refused
   and why. It injects nothing and opens no ports.
7. **Audit log.** One JSON object per line (`start`, `inject`, `refused`, `breach`, `stop`, `dead_man`, `remove`,
   `end`) with time, who, mode, fault, endpoint, result and reason.
8. **Kill switch.** `haunt stop` and `GET|POST /stop` on the local control port (127.0.0.1 only) remove every rule
   synchronously. The measured round trip of a real stop is well under one second (the tests assert under 1000 ms).
9. **Dead-man timer.** If no probe round completes and no `/heartbeat` arrives within `deadManMs`, the monkey removes
   every injection by itself. Every proxy rule also expires after `maxDurationMs`.

## Non-stop: `haunt watch`

```
haunt watch --mode observe|staging|prod-guarded [--speed 1..100] [--rounds N] [--round-ms N] [--config file.yaml]
            [--upstream URL] [--probe-path /api/items] [--patterns .haunt/patterns.json] [--specs .kiro/specs]
            [--report .haunt/watch-report.json] [--control-port N]
```

`watch` runs monkey rounds back to back until you stop it. Each round is one monkey run (the same guard rails apply); its
probe results become events for the pattern miner.

- **Speed.** `--speed` is 1 to 100 in `observe` and `staging`: a round waits `round-ms / speed`, and probes and the per-round
  duration cap shrink by the same factor. **`prod-guarded` runs at 1x only**; any other speed is refused before anything
  starts (exit code 2). A round is capped at 10 s, so the watch keeps cycling.
- **Pattern store.** Every round is mined into `.haunt/patterns.json` (the same store the tournament and `improve` use), so
  patterns accumulate across rounds and across restarts. Failed probes show as the "endpoint fails often" shape; a steady-state
  breach is recorded as an outage window.
- **Fix specs.** When a pattern qualifies (count 3, any lost order, or over 30 s of downtime) the watch writes
  `.kiro/specs/hardening-<run>-<n>/` with the same writer as the tournament: evidence, root cause, smallest patch,
  regression test, acceptance, rollback. It never applies a spec, and it writes one spec per pattern until that pattern is
  verified and regresses. Run `haunt spec-lint` on a folder to check it.
- **Rolling report.** `.haunt/watch-report.json` is rewritten after every round: rounds, errors, injections, rolling success
  rate over the last 50 rounds, pattern counts, specs written, the last rounds.
- **Stopping.** Ctrl+C (SIGINT or SIGTERM), `haunt stop`, or `POST /stop` on the control port end the watch: the round in
  flight is aborted (its monkey removes every injection first), the report is written with the stop reason and the ports are
  released. The dead-man timer still applies inside each round.

## The arena panel and the control endpoints

The arena header has a **Monkey** button. The panel has a mode selector (observe, staging, prod-guarded), the guard-rail
summary of the mode, a large **KILL SWITCH**, the steady-state meter (the measured SLI against its threshold) and the audit
log tail. It talks to the live server (`npm run live`), which runs the monkey against the **built-in demo target only**;
the mock server and the hosted page have no monkey routes and the panel says so.

| Route | What |
|---|---|
| `GET /api/monkey[?audit=N]` | State: mode, running, status, reason, injections, guard rails, steady-state meter, audit tail, last stop time |
| `GET /api/monkey/preview?mode=M` | Guard rails and the dry-run plan of a mode, without running it |
| `POST /api/monkey/start {mode}` | Start a run on the demo target (400 bad mode, 409 while one is running) |
| `POST /api/monkey/stop` | The kill switch: every injection removed before it answers; idle is not an error |

A panel run uses a 60 s duration cap, a success-rate hypothesis (80 percent in observe and staging, 95 percent in
prod-guarded), a UTC all-day window for prod-guarded (it is a demo) and the prod-guarded ceilings and allowlist. The CLI
control port (`--control-port`) also serves `GET /snapshot`.

## What it does not guarantee

- **It is not a safety certificate.** The guard rails reduce risk; they do not remove it. Adding latency or errors to
  real systems can still cause harm you did not model (retries piling up, a downstream alert, a customer who happened to
  be in the percent you opted into).
- **Only what flows through the Haunt proxy is affected.** If clients bypass it, nothing is injected and nothing is
  protected. If the proxy itself fails, the monkey cannot help: put the proxy where your own failover and health checks
  cover it.
- **The kill switch needs the monkey and the proxy to be alive.** If the machine or process dies hard, rules die with
  the proxy process, but a separately run proxy keeps its rules until they expire (`maxDurationMs`) or are cleared.
  The dead-man timer is a timer inside the same process: it protects against a hung probe loop or a lost controller,
  not against the process being frozen entirely.
- **The hypothesis is only as good as the SLI.** A synthetic probe measures the endpoint it calls. A breach elsewhere
  (another endpoint, a queue, a batch job) is not seen. The check runs every `intervalMs`, so a breach is caught within
  about one interval plus one probe, not instantly.
- **The schedule window is checked once, at start.**
- **It does not corrupt, delete or replay data**, and it does not know whether your service is idempotent. Latency can
  cause client retries; if the service double-writes on retry, that is a finding, but it also happens to real data.
  Use synthetic accounts for write endpoints, or do not allowlist them.
- **The watch speeds up only the demo and staging.** Speed multiplies how fast rounds run, never how hard they hit; prod-guarded stays at 1x.
- **Model-based packs are not production mode.** The streaming and ticketing packs and the Workflow Lab preset are
  labelled model-based; they never touch a real system.
- **No authentication on the control port beyond binding to 127.0.0.1.** Anyone on that machine can stop (or heartbeat)
  the run. Do not forward the port.

## Example `prod-guarded` config

```yaml
mode: prod-guarded
schedule: { startHourUtc: 2, endHourUtc: 4 }
allow:
  faults: [latency, error, dependency_down]
  endpoints: [/api/]
blast: { maxPercent: 5, maxConcurrent: 1, maxDurationMs: 60000 }
deadManMs: 5000
hypothesis: { sli: success_rate, threshold: 0.99, window: 20, minSamples: 5, intervalMs: 250 }
plan:
  - { fault: latency, endpoint: /api/items, ms: 200 }      # synthetic-tagged traffic only
```

Run `haunt monkey --mode prod-guarded --config monkey.yaml --dry-run` first and read the output.
