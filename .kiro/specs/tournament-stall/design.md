# Tournament stall and hosted frames: design

## A. Evidence
Isolated runs of the live server (`POST /api/tournament/start` seed 7, speed 4, Next pressed on each `awaiting_next`) finished in 270 s in 5 of 5 runs (also under 16 busy loops), and 2 of 4 full `npm run e2e` runs passed the tournament step before the stall showed up once on the 5th run (a detached e2e on private ports 17540/17541).

The stuck state, read from the live server after 14 minutes: wave 8 (round 4) `running:true` for 819 s (a round takes about 70 s); `/api/state` lanes 1 to 3 `done` (eliminated), lanes 4 (reconciler, order ord-0006) and 5 (phoenix, order ord-0002) `working` in stage `account`, unchanged between samples; the SSE stream carried nothing but `stage_progress` (95%, the bot's heartbeat) for both lanes; no `process_dead`, no stage events since the last `effect`/`chaos` of each lane. Both bot processes were alive (`ps`: phoenix.js and reconciler.js), sleeping in `ep_poll`, with no socket to the provider (`ss`: none), and the Node inspector (`SIGUSR1`, `process.getActiveResourcesInfo()`) showed no active timer at all, only the three stdio pipes. Last journal record of lane 4: an `intent` for `account`; of lane 5: `stage_start account`. So the bots were not retrying, sleeping or calling out: each awaited a promise nothing would ever resolve.

That promise is in `ChaosHost.hook` (`packages/haunt/src/chaos/hooks.ts`): when a process fault is armed at the hook point the bot sends `at_point` and then `await new Promise(() => {})`, expecting the runner to SIGKILL it. The runner (`serveRendezvous`) kills only when its director fires; otherwise it replies `proceed`, which the bot ignored. The bot's arm list (sent with `go` and `{k:'arm'}`) and the director's can differ (an arm cleared or used on one side, a restart, a round change), and then the bot hangs for the rest of the wave. No `wave_end` follows, `running` stays true, and the e2e (and the tournament Next button) wait forever. This is not the lane event queue (the earlier `allSettled` change) and not the shutdown path.

## A. Fix
1. `ChaosHost.hook` waits for the kill or a `proceed`; the bot's stdin handler calls `host.release()` on `proceed`. (R1.1)
2. Defensive: `runLane` arms a grace timer (`shutdownGraceMs`, default 5 s) when it sends `shutdown` and kills a bot that is still alive; a `ready` timeout kills the child before rethrowing. (R1.2, R1.3)
3. The e2e timeout error carries phase, round, wave, lane states, awaiting_next count and the last non-heartbeat event per lane. (R2)

## B. Evidence
Built hosted bundle, Playwright, `?demo=full`, creature stack of all lanes sampled every 0.5 s over one pass (291 s wall): creature-free stretches of 87 s, 80 s and 77 s. The recorded `full` fixture has 12 chaos events in 165 s with gaps of 51, 41 and 56 s; the in-page mock only replays it.

## B. Fix
`demoFillerTimes(events, maxGapMs)` (pure, `packages/core/src/mock/play.ts`) lists fixture offsets where a filler is due. The in-page `startDemo` schedules them on the Player's timers (scaled by speed) and calls `ChaosSim.inject` on the next active lane, ignoring refusals. `tools/hosted-check.mjs` samples `?demo=full` frames and fails over the limit.
