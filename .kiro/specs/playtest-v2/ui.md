# Play-test v2: UI spec (Lane B)

Source: owner play-test notes (issues #124 to #128) and the judge-panel review. Data shapes are in `contract/V1_1.md`; engine rules in `design.md`. **Where this file and `arena/ui-spec.md` differ, this file wins.** Pixel numbers are for the 1920x1080 stage. Every visual is driven by an event (the pure-reducer rule stays; travel is enforced by the server, section 1).

## 1. The lap: choreography of one order

The skeleton has five anchor states: `AT_START` (the stack of scrolls at the left end of the track), `WALKING` (between stations), `AT_STATION k`, `AT_DOOR` (the delivery door at the right end), `RETURNING`.

| Trigger event | What the viewer sees | Duration (from the event) |
|---|---|---|
| `order_start{grabMs}` | Skeleton stands at the start. A scroll lifts from the **start stack**, he grabs it, chips reset, the queue count drops. The intake chip shows **next** (not active). | `grabMs` |
| `stage_start` (intake or any) | Chip turns **active**, work animation and progress bar begin. The server guarantees the skeleton has arrived. | n/a |
| `stage_done{walkMs}` | Cheer (300 ms, quiet, may overlap the walk). He walks to the next station. The next chip shows **next** (dashed orange outline with a small arrow) until its `stage_start`. | `walkMs` |
| `stage_done` of the last stage, then `order_done{ceremonyMs, returnMs}` | **Handoff ceremony:** the door opens, he hands the scroll over, a hand takes it, the **door closes** with a thud. | `ceremonyMs` |
| `review` (right after `order_done`) | Floating **star emoji** with the number rise from the door (stars scaled to the rating: 5 stars bursts, 1 star droops). The review card appears (section 7). | 1.6 s float |
| after the ceremony | He **runs all the way back** to the start (fast steps, dust puffs, tiny bones bounce). | `returnMs` |
| `order_failed{cancelMs, returnMs}` | The door stays shut. The scroll burns with a red **CANCELLED** stamp, he slumps, then trudges back (slow walk). `review` shows one drooping star. | `cancelMs`, then `returnMs` |
| `process_dead` / `process_up` | As before (collapse, reassemble). After `process_up` he appears at the station of the open stage, or at the start for a no-memory bot. | existing |
| `order_parked` | The scroll flies into the Coffin Stash and he walks back to the start for the next order. | `returnMs` |

**Rules**
1. **A stage never looks started before the skeleton has arrived.** The engine holds `stage_start` for `walkMs` after `stage_done` and for `grabMs` after `order_start` (contract rule 40). The UI animates inside those gaps.
2. If a `stage_start` arrives early anyway (a mock bug), the UI **snaps** the skeleton to the station at once and writes a console warning `travel_violation`. It never delays an event.
3. **The order comes from the start of the track**, never from the end.
4. Distances: station spacing is fixed, so walk speed = distance / `walkMs`. Return speed = track length / `returnMs`.
5. All durations in this table are real ms from the events; cosmetic easing may not extend them.

## 2. The start stack

A stack of mini scrolls (max 4 plus `+n`) sits at the **left end of the track** (x 268 to 330), under the first chip. The `ORDER i/n` counter stays in the lane stats area but the **scroll queue graphic moves from the stats area to the start**. `order_resumed` makes a scroll fly from the Coffin Stash back onto the stack. A `redo` shows the scroll rewinding into the stack.

## 3. Stage chips v2 (replaces ui-spec section 4)

Chip state is a **pure function of the lane's events for the current order**, computed in one tested module `chipState(events)`.

| State | Look | When |
|---|---|---|
| pending | grey outline, ○ | not reached this order |
| next | dashed orange outline, small arrow | `stage_done` or `order_start` seen, `stage_start` of this stage not yet |
| active | orange fill pulse, ▶ | `stage_start`, no trouble yet |
| **trouble** | **yellow** fill pulse, ⚠ | the stage is open and any of: `stage_fail`, `recover_start` open, `breaker{open}`, `process_dead`, degraded |
| **passed** | **green**, ✓ | `stage_done` with **zero** issues at this stage |
| **healed** | **green with an amber flag**, ✓ with ⚑ n | `stage_done` after one or more issues at this stage |
| **failed** | **red**, ✕ | the order ended `failed` (cancelled) at this stage |
| replayed | green dim, ⟲ | `stage_done{skipped:true}` |
| parked | blue, ⏸ | `order_parked` |
| quarantined | purple, ⛓ | `order_quarantined` |
| dead | grey, ☠ | between `process_dead` and `process_up` |

- **Issue flag:** a small flag (⚑) at the chip's top-right with the **number of issue events** at that stage for this order (the definition in `contract/V1_1.md` section 3). Shown whenever the count is above zero, in every state. Clicking the flag opens the lane popup on that stage.
- **Counters on the lane:** a "heat strip" under the chips: one thin segment per stage, opacity = issue count at that stage summed over the whole wave (so the weak step stays visible after the order ends). Tooltip: `Payment: 4 issues over 3 orders`.
- Tooltips on every chip: label, state in words, attempts so far, issues, downtime so far.
- Colors: green `ok`, yellow `warn` (the trouble token), red `fail`, blue `ghost`, purple `hex`. State is always icon plus color plus label (colour-blind safe).

## 4. Lane ticker (replaces the shared Event Log, bottom right, x 1280 to 1920)

- **One row per lane** (5 rows, 44 px each). Left: lane dot, tier name. Right: the **current message** for that lane.
- A new message **slides up** (250 ms) and pushes the previous one out of the top. Minimum display time 1.8 s: messages queue (max 3) and fast-forward (shortened to 600 ms) if more arrive. Severity colors: info, good, warn, error. A row shows a small `⚑ n` badge with the lane's issue count for the current order.
- Texts are built client-side from the templates of ui-spec section 20 plus: `order_start` "grabbed order N", `stage_done` (only non-trivial: "passed Payment after 2 retries"), `review` "★ 4.5 \"Lightning fast\"", `decision_needed` "WRONG ORDER at Confirmation: choose", `score` with downtime "downtime -2", `order_failed` "ORDER CANCELLED", boss messages.
- **Click a row** (or the lane label) to open the lane popup (section 5). Keyboard: rows are buttons; `Enter` opens.

## 5. Lane popup (extends UI-C1; modal 1180x720)

Opened from a ticker row, the lane label, a chip, or a chip flag. `Esc` closes; focus is trapped; the other lanes keep running behind a dim.

```
┌ header: Tier, lane, order picker, outcome chip, ★ stars so far / pace badge ───────────────┐
│ LIVE SCENE 1100x170: this lane's skeleton at its station, same renderer as the arena       │
├──────────────────────────┬──────────────────────────────────────────────────────────────┤
│ STAGE TABLE (8 or 6 rows)│ LOG (live, newest at bottom) with filter All | Issues | Score │
│ stage | status | tries |  │ one line per event: icon, +0.0s, text, level colour          │
│ retries | issues | down |  │                                                               │
│ time | recoverable        │                                                               │
├──────────────────────────┴──────────────────────────────────────────────────────────────┤
│ LAP SUMMARY: lap time, attempts, retries, downtime, issues, review card, [Replay] [Chaos ▾]│
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Live scene:** a second instance of the lane renderer, fed the same events, so the viewer watches that skeleton and its creatures work independently. A "Follow lane" toggle keeps it live; turning it off lets the scrubber replay.
- **Stage table columns:** status chip (same states as section 3), **attempts** (calls made), **retries**, **issues** (flag number), **downtime** (seconds, red if above 0), **time** (stage ms), **recoverable** (yes, no, n/a: yes if a failure at that stage was followed by success). Rows click to filter the log to that stage.
- **Order picker:** every order of this lane in the wave with its outcome icon and lap time. The table and log follow the picked order; the live scene follows the current order.
- **Log:** from the SSE stream filtered by lane (live) plus `GET /api/lane/:lane/order/:order` for history. Each line: level icon (info, warn, error, good), time offset, text. Filters: All, Issues (issue events only), Score (score events only).
- **Lap summary:** the lap object (ms, attempts, retries, downtime, issues) and the **review card** (section 7). Downtime is shown in red as `-N points` using the score events.
- **Replay** keeps its earlier behavior (mini scene replays the stage events at the chosen speed).

## 6. Laps, wave summary, star progress

- **Lap table** (in the popup and under the lane when expanded): one row per order: order id, outcome icon, **lap time**, attempts, retries, downtime, issues, stars. The **best** completed lap gets a green star tag, the **slowest** a red turtle tag. Footer: totals and averages.
- **Wave end card v2** (replaces the old end card, 1100x640): per lane a card with the **rating title** (Five-Star Crypt and so on), avg stars, best / slowest / average lap, total time, retries, downtime, outcomes (done, cancelled, parked, quarantined), and an **issues by step** heat row (8 or 6 chips coloured by `issuesByStage`). Below: the **star progression chart** per lane: bars or a sparkline of `cumStars / cumMax`, labelled at each order (5/5, 6/10, 8/15, ...). Buttons: View report, Next wave, Play demo again.
- **Live star tracker** in the lane label card (small, under the score): `★ 8/15` with the last review's stars. Data from `review.cum`.
- **Report viewer new tab "Laps & stars":** the per-lane lap tables, the star progression, ratings, and the issues-by-step heat map for the chosen wave (`GET /api/waves/:n/laps`, `/stars`). Compare view shows rating and avg stars of both waves.

## 7. Reviews and the handoff door

- **Door stars:** at `review` stars float from the door: `stars` shown as a number with star icons (half stars drawn), 1.6 s. Colors: 4.5 or more gold, 3 to 4 amber, below 3 red.
- **Review card** (toast beside the door, 380x160, shows 4 s, also saved in the lane popup): Yelp-style: avatar (a tiny ghost customer), the stars, five **sub-score bars** (timeliness, delays, issues, delivery, ease), and the `text` quote (the reasons). Cancelled orders show "Never arrived" with one star.
- Customer ghost expressions: 5 stars delighted, 3 to 4 neutral, 1 to 2 angry.

## 8. Score visuals

- **Downtime:** while an interval is open the lane shows a rolling red chip `DOWNTIME -N` that counts up (cosmetic count between events; the authoritative `score{downtime}` lands at the end). The final negative floats off the skeleton.
- **Cancelled:** a slam `-300` in red with a shake (respects reduced motion).
- **Boss recovered:** gold banner "RECOVERED +150" with confetti on the lane and a second line "+N downtime refunded".
- **Score explainer:** hovering a lane score opens a popover with the last 8 score events (reason and delta) so a negative like `-770` is explained ("2 duplicate charges -300, 1 cancelled order -300 ...").
- **Rank board fixes:** do not crown or highlight a leader while all scores are 0; ties show the same rank; the avg stars appear as a column.

## 9. Header and controls v2

Header left to right: logo and wave label, app switcher, **Start / Stop wave**, **Play demo ▶ / Stop demo ■** (the button changes; label never "Open in demo mode"), **Summon boss**, total score, **Reports**, **gear menu ⚙**, **legend ?**, mode badge, mute, present.

**Gear menu** (popover from the gear, 360 px wide):
- **Chaos:** radio Off / Manual / Random; when Random: frequency slider (Calm to Storm) and chaos seed field.
- **Pace:** Normal / Show / **Slow** (default Slow). **Speed:** 0.5, 1, 2, 4.
- **Sound:** on/off and volume. **Motion:** reduced motion override.
- **Behavior:** the menu **closes** after a selection of a radio or button, on outside click, and on `Esc`. Selecting Random never leaves a panel over the arena. Slider and seed changes apply live and keep the menu open until the user clicks away.
- The mode badge has a tooltip: "MOCK = recorded replay. LIVE = real engine. BROWSER = runs in your tab."

**Legend** (`?` button, modal 720x520): three tabs. **Gear:** the five badges **R Retry (tries again), J Journal (remembers progress), I Idempotency (never repeats a charge), B Breaker (backs off, protects), Q Queue (parks and resumes)**, each with icon and a one-line example. **Chips:** every chip state of section 3. **Creatures:** all creatures with the fault each causes. First visit opens the legend with a short tip; stored in `localStorage`.
**Gear badge tooltips:** hover or focus on R J I B Q (the letters in the label card) shows the part name, what it does, and whether this tier has it (gold) or not (grey: "Add this part to survive X").

## 10. Decision popup (wrong order)

On `decision_needed` a modal appears over that lane (not the whole screen; the other lanes keep running): title "WRONG ORDER at <detectedAt>", the angry ghost customer, three large buttons with consequences, a countdown ring of `timeoutMs`, and a line "If you wait: <default>".

| Button | Shows | Result |
|---|---|---|
| Refund (1) | -150 credits, order cancelled | `POST /api/decision` `refund` |
| Discount (2) | -60 credits, stars cap 3 | `discount` |
| Redo (3) | no credit loss, costs time, stars cap 4 | `redo` |
Keyboard `1`, `2`, `3`. After `decision_made` the choice animates: refund coins fly back to the customer and the scroll burns; discount a price tag stamps the scroll; redo the scroll rewinds to the start stack and the skeleton runs back (`order_start{redo:true}`). In demo mode and fixtures the popup shows with `source:"default"` for 1.5 s then plays the result.

## 11. New creatures and props

| Creature (fault) | Choreography | Ends |
|---|---|---|
| **scarecrow** (`wrong_address`) | Plants a **wrong-way signpost** on the road strip; the scooter turns the wrong way and comes back dizzy | `stage_done` of tracking or `recover_done` |
| **black_cat** (`no_answer`, `gated_house`) | Sits on the doorstep; the door shows a "NOBODY HOME" sign (no_answer) or **gate bars** (gated_house); each retry the skeleton knocks and a "?" bubble pops | handoff `stage_done` or `order_parked` or `order_failed` |
| **phantom_car** (`car_accident`) | A ghostly car crashes at the door with a crunch, hazard lights blink, the road is blocked | handoff completes or the order ends |
| **prankster** (`order_typo`) | A pumpkin-headed imp swaps the items on the scroll (icons flip). At detection the scroll flashes **WRONG ORDER** | `decision_made` |
| gargoyle, caption **SMS DOWN** (`sms_down`) | Blocks the envelope on the line; the envelope bounces off | `recover_done` or order end |
| imp, caption **APP DOWN** (`app_down`) | Throws a spanner into a **phone prop** at the dispatch station | same |
| goblin, caption **UPDATES DOWN** (`updates_down`) | Hoards the speech bubbles | `stage_done` (degraded) |
Art: new sprites for the first four (lab page entries with Idle and Act, silhouette test, style guide). The last three reuse existing sprites with a caption chip, so they ship first.

## 12. Pace

The Start panel and the gear menu offer Pace (Normal, Show, **Slow default**). A small `SLOW` tag shows in the header while active. Animation durations that this spec lists as constants are **real ms from events** and are not scaled again by the UI (only purely cosmetic loops follow `speed`).

## 13. Sound additions

Door open (creak) and close (thud) at the ceremony, star chime (pitch by stars), review "ding" for 4.5 or more, sad trombone blip for 1 to 2 stars, cancel slam, downtime tick (very quiet, rate limited), boss recovered fanfare, decision jingle, scarecrow rustle, black cat meow, phantom car crash. Same rules: muted until the first click, rate limits as in ui-spec section 14.

## 14. Accessibility

- All new popups are focus-trapped dialogs with accessible names. Ticker rows are buttons. The live region announces: order cancelled, review stars ("Lane 3 got 4 stars: Lightning fast"), decision needed (assertive), boss recovered.
- **Reduced motion:** no walking or running; the skeleton cross-fades between stations (200 ms); the door ceremony is a two-frame swap with a caption; stars appear without floating; no shake on cancel.
- Flash safety rules of ui-spec section 17 still apply to the slam and confetti.

## 15. Mock and fixtures the UI needs

`laps-reviews`, `cancelled`, `world-events`, `typo-refund`, `typo-discount`, `typo-redo`, `boss-recovered`, `downtime` (contract section 11), regenerated `hero-crash`, `full`, `loop`. The mock must also serve the new endpoints with sample data for laps, stars, and `decision`.

## 16. Tests (UI)

- Pure reducers get unit tests: `chipState`, `lapTable`, `starTracker`, `tickerQueue`, `downtimeTicker`.
- One smoke e2e: load the arena in mock mode, play `laps-reviews`, assert the door stars, the star tracker `8/15`, the ticker row text, and the popup opens. Do not run e2e repeatedly.
- A **travel test** (unit): feeding a fixture where `stage_start` follows `stage_done` by less than `walkMs` triggers the `travel_violation` path.

## 17. Acceptance checklist

1. Intake never starts before the skeleton is at the start of the track with the scroll.
2. He takes the order from the start stack, never from the end.
3. After handoff: door opens, door closes, stars float, he runs to the start.
4. A cancelled order burns the scroll and shows 1 star.
5. Chips show green, yellow, red and blue exactly as section 3, with flags and counts.
6. The ticker shows one row per lane and sliding messages; clicking opens the popup with the live skeleton.
7. The popup shows attempts, retries, issues, downtime, recoverable, per stage and per order.
8. The wave end card shows best, slowest, average lap, issues by step, ratings and the star progression.
9. The gear menu closes after selecting Random; the legend explains R J I B Q.
10. Slow pace is default and every stage is followable.
11. The decision popup works with the keyboard and plays each outcome.
12. A boss recovery shows the bonus and the refund line.
