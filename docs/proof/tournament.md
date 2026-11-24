# Tournament proof (TV3-C14)

What this shows: the tournament engine, the Casebook, the pattern miner and the improve loop run end to end on one seed, and the same seed gives the same result every time.

## How it was produced

```
npm ci
npm run build:bots
npm run haunt -- improve --deterministic
```

`--deterministic` runs the live server in process on a virtual clock with a scratch folder, so nothing in the repo changes. Two runs back to back print identical text; only the name of the generated hardening folder differs. The run plays a tournament of rounds on five lanes (Rookie, Retrier, Journaler, Reconciler, Phoenix), mines the patterns, applies the cheap ones as a policy overlay, writes a fix spec for the rest, then reruns the same plan and seed and compares.

For the same flow against real bots, start `npm run live`, open the arena, press **Tournament**, and run `npm run haunt -- improve` (default `--url http://127.0.0.1:7070`).

## Result (seed default, deterministic)

# Improve: closed 3 of 35 patterns, and 2 more on every lane that took a policy

| | Before | After |
|---|---|---|
| Grade | D | A |
| Reliability | 64 | 100 |
| Grade, lanes that can take a policy | C | A |
| Reliability, lanes that can take a policy | 67 | 100 |
| Round points | -5716 | 5162 |
| Lost orders | 28 | 0 |
| Repeated effects | 28 | 0 |

Read it as a projection: the rerun simulates parts a lane lacks, it does not run patched code. The recorded real fix is in [`live-fix.md`](live-fix.md) and [`loop-proof.md`](loop-proof.md).

## What the tests cover

| Piece | Test |
|---|---|
| Rounds, Next, elimination, corpses | `packages/haunt/test/tournament.test.ts`, `packages/core/test/tournament-server.test.ts` |
| Optional auto-continue of the review state | `packages/core/test/tournament-autocontinue.test.ts` |
| Curses | `packages/haunt/test/curses.test.ts`, `packages/core/test/curses-server.test.ts` |
| Lessons and policy overlay | `packages/haunt/test/lessons.test.ts`, `packages/core/test/lessons-server.test.ts` |
| Casebook and awards | `packages/haunt/test/casebook.test.ts` |
| Pattern miner and fix specs | `packages/haunt/test/miner.test.ts`, `packages/haunt/test/fixspec.test.ts` |
| Improve loop, same seed same result | `packages/haunt/test/improve.test.ts`, `packages/core/test/improve-deterministic.test.ts` |
| Ticket Desk tournament on Python bots | `packages/core/test/inbox-desk.test.ts` |

## Screens

All in [`ui-tv3/`](ui-tv3/): `round-end-standings-casebook.png`, `round-curses-casebook.png`, `corpses-fallen-lanes.png`, `curses-board.png`, `dial-11-throw-everything.png`, `lessons-learned.png`, `champion-awards-casebook.png`, `patterns-loop-running.png`, `patterns-compare-report.png`.

## Fresh clone

`npm run fresh-clone` builds from a clean checkout, and `npm run demo` builds the arena UI itself when `packages/arena-ui/dist/assets` is missing (`tools/demo.mjs`; checked by `tools/demo-build.test.ts`).
