# Judge self-check

Run `npm run judge:check`. It reads this table and fails if any evidence path does not exist, any `npm run` script is missing, or any row has no evidence. **Status** is my own honest rating: `Met`, `Partly` or `Gap`. A `Partly` or `Gap` row must say what is missing.

| Area | Claim | Evidence | Status | Missing |
|---|---|---|---|---|
| Skeleton Crew fit | One engine runs several different apps | `packages/haunt/src/shared/registry.ts`, `examples/coffee-shop/haunt.yaml`, `apps/haunted-playback/haunt.yaml`, `apps/haunted-inbox/haunt.yaml` | Met | |
| Skeleton Crew fit | A new service plugs in with no engine edit | `packages/haunt/test/registry.test.ts`, `apps/generic/test/playback.test.ts`, `docs/INTEGRATE.md` | Met | |
| Skeleton Crew fit | The skeleton is documented | `docs/MODULAR.md`, `docs/BLOCKS.md`, `docs/INTEGRATE.md` | Met | |
| Skeleton Crew fit | Modular parts tested alone, then chained | `packages/haunt/src/blocks/cards.ts`, `packages/arena-ui/chain.html`, `packages/haunt/test/block-cards.test.ts` | Met | Scores are model-based |
| Kiro use | Spec-driven build | `.kiro/specs/modular-engine/requirements.md`, `.kiro/specs/modular-engine/tasks.md`, `docs/TRACE.md` | Met | |
| Kiro use | Steering, hooks, agents, Power, Crew app | `.kiro/steering/contract.md`, `.kiro/hooks/fixtures-on-contract-save.kiro.hook`, `kiro-power/README.md`, `kiro-crew-app/README.md` | Partly | Power and Crew app are not installed into a Kiro window |
| Kiro use | The story of how Kiro built it | `docs/HOW-KIRO-BUILT-THIS.md`, `docs/KIRO-LOG.md` | Met | |
| Completeness | Contract with a validator | `contract/events.schema.json`, `contract/V1_3.md`, `packages/haunt/test/contract-v13.test.ts` | Met | |
| Completeness | Old apps unchanged by the refactor | `packages/haunt/test/golden-apps.test.ts`, `packages/haunt/test/golden/stages.json` | Met | |
| Completeness | Every requirement traced to a test | `docs/TRACE.md`, `tools/trace.ts` | Met | |
| Completeness | Real crash proof | `packages/haunt/test/hero-crash.test.ts`, `apps/generic/test/generic.test.ts` | Met | |
| Originality | Chaos as a game: tournament, corpses, Casebook | `docs/JUDGES.md`, `packages/haunt/src/tournament/rounds.ts` | Met | |
| Originality | Unknown-fault fuzzing | `packages/haunt/src/runner/intensity.ts` | Met | |
| Polish | Accessibility and mobile pass | `.kiro/specs/a11y-mobile/requirements.md`, `packages/arena-ui/src/a11y.ts`, `packages/arena-ui/src/arena/lane-cards.ts`, `packages/arena-ui/test/lane-cards.test.ts` | Partly | Phone shows readable lane cards under a small canvas; not checked on a real phone |
| Polish | Honest labels on model-based results | `packages/arena-ui/src/chain/panel.ts`, `packages/arena-ui/src/workflow-lab/panel.ts` | Met | |
| Polish | Hosted build, with Playback and the Coffee Shop in the app switcher | `tools/hosted-check.mjs`, `docs/HOSTING.md`, `packages/haunt/src/config/embedded-apps.ts` | Met | |
| Usefulness | Run your own bot in minutes | `docs/OWN-BOT.md`, `templates/own-bot/bot.mjs`, `docs/INTEGRATE.md` | Met | |
| Usefulness | Fix specs, never auto-applied | `docs/proof/sample-hardening-spec/index.md` | Met | |
| Usefulness | CI use | `docs/examples/haunt-ci.yml`, `docs/PRODUCTION-MODE.md` | Met | |
| Safety | Personal info kept out of the repo | `packages/haunt/test/docs-truth.test.ts` | Partly | A final scan runs before submission |
| Skeleton Crew fit | An app names its own creatures; the nine pack names show in the live arena | `docs/STREAM.md`, `packages/haunt/test/creature-names.test.ts`, `apps/haunted-playback/haunt.yaml` | Met | Names are display only (sprite and rules are the engine's) |
| Usefulness | Build a chain, flip the protections, and run it in the arena | `packages/arena-ui/src/chain/panel.ts`, `packages/arena-ui/src/chain/run.ts`, `packages/core/test/chain-register.test.ts` | Met | |
| Usefulness | A bot starter for any app, with HARDEN comments | `packages/haunt/src/scaffold/bot-starter.ts`, `apps/generic/test/bot-new.test.ts`, `docs/INTEGRATE.md` | Met | |
| Usefulness | Example chains in one click; save a chain to a link or a haunt.yaml and open it again | `packages/arena-ui/src/chain/examples.ts`, `packages/arena-ui/src/chain/save.ts`, `packages/arena-ui/test/chain-save.test.ts` | Met | |
| Usefulness | A registered app gets fix specs that name its own stages and bot file | `packages/haunt/src/miner/specs.ts`, `packages/haunt/test/fixspec-registered.test.ts` | Met | Tier names (Rookie ...) are still the engine's |
| Usefulness | Each block says how it usually breaks and what protects it | `packages/haunt/src/blocks/library.ts`, `docs/BLOCKS.md`, `packages/haunt/test/block-hints.test.ts` | Met | |
| Usefulness | A worked example from zero to graded, with real output | `docs/ZERO-TO-GRADED.md`, `examples/pizza-shop/haunt.yaml` | Met | |
| Polish | A guided tour and Save-as-block in the Chain Wizard, checked in headless Chrome | `packages/arena-ui/src/chain/tour.ts`, `packages/arena-ui/src/chain/my-blocks.ts`, `tools/chain-check.mjs` | Met | |
| Usefulness | Pin a result and compare two chains; download a chain result as a report page and a badge | `packages/arena-ui/src/chain/compare.ts`, `packages/arena-ui/src/chain/export.ts`, `packages/arena-ui/test/chain-compare-export.test.ts`, `tools/chain-check.mjs` | Met | Model-based, said on the page |
| Usefulness | A copy-ready GitHub Action that grades your own haunt.yaml and fails below a grade | `docs/GITHUB-ACTION.md`, `docs/github-action/haunt-chaos.yml`, `packages/core/src/bin/chain-grade.ts`, `packages/core/test/chain-grade.test.ts` | Met | Grades the model, not your running bot |
| Polish | The hosted page replays a recorded Playback tournament (its own stages) | `site/recorded/tournament-playback.json`, `tools/record-app.mjs`, `packages/arena-ui/test/recorded.test.ts` | Met | Recorded run, labeled so |
| Polish | Every Chain Wizard button checked in headless Chrome: examples, share link, yaml edit, downloads, Run in the arena on a live server, phone view | `tools/chain-check.mjs`, `tools/chain-run-check.mjs` | Met | Run by hand, not part of verify |
| Usefulness | Bring an existing n8n or Zapier flow in as a chain, with every guess explained | `packages/haunt/src/import/flow-import.ts`, `packages/haunt/test/flow-import.test.ts`, `examples/flows/`, `docs/INTEGRATE.md` | Met | Guesses by node type and name; unmatched nodes are named and left out |
| Usefulness | Own attacks in haunt.yaml (tuned, named faults on chosen stages), seen in a real recorded run | `packages/haunt/src/runner/engine.ts`, `packages/haunt/test/own-attacks.test.ts`, `examples/coffee-shop/haunt.yaml` | Met | Builds on the engine's faults; no contract change |
| Usefulness | A helper library for bots (retry, idempotency key, journal) in Node and Python | `templates/bot-lib/`, `packages/haunt/test/bot-lib.test.ts`, `docs/OWN-BOT.md` | Met | |
| Usefulness | The GitHub Action also runs your real bot and fails below a grade | `docs/github-action/haunt-chaos.yml`, `docs/GITHUB-ACTION.md`, `packages/core/src/bin/haunt.ts` | Met | The sweep takes --min-grade. Run by hand on the pizza shop: grade D, 87 s |
| Polish | The hosted page replays a recorded Coffee Shop tournament, with its own attacks | `site/recorded/tournament-coffee-shop.json`, `packages/arena-ui/test/recorded.test.ts` | Met | Recorded run, labeled so |
| Completeness | Effect kinds are open (contract v1.4): a service's own kind shows by name in events, ledger and arena | `contract/V1_4.md`, `packages/haunt/test/open-effect-kinds.test.ts`, `packages/core/src/provider/provider.ts` | Met | The in-browser worker engine keeps the known kinds |
| Polish | Own attacks can be pressed from the arena (lane popup, "Your attacks") and edited in the Chain Wizard | `packages/arena-ui/src/arena/lane-popup-model.ts`, `packages/arena-ui/src/chain/model.ts`, `packages/arena-ui/test/chain-attacks.test.ts`, `tools/chain-check.mjs` | Met | The hosted page has no attack buttons (no live engine) |
| Usefulness | Import also reads GitHub Actions workflows and node-and-edge graphs (LangGraph, React Flow) | `packages/haunt/src/import/flow-import.ts`, `packages/haunt/test/flow-import.test.ts`, `examples/flows/` | Met | Guesses by name and type; unmatched steps are named and left out |
| Completeness | One command checks the repo before submitting: git state, personal info in files and history, links, sizes, required files, verify | `tools/submit-check.mjs`, `tools/lib/submit-checks.mjs`, `packages/haunt/test/submit-check.test.ts` | Met | |
| Completeness | The in-browser worker engine also takes open effect kinds | `packages/haunt/src/browser/ledger.ts`, `packages/haunt/test/open-effect-kinds.test.ts` | Met | |
