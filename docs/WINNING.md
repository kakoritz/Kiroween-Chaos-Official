# How we win Kiroween 2026

Source: the official rules and Devpost page, read 2026-11-20. Re-read before submitting.

## Hard facts

- **Deadline: Dec 4, 2026, 5:00 pm EST** (2:00 pm PT). No extensions. Submit by **Dec 3**.
- **Kiro credits:** 4,000 each. Request form due **Dec 1, 12:00 pm PT**. Do it now.
- **New project only.** Built after Oct 30, 2026. This repo started Nov 20. Disclose any pre-existing code. We use none.
- **Repo must be public on GitHub with an open source license** visible in the About box. Currently private. Flip it before submitting.
- **`.kiro/` must be at the repo root and never in `.gitignore`.** Ignoring it can disqualify us.
- **Video:** under 3 minutes, public on YouTube, no copyrighted music or third party trademarks.
- **Required fields:** app URL, text description, video, repo URL, category, and a **write-up on how Kiro was used**.
- **"Insufficient use of Kiro" is a disqualification.** Stage One is pass or fail: fits the theme and applies Kiro.
- **Stage Two: five criteria, 20% each (10 points):** Potential Impact, Technological Implementation (Kiro use), Design, Innovation/Idea, Presentation.
- **Overall prizes (1st, 2nd, 3rd) go to the top scores across all categories.** Category only decides the category prize.
- **Judges may not run the app.** They may judge from the text, images and video alone. So the video and a no-install live URL carry the score.

## Category: Frankenstein (the owner's choice)

> "Stitch together a chimera of technologies into one app. Bring together seemingly incompatible elements to build something unexpectedly powerful."

Judges must see **stitching**, so the chimera is the pitch and the visual theme, not a side note.

**The parts we stitch (each looks incompatible with the others):**

| Part | From | Why it looks wrong together |
|---|---|---|
| Chaos monkeys | Chaos engineering (infrastructure testing) | Built for servers, not for arcade games |
| Race arena with progress bars and cheering sprites | Cooking-game style video games | Games are for fun, ops tools are boring |
| Journal, idempotency keys, reconcile | Durable execution (workflow engines) | Heavy back-end theory in a toy |
| Real process kills and Web Worker kills | OS processes and browsers | Two runtimes, one contract |
| Node engine plus Python AI agent | Two languages | Different worlds, one harness |
| A reviewer that writes specs, and Kiro that applies them | AI code generation | Tests that fix themselves |
| MCP server, Kiro Power, Kiro Crew app | Kiro platform pieces | Three packagings of one tool |

**Make the Frankenstein theme literal in the product:**
- Each bot is a **creature stitched from resilience parts**: Journal, Idempotency Keys, Retry, Circuit Breaker, Offline Queue.
- The Rookie is a bare skeleton with exposed stitches. Phoenix is fully assembled.
- When Kiro applies a hardening spec, the UI **stitches a new limb onto the creature** with a lightning flash. The score climbs. This is the loop-proof moment, drawn as a mad-scientist lab.
- Sound: crackle, thunder, a "It's alive!" sting on resume. All generated in code.
- Monkeys are the mob with torches, or the lab accident. Bosses are storms.

**Why it can win overall, not just the category:** the 1st, 2nd and 3rd places go to the top scores across all categories. Frankenstein gives us a clear Innovation story and a strong Design story at once.

Skeleton Crew is dropped. Its "two apps in two folders" rule no longer applies. We still keep Haunted Inbox (Python) because a second app proves the chimera is reusable.

## Bonus prizes to collect (all are separate and stackable)

| Prize | What it needs | Owner |
|---|---|---|
| **Best Kiro Crew App** | A Kiro Crew app, new in the period, public GitHub repo, feature write-up. Haunt ships as a Kiro Crew app (page, MCP tools, agent, skill). | Both |
| **Best Demo** | A strong video. | Both |
| **Bonus Blog** | Public blog post on a third-party platform, mentions Kiroween 2026, links in the form. | the owner |
| **Social Blitz** | Post starting with `#KiroweenHackathon26`, favorite thing about Kiro and how it changed your approach, link in the form. | the owner |
| **Best Ghost of Kiroween Past** | Only if the owner registered for Kiroween 2025. Ask him. | the owner |
| Best Startup Project | Only if the owner is a founder and wants to enter a startup. Skip unless he says so. | the owner |

## The two applications (proof the chimera is reusable)

| | App 1: Haunted Orders | App 2: Haunted Inbox |
|---|---|---|
| Domain | E-commerce order pipeline | AI agent that triages email, files tickets, sends replies |
| Language | Node + TypeScript | **Python**, a different stack |
| Adapter | SDK | Proxy + Process |
| Side effects | charge, email, dispatch | ticket created, reply sent |
| Why it matters | The classic double-charge | The 2026 problem: AI agents repeat actions after a crash |

Both run in the same arena, with the same monkeys, the same report. Two unrelated apps through one harness, in two languages, is the chimera proof.

## What makes a judge say "this is amazing"

1. **A real problem everyone has felt.** Double charges, duplicate emails, agents that redo work after a crash. Stage One framing: "Chaos engineering for automation and AI agents, as a game".
2. **A single unforgettable moment.** The process is killed right after the charge. Rookie charges twice. Phoenix charges once. The ledger flashes. Same crash, side by side.
3. **A closed loop with proof.** Run a wave. The reviewer writes a hardening spec. **Kiro implements the spec.** Run the wave again. The score goes from F to A on screen. Nobody else will show Kiro improving the code from chaos evidence.
4. **Real, not fake.** Real kills, real ledger, real numbers. Every animation is driven by an event.
5. **Reusable in 60 seconds.** `haunt.yaml` plus one command on a second app.
6. **No install to judge.** A hosted browser version (see below).

## Kiro usage plan (maps to the write-up checklist)

| Rubric item | What we do |
|---|---|
| IDE, CLI, Web, Crew | Lane A in Kiro CLI and Crew, Lane B in the IDE and Crew. Write what each was best at. |
| Custom agents | `chaos-director` and `reviewer` agents, defined in `.kiro/agents/`. |
| Agent hooks | On save of `packages/core/sdk/**` run property tests. On save of `contract/**` validate fixtures. On wave end, run the reviewer. |
| Spec-driven development | Every feature has requirements, design, tasks. Show a spec turned into code, and compare with vibe coding. |
| Steering docs | `.kiro/steering/` for product, tech, contract rules and the "truth comes from the ledger" rule. |
| MCP | `haunt-mcp`: tools `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report`. Any Kiro agent can stress test a workflow while building it. |
| Property-based testing | `fast-check`: for any crash point and any step, ledger side-effect count equals 1. Highlight bugs it found. |
| Powers | Package Haunt as a Kiro Power: stress testing best practices plus the MCP server. |
| Crew app | Haunt as a Kiro Crew app: arena page, MCP tools, reviewer agent, skill `stress-test-my-workflow`. |

Keep a running `docs/KIRO-LOG.md`: dated notes of what Kiro did well, where it failed, and what we changed. Real specifics beat claims.

## No-install demo for judges

Two targets, one contract:

- **Live target** (local): child processes, real SIGKILL, SQLite. Used for the video's heavy runs and for the CLI report.
- **Browser target** (hosted on GitHub Pages): the same engine, bots run in Web Workers, "crash" is `worker.terminate()` (a real kill), journal and ledger live in the page. Contract `mode: "browser"`. Judges open a URL, click Chaos, see it work.

This costs extra work in Lane A (adapter swap) and none in Lane B.

## Submission checklist

- [ ] Kiro credit request filed (by Dec 1, noon PT)
- [ ] Repo public, MIT license visible, `.kiro/` committed, not ignored
- [ ] App folders: `apps/haunted-orders`, `apps/haunted-inbox` (not required for Frankenstein, but proves reuse)
- [ ] Hosted demo URL works with no login
- [ ] Video under 3:00, public on YouTube, own music or none, no trademarks
- [ ] Write-up covers every Kiro item in the table above
- [ ] Category set to **Frankenstein**, plus Best Kiro Crew App
- [ ] Blog post published, link added
- [ ] Social post with `#KiroweenHackathon26` first, link added
- [ ] Fresh-clone test: clone, install, `npm run demo` in under 3 minutes
- [ ] Draft saved on Devpost by Dec 2, final submit Dec 3

## Timeline (14 days, with a one-day buffer)

| Days | Lane A (Core) | Lane B (Visuals) |
|---|---|---|
| Nov 20-21 | H0 contract, fixtures, mock server | Starts arena against mock |
| Nov 22-25 | Engine, hero crash, monkeys, SDK, PBT | Race, stages, monkeys, inspector |
| Nov 26-29 | Harness modes, report, reviewer loop, App 2 | Report viewer, scoring UI, bosses, Crew app page |
| Nov 30-Dec 1 | Browser target, MCP, Power, hardening loop proof | Polish, sound, demo mode |
| Dec 2 | Freeze. Fresh-clone test. Record video. | Freeze. Record video. |
| Dec 3 | Submit | Submit |
| Dec 4 | Buffer only | Buffer only |

**Cut rule:** at the end of Nov 29 anything not working is cut. The hero crash, the arena, the report, the loop proof, and the video are never cut.

## Risks

| Risk | Plan |
|---|---|
| Too big for 14 days | Cut line in each tasks file. Hero path first. |
| Judges skip the app | Video does all the work. Hosted demo needs no install. |
| "Insufficient Kiro use" | KIRO-LOG, hooks, agents, MCP, Power, specs, steering, PBT, all visible in `.kiro/`. |
| Contract drift between lanes | Contract PRs need both approvals. Mock first. |
| Visuals look like a prototype | Lane B owns polish from day 3. Sound, motion, consistent palette. |
