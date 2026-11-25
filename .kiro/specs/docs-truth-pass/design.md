# Docs truth pass: design

Docs only plus one test. No `contract/` file, no engine code.

- **Hooks.** Read all five files in `.kiro/hooks/`. Result: `pbt-on-sdk-save` and `fixtures-on-contract-save` run a command on save; `trace-on-merge` runs `npm run trace` on save of specs or tests (despite its name); `lint-hardening-spec` and `reviewer-on-wave-end` ask the agent. None blocks anything. "Guard" becomes "check on save". No new hook: the cheap true one already exists.
- **Names.** Prose says Orders, Ticket Desk, Stream. Directory names (`apps/haunted-*`) and the catalog labels stay, because tests and the UI use them. `docs/START-HERE.md` names the switcher labels once.
- **Counts.** Spec folders, ticked tasks and campaign nights are read from the repo (15 folders, `nights.json` has 7 nights) and written as such.
- **Test.** Extend `docs-truth.test.ts` with a "docs truth pass" block: file-link existence for START-HERE, stale-name scan over live docs, three-apps check, hosted URL presence, hook-claim scan.
- **Trace.** The new test carries `// covers: docs-truth-pass/R1 ...` and `npm run trace` regenerates `docs/TRACE.md`.
