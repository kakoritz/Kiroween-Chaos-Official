# Win review: where we stand against the judging rubric

Date: 2026-11-21. Method: an independent three-judge read (product and impact, Kiro and AI tooling, design) of the repo and the running game's screenshots, scored against the official Devpost rubric. This file records the result, what loses points, and which spec closes each gap.

## 1. Scorecard (honest, before the new specs)

| Criterion (20% each) | Score /10 | Why |
|---|---|---|
| Potential Impact | 6.0 | Real problem (repeated side effects after crashes, including AI agents) and a credible tool (`haunt.yaml`, CLI, CI exit codes). Audience vague, nothing to try without installing, the game framing may read as a toy. |
| Technological Implementation (Kiro) | 7.0 | Strong: specs with answer keys, hooks, two agents, MCP server, property test that found a real bug, Power and Crew folders. Weak: one steering file, thin hooks, rule-based reviewer, the "Kiro applies the fix" step is a recorded hand-written file, Power and Crew app not shown installed, log reads as PR bookkeeping. |
| Design | 6.3 | Consistent crypt, code-drawn art, more than a PoC. Dense, no onboarding, unexplained scores, small text, MOCK and "Wave 4" on load. |
| Innovation / Idea | 7.3 | Chaos engineering as a game, "same crash side by side", gear that equips when Kiro fixes the code. Chaos engineering itself is not new. |
| Presentation | 5.0 | Strong script, but no video, no hosted URL, a dry Devpost draft, and a stale README. |
| **Total** | **31.6 / 50** | Mid-pack to upper-mid. A top-3 finish needs about 40 or more. Stage One: pass. |

**Target:** 42 or more. The biggest gains are Presentation (+3), Impact (+2), Design (+2), Kiro implementation (+1.5), Innovation (+1).

## 2. How the new specs close the gaps

| Gap (judge finding) | Criterion | Spec and task |
|---|---|---|
| Owner play-test: motion, logs, colours, laps, reviews, world events, decisions | Design, Innovation | `playtest-v2` (all tasks) |
| First 10 seconds: no hook, no story, no tour | Presentation, Design | `onboarding` ON-U1, ON-U2, ON-U3, ON-U4 |
| No hosted URL (required field) | Presentation, Impact | `onboarding` ON-C1 and `harness` H6.3 (P0) |
| No video | Presentation | `onboarding` ON-D3 and the v2 script |
| Stale, weak README and Devpost text | Presentation | `onboarding` ON-D1, ON-D2 |
| Game depth and replay value; teaches real patterns | Impact, Innovation, Design | `campaign` (nights, gear shop, sandbox) |
| Interactive "equip gear" play | Impact, Innovation | `campaign` CP-U2, CP-U4 |
| Shareable asset, adoption path | Impact, Presentation | `share` SH-C1 (badge, scorecard), SH-U2 |
| Real-world use (CI) | Impact | `share` SH-C2 (Action) |
| "Try it on my own workflow" without installing | Impact, Innovation | `share` SH-C3, SH-U1 (Workflow Lab) |
| Recorded, hand-written "Kiro fix" and F to C vs "F to A" | Kiro implementation, Presentation | `share` SH-C4 (real loop proof) |
| Kiro surface shallow; log is bookkeeping | Kiro implementation | `share` SH-K1 (trace), SH-K2 (write-up), SH-K5 (steering), SH-C5 (LLM reviewer and hook) |
| Power and Crew app not shown installed | Kiro implementation, Best Kiro Crew App | `share` SH-K3 |
| MCP not shown in action | Kiro implementation, Innovation | `share` SH-K4 |
| Python inbox only through CLI, not live in the arena | Impact, Innovation (Skeleton Crew proof) | `share` SH-C6 |
| Unexplained scores, rank board oddities | Design | `playtest-v2` PT-U8 |
| Architecture not visible | Presentation, Kiro implementation | `share` SH-D1, SH-U3 |

## 3. Red flags and the fix for each

1. **No public app URL or video.** Both are required fields. Fix: ON-C1 and ON-D3 are the top priority. The hosted demo may fall back to recorded runs, clearly labelled.
2. **Claims versus evidence.** The video says "F to A" but the proof was F to C and the fix was recorded. Fix: SH-C4 makes it real, and every claim in the script says exactly what the evidence shows.
3. **Repo rules.** Repo is private (must be public with a visible license), CI jobs do not start (GitHub billing), "no tests in CI" reads as unfinished, the README contradicts itself. Fix: owner actions below, ON-D1.
4. **First impression.** Dense UI, no story, MOCK and Wave 4 on load. Fix: onboarding spec and PT-U8, PT-U9.
5. **Time and stability.** Anything that breaks `npm run demo` or the hosted demo turns the video into replayed fixtures. Fix: PT-X1 regression task, the fresh-clone test as a gate, no feature lands without it.

## 4. Order of work (value per effort)

Do not start a lower group until the group above is demo-stable.
1. **Foundation (decides submission validity):** hosted demo (ON-C1/H6.3), bug issues #115, #116, #120, README front page (ON-D1), public repo and license (owner), billing or public flip so CI runs.
2. **Owner play-test fixes (visible quality):** `playtest-v2` must-have list (travel, ticker, popup, chips, laps, reviews, scoring v2, header and legend).
3. **Credibility:** real loop proof (SH-C4), install proof (SH-K3), steering files (SH-K5), Kiro write-up (SH-K2), live inbox (SH-C6).
4. **Hook and story:** title splash, captions, tour (ON-U1 to ON-U4), one story across all texts (ON-D2).
5. **Depth:** campaign nights 1, 2, 5 with the shop (CP-*), badge and scorecard (SH-C1, SH-U2).
6. **Adoption:** Workflow Lab (SH-C3, SH-U1), GitHub Action (SH-C2), trace (SH-K1), MCP scene (SH-K4), LLM reviewer (SH-C5).
7. **World events and decisions** (`playtest-v2` PT-C7, PT-U10, PT-C8, PT-U11) fit between 4 and 6 as time allows; they are the most fun but not required for validity.
8. **Record the video** (ON-D3) only after 1 to 4 are demo-stable.

## 5. Owner actions (cannot be done by the sessions)

| Item | Why |
|---|---|
| Fix GitHub Actions billing, or make the repo public (free minutes) | CI jobs refuse to start today |
| Make the repo public with the MIT license visible (final go) | Required for submission |
| Join the hackathon on Devpost; file the Kiro credit request (by Dec 1, noon PT) | Required; credits expire |
| Pick the tagline (two options in `onboarding` section 2) and approve the story | Presentation |
| Decide the CI policy for the sweep Action (opt-in example, not a required check) | `share` section 3 |
| YouTube channel, blog platform, social account | Video, Bonus Blog, Social Blitz |
| Kiroween 2025 registration (yes or no) | Ghost of Kiroween Past prize |
| Eligibility check (rules section 3) | Disqualification risk |
| Approve scope: play-test world events and the wrong-order decisions are optional extras | See `playtest-v2` cut line |

## 6. Submission checklist (updated)

- [ ] Public GitHub repo, MIT license visible in About, `.kiro/` committed and never ignored
- [ ] Hosted demo URL works with no login (recorded-run fallback allowed, labelled)
- [ ] Video under 3:00, public on YouTube, no copyrighted music or third-party marks, captions burned in
- [ ] Devpost text and one Kiro write-up covering every rubric item, including what Kiro got wrong
- [ ] Category set to Skeleton Crew; two app folders present and both shown running in the arena
- [ ] Also entering: Best Kiro Crew App (Power and app installed, screenshots), Best Demo, Bonus Blog (published), Social Blitz (post starts with `#KiroweenHackathon26`), plus Ghost of Kiroween Past if registered in 2025
- [ ] Fresh-clone test passes (`npm run fresh-clone`) on Windows and Linux
- [ ] Real loop proof in `docs/proof/`; any recorded asset labelled
- [ ] Draft saved by Dec 2, final submit Dec 3 (the owner says deadline is theirs to manage; this list is for them)

## 7. Re-score after the specs land (estimate, to verify with a second judge read)

| Criterion | Now | After groups 1 to 4 | After 5 and 6 |
|---|---|---|---|
| Impact | 6.0 | 7.0 | 8.5 |
| Kiro implementation | 7.0 | 8.0 | 9.0 |
| Design | 6.3 | 8.0 | 8.5 |
| Innovation | 7.3 | 8.0 | 9.0 |
| Presentation | 5.0 | 8.0 | 8.5 |
| **Total** | 31.6 | **39** | **43.5** |
Run the same independent judge read after each group and record the score here.
