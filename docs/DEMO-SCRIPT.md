# Demo script: a 3-minute live walkthrough

Story: **the same bug in three outfits.** A process crashes, restarts and repeats a side effect: a duplicate charge, a duplicate ticket, a double stream. The third outfit (streaming) is a model-based pack only.

Rules: say exactly what the screen shows. Do not say "Kiro applied the fix" unless it happens live; the recorded fix is `docs/proof/live-fix.md`. Do not claim a runnable streaming app, or the Power and Crew app installed in a Kiro window. Numbers come from the screen, not from this file. Known true: after the same crash, Rookie ends with 2 charges and Phoenix with 1 (`packages/haunt/test/hero-crash.test.ts`).

Start: `npm run demo -- --no-open` (live server on 7070; with `HAUNT_PORT` and `HAUNT_PROVIDER_PORT` for other ports), then open `http://127.0.0.1:7070/` for the splash or `http://127.0.0.1:7070/?splash=0` to land on the arena. Labels below are the real UI labels in `packages/arena-ui/app/main.ts` and `packages/arena-ui/src/arena/`.

| Time | On screen and what to click | Say |
|---|---|---|
| 0:00-0:10 | The title splash. | "Charged. Charged again. Kiroween Chaos is chaos engineering for bots, played as a tournament." |
| 0:10-0:50 | Click **Skip**, then **Start tournament**. Five lanes race. Open the ledger at the payment crash: one lane shows 2 charges, Phoenix 1. Round ends: the standings card shows the dropped lane and a tombstone stays where it died | "Five bots take the same crashes. The ledger is the provider's own record. Rookie charged twice. Phoenix charged once. The worst lane is eliminated and leaves a corpse." |
| 0:50-1:15 | Press **Next wave** (N). Drag **INTENSITY** to 11 (**THROW EVERYTHING**). Point at the curse chips on a lane | "Turn the dial. At eleven every stage takes a hit. Curses follow a lane: a lying endpoint, a slow one." |
| 1:15-1:35 | Final screen: podium, awards, **Casebook** (edge case, who solved it, how, cost) | "The prize is the Casebook: every edge case, who solved it, and what it cost." |
| 1:35-2:05 | **Patterns** in the header, list sorted by cost. **Write fix spec**. **Improve**: Run, Mine, Apply, Rerun, Compare, Closed. Hold on the compare report | "The miner clusters what keeps happening and writes a fix spec: evidence, the smallest patch, a test for each. The improve loop reruns the same seed. It is a projection with simulated parts, not patched code running." |
| 2:05-2:25 | Open `.kiro/specs/hardening-<run>/` in Kiro. If the fix is live, run the tasks and rerun; otherwise show `docs/proof/live-fix.md` and say "recorded" | "Kiro applies the spec, with the review step. This one is recorded." (or "live" if it is) |
| 2:25-2:45 | Header app switcher: **Haunted Inbox**. Run a wave. Show a ticket and reply row in the ledger and a lane crash with no duplicate for Phoenix | "A second app, in Python: an inbox that files tickets and sends replies. Same harness, no engine change." |
| 2:45-3:00 | Open `/workflow-lab.html`, pick the streaming preset, run it. Then `docs/img/architecture.svg` | "A double stream is the third outfit. Here it is a model-based what-if, not a running app. Kiroween Chaos: break your bots before the world does." |

## Optional extras (each is a separate minute)

- `npm run haunt -- monkey --mode staging --dry-run`: show the plan, then `--mode prod-guarded` to show it refuses without a config.
- `npm run validate:live`: about 2.5 minutes, ends with `0 violations`.

## Rehearsal

Run `npm run demo -- --check` first (about 6 s). If a live scene fails, use `?demo=hero`, which replays real recorded events, and keep the "Recorded run" label visible. Never present a replay as live. The arena runs at the slow pace, so each scene takes longer than its slot.

## Which source produces which part

| Time | Source |
|---|---|
| 0:00 to 0:10 | Splash |
| 0:10 to 1:35 | Live tournament, `?splash=0`, then Start tournament |
| 1:35 to 2:05 | Live Patterns screen (or the sample in `docs/proof/sample-hardening-spec/` if the live run is not stable) |
| 2:05 to 2:25 | Kiro session or `docs/proof/live-fix.md` |
| 2:25 to 2:45 | Live app switch to Haunted Inbox |
| 2:45 to 3:00 | Workflow Lab and `docs/img/architecture.svg` |
