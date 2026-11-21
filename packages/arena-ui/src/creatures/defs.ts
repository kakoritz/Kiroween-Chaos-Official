// Creature catalogue for the sprite lab (UI-ART3). Pure data, no DOM, so tests can read it.
import type { AnimDef, SpriteGroup } from '../lab/registry';

export type CreatureId = 'reaper' | 'zombie' | 'ghost' | 'wraith' | 'poltergeist' | 'doppelganger' | 'lich';

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
];

export const creatureById = (id: CreatureId): CreatureDef => CREATURES.find((c) => c.id === id)!;
