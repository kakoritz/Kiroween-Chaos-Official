// The mock, in the page. Implements window.__haunt (contract mode `browser`) on top of the same Hub, Player,
// ChaosSim and query code the mock server uses, so the hosted demo needs no server and makes no network call.
// Everything it plays is a recorded or scaled fixture run, and the page labels it "Recorded run".
import { APPS, CONTRACT_VERSION, stageKind, CREATURES, PARTS, TIERS, TIER_ORDER, type AppId, type HauntEvent } from '@haunt/shared';
import { FIXTURES } from '../sim/fixtures';
import { Hub } from './hub';
import { CAPTION_SCRIPTS, loadCaptions } from '../live/captions';
import { OutcomeTable } from './outcomes';
import { ChaosSim, DEMO_SCRIPTS, MockError, Player, fixtureFor, scaledWave } from './play';
import { hardening, laneLaps, laneLog, laneOrderRecord, laneOrders, ledger, postmortem, stageDetail, waveCompare, waveLaps, waveReport, waveStars, wavesList } from './queries';

export const INPAGE_SPEEDS = [0.5, 1, 2, 4];

const reject = (code: string, message: string): Promise<never> => Promise.reject({ code, message });
const guard = async <T>(fn: () => T): Promise<T> => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof MockError) return reject(e.code, e.message);
    throw e;
  }
};

/** Build the in-page mock. `outcomeRows` is the parsed packages/core/mock/outcomes.json. */
export function createInPageMock(outcomeRows: ConstructorParameters<typeof OutcomeTable>[0]) {
  const table = new OutcomeTable(outcomeRows);
  const hub = new Hub();
  const player = new Player(hub);
  const chaos = new ChaosSim(hub, player, table);

  const startWave = (events: HauntEvent[], speed: number, script?: string): number => {
    const n = ++hub.waveNo;
    player.play(events, n, { speed, script });
    return n;
  };

  const startDemo = (script: string, speed: number): void => {
    const name = fixtureFor(script);
    if (!name) throw new MockError(400, 'bad_request', `script must be one of ${[...DEMO_SCRIPTS, ...Object.keys(FIXTURES)].join(', ')}`);
    if (hub.running && !player.active) hub.emit({ type: 'wave_end', wave: hub.wave!.n, detail: { summary: {}, stopped: true } });
    const events = FIXTURES[name]();
    const app = events.find((e) => e.type === 'hello')?.app as AppId | undefined;
    if (app && app !== hub.app) { hub.app = app; hub.reset(); }
    startWave(events, speed, script);
  };

  const summarize = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const l of hub.lanes.values()) out[l.lane] = { score: l.score, ...l.counts };
    return out;
  };

  const stopWave = (): void => {
    player.clear();
    if (hub.running) hub.emit({ type: 'wave_end', wave: hub.wave!.n, detail: { summary: summarize(), stopped: true } });
    hub.demoRunning = null;
  };

  const wave = (n: number) => {
    const w = hub.waves.find((x) => x.n === n);
    return w ?? undefined;
  };

  const stateBody = () => {
    const w = hub.wave;
    return {
      contractVersion: CONTRACT_VERSION, mode: 'browser', app: hub.app,
      wave: w ? { n: w.n, running: hub.running, seed: w.seed, speed: hub.speed, orders: w.orders, tiers: w.tiers, startedAt: w.startedAt } : null,
      chaos: hub.chaosMode,
      stages: APPS[hub.app].stages.map((s) => ({ id: s.id, label: s.label, icon: s.icon, workAnimation: s.workAnimation, role: s.role, kind: stageKind(s.role) })),
      lanes: [...hub.lanes.values()].sort((a, b) => a.lane - b.lane),
      boss: hub.boss,
      demo: { scripts: DEMO_SCRIPTS, running: hub.demoRunning },
      apps: Object.values(APPS).map((a) => ({ id: a.id, label: a.label, stages: a.stages.map((s) => ({ id: s.id, label: s.label, role: s.role, kind: stageKind(s.role) })) })),
      tiers: TIER_ORDER.map((t) => ({ id: t, label: TIERS[t].label, parts: TIERS[t].parts })),
      parts: Object.values(PARTS),
      scripts: DEMO_SCRIPTS,
      speeds: INPAGE_SPEEDS,
      speed: hub.speed,
      script: hub.demoRunning,
      outcomeRows: table.rows.length,
    };
  };

  const notReady = () => reject('not_ready', 'no such wave');

  const api = {
    getHealth: async () => ({ ok: true, mode: 'browser', contractVersion: CONTRACT_VERSION }),
    getState: async () => stateBody(),
    startWave: async (o: Record<string, any> = {}) => guard(() => {
      if (hub.running) throw new MockError(409, 'wave_running', 'a wave is already running');
      const app = (o.app ?? hub.app) as AppId;
      if (app !== 'orders' && app !== 'inbox') throw new MockError(400, 'bad_request', 'app must be orders or inbox');
      const speed = o.speed ?? hub.speed;
      if (!INPAGE_SPEEDS.includes(speed)) throw new MockError(400, 'bad_request', 'bad speed');
      if (app !== hub.app) { hub.app = app; hub.reset(); }
      const tiers = o.tiers === 'allPhoenix' ? 'allPhoenix' : 'race';
      const pace = o.pace === 'show' || o.pace === 'slow' ? o.pace : 'normal';
      const n = startWave(scaledWave({ orders: o.orders ?? 12, seed: o.seed ?? 7, tiers, lanes: o.lanes ?? 5, pace, app }), speed);
      return { wave: n };
    }),
    stopWave: async () => { stopWave(); return {}; },
    setSpeed: async (speed: number) => guard(() => {
      if (!INPAGE_SPEEDS.includes(speed)) throw new MockError(400, 'bad_request', 'bad speed');
      hub.speed = speed;
      return { speed };
    }),
    chaos: async (o: Record<string, any> = {}) => guard(() => chaos.inject(o)),
    setChaosMode: async (o: Record<string, any>) => guard(() => {
      if (!['off', 'manual', 'random'].includes(o.mode)) throw new MockError(400, 'bad_request', 'mode must be off, manual or random');
      hub.chaosMode = { mode: o.mode, frequency: o.frequency ?? hub.chaosMode.frequency, seed: o.seed ?? hub.chaosMode.seed };
      return {};
    }),
    startDemo: async (script: string, speed?: number) => guard(() => {
      if (hub.running && player.active) throw new MockError(409, 'wave_running', 'a wave is already running');
      startDemo(script, speed ?? hub.speed);
      return { ok: true, script, speed: speed ?? hub.speed };
    }),
    stopDemo: async () => { stopWave(); return {}; },
    getCreatures: async () => CREATURES,
    getCaptions: async (script: string) => {
      if (!(CAPTION_SCRIPTS as readonly string[]).includes(script)) throw new MockError(404, 'not_found', 'unknown demo script');
      return loadCaptions(script);
    },
    getApps: async () => Object.values(APPS).map((a) => ({ id: a.id, label: a.label, stages: a.stages.map((s) => ({ id: s.id, label: s.label, icon: s.icon, workAnimation: s.workAnimation, role: s.role, kind: stageKind(s.role) })) })),
    setApp: async (app: string) => guard(() => {
      if (app !== 'orders' && app !== 'inbox') throw new MockError(400, 'bad_request', 'app must be orders or inbox');
      if (hub.running) throw new MockError(409, 'wave_running', 'a wave is running');
      hub.app = app;
      hub.reset();
      return {};
    }),
    getLaneStage: async (lane: number, stage: string, order?: string) => stageDetail(hub, lane, stage, order),
    getLaneLog: async (lane: number, o: { order?: string; since?: number } = {}) => laneLog(hub, lane, o.order, o.since),
    getLaneOrders: async (lane: number) => laneOrders(hub, lane),
    getLaneOrder: async (lane: number, order: string) => laneOrderRecord(hub, lane, order) ?? reject('not_found', 'no such order on this lane'),
    getLaneLaps: async (lane: number) => laneLaps(hub, lane),
    getWaveLaps: async (n: number) => { const w = wave(n); return w ? waveLaps(hub, w) : notReady(); },
    getWaveStars: async (n: number) => { const w = wave(n); return w ? waveStars(hub, w) : notReady(); },
    decide: async () => reject('no_decision', 'no decision is pending for that order'),
    getLedger: async () => ledger(hub),
    getWaves: async () => wavesList(hub),
    getReport: async (n: number) => { const w = wave(n); return w ? waveReport(hub, w) : notReady(); },
    getCompare: async (n: number, m: number) => { const a = wave(n); const b = wave(m); return a && b ? waveCompare(hub, a, b) : notReady(); },
    getPostmortem: async (n: number) => { const w = wave(n); return w && w.endedAt !== undefined ? postmortem(hub, w) : notReady(); },
    getHardening: async (n: number) => { const w = wave(n); return w && w.endedAt !== undefined ? hardening(hub, w) : notReady(); },
    subscribe: (fn: (e: any) => void, opts: { since?: number } = {}): (() => void) => {
      fn({ type: 'hello', contractVersion: CONTRACT_VERSION, mode: 'browser', seq: hub.seq, ts: Date.now(), app: hub.app, stages: APPS[hub.app].stages.map((s) => ({ id: s.id, label: s.label, kind: stageKind(s.role) })) });
      if (opts.since !== undefined) for (const e of hub.buffer) if (e.seq > opts.since) fn(e);
      hub.subs.add(fn);
      return () => { hub.subs.delete(fn); };
    },
  };
  return { api, hub };
}
