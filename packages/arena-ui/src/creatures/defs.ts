// Creature catalogue for the sprite lab (UI-ART3). Pure data, no DOM, so tests can read it.
import type { AnimDef, SpriteGroup } from '../lab/registry';

export type CreatureId = 'reaper' | 'zombie' | 'ghost' | 'wraith' | 'poltergeist' | 'doppelganger' | 'lich'
  | 'banshee' | 'goblin' | 'imp' | 'gargoyle' | 'mummy' | 'werewolf' | 'wisp' | 'witch';

export interface CreatureDef {
  id: CreatureId;
  name: string;
  group: SpriteGroup;
  /** One line from ART-DIRECTION.md / ui-spec.md on what the creature does to the lane. */
  does: string;
  anims: AnimDef[];
}

const idle = (duration = 2000): AnimDef => ({ id: 'idle', label: 'Idle', loop: true, duration });
const act = (id: string, label: string, duration: number, loop = false): AnimDef => ({ id, label, loop, duration });

export const CREATURES: CreatureDef[] = [
  { id: 'reaper', name: 'Reaper', group: 'creature', does: 'Swings a scythe. Skeleton collapses.', anims: [idle(2400), act('swing', 'Swing', 900)] },
  { id: 'zombie', name: 'Zombie', group: 'creature', does: 'Shambles in and sits on the progress bar.', anims: [act('shamble', 'Shamble', 1600, true), act('sit', 'Sit on bar', 2600, true)] },
  { id: 'ghost', name: 'Ghost', group: 'creature', does: 'Touches the scroll. It fades with a 404 stamp.', anims: [idle(2200), act('touch', 'Touch', 1100)] },
  { id: 'wraith', name: 'Wraith', group: 'creature', does: 'Yanks the lane power cable. Torch snuffs.', anims: [idle(2400), act('yank', 'Yank cable', 1000)] },
  { id: 'poltergeist', name: 'Poltergeist', group: 'creature', does: 'Flings the in-tray off the lane.', anims: [idle(1200), act('fling', 'Fling cabinet', 1200)] },
  { id: 'doppelganger', name: 'Doppelganger', group: 'creature', does: 'Copies the scroll. A second one appears.', anims: [idle(2400), act('copy', 'Copy scroll', 1400)] },
  { id: 'lich', name: 'Lich', group: 'boss', does: 'Boss. Snuffs every torch, dims every lane.', anims: [idle(3000), act('cast', 'Power cut', 1800)] },
  { id: 'banshee', name: 'Banshee', group: 'creature', does: 'Screams. The connection line shatters.', anims: [idle(2400), act('scream', 'Scream', 1200)] },
  { id: 'goblin', name: 'Goblin', group: 'creature', does: 'Hoards the tokens in a sack.', anims: [idle(1400), act('hoard', 'Hoard tokens', 1600)] },
  { id: 'imp', name: 'Imp', group: 'creature', does: 'Throws a spanner into the gears.', anims: [idle(1200), act('throw', 'Throw spanner', 1000)] },
  { id: 'gargoyle', name: 'Gargoyle', group: 'creature', does: 'Lands in front of the door and blocks it.', anims: [idle(2600), act('land', 'Land and block', 1200)] },
  { id: 'mummy', name: 'Mummy', group: 'creature', does: 'Wraps the journal in bandages.', anims: [idle(2200), act('wrap', 'Wrap journal', 1600)] },
  { id: 'werewolf', name: 'Werewolf', group: 'creature', does: 'Howls. A full moon rises over the road.', anims: [idle(1800), act('howl', 'Howl', 1800)] },
  { id: 'wisp', name: "Will-o'-Wisp", group: 'creature', does: 'Leads the courier off the path.', anims: [idle(2000), act('lead', 'Lead astray', 1600)] },
  { id: 'witch', name: 'Witch', group: 'creature', does: 'Hexes the scroll. The text scrambles.', anims: [idle(2200), act('hex', 'Hex scroll', 1400)] },
];
export const creatureById = (id: CreatureId): CreatureDef => CREATURES.find((c) => c.id === id)!;
