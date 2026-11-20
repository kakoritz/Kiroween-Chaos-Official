# Requirements: The Arena (game layer)

Builds on [haunted-house](../haunted-house/requirements.md). The old "rooms" are now **spooky chaos creatures**, and the five bots are **skeleton workers**. The floor plan becomes a **race arena** with five lanes.

## Concept

Five bots race through the same order pipeline, one lane each. You watch them work like an Olympic race crossed with Cooking Mama. You throw chaos at any lane. Each survived attack scores points. Every run is logged. After a wave, a reviewer agent reads the logs and writes a new spec that hardens the code for the next wave.

## Pipeline stages (each is a module and a checkpoint)

1. Order intake
2. Account creation
3. Payment processing
4. Confirmation
5. Dispatch to delivery
6. Order updates
7. Delivery tracking to destination
8. Handoff (done)

## Lanes (five bots, five resilience tiers)

| Lane | Bot | Protection |
|---|---|---|
| 1 | Rookie | None. Repeats everything on restart. |
| 2 | Retrier | Retries, no memory. |
| 3 | Journaler | Journal, resumes, no reconcile. |
| 4 | Reconciler | Journal and idempotency keys. |
| 5 | Phoenix | Everything, plus circuit breakers and offline queue. |

Toggle: "All Phoenix" mode runs five identical bots to test the system rather than race tiers.

## Requirements (EARS)

### A1. Race view
1. THE UI SHALL show five lanes, each with a character moving along the eight stages.
2. WHEN a bot starts a stage, THE UI SHALL play that stage's work animation with a progress bar.
3. WHEN a stage completes, THE UI SHALL play a cheer animation and move the character on.
4. WHEN a stage fails, THE UI SHALL flash red, show an X and a sad character.
5. THE UI SHALL show per-lane score, order count and a rank board.

### A2. Stage inspector
1. WHEN the user clicks any stage chip (pass, fail, in progress), THE UI SHALL open a popup showing what the bot did there.
2. THE POPUP SHALL show: log lines, inputs, outputs, side effects, chaos hit, recovery action, duration.
3. WHILE a stage is in progress, THE POPUP SHALL stream live and show a Chaos button.
4. THE USER SHALL be able to replay a finished stage as a short animation.

### A3. Chaos creatures
1. EACH lane SHALL have a Chaos button, in the lane and in the popup.
2. WHEN pressed, A creature SHALL float in, loom over the skeleton, and throw an exception into the current stage. The creature type is random unless chosen from a menu.
3. WHEN pressed again while the lane is still failing or recovering, A new creature SHALL arrive and throw a nested exception, either in the recovery (inner) or in the surrounding stage (outer).
4. THE DEPTH of nesting SHALL be shown as a stack counter on the character.
5. THE SYSTEM SHALL inject the real fault into the real bot. The animation reflects an actual event.

### A4. Creature catalog (starter list)

| Family | Creatures |
|---|---|
| Network | Timeout, Comm timeout, Internet outage, Slow link |
| HTTP | 404, 429, 500, Endpoint down |
| Data | Missing file, Duplicate request, Malformed payload |
| Process | Crash, Out of memory, Disk full |
| World | Power outage, Hazard event (storm, road closed), Driver unreachable |

### A5. Mini bosses
1. THE SYSTEM SHALL schedule unavoidable mini bosses: Power Outage, Internet Outage, Hazard Storm.
2. WHEN a boss is announced, THE UI SHALL show a warning banner with a countdown, so the audience sees it coming.
3. WHEN a boss arrives, IT SHALL hit every lane at once.
4. THE USER SHALL not be able to cancel a boss.

### A6. Chaos mode
1. THE UI SHALL offer: Off, Manual, Random.
2. IN Random, A slider SHALL set chaos frequency from calm to storm.
3. THE SEED SHALL be shown and re-enterable so a run can be replayed.

### A7. Scoring
1. SURVIVING an attack SHALL add points. Points scale with nesting depth.
2. COMPLETING an order with zero repeated side effects SHALL add a clean bonus.
3. A duplicate charge or email SHALL deduct points and show a red ledger flash.
4. SPEED SHALL add a small bonus. Safety outranks speed.
5. THE SCORE SHALL come from the provider ledger and journal, not from the bot.

### A8. Logging
1. EVERY event (stage, chaos, recovery, side effect, score) SHALL be written to a structured log per lane.
2. A WAVE is a fixed block of orders. Logs are grouped by wave and exported as JSONL.

### A9. Reviewer agent (self-improving loop)
1. AFTER each wave, A reviewer SHALL read the logs and list where bots failed or repeated work.
2. IT SHALL write a postmortem and a proposed spec file `.kiro/specs/hardening-<run-id>/` with requirements, a design note, tasks and suggested code changes.
3. THE SYSTEM SHALL NOT apply code changes automatically. A human (or a Kiro run) accepts the spec, and the code is changed through that spec.
4. THE NEXT wave SHALL show score change versus the last wave.
5. THE REVIEWER SHALL work offline with a rule-based mode, and use an LLM when a key is set.

### A10. Demo script
1. DEMO mode SHALL provide three scripted stories (`hero`, `full`, `loop`, see PROTOCOL) that together cover a 3-minute video. The `full` story is: calm race, first creature on the Rookie, hero crash after the charge, stacked creatures on Phoenix, Power Outage boss, wave end, postmortem, hardening spec appears.

## Acceptance

1. Five lanes run at once and stay at 60 fps in a normal browser.
2. Clicking Chaos in any lane causes a real fault, a creature animation and a log entry.
3. Three stacked hits produce nesting depth 3 and the log shows all three.
4. Phoenix survives the hero crash with 1 charge. Rookie shows 2.
5. After a wave, a hardening spec is written to disk.
