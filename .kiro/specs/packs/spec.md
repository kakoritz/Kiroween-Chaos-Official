# Scenario packs and production mode (requirements and design)

Source: the owner's idea (2026-11-21): the same skeleton for a **streaming service**, a **ticketing service** (internal or external: Jira, Asana, KACE), and a chaos monkey that can run in **production**, with the key output being **serious specs** for fixes. Depends on `tournament-v3`. Packs are **data**, not new engines.

## 1. Idea (and why it fits)

Haunt is a skeleton: bots in lanes, a ledger as truth, a fault catalog, graded reports, fix specs. A **pack** is a small folder that tells the skeleton what the stages are, what can go wrong, what the creatures are called and what the reviewers say. Pack count shows **reuse**; it does not add engines.

| Pack | Status | What it proves |
|---|---|---|
| `orders` (delivery) | Official app 1 (Node), exists | The skeleton on money and delivery |
| `ticketdesk` (folder `apps/haunted-inbox`) | **Official app 2 (Python).** The inbox is the intake channel; ticket managing is what it does with each message. Exists as the inbox, extended to the full ticket flow | The skeleton on a different language and domain |
| `streaming` | **Demo only**, in the Workflow Lab, labelled model-based | The skeleton is generic |
| `prod monkey` | Mode, not an app | Chaos in a real environment, guarded |

Category rule: **two real apps in two folders** stay `apps/haunted-orders` and `apps/haunted-inbox`. Packs beyond those are shown as **model-based demos** in the Workflow Lab, plainly labelled, so nothing is claimed that is not real.

## 2. Pack format

`packs/<id>/pack.yaml`:

```yaml
id: streaming
title: Haunted Stream
stages: [ {id: login, label: Account or login, kind: effect}, ... ]
ledger: [ {id: sessions}, {id: entitlements}, {id: playbacks}, ... ]
faults:  [ {id: buffering, stage: stream, creature: buffer_wraith, mode: stall}, ... ]
curses:  [ {id: cursed_404, endpoint: catalog}, ... ]
reviews: { label: "Viewer rating", subscores: [startup_time, buffering, render, ads, ease] }
bosses:  [ {id: cdn_kraken, hits: [stream, render]} ]
tiers:   # what each gear means in this domain
  retry: "retry the manifest and segment fetches with backoff"
  ...
```
The engine builds a **generic bot** from `stages` and parts (as the Workflow Lab does, `share` SH-C3). Reviews, creature names and tier text come from the pack so the UI changes labels, not code.

## 3. Streaming pack

**Stages (11):** account or login, profile pick, browse, title select, entitlement check, license or DRM, start stream, buffering and bitrate, render, ads and pause or resume, finish and history.

| Fault | Stage | Creature (new art) | Right behavior |
|---|---|---|---|
| `buffering` | buffering | Buffer Wraith | Lower the bitrate, prefetch, do not restart the stream |
| `cdn_timeout` | start stream | CDN Kraken | Failover to a second CDN, circuit breaker |
| `drm_denied` | license | DRM Gatekeeper | Refresh the token once, then show a clear message |
| `render_fail` | render | Render Gremlin | Restart the player, keep the position |
| `remote_server_down` | any | Cloud Banshee | Offline queue of watch events, resume later |
| `region_lock` | entitlement | Region Warden | Clear message; no retry storm |
| `double_play` | start stream | Doppelganger | Idempotent session, one stream per account |
| `watch_history_dup` | finish | Poltergeist | Idempotency key on the history write |
| `token_expired` | any | Reaper | Refresh token, do not duplicate the purchase |

**Tiers:** Rookie (restarts everything), Retrier (retries blindly: re-buys or re-starts), Journaler (remembers position and session), Reconciler (compares entitlements and history to the truth), Phoenix (all, plus offline queue and failover). **Bosses:** Kraken (CDN plus buffering plus render in one night), Server Lich (the whole backend down for 30 s). **Reviews:** "Viewer rating" with sub-scores startup time, buffering, render, ads, ease. The pitfall to teach: the **duplicate purchase or double stream** after a retry.

## 4. Ticket desk (official app 2: the Python inbox plus ticket managing)

Owner decision 2026-11-21: **order processing is app 1; the inbox with ticket managing is app 2 (one app); streaming is a demo.** The inbox already files tickets and sends replies; the ticket desk makes it a full **service desk**: mail and requests come in, become tickets, get triaged, assigned, tracked against an SLA and closed. The folder stays `apps/haunted-inbox`.

**Stages (11):** login or SSO, create or ingest request, validate and enrich, deduplicate, triage and classify, assign, SLA timer, notify, escalate or update, resolve, close and satisfaction survey.

**Adapters (fake providers, no real accounts):** `jira`, `asana`, `kace` and a generic `webhook`; each maps fields differently and fails differently.

| Fault | Stage | Creature | Right behavior |
|---|---|---|---|
| `webhook_retry_storm` | create | Doppelganger | Dedupe on external id; one ticket |
| `field_mapping_error` | validate | Witch | Park, report the field, do not drop the ticket |
| `rate_limited` | assign | Goblin | Honour Retry-After, queue |
| `assignee_deleted` | assign | Ghost | Reassign to the queue owner |
| `sla_breach` | SLA | Banshee | Escalate once, not every minute |
| `wrong_queue` | triage | Poltergeist | Reclassify with the audit trail |
| `duplicate_storm` | dedupe | Zombie horde | One master ticket, children linked |
| `sso_expired` | login | Reaper | Refresh, never create a second account |
| `notify_down` | notify | Banshee Queen | Retry later; a missed notice is logged, not lost |

**Tiers:** same five parts with ticket-specific meaning (idempotency key = external ticket id; journal = audit trail; reconciler = compare Jira or KACE with our store). **Reviews:** "Requester CSAT" with sub-scores time to first response, resolution time, reassignments, SLA, ease. The pitfall to teach: **duplicate tickets and lost replies**.

## 5. Production mode: chaos for real systems

A guarded mode of the CLI and the SDK/Proxy adapters. It never ships with unsafe defaults.

| Mode | Where | Injection |
|---|---|---|
| `observe` | any | Nothing injected; only measures the steady state |
| `staging` | test envs | Full catalog through the proxy |
| `prod-guarded` | production | Only **allowlisted** faults, **synthetic traffic or an opt-in percentage**, a tiny **blast radius**, a schedule window, and an instant **kill switch** |

**Guard rails (requirements):**
1. **Steady-state hypothesis** (as in the Netflix approach): an SLI (success rate, latency p95) and a threshold; the run **aborts** the moment it is breached.
2. **Allowlist** of faults and endpoints; all else refused. Default `prod-guarded` allows only: added latency, a small error rate, one dependency down. Never data corruption.
3. **Blast radius:** max percent of traffic, max concurrent injections, max duration; synthetic requests are tagged by header so they can be filtered.
4. **Kill switch:** `haunt stop` and an HTTP endpoint end every injection in under one second and restore normal behavior; a dead-man timer ends it if the controller disappears.
5. **Dry run** first: shows exactly what would be injected and where.
6. **Audit log:** every injection with who, what, when, result.
7. **Non-stop:** `haunt watch` runs continuously at any speed (1x to 100x in test, 1x in prod) and writes a rolling report and pattern store.
8. **Honesty:** the docs say what `prod-guarded` does and does not guarantee, and the hosted demo shows it against the **demo app only**, never against third-party systems.

## 6. The key output: serious fix specs

All packs and modes feed the same miner (`tournament-v3` section 8) and the same writer: **evidence, root cause, smallest patch, regression test, acceptance, rollback**. The spec is the product; the game is how people meet it. The demo scene shows one run in prod-guarded mode against the demo app that finds a real duplicate-write pattern and writes the spec that Kiro then applies.

## 7. Acceptance

| # | Check |
|---|---|
| K1 | `packs/streaming/pack.yaml` and `packs/ticketing/pack.yaml` load; the Workflow Lab runs each with the five tiers and shows pack labels and creatures |
| K2 | The ticketing mode of the Python inbox app runs live in the arena with the `jira` and `kace` fake adapters and shows no duplicate tickets for Phoenix |
| K3 | `haunt monkey --mode observe` injects nothing; `--mode prod-guarded` refuses a non-allowlisted fault and stops within one second of `haunt stop` |
| K4 | A steady-state breach aborts the run and the report says why |
| K5 | A generated spec from a pack run passes `haunt spec-lint` and has a test per requirement |
| K6 | Every pack screen says "model-based" unless the app is real |

## 8. Cut line
Nothing here comes before the `tournament-v3` must list. Order: (1) pack format and the streaming pack as a Workflow Lab preset; (2) ticketing mode for the inbox; (3) `observe` and `prod-guarded` with guard rails, kill switch and dry run; (4) `haunt watch`. If time is short, **ship (1) and the guard-rail design** and say so plainly.
