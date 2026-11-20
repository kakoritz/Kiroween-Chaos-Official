# Design: The Arena

## Visuals

2D canvas game, pixel-art style, drawn in code (no image or AI art assets). Characters are small sprites made from simple shapes, built by a sprite function with poses.

**Layout**
```
┌ header: wave, seed, chaos mode + slider, total score ─────────────┐
│ Lane 1 Rookie    [Intake][Account][Pay][Confirm][Dispatch]... ⚡  │
│ Lane 2 Retrier   ...                                         ⚡  │
│ Lane 3 Journaler ...                                         ⚡  │
│ Lane 4 Reconciler...                                         ⚡  │
│ Lane 5 Phoenix   ...                                         ⚡  │
├ rank board │ provider ledger (live charges per lane) │ boss bar ─┤
└────────────────────────────────────────────────────────────────┘
```

**Stage animations** (small, readable, 1 to 2 s loops)

| Stage | Work animation |
|---|---|
| Intake | Opens mail, stamps order |
| Account | Fills a form, ID card appears |
| Payment | Swipes card, coins fly, register dings |
| Confirmation | Writes and posts a letter |
| Dispatch | Loads a box onto a scooter |
| Updates | Sends little message bubbles |
| Tracking | Scooter drives along a road strip |
| Handoff | Box on doorstep, doorbell, cheer |

**States:** working, cheer (hooray), fail (red flash, X, sad), recovering (patching bandage, spinner), nested (stack badge), dead (grey ghost, rises on resume).

**Creatures** (the chaos, all Halloween, no animals): each runs in from the screen edge, hovers over the skeleton, then acts by type.

| Creature | Causes | Animation |
|---|---|---|
| Reaper | crash, out_of_memory | Swings a scythe, the skeleton collapses into a pile of bones |
| Wraith | power_outage | Snuffs the lantern, the lane goes dark |
| Banshee | internet_outage | Screams, the connection line shatters |
| Zombie | timeout, comm_timeout, slow_link | Shambles in slowly and sits on the progress bar |
| Ghost | http_404 | Makes the record fade away |
| Goblin | http_429 | Hoards the tokens in a sack |
| Imp | http_500 | Throws a spanner into the gears |
| Gargoyle | endpoint_down | Lands in front of the door and blocks it |
| Poltergeist | missing_file | Flings the file cabinet out of the window |
| Doppelganger | duplicate_request | Copies the order scroll |
| Witch | malformed_payload | Hexes the scroll, the text scrambles |
| Mummy | disk_full | Wraps the journal in bandages |
| Werewolf | hazard_event | Howls, a full moon rises over the road |
| Will-o'-Wisp | driver_unreachable | Leads the courier off the path |
| **Bosses:** Lich, Banshee Queen, Headless Horseman | boss_power_outage, boss_internet_outage, boss_hazard_storm | Bigger sprite, warning banner, hits every lane |

**Skeleton states:** working (bones rattle, tool in hand), cheer (jumps, skull grin), fail (collapse into bones, red flash, X), recovering (reassembling bone by bone), nested (stack badge), dead (pile of bones, rises on resume).

**Gear:** Spellbook (journal), Seal (idempotency keys), Lantern (retry), Shield (circuit breaker), Coffin Stash (offline queue). Shown on the skeleton. The Rookie is bare. Phoenix has all five.

**Sound:** Web Audio synth for ding, thud, cheer, alarm, spooky stings (all generated in code). A mute button.

## Architecture additions

```
Browser (canvas + inspector)
   ▲  SSE events        │ POST /chaos {lane, creature, mode}
   │                    ▼
Server ── Wave manager ── Chaos director (manual, random, boss schedule)
   │            │
   │            ├── 5 Lane workers ──> Bot process (SDK)  ──> Provider (ledger)
   │            └── Event log (JSONL per lane per wave)
   └── Reviewer agent ──> postmortem.md + .kiro/specs/hardening-wave-N/
```

**Chaos director.** Holds a queue of faults per lane. A creature press adds a fault with `scope: inner | outer`. The SDK reads the fault at the next hook point inside the active stage and throws it. If the lane is already recovering, the fault lands inside the recovery code (inner). Otherwise it lands in the stage (outer). The nesting counter is the length of the active fault stack.

**Fault injection points.** Every stage in the SDK has `before`, `during`, `after_effect_before_journal`, `after_journal` hooks, plus a `recovery` hook. Real faults map to behavior:

| Creature | Real effect |
|---|---|
| Timeout, Slow link | Provider delays reply past client timeout |
| 404, 429, 500, Endpoint down | Provider or stub returns that status |
| Internet outage | Local proxy drops all outbound calls for N s |
| Power outage | Runner SIGKILLs the bot, delays restart N s |
| Crash, OOM | SIGKILL |
| Missing file | Input file renamed away, put back later |
| Duplicate request | Same order and key posted twice |
| Malformed payload | Corrupted JSON in the next input |
| Disk full | Journal write throws ENOSPC once |
| Hazard, Driver unreachable | Tracking feed stalls, then returns a reroute |

**Bots by tier.** One workflow definition, five policy objects: `{journal, idempotency, reconcile, retry, breaker, offlineQueue}`. Rookie has all off. Phoenix has all on. This keeps the code small and makes the race fair.

**Score engine.** Reads the ledger and journal after each stage. `points = base + depth_bonus + clean_bonus - repeat_penalty + speed_bonus`. Written to the event log as `score` events.

**Event schema (JSONL)**
```
{ts, wave, lane, order, stage, type, detail}
type: stage_start | stage_done | stage_fail | chaos | recover | effect | repeat | score | boss
```

**Inspector.** Reads the same events, filtered by lane and stage, and renders them as a game-style log: icons per line, colored by type, with a play button that re-animates the stage.

**Reviewer agent.**
1. Load wave logs.
2. Rule pass: find `repeat`, `stage_fail` without `recover`, deep nests that died, slow recoveries.
3. Group by stage and creature, rank by cost.
4. Write `postmortem.md` (what broke, where, how often).
5. Write `.kiro/specs/hardening-wave-N/` with requirements, design notes and tasks, each linked to log lines.
6. Optional LLM pass drafts the suggested code diffs when a key is set. Diffs are only written to the spec, never applied.

The loop closes through Kiro: the hardening spec is run as a normal Kiro spec, the code improves, the next wave shows the delta.

## Performance and scope control

- One canvas, one render loop, sprites drawn once to offscreen canvases.
- Server is the source of truth, browser is a view.
- Cut line if time runs out: ship 5 lanes, 6 creatures, 1 boss, inspector, scoring and the rule-based reviewer. Drop the rest.

## Risks

| Risk | Mitigation |
|---|---|
| Too much art | Shape-based sprites, shared poses, tint for state |
| Five real child processes | Light bots, in-memory provider with SQLite ledger |
| Chaos feels fake | Every creature maps to a real fault and a log line |
| Self-learning sounds like magic | Be exact: it writes a spec, a human or Kiro applies it |
