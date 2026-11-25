# Campaign credits: design

Root cause: progress lives in `haunt.campaign.v1` and a fresh save stores 0 credits. Only the gear shop (`loadShop`) turned "fresh" into the start grant, and only wrote it when a purchase or save happened. The hub (`loadProgress`) and the results writer (`applyResult` over `loadProgress`) read the raw record: the hub showed 0, and a night finished before the shop was ever opened was saved as earned credits only, dropping the 300 grant.

Fix: `hub-model.ts` gains `isFreshProgress` and `withStart(progress, start)`. The hub applies `withStart` on load and on `refresh`; results apply it before `applyResult`; the shop reuses `isFreshProgress`. The grant comes from `getCampaign().start`, falling back to `DEFAULT_START_CREDITS` (300). Storage is not rewritten by the hub.
