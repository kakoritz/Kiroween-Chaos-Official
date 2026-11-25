# Tournament stall and hosted frames: tasks

Branch `fix/tournament-stall-hosted-frames`. One PR.

- [x] **TS-1 Spec.** Requirements, design, tasks. (R1 to R3)
- [x] **TS-2 Hook release.** `ChaosHost.release`, called on `proceed`. Root cause. (R1)
- [x] **TS-2b Runner grace kill.** `runLane` kills a bot that outlives `shutdown`, and a bot that never gets ready. Defensive. (R1)
- [x] **TS-3 Regression tests.** `packages/haunt/test/chaos-host-proceed.test.ts`, `packages/haunt/test/runner-shutdown-grace.test.ts`. (R1)
- [x] **TS-4 e2e diagnostics.** Timeout error prints phase, round, wave, lanes, last events. (R2)
- [x] **TS-5 Hosted filler.** `demoFillerTimes` and the in-page schedule. (R3)
- [x] **TS-6 Hosted frame check.** `check:hosted` samples `?demo=full`. (R3)
