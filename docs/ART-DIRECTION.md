# Art direction: fun cartoon, not placeholder boxes

Owner: Lane B. Read this before drawing anything. The goal is the look of a polished indie flash-style game: chunky, expressive, funny. Judges score Design at 20%.

## What is possible (honest)

- Kiro writes code, not pixels. It can produce **vector art as SVG and code-driven animation**, and it can look good if we iterate on screenshots. It cannot paint raster art by itself.
- Expect a charming "indie cartoon" look, not hand-painted studio art. Quality comes from a strict style guide, a reusable rig, and several look-and-fix loops.
- **Allowed art sources (the owner approved on 2026-11-20):** (1) art drawn in code (SVG, CSS, Canvas), always used for the **skeletons, the bosses and the main creatures**; (2) **CC0 sprite packs for minor creatures and props** (for example Kenney or OpenGameArt CC0 packs). Every CC0 asset must be listed with pack name, author, licence (must say CC0 or Public Domain) and URL in `docs/ASSETS.md` **before** it is committed. No asset without a clear licence. No AI-generated art or audio.
- **Consistency rule for CC0 art:** it must be re-styled to match the style guide (same outline color and thickness added in code, same palette via tint or filter, same size class). If a pack cannot be made to match, draw the creature in code instead.
- **Minor creatures** that may use CC0 art: Imp, Goblin, Gargoyle, Mummy, Will-o'-Wisp, Doppelganger, Poltergeist props, and background props (barrels, candles, cobwebs). The skeleton workers, Reaper, Wraith, Banshee, Zombie, Ghost, Witch, Werewolf and all three bosses stay drawn in code.

## Style guide (follow exactly)

- **Outlines:** 4 px dark purple-black (`#14101f`), rounded joins, on every shape.
- **Colors:** flat fills from the palette in `ui-spec.md`, plus **one shade layer** (darker, offset) and **one rim highlight**. No gradients except glows.
- **Proportions:** big heads, small bodies (head is 35% of height). Big round eye sockets with small pupils that look at things. Chunky hands.
- **Faces carry the story:** every state has a face (grin, worry, shock, dizzy, sad, smug).
- **Motion principles:** anticipation (wind-up), squash and stretch, overshoot and settle, follow-through (bones lag the body), secondary motion (jaw, antenna, cloak). Ease curves, never linear.
- **Juice:** screen shake on crashes (small, respects reduced motion), sparkles on cheers, puffs of dust on landings, number pops.
- **Silhouette test:** every creature must be recognizable as a black silhouette at 56 px tall.

## The skeleton rig (build once, reuse for all five tiers)

SVG groups with pivots: skull, jaw, ribcage, pelvis, two upper arms, two lower arms, two hands, two upper legs, two lower legs, two feet. Each is a separate group with a pivot point, so poses are transform sets and animation is tweening between poses.

Required poses: idle (breathe), walk, work-per-`workAnimation`, cheer, worry, fail slump, collapse (bones fly apart with physics-lite), reassemble (bones fly back, bounce), halted, sleep.
Draw each part once to an offscreen canvas for speed, or keep as DOM SVG if the frame rate holds.

**Tier looks (same rig, different dressing):**

| Tier | Look |
|---|---|
| Rookie | Cracked skull, one eye socket bigger, wobbly walk, a sticky note on the forehead, no gear |
| Retrier | Tiny lantern on a belt, determined brow |
| Journaler | A spellbook hanging at the hip, round glasses |
| Reconciler | Spellbook and a wax seal medal, tidy bow tie |
| Phoenix | All five gear pieces, a flame-colored scarf and a small golden crown, confident grin |

## Creature designs (silhouette notes)

Reaper: tall hooded cloak, huge scythe. Wraith: floating wisp with chain tail. Banshee: wide-mouth screamer with long hair. Zombie: hunched, one arm longer, slow droop. Ghost: classic sheet with a "404" scribble. Goblin: small, big ears, giant coin sack. Imp: small red, pointed tail, spanner. Gargoyle: stone wings, squat. Poltergeist: floating cluster of objects. Doppelganger: two overlapping translucent copies. Witch: pointy hat, bubbling green swirl. Mummy: bandage tangles. Werewolf: howling profile against a moon. Will-o'-Wisp: small blue flame with eyes. Bosses are three times larger with a crown or banner.
Each creature has: idle, enter, act, exit. Each has a face that reacts to success or failure ("oops" when the skeleton recovers).

## Sprite lab first (quality gate)

Build `packages/arena-ui/lab.html` (a hidden page) that shows **every character, every pose and every creature animation**, with buttons to play them. Build it **before** the arena.

Quality gate, in order:
1. Skeleton rig with idle, walk, cheer, collapse, reassemble. Screenshot and review.
2. Five tier dressings. Screenshot and review.
3. Reaper, Zombie, Ghost, Wraith, Poltergeist, Doppelganger, Lich. Screenshot and review.
4. The remaining creatures.
Each step: render, take a screenshot, critique it against this guide (is it chunky, readable, funny?), fix, repeat at most 3 loops, then move on. Do not spend more than a day on art before the arena works end to end.

## Backgrounds and props

Crypt in layered parallax: far wall with arches, mid stone pillars, near floor tiles. Torches with flame animation. Cobwebs, candles, bones, barrels. Provider door with a glowing keyhole. Scrolls with wax seals. Draw once, reuse.

## Fallbacks if art is behind

1. Keep the rig and simplify dressings.
2. Reuse the Reaper sprite recolored for other creatures with a different prop and face.
3. Use CC0 sprites for more creatures than the minor list (record each in `docs/ASSETS.md`).
Never ship plain squares or text placeholders in the video.
