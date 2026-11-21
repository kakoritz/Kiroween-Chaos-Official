# Demo video script v2 (target 2:55, hard limit 3:00)

Structure source: `.kiro/specs/onboarding/spec.md` section 8. Story source: section 2 of the same spec. The owner records and approves the wording.

One story: hook "Charged. Charged again.", number "Rookie: 2 charges. Phoenix: 1.", tagline "Break your bots before the world does."

Rules: no copyrighted music, no trademarks (do not show payment or shop brand logos). Music is generated in code or none. Record on the real device. Captions burned in (the same captions the hosted demo shows). Every claim says exactly what the evidence shows. Say "F to A" only if the live Kiro fix is real (`.kiro/specs/share/spec.md` section 5). Otherwise say "recorded fix".

| Time | On screen | Voice and captions |
|---|---|---|
| 0:00-0:05 | Black screen, a receipt. Red text: "Charged. Charged again." | "Charged. Charged again." |
| 0:05-0:25 | Title splash, then the first lap: door ceremony, stars, lanes. It looks like a game at once | "Automations and AI agents crash halfway through, then repeat their side effects. Haunt is chaos engineering, played as a game." |
| 0:25-1:05 | Hero crash on lanes 1 and 5 at Payment. Callout "SAME CRASH". Ledger flashes. Callout "Rookie: 2 charges / Phoenix: 1 charge" | "Same crash, right after the charge. The Rookie charges again. Phoenix replays its journal, finds its own charge and carries on." |
| 1:05-1:30 | Stacked chaos on lane 5 and the Lich boss. Recovery bonus appears | "Stack the chaos. Phoenix still recovers, and a recovery bonus pays out. Then a boss hits every lane." |
| 1:30-1:50 | Lane popup: attempts, recovery time, downtime. Star ratings | "Every lane is inspectable: attempts, recovery time, downtime. Every event is real." |
| 1:50-2:20 | The loop: report with grade and findings, reviewer writes the spec, Kiro applies the fix live, wave 2 grade improves | "The reviewer turns the failures into a spec. Kiro applies the fix. Run it again and the grade improves." |
| 2:20-2:40 | MCP scene: a Kiro agent calls `haunt_sweep` on a new workflow and gets a graded report | "Plug in your own process. A Kiro agent calls Haunt over MCP and gets a graded report." |
| 2:40-2:55 | Python inbox app in the same arena, scorecard badge | "Haunt is the skeleton. A second app, a Python AI inbox agent, runs in the same arena." |
| 2:55-3:00 | End card: hosted demo URL, repo URL, "Built with Kiro" | "Haunt. Break your bots before the world does." |

## Shots to capture ahead of time

- Clean 1920x1080 capture of the title splash and the first lap (`?demo=hero`).
- The hero crash with captions and callouts on. Use `?freeze=hero-crash` to hold the frame for 2 s if needed.
- Close-up of the ledger counter flashing red.
- Lane popup on a failed stage (`?demo=meltdown` in mock mode).
- The live loop: report, spec, Kiro applying the fix, wave 2 report. Needs the live Kiro fix to exist first.
- Terminal or agent chat showing the `haunt_sweep` MCP call.
- The inbox app in the arena and the scorecard badge.

## Rehearsal rule

Record only after a fresh-clone test passes. If the live run fails on camera, use demo mode, which replays real recorded events, and label it "Recorded run".

## Which demo script produces which part of the video

| Video time | Source |
|---|---|
| 0:00 to 0:05 | Title card (arena present mode, no script) |
| 0:05 to 0:25 | Title splash and the start of `hero` |
| 0:25 to 1:05 | `hero` (Payment crash on lanes 1 and 5, with callouts) |
| 1:05 to 1:30 | `full` (stacked chaos, Lich boss) |
| 1:30 to 1:50 | Lane popup on the `meltdown` fixture |
| 1:50 to 2:20 | `loop` (report, spec, Kiro fix, wave 2) |
| 2:20 to 2:40 | MCP scene (recorded terminal or agent chat) |
| 2:40 to 3:00 | Inbox app (`inbox` fixture or live) and the end card |

Record the segments separately and edit them together. Keep the total under 3:00.
