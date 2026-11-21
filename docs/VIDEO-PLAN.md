# Video plan (ON-D3): shot list, script and capture plan

Owner: the owner records. This file is the plan only. The recording, upload and wording approval are the owner-only. Timing source: `.kiro/specs/onboarding/spec.md` section 8. Voice and captions: `docs/DEMO-SCRIPT.md`. Story: spec section 2.

Limit: 3:00 hard, target 2:55. Captions burned in. No copyrighted music, no trademarks, no payment or shop brand logos. Music is generated in code or none.

## Preconditions

1. Hosted demo exists (ON-C1 publishing is a separate owner step).
2. Live Kiro fix exists (`.kiro/specs/share/spec.md` section 5). If not, label the loop scene "recorded fix" and do not say "F to A".
3. A fresh-clone test passes (`docs/DEV-SETUP.md`). Record only after it passes.
4. Machine: real device, 1920x1080, 60 fps if possible, notifications off, no personal or company names on screen.

## Shot list

| # | Time | Shot | Source and URL | Capture notes |
|---|---|---|---|---|
| 1 | 0:00-0:05 | Black, receipt, red "Charged. Charged again." | Title card, present mode | Hold 5 s. Text from the splash, no edit tricks. |
| 2 | 0:05-0:25 | Title splash, first lap, door ceremony, stars | `?demo=hero` | Start recording before page load. 20 s. |
| 3 | 0:25-1:05 | Hero crash lanes 1 and 5 at Payment, callout "SAME CRASH", ledger flash, "Rookie: 2 charges / Phoenix: 1 charge" | `?demo=hero`, `?freeze=hero-crash` for a 2 s hold | Close-up cut of the ledger counter (red flash). |
| 4 | 1:05-1:30 | Stacked chaos on lane 5, Lich boss, recovery bonus | `?demo=full` | 25 s. |
| 5 | 1:30-1:50 | Lane popup: attempts, recovery time, downtime. Star ratings | `?demo=meltdown` (mock) | Open the popup on a failed stage. |
| 6 | 1:50-2:20 | Loop: report with grade and findings, reviewer spec, Kiro applies fix, wave 2 grade up | `?demo=loop`, then live terminal for the Kiro step | Record the Kiro step as one unbroken take. Wave 2 grade must be what the run shows. |
| 7 | 2:20-2:40 | Agent calls `haunt_sweep` on a new workflow, graded report returns | Terminal or agent chat | Large font (18 pt+), 127.0.0.1 only. |
| 8 | 2:40-2:55 | Python inbox app in the same arena, scorecard badge | `inbox` fixture or live | Show the badge for 3 s. |
| 9 | 2:55-3:00 | End card: hosted demo URL, repo URL, "Built with Kiro" | Static card | Fill URLs only after publishing. |

## Script

Voice and caption text per segment is the table in `docs/DEMO-SCRIPT.md`. Do not fork it. Edit that file if wording changes. Read pace about 150 words per minute. Total spoken text must fit the times above.

## Claims check (say only what the evidence shows)

- "Rookie: 2 charges. Phoenix: 1." comes from the hero run ledger. Show the counter.
- "Every event is real": true only for real runs. In demo mode the label "Recorded run" must be visible.
- "Kiro applies the fix live": only if scene 6 is a live run. Otherwise "recorded fix".
- "F to A": only with the live proof. Otherwise state the actual grades shown.

## Capture method

1. Serve the build on 127.0.0.1 (`npm run ui:build`, then preview). No external network.
2. Record each scene as a separate clip (OBS or Windows Game Bar). One take per scene, 2 s pad at both ends.
3. Name clips `scene-1-receipt` to `scene-9-endcard`.
4. Edit together, total under 3:00. Burn captions in using the same text the hosted demo shows (CC track), inside the safe area (about 5% margin).
5. Audio: voice only, normalized. No music, or code-generated music.

## Publish steps (the owner only)

1. Export 1080p MP4, captions burned in.
2. Upload unlisted. Check playback, captions legibility on a phone, total length under 3:00.
3. Make public at submission time, and put the link in the Devpost draft.

## Fallback

If a live scene fails on camera, use demo mode (it replays real recorded events) and show the "Recorded run" label. Never present a replay as live.

## Checklist before upload

- [ ] Hook in the first 5 s
- [ ] Hero numbers visible (2 vs 1)
- [ ] Loop scene labelled correctly (live or recorded)
- [ ] No brand logos, no personal or company names
- [ ] Length under 3:00
- [ ] Captions burned in, readable on a phone
