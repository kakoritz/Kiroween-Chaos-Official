> **Play-test v2 UI rules are in `.kiro/specs/playtest-v2/ui.md` and win where they differ** (lap choreography, start stack, chip colours and flags, lane ticker, lane popup, reviews, header gear menu, legend). Onboarding (splash, captions, tour) is in `.kiro/specs/onboarding/spec.md`; the campaign in `.kiro/specs/campaign/spec.md`.

# Arena UI spec (Lane B): layout, motion, events to visuals, controls, states

Authoritative for everything visual. Event meanings come from `contract/PROTOCOL.md`. If this file and `arena/design.md` differ, **this file wins**. Pixel numbers are for a 1920x1080 design stage. Tune freely for looks, but keep the structure.

## 1. Stage, scaling, canvas vs DOM

- Fixed **1920x1080 design stage**, scaled uniformly to fit the window (letterboxed, centered, DPR aware). Minimum supported window 1280x720.
- **Canvas 2D** draws the scene: crypt background, lane tracks, skeletons, scrolls, creatures, props, particles, effects.
- **DOM** (positioned over the canvas, in design-stage coordinates) holds everything interactive or textual: header, controls, stage chips, rank board, ledger, inspector, banners, toasts, report viewer, menus. This gives keyboard focus, hit-testing and screen readers for free.
- No external fonts, images or audio files. Fonts: `ui-monospace, "Cascadia Code", Menlo, monospace` for numbers and labels, `ui-sans-serif, system-ui` for body. Minimum text size 16 px on the stage, lane labels 22 px, big numbers 40 px.

## 2. Palette (tokens)

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0d0b14` | Page and crypt void |
| `stone` | `#1c1830` | Panels, lane floor |
| `stone-2` | `#2a2446` | Raised panels, chips |
| `torch` | `#ff9a3c` | Accent, active, torches |
| `bone` | `#efe6d2` | Skeletons, primary text on dark panels |
| `text` | `#f3ecff` | Body text |
| `muted` | `#8f86a8` | Secondary text |
| `ok` | `#5ee08a` | Success |
| `fail` | `#ff4d5e` | Failure, repeats |
| `warn` | `#ffc247` | Retry, warnings, mock badge |
| `ghost` | `#7ab8ff` | Parked, browser badge, ghost creature |
| `hex` | `#9b6bff` | Quarantined, witch, bosses |
Contrast of text on panels must be at least 4.5:1. Never use color alone: every state has an icon and a label too.

## 3. Screen layout (1920x1080)

```
y=0    ┌ HEADER 72 ─────────────────────────────────────────────────────────────┐
y=72   │ BOSS BAR 0..48 (overlay, only when a boss is announced or active)      │
       │ LANES AREA 768 (y 72..840): N lanes, each 768/N tall (max 200)         │
y=840  ├ BOTTOM 240 ────────────────────────────────────────────────────────────┤
       │ RANK BOARD x0..640 │ LEDGER x640..1280 │ EVENT TICKER x1280..1920      │
y=1080 └────────────────────────────────────────────────────────────────────────┘
```

**Header (72 px), left to right:** logo "HAUNT" and wave label `Wave n` (n from `GET /api/state` and from the count of `wave_start` seen), app switcher dropdown, Start/Stop wave button, chaos mode selector (Off | Manual | Random) with a frequency slider (labelled Calm to Storm, 0 to 1, step 0.05) shown only in Random, speed segmented control (0.5x 1x 2x 4x), **Summon boss** menu, total score (sum of lane scores), mode badge, Play demo button, mute button, present-mode button.

**Lane (pitch 153.6 px, drawn 148 px tall at 5 lanes; with fewer lanes the height is `768 / N` capped at 200 and the group is vertically centered). Vertical zones inside a lane (at 148 px): 0-44 chip row (chips 36 px tall), 44-116 skeleton and prop zone (skeleton about 64 px tall), 116-148 progress bar and counters:**

| x range | Content |
|---|---|
| 0-260 | **Label card (260x148):** row 1 tier label (22 px) and lane number; row 2 the **5 gear slots** (the `journal` slot is the journal book, the `offline_queue` slot is the Coffin Stash with its parked counter badge); row 3 score; depth badge at the top-right corner; the **Chaos button** (48 px round, skull icon, `▾` opens the creature menu) at the bottom-right; the lane torch drawn on the card's left edge |
| 260-1500 | **Track:** one **station** per stage, evenly spaced. Each station is a DOM **stage chip** (about 120x44) above the track line and a small prop drawn on the canvas below it. The **skeleton walks along the track** to the current station (x = station of `stageIndex` plus progress within the stage). The order **scroll** is carried in its hand. The progress bar sits under the chip. |
| 1500-1600 | **Provider door:** a crypt door icon at the end of the track. The "connection line" is a dotted line from the skeleton to this door. Effect calls are drawn as small coins, envelopes or boxes flying along this line. |
| 1600-1920 | **Lane stats:** completed, failed, quarantined counters (small icons), repeats counter (red when above zero), order progress `orderIndex / ordersTotal`, the **queue of upcoming scrolls** (max 4 mini scrolls plus `+n`), and a small **shelf** along the bottom edge holding purple quarantine jars |

Each lane has a **torch** on its label card. Gear slots are outlined when the part is not installed and filled when it is.

**Orders queue:** upcoming orders are the mini scrolls in the lane stats area. At `order_start` one scroll drops from above the first station into the skeleton's hand (300 ms). There is no conveyor.

**Scroll content:** order id, then three lines of rune text (decorative, deterministic from the id). No real order data is available or needed.

## 4. Stage chip states

| State | Icon | Color | Trigger |
|---|---|---|---|
| pending | ○ | `muted` outline | default for stages not reached this order |
| active | ▶ | `torch`, pulsing | `stage_start` |
| done | ✓ | `ok` | `stage_done{skipped:false}` |
| replayed | ⟲ | `ok` dimmed | `stage_done{skipped:true}` |
| retrying | ↻ with attempt number | `warn` | `stage_start` with `attempt > 1`, or `recover_start{action:retry\|backoff}` |
| failed | ✕ | `fail` | `stage_fail` (immediately; flips to retrying if a retry follows) or `order_failed` |
| dead | ☠ | `muted` dim | between `process_dead` and `process_up`, on the stage that was active |
| parked | ⏸ | `ghost` | `order_parked` |
| quarantined | ⛓ | `hex` | `order_quarantined` |

At `order_start` all chips reset to pending. When a restarted bot repeats earlier stages (`stage_start` on an earlier stage), the chips from that stage onward return to pending, then follow events again.
Chip label is the server `label`, truncated with an ellipsis at the chip width, full text in the tooltip. Icon names come from `stage.icon`. Known icon ids: `mail, user, card, envelope, box, bubbles, road, door, brain, ticket, plane, archive`. Unknown id: a circle with the first letter of the label.
Clicking a chip opens the inspector, but only if the chip is not pending. Pending chips show the tooltip "Not reached yet".

## 5. Skeleton states and cosmetic timers

| State | Look | Duration |
|---|---|---|
| idle | Standing, slow breathing, torch flicker | loop |
| working | Bones rattle, tool or prop per `workAnimation` (section 6) | loop |
| cheer | Jump, skull grin, confetti of tiny bones | 700 ms |
| fail | Red flash on the lane (opacity at most 0.35), X over the skull, slump pose | 800 ms then holds slump |
| recovering | Bandage wrap and spinner above the skull, caption of `action` (Replaying, Reconciling, Retrying, Backing off, Restarting) | until `recover_done` |
| dead | Collapse into a **pile of bones** | collapse 600 ms |
| reassembling | Bones fly back together bone by bone | 700 ms |
| halted | Grey, slumped on the floor, small ⛔ over the lane, Chaos button disabled | holds |
| done | Sits on the label card, content smile | holds |

**Cosmetic timers are allowed:** idle loops, breathing, torch flicker, progress bar tweening between `stage_progress` values, particles, and animation timing. **Never from the UI's own clock:** the order of events, scores, counts, outcomes, ledger numbers, or whether something succeeded. State is a pure reducer of events.

**Animation versus events rule:** events are never delayed or dropped. If a new event needs a different pose while an animation runs, the current animation **snaps to its end within 150 ms** and the new one starts. `process_dead` to `process_up` can be only 1000 ms apart, so collapse (600 ms) plus reassemble (700 ms) are scaled down to fit when `restartInMs` is under 1300. All animation durations are divided by the wave `speed`.

## 6. Work animations (per `workAnimation` id)

| id | Used for | Look |
|---|---|---|
| `read_mail` | intake, fetch | Opens a letter, stamps it |
| `fill_form` | account | Writes on a form, an ID card pops up |
| `swipe_card` | payment | Swipes a card, coins fly toward the door along the line, register ding |
| `write_letter` | confirmation, draft | Writes and folds a letter |
| `load_scooter` | dispatch | Loads a box on a scooter |
| `send_bubbles` | updates | Speech bubbles float up |
| `scooter_road` | tracking | The skeleton rides the scooter along a road strip under the last two stations |
| `doorstep` | handoff | Box on a doorstep, doorbell, cheer |
| `think` | classify | Scratches skull, gear-shaped thought bubble |
| `file_ticket` | ticket | Stamps a ticket card |
| `send_letter` | reply | A paper plane flies along the line to the door |
| `archive_box` | archive | Puts the scroll in a box |
Unknown id: a generic "busy" loop (bones rattle, three dots).

## 7. Creature choreography (applies to all)

1. **Enter** (400 ms): from the nearest side or top edge of the lane, to a hover spot 70 px above the skeleton.
2. **Loom:** idle bob while the fault condition lasts. The creature is not removed by timers.
3. **Act** (600 to 900 ms): plays its action at the moment of the first consequence event for that fault (`stage_fail`, `process_dead`, `recover_start`, `chaos_absorbed`, `order_parked`, `lane_halted`).
4. **Exit** (300 ms) on the first of: `recover_done` for its depth, `stage_done` of the same stage, `chaos_absorbed` (after a 500 ms shrug), `order_failed`, `order_parked`, `order_quarantined`, `lane_halted`, `order_done`.
5. **Stack:** creatures stack in a row above the skeleton, newest on the right, at 70% scale, max 5 shown. The depth badge on the label card shows the `depth` number (a skull with a digit). Exits are last in, first out as recoveries complete. A `recover_done{depth:d}` removes the creature of depth d.
6. **`injectedAt: "recovery"` or `scope: "inner"`:** the creature hovers over the bandage and spinner, drawn at 55% scale, and its action hits the recovery.
7. **`deferred: true`:** the creature hovers with an hourglass until its consequence event.
8. `source: "random"` adds a small dice icon. Other sources add nothing.
9. Fault caption: a small label under the creature showing the fault in plain words (CRASH, TIMEOUT, 404, 429, 500, OUTAGE, MISSING FILE, DUPLICATE, BAD DATA, DISK FULL, STORM, NO DRIVER). Names come from the server `label` fields.

### Props these animations use (all exist in the scene)

Provider door and connection line (section 3), station chip, the scroll, the journal slot, the lane torch, the stage prop under each chip, the road strip, the order queue.

### Creature table

| Creature | Action | Target and end state |
|---|---|---|
| Reaper | Swings a scythe. Skeleton collapses. (Crash and OOM look the same, OOM caption differs.) | Ends at `process_dead`; Reaper exits at `process_up` |
| Wraith | Yanks the lane's power cable from a wall socket. **Torch snuffs and the lane dims to 40%.** Skeleton collapses (power outage is a process kill) | Lane relights at `process_up`, Wraith exits |
| Banshee | Screams. Sound-wave ring. The **connection line shatters** into pieces | Line stays broken until the next `effect`, `recover_done`, or `breaker{closed}`; then it mends |
| Zombie | Shambles in slowly and **sits on the progress bar**, which crawls | Exits on `stage_done`, `recover_done`, or `chaos_absorbed` (slow link) |
| Ghost | Touches the scroll. **Scroll fades to 20% opacity** with a "404" stamp | Scroll restores on the next `stage_start` with higher attempt or on `stage_done`; Ghost exits |
| Goblin | Grabs coins from the line into a sack. A "wait" timer icon appears over the door | Exits on `stage_done` or `recover_done` |
| Imp | Throws a **spanner into the station prop** (the machine). It sparks and smokes | Exits on `recover_done` or `stage_done` |
| Gargoyle | Lands on the provider door and **blocks it**. Door shows a stone slab | Stone cracks and Gargoyle exits on `recover_done`, `order_parked` and `breaker{closed}` |
| Poltergeist | Flings the **intake in-tray (file cabinet)** off the lane. A file flutters away | File flies back on `order_resumed`, `stage_done`, or `recover_done` |
| Doppelganger | Copies the scroll. **A second scroll appears** next to it with a mirror shimmer | The copy slides to the queue at the next `order_start`. Exits on `order_done` |
| Witch | Hexes the scroll. **Rune text scrambles**, scroll turns purple | Scroll stays hexed until `order_quarantined` (burns into a sealed jar) or `order_failed` (crumbles). Witch exits |
| Mummy | Wraps the **journal slot** in bandages (an empty outlined slot is wrapped too) | Unwraps on `recover_done` or `chaos_absorbed` |
| Werewolf | Howls. A **full moon** rises over the last two stations and the road. Lightning shimmer | Moon sets on `stage_done` of tracking or `recover_done` |
| Will-o'-Wisp | A blue flame that **leads the scooter off the road** | Scooter returns on `stage_done` of tracking |
| **Lich** (boss, power) | 400 px tall at the top of the lanes area. **Every lane's torch snuffs and every lane dims.** Each skeleton collapses on its own `process_dead` | Dies away at `boss_end`; lanes relight on each `process_up` |
| **Banshee Queen** (boss, internet) | Full-width screen vignette. Every lane's connection line shatters | Mends per lane as in Banshee. Leaves at `boss_end` |
| **Headless Horseman** (boss, storm) | Rides across the lanes area. **Rain particles** and a moon, lightning flash at most once every 2 s | Clears at `boss_end` |
Unknown creature id: generic "specter" sprite with the fault caption. The `sprite` field in `/api/creatures` equals the creature id.

## 8. Event to visual table (every PROTOCOL event)

Lane-level events carry `lane`. Events with **no** lane (global): `hello`, `reset`, `wave_start`, `wave_end`, `boss_warning`, `boss_start`, `boss_end`, `hardening_spec`, `fix_applied`. Unknown event types are ignored.

| Event | Visual |
|---|---|
| `hello` | Set mode badge, app, check `contractVersion` (mismatch shows a blocking card "Update the UI"). |
| `reset` | Cut all animation instantly, clear all state, show the quiet crypt. |
| `wave_start` | Build N lanes from `lanes` and `tiers`. Wave label increments. Header controls switch to running state. |
| `lane_ready` | Set tier label and gear. Installed gear shown on the skeleton and journal slot with no animation. Not-installed slots drawn as outlines. |
| `order_start` | Chips reset. Next scroll slides into the hand. Order progress `index/total`. |
| `stage_start` | Chip active. Work animation begins. `attempt > 1`: chip shows ↻ n. |
| `stage_progress` | Progress bar tween to `pct`, label text under the chip. |
| `stage_done` | Chip done, cheer (small, 300 ms, soft). `skipped: true`: chip replayed ⟲, no cheer, 120 ms fast-forward. |
| `stage_fail` | Fail pose and red flash. Chip failed. `retryable: true` shows a small "retry?" hint until the next event. |
| `chaos` | Creature enters per section 7. Depth badge. |
| `chaos_absorbed` | The creature shrugs (500 ms), then exits. Small caption with `reason`. |
| `process_dead` | Collapse into bones, chip dead. `restartInMs` drives a thin timer ring over the bones. |
| `process_up` | Reassemble. Torch relights. |
| `recover_start` | Recovering pose with the action caption. Replay and reconcile also show the journal slot glowing. |
| `recover_done` | Recovering pose off. Creature at that depth exits. Short green tick. |
| `effect` | A coin, envelope or box flies along the line to the door. Ledger cell +1. `replayed: true`: the item flies, bounces back and a "reconciled" stamp shows, no ledger change. |
| `repeat` | Ledger cell flashes red twice (600 ms each, total flash area under 30%). Repeats counter increments. A "x2" stamp on the door. |
| `breaker` | Shield gear glows. `open`: a red shield with a lock over the door. `half_open`: amber. `closed`: green and the lock opens. If the lane has no Shield gear, a temporary shield icon appears. |
| `order_done` | Cheer, scroll stamped. `clean: false` shows a red "x repeats" stamp. |
| `order_failed` | Scroll crumples with a red X, skeleton keeps a slump 800 ms, then straightens for the next order. |
| `order_parked` | Scroll flies into the **Coffin Stash** on the label card (counter +1). Chip parked. |
| `order_resumed` | Scroll flies out of the stash back into the hand. Counter -1. |
| `order_quarantined` | Scroll is sealed in a purple jar placed on a shelf at the lane end. Counter +1. |
| `order_abandoned` | Remaining queue scrolls grey out one by one. |
| `lane_halted` | Halted state (section 5). Rank board row struck. |
| `part_added` | Gear flies from the screen edge onto the skeleton with a spark, slot fills. Caption "Kiro added: <label>" with `spec` if present. |
| `boss_warning` | Boss bar slides in: sprite, name, "arrives in N" countdown (cosmetic count from `startsInMs`), siren sound. |
| `boss_start` | Boss enters and acts (section 7). Bar shows "ACTIVE". |
| `boss_end` | Boss leaves, bar slides out, "Survived" flash per lane that completed an order. |
| `score` | Floating `+25` or `-150` over the skeleton (green or red), `reason` as small text. Lane score and header total tick. |
| `wave_end` | End card (section 12). |

**Page load and reconnect:** build from `GET /api/state`: skeleton at `stage`, progress 0 until the next `stage_progress`, `dead` as bones, `recovering` with spinner, `halted` grey, depth badge from `depth`, boss bar if `boss.active`. Creatures are not restorable and are not drawn. Then subscribe to SSE with `since` set to the last seen `seq` (when reconnecting) or without it (first load).

## 9. Controls

**Start panel** (shown when no wave runs; a modal card or a left drawer): orders (number, default 12, 1 to 200), seed (number, default random, shown and editable), tiers (Race | All Phoenix), lanes (1 to 5, default 5, Inbox default 2), speed, app. Button Start. While a wave runs these are disabled and **Stop** is shown.

**Chaos mode:** Off | Manual | Random. Manual shows the lane Chaos buttons. Random shows the frequency slider and the seed. Both modes keep the buttons.

**Chaos button (per lane):**
- Click: random fault (the server picks one that applies).
- `▾` or Shift+key: menu of creatures grouped by family (Process, Network, HTTP, Data, World). Bosses are not in this menu. Under Reaper: "Where" submenu with `Next point`, `Before effect`, `After effect, before journal`, `After journal`, `Mid stage` which maps to the `point` field.
- Scope: send `inner` if the lane is `recovering` or `depth > 0`, else `outer`.
- Disabled when the lane is `halted`, `done`, `idle`, `dead` (shows tooltip why) or no wave runs.
- Errors (`depth_limit` and others) show as a toast for 3 s.
- Keyboard: `1` to `5` fire a random chaos on that lane. `Shift+1..5` open that lane's menu. `B` opens Summon boss. `Space` pauses animation rendering only (events still update state; a "paused" tag shows). `M` mute. `F` present mode. `Esc` closes any popup.

**Summon boss** (header menu): Lich, Banshee Queen, Headless Horseman. Sends `POST /api/chaos {fault: "boss_..."}` without a lane (see PROTOCOL).

**Speed:** changes `POST /api/speed`. Animation durations scale by the server `speed` from `wave_start` and `speed` replies.

**App switcher:** dropdown from `GET /api/apps`. If a wave is running: confirm "Stop the current wave?" then `POST /api/wave/stop` and `POST /api/app`. The server emits `reset`. Inbox uses the same scene with its own stage names, work animations and 2 lanes by default. Lane tier labels come from `lane_ready.label`.

**Play demo:** button in the header, and the large call to action on the quiet screen. It calls `POST /api/demo/start {script}`. If a wave runs it first stops it. A `?demo=hero|full|loop` URL parameter starts it on load. During a demo a "DEMO" pill shows and the Stop demo button replaces Play demo.

**Transport and mode:** if `window.__haunt` exists use `inpage`; else use `?api=` if present, else same origin, else `http://127.0.0.1:7070`. The mode badge shows MOCK (`warn`), LIVE (`ok`), BROWSER (`ghost`) with a tooltip.

## 10. Rank board (bottom left)

Rows, one per lane: rank, tier label and lane number, score, `completed/failed`, repeats, state icon. Sort by score descending, tie-break fewer repeats, then lane number. Reordering animates in 400 ms. Dead rows dim with ☠, halted rows are struck through with ⛔, done rows show ✓. The first row gets a small crown. Total of all lane scores shows in the header.

## 11. Ledger (bottom middle)

Table: one row per lane, one column per effect kind present in this app (orders: account, charge, email, dispatch, notify; inbox: ticket, email). Cell value is the number of ledger rows created this wave (`effect` with `replayed:false`). If repeats exist the cell shows `n` in red with `+k` repeats. `repeat` flashes the cell (section 8). At `wave_end` and on page load reconcile with `GET /api/ledger`. A column header "expected" row shows orders completed so far for reference.

## 12. Wave end, report viewer, postmortem

**Wave end card (modal, 640x420):** final rank board, buttons `View report`, `Next wave`, `Play demo again`. In `loop` demo it auto-advances into the hardening scene.

**Report viewer** (full-screen overlay, route `#/report/:n`, Esc closes). Tabs:

| Tab | Content |
|---|---|
| Summary | Giant grade letter in a ring (color by grade), reliability %, repeats count, lost orders, scalability grade if present, targets table (pass or fail with icon plus color) |
| Matrix | Grid of stage rows by fault columns. Cell states: pass ✓, repeat ⧉, recovered late ⏱, fail ✕, halt ⛔, not applicable · . Each cell clickable (opens a short card with evidence `seq` numbers) |
| Curves | Hand-drawn SVG or canvas charts: ramp (throughput and p95 latency against concurrency with knee and break marked), depth survived per stage, recovery time p50, p95, max bars. No chart library |
| Findings | Ranked list: severity, stage, creature, evidence, suggested fix. Evidence `seq` links open the inspector for that stage |
| Compare | Two wave pickers (from `GET /api/waves`), side by side grade, score, repeats, and a diff grid of matrix cells that changed (improved green, worsened red) |
| Postmortem | Markdown from `/api/waves/:n/postmortem` rendered by a small built-in renderer (headings, lists, tables, bold, code). No external dependency |

Entry points: wave end card, a "Reports" button in the header (list from `GET /api/waves`).

**Hardening scene** (demo script `loop`; driven by the events `hardening_spec`, `fix_applied`, `part_added`; see section 20): after a wave a "Reviewer" card slides in showing the hardening spec title and its first lines (from `GET /api/waves/:n/hardening`), then a "Kiro applying fix" panel lists the files from the `fix_applied` event with a progress ticker (cosmetic, driven by event details), then `part_added` events equip gear on the lane, then the next wave starts. A "Recorded fix" label shows in `browser` mode.

## 13. Inspector popup

Modal 900x600, centered, dimmed background, focus trapped, `Esc` closes.
- Header: tier label, lane, order id (dropdown of orders this lane has processed in this session, default the current or last), stage label, status chip.
- Left column (260 px): attempt list (`attempts`), each with a status icon and duration.
- Main: tabs **Log | Effects | Journal | Chaos**. Log lines show a level icon (info ℹ, warn ⚠, error ✕, good ✓), timestamp offset, text. Effects shows `effects` rows (kind, key, amount, replayed). Journal shows `journal` records. Chaos shows `chaos` and `recover` rows. **Input / Output** blocks above the tabs show `input` and `output` from the response (see PROTOCOL).
- Footer: `Replay ▶`, `Chaos ▾` (same menu as the lane button), `Close`.
- Live: on open, fetch once, then subscribe to the event stream already open and filter by lane, order, stage. No polling. If the stage finishes, the title shows the final status and the Chaos button disables.
- **Replay:** re-feeds the stage's `events` array into a mini scene (one lane, 800x150) using `ts` offsets at 1x (the speed control applies). A scrubber below allows pausing and stepping.

## 14. Sound (Web Audio, generated in code)

Sound starts **muted** until the first user gesture. A chip "Click to enable sound" shows once. The mute state persists in `localStorage`. Limits: the same sound at most once per 120 ms, at most 8 voices at once.

| Event | Sound |
|---|---|
| `order_start` | soft scroll swish |
| `stage_start` | quiet tick (very low volume) |
| `stage_done` | bone clack, pitch rising with consecutive stages |
| `stage_fail` | low buzz |
| `chaos` | creature sting, pitch by family |
| `process_dead` | thud and bone clatter |
| `process_up` | rising rattle |
| `recover_done` | soft chime |
| `effect` (charge) | coin |
| `repeat` | alarm blip x2 |
| `order_done` | short fanfare |
| `boss_warning` | siren loop until `boss_start` |
| `boss_start` | deep boom |
| `lane_halted` | low doom |
| `part_added` | equip clink and sparkle |
| `wave_end` | gong |
No ambient music. Negative `score` makes no sound beyond the event that caused it.

## 15. States: empty, loading, error

| State | Visual |
|---|---|
| Quiet (no wave) | The crypt with five sleeping skeletons (zzz), a big **Play demo** button and **Start wave** |
| Loading | A skeleton assembling bone by bone with the text "Raising the crypt" |
| Reconnecting | Banner "Lost the crypt. Reconnecting" (retry 1, 2, 4, 8 s cap, resume with `since`). Scene frozen and dimmed. On `410 gone` reload state. |
| Server unreachable | Card with the API address tried, the command `npm run mock` or `npm run demo`, and a Retry button |
| Contract mismatch | Blocking card |
| No waves for reports | Report viewer empty state "Run a wave first" |
| Postmortem not ready | "The reviewer is still reading the logs" |
| Browser target error | Banner "The browser engine stopped" with Restart |

## 16. Present mode (for the video)

`F` or `?present=1`: hide header controls (keep the wave label, total score and mode badge), hide menus and the Start panel, hide the cursor after 2 s, keep the Chaos buttons visible but without arrows, shrink the bottom panels to leave a **60 px caption-safe strip**, and lock 16:9 with letterboxing. Chaos is fired from the keyboard (`1` to `5`).

## 17. Accessibility

- The canvas has `role="img"` with an `aria-label` that summarizes the leader and active chaos. A visually hidden `aria-live="polite"` region announces key events at most once per second: stage failures, crashes, recoveries, order done, boss warnings (assertive), wave end. Example: "Lane 1, Rookie, crashed at Payment. Recovering."
- Every interactive element is a real button or link with an accessible name and a visible focus ring (3 px `torch`).
- Tab order: header controls, lane 1 controls and chips, lane 2, and so on, then panels.
- **Reduced motion** (`prefers-reduced-motion: reduce`): no travel, no shake, no particles, no screen flashes. Poses swap instantly with a 200 ms cross-fade. Creatures appear in place. The boss bar is static. Skeleton collapse and reassemble become a two-frame swap with a caption.
- **Flash safety:** at most 3 flashes in any second, flash area under 30% of the screen, lightning at most once per 2 s.
- State is never color only: icon, color and text label together.

## 18. Performance

60 fps with 5 lanes and 3 creatures per lane. Batch event reducer work per animation frame (up to 200 events per second must not stutter). Cap particles at 300. Sprites are drawn once to offscreen canvases and reused. If the frame time exceeds 24 ms for 2 seconds, switch to a lite mode (fewer particles, no blur).

## 19. What Lane B needs from the mock server beyond the earlier list

See PROTOCOL "Mock requirements" and `harness/tasks.md` H0.10 to H0.14: fixtures for parked, breaker, part_added, chaos_absorbed, deferred, all three bosses, the inbox app, the `loop` demo, a stress stream, sample reports, a sample postmortem and a sample hardening spec, plus transport fault injection and a `window.__haunt` stub.

## 20. Review fixes (round 2)

### Layout details
- **Crypt look:** stone-tile lane floors, torch light pools, cobwebs in the lane corners, a slow drifting fog layer (cosmetic) behind the lanes, dark stone wall behind the header. All drawn in code.
- **Z-order (bottom to top):** canvas background, lane floors, props, scrolls, skeletons, creatures, boss sprite, particles; then all DOM on top. The **canvas never receives pointer events** (`pointer-events: none`), so the 400 px Lich never blocks a chip or Chaos button. The Lich is centered at x=960 spanning the lanes area, top aligned to y=72.
- **Creature placement:** hover spot is above and to the right of the skeleton inside the lane's chip row zone (y 0-44), sprite height 56 px at 5 lanes, stacked creatures sit side by side to the right at 70% scale, 56 px apart. Sprites are clipped to their lane rectangle (bosses excepted).
- **Header slots:** left to right: logo and wave label, app switcher, Start/Stop, chaos mode (the Random popover holds the frequency slider and the **chaos seed**, which is `chaos.seed` sent with `POST /api/chaos/mode`; the **wave seed** is in the Start panel), speed, Summon boss, total score, Reports button, Play demo, mode badge, mute, present.
- **Event ticker (bottom right, x1280-1920):** newest first, last 12 lines, one line each: `[lane n Tier] text`. Shown events and the text built **client-side** from templates: `stage_fail` "<stage> failed (<error>)", `chaos` "<Creature> strikes <stage>", `process_dead` "crashed, back in <n> s", `process_up` "restarted", `recover_start` "<action>", `recover_done` "recovered in <ms> ms", `repeat` "DUPLICATE <kind> x<count>", `order_done` "order done" (with "clean" or "x repeats"), `order_failed`, `order_parked`, `order_quarantined`, `lane_halted`, `boss_*`, `part_added` "Kiro added <part>", `score` only when `abs(delta) >= 100`, `hardening_spec`, `fix_applied`. Colors by level (info, warn, error, good).

### Chip, time, depth semantics
- **Chip on `stage_fail`:** the chip turns **failed** immediately and the red flash and slump play (they are short). If the next event is `recover_start{action:retry|backoff}` or `stage_start` with a higher `attempt`, the chip flips to **retrying** and the skeleton returns to its work pose. Failed is final only if `order_failed`, `order_parked`, `order_quarantined` or `lane_halted` follows.
- **All millisecond values in events are real wall-clock ms** (`restartInMs`, `startsInMs`, `ms`, `durationMs`). The server has already divided by `speed`. The timer ring and countdown use them as given. **Animation durations** in this spec (collapse 600 ms and so on) are divided by `speed` (a cosmetic choice).
- **Depth:** max depth is **5** (`depth_limit` beyond). The badge shows the `depth` of the latest `chaos`. A `recover_done{depth:d}` removes the creature of depth d and lowers the badge to d-1. **At `process_up` the badge resets to 0**, and all creatures on that lane exit except the killing creature (Reaper, Wraith, or Lich), which exits at `process_up` as in the table. On `process_dead` every other creature of that lane leaves in a 200 ms puff.
- **Enter vs snap:** the 400 ms enter may be truncated by the 150 ms snap rule when `process_dead` follows `chaos` within 150 ms (as in the hero). That is intended.
- **Two cheers:** the stage cheer is 300 ms and quiet, the order cheer (`order_done`) is 700 ms with confetti.

### Creature rule additions
- **Faults with no failure consequence** (`duplicate_request`, `slow_link`, `disk_full` on journal tiers, any absorbed fault): the creature acts 300 ms after `chaos`, then stays until the closing `chaos_absorbed` (PROTOCOL rule 20) or `order_done`.
- **Zombie on a processed timeout** (A9): sits on the bar from `chaos`; the `effect` coin still flies; at `stage_fail` the Zombie acts (bar freezes red).
- **Poltergeist** on an `order_failed` order: the file stays gone, the scroll crumples, the Poltergeist exits at `order_failed`.
- **Chaos menu filtering:** `GET /api/creatures` has `apps: ["orders","inbox"]`. The menu shows only creatures whose `apps` contains the current app (Werewolf and Will-o'-Wisp are orders-only). A 409 `not_applicable` shows a toast.
- **Where submenu** appears under Reaper and Wraith and maps: Next point = omit `point`; Before effect = `before_effect`; After effect, before journal = `after_effect_before_journal`; After journal = `after_journal`; Mid stage = `mid_stage`.
- **Bosses:** one big boss sprite is drawn once on `boss_start`; per-lane effects follow each lane's own `chaos{source:"boss"}`. For the Horseman, lanes not yet at tracking or dispatch have `deferred: true` and show rain only until their stage arrives. At `boss_end` a "Survived" flash shows on every lane that is not `dead` or `halted`.
- **Banshee** stays while the line is broken; it exits by the general rule.

### More event rows (adds to section 8)

| Event | Visual |
|---|---|
| `hardening_spec` | The Reviewer card slides in with the title and findings count. Fetch the spec text from `GET /api/waves/:n/hardening` for the first 12 lines. |
| `fix_applied` | The "Kiro applying fix" panel lists `files` with `+add -del`. A "Recorded fix" label shows when `recorded: true`. |
| `wave_end{stopped:true}` | No end card. A toast "Wave stopped". |
| `wave_end` in a demo | The end card shows for 3 s, then closes by itself so following demo events can play. |
| `effect` kinds | `account_create` an ID card flies, `charge` a coin, `email` an envelope, `dispatch` a box, `notify` a speech bubble, `ticket` a ticket card. |
| `stage_start` on an earlier stage (Rookie restart) | The skeleton **walks back fast (300 ms)** to that station. |
| `order_resumed` | Stash counter -1 and the scroll flies back to the queue area. The next `order_start` for it picks it up into the hand. |

**Ledger columns:** `account_create` "Accounts", `charge` "Charges", `email` "Emails", `dispatch` "Dispatches", `notify` "Notices", `ticket` "Tickets". A cell shows the total row count; if `repeat` events were seen for that kind it also shows `+k` where k is the sum of `count - 1` over those repeats.

### Sound additions
creak on Wraith `chaos`, wail on Banshee and Banshee Queen `chaos`, soft whoosh on `chaos_absorbed`, low buzz on `order_failed`, clunk on `order_parked`, shield clang on `breaker`. **Sound default:** muted until the first click anywhere, then unmuted unless the saved preference is muted. For a recording open with `?sound=1`, click once, and then start the demo.

### Transport detection
1. `window.__haunt` exists: `inpage`.
2. Else `?api=<url>` if present.
3. Else try `GET /api/health` on the same origin with an 800 ms timeout; if it answers, use it.
4. Else `http://127.0.0.1:7070`.
`?embed=1` (for the Kiro Crew page iframe) hides the app switcher and present button and reads the API base from `?api=`.

### Kiro Crew page scope (W5)
Lane B only guarantees that `packages/arena-ui/dist/index.html` runs **inside an iframe** with `?embed=1&api=<url>`: no use of `window.top`, relative paths only, scales to the iframe size (down to 1280x720 stage scaling). Lane A packages it as a Crew app page.

### Report data
The report JSON is defined in `.kiro/specs/engine/runtime.md` section 9. Sample reports from the mock include `ramp` (6 steps, knee at 8, break at 32), `depth`, `scalability`, `tiers`, at least 40 matrix cells covering all six result codes, and at least 5 findings, so every tab can be built and shown.

### Demo and video
- Present mode has **no** title card feature. The receipt opener, title cards and ledger close-ups are made in a video editor.
- For the inspector shot, use the `meltdown` fixture (it has a failed stage) with `?demo=meltdown` in mock mode, or any live run where a Rookie fails.
