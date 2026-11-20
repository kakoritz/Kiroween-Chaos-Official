// Static catalogs served by the live server: creatures, apps, stages, gear (contract/CONTRACT.md, PROTOCOL.md rule 19).
import { FAULTS, BOSSES } from '../../../haunt/src/chaos/catalog';

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
  lich: ['Lich', 'Boss: a long power outage on every lane.'],
  banshee_queen: ['Banshee Queen', 'Boss: a long internet outage on every lane.'],
  headless_horseman: ['Headless Horseman', 'Boss: a hazard storm on every lane.'],
};

const BOSS_CREATURE: Record<string, [string, string]> = {
  boss_power_outage: ['lich', 'world'],
  boss_internet_outage: ['banshee_queen', 'network'],
  boss_hazard_storm: ['headless_horseman', 'world'],
};

export function buildCreatures(): Creature[] {
  const out = new Map<string, Creature>();
  for (const f of FAULTS) {
    const c = out.get(f.creature);
    if (c) c.causes.push(f.id);
    else {
      const [label, description] = LABELS[f.creature] ?? [f.creature, ''];
      out.set(f.creature, { id: f.creature, label, family: f.family, sprite: f.creature, causes: [f.id], boss: false, apps: ['orders', 'inbox'], description });
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

export interface StageView { id: string; label: string; icon: string; workAnimation: string }

export const APP_STAGES: Record<AppId, StageView[]> = {
  orders: [
    { id: 'intake', label: 'Order intake', icon: 'mail', workAnimation: 'read_mail' },
    { id: 'account', label: 'Account creation', icon: 'user', workAnimation: 'fill_form' },
    { id: 'payment', label: 'Payment processing', icon: 'card', workAnimation: 'swipe_card' },
    { id: 'confirmation', label: 'Confirmation', icon: 'envelope', workAnimation: 'write_letter' },
    { id: 'dispatch', label: 'Dispatch to delivery', icon: 'box', workAnimation: 'load_scooter' },
    { id: 'updates', label: 'Order updates', icon: 'bubbles', workAnimation: 'send_bubbles' },
    { id: 'tracking', label: 'Delivery tracking', icon: 'road', workAnimation: 'scooter_road' },
    { id: 'handoff', label: 'Handoff', icon: 'door', workAnimation: 'doorstep' },
  ],
  inbox: [
    { id: 'fetch', label: 'Fetch', icon: 'mail', workAnimation: 'read_mail' },
    { id: 'classify', label: 'Classify', icon: 'brain', workAnimation: 'think' },
    { id: 'ticket', label: 'Ticket', icon: 'ticket', workAnimation: 'file_ticket' },
    { id: 'draft', label: 'Draft', icon: 'envelope', workAnimation: 'write_letter' },
    { id: 'reply', label: 'Reply', icon: 'plane', workAnimation: 'send_letter' },
    { id: 'archive', label: 'Archive', icon: 'archive', workAnimation: 'archive_box' },
  ],
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
