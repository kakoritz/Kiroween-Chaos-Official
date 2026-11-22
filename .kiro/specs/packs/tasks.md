# Packs and production mode: tasks

Branches `core/PK-...`, `ui/PK-...`.

## Lane A
- [ ] **PK-C1 Pack format and loader.** `packs/<id>/pack.yaml` schema, validator, generic bot from stages and parts (reuse SH-C3), pack labels in state.
- [ ] **PK-C2 Streaming pack.** Stages, faults, tiers, bosses, reviews; fixtures; sweep grade table.
- [ ] **PK-C3 Ticketing mode (Python).** Extend `apps/haunted-inbox` with the 11 stages, fake `jira`, `asana`, `kace`, `webhook` providers, faults and tiers; live in the arena (also closes SH-C6).
- [ ] **PK-C4 Monkey CLI.** `haunt monkey --mode observe|staging|prod-guarded`, allowlist, blast radius, schedule window, steady-state hypothesis with abort, dry run, audit log.
- [ ] **PK-C5 Kill switch and dead-man timer.** `haunt stop`, HTTP stop, restore under 1 s, tests.
- [ ] **PK-C6 Watch mode.** `haunt watch` (non-stop at chosen speed), rolling report and pattern store.
- [ ] **PK-C7 Docs.** `docs/PRODUCTION-MODE.md` with guarantees and limits, written plainly.

## Lane B
- [ ] **PK-U1 Pack switcher.** App switcher lists packs; labels, creatures and review names from the pack; "model-based" tag.
- [ ] **PK-U2 Streaming art.** Buffer Wraith, CDN Kraken, DRM Gatekeeper, Render Gremlin, Cloud Banshee, Region Warden (code-drawn).
- [ ] **PK-U3 Monkey panel.** Mode selector, guard-rail summary, big kill switch, steady-state meter.

## Cut line
PK-C1, PK-C2, PK-U1 (streaming in the Lab) first; then PK-C3; then PK-C4, PK-C5, PK-U3; then the rest. Never before the `tournament-v3` must list.
