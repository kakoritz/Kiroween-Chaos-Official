# Kiroween Chaos: 3-minute demo video (first draft)

Total 2:50.15 (limit 3:00), 413 narration words, Kokoro-82M voice `af_heart` at speed 1.0. Generated from `tools/scenes.json`; do not edit the table by hand, edit the JSON and rebuild.

Tagline: Chaos engineering for AI agents, played as a haunted house.

Honesty rules: every capture is recorded footage and says so in the caption or voice-over. The tournament, Casebook and Patterns scenes come from the hosted build, which replays recorded runs of the real engine and shows its own Recorded run banner. The fix is recorded, not applied live (`docs/proof/live-fix.md`). No streaming app and no 11-stage Ticket Desk claim.

| # | Time | Dur | Source | On-screen action | Caption (burned in) |
|---|---|---|---|---|---|
| 1 s01-open | 0:00.00 | 26.2s | capture:splash | Title splash (real splash screen), then Skip into the arena with the hero demo running behind it. Recorded. | Kiroween Chaos: chaos engineering for AI agents, played as a haunted house. |
| 2 s02-tournament | 0:26.25 | 24.1s | capture:hero | Local engine hero demo (?splash=0), real child processes and provider, recorded for this video. | Scripted hero demo, recorded for this video. Repo test: Rookie 2 charges, Phoenix 1. |
| 3 s03-dial | 0:50.30 | 17.2s | capture:dial | Local live arena, recorded: Start tournament, INTENSITY dial to 11, crashes and curse chips. | Intensity 11: THROW EVERYTHING. Curses follow a lane. |
| 4 s04-casebook | 1:07.47 | 10.2s | still:11-casebook.png | Casebook still (Round-3 card with casebook table) from submission/gallery, slow zoom. | The Casebook: every edge case, who solved it, how, and what it cost. |
| 5 s05-patterns | 1:17.65 | 17.9s | capture:patterns | Hosted build (recorded run banner visible): Patterns table of recurring problems, Write fix spec, Improve loop at its rerun step. | Patterns and the improve loop: a projection with simulated parts, not patched code running. |
| 6 s06-fix | 1:35.55 | 17.6s | still:12-grade-f-to-a.png | Grade F to A still (top: recorded run, bottom: labelled simulation), caption states the fix is recorded. | RECORDED fix (docs/proof/live-fix.md): wave 1 grade F, wave 2 grade A. Not applied live. |
| 7 s07-python | 1:53.12 | 18.5s | capture:inbox | Header app switcher to Haunted Inbox (Python Ticket Desk), run a wave, ticket and reply rows in the ledger. | Second app: Python Ticket Desk. Same harness, no engine change. |
| 8 s08-lab | 2:11.65 | 13.7s | capture:lab | Workflow Lab with the streaming preset. | Workflow Lab: model-based what-if. The streaming pack has no runnable app. |
| 9 s09-arch | 2:25.38 | 15.8s | still:architecture.svg | docs/img/architecture.svg, slow zoom. | One skeleton, three apps. Built with Kiro specs, steering, hooks and Kiro Crew. |
| 10 s10-end | 2:41.12 | 9.0s | card:end | End card: name, tagline, repo URL, Pages URL. | github.com/kakoritz/Kiroween-Chaos-Official |

## Narration (exact text)

**1. s01-open** (0:00.00, voice 24.6s)

Charged. Charged again. Companies are pushing AI agents to production faster than ever, and fast code gets far less stress testing. One principal automation engineer wanted chaos engineering for bots, built as a game that does real testing in the background, on a monitor in the TechOps room. This is Kiroween Chaos: chaos engineering for AI agents, played as a haunted house.

**2. s02-tournament** (0:26.25, voice 22.4s)

Five bots take the same crashes. Ghosts drop calls, reapers kill processes, and a separate ledger, the provider's own record, keeps score. This is a scripted demo run, recorded for this video. A process crashes right after charging a customer. In the repo's test, Rookie ends with two charges. Phoenix replays its journal and ends with one.

**3. s03-dial** (0:50.30, voice 15.5s)

Press next wave, then turn the intensity dial up to eleven. Eleven means throw everything: every stage takes a hit. And curses follow a lane. A lying endpoint. A slow one. A flaky server that only fails some of the time.

**4. s04-casebook** (1:07.47, voice 8.5s)

At the end comes the podium, the awards, and the prize: the Casebook. Every edge case, who solved it, how it was solved, and what it cost.

**5. s05-patterns** (1:17.65, voice 16.2s)

The pattern miner clusters what keeps happening and writes a fix spec for a human to review: evidence, the smallest patch, and a test. The improve loop reruns the same seed, but read it as a projection with simulated parts. It is not patched code running.

**6. s06-fix** (1:35.55, voice 15.9s)

Kiro is meant to apply that spec, with a review step. The fix on screen is recorded, written ahead of time to satisfy the spec, not applied live. On the crash-only plan, wave one grades F, and wave two, with the spec's parts added, grades A.

**7. s07-python** (1:53.12, voice 16.8s)

Then switch the header to a second app, written in Python: the Ticket Desk. It reads mail, files a ticket, and sends a reply. The same crash that double charged a customer now shows up as a duplicate ticket. Same harness, same creatures, no engine change.

**8. s08-lab** (2:11.65, voice 12.0s)

The Workflow Lab lets you model your own workflow and grades a what-if, with the parts that would fix it. A streaming preset is included, but it is model-based. There is no runnable streaming app.

**9. s09-arch** (2:25.38, voice 14.1s)

One skeleton, two interchangeable apps, Node Orders and Python Ticket Desk. Failure data goes to AI to draft spec-driven fixes, and a human reviews every one. It was built with Kiro and Kiro Crew.

**10. s10-end** (2:41.12, voice 7.3s)

Break your bots before the world does. Kiroween Chaos. The repository and the hosted demo links are on screen.
