# Third-party assets

Only CC0 or Public Domain assets are allowed (see `docs/ART-DIRECTION.md`). List each one **before** committing it.

## Third-party (CC0 / Public Domain)

| Asset | Pack | Author | Licence | URL | Used for |
|---|---|---|---|---|---|
| (none) | | | | | |

No image, audio, font or model files from outside this repo are committed. Re-check this table whenever a binary asset is added.

## Original assets (drawn or synthesised in code)

All art below is original, generated at runtime from code in `packages/arena-ui/src`. There are no image, audio or font files in the repo apart from review screenshots under `packages/arena-ui/docs/screens/`. No third-party licence applies.

### Skeleton rig and tier dressings

| Asset | Source | Notes |
|---|---|---|
| Skeleton rig (16 SVG-path parts, pivots) | `src/rig/skeleton.ts`, `src/rig/draw.ts` | Idle, walk, cheer, collapse, reassemble |
| Tier dressings (Rookie, Retrier, Journaler, Reconciler, Phoenix) | `src/rig/dress.ts`, `src/rig/tiers.ts` | Per-tier gear drawn on rig parts |

### Creatures (17)

Defined in `src/creatures/defs.ts`, drawn in `src/creatures/draw.ts`.

| Creature | Id | Group |
|---|---|---|
| Reaper | `reaper` | creature |
| Zombie | `zombie` | creature |
| Ghost | `ghost` | creature |
| Wraith | `wraith` | creature |
| Poltergeist | `poltergeist` | creature |
| Doppelganger | `doppelganger` | creature |
| Banshee | `banshee` | creature |
| Goblin | `goblin` | creature |
| Imp | `imp` | creature |
| Gargoyle | `gargoyle` | creature |
| Mummy | `mummy` | creature |
| Werewolf | `werewolf` | creature |
| Will-o'-Wisp | `wisp` | creature |
| Witch | `witch` | creature |
| Lich | `lich` | boss |
| Banshee Queen | `banshee_queen` | boss |
| Headless Horseman | `horseman` | boss |

### Backgrounds and props (UI-ART4)

Drawn in `src/props/draw.ts`, placed in the arena by `src/arena/scene.ts`.

| Asset | Id / function | Kind |
|---|---|---|
| Barrel | `barrel` | prop |
| Candles | `candles` | prop |
| Bones | `bones` | prop |
| Sealed scroll | `sealed-scroll` | prop |
| Torch | `torch` | prop |
| Keyhole door | `keyhole-door` | prop |
| Pillar | `pillar` / `pillar()` | prop and mid layer |
| Arch | `arch` / `archWall()` | prop and far wall layer |
| Floor tiles | `floorTiles()` | near floor layer |

### Sound

Synthesised with the Web Audio API (oscillators and noise) in `src/sound.ts`. No audio files.

### Review screenshots

PNG captures in `packages/arena-ui/docs/screens/` are taken from this project's own UI and are not shipped assets.
