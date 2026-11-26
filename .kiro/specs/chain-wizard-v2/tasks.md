# Tasks
- [x] 1. Protection switches (R1): `Protections` in `packages/haunt/src/blocks/cards.ts`, switches and before/after line in `packages/arena-ui/src/chain/panel.ts`.
- [x] 2. Run my chain in the arena (R2): `POST /api/apps/register`, `packages/arena-ui/src/chain/run.ts`, hosted hand-off through sessionStorage.
- [x] 3. Bot starter for any app (R3): `npm run bot:new`, `packages/haunt/src/scaffold/bot-starter.ts`, test `apps/generic/test/bot-new.test.ts` (Node and Python run as real processes).
- [x] 4. Example chains (R4): `packages/arena-ui/src/chain/examples.ts`.
- [x] 5. Save and share a chain (R5): `packages/arena-ui/src/chain/save.ts`, link `#c=...`, haunt.yaml download.
- [x] 6. Fix specs and Casebook for registered apps (R6): `SpecContext` in `packages/haunt/src/miner/specs.ts`, filled by the live server; the Casebook already reads stage labels from the running app.
- [x] 7. Block hints (R7): `hintOf` in `packages/haunt/src/blocks/library.ts`, shown in the wizard and `docs/BLOCKS.md`.
- [x] 8. Phone-friendly arena (R8): `packages/arena-ui/src/arena/lane-cards.ts` (cards under the small canvas in narrow mode).

## Second build list (2026-11-26)
- [x] 1. Kiro Power: new tools, chain skill, real repository link (`kiro-power/`, `packages/haunt/test/kiro-power.test.ts`).
- [x] 2. Save as block in the Chain Wizard (`packages/arena-ui/src/chain/my-blocks.ts`).
- [x] 3. Guided tour in the Chain Wizard (`packages/arena-ui/src/chain/tour.ts`); `node tools/chain-check.mjs` runs the page in headless Chrome.
- [x] 4. Zero to graded: `docs/ZERO-TO-GRADED.md` with `examples/pizza-shop/`.
- [ ] 5. Compare two chains. [ ] 6. Export a chain result. [ ] 7. GitHub Action for your own app. [ ] 8. Recorded Playback tournament on the hosted page.
