// Contract mode `browser` (PROTOCOL.md): the engine runs in a Web Worker on this page and the arena talks to
// it through window.__haunt. No HTTP. This entry installs window.__haunt, then loads the normal arena.
import { BrowserJournal } from '../../haunt/src/browser/journal';
import { InPageHaunt } from '../../haunt/src/browser/inpage';
import { PageLedger } from '../../haunt/src/browser/ledger';
import { WorkerProcess } from '../../haunt/src/browser/worker-host';
import { CONTRACT_VERSION, type HauntInPage } from '../src/api';

const LANE = '1';
const unsupported = (name: string) => () =>
  Promise.reject({ code: 'unsupported_in_browser', message: `${name} is not available in browser mode` });

const journal = new BrowserJournal(window.localStorage, `haunt-journal-${LANE}`);
const ledger = new PageLedger();
let armed = false;

const proc: WorkerProcess = new WorkerProcess({
  lane: LANE,
  spawn: () => new Worker(new URL('../../../site/worker.ts', import.meta.url), { type: 'module' }) as never,
  journal,
  ledger,
  onHook: (point) => {
    if (armed && point === 'after_effect_before_journal') {
      armed = false;
      haunt.publish({ type: 'crash', detail: { point } });
      setTimeout(() => proc.restart(), 300);
      return 'kill';
    }
    return 'continue';
  },
  onEvent: (m) => { haunt.publish(m); },
});

const haunt = new InPageHaunt({
  getState: () => ({ running: proc.alive, generation: proc.generation, ledger: ledger.list() }),
  startWave: () => {
    if (!proc.alive) proc.start();
    return { started: true };
  },
  chaos: (o) => {
    if (o.fault === 'crash') armed = true;
    return { armed };
  },
});
haunt.publish({ type: 'hello', mode: 'browser', contractVersion: CONTRACT_VERSION });

const facade: HauntInPage = {
  getHealth: async () => ({ ok: true, mode: 'browser', contractVersion: CONTRACT_VERSION }),
  getState: async () => haunt.getState(),
  startWave: async (o) => haunt.startWave((o ?? {}) as Record<string, unknown>),
  stopWave: async () => { proc.kill(); return { stopped: true }; },
  chaos: async (o) => haunt.chaos((o ?? {}) as Record<string, unknown>),
  setSpeed: unsupported('setSpeed'),
  setChaosMode: unsupported('setChaosMode'),
  startDemo: unsupported('startDemo'),
  stopDemo: async () => ({ stopped: true }),
  getCreatures: async () => [],
  getApps: async () => [],
  setApp: unsupported('setApp'),
  getLaneStage: unsupported('getLaneStage'),
  getLaneLog: async () => [],
  getLaneOrders: async () => [],
  getLaneOrder: unsupported('getLaneOrder'),
  getLaneLaps: async () => [],
  getWaveLaps: unsupported('getWaveLaps'),
  getWaveStars: unsupported('getWaveStars'),
  decide: unsupported('decide'),
  getLedger: async () => ledger.list(),
  getWaves: async () => [],
  getReport: unsupported('getReport'),
  getCompare: unsupported('getCompare'),
  getPostmortem: unsupported('getPostmortem'),
  getHardening: unsupported('getHardening'),
  subscribe: (fn, opts) => haunt.subscribe(fn as never, opts),
};
(window as unknown as { __haunt: HauntInPage }).__haunt = facade;

// Demo scripts need the mock server; keep the arena quiet unless the URL names one.
{
  const u = new URL(window.location.href);
  if (!u.searchParams.has('demo')) { u.searchParams.set('demo', 'off'); window.history.replaceState(null, '', u); }
}

void import('./main').then(() => {
  // The browser target has no server to start a wave, so the bot starts with the page (?autostart=off to hold).
  if (new URLSearchParams(window.location.search).get('autostart') !== 'off') proc.start();
});
