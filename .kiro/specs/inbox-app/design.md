# Haunted Inbox (App 2, Python): design

Purpose: the second application required by Skeleton Crew. It must be **a different language and a different domain**, run by the same Haunt skeleton with no engine changes. Folder: `apps/haunted-inbox/` (separate from `apps/haunted-orders/`).

Owner: Lane A. UI work: none beyond reading the stage list from `/api/state`.

## The story

An AI-style agent triages a support mailbox: it reads an email, classifies it, files a ticket, writes a reply, sends it, and archives it. After a crash a naive agent files the ticket twice and replies twice. Customers get duplicate replies. This is the 2026 version of the double charge.

## Pipeline (11 stages)

The Ticket Desk runs eleven stages. The source of truth is `apps/haunted-inbox/haunt.yaml`; `bot/run.py` `STAGES` and `INBOX_STAGES` in `packages/haunt/src/shared/catalog.ts` carry the same list and a test (`apps/haunted-inbox/test/inbox.test.ts`) keeps them equal. The first draft of this design had six stages (fetch, classify, ticket, draft, reply, archive); PK-C3 replaced them.

| # | id | label | min-max ms | effect (kind, key) |
|---|---|---|---|---|
| 1 | `login` | SSO login | 300-600 | `account`, key `login` |
| 2 | `ingest` | Ingest request | 400-700 | none |
| 3 | `validate` | Validate | 300-600 | none |
| 4 | `dedupe` | Deduplicate | 300-600 | none |
| 5 | `triage` | Triage | 400-800 | none (deterministic keyword stub, no model, no key, no cost) |
| 6 | `assign` | Assign ticket | 500-900 | `ticket`, key `ticket` |
| 7 | `sla` | SLA clock | 200-400 | none |
| 8 | `notify` | Notify requester | 400-800 | `reply`, key `reply` |
| 9 | `escalate` | Escalate | 300-600 | `notify`, key `escalate` (bugs only) |
| 10 | `resolve` | Resolve | 300-600 | none |
| 11 | `close` | Close and survey | 300-500 | none |

## Components

- `apps/haunted-inbox/bot/` Python 3.12, standard library only. `haunt_py.py` is a mini-SDK (about 400 lines) with the same behavior as the TypeScript SDK: `step()`, `effect()`, JSONL journal, resume, reconcile, retry, backoff and breaker, and the same parts reporting. Same journal record format, same part ids.
- The inbox uses the **shared provider (7071)**: `POST /tickets` and `POST /replies` (ledger kind `email`, key `<id>:reply`), `GET /lookup`, `POST /_fault` with services `ticket` and `reply`. No separate helpdesk server. See `.kiro/specs/engine/runtime.md` section 25.
- `apps/haunted-inbox/haunt.yaml`: the process definition (stages, effects, start command, truth endpoint, targets).

## How Kiroween Chaos drives it (no engine change)

| Adapter | Use |
|---|---|
| Process | Start `python bot/run.py` with the standard `HAUNT_*` environment variables (`.kiro/specs/engine/runtime.md` section 1), kill with SIGKILL, restart, and move input files for missing-file and malformed faults. |
| Provider faults | Faults are applied with `POST /_fault` on the shared provider, the same catalog as App 1. The Proxy adapter is demonstrated by the separate non-Node sample (task H3.8). |

Crash points use the same **kill rendezvous** as App 1 (`runtime.md` section 3): `haunt_py` sends `at_point` on stdout and blocks on stdin, and the runner SIGKILLs the process. Same JSON-lines channel, same hooks.

## Tiers

Same five tiers and parts as App 1. The Python bot reads `HAUNT_TIER` and enables the matching parts (the same table as App 1). Lanes run the same file with different parts. For the video and the arena, the Inbox can run with **2 lanes** (Rookie and Phoenix, see the lane to tier mapping). `lanes` is configurable in `POST /api/wave/start {lanes: 1..5}` and in `/api/state`.

## Data

12 emails by default, seeded. Each has `{id, from, subject, body, class_expected}`. Classes: `billing`, `bug`, `account`, `spam`. Spam is archived without a ticket or reply.

## Acceptance

| ID | Check |
|---|---|
| I1 | `haunt validate apps/haunted-inbox/haunt.yaml` passes. |
| I2 | A sweep on the Inbox produces a report with the same fields as App 1. |
| I3 | Crash at `reply` (`after_effect_before_journal`): Rookie sends 2 replies, Phoenix sends 1. |
| I4 | Crash at `ticket` (`after_effect_before_journal`): Rookie files 2 tickets, Phoenix files 1. |
| I5 | The arena shows the Inbox stage names with no UI code change. |
| I6 | The same creatures and score rules apply. |
| I7 | No file under `packages/haunt/` or `packages/core/` was edited to add the Inbox, other than the effect kind list. (Proves the skeleton is reusable.) |

## Cut line

If time is short: ship the Inbox with 2 lanes and 3 faults (crash, http_500, missing_file) and a basic report. It must still exist, because Skeleton Crew requires two applications.
