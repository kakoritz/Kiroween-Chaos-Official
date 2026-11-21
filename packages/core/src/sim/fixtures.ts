// The fixture scenarios of contract/STORYBOARDS.md, built with the lane planner. Nothing here is typed event by event.
// tools/make-fixtures.ts writes these to contract/fixtures/*.jsonl.
import { TIER_ORDER, TIERS, type HauntEvent, type TierId } from '@haunt/shared';
import type { ArmSpec } from './plan';
import { assembleWave, assignSeq, BASE_TS, planWave, type BossSpec, type WaveSpec } from './wave';
import { decorateV11 } from './v11';
import { V11_FIXTURES } from './fixtures-v11';

const SEED = 7;
const when = (order: number, stage: string, delay: number, attempt = 1): ArmSpec['when'] => ({ order, stage, attempt, delay });
const arm = (id: string, fault: string, extra: Partial<ArmSpec> = {}): ArmSpec => ({ id, fault, source: 'demo', ...extra });
const crashAtPayment = (id: string, order: number, delay: number): ArmSpec =>
  arm(id, 'crash', { point: 'after_effect_before_journal', creature: 'reaper', when: when(order, 'payment', delay) });

function spec(over: Partial<WaveSpec> & { orders: number }): WaveSpec {
  return { app: 'orders', tiers: TIER_ORDER, seed: SEED, pace: 2, ...over };
}

function single(s: WaveSpec, arms: Record<number, ArmSpec[]> = {}, bosses: BossSpec[] = []): HauntEvent[] {
  return assignSeq(assembleWave(planWave(s, arms, bosses), BASE_TS));
}

// Beats shared by hero-crash and full: a crash at Payment on the Rookie (lane 1) and Phoenix (lane 5) lanes.
const heroArms = (): Record<number, ArmSpec[]> => ({ 1: [crashAtPayment('hero-1', 1, 600)], 5: [crashAtPayment('hero-5', 1, 700)] });

// Stacked chaos on the Phoenix lane at Payment: Zombie, then Ghost during recovery, then Reaper.
const stackedArms = (order: number): ArmSpec[] => [
  arm('stack-1', 'timeout', { creature: 'zombie', when: when(order, 'payment', 1000) }),
  arm('stack-2', 'http_404', { creature: 'ghost', scope: 'inner', when: when(order, 'payment', 2500) }),
  arm('stack-3', 'crash', { creature: 'reaper', when: when(order, 'payment', 4000) }),
];

export const FIXTURES: Record<string, () => HauntEvent[]> = {
  calm: () => single(spec({ orders: 4 })),

  'hero-crash': () => assignSeq(decorateV11(single(spec({ orders: 5 }), heroArms()), { pace: 2 })),

  'stacked-chaos': () => single(spec({ orders: 4 }), { 5: stackedArms(1) }),

  'boss-power': () => single(spec({ orders: 4 }), {}, [{ fault: 'boss_power_outage', warnAt: 9000 }]),

  meltdown: () =>
    single(spec({ orders: 4 }), {
      1: [arm('melt-1', 'malformed_payload', { creature: 'witch', when: when(1, 'intake', 5) })],
      2: [arm('melt-2', 'http_429', { creature: 'goblin', when: when(1, 'payment', 600) })],
      5: [
        arm('melt-5a', 'malformed_payload', { creature: 'witch', when: when(1, 'intake', 5) }),
        arm('melt-5b', 'http_429', { creature: 'goblin', when: when(2, 'payment', 600) }),
      ],
    }),

  full: () =>
    single(
      spec({ orders: 9 }),
      { ...heroArms(), 5: [...heroArms()[5], ...stackedArms(4)] },
      [{ fault: 'boss_power_outage', warnAt: 100_000 }],
    ),

  parked: () => single(spec({ orders: 3 }), { 5: [arm('park-5', 'internet_outage', { creature: 'banshee', when: when(1, 'payment', 600) })] }),

  breaker: () => single(spec({ orders: 3 }), { 5: [arm('brk-5', 'endpoint_down', { creature: 'gargoyle', when: when(1, 'dispatch', 600) })] }),

  absorbed: () =>
    single(spec({ orders: 3 }), {
      1: [arm('abs-1', 'disk_full', { creature: 'mummy', when: when(1, 'payment', 600) })],
      2: [arm('abs-2', 'slow_link', { creature: 'zombie', when: when(1, 'payment', 600) })],
      3: [arm('abs-3', 'disk_full', { creature: 'mummy', when: when(1, 'payment', 600) })],
    }),

  deferred: () =>
    single(spec({ orders: 3 }), {
      5: [arm('def-5', 'http_404', { creature: 'ghost', when: when(1, 'intake', 300) })],
      3: [arm('def-3', 'hazard_event', { creature: 'werewolf', when: when(1, 'payment', 300) })],
    }),

  'boss-internet': () => single(spec({ orders: 4 }), {}, [{ fault: 'boss_internet_outage', warnAt: 9000 }]),

  'boss-storm': () => single(spec({ orders: 4 }), {}, [{ fault: 'boss_hazard_storm', warnAt: 9000 }]),

  inbox: () =>
    single(
      spec({ app: 'inbox', tiers: ['rookie', 'phoenix'], orders: 4 }),
      {
        1: [arm('in-1', 'crash', { point: 'after_effect_before_journal', creature: 'reaper', when: when(2, 'reply', 600) })],
        2: [arm('in-2', 'crash', { point: 'after_effect_before_journal', creature: 'reaper', when: when(2, 'reply', 600) })],
      },
    ),

  stress: () => single(spec({ orders: 4, pace: 1, progressMs: 20 })),

  'part-added': () => {
    const s = spec({ orders: 2, tiers: ['rookie', 'phoenix'] });
    const events = single(s);
    const at = events.find((e) => e.type === 'lane_ready' && e.lane === 2)!.ts + 3000;
    const parts = ['retry', 'journal', 'idempotency'];
    parts.forEach((part, i) => {
      events.push({ seq: 0, ts: at + i * 400, type: 'part_added', wave: 1, lane: 1, detail: { part, source: 'hardening_spec', spec: 'hardening-run1' } });
    });
    events.sort((a, b) => a.ts - b.ts || (a.type === 'wave_end' ? 1 : 0) - (b.type === 'wave_end' ? 1 : 0));
    return assignSeq(events);
  },

  loop: () => {
    const lanes: TierId[] = ['rookie', 'phoenix'];
    const crashEvery = (id: string, orders: number): ArmSpec[] =>
      Array.from({ length: orders }, (_, k) => crashAtPayment(`${id}-${k + 1}`, k + 1, 600));
    const orders = 3;
    // Wave 1: both lanes crash at Payment on every order.
    const w1 = planWave(spec({ orders, tiers: lanes, waveNo: 1 }), { 1: crashEvery('loop1-1', orders), 2: crashEvery('loop1-2', orders) });
    const e1 = assembleWave(w1, BASE_TS, true);
    const endTs = e1[e1.length - 1].ts;
    // Between waves: the reviewer writes a hardening spec, Kiro applies it (recorded), three parts appear on lane 1.
    const mid: HauntEvent[] = [];
    let ts = endTs + 1500;
    mid.push({ seq: 0, ts, type: 'hardening_spec', wave: 1, detail: { spec: 'hardening-run1', title: 'Harden the Rookie payment path', path: '.kiro/specs/hardening-run1/', findings: 4 } });
    ts += 6000;
    mid.push({ seq: 0, ts, type: 'fix_applied', wave: 1, detail: { spec: 'hardening-run1', files: [{ path: 'apps/haunted-orders/src/bots/rookie.ts', add: 14, del: 3 }], recorded: true } });
    for (const part of ['retry', 'journal', 'idempotency']) {
      ts += 1200;
      mid.push({ seq: 0, ts, type: 'part_added', wave: 1, lane: 1, detail: { part, source: 'hardening_spec', spec: 'hardening-run1' } });
    }
    // Wave 2: the same crashes. Lane 1 now runs with the Reconciler parts under its own name.
    const hardened = TIERS.reconciler.parts;
    const w2 = planWave(
      spec({ orders, tiers: ['reconciler', 'phoenix'], waveNo: 2, laneReady: [{ tier: 'rookie', label: 'Rookie', parts: [...hardened] }, { tier: 'phoenix', label: TIERS.phoenix.label, parts: [...TIERS.phoenix.parts] }] }),
      { 1: crashEvery('loop2-1', orders), 2: crashEvery('loop2-2', orders) },
    );
    const e2 = assembleWave(w2, ts + 4000, false);
    return assignSeq([...e1, ...mid, ...e2]);
  },
};

Object.assign(FIXTURES, V11_FIXTURES);

export const FIXTURE_NAMES = Object.keys(FIXTURES);
