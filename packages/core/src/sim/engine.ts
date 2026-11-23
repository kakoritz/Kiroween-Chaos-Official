// Deterministic live engine: plays a tournament round through the lane planner in virtual time, so a seed always gives the same events.
// The real engine (runtime.ts) spawns bots and sleeps in wall-clock time, so the same seed grades differently from run to run. This one
// reads the lane's policy overlay (`lane-<n>.policy.json`) like a bot does at start, plans the whole round and records it at once.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIERS, type PartId } from '../../../haunt/src/shared/catalog';
import { parsePolicy, type Policy } from '../../../haunt/src/sdk/policy';
import { roundPlan, tierOfLane } from '../../../haunt/src/tournament/rounds';
import type { LiveEngine, WaveSettings } from '../live/server';
import type { ArmSpec } from './plan';
import { assembleWave, BASE_TS, planWave } from './wave';

const PACE: Record<WaveSettings['pace'], 1 | 2 | 3> = { normal: 1, show: 2, slow: 3 };

export interface SimEngineOptions {
  /** Folder of `lane-<n>.policy.json` overlays (the lessons dir of the server). */
  policyDir: string;
}

function readPolicy(dir: string, lane: number): Policy | undefined {
  const f = join(dir, `lane-${lane}.policy.json`);
  if (!existsSync(f)) return undefined;
  try { return parsePolicy(JSON.parse(readFileSync(f, 'utf8'))); } catch { return undefined; }
}

export function createSimEngine(o: SimEngineOptions): LiveEngine {
  let wave0 = 0;
  // Simulated parts per lane (the Rookie overlay). Lives only in this engine: a lane runs with its tier's parts plus these, `lane_ready` keeps the tier.
  let grants: Readonly<Record<number, readonly PartId[]>> = {};
  return {
    setPartOverlay(g) { grants = g; },
    startWave(wave, settings, record, end) {
      const t = settings.tournament;
      if (!t) throw new Error('the simulated engine plays tournament rounds only');
      const live = t.lanes;
      const cfg = { lanes: live.length, orders: settings.orders, intensity: t.level };
      const storm = roundPlan(settings.seed, t.round, cfg);
      const arms: Record<number, ArmSpec[]> = {};
      live.forEach((lane, i) => {
        arms[i + 1] = storm.map((p, k) => ({
          id: `r${t.round}-${k + 1}-l${lane}`, fault: p.fault, source: p.fuzz ? 'fuzz' as const : 'random' as const, when: { order: p.order, stage: p.stage, attempt: 1, delay: 250 },
          ...(p.point ? { point: p.point } : {}), ...(p.outageMs !== undefined ? { outageMs: p.outageMs } : {}),
          ...(p.fuzz ? { extra: { unknown: true, fingerprint: p.fuzz.fingerprint, fuzz: { fault: p.fuzz.fault, ...(p.fuzz.status !== undefined ? { status: p.fuzz.status } : {}) } } } : {}),
        }));
      });
      const tiers = live.map(tierOfLane);
      const extra = live.map((l) => (grants[l] ?? []).filter((p, i, a) => a.indexOf(p) === i));
      const spec = { app: settings.app, tiers, seed: settings.seed, orders: settings.orders, pace: PACE[settings.pace], waveNo: wave, floor: true, policies: live.map((l) => readPolicy(o.policyDir, l)) };
      const granted = extra.some((x) => x.length);
      const pw = planWave(granted ? {
        ...spec,
        laneParts: tiers.map((t, i) => (extra[i]!.length ? [...new Set([...TIERS[t].parts, ...extra[i]!])] : undefined)),
        laneReady: tiers.map((t, i) => ({ tier: t, label: TIERS[t].label, parts: [...new Set([...TIERS[t].parts, ...extra[i]!])] })),
      } : spec, arms);
      const ts0 = BASE_TS + wave0;
      wave0 += pw.endAt + 10_000;
      for (const e of assembleWave(pw, ts0, false)) {
        if (typeof e.lane !== 'number') continue;
        record({ ...e, lane: String(live[e.lane - 1]!) } as never);
      }
      setTimeout(() => end?.(), 0);
    },
    stopWave() { /* a round is played at once */ },
    setChaosMode() { /* the plan owns the chaos */ },
  };
}
