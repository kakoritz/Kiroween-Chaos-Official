# Mock server (for the arena UI)

`npm run mock` starts the mock on `http://127.0.0.1:7070` (set `PORT` to change it). It needs no engine and no network.

- REST: every call of `contract/PROTOCOL.md` (state, wave start and stop, speed, chaos, chaos mode, demo, app, creatures, lane stage and log and orders, ledger, waves, reports, postmortem, hardening, compare). Errors are `{error:{code,message}}` with the codes from the protocol.
- SSE: `GET /api/events?since=<seq>`. First message is `hello`. `since` is exclusive. A `: ping` comment goes out every 15 s. `410 gone` when `since` is older than the last 5000 events. With no wave started, the first connection replays `calm`.
- Demo: `POST /api/demo/start {script}` accepts `hero`, `full`, `loop` or any fixture name (`calm`, `parked`, `boss-power`, `inbox`, ...).
- Waves: `POST /api/wave/start` scales a no-fault plan by `orders`, `lanes`, `tiers`, `pace` and `speed`. `POST /api/chaos` injects one fault on a running lane and answers with the outcome from `packages/core/mock/outcomes.json`. A boss fault sends `boss_warning`, then `boss_start`, one `chaos` per lane, and `boss_end`.
- Test hooks: `POST /_mock/reset`, and `POST /_mock/fault {kind: "drop_sse" | "gone" | "slow" | "version" | "unreachable"}` for transport error handling (`version` makes `hello` and health report one contract version higher, `unreachable` drops every `/api` request; `POST /_mock/reset` clears both).
- In-page transport: `packages/core/inpage-stub.js` defines `window.__haunt` with every function listed in PROTOCOL.md (`getState()`, `startWave(opts)`, `subscribe(fn, {since})`, ...). It forwards to the mock, so run `npm run mock` first. Set `window.__HAUNT_BASE__` before loading it to change the address. Errors reject with `{code, message}`.
- Not in the mock yet: random chaos mode (the mode is stored but nothing fires on its own), serving `packages/arena-ui/dist/`.
