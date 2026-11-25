# Gallery refresh: design

No product code changes. Images are produced by driving the live server (`packages/core/src/bin/live.ts` on a private port) with headless Chromium at 1500x1000.

- Arena shots: pick the app tab through the UI, set the dial through `POST /api/intensity`, start a 14-order wave, then fire `POST /api/chaos` on all five lanes a few seconds in so every lane has a creature. Frames are sampled every 0.4 s and the best one is kept.
- 08: campaign night 5 (`POST /api/wave/start {"campaign":{"night":5}}`) shows the Lich boss banner.
- 09: dial at 11.
- 10: the Crypt (Play the Campaign).
- 07 and 11: `POST /api/tournament/start`, then `POST /api/next` between rounds; 07 mid-round, 11 the round review with the casebook.
- 14: Workflow Lab, Inbox preset, no protections, Run. Unchanged by the recent work, so the file is only replaced if the render differs.
- Each frame is viewed before it is accepted.
