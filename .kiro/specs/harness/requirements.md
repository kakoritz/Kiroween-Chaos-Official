# Requirements: Haunt, the reusable chaos harness (Lane A)

The order bots are the demo. **Haunt** is the product: plug in any process, define it, and Haunt stress tests it and produces a report. The arena is one viewer for it.

## Pitch

"Chaos engineering for automation workflows, with a score." Define your process in a manifest. Point Haunt at it. Get a stress test report with a grade, a coverage map and fixes.

## Ways to plug in

| Adapter | For | How |
|---|---|---|
| **SDK** | Node and TypeScript workflows | `step()` and `effect()` wrappers. Deepest checks. |
| **Proxy** | Any language, any HTTP service | Haunt sits between the process and its dependencies and injects faults (timeouts, 404, 429, 500, drops). |
| **Process** | Any CLI or worker | Haunt starts it, kills it (SIGKILL), restarts it, feeds and removes input files. |

Adapters can be combined.

## Process definition (`haunt.yaml`)

Declares: stages in order, which stages cause side effects and of what kind, how to start the process, where inputs live, how to read the result, and the targets (SLOs).

```yaml
name: order-bot
start: node bots/order.js
stages: [intake, account, payment, confirmation, dispatch, updates, tracking, handoff]
effects:
  payment:      { kind: charge, idempotent: required }
  confirmation: { kind: email,  idempotent: preferred }
inputs: ./orders/
truth: http://localhost:9000/ledger     # source of truth for side effects
targets: { recoverMs: 5000, repeats: 0, throughputPerMin: 60 }
```

## Requirements (EARS)

### H1. Definition and plug-in
1. THE SYSTEM SHALL load `haunt.yaml` and validate it with clear errors.
2. THE SYSTEM SHALL support the SDK, Proxy and Process adapters.
3. THE SYSTEM SHALL read side-effect truth from the declared `truth` endpoint, not from the process.

### H2. Chaos plugin system
1. A monkey SHALL be a plugin with: id, family, applies-to (stage or effect kinds), `inject()`, `cleanup()`, and a description.
2. THE SYSTEM SHALL ship the monkey catalog in [contract](../../../contract/CONTRACT.md) as built-in plugins.
3. USERS SHALL be able to add a monkey by dropping a file in `monkeys/`.

### H3. Test modes
1. **Sweep (reliability).** Hit every stage with every applicable monkey, one at a time. Output a stage by monkey coverage matrix.
2. **Stack (depth).** Nest faults 1 to N deep per stage. Find the depth where recovery fails.
3. **Ramp (scalability).** Increase concurrent orders step by step. Find the knee where latency or errors climb, and the breaking point.
4. **Soak (endurance).** Run for a set time with random chaos at a set rate. Watch for leaks, drift and slow recovery.
5. **Boss (correlated failure).** Hit all lanes at once with power, internet or hazard events.
6. **Compare (benchmark).** Run the same plan on two versions or tiers and diff the scores.
7. EVERY mode SHALL be reproducible by seed.

### H4. Measurements
1. Recovery time per fault: p50, p95, max.
2. Repeated side effects (from truth).
3. Lost work (orders not completed, not resumable).
4. Orders stuck, with the stage.
5. Throughput and latency under load.
6. Data integrity: journal vs truth mismatches.
7. Resume efficiency: steps skipped vs steps repeated.

### H5. Stress test report
1. THE REPORT SHALL include: overall grade (A to F), resilience score, scalability grade, summary in plain language.
2. IT SHALL include the coverage matrix (stage by monkey, with pass, repeat, fail, not applicable).
3. IT SHALL include the depth curve, the load curve with knee and break point, and recovery time charts.
4. IT SHALL list the worst findings, each with the stage, the monkey, the evidence (log lines) and a suggested fix.
5. IT SHALL include a target table: each target from `haunt.yaml` with pass or fail.
6. IT SHALL render as one offline HTML file and as JSON. It SHALL also render as Markdown for pull requests.
7. THE CLI SHALL exit non-zero when targets fail, so it works as a CI gate.

### H6. Reviewer and the hardening loop
1. AFTER a run, THE REVIEWER SHALL turn findings into a hardening spec in `.kiro/specs/hardening-<run>/`.
2. IT SHALL NOT change code. A human or a Kiro run applies the spec.
3. THE REPORT SHALL show the score change against the previous run.

### H7. CLI
`haunt init`, `haunt validate`, `haunt sweep`, `haunt stack`, `haunt ramp`, `haunt soak`, `haunt boss`, `haunt compare A B`, `haunt report <run>`, `haunt serve` (starts the server for the arena).

### H8. Server for the arena
THE SERVER SHALL implement [contract/CONTRACT.md](../../../contract/CONTRACT.md) in both `mock` and `live` mode.

### H9. Safety
1. Haunt SHALL only target localhost and declared test endpoints by default.
2. Haunt SHALL refuse non-local targets unless `--i-own-this` is passed.
3. Faults SHALL always be cleaned up on exit, including on Ctrl+C.

## Out of scope

Distributed load generation, Kubernetes fault injection, non-HTTP protocols.

## Acceptance

1. `haunt sweep` on the demo order bot produces a full matrix and a graded report.
2. The same sweep on the Rookie scores F and on Phoenix scores A or B.
3. `haunt ramp` finds a knee and a break point and plots them.
4. A second sample process (a tiny non-Node HTTP service) is stress tested through the Proxy adapter, proving it is reusable.
5. The CLI fails a CI job when a target is missed.
