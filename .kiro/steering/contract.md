# Contract steering

- The seam between core (`packages/core`, `packages/haunt`, `apps/`, `tools/`) and visuals (`packages/arena-ui`) is `contract/`: `CONTRACT.md` (IDs and catalogs), `PROTOCOL.md` (events, endpoints, ordering), `V1_1.md` and `V1_2.md` (additive changes), `events.schema.json` and `contract/fixtures/`.
- The UI reads the event stream and the server's `stages` list. It never invents state and never animates without an event behind it.
- Contract changes go in their own pull request with the `contract` label and need the other lane's approval. Changes are additive within a `contractVersion`.
- After any change under `contract/` run `npm run validate:events`. The hook `fixtures-on-contract-save` does this on save.
- Branches are `core/<task>` or `ui/<task>`. One pull request per task, and the task ID is in the PR title.
- Never edit the other lane's folders. Never commit to `main`.
- A hardening spec is never applied automatically. It becomes a normal task and goes through review.
