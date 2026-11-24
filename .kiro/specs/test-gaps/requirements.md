# Requirements: close the requirement test gaps

`npm run trace` (docs/TRACE.md) listed 8 of 73 requirements with no `// covers:` test. This spec closes them.

## Rule: every requirement has a test
1. EVERY requirement ID in `.kiro/specs/**` SHALL be named by a `// covers: <spec>/<ID>` comment in at least one test, so `npm run trace` reports 73 of 73.
2. EACH new test SHALL assert behavior of the code that replaced the first-draft wording, not the wording itself, where `docs/SPEC-MAP.md` says the requirement was superseded.
3. IF a requirement cannot be tested as worded, THEN the test SHALL cover the nearest checkable fact and this spec SHALL say what is not covered.

## The gaps

| ID | Requirement | What the test checks |
|---|---|---|
| haunted-house/R1.2 | Bonus rooms Poltergeist and Locked Door | The rooms became catalog faults. Timeout and 429 are count-bound and clear on retry; endpoint_down and internet_outage are time windows that fail every call, then clear. Checked against the real Provider |
| haunted-house/R1.3 | Both bots run a room with the same seed | The same seed gives identical orders; rookie and phoenix process the same order set under the same crash |
| haunted-house/R4.3 | Report states "resumed from step N, skipped M, repeated 0" | See "Known limits" below |
| haunted-house/R5.2 | UI shows the ghost dying | `process_dead` sets the lane dead and the running stage chip dead |
| haunted-house/R5.3 | UI shows the ghost rising and replaying | `process_up` reassembles; journal-skipped stages are `replayed` |
| haunted-house/R6.2 | CLI | `haunt run` and `haunt list` do not exist; sweep, stack, ramp, soak, boss, report are dispatched and in the usage text |
| playtest-v2/R8.3 | Play demo, Stop demo, badge tooltip | Both buttons exist in the page, Stop starts hidden and calls `stopDemo`; the badge tooltip explains the modes |
| playtest-v2/R9.3 | demo and fresh-clone keep working | Scripts point at real files; fresh-clone and `npm run verify` both run `demo --check` |

## Known limits (not covered)
1. R4.3: no report renders the sentence "resumed from step N, skipped M completed steps, repeated 0 side effects". The test covers the facts it would be built from (the restarted bot skips completed stages, resumes at the crash step, repeats no effect; the Rookie control does not). A renderer for the sentence is not part of this spec.
2. R8.3 and R9.3 read page and script sources. They do not click buttons or run `npm run fresh-clone` (it needs a network install). `demo --check` runs in `npm run verify`.
3. R5.2 and R5.3 test the arena model state, not canvas pixels.
