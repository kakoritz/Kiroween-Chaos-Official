# Submission checklist

Source: `docs/WINNING.md` (official rules read 2026-11-20) and `docs/WIN-REVIEW.md`. Re-read the Devpost rules page before submitting. Status as of 2026-11-22 on branch `stack/tv3`. `[x]` means done and verifiable in the repo; `[ ]` means open. **OWNER** means only the account owner can do it.

**Key dates.** Kiro credit request: **Dec 1, 12:00 pm PT**. Deadline: **Dec 4, 2026, 5:00 pm EST** (2:00 pm PT), no extensions. Plan to submit **Dec 3**; save a draft by Dec 2.

## Hard rules (disqualification risks)

- [ ] **OWNER** Repo is public on GitHub (currently private).
- [x] OSI license in the repo: MIT (`LICENSE`, `package.json`). [ ] **OWNER** License shows in the repo About box after the repo is public.
- [x] `.kiro/` is at the repo root with specs, steering, hooks and agents, and is not in `.gitignore` (`.gitignore` should be re-checked on the final commit).
- [ ] **OWNER** Video under 3:00, public on YouTube, no copyrighted music, no third-party trademarks.
- [x] New project: first commit 2026-11-20, after the Oct 30 cutoff. No pre-existing code is used.
- [ ] **OWNER** Eligibility check against the rules (section 3) done.
- [ ] **OWNER** Joined the hackathon on Devpost.
- [ ] **OWNER** 4,000 Kiro credits request filed by **Dec 1, 12:00 pm PT**.
- [ ] Category set to **Skeleton Crew**; two app folders present: `apps/haunted-orders` (Node) and `apps/haunted-inbox` (Python). [x] folders exist and both run through the harness.

## Devpost fields

| Field | Source | Status |
|---|---|---|
| Project name and tagline | `docs/DEVPOST-DRAFT.md` | [x] drafted, **OWNER** approves |
| Category | Skeleton Crew | [ ] **OWNER** select |
| What it does, Inspiration, How we built it, Challenges, Accomplishments, Learned, What's next | `docs/DEVPOST-DRAFT.md` | [x] drafted, **OWNER** approves |
| Built with | `docs/DEVPOST-DRAFT.md` | [x] |
| Try it URL (app URL, no login) | hosted build: `npm run build:hosted`, output `dist/hosted`, target GitHub Pages | [ ] **OWNER** publish (needs a public repo) and paste the URL |
| Repo URL | github.com/kakoritz/Kiroween-Chaos | [ ] **OWNER** after it is public |
| Video URL | `docs/DEMO-SCRIPT.md`, `docs/VIDEO-PLAN.md` | [ ] **OWNER** record, upload, paste |
| Kiro write-up (how Kiro was used) | `docs/KIRO-WRITEUP.md` | [x] drafted. **OWNER** lines in it still open |
| Image gallery | `docs/proof/ui-tv3/*.png`, `docs/img/architecture.svg`, scorecard from `haunt badge` | [ ] **OWNER** upload |
| Draft saved by Dec 2, submitted by Dec 3 | | [ ] **OWNER** |

## Judge-facing quality

- [x] README front page: hook, story, status table, quick start, architecture, Skeleton Crew fit, Kiro usage.
- [x] Architecture diagram: mermaid in the README and `docs/img/architecture.svg`.
- [ ] Hosted demo opens with no login and no install (a build exists, not published).
- [ ] `npm run fresh-clone` passes on Windows and on Linux (**OWNER** to run on both).
- [ ] CI shows green: CI is manual only because GitHub billing blocks jobs. **OWNER** fix billing, or accept a red or grey badge (the README has no CI badge).
- [x] Claims match evidence: recorded fix labelled "recorded" (`docs/proof/live-fix.md`); Ticket Desk full flow, streaming pack and production mode marked "not built".
- [ ] Live Kiro applies a generated fix spec, with transcript and diff saved in `docs/proof/` (SH-C4). Needed before saying "Kiro applied the fix live" or "F to A".
- [ ] Kiro Power imported into the Kiro IDE and Crew app installed (SH-K3), with screenshots in `docs/proof/installed/`. **OWNER** (changes the owner's own Kiro setup).
- [ ] Remove or update stale text: `docs/JUDGES.md` and `docs/DEV-SETUP.md` still describe the 8-stage order and 3 hooks.

## Bonus prizes

| Prize | Needs | Status |
|---|---|---|
| Best Kiro Crew App | Crew app in `kiro-crew-app/`, new in the period, public repo, feature write-up | [x] package exists (manifest handshake proven). [ ] installed in Kiro Crew and screenshot. [ ] feature write-up in Devpost |
| Best Demo | A strong video | [ ] **OWNER** record per `docs/DEMO-SCRIPT.md` |
| Bonus Blog | Public post on a third-party platform that mentions Kiroween 2026, link in the form | [x] `docs/BLOG-DRAFT.md`. [ ] **OWNER** publish and paste the link |
| Social Blitz | Post starting with `#KiroweenHackathon26`, link in the form | [x] three variants in `docs/SOCIAL-DRAFT.md`. [ ] **OWNER** post and paste the link |
| Ghost of Kiroween Past | Only if registered for Kiroween 2025 | [ ] **OWNER** decide |
| Best Startup Project | Only for a founder entering a startup | skip unless the owner says so |

## Final pass (Dec 2 to 3)

- [ ] **OWNER** Fill every `TO FILL` and `TO VERIFY` in `docs/DEVPOST-DRAFT.md`.
- [ ] **OWNER** Open the Devpost page logged out and click every link.
- [ ] **OWNER** Confirm the public repo has the latest `main` with `.kiro/` visible.
- [ ] **OWNER** Submit. Keep the confirmation.
