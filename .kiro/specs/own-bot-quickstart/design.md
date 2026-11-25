# Own-bot quickstart: design

## How a bot plugs in today
The live runtime spawns one process per lane through `botCommand(lane, wave, settings)` (`packages/core/src/live/runtime.ts`) and speaks JSON lines with it. `makeBotCommand` builds the default one for the built-in bots. A command only needs `{ command, args, env }`. `makeBotCommand` gets an optional `custom: { command, args }` that replaces the bundle on every lane and keeps the wave cleanup, lane folders, job files and `HAUNT_*` env.

Environment the runtime sets: `HAUNT_RUN_DIR`, `HAUNT_LANE`, `HAUNT_TIER`, `HAUNT_SEED`, `HAUNT_PROVIDER` (fake provider URL), `HAUNT_ORDERS_DIR`, `HAUNT_SPEED`, `HAUNT_ATTEMPT`, `HAUNT_APP`.

Line protocol, stdout from the bot: `{"k":"ready"}`, then (after the runner sends `{"k":"go"}`) event lines `{"type", "order", "stage", "detail"}`, then `{"k":"idle"}`. The runner answers `{"k":"shutdown"}`; the bot exits. A chaos kill is a real SIGKILL: the runner restarts the process, and the bot starts over on the files still in `HAUNT_ORDERS_DIR`. A bot moves a finished file to `../done`.

The live server normalizes missing detail fields (`packages/core/src/live/normalize.ts`), so a bot emits the minimum.

## What is new
- `tools/own-bot.ts`-style entry in `packages/core/src/bin/own-bot.ts`: same wiring as `bin/live.ts`, but `botCommand` comes from `ownBotCommand(spec)`, and the server starts on the Stream app.
- `packages/core/src/live/own-bot.ts`: pure `resolveOwnBot(arg, deps)` returns `{ command, args }` or an error, and `ownBotCommand` wraps it into a `botCommand`. Tests import it directly.
- `templates/own-bot/{bot.mjs,bot.py,README.md}`.
- `docs/OWN-BOT.md`.

## Why the Stream app
Its stage ids (`fetch`, `draft`, `reply`) and effects (`store`, `dispatch`, `notify`) are already known to the catalog, the provider, the curses and the validator, so no contract or catalog change is needed. The validator (R2) requires every stage in order, so the template runs all five; `classify` makes no call. A bot cannot declare its own stages without a catalog and contract change.

## Out of scope
Custom stage lists for a user's own pipeline (needs a catalog and contract change, its own `contract` PR), a bot that runs in a container, and auto-applying fixes.
