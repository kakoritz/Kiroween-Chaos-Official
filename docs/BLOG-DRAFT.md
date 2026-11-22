# Blog post draft (Bonus Blog Prize)

Draft only. Not published. The owner approves wording and picks the platform.

## "Charged. Charged again." The property test that caught our crash

A bot crashes right after it charges a customer. It restarts and, not knowing it already charged, charges again. Nothing in the logs looks wrong. The provider's ledger says two charges.

That is the bug Haunt is built around, and it is the same bug whether the side effect is a charge, a support ticket or a video stream. This is the story of how we found it, proved it and what Kiro got wrong along the way.

### The crash that duplicated a charge

We wrote the hero test first (`packages/haunt/test/hero-crash.test.ts`): kill the bot at payment, after the charge and before the journal write, restart it on the same journal, and count what the provider recorded. The Rookie tier (no protection) ends with 2 charges. Phoenix, which keeps a journal, uses idempotency keys and reconciles against the provider, ends with 1. The count comes from the provider's ledger, never from the bot's own report, because the bot is the thing being tested.

### The property test that found a different bug

A single crash point proves one case. So Kiro helped us write a fast-check property (`packages/haunt/test/pbt-crash-point.test.ts`): kill the bot at every hook call, restart it, and require exactly one account, one charge, one email and one dispatch for Phoenix. 60 runs per pass.

The effect counts held. But the test surfaced something else: a Phoenix crash at `mid_stage` of the `updates` stage (hook call 20, seed 7) replays to a result of `failed` instead of `done`, even though the side effects were still correct. The bot did the right thing in the world and reported the wrong thing about itself. Ordinary tests had not hit that crash point.

We did not fix it in that pull request. The test says so in a comment and asserts the side-effect count only, which is what the property is about. As of this draft the comment is still there; the bug is documented, not closed.

### From a crash to a fix spec

Haunt turned into a tournament: five lanes face the same seeded storm, the worst lane dies each round and leaves a corpse, and a Casebook records every edge case. A pattern miner then clusters the recurring problems and writes a Kiro spec with requirements, evidence, the smallest patch and a test per requirement. On one seeded run the improve loop closed 5 of 9 patterns and moved the grade from C to B (`docs/proof/sample-hardening-spec/`).

The fix that took the Rookie from F to A in our loop proof is a recorded, hand-written file. We have not yet recorded Kiro applying a generated spec live, so we do not claim it.

### What Kiro got wrong

- **Wrong sweep outcomes the first time.** The first Phoenix sweep had 6 failed cells where the acceptance file said zero. After a restart the pipeline lost the journaled shipment id, so tracking polled an empty id and got a 404. Fixed at the root.
- **Overstated proof.** Early waves graded A because ledger repeats were not attached to the report. The saved loop proof then showed C, not A, because one Phoenix order was lost in both waves. We corrected the claim and added a task for a real, verified proof.
- **A first live stream that failed validation 500+ times.** Event detail fields were missing. A normalizer took it to 0 violations.
- **A wrong number in a design doc.** A scoring example said -340; the code gives -300.
- **Reported work that was not done.** One run summary described a merge that had not happened because the command waited on an approval prompt. We checked git afterwards.
- **Drift on long tasks.** Multi-file tasks wandered unless the task named the exact file and acceptance row.

### What we would tell another team

Count the side effect at the provider. Write the acceptance table before the code. Let a property test kill your program at every step, and read what it prints even when your assertion passes. Label a recording as a recording.

### Try it

```
npm ci
npm run demo
```

Hosted demo: link to be added at submission. Repo: link to be added.
