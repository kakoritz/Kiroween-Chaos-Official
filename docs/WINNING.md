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

## Category: Skeleton Crew

> "Build a skeleton code template lean enough to be clear but flexible enough to support various use cases. Show us its versatility with two distinct applications from your foundation." The repo must contain **2 separate repo folders for the 2 applications**.

Haunt is exactly this: a lean skeleton (the harness) and two different apps built on it. The name is literal too: the workers are skeletons, and Haunt is the crew that runs them.

**Theme: the Skeleton Crew vs the Haunting**
- The five lane bots are **skeleton workers** processing orders. Orders arrive as parchment scrolls.
- Chaos is done by **spooky creatures**, not animals (see the creature table in the contract). A Reaper kills the process, a Zombie slows the link, a Ghost makes a record vanish, a Goblin hoards your rate limit, a Witch hexes the data.
- Bosses: the Lich (power outage), the Banshee Queen (internet outage), the Headless Horseman (hazard storm).
- A crash makes the skeleton **collapse into a pile of bones**. A successful resume makes it **reassemble** and rattle on. This is the hero moment.
- Each skeleton wears **gear** for its resilience: Spellbook (Journal), Seal (Idempotency Keys), Lantern (Retry), Shield (Circuit Breaker), Coffin Stash (Offline Queue). The Rookie is a bare skeleton. Phoenix is fully geared. When Kiro applies a hardening spec, a new piece of gear is equipped on screen.

Frankenstein was considered and dropped. Skeleton Crew matches the structure of the project better, and the overall prizes ignore category anyway.

## Bonus prizes to collect (all are separate and stackable)

| Prize | What it needs | Owner |
|---|---|---|
| **Best Kiro Crew App** | A Kiro Crew app, new in the period, public GitHub repo, feature write-up. Haunt ships as a Kiro Crew app (page, MCP tools, agent, skill). | Both |
| **Best Demo** | A strong video. | Both |
| **Bonus Blog** | Public blog post on a third-party platform, mentions Kiroween 2026, links in the form. | the owner |
| **Social Blitz** | Post starting with `#KiroweenHackathon26`, favorite thing about Kiro and how it changed your approach, link in the form. | the owner |
| **Best Ghost of Kiroween Past** | Only if the owner registered for Kiroween 2025. Ask him. | the owner |
| Best Startup Project | Only if the owner is a founder and wants to enter a startup. Skip unless he says so. | the owner |

## The two applications (Skeleton Crew requirement)

| | App 1: Haunted Orders | App 2: Haunted Inbox |
|---|---|---|
| Domain | E-commerce order pipeline | AI agent that triages email, files tickets, sends replies |
| Language | Node + TypeScript | **Python**, a different stack |
| Adapter | SDK | Proxy + Process |
| Side effects | charge, email, dispatch | ticket created, reply sent |
| Why it matters | The classic double-charge | The 2026 problem: AI agents repeat actions after a crash |

Both run in the same arena, with the same creatures, the same report. Two unrelated apps through one harness, in two languages, is the Skeleton Crew proof.

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
- [ ] **Two separate app folders** (required for Skeleton Crew): `apps/haunted-orders`, `apps/haunted-inbox`
- [ ] Hosted demo URL works with no login
- [ ] Video under 3:00, public on YouTube, own music or none, no trademarks
- [ ] Write-up covers every Kiro item in the table above
- [ ] Category set to **Skeleton Crew**, plus Best Kiro Crew App
- [ ] Blog post published, link added
- [ ] Social post with `#KiroweenHackathon26` first, link added
- [ ] Fresh-clone test: clone, install, `npm run demo` in under 3 minutes
- [ ] Draft saved on Devpost by Dec 2, final submit Dec 3

## Timeline (14 days, with a one-day buffer)

| Days | Lane A (Core) | Lane B (Visuals) |
|---|---|---|
| Nov 20-21 | H0 contract, fixtures, mock server | Starts arena against mock |
| Nov 22-25 | Engine, hero crash, creatures, SDK, PBT | Race, stages, creatures, inspector |
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
