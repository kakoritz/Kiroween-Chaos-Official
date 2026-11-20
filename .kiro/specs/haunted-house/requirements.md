> **First draft, partly superseded.** The rules in `.kiro/specs/engine/` and the files in `contract/` win. Rooms became the creature and fault catalog, SQLite became JSONL, and the task list is replaced by `.kiro/specs/harness/tasks.md`. See `docs/SPEC-MAP.md`.

# Requirements: Haunted House for Automation Workflows

**Category:** Resurrection (primary). Costume Contest (secondary, for the UI).
**One line:** Bots walk through rooms of failure. Every run shows where it died and whether it came back without repeating work.

## Hero demo (the 90 seconds that wins)

An order-processing bot charges a customer, then the process is killed. It restarts, finds the half-done order, and finishes it. The customer is charged once. A second "naive" bot runs the same crash and charges twice. Both run side by side.

## Glossary

- **Run**: one execution of a workflow against one scenario.
- **Room**: one failure scenario (Missing File, Duplicate Request, Crash).
- **Journal**: append-only log of every step intent and result.
- **Side effect**: anything outside the bot that cannot be undone (a charge, an email).
- **Survivor bot**: bot built with journal and idempotency keys.
- **Naive bot**: same workflow, no protection. The control.
- **Verdict**: SURVIVED, SURVIVED_WITH_REPEAT, or DIED.

## Requirements (EARS)

### R1. Rooms
1. THE SYSTEM SHALL ship three core rooms: Cellar (missing file), Mirror Hall (duplicate request), Crypt (crash mid-task).
2. THE SYSTEM SHALL ship two bonus rooms: Poltergeist (timeouts and 429s that clear on retry) and Locked Door (a dependency that is down for the whole run).
3. WHEN a room is selected, THE SYSTEM SHALL run both bots through it with the same seed.

### R2. Chaos injection
1. THE SYSTEM SHALL inject faults at named crash points: `before_charge`, `after_charge_before_journal`, `after_journal`, `before_email`.
2. THE SYSTEM SHALL make every run reproducible from a seed and a fault plan (JSON).
3. WHEN a crash point fires, THE SYSTEM SHALL kill the bot process for real (not a thrown exception).

### R3. Survival behavior (Survivor bot)
1. WHEN the bot is about to cause a side effect, IT SHALL first write an intent to the journal with an idempotency key.
2. WHEN the bot restarts, IT SHALL read the journal and resume at the first step without a recorded result.
3. IF an intent has no result, THEN IT SHALL ask the provider by idempotency key before retrying (reconcile).
4. WHEN a duplicate request arrives with a known key, IT SHALL return the first result and cause no new side effect.
5. WHEN an input file is missing, IT SHALL park the order in a quarantine queue, continue with other orders, and resume the parked order when the file appears.

### R4. Run report (the core product)
1. EACH run SHALL produce a report with: timeline of steps, the exact step where it broke, the fault injected, and the verdict.
2. THE REPORT SHALL show side-effect counts from the provider's ledger, not from the bot's own claims (for example "charges for order 1042: 1").
3. THE REPORT SHALL state "resumed from step N, skipped M completed steps, repeated 0 side effects".
4. THE REPORT SHALL be a single self-contained HTML file and a JSON file.

### R5. Haunted house UI
1. THE UI SHALL show a floor plan with one door per room and a ghost for each bot.
2. WHEN a bot crashes, THE UI SHALL show the ghost dying and the crash point highlighted.
3. WHEN a bot resumes, THE UI SHALL show the ghost rising and replaying completed steps greyed out.
4. THE UI SHALL show a live provider ledger beside both bots.
5. THE UI SHALL have a "Kill it now" button for live, audience-driven crashes.
6. THE UI SHALL work offline with no external services.

### R6. Bring your own bot
1. THE SYSTEM SHALL provide a small SDK (`step()`, `effect()`) so any Node workflow can run inside the house.
2. THE SYSTEM SHALL provide a CLI: `haunt run <room>`, `haunt report <run>`, `haunt list`.

### R7. Safety
1. THE SYSTEM SHALL use only a simulated payment provider. No real money, no real keys.
2. THE SYSTEM SHALL contain no network calls except to localhost.

### R8. Kiro showcase
1. THE REPO SHALL include specs, steering files and agent hooks used to build it.
2. THE README SHALL explain how Kiro was used, with links to those files.

## Out of scope

Distributed workers, real payment gateways, auth, multi-tenant hosting.

## Acceptance (what judges can verify)

1. `npm run demo` opens the house and plays the hero demo with no setup.
2. Naive bot shows 2 charges. Survivor bot shows 1 charge. Same crash.
3. All five rooms pass in CI (`npm test`) with a 100% pass on the survival suite.
4. A report file opens by double-click.
