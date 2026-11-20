# Demo video script (target 2:50, hard limit 3:00)

Rules: public YouTube, no copyrighted music, no trademarks (do not show Stripe, Shopify or similar logos). Music is generated in code or none. Record on the real device. Captions on.

| Time | On screen | Voice |
|---|---|---|
| 0:00-0:15 | Black screen, a receipt. Red text: "Charged. Charged again." | "Automations crash halfway through. Then they do the work twice. Your customer pays twice." |
| 0:15-0:30 | Haunt arena loads: a haunted crypt, five skeleton lanes, spooky creatures | "This is Haunt: chaos engineering for automation and AI agents, played as a game." |
| 0:30-1:00 | Race starts. Eight stages. Cheers, progress bars. Pause on Payment | "Five bots process the same orders. Each has more protection than the last." |
| 1:00-1:30 | Click Chaos on lane 1 and lane 5 at Payment. Reapers strike. Skeletons collapse into bones. Both die after the charge. Ledger: Rookie 2, Phoenix 1 | "Same crash, right after the charge. The Rookie charges again. Phoenix reassembles, finds its own charge and carries on." |
| 1:30-1:50 | Hit lane 5 three times. Nest counter 3. Survives. Score jumps. Boss banner: Power Outage, all lanes hit | "Stack the chaos. Phoenix still recovers. Then a boss hits everything at once." |
| 1:50-2:10 | Click a failed stage. Popup log in game style | "Every stage is inspectable. Pass, fail, in progress. Every event is real." |
| 2:10-2:35 | Report: grade F, coverage matrix, load curve. Reviewer writes a hardening spec. Kiro applies it. Re-run. Grade F to A | "The reviewer turns failures into a spec. Kiro builds it, and the Rookie skeleton equips new gear. Run it again. F to A." |
| 2:35-2:50 | Second app: a Python AI inbox agent in the same arena. `haunt.yaml` on screen | "Haunt is the skeleton. Here it crews a second app, a Python AI agent. Plug in your own." |
| 2:50-3:00 | Title card: repo, URL, "Built with Kiro" | "Haunt. Try to break your bots before the world does." |

## Shots to capture ahead of time

- Clean 1080p screen capture of the full arena run (use demo mode, scripted).
- Close-up of the ledger counter flashing red.
- Terminal: `haunt sweep` printing the grade.
- Kiro applying the hardening spec, sped up.
- Before and after report side by side.

## Rehearsal rule

Record only after a fresh-clone test passes. If the live run fails on camera, use demo mode, which replays real recorded events.

## Which demo script produces which part of the video

| Video time | Source |
|---|---|
| 0:00 to 0:15 | Title cards (made in the arena's present mode, no script) |
| 0:15 to 1:30 | `hero` (calm race, then the Payment crash on lanes 1 and 5) |
| 1:30 to 1:50 | `full`, stacked chaos and the Lich boss part |
| 1:50 to 2:10 | Inspector popup, recorded live in the arena (no script) |
| 2:10 to 2:35 | `loop` (report, hardening spec, Kiro applies the fix, grade F to A) |
| 2:35 to 3:00 | Inbox app (`inbox` fixture or live) and the closing card |

Record the segments separately and edit them together. Keep every segment under the 3:00 total.
