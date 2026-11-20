// Main-thread page: owns the journal and the ledger, hosts the bot Worker, exposes window.__haunt.
import { BrowserJournal, InPageHaunt, PageLedger, WorkerProcess, installHaunt } from '../packages/haunt/src/browser';

const g = globalThis as any;
const doc = g.document;
const LANE = '1';
const journal = new BrowserJournal(g.localStorage, `haunt-journal-${LANE}`);
const ledger = new PageLedger();
const events: Record<string, unknown>[] = [];
let armed = false;

const proc: WorkerProcess = new WorkerProcess({
  lane: LANE,
  spawn: () => new g.Worker('worker.js') as never,
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
  onEvent: (m) => {
    haunt.publish(m);
    render();
  },
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
installHaunt(g, haunt);
haunt.subscribe((e) => events.push(e));

function render(): void {
  const rows = ledger.list();
  const charges = new Set(rows.filter((r) => r.kind === 'charge').map((r) => r.order));
  doc.getElementById('out').textContent =
    `mode: browser\ngeneration: ${proc.generation}  kills: ${proc.killCount}\n` +
    `ledger rows: ${rows.length}  orders charged: ${charges.size}  duplicate charges: ${rows.filter((r) => r.kind === 'charge').length - charges.size}\n\n` +
    events.slice(-12).map((e) => JSON.stringify(e)).join('\n');
}

doc.getElementById('start').onclick = () => { void haunt.startWave(); render(); };
doc.getElementById('crash').onclick = () => { void haunt.chaos({ fault: 'crash' }); render(); };
render();
