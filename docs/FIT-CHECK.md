# Fit check: Skeleton Crew, and is the idea still a good one?

Date: 2026-11-21. Written after the owner's second play-test notes (tournament, packs, production mode). Honest, not a pitch.

## 1. Skeleton Crew requirements against the repo

| Rule (Devpost, Skeleton Crew) | Where we stand | Gap and fix |
|---|---|---|
| A **lean, reusable skeleton** (a template or framework) | The Haunt harness: contract, engine, adapters (SDK, Proxy, Process), CLI, reports, reviewer, MCP | Must read as **lean**: keep the core small and documented in one page (`SH-D1` diagram, README front page). Packs (`packs` spec) show reuse as data |
| **Two distinct applications** built from it, in **two folders** | `apps/haunted-orders` (Node) and `apps/haunted-inbox` (Python) | The inbox is **not yet live in the arena** (`SH-C6`, `PK-C3`). Until it is, only one app is truly shown. This is the **biggest risk to the category** |
| Apps must be **distinct** | Orders (money and delivery) and inbox (AI agent, tickets) differ in language and domain | Ticketing mode makes the second app a real service desk, clearly different from delivery |
| Show how Kiro was used to build the skeleton and the apps | Specs, hooks, steering, MCP, property tests, Power, Crew app | `SH-K2` write-up, real live fix (`SH-C4`), trace (`SH-K1`) |
| Public repo, open source licence, `.kiro/` committed, demo link, video, text | MIT present; repo private today; no URL, no video | Owner actions in `WIN-REVIEW.md` |
| Working demo | `npm run demo` runs live | Fresh clone shows a **blank page** until `npm run ui:build` is run (`TV3-C14`) |

**Verdict:** the project qualifies and is a strong fit, **if** both apps run live in the arena and the video shows the same skeleton protecting both. Everything else is polish.

## 2. Is the new direction a good idea?

**Yes, with a clear order.** What is strong:
- **The fix spec is the point.** A game that ends with a lint-clean, evidence-backed spec that Kiro applies is the best Kiro story we have. Judges can see spec-driven development as the product, not the process.
- **The tournament makes it a game** (stakes, elimination, corpses, a dial that goes to 11). It also makes the **Casebook** natural: the lesson is the winner, not the skeleton.
- **Intensity and unknowns** answer "what about things you did not think of": the fuzz share is the honest answer.
- **Production mode** gives the Netflix chaos monkey link, which is the clearest way to explain the tool to a developer in one sentence.

What could hurt:
1. **Scope.** The eleven-stage change touches everything (bots, fixtures, ledger, grader, UI). It must go first and behind a flag. If it slips, every later task slips.
2. **Too many ideas for a 3-minute video.** The video should show: one lane dies and leaves a corpse, the swarm and the shoo, the Casebook, one real fix spec applied by Kiro, and the inbox running live. Packs and prod mode are **one sentence each**, not scenes.
3. **Claims.** Streaming and ticketing as packs are **model-based** unless real apps exist. Say so. Prod mode is a **guarded design** with a demo against our own app. Do not call it "safe in production" without evidence.
4. **A game that is too hard to read.** Eleven stages plus corpses plus swarms plus curses on one screen is dense. Keep the first-run view calm (low dial, tour) and let the dial add chaos.

## 3. Different modes: yes, as data

Delivery, streaming and ticketing are the right three because each has a **different pitfall to teach**: duplicate charge, double stream, duplicate ticket. They are all the same bug in different clothes, which is the strongest evidence that the skeleton is reusable. Keep **two real apps** and everything else as packs in the Lab.

**Decided by the owner (2026-11-21):** app 1 = order processing, delivery and tracking (Node); app 2 = inbox with ticket managing, the **Ticket Desk** (Python); streaming = Workflow Lab demo. Food delivery is dropped from the story.

## 4. Updated order of work

1. Foundation (unchanged): hosted demo, public repo, README front page, fresh-clone demo that builds the UI.
2. **`tournament-v3` must list:** `TV3-C0` to `C3`, `U1` to `U4` (new order, review state, popup freeze, half-size review card, never-perfect).
3. Credibility: real loop proof, install proof, write-up, **inbox live** (`PK-C3` with `SH-C6`).
4. Competition: dial, outage timer, tournament engine and UI, swarms.
5. Learning and specs: lessons, Casebook, pattern miner, fix spec writer, self-improving loop.
6. Hook and story (onboarding), campaign nights 1, 2, 5.
7. Packs (streaming preset, ticketing mode), production mode guard rails.
8. Video last.

## 5. Re-score estimate
With the must lists done and the real loop proof: Impact 8, Kiro 9, Design 8.5, Innovation 9, Presentation 8.5 = about 43. Without the inbox live and without a video: stays near 36. The **inbox live** and the **video** matter more than any new feature.
