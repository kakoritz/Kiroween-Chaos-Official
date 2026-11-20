> **First draft, partly superseded.** The rules in `.kiro/specs/engine/` and the files in `contract/` win. Rooms became the creature and fault catalog, SQLite became JSONL, and the task list is replaced by `.kiro/specs/harness/tasks.md`. See `docs/SPEC-MAP.md`.

# Design: Haunted House

## Stack

TypeScript on Node 20. SQLite (`better-sqlite3`) for the journal and the provider ledger. One small HTTP server with Server-Sent Events. A static HTML/CSS/canvas front end, no framework. Vitest for tests.

## Architecture

```
haunt CLI ──> Runner ──spawns──> Bot process (child_process)
                │                    │  uses SDK: step(), effect()
                │                    ├─> Journal (SQLite, bot-owned)
                │                    └─> Fake Provider (HTTP, localhost)
                │                              └─> Ledger (SQLite, provider-owned)
                ├─> Chaos controller (fault plan, kills child with SIGKILL)
                └─> Event bus ──SSE──> UI + Report builder
```

Key point: the **journal** is the bot's memory. The **ledger** is the provider's truth. The report compares them. That is why "charged once" can be trusted.

## Components

| Part | Job |
|---|---|
| `sdk/` | `step(name, fn)` records start and result. `effect(name, key, fn)` writes intent, calls out with key, records result. |
| `provider/` | Fake payments + email API. Honors `Idempotency-Key`. Has `GET /charges?order=`. Keeps its own ledger. |
| `chaos/` | Fault plan: `{ point, order, nth }`. Crash hooks live in the SDK at named points. Runner SIGKILLs the child. |
| `runner/` | Starts bot, watches for exit, restarts it (the "resurrection"), emits events. |
| `bots/naive/` | Order bot with no journal. Retries the whole order on restart. |
| `bots/survivor/` | Same workflow on the SDK. |
| `rooms/` | Five scenario definitions: orders, files, fault plan, expected verdict. |
| `report/` | Builds HTML and JSON from journal, ledger and events. |
| `ui/` | Floor plan, ghosts, ledger panel, Kill button. |

## The order workflow (both bots)

1. `read_order_file` (CSV of orders)
2. `validate`
3. `charge_card` (side effect)
4. `reserve_stock`
5. `send_receipt` (side effect)
6. `mark_complete`

## Journal schema

```
journal(run_id, seq, step, kind, key, status, payload, ts)
  kind: step | intent | result
  status: started | done | failed
```

Resume rule: replay the journal. Steps with `done` are skipped and their stored result is reused. The first step without `done` runs next. An `intent` with no `result` triggers reconcile.

## The crash that matters

Crash point `after_charge_before_journal`: money moved, bot recorded nothing.

- Naive: restarts, sees no record, charges again. Ledger: 2.
- Survivor: intent with key `order-1042:charge` was written **before** the call. On restart it finds intent without result, asks provider `GET /charges?key=...`, finds the charge, records the result, moves on. Ledger: 1.

## Room design

| Room | Fault | Survivor behavior | Naive result |
|---|---|---|---|
| Cellar | Input file missing for order 3 | Quarantine, continue, resume when file appears | Whole batch dies |
| Mirror Hall | Same order sent twice, 2 s apart | Second returns first result | Charged twice |
| Crypt | Kill after charge | Reconcile, finish | Charged twice |
| Poltergeist | 429 and timeouts, 3 tries | Backoff with same key | Duplicate charge on retry without key |
| Locked Door | Provider down for the whole run | Park, report DIED-but-safe: 0 effects, resumable | Partial state, no record |

Verdict rules: SURVIVED = order complete, 0 repeated effects. SURVIVED_WITH_REPEAT = complete but a repeat occurred. DIED = not complete. A DIED run is still a good run if it is resumable and safe, and the report says so.

## UI

Dark haunted-mansion floor plan drawn on canvas. Left half is Naive, right half is Survivor. Ghosts are small SVG sprites. States: alive, dying (crash flash), dead, rising (resume), replaying (steps greyed). A ledger panel sits under each bot with the live charge count in large type. Sound is generated in code (Web Audio): a creak, a thud on crash, a chime on resume. No audio files.

## Report

One HTML file with inline CSS and JS. Sections: verdict banner, timeline with the crash marked, "resumed from step N" line, journal vs ledger table, and a one-line "why it survived".

## Testing

- Unit: journal replay, key generation, reconcile.
- Property test: for every crash point and every step, Survivor ledger count equals 1.
- Room tests: each room asserts its expected verdict for both bots.
- Determinism test: same seed gives byte-identical report JSON (timestamps excluded).

## Risks

- Real kill on Windows: use `child.kill('SIGKILL')`. Tested on Windows and Linux.
- NAS path with SQLite: keep data in the OS temp dir, not on the NAS.
- Demo timing: scripted "demo mode" replays the hero crash in under 90 seconds.
