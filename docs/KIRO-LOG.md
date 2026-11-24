# Kiro log

Notes on what Kiro did and how the build went, written from the git history and PR titles (216 PRs, 246 commits on `stack/tv3`, 2026-11-20 to 2026-11-22). The old per-task bookkeeping, one line per PR with "partial" markers, is kept in [`KIRO-LOG-ARCHIVE.md`](KIRO-LOG-ARCHIVE.md). The rubric-ordered account is [`KIRO-WRITEUP.md`](KIRO-WRITEUP.md). Where something cannot be backed by git or a PR title it is not here.

## Decisions on the record

- **No tests in CI (owner decision, 2026-11-20).** GitHub Actions installs, typechecks, validates events and builds. Local `npm test` is the merge gate. Later, CI was set to manual only because jobs never started on the account (PR #217).
- **Stack choices.** Vitest is pinned to 3.2.7 because Vitest 5 needs Node 22 or newer while `engines` says Node 20 (H0.9 note in the archive).
- **Category.** The first spec pass tried a Frankenstein theme, then switched to Skeleton Crew the same day (commits "Switch category to Frankenstein" and "Skeleton Crew category").

## 2026-11-20: specs first, then the skeleton

- A full spec pass came before any code: requirements, design and tasks for the haunted house, arena and engine, swim lanes, a contract, an acceptance oracle and several rounds of "cold read" and "round N" fixes (see the first 14 commits).
- Core built bottom-up in one PR per task: provider with ledger and idempotency (#8), SDK with journal and replay (#9), pipeline and five tiers (#10), chaos director with real SIGKILL (#11).
- **The hero test landed early** (#15): Rookie 2 charges, Phoenix 1. It is the number the whole project is built around.
- **The property test** (#31) kills the bot at every hook call. It found that a Phoenix crash at `mid_stage` of `updates` (hook call 20, seed 7) replays to `failed` instead of `done` while effect counts stay right. It was not fixed in that PR and the test carries a "Known bug" comment. Still open on this branch.
- **Where Kiro got it wrong, and the fix was a PR:** Phoenix sweep with 6 failed cells (root cause: lost shipment id after restart, #59), journals reused across waves (#50), a live stream that failed the validator with 500+ violations (#64, #74), a Retrier sweep that did not match the acceptance table (#78, #92).
- Agents (#44), hooks (#45), MCP server (#68), Crew app packaging (#71) and the Python inbox (#57, #67, #90) all landed the same day.
- Loop proof recorded (#51): wave 1 F, hardened Rookie wave 2 A. The fix is a hand-written file, not a live Kiro run. An earlier version of the proof graded A for the wrong reason (ledger repeats were not attached), and the re-record after scoring v2 (#196) is the one that stands.

## 2026-11-21: arena, playtest, campaign, onboarding

- Two lanes ran in parallel against one contract (core and visuals): the arena UI (`UI-*` PRs), creatures and art drawn in code (`UI-ART*`), the report viewer with the wave 1 vs wave 2 comparison (#119).
- Owner play-test notes became the `playtest-v2` spec: travel gaps, laps, reviews, scoring v2, lane popup, world events (`PT-*` PRs #154 to #213). A design example that said -340 where the code gives -300 was corrected (#197).
- `campaign` (`CP-*`), `onboarding` (`ON-*`: splash, captions, tour, hosted demo build) and `share` (`SH-*`: badge, scorecard, GitHub Action, Workflow Lab, Python inbox live in the arena #200) were written as specs and built.
- Two tests were flaky under load and were fixed after the fact (#175, #203).
- GitHub billing stopped CI jobs from starting, so CI became manual only (#217).
- Spec for tournament v3, contract v1.2, packs and a fit check landed together (#219), written after the owner's second play-test.

## 2026-11-21 to 2026-11-22: tournament v3

- 11-step order pipeline (`TV3-C1`), review state and Next wave (`TV3-U2`), pinned popup log (`TV3-U3`), creature swarms (`TV3-U5`), never a perfect run (`TV3-C3`), intensity dial 1 to 11 (`TV3-C4`, `TV3-U6`), random outage timer (`TV3-C5`).
- Tournament engine (`TV3-C7`) and UI (`TV3-U8`), lessons ledger (`TV3-C8`), Casebook and awards (`TV3-C10`, `TV3-U9`), curses (`TV3-C9`).
- Pattern miner (`TV3-C11`), fix spec writer and lint (`TV3-C12`), the self-improving loop (`TV3-C13`), and the patterns view and improve-loop report in the UI (`TV3-U11`). A follow-up fixed the improve loop so it really closes patterns.
- A fresh-clone `npm run demo` showed a blank page until the arena UI was built; `demo` now builds it when `dist/assets` is missing.

## What is still not done (from the git history and specs)

- Kiro applying a generated fix spec live, with transcript and diff saved (SH-C4 is only a recorded fix).
- Power and Crew app installed in real Kiro windows (only a manifest handshake is proven).
- The streaming pack has no runnable app (model-based only). The 11-stage Ticket Desk is built and runs live.
- Production mode (`haunt monkey`), the hosted demo URL, the video.
- The `mid_stage` replay bug above.
