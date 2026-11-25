# Campaign credits: tasks

Branch `fix/campaign-credits`. One PR.

- [x] **CC-1 Shared start rule.** `isFreshProgress`, `withStart`, `DEFAULT_START_CREDITS` in `hub-model.ts`; the shop uses it. (R3)
- [x] **CC-2 Hub and results use it.** Hub applies the grant on load and refresh; results apply it before `applyResult`. (R1, R2)
- [x] **CC-3 Tests.** Unit tests in `campaign-hub.test.ts` and `campaign-results.test.ts`. (R1, R2, R3)
- [x] **CC-4 End to end.** `tools/e2e.mjs` campaign section: reset the dial, check the start grant and play night 1. (R4)
- [x] **CC-5 Docs.** `docs/TRACE.md` regenerated. (R1 to R4)
