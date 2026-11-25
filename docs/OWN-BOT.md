# Point it at your own bot (5 minutes)

You write a small process. Kiroween Chaos spawns it on every lane, feeds it jobs, crashes and curses it, and grades what it does. The provider your bot calls is a fake one on 127.0.0.1: nothing real is touched. Your bot's code is never edited for you; fixes are specs a person reviews.

Needs Node 20+ and `npm ci`. Python 3.11+ only for the Python variant.

## 1. Copy the template

```
cp templates/own-bot/bot.mjs my-bot.mjs      # Node
cp templates/own-bot/bot.py  my-bot.py       # or Python
```

Each file is self-contained, no imports from this repo. It runs five stages (`fetch`, `classify`, `draft`, `reply`, `archive`, the Stream app's stages) and calls the fake provider in four of them. It is naive on purpose: no retry, no idempotency key, no journal. Comments marked `HARDEN` show where each fix goes.

## 2. Run it

```
npm run own-bot -- my-bot.mjs
```

It prints `arena: http://127.0.0.1:7070`. Open it, press **Start wave**. `HAUNT_PORT` and `HAUNT_PROVIDER_PORT` change the two ports. A path ending in `.mjs`, `.js` or `.py` runs with Node or Python; anything else is a command line, for example `npm run own-bot -- "deno run -A bot.ts"`. A missing file exits with code 2 before anything starts.

## 3. See it fail under chaos

Press a creature on a lane (the Imp answers 500, the Reaper kills your process), or let the intensity dial fire them at random. The naive bot has no retry, so one 500 fails the order. A killed process restarts and starts the job again from stage 1, which is what a bot with no journal does. Re-sending a request after a timeout shows up as a repeat in the ledger.

## 4. Read the Casebook

Every lane runs your bot, so a **tournament** gives you the same bot several rounds under rising chaos. At the end the Casebook lists every edge case, who solved it and at what cost. **Patterns** ranks recurring problems and **Write fix spec** writes `.kiro/specs/hardening-<run>/` (requirements, design, tasks). A single wave also has a post-mortem at `/api/waves/<n>/postmortem` and a report at `/api/waves/<n>/report` on the same server.

## 5. Harden, run again

Read the spec, apply the fix yourself (or have Kiro apply it), and restart `npm run own-bot`. Typical first fixes, each marked `HARDEN` in the template:

| Problem you saw | Fix |
|---|---|
| One 500 or 429 fails the order | Retry with backoff around the provider call |
| A retry made a second row (repeat) | Send a stable `idempotency-key` per effect, for example `<order>:<stage>` |
| A crash redoes finished stages | Write a journal file under `HAUNT_RUN_DIR` and skip stages already done |
| A slow call stalls the lane | Keep the 1.5 s timeout and treat it as retryable |

## What the arena gives your bot

| Env var | Meaning |
|---|---|
| `HAUNT_ORDERS_DIR` | Folder of job files `ord-0001.json ...`. Move a finished file to `../done`, a failed one to `../failed` |
| `HAUNT_PROVIDER` | Base URL of the fake provider |
| `HAUNT_LANE`, `HAUNT_TIER`, `HAUNT_SEED` | Lane number, tier name, wave seed |
| `HAUNT_SPEED` | Wave speed multiplier (0.5, 1, 2, 4). Divide your sleeps by it |
| `HAUNT_RUN_DIR`, `HAUNT_ATTEMPT` | Scratch folder of the wave, and 1 + how many times this lane's process has started |
| `HAUNT_APP` | `stream` |

| Line | Direction | Meaning |
|---|---|---|
| `{"k":"ready"}` | bot to arena (stdout) | Process is up. Then wait for `{"k":"go"}` on stdin |
| `{"type":"order_start","order":"ord-0001"}` | bot to arena | Starts a job. Also `order_done`, `order_failed` (detail `{stage, error}`) |
| `{"type":"stage_start"\|"stage_progress"\|"stage_done"\|"stage_fail","order","stage","detail"}` | bot to arena | Stage ids in order: `fetch`, `classify`, `draft`, `reply`, `archive`. Send `stage_progress` (`detail: {pct, label}`) at least every 300 ms |
| `{"k":"idle"}` | bot to arena | No jobs left. The arena answers `{"k":"shutdown"}`; exit |

`effect` and `repeat` events are written by the arena from the provider's ledger. Provider routes: `POST /store` (`index` 1 or 2), `/shipments`, `/notifications`, each with `{lane, order}` in the JSON body and an optional `idempotency-key` header. The full contract is [`contract/PROTOCOL.md`](../contract/PROTOCOL.md).

## Limits

- Your bot uses the Stream app's five stage ids. Custom stage names need a catalog and contract change.
- The tournament and Casebook are built around five built-in bot tiers; with your bot on every lane, the lanes differ only by chaos and seed.
- The improve loop's rerun is a simulation of the built-in tiers, not a live rerun of your patched code.
