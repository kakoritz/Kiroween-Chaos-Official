# Stream pack app: tasks

Branch `feat/stream-pack-app`. One PR.

- [x] **SP-C1 Stage table and app id.** `STREAM_STAGES`, app id `stream` in shared and live catalogs, vocabulary, creature app lists. (R1, R2)
- [x] **SP-C2 Stream pipeline and bots.** `StreamPipeline`, five tier bots and the Crew, `defineBot` pipeline option, `haunt.yaml`, build into `dist/stream-bots`. (R1, R3)
- [x] **SP-C3 Live wiring.** Bot command and job files in `live/runtime.ts`, app validation in `live/server.ts`, provider stage map, fault stages, tournament plan, curse stage mapping. (R2, R5)
- [x] **SP-C4 Tests.** Catalog, config, bots (`--parts`, real child run with a crash), live server app switch, validator on a Stream wave. (R1 to R5)
- [x] **SP-C5 End to end.** `tools/e2e.mjs` Stream section: reset the dial, switch app, run a wave, zero validator violations on it. (R7)
- [x] **SP-D1 Docs.** README, `docs/PACKS.md`, `docs/JUDGES.md`, `docs/TRACE.md`. (R6)
