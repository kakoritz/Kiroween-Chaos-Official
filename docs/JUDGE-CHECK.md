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
| Polish | Accessibility and mobile pass | `.kiro/specs/a11y-mobile/requirements.md`, `packages/arena-ui/src/a11y.ts` | Partly | Arena canvas is fixed 1280x720 on a phone |
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
