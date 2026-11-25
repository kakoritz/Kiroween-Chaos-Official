# Own-bot quickstart: requirements

Goal: a person with their own agent can point Kiroween Chaos at it in five minutes, watch it fail under chaos, read the Casebook, and harden it. Nothing in `contract/` changes.

## R1. A copy-paste template
1. `templates/own-bot/` holds a Node (`bot.mjs`) and a Python (`bot.py`) variant. Each has no dependency on this repo's packages and runs by itself.
2. Each variant runs three stages (`fetch`, `draft`, `reply`) against the fake provider, one effect per stage, and speaks the event contract: `ready`, wait for `go`, per order `order_start`, `stage_start`, `stage_done`, `effect`, `order_done`, then `idle`, then exit on `shutdown`.
3. The template is deliberately naive: no retry, no idempotency key, no journal. It fails visibly under chaos, which is the point.
4. Each variant has a one-line comment per hardening step marking where a fix goes.

## R2. A command that runs it
1. `npm run own-bot -- <path-or-command>` starts the live server and the fake provider on 127.0.0.1 with that bot as the lane command, selects the Stream app, and prints the arena URL.
2. The argument is a file path (`.mjs`, `.js`, `.py`) or a quoted command line. A missing path is refused with exit 2 and a message before anything starts.
3. The bot runs on every lane; the fake provider is the only network target. No real service is called.
4. `HAUNT_PORT` and `HAUNT_PROVIDER_PORT` override the ports, as for `npm run live`.
5. Fixes are never applied automatically: the command reads the bot, it never edits it.

## R3. A five-minute doc
1. `docs/OWN-BOT.md` walks through: copy the template, run it, see it fail under chaos, read the Casebook, harden it, run again.
2. It is linked from `README.md` and `docs/START-HERE.md`.
3. It names the bot environment variables and the line protocol in one table each.

## R4. Tests
1. The command line builder is a pure function with unit tests: path to command, python detection, refusal of a missing path.
2. The Node template passes the contract validator on a short in-process wave (under about 20 seconds). The Python template does the same when Python 3.11+ is present, and is skipped otherwise.
3. The docs-truth test fails if `docs/OWN-BOT.md` or the template files are missing or not linked from the README and START-HERE.
