# Onboarding and presentation (requirements and design)

Goal: a judge or a stranger understands the problem, the stake and how to play **in the first 10 seconds**, can try everything **without installing anything**, and the video, README and submission page all tell the same sharp story. This targets the weakest scores (Presentation, first impression, Design clarity). Judges may only watch the video and open one URL, so these pieces carry the score.

## 1. Requirements (EARS)

1. WHEN the arena loads for the first time, THE UI SHALL show a **title splash** of at most 4 seconds with the logo, the tagline, a one-line problem statement and four buttons. (ON-U1)
2. WHILE a demo plays, THE UI SHALL show **captions** (a subtitle line) and **callouts** driven by a captions track, and a CC toggle. (ON-U2)
3. THE UI SHALL provide a **guided tour** (six steps with a spotlight) from a button and from `?tour=1`. (ON-U3)
4. THE UI SHALL show a **score explainer** and **legend** (see `playtest-v2/ui.md`) so no number is unexplained. (PT-U8, PT-U9)
5. THE hosted demo SHALL load with no login and no install and start the title splash within 5 seconds. (ON-C1, `harness H6.3`)
6. THE README front page SHALL give the pitch, the live URL, a 30-second quick start, the two-apps table, the Kiro features table and an architecture diagram in the first screen of scrolling. (ON-D1)
7. THE demo video, submission text, blog and social drafts SHALL use one story, one hook, one number. (ON-D2)

## 2. The story (use everywhere)

- **Hook:** "Charged. Charged again." A bot crashes right after charging a customer and does the work twice.
- **Problem:** Automations and AI agents crash halfway through, then repeat side effects (double charges, duplicate emails, duplicate tickets).
- **Solution:** Haunt, chaos engineering as a game. Five bots, the same crash, ledger-proven results. Plug in your own process and get a graded report. Kiro closes the loop.
- **Number:** "Rookie: 2 charges. Phoenix: 1." And "F to A" after one Kiro-applied fix (only if the proof is real, see `share/spec.md` section 5).
- **Tagline (pick one, test with the owner):** "Break your bots before the world does." / "Chaos engineering, played as a game."

## 3. Title splash

Full-screen crypt background with the logo "HAUNT", the tagline, the hook line "Charged. Charged again." typed out, and four buttons: **Watch the 60-second demo** (hero), **Play the Campaign**, **Take the tour**, **Test your own workflow**. It dismisses on any button, on Esc, or after 4 seconds into the demo if the URL has `?demo=`. `?splash=0` skips it (for capture and deep links). A "skip" link is always visible. Reduced motion: no typing effect.

## 4. Captions and callouts

- A **captions track** per demo script: `packages/core/demo/<script>.captions.json` = `[{at: {event|ms}, text, ms}]` where `at` can be an event trigger (same `when` format as demo plays) or a time offset. The UI shows one line at a time at the bottom safe area (inside the 60 px caption strip), 28 px text, high-contrast, max 2 lines.
- **Callouts:** big on-screen annotations tied to events, for example at the hero crash: "SAME CRASH" then, when the ledger flashes, "Rookie: 2 charges / Phoenix: 1 charge". Callouts point at the lane or ledger cell with an arrow, shown 2.5 s. **Callouts never pause or delay events**; they overlay while events continue. For the video only, a `?freeze=hero-crash` capture mode holds the frame for 2 s (a UI-side freeze of rendering, not an event delay).
- CC toggle in the gear menu; captions are on by default in demo mode, off in normal play. The same captions become the burned-in subtitles of the video.
- Captions are authored in the demo scripts so the video and the hosted demo say the same thing.

## 5. Guided tour (six steps)

Spotlight overlay (dim everything except the target, a caption bubble with Next and Back):
1. **The race:** "Five bots process the same orders. Each has more protection." (lanes)
2. **The gear:** "These letters are their protections." (gear row; opens the legend tip)
3. **The stages:** "Green passed, yellow in trouble, red failed. The flag counts problems." (chips)
4. **Chaos:** "Press a skull to throw a monster at a bot." (Chaos button; the tour fires one chaos for the viewer)
5. **The ledger:** "The provider's own record. This is the truth." (ledger)
6. **The report:** "After a wave, get a grade and fixes." (report button; opens the sample report)
Escape ends the tour. The tour runs on the mock or any mode.

## 6. Hosted demo (GitHub Pages)

- Target: `https://kakoritz.github.io/Kiroween-Chaos/` (the repo must be public for free Pages). The browser engine (`harness H6.3`) runs the real engine in Web Workers; the UI uses `inpage`. If the browser engine is not ready, the hosted demo falls back to **recorded real runs** (the fixtures), clearly labelled "Recorded run".
- The page needs: title splash, demo, campaign, tour, report viewer, Workflow Lab (see `share/spec.md`), all offline-capable (no external requests), small bundle (under 2 MB), first paint under 5 s.
- A **"Run it yourself"** panel shows `git clone` and `npm run demo` for the live engine.
- `docs/JUDGES.md` is the 60-second written tour and links straight to the hosted URL, the video and the repo.

## 7. README front page (ON-D1)

Order: logo/GIF of the hero crash, one-sentence pitch, **Try it** (hosted URL button), **30-second quick start** (3 commands), the two apps table (Orders in Node, Inbox in Python) with the Skeleton Crew claim, **Kiro features table** (specs, steering, hooks, agents, MCP, Power, Crew app, property tests, each linked to the file), an **architecture diagram** (mermaid in README plus an exported SVG), badges (CI, license, "Haunt grade"), then docs links. Remove the stale "not built yet" and mock-server dump sections (move to `docs/`).

## 8. Video v2 (updates `docs/DEMO-SCRIPT.md`)

Keep the 3:00 limit. New structure: 0:00 to 0:05 the receipt hook ("Charged. Charged again."); 0:05 to 0:25 the pitch over the title splash and the first lap with the door ceremony and stars (it looks like a game immediately); 0:25 to 1:05 the hero crash with the callout "Rookie: 2 charges / Phoenix: 1"; 1:05 to 1:30 stacked chaos and the Lich boss with the recovery bonus; 1:30 to 1:50 the lane popup (attempts, recovery time, downtime) and the star ratings; 1:50 to 2:20 the loop: reviewer writes the spec, **Kiro applies the fix live**, grade improves (real proof, `share/spec.md` section 5); 2:20 to 2:40 the MCP scene (a Kiro agent calls `haunt_sweep` on a new workflow); 2:40 to 2:55 the Python inbox in the same arena and the scorecard badge; 2:55 to 3:00 end card with URL and repo. Captions burned in. Music: none or generated in code.

## 9. Acceptance

1. A first-time visitor sees the splash with the hook within 5 s and reaches a playing demo with one click.
2. The captions track plays in `hero`, `full` and `loop`; CC toggle works; captions stay inside the safe area at 1920x1080.
3. The tour runs end to end on the hosted demo.
4. The README first screen shows pitch, URL, quick start, apps table, Kiro table, diagram.
5. No external network request on the hosted demo.
6. `docs/JUDGES.md` fits on one page and every link works.
