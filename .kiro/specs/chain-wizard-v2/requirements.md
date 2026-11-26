# Chain Wizard v2: requirements

Features added after the modular engine, for the owner's build list. Each item has its own section; tasks are in `tasks.md`.

## R1. Protection switches
1. The Chain Wizard shows five switches (Retry, Journal, Idempotency keys, Circuit breaker, Offline queue) and a preset list (the five tiers).
2. Block cards and the chain test use the switched protections, not only a named tier. A mix that is no tier is called `custom`.
3. When a result is showing and a switch changes, the chain is tested again at once and the page says "Before: grade X ... Now: grade Y".
4. `chainReport`, `runBlock` accept either a tier name or a set of protections.

## R2. Run my chain in the arena
1. A button on the Chain Wizard saves the chain as an app and opens the live arena on it, ready to start a wave (local server).
2. The server registers an app posted by the page (`POST /api/apps/register` with the manifest text), with the same checks as `--app`, and rejects a bad one with the field and the fix.
3. On the hosted page the same button registers the app in the browser engine.

## R3. Bot starter for any app
1. `npm run bot:new -- <haunt.yaml> [--lang node|python]` writes a runnable naive bot that speaks the event format with the app's own stage ids and effects.
2. Each effect has a `HARDEN` comment saying which protection fixes it.
3. The written bot passes the contract validator when run by `own-bot --app`.

## R4. Example chains
1. The wizard offers at least four example chains (checkout, sign-up, video playback, support ticket) that load in one click.

## R5. Save and share
1. A chain is saved to a link (the blocks and ids in the URL) and to a `haunt.yaml` file download; opening the link restores the same chain.

## R6. Your own app in the improve loop
1. Hardening specs and the Casebook name a registered app's own stages, effect kinds and creature names.

## R7. Block hints
1. Each block has a hint line (how it usually breaks, what protects it). The wizard and `docs/BLOCKS.md` show it.

## R8. Phone-friendly arena
1. On a phone-width screen the arena shows a readable lane view (not a 30% canvas) with the controls reachable.
