# Tournament v3 (requirements and design)

Source: the owner's second play-test notes (2026-11-21). Depends on `playtest-v2` (laps, reviews, scoring v2, world events). Where this file differs from `playtest-v2`, **this file wins**. Contract changes are in `contract/V1_2.md`.

Goal: the arena becomes a **competition that teaches**. Five bots start, the worst drops each round, the lanes learn from edge cases as they go, and the real prize is the **Casebook**: every edge case found and how it was solved. The tool then turns the recurring ones into **fix specs**. The point of Kiroween Chaos is to harden code by injecting known and unknown trouble at any point, with a knob to keep turning it up.

## 1. Requirements (EARS)

| ID | Requirement |
|---|---|
| T1 | THE arena SHALL run a **tournament**: round 1 has five lanes; after each round the lowest-ranked live lane is **eliminated**; rounds continue until one lane remains (rounds of 5, 4, 3, 2). |
| T2 | WHEN a lane is eliminated, or fails 100 percent of its orders at one stage, THE arena SHALL leave its **corpse** (tombstone, epitaph, stage and cause) on that stage for the **rest of the tournament**. |
| T3 | EACH lane SHALL keep a **Lessons ledger**. WHEN a lane overcomes an edge case, THE ledger SHALL record the signature and the mechanism that worked, and the lane SHALL apply it in later rounds. |
| T4 | THE final report SHALL include the **Casebook**: every edge case seen by any lane, who solved it, how, and what it cost. The **Battle-Tested** award goes to the lane that solved the most distinct cases, even if it was eliminated. The **Champion** is the last lane standing. |
| T5 | THE arena SHALL provide an **intensity dial** 1 to 10 and an **override at 11**, changeable live, with an optional auto-ramp. |
| T6 | THE engine SHALL support **curses**: persistent failure traits (random 404s, slow endpoint, flaky 500, clock skew) that follow a lane for the whole wave or tournament. THE report SHALL show how each curse was **handled, reported, swallowed or crashed**. |
| T7 | THE engine SHALL **never produce a run with zero issues**. Every lane SHALL get at least one issue per round. |
| T8 | A wave or round SHALL **end in a review state** and SHALL NOT start the next one until the player presses **Next**. The logs stay browsable. |
| T9 | THE order pipeline SHALL use the new **11-step order** (section 2) and the UI SHALL draw stages from the server's list, not a fixed list. |
| T10 | WHEN an outage is injected without a fixed duration, THE engine SHALL draw its length at random from **1 to 30 seconds** (1x time). |
| T11 | THE lane popup log SHALL **freeze** when the player picks a different order and SHALL filter to that order only (section 6). |
| T12 | THE reviews card at the end of an order SHALL be **half the old size** and sit over the "ORDER n/m" card so the door stays visible. |
| T13 | THE creatures that follow a bot SHALL **swarm and be shooed**, and SHALL **dissipate** when the problem is overcome (section 7). |
| T14 | THE pattern miner SHALL find **recurring problems** across runs and write a real **fix spec** (not a code rewrite) that removes downtime and hangs. Accepted patterns SHALL carry into later runs as policy. |

## 2. The 11-step order (T9)

The old order (intake first, then account) was backwards. New stage list for the `orders` app:

| # | id | Label | Kind | What it does |
|---|---|---|---|---|
| 1 | `account` | Account or login | effect | Create or log in the customer |
| 2 | `create` | Create order | effect | Build the cart and the order record |
| 3 | `submit` | Submit order | effect | Customer submits; order number is final |
| 4 | `payment` | Payment | effect | The charge (the key money step) |
| 5 | `confirmation` | Confirmation | effect | Receipt and email |
| 6 | `receive` | Store receives | effect | The store gets the order |
| 7 | `process` | Process order | effect | Prepare the items |
| 8 | `updates` | Order updates | effect | Notices to the customer |
| 9 | `ship` | Ship and pack | effect | Pack and dispatch to the carrier |
| 10 | `transit` | Delivery updates | poll | The road: weather, hazard, delay, out of gas, wrong address, package not on the truck |
| 11 | `handoff` | Handoff | provider call | Door ceremony, then **Success** |

- Legacy mapping (for fixtures and old runs): `intake` becomes `create`+`submit`; `dispatch` becomes `ship`; `tracking` becomes `transit`. The contract carries `stages` (V1_2 section 1), so new apps and packs use their own lists.
- **Ledger columns** follow the money and the world: ACCOUNTS, ORDERS, CHARGES, RECEIPTS, STORE, SHIPMENTS, NOTICES.
- **Faults at `transit`** (new world faults, V1_2 section 4): `weather`, `road_hazard`, `delay`, `out_of_gas`, `wrong_address` (exists), `not_on_truck`. They are stall or reroute events with recovery time and downtime like other world events.
- Kill hooks keep their names and now exist per effect stage. Bots, fixtures, ledgers, the order grammar, the grader and all stage tables in `engine/*` and `playtest-v2/*` change together (task TV3-C1). This is the biggest change in this spec; do it first, behind a flag until all five bots pass.

## 3. Tournament (T1, T2, T4)

### 3.1 Rounds
- A **tournament** is a list of rounds. Defaults: R1 = 5 lanes, 6 orders, intensity 3; R2 = 4 lanes, 8 orders, intensity 5; R3 = 3 lanes, 10 orders, intensity 7; R4 final = 2 lanes, 12 orders, intensity 9. The player can change the dial (T5) at any time.
- Lanes are the five tiers (Rookie, Retrier, Journaler, Reconciler, Phoenix) or, in the campaign, the player's Crew plus rivals (the Crew is never auto-eliminated in the campaign; it **fails the night** instead).
- **Same storm for all:** each round uses one seeded chaos plan for every live lane so ranking is fair.
- Each round ends with the **review state** (T8): standings, who drops, new Lessons, new Casebook entries, Next button.

### 3.2 Ranking and elimination
Round score `RP` per lane (Resilience Points):

`RP = ok_orders x 100 - lost x 300 - repeats x 150 - abandoned x 150 - downtime_penalty + review_points + lessons_bonus`

(`downtime_penalty`, `review_points` and refunds as in `playtest-v2/design.md` section 5. `lessons_bonus = +25` per edge case overcome for the first time, so learning is rewarded, capped at +200 per round.)
- The lane with the lowest cumulative `RP` is eliminated. Tie-break order: more lost orders, more repeats, lower average stars, higher downtime, lower lane number. The rule is shown on the standings card.
- A lane that is **halted** (guard: all orders cancelled or a crash loop) is eliminated at once at round end, even if not lowest.
- Eliminated lanes **stay on the board as corpses** until the tournament ends (T2).

### 3.3 Corpse (T2)
- Marker on the **stage chip** where the lane died: a small tombstone with the lane's skeleton lying beside it, a faint ghost wisp, an epitaph tooltip: "Rookie, died at Payment, round 2: 3 repeated charges, 2 cancelled orders. Cause: crash after charge before journal." Lane row greys out with a "FALLEN R2" tag.
- A lane that fails **100 percent of its orders at one stage** in a round (a wall) gets a **wall corpse** on that stage even if it survives. It stays for the rest of the round and is listed in the report.
- Corpses are drawn from the event stream (`lane_eliminated`, `corpse`, V1_2 section 3). They persist in `state` so a late-joining page sees them.
- Creatures keep circling the corpse lazily (section 7) so the failure stays visible in the screenshot and the video.

### 3.4 Casebook and awards (T4)
- An **edge case** is a normalised signature `stage + fault + consequence` (for example `payment + timeout + duplicate_charge`). Every lane that meets it adds an entry: first seen (round, order), outcome (solved, partly, lost), mechanism (retry with backoff, idempotency key, breaker, queue, reconcile, compensate), cost (downtime, points, stars).
- The **Casebook** (round end and final): table of cases, count of lanes that met them, who solved them and how, and the **recommended fix** (the minimal part or policy). Cases solved by nobody are marked **open** and go straight to the fix spec (section 8).
- **Awards:** Champion (last standing), **Battle-Tested** (most distinct cases solved), **Iron Skeleton** (fewest repeats), **Fastest Recovery** (best p50), **Wooden Spoon** (first eliminated, shown kindly). The report shows the Casebook **even when the champion had no issues**; with T7 this is rare.
- The final screen order: podium, awards, **Casebook**, fix specs, share card.

## 4. Lessons ledger (T3)

- Per lane: `lessons.json` entries `{signature, mechanism, learnedRound, applied}`. A **lesson** is learned when the lane overcame a signature (recovered, no repeat) and the recovery used a mechanism, or when the lane failed and the reviewer rule for that signature proposes one (**suggested**, adopted at the next round start, costs nothing, shown as "learned from the loss").
- A lesson is a **policy overlay**, not code: a small table the bot reads (`haunt.policy`): for example `{stage:"payment", fault:"timeout", action:"retry", backoff:"exp", maxAttempts:3, key:"order-id"}` or `{stage:"transit", fault:"wrong_address", action:"hold_and_reroute"}`. Each bot tier supports a **subset** of actions (its parts), so a Rookie can only learn what its code allows. Learning beyond the tier is shown as a **spec suggestion** instead (section 8). This keeps the tiers honest and the story clear: **policy learns, spec improves code**.
- The overlay carries into the next round and, for the campaign, the next night (persisted with the profile). A "Reset lessons" button clears it.
- The UI shows lessons as small **scroll icons** on the lane card with a count; the popup lists them. A new lesson plays a short "learned" sparkle over the lane (section 7).

## 5. Intensity, curses, never-perfect, outage timer (T5, T6, T7, T10)

### 5.1 Intensity dial
A knob in the header (1 to 10, then 11). It is a UI control and a contract message (`POST /api/intensity`, `intensity` event). It scales the chaos plan **live**.

| Level | Fault rate (per order) | Simultaneous faults | Unknown (fuzz) share | Nested depth | Curses per lane | Random outage |
|---|---|---|---|---|---|---|
| 1 | 0.3 | 1 | 0 percent | 1 | 0 | 1 to 5 s |
| 2 | 0.5 | 1 | 0 | 1 | 0 | 1 to 8 s |
| 3 | 0.7 | 1 | 5 | 1 | 0 | 1 to 10 s |
| 4 | 0.9 | 1 | 10 | 2 | 1 | 1 to 12 s |
| 5 | 1.1 | 2 | 15 | 2 | 1 | 1 to 15 s |
| 6 | 1.4 | 2 | 20 | 3 | 1 | 1 to 18 s |
| 7 | 1.7 | 2 | 25 | 3 | 2 | 1 to 22 s |
| 8 | 2.0 | 3 | 30 | 4 | 2 | 1 to 25 s |
| 9 | 2.5 | 3 | 35 | 4 | 2 | 1 to 28 s |
| 10 | 3.0 | 4 | 40 | 5 | 3 | 1 to 30 s |
| **11** | **every stage, every order** | **all** | **50** | **5** | **all** | **continuous overlapping** |

- **Unknown faults** are drawn from a fuzz pool the player and the bots have not seen: random combinations of known fault kinds, odd timings, new HTTP codes, truncated bodies, clock jumps. They are labelled **UNKNOWN** in the log and in the Casebook so they can be recognised as new signatures.
- **Auto-ramp** toggle: raise the dial by one every N orders until a lane is eliminated or a target is reached ("keep cranking it up"). The existing `ramp` and `stack` modes are implemented on top of this dial.
- Level 11 shows the dial with a red "THROW EVERYTHING" label and the sound rises. It is a stress test, so grades at 11 are shown as "survived" and not compared to normal runs.

### 5.2 Curses (T6)
A **curse** is a persistent, per-lane, per-endpoint trait.

| Curse | Effect | The right response |
|---|---|---|
| Cursed 404 | A random 15 to 40 percent of calls to one endpoint return 404 | Do not treat as final; check, retry, or park and report |
| Slow Hand | Every call to one endpoint takes 2 to 8 s | Timeout and fallback; do not stack calls |
| Flaky 500 | A random share returns 500 | Retry with backoff |
| Skewed Clock | Timestamps jump | Do not rely on local time for idempotency |
| Rate Limited | 429 bursts | Honour `Retry-After` |

- A curse is chosen by the plan (by intensity) or by the player ("Curse a lane"). It shows as a **purple chip** on the stage and a curse tag on the lane card for as long as it lasts.
- **Handling grade** (`curse_response` event, V1_2 section 5): each time a cursed call fails the bot's reaction is classified: **handled** (recovered with retry or fallback), **reported** (surfaced with context in the log and the order is parked or marked), **swallowed** (the error vanished and the step was skipped: worst), **crashed**. The report has a table "what each lane returned when the API lied". Swallowed counts as an issue with a large star penalty.
- Curses persist across rounds until the plan removes them. Corpses keep their curse tag.

### 5.3 Never a perfect run (T7)
- **Floor rule:** the scheduler guarantees at least **one issue per lane per round**. If the plan yields none for a lane by the middle of the round, the scheduler injects a mild fault (a "gremlin": slow call, one 500, a duplicate delivery) at a random stage. Gremlins are labelled and cost little. The engine asserts `issues >= 1` per lane per round (property P19). A run with zero issues is a failing test.
- **Review rule:** the reviews formula (`playtest-v2/design.md` section 6) cannot give 5.0 stars when the lane had a gremlin and a slow recovery; the maximum remains 5.0 for a fast clean recovery.
- This keeps every demo alive and removes the "boring green" case from the video.

### 5.4 Outage timer (T10)
- `endpoint_down` and the world "service down" events draw `outageMs` uniformly from the range of the current dial level (table above), seeded for replay, unless a fixed `recoverMs` is set in the plan.
- The UI shows a **countdown ring** with seconds left on the chip. The recovery time in the lap equals the drawn length plus recovery work.

## 6. Wave end and the popup log (T8, T11)

### 6.1 Review state (T8)
- After every wave or round the server enters `awaiting_next` and **stops starting orders**. The summary card shows standings, awards, new lessons, Casebook entries, a **Next round** button (and keys Space and N), and a **Replay round** link. Nothing auto-advances; an optional "auto-continue after N s" setting is off by default.
- All logs, the lane popup and reports stay fully usable in this state. The header shows "Review" with a calm tint.
- Contract: `round_end` then `awaiting_next`; `POST /api/next` resumes (V1_2 section 2).

### 6.2 Lane popup log (T11)
- **Order filter** (default "Live: current order"): options are Live, each order (`ord-0001`...), and **All orders**.
- **Type filter**: All, Issues, Stages, Reviews, Lessons, Curses. "All" here means all entries **of the selected order**.
- **Live** follows the current order and auto-scrolls. Picking any other order **pins** the view: no updates, no scroll movement, no re-render of the list. A small "Live updates paused" chip shows how many new entries arrived and a **Back to live** button. Selecting All orders is also a pinned view unless the player turns on "Follow".
- Scroll position and text selection are preserved on every update. The popup never refreshes its log while a text selection or scroll is active.
- Same rule applies to the main log panel: it has the Order filter too.

## 7. Creatures swarm and dissipate (T13) and the review card (T12)

### 7.1 Swarm choreography
Creatures that follow a lane (Reaper, Zombie, Goblin, Imp, and the world creatures) become **mini-swarms**:
- **Arrive:** 3 to 9 small versions (bees, gnats, bats, sparks) fly in and orbit the bot. Swarm size = fault severity plus attempts so far.
- **Harass:** they dart in with tiny peck sparks; the skeleton **flails its arms and shoos** (arm wave loop, head shake); the chip flickers yellow. More attempts means more of them.
- **Overcome:** WHEN the stage completes after the fault (recovered, retried, breaker closed, queue drained) the swarm **dissipates**: they pop in small puffs and fade, with a short "poof" sparkle and the skeleton's relieved shrug. When an order recovered from a boss, a bigger flourish plays.
- **Defeated:** WHEN the order is cancelled the swarm turns dark, cackles once, and the surviving members **keep circling the corpse** (dimmed) until the round ends.
- **Never stuck:** every swarm has an end event. The reducer removes any swarm whose fault has no open recovery within the safety timer (45 s at 1x) and logs a UI warning in dev.
- Events used: `chaos` (start), `stage_done` after (overcome), `order_failed` (defeated). The UI derives swarm state from the reducer; no new events are needed beyond `corpse`.

### 7.2 Review card
- Size: **half** of the current star card (about 180 by 90 px at 1600 wide), placed **over the "ORDER n/m" stat card** of the lane, not over the door. The door open/close animation stays fully visible. The card shows stars, the quote (one line) and fades after 3 s at 1x, but stays in the log and the tracker.

## 8. Pattern miner and fix specs (T14)

### 8.1 Pattern store
- `.haunt/patterns.json` accumulates across runs: each pattern has `signature` (stage, fault, consequence), `count`, `lanes`, `downtimeMsTotal`, `lostOrders`, `repeats`, `firstSeen`, `lastSeen`, `status` (new, suggested, accepted, applied, verified, rejected).
- The miner reads journals, ledgers, laps and the Casebook after each round and at wave end; it clusters by signature and also by **time shape** (hangs: same stage stuck longer than p95, retry storms, endpoint-specific failure rates, curse handling).

### 8.2 Fix specs ("serious specs")
For each pattern above a threshold (count of 3, or any lost order, or total downtime over 30 s), the miner writes a **Kiro spec** folder `.kiro/specs/hardening-<runId>/` with:
- `requirements.md`: EARS requirements, one per pattern: "WHEN the payment call times out, THE bot SHALL ... " with evidence (run ids, journal line numbers, report links), impact (downtime, points, stars) and the **root-cause hypothesis**.
- `design.md`: the **smallest patch** per pattern (policy change, wrapper, part to add, file and function), why, risk, rollback, and the **diff budget** ("under 40 lines"; the miner refuses to propose a rewrite).
- `tasks.md`: ordered tasks, each with a **regression test** to add (fast-check property or fixture replay) and an **acceptance** line ("rerun plan X, expect no repeated charge and downtime under 5 s").
- Sorted by **downtime cost**. A summary `README.md` lists the patterns, the expected grade change and what is already covered by lessons.
- **Spec lint** (`haunt spec-lint`) checks that every requirement has evidence, a patch and a test, and that no task says "rewrite".

### 8.3 Self-improving loop (no full rewrite)
1. **Run** (rounds, curses, unknowns).
2. **Mine** patterns.
3. **Apply the cheap ones as policy** (lessons): retries, backoff, key use, timeouts, reroute. Accepted automatically for tiers that support them (T3).
4. **Write the spec** for the ones that need code (Kiro applies them, with the review step).
5. **Rerun** the same plan and the **compare** report: patterns closed, new ones found, grade change.
- A pattern is **verified** only after a rerun shows it gone. The report shows "closed 7 of 9 patterns".
- Optional LLM mode (`share` SH-C5) can rank patterns and write nicer prose; the rule-based miner is the fallback and is what tests cover.

## 9. UI summary (details are in sections 3 to 7; the old UI rules in `playtest-v2/ui.md` still apply)
Header: intensity dial, round indicator ("Round 2 of 4, 4 lanes"), Next button state. Lane card: lessons count, curse tags, FALLEN tag. Stage chips: curse purple, corpse, countdown ring. Popup: filters and freeze. Summary: standings, awards, Casebook. Final: podium and Casebook.

## 10. Acceptance

| # | Check |
|---|---|
| V1 | Tournament R1 to R4 runs end to end with five tiers; one lane is eliminated per round; the last one is Champion |
| V2 | An eliminated lane shows a corpse at its death stage until the tournament ends, also after reload |
| V3 | A lane that fails all orders at one stage gets a wall corpse even when it is not eliminated |
| V4 | Lessons learned in R1 are applied in R2 (same signature recovers faster or without repeat) for tiers that support the action |
| V5 | The final report has the Casebook, awards and fix specs; Battle-Tested can differ from the Champion |
| V6 | Dial 1 to 10 and 11 change the fault rate live; 11 hits every stage |
| V7 | A curse shows on the lane and the report lists handled, reported, swallowed and crashed counts |
| V8 | No lane ever finishes a round with zero issues (property P19) |
| V9 | After a wave or round nothing starts until Next; logs are browsable meanwhile |
| V10 | The stage list on screen comes from the server; the order is account, create, submit, payment, confirmation, receive, process, updates, ship, transit, handoff |
| V11 | Random outage lengths fall in 1 to 30 s at 1x and are the same for the same seed |
| V12 | Picking another order in the popup freezes the log; scroll and selection survive updates; Back to live resumes |
| V13 | The review card is half size, over the ORDER card, and the door is fully visible |
| V14 | Every swarm ends (dissipates or circles a corpse); no swarm remains after a recovery |
| V15 | The miner writes a lint-clean hardening spec with evidence, a patch under the diff budget and a test per requirement |
| V16 | A rerun after the spec closes at least one pattern and the compare report says so |
