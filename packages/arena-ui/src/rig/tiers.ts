/// <reference lib="dom" />
// Registers the five tier dressings as lab sprites (UI-ART2). Same rig and animations as
// the bare skeleton; the dressing rides on the parts.
import { ANIMS, frameFor } from './skeleton';
import { drawSkeleton } from './draw';
import { TIER_IDS, TIER_LABEL } from './dress';
import { registerSprite } from '../lab/registry';

for (const tier of TIER_IDS) {
  registerSprite({
    id: `tier-${tier}`,
    name: `${TIER_IDS.indexOf(tier) + 1}. ${TIER_LABEL[tier]}`,
    group: 'tier',
    anims: ANIMS.map((a) => ({ ...a })),
    draw(ctx, anim, p, opts) {
      // The Rookie walks with a wobble: a sway about the feet, twice per stride.
      const wobble = tier === 'rookie' && anim.id === 'walk' ? Math.sin(p * Math.PI * 4) * 0.07 : 0;
      ctx.save();
      ctx.translate(0, opts.size / 2);
      ctx.rotate(wobble);
      ctx.translate(0, -opts.size / 2);
      drawSkeleton(ctx, frameFor(anim.id, p), opts, tier);
      ctx.restore();
    },
  });
}
