// Static catalogs served by the live server: creatures, apps, stages, gear (contract/CONTRACT.md, PROTOCOL.md rule 19).
import { FAULTS, BOSSES } from '../../../haunt/src/chaos/catalog';
import { INBOX_STAGES, ORDERS_STAGES, stageKind, type StageKind } from '../../../haunt/src/shared/catalog';

export const CONTRACT_VERSION = 1;
export type AppId = 'orders' | 'inbox';

export interface Creature {
  id: string;
  label: string;
  family: string;
  sprite: string;
  causes: string[];
  boss: boolean;
  apps: AppId[];
  description: string;
}

const LABELS: Record<string, [string, string]> = {
  reaper: ['Reaper', 'Kills the bot process.'],
  wraith: ['Wraith', 'Cuts the power. A slow restart.'],
  banshee: ['Banshee', 'The internet goes away.'],
  zombie: ['Zombie', 'Slow or stalled calls.'],
  ghost: ['Ghost', 'The endpoint answers 404.'],
  goblin: ['Goblin', 'Rate limited with 429.'],
  imp: ['Imp', 'The server answers 500.'],
  gargoyle: ['Gargoyle', 'The endpoint is down.'],
  poltergeist: ['Poltergeist', 'An input file goes missing.'],
  doppelganger: ['Doppelganger', 'The same request arrives twice.'],
  witch: ['Witch', 'A payload is corrupted.'],
  mummy: ['Mummy', 'The disk is full.'],
  werewolf: ['Werewolf', 'A hazard event hits delivery.'],
  will_o_wisp: ['Will-o-the-wisp', 'The driver cannot be reached.'],
  scarecrow: ['Scarecrow', 'Points the scooter down the wrong road, or holds it up.'],
  black_cat: ['Black Cat', 'Sits on the doorstep so nobody answers, or shuts the gate.'],
  phantom_car: ['Phantom Car', 'Crashes at the door and blocks the road.'],
  storm_crow: ['Storm Crow', 'Calls a storm over the delivery road.'],
  pothole_imp: ['Pothole Imp', 'Digs a pothole in the middle of the road.'],
  fuel_wraith: ['Fuel Wraith', 'Drinks the scooter dry.'],
  lost_parcel_ghoul: ['Lost Parcel Ghoul', 'Steals the parcel off the truck.'],
  prankster: ['Prankster', 'Swaps the items on the order so the wrong thing is made.'],
  lich: ['Lich', 'Boss: a long power outage on every lane.'],
  banshee_queen: ['Banshee Queen', 'Boss: a long internet outage on every lane.'],
  headless_horseman: ['Headless Horseman', 'Boss: a hazard storm on every lane.'],
};

const BOSS_CREATURE: Record<string, [string, string]> = {
  boss_power_outage: ['lich', 'world'],
  boss_internet_outage: ['banshee_queen', 'network'],
  boss_hazard_storm: ['headless_horseman', 'world'],
};

/** World creatures that only exist in the orders app (contract/V1_1.md section 8). */
const ORDERS_ONLY = new Set(['scarecrow', 'black_cat', 'phantom_car', 'prankster', 'storm_crow', 'pothole_imp', 'fuel_wraith', 'lost_parcel_ghoul']);

export function buildCreatures(): Creature[] {
  const out = new Map<string, Creature>();
  for (const f of FAULTS) {
    const c = out.get(f.creature);
    if (c) c.causes.push(f.id);
    else {
      const named = LABELS[f.creature];
      if (!named) throw new Error('creature display name missing in catalog: ' + f.creature);
      const [label, description] = named;
      out.set(f.creature, { id: f.creature, label, family: f.family, sprite: f.creature, causes: [f.id], boss: false, apps: ORDERS_ONLY.has(f.creature) ? ['orders'] : ['orders', 'inbox'], description });
    }
  }
  for (const b of BOSSES) {
    const [id, family] = BOSS_CREATURE[b]!;
    const [label, description] = LABELS[id]!;
    out.set(id, { id, label, family, sprite: id, causes: [b], boss: true, apps: ['orders', 'inbox'], description });
  }
  return [...out.values()];
}

export const CREATURES: readonly Creature[] = buildCreatures();
export const FAULT_IDS: ReadonlySet<string> = new Set(CREATURES.flatMap((c) => c.causes));

/** One stage as the server serves it: `kind` is the contract's stage kind (V1_2.md section 1). */
export interface StageView { id: string; label: string; icon: string; workAnimation: string; kind: StageKind }

export const APP_STAGES: Record<AppId, StageView[]> = {
  // The orders list comes from the one stage table (haunt/shared/catalog), so ids, labels and kinds cannot drift.
  orders: ORDERS_STAGES.map((d) => ({ id: d.id, label: d.label, icon: d.icon, workAnimation: d.workAnimation, kind: stageKind(d.role) })),
  inbox: INBOX_STAGES.map((d) => ({ id: d.id, label: d.label, icon: d.icon, workAnimation: d.workAnimation, kind: stageKind(d.role) })),
};

export const APPS = [
  { id: 'orders' as const, label: 'Orders', stages: APP_STAGES.orders },
  { id: 'inbox' as const, label: 'Inbox', stages: APP_STAGES.inbox },
];

export const PARTS: { id: string; label: string }[] = [
  { id: 'journal', label: 'Spellbook' },
  { id: 'idempotency', label: 'Seal' },
  { id: 'retry', label: 'Lantern' },
  { id: 'breaker', label: 'Shield' },
  { id: 'offline_queue', label: 'Coffin Stash' },
];

export const DEMO_SCRIPTS = ['hero', 'full', 'loop'] as const;
