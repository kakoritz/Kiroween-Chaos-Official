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
- [x] 5. Compare two chains: Pin this result, then test again (`packages/arena-ui/src/chain/compare.ts`).
- [x] 6. Export a chain result: report page and badge (`packages/arena-ui/src/chain/export.ts`).
- [x] 7. GitHub Action for your own app: `npm run chain:grade`, `docs/GITHUB-ACTION.md`, `docs/github-action/haunt-chaos.yml`.
- [x] 8. Recorded Playback tournament on the hosted page: `tools/record-app.mjs`, `site/recorded/tournament-playback.json`, `RECORDED_TOURNAMENT_APPS` in `onboarding/recorded.ts`.

## Third build list (2026-11-26)
- [x] 1. Real-bot grade in the GitHub Action (`docs/github-action/haunt-chaos.yml` job `real-bot`, `haunt sweep --min-grade`).
- [x] 2. Import an n8n or Zapier flow (`packages/haunt/src/import/flow-import.ts`, `npm run flow:import`, wizard "Import flow").
- [x] 3. Own attacks in haunt.yaml (`attacks:`; `packages/haunt/src/runner/engine.ts`).
- [ ] 4. Open effect kinds: needs a contract change. Proposal in `docs/proposals/open-effect-kinds.md`, waiting for approval.
- [x] 5. Fixed the flaky e2e check (`tools/e2e.mjs`, 3 of 5 lanes; measured 1 run in 5 failed the old rule).
- [x] 6. Recorded Coffee Shop tournament (`site/recorded/tournament-coffee-shop.json`).
- [x] 7. Bot helper library (`templates/bot-lib/`, written by `npm run bot:new`).
