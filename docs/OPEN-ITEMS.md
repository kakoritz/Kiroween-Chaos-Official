# Open items and decisions

Defaults are chosen so nobody is blocked. Change a default by editing this file in a PR.

## Needs the owner (human only)

| # | Item | Why | Due |
|---|---|---|---|
| 1 | Register for the hackathon: click **Join hackathon** on kiroween.devpost.com | Required to submit. Needs a Devpost account. | Now |
| 2 | File the **Kiro credit request** form (4,000 credits each, include Kiro user ID) | Credits expire if not redeemed by Dec 4. Review takes 48 business hours. | **Dec 1, 12:00 pm PT** (sooner is safer) |
| 3 | Did you register for Kiroween 2025? | Unlocks "Best Ghost of Kiroween Past". | Before submit |
| 4 | Create or confirm a **YouTube** channel for the demo video | Video must be public on YouTube | Dec 1 |
| 5 | Pick a **blog platform** (dev.to, Medium, Hashnode) | Bonus Blog prize needs a public post that mentions Kiroween 2026 | Dec 2 |
| 6 | Social post account (X or LinkedIn) | Social Blitz: post must start with `#KiroweenHackathon26` | Dec 2 |
| 7 | Confirm **the second owner account** account is who runs Lane B and that it can push to the repo | Collaborator invite was accepted | Now |
| 8 | Final go to make the repo **public** and set category and bonus checkboxes | Irreversible publication | Dec 2 |
| 9 | Eligibility check: read section 3 of the official rules (employment, family, residency) | Conflict of interest would disqualify | Now |

## Decisions already made (defaults)

| Decision | Choice |
|---|---|
| Category | Skeleton Crew |
| Name | Haunt (product), Kiroween-Chaos (repo) |
| Theme | Skeleton workers, spooky creatures, crypt |
| Storage | JSONL, no SQLite |
| App 2 | Python Haunted Inbox, 2 lanes minimum |
| License | MIT, copyright kakoritz |
| Reviewer | Rule-based offline; optional LLM only if a key is set; never edits code |
| Browser target | Required: hosted demo via GitHub Pages |
| Kiro "fix" in browser target | A recorded real fix, labelled as recorded |

## Research tasks (Lane A, by Nov 24)

| # | Question | Where to look |
|---|---|---|
| R1 | What is the exact format for a Kiro Crew app (manifest, MCP tools, agents, skills, pages)? | Kiro Crew docs `apps.md` in the install folder, `kirocrew app` CLI, and the Kiro Crew app examples that ship with it |
| R2 | What is the format for a Kiro Power? | kiro.dev docs |
| R3 | What is the format for `.kiro/agents/*.md|json` and `.kiro/hooks/*`? | kiro.dev docs, existing hook examples |
| R4 | Does Kiro have a built-in property-based testing helper we should use besides `fast-check`? | kiro.dev docs |

If a format cannot be confirmed by Nov 25, ship the item as documentation plus a working MCP server and cut the packaging.

## Known risks to watch

- Real SIGKILL on Windows kills the process tree differently. Test early (task H1.4).
- Browser target and `worker.terminate()`: the journal must live in the main thread. Test early (H6.3).
- Fixtures drift from the live engine. `npm run test:contract` runs both against the same suite.
- Two sessions on one machine: keep clones apart and avoid running heavy test suites at the same time.

## Lane A: fix after H0 merges

- Event validator violations. A read-only run of the H0 validator against live output (npm run live) reported more than 500 event violations. The real validator lives in the unmerged H0 contract PRs (#2 to #7), so validate:events on main is still a stub. After H0 merges, Lane A runs the real validator against live output and fixes the engine and runtime emitters until it reports 0 violations.
