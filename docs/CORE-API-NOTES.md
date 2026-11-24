# Core API notes (additive, pending contract merge)

These endpoints and fields exist in `packages/core` on both the live and the mock server. They only add to `contract/`; no file under `contract/` was changed. Lane B can build against them now. The owner of `contract/` can fold them into the next version.

## GET /api/packs (PK-U1)

Lists the packs the app switcher can show. Body: `{ "packs": PackSummary[] }`, sorted by id.

```json
{
  "id": "ticketing",
  "title": "Haunted Desk",
  "modelBased": true,
  "app": "inbox",
  "stages": [{ "id": "login", "label": "Login or SSO", "kind": "effect" }],
  "creatures": { "witch": "Witch" },
  "faults": 9,
  "reviewLabel": "Requester CSAT"
}
```

- `modelBased`: show the "model-based" tag. Results come from rules over declared protections.
- `app`: the id in `GET /api/apps` that runs this pack for real (`"inbox"` for ticketing), or `null` for a pack that only runs in the Workflow Lab (streaming). Pick a pack with `app` set through `POST /api/app {app}`.
- `stages[].kind` is the stage role (`effect`, `input`, `work`, `poll`, `final`, ...).
- Source of truth: `packs/*/pack.yaml` (embedded copy `packages/haunt/src/packs/embedded.ts`). Code: `packages/haunt/src/packs/summary.ts`.

## Tournament auto-continue (TV3-C2)

Off by default. When on, a review state that nobody advances presses Next after N seconds.

- `POST /api/tournament/start {..., autoContinueSec?: number}`: 0 to 3600, `0` or absent means off. The response echoes `autoContinueSec` when it is on.
- `POST /api/tournament/auto-continue {seconds}`: change it while the tournament runs. Returns `{ autoContinueSec }`. 409 `no_tournament` when none runs.
- A hand-pressed `POST /api/next` cancels the pending timer. `awaiting_next`, `round_end` and `/api/state` are unchanged, so a client shows the same Review state; a UI that wants a countdown reads the value it set.

## Seal price (CP-E2E)

In `packages/core/campaign/gear.json` the Seal now costs 300 (was 400), so a fresh save (300 credits) can buy it and win night 1 with it. Start credits stay 300. `GET /api/campaign` returns the new cost in `gear[].cost`; shop prices are now 200, 300, 300, 500, 500.

## CLI (H7, H9.2)

- `haunt report <run-id|report.json> [--format md|html|json] [--out file]`
- `haunt serve [--port 7070] [--mode live|mock]`, bound to 127.0.0.1
- `--i-own-this` on `haunt monkey` and `haunt watch` (and `startFaultProxy({iOwnThis})`): without it a non-local `--upstream` is refused with exit 2.
