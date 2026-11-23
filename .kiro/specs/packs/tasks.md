# Packs and production mode: tasks

Branches `core/PK-...`, `ui/PK-...`.

## Lane A
- [x] **PK-C1 Pack format and loader.** `packs/<id>/pack.yaml` schema, validator, generic bot from stages and parts (reuse SH-C3), pack labels in state. Done, plus bosses and curses consumed by the lab model, `haunt pack new|list|check`, `haunt init`, `npm run packs:embed`; see docs/PACKS.md.
- [x] **PK-C2 Streaming pack.** Stages, faults, tiers, bosses, reviews; fixtures; sweep grade table.
- [ ] **PK-C3 Ticketing mode (Python).** Extend `apps/haunted-inbox` with the 11 stages, fake `jira`, `asana`, `kace`, `webhook` providers, faults and tiers; live in the arena (also closes SH-C6).
- [x] **PK-C4 Monkey CLI.** `haunt monkey --mode observe|staging|prod-guarded`, allowlist, blast radius, schedule window, steady-state hypothesis with abort, dry run, audit log.
- [x] **PK-C5 Kill switch and dead-man timer.** `haunt stop`, HTTP stop, restore under 1 s, tests.
- [x] **PK-C6 Watch mode.** `haunt watch` (non-stop at chosen speed), rolling report and pattern store. Done: 1x to 100x in observe and staging, 1x only in prod-guarded, patterns to `.haunt/patterns.json`, fix specs, SIGINT stop.
- [x] **PK-C7 Docs.** `docs/PRODUCTION-MODE.md` with guarantees and limits, written plainly.

## Lane B
- [ ] **PK-U1 Pack switcher.** App switcher lists packs; labels, creatures and review names from the pack; "model-based" tag.
- [ ] **PK-U2 Streaming art.** Buffer Wraith, CDN Kraken, DRM Gatekeeper, Render Gremlin, Cloud Banshee, Region Warden (code-drawn).
- [x] **PK-U3 Monkey panel.** Mode selector, guard-rail summary, big kill switch, steady-state meter.

## Cut line
PK-C1, PK-C2, PK-U1 (streaming in the Lab) first; then PK-C3; then PK-C4, PK-C5, PK-U3; then the rest. Never before the `tournament-v3` must list.
