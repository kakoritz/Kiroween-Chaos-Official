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

- Event validator violations. The real H0 validator is on main and npm run validate:events runs it. A read-only run against live output (npm run live) reported more than 500 event violations before H0 merged. Lane A runs npm run validate:events against live output and fixes the engine and runtime emitters until it reports 0 violations. Status 2026-11-22 (`npm run e2e` stream, 11 waves, checked per wave): still hundreds of violations, mostly the validator not knowing the V1_2 inbox stage list (R19), parked and resumed orders (R3, R23, `order_resumed` without `stage`), `order_failed` without `stage`, `process_up` earlier than `restartInMs` at speed 4 (R6), and `curse_end` for an unknown curse (R66). `npm run e2e` prints this check as informational until this item is closed.

## Added 2026-11-21 (needs the owner)

| # | Item | Why |
|---|---|---|
| 10 | Fix GitHub Actions billing or make the repo public | CI jobs do not start; blocks the fresh-clone gate and the Pages demo |
| 11 | Pick the tagline and approve the one story (`onboarding` section 2) | Presentation |
| 12 | CI policy for the sweep Action: opt-in example, not a required check | `share` section 3 |
| 13 | Approve scope: world events (PT-C7) and wrong-order decisions (PT-C8) are optional extras after the must-have list | `playtest-v2` cut line |
| 14 | Approve the campaign scope (nights 1, 2, 5 first) | `campaign` cut line |
| 15 | Approve the tournament format (5, 4, 3, 2 lanes, one drops per round) and the intensity table | `tournament-v3` sections 3 and 5 |
| 16 | Approve packs and production mode as optional after the must list | `packs` cut line |