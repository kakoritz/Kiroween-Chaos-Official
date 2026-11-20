# Storyboards: the exact beats fixtures and demo scripts must follow

Times are offsets in seconds at 1x. Wave: seed 7, app `orders`, 5 lanes, race tiers, 4 orders. Lanes: 1 Rookie, 2 Retrier, 3 Journaler, 4 Reconciler, 5 Phoenix.

## calm.jsonl (about 40 s)

All five lanes process orders 1 to 4 cleanly. No chaos. Scores differ only by the speed bonus. Ends with `wave_end`. Purpose: the UI's idle and happy path.

## hero-crash.jsonl (about 60 s)

| t | Beat | Events |
|---|---|---|
| 0 | Wave starts | `hello`, `wave_start`, 5x `lane_ready` |
| 1 | All lanes start order 1 | `order_start` x5 |
| 1-8 | Stages 1 and 2 complete on all lanes | `stage_start`, `stage_progress`, `stage_done`, `effect{account_create}` per lane |
| 9 | All lanes enter Payment | `stage_start{payment}` x5 |
| 10.2 | Lane 1 charge lands (crash point `after_effect_before_journal`) | `effect{charge}` lane 1 |
| 10.3 | Chaos on lane 1 (Reaper) | `chaos{creature:reaper, fault:crash, depth:1, source:demo}`, `process_dead{restartInMs:1000}` |
| 10.4 | Same on lane 5 (its charge landed too) | `effect{charge}`, `chaos`, `process_dead` |
| 11.3 | Both restart | `process_up` on lane 1 and lane 5 |
| 11.4 | Lane 1 has no memory and restarts at stage 1 | `recover_start{action:restart}`, `recover_done`, `stage_start{intake, attempt:2}` |
| 11.4 | Lane 5 replays and reconciles | `recover_start{action:replay}`, `stage_done{skipped:true}` for intake and account, `recover_start{action:reconcile}`, `effect{charge, replayed:true}`, `recover_done` |
| 13 | Lane 1 repeats the account | `effect{account_create}`, `repeat{kind:account_create, count:2}`, `score{delta:-150}` |
| 15 | Lane 1 repeats the charge | `effect{charge}`, `repeat{kind:charge, count:2}`, `score{delta:-150}` |
| 16 | Lane 5 continues at Confirmation | `stage_start{confirmation}` and on |
| 17-45 | Lane 1 finishes order 1 with repeats, lane 5 finishes clean | `order_done{clean:false, repeats:2}` lane 1, `order_done{clean:true}` lane 5, `score` events |
| 46-58 | Lanes 2, 3, 4 were never hit and finish normally | |
| 60 | End | `wave_end` |

UI beats this must support: both skeletons collapse (10.3), both reassemble (11.3), lane 1 ledger flashes red twice (13, 15), lane 5 shows "reconciled" with no flash.

## stacked-chaos.jsonl (about 50 s)

Lane 5 only, Payment stage. Presses at t=10 (Zombie `timeout`), t=11.5 (Ghost `http_404` during recovery, `scope:inner`, depth 2), t=13 (Reaper `crash`, depth 3). Expected: depth badge 1, 2, 3. After the crash: `process_dead`, `process_up`, replay, reconcile. The order completes clean. `score` includes +25 x 3 survival. Other lanes calm.

## boss-power.jsonl (about 40 s)

`boss_warning{boss:boss_power_outage, startsInMs:8000}` at t=10, `boss_start` at t=18, one `chaos{creature:lich, source:boss}` and `process_dead{restartInMs:5000}` per lane, `process_up` at t=23, recovery per tier (table A7 in acceptance), `boss_end` at t=35. Lanes 4 and 5 clean. Lanes 1, 2 REPEAT. Lane 3 REPEAT if the crash point was before the journal write.

## meltdown.jsonl (about 60 s)

Lane 1 takes `malformed_payload` (Witch) at intake: `chaos`, `stage_fail`, `lane_halted`, then `order_abandoned` for each remaining order. Lane 2 takes `http_429` at payment: three `stage_fail`, then `order_failed`. Lane 5 takes the same two faults and ends with `order_quarantined` and a clean `order_done` on the next order. Purpose: failure states in the UI (X, red flash, sad pose, halted lane, rank board change).

## Fixture rules

- Event order obeys the ordering rules in `PROTOCOL.md`.
- Every fixture starts with `hello` and `wave_start` and ends with `wave_end`.
- Timestamps are real offsets so a replay at 1x feels right. The mock replays at `speed` x.
- Demo and fixture `chaos` events carry `source: "demo"`.
