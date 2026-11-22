# Demo video script v3 (target 2:50, hard limit 3:00)

Story: **the same bug in three outfits.** A process crashes, restarts and repeats a side effect: a duplicate charge, a duplicate ticket, a double stream. The owner records and approves the wording.

Rules: no copyrighted music, no payment or shop brand logos, record on the real device at 1920x1080, captions burned in. Every claim says exactly what the evidence shows. The Kiro scene (2:00 to 2:25) is **TO RECORD live**. Until it exists, do not say "Kiro applied the fix". If only the recorded fix exists, caption it "Recorded fix". Do not say "F to A" unless the live proof exists (`docs/proof/live-fix.md`).

Numbers on screen come from the run. Do not read numbers from this file; read what the screen shows. Known true from the repo: after the same crash, Rookie ends with 2 charges and Phoenix with 1 (`packages/haunt/test/hero-crash.test.ts`).

Start the arena with `npm run demo -- --no-open`, open `http://127.0.0.1:7070/?splash=0` for the tournament scenes. Labels below are the real UI labels in `packages/arena-ui/app/main.ts` and `src/arena/`.

| Time | On screen and what to click | Caption (burned in, exact) | Voice |
|---|---|---|---|
| 0:00-0:08 | Black, a receipt. Red text types out: "Charged. Charged again." Then cut to the title splash (`http://127.0.0.1:7070/`) | "Charged. Charged again." | "Charged. Charged again." |
| 0:08-0:50 | Click **Skip** on the splash, then **Start tournament** (the sword button). Five lanes race. Let a creature swarm orbit a lane and the skeleton shoo them. Open the ledger at the payment crash: one lane shows 2 charges, Phoenix 1. Round ends: the standings card shows the dropped lane, a tombstone stays on the stage where it died | "Five bots. The same crashes." then "Rookie: 2 charges. Phoenix: 1." then "The worst one dies and stays on the board." | "Five bots take the same crashes. The ledger is the provider's own record. Rookie charged twice. Phoenix charged once. The worst lane is eliminated and leaves a corpse." |
| 0:50-1:15 | Press **Next wave** (N). Drag the **INTENSITY** slider up to 11. The label turns to **THROW EVERYTHING**. Cut to the curse chips and tags on a lane | "Dial it up. 11 is THROW EVERYTHING." | "Turn the dial. At eleven, every stage on every order takes a hit. Curses follow a lane: a lying endpoint, a slow one." |
| 1:15-1:35 | Round end card, then the final screen: podium, awards, **Casebook** table (edge case, who solved it, how, cost) | "The Casebook: every edge case, who solved it, how." | "The prize is the Casebook. Every edge case any lane met, who solved it, and what it cost." |
| 1:35-2:00 | Click **Patterns** (header). Show the list sorted by cost. Click **Write fix spec**. Click **Improve** and let the strip run: Run, Mine, Apply, Rerun, Compare, Closed. Hold on the compare report | "Patterns become a fix spec." then "Rerun: patterns closed." (use the closed count the screen shows) | "The miner clusters what keeps happening and writes a fix spec: evidence, the smallest patch, a test for each. The improve loop reruns the same plan and shows which patterns are closed." |
| 2:00-2:25 | **TO RECORD live.** Split or cut to Kiro with `.kiro/specs/hardening-<run>/` open. Run the tasks. Show the diff. Then the arena again: rerun, grade on screen. If the take is not live, caption "Recorded fix" | "Kiro applies the spec." (live) or "Recorded fix" | "Kiro applies the spec, with the review step. Rerun the plan and the grade moves." |
| 2:25-2:40 | In the header app switcher click **Haunted Inbox**. Run a wave. Show a ticket and reply row in the ledger and one lane crash with no duplicate for Phoenix | "Second app. Python. Same skeleton." | "A second app, in Python: an inbox that files tickets and sends replies. Same harness, no engine change." |
| 2:40-2:50 | End card on the architecture image (`docs/img/architecture.svg`), then hosted URL, repo URL, "Built with Kiro" | "Duplicate charge. Duplicate ticket. Same bug. Next outfit: a double stream." | "A duplicate charge. A duplicate ticket. The same bug, in different clothes. Haunt: break your bots before the world does." |

Do not show or claim: a streaming demo, the Ticket Desk 11-stage flow, production mode, or the Power and Crew app installed in a Kiro window. None of them exist yet (`README.md` status table).

## Optional cut if time allows

An MCP scene (a Kiro agent calls `haunt_sweep` and reads the matrix). Not recorded; the scripted scene is SH-K4. Only add it if it is recorded and fits under 3:00.

## Rehearsal rule

Record only after `npm run fresh-clone` passes. If a live scene fails on camera, use the demo mode (`?demo=hero`, replays real recorded events) and keep the "Recorded run" label visible. Never present a replay as live.

## Which source produces which part

| Video time | Source |
|---|---|
| 0:00 to 0:08 | Title card, then the splash |
| 0:08 to 1:35 | Live tournament, `?splash=0`, then Start tournament |
| 1:35 to 2:00 | Live Patterns screen (or the sample in `docs/proof/sample-hardening-spec/` if the live run is not stable) |
| 2:00 to 2:25 | Live Kiro session (TO RECORD) |
| 2:25 to 2:40 | Live app switch to Haunted Inbox |
| 2:40 to 2:50 | Static end card |

The arena runs at the slow pace, so each take is longer than its slot. Cut dead time in the edit; never speed up the arena.
