# Kiro Crew app bonus: requirements

The Kiroween 2026 bonus "Best Kiro Crew App" wants a public GitHub repo of a Crew app made in the period, plus a write-up. This spec makes `kiro-crew-app/` a real app that runs on its own and can be published as its own repo.

## R1. Runs on its own
1. `kiro-crew-app/server/haunt-mcp.mjs` is one bundled file built by `npm run build:crew-app`. It starts with `node` from an empty folder.
2. `haunt_define`, `haunt_blocks`, `haunt_chain` and `haunt_lab` need no repository checkout.
3. `haunt_sweep` and `haunt_ramp` without a checkout say how to get one (`HAUNT_ROOT`) and do not crash.

## R2. Shows the new engine
1. `haunt_blocks` lists the library and, with a tier, each block's alone-card.
2. `haunt_chain` takes block ids or a `haunt.yaml` and returns grade, blame by stage and block, and warnings.
3. `haunt_lab` returns a model-based what-if of any `haunt.yaml`.
4. Every result of 1 to 3 says it is model-based.

## R3. The app package
1. `app.json` starts the bundled server, auto-approves only read-only tools, keeps `network: false`.
2. Two skills (`build-and-test-a-chain`, `stress-test-my-workflow`) and the `reviewer` agent, limited to hardening spec paths.
3. The page is the Chain Wizard as a static page (no server), copied by the same build.
4. README and WRITEUP are honest: what is model-based, what needs a checkout, what is not shown (no Crew window capture).

## R4. Publishing
1. The package folder is the repo: no personal info, MIT license, noreply identity on every commit.
2. A test starts the bundle from an empty folder and compares its tool list with the main server.
