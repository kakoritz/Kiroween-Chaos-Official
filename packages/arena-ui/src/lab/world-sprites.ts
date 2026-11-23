/// <reference lib="dom" />
// Lab entries for the world and transit creatures (PT-ART, TV3-U10). The art itself lives in arena/world-events.ts and is what the
// arena draws; this file only registers it so lab.html shows each one idle and acting, with its prop.
import { registerSprite, type AnimDef } from './registry';
import { WORLD_ACT_MS, drawWorldCreature, drawWorldProp, worldProp, type WorldId } from '../arena/world-events';

interface WorldDef { id: WorldId; name: string; fault: string; does: string }

export const WORLD_SPRITES: WorldDef[] = [
  { id: 'scarecrow', name: 'Scarecrow', fault: 'wrong_address', does: 'Points the courier the wrong way with a signpost.' },
  { id: 'black_cat', name: 'Black Cat', fault: 'no_answer', does: 'Crosses the path. Nobody is home, or the gate is shut.' },
  { id: 'phantom_car', name: 'Phantom Car', fault: 'car_accident', does: 'Lurches into the road. CRUNCH.' },
  { id: 'prankster', name: 'Prankster', fault: 'order_typo', does: 'A pumpkin that swaps the order for the wrong one.' },
  { id: 'storm_crow', name: 'Storm Crow', fault: 'weather', does: 'Brings a storm cloud and lightning over the road (weather).' },
  { id: 'pothole_imp', name: 'Pothole Imp', fault: 'road_hazard', does: 'Pops out of a pothole with a cone (road hazard).' },
  { id: 'fuel_wraith', name: 'Fuel Wraith', fault: 'out_of_gas', does: 'Drinks the tank dry (out of gas).' },
  { id: 'lost_parcel_ghoul', name: 'Lost Parcel Ghoul', fault: 'not_on_truck', does: 'Runs off with the parcel (not on the truck).' },
];

const anims: AnimDef[] = [
  { id: 'idle', label: 'Idle', loop: true, duration: 2000 },
  { id: 'act', label: 'Act', loop: false, duration: WORLD_ACT_MS },
];

for (const w of WORLD_SPRITES) {
  registerSprite({
    id: `world-${w.id}`,
    name: w.name,
    group: 'creature',
    anims: anims.map((a) => ({ ...a })),
    draw(ctx, anim, p, o) {
      const acted = anim.id === 'act';
      ctx.save();
      if (o.silhouette) ctx.filter = 'brightness(0)';
      ctx.translate(-o.size * 0.12, 0);
      drawWorldCreature(ctx, w.id, p, acted, o.size * 0.7);
      ctx.restore();
      if (acted && !o.silhouette) drawWorldProp(ctx, worldProp(w.id, w.fault, 0, p * WORLD_ACT_MS), o.size * 0.28, o.size * 0.3, o.size * 0.7);
    },
  });
}
