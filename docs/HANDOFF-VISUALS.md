# Handoff: Lane B, Visuals

Paste the starter prompt at the bottom into the session.

## Your job

Build the **arena**: the video-game view of five skeleton workers racing through an order pipeline while spooky creatures haunt them. Plus the stage inspector, rank board, ledger panel, boss banner, report viewer, demo mode screen, sound, and the Kiro Crew app page that hosts it. You do **not** build any engine, bot or server logic. You read events and send chaos commands through `contract/`.

## Read in this order (about 25 minutes)

1. `docs/WINNING.md` (the judging rubric: Design and Presentation are 40% of the score)
2. `docs/SWIMLANES.md` and `AGENTS.md`
3. `contract/CONTRACT.md`, **`contract/PROTOCOL.md`**, `contract/STORYBOARDS.md`
4. **`.kiro/specs/arena/ui-spec.md` (the visual spec: layout, palette, creature choreography, event to visual table, controls, sound, accessibility)**, then `requirements.md`, `design.md`, `tasks.md` (your task list, including the Skeleton Crew theme and W-tasks)
5. `.kiro/specs/engine/acceptance.md` section A: it tells you what outcomes to expect and draw per tier and fault
6. `docs/DEMO-SCRIPT.md`: the 3-minute video you are building toward
7. `docs/DEV-SETUP.md`
8. `.kiro/specs/engine/runtime.md` section 9 only (the report JSON shape for the report viewer)

## Order of work

1. While waiting for Lane A's mock server (task H0, expected within a day), build the sprite system and the lane layout with a local array of fake events. Do not invent new event types. Use the types in `PROTOCOL.md`.
2. When the mock lands: connect with `npm run mock` and `npm run ui:dev`. Work only against the contract from then on.
3. Build in this order: skeleton in a lane with stage progress and cheer (UI-A3), fail and collapse and reassemble, ledger and rank board, Chaos button and creature animations (Reaper, Zombie, Ghost, Wraith, Poltergeist, Doppelganger, Lich first), nested depth badge, inspector popup, boss banner, then the rest of the creatures, sound, polish.
4. Support all three modes with the same code: `mock`, `live`, `browser` (the `transport` switch in `PROTOCOL.md`).
5. Demo mode: a "Play demo" button that calls `POST /api/demo/start {script:"hero"}` and just renders what comes back. Judges must reach a running show in under 5 seconds.

## Rules

- Every animation is driven by an event. Never fake motion that is not backed by an event. Never keep your own script or timers for game logic.
- Stage names, part names and creature names come from the server (`/api/state`, `/api/creatures`). Do not hard-code them, so the Python app needs no UI change. Have a generic fallback animation for unknown ids.
- Everything is drawn in code or CSS (no image or audio files from AI models). Sound is generated with Web Audio. Provide a mute button.
- Build output must be static and offline, with relative asset paths (`base: './'`), because it is also hosted on GitHub Pages.
- Never edit `packages/haunt/`, `packages/core/`, `apps/`. If the contract is missing something, open a contract PR (label `contract`, Lane A approves) or an issue labelled `lane-question`.
- Do not run the full browser end to end suite repeatedly. One smoke spec at most.
- Design target: 1080p video capture, readable from a distance, color-blind safe (icons plus color), respects reduced motion.
- Branch `ui/<task>`, one PR per task.

## Quality bar

The Design criterion asks: "complete, coherent product experience, not just a technical proof of concept. Intuitive, polished, intentional." Spend time on motion, sound, consistent palette, and empty and error states. A skeleton collapsing into bones and reassembling must be a joy to watch.

## Starter prompt

> You are Lane B (Visuals) on Kiroween-Chaos, a hackathon project with a hard deadline of Dec 4 2026 5pm EST. Clone https://github.com/kakoritz/Kiroween-Chaos to a local folder (not the NAS), then read `docs/HANDOFF-VISUALS.md` and follow its reading order. You build only `packages/arena-ui/`. Another session (Lane A) builds the engine and a mock server (task H0) that you will connect to; until it lands, build sprites and layout with fake events that use the types in `contract/PROTOCOL.md`. Every animation must be driven by a contract event. Work on branches `ui/<task>`, one PR per task. Make the arena beautiful: this project is judged 20% on Design and 20% on Presentation. Ask me only about things in `docs/OPEN-ITEMS.md` marked "needs the owner".
