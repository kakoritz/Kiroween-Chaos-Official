# Video plan v3 (ON-D3): shot list and capture plan

Owner records. This file is the plan only; recording, upload and wording approval are owner-only. Captions and voice are in `docs/DEMO-SCRIPT.md` (do not fork the text). Story: the same bug in three outfits (duplicate charge, duplicate ticket, double stream).

Limit: 3:00 hard, target 2:50. Captions burned in. No copyrighted music, no payment or shop brand logos. Music none, or generated in code.

## Preconditions

1. `npm ci` and `npm run fresh-clone` pass.
2. Arena runs live: `npm run demo -- --no-open`, then `http://127.0.0.1:7070/?splash=0`. Real device, 1920x1080, notifications off, no personal or company names on screen.
3. A live Kiro run of a generated fix spec exists (scene 6). If not, label the scene "Recorded fix" and cut the line "Kiro applies the spec".
4. A tournament seed that shows, in the first rounds: a swarm, a Rookie 2 vs Phoenix 1 payment crash, one elimination with a tombstone. Rehearse once and keep the seed.

## Shot list

| # | Time | Shot | Click path | Status |
|---|---|---|---|---|
| 1 | 0:00-0:08 | Receipt, red "Charged. Charged again.", then the splash | Title card, then open `http://127.0.0.1:7070/` | Capture |
| 2 | 0:08-0:50 | Tournament round 1: swarm and shoo, ledger 2 vs 1, standings, tombstone | **Skip**, **Start tournament**, open the ledger, wait for round end | Capture (live) |
| 3 | 0:50-1:15 | Dial to 11 and curses | **Next wave** (N), drag **INTENSITY** to 11 (**THROW EVERYTHING**) | Capture (live) |
| 4 | 1:15-1:35 | Casebook on the final screen | Finish the tournament with **Next wave** until the podium, awards, Casebook | Capture (live) |
| 5 | 1:35-2:00 | Patterns, fix spec, improve loop | **Patterns**, **Write fix spec**, **Improve**, hold on the compare report | Capture (live). Fallback: the sample in `docs/proof/sample-hardening-spec/` |
| 6 | 2:00-2:25 | Kiro applies the spec, rerun, grade | Kiro IDE or CLI with `.kiro/specs/hardening-<run>/`, run the tasks, show the diff, rerun in the arena | **TO RECORD live** |
| 7 | 2:25-2:40 | Python inbox in the same arena | App switcher **Haunted Inbox**, run a wave | Capture (live) |
| 8 | 2:40-2:50 | End card: `docs/img/architecture.svg`, URLs, "Built with Kiro" | Static | Fill the URLs after publishing |

Reference screenshots of scenes 2 to 5 already exist in `docs/proof/ui-tv3/` for framing.

## Claims check (say only what the evidence shows)

- "Rookie: 2 charges. Phoenix: 1." comes from the ledger on screen; the same numbers are asserted in `packages/haunt/test/hero-crash.test.ts`.
- Tournament, dial, curses, Casebook, patterns, fix spec and improve loop are real code (see `README.md` status table). The closed-pattern count is whatever the screen shows on the take, not a number from the docs.
- "Kiro applies the fix": only if scene 6 is a live take. Otherwise "Recorded fix".
- "F to A": only with the live proof. The existing proof is a recorded fix on a crash-only plan (`docs/proof/live-fix.md`).
- Second app is real. A streaming app and the full Ticket Desk flow are not built; do not show them. The closing line names the double stream as the next outfit, not a shipped one.
- Do not show the Power or Crew app as installed. Only a manifest handshake is proven.

## Capture method

1. One clip per scene, 2 s pad each end. Name clips `scene-1-receipt` to `scene-8-endcard`. OBS or Windows Game Bar.
2. Edit to under 3:00. Burn captions in from the text in `docs/DEMO-SCRIPT.md`, inside a 5% safe margin.
3. Audio: voice only, normalized.
4. If a live scene fails on camera, use demo mode and keep the "Recorded run" label visible.

## Publish steps (owner only)

1. Export 1080p MP4, captions burned in.
2. Upload to YouTube unlisted. Check playback, length under 3:00, caption legibility on a phone.
3. Make it public at submission and paste the link into Devpost.

## Checklist before upload

- [ ] Hook in the first 8 s
- [ ] Rookie 2 vs Phoenix 1 visible
- [ ] Dial shows 11 and THROW EVERYTHING
- [ ] Casebook visible
- [ ] Scene 6 labelled live or "Recorded fix"
- [ ] No brand logos, no personal or company names
- [ ] Length under 3:00, captions readable on a phone
