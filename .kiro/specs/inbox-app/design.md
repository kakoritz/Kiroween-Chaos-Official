# Haunted Inbox (App 2, Python): design

Purpose: the second application required by Skeleton Crew. It must be **a different language and a different domain**, run by the same Haunt skeleton with no engine changes. Folder: `apps/haunted-inbox/` (separate from `apps/haunted-orders/`).

Owner: Lane A. UI work: none beyond reading the stage list from `/api/state`.

## The story

An AI-style agent triages a support mailbox: it reads an email, classifies it, files a ticket, writes a reply, sends it, and archives it. After a crash a naive agent files the ticket twice and replies twice. Customers get duplicate replies. This is the 2026 version of the double charge.

## Pipeline (6 stages)

| # | id | label | min-max ms | effect (kind, key) | notes |
|---|---|---|---|---|---|
| 1 | `fetch` | Fetch mail | 400-800 | none | Reads `inbox/<id>.json` |
| 2 | `classify` | Classify | 500-1000 | none | Deterministic stub that imitates an LLM (keyword rules, fixed latency). No real model, no key, no cost. |
| 3 | `ticket` | File ticket | 500-1000 | `ticket`, key `<id>:ticket` | Helpdesk mock |
| 4 | `draft` | Draft reply | 500-1000 | none | Template per class |
| 5 | `reply` | Send reply | 500-1000 | `email`, key `<id>:reply` | Helpdesk mock |
| 6 | `archive` | Archive | 300-600 | none | Marks done in journal |

Effect kinds added: `ticket`. (`email` already exists.)

## Components

- `apps/haunted-inbox/bot/` Python 3.12, standard library only. `haunt_py.py` is a ~150 line mini-SDK with the same behavior as the TypeScript SDK: `step()`, `effect()`, JSONL journal, resume, reconcile, retry, backoff and breaker, and the same parts reporting. Same journal record format, same part ids.
- `apps/haunted-inbox/helpdesk/` mock service (Node, part of the harness) on `127.0.0.1:7072`: `POST /tickets`, `POST /replies`, `GET` lookup by key, `GET /ledger`. Same idempotency semantics as the order provider.
- `apps/haunted-inbox/haunt.yaml`: the process definition (stages, effects, start command, truth endpoint, targets).

## How Haunt drives it (no engine change)

| Adapter | Use |
|---|---|
| Process | Start `python bot/run.py --tier <t> --lane <n>`, kill with SIGKILL, restart, and move input files for missing-file and malformed faults. |
| Proxy | The bot calls the helpdesk through `127.0.0.1:7073+lane`. The Haunt proxy injects latency, 404, 429, 500, drops, outages. Faults are the same catalog. |

Crash points inside the Python bot are driven by an environment variable `HAUNT_CRASH=<point>` read by `haunt_py` at the same hook points (`before_effect`, `after_effect_before_journal`, `after_journal`, `mid_stage`). The runner sets it, the bot kills itself with `os._exit(137)` at the hook. (External SIGKILL is still used for `power_outage` and the user "Crash" button.)

## Tiers

Same five tiers and parts as App 1. The Python bot reads `--parts retry,journal,...` and enables the matching features. Lanes 1 to 5 run the same file with different parts. For the video and the arena, the Inbox can run with **2 lanes** (Rookie and Phoenix). `lanes` is configurable in `POST /api/wave/start {lanes: 2..5}` and in `/api/state`.

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
