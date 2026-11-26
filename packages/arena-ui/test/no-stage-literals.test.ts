// The arena reads stage names, icons and wording from the app (modular-engine R7). Spec: .kiro/specs/modular-engine M4.
// A new app must look right with no UI edit, so UI code may not branch on a built-in stage id.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEvent, emptyVM, loadSnapshot, newLane } from '../src/arena/model';
import { ledgerKinds, isInboxVM } from '../src/arena/panels';
import { tickerLine } from '../src/arena/ticker';
import { vocabOf } from '../src/arena/vocab';

const SRC = resolve(__dirname, '../src');
const STAGES = ['intake', 'account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'dispatch', 'updates', 'ship', 'tracking', 'transit', 'handoff', 'fetch', 'classify', 'ticket', 'draft', 'reply', 'archive', 'login', 'ingest', 'validate', 'dedupe', 'triage', 'assign', 'sla', 'notify', 'escalate', 'resolve'];
const RE = new RegExp(`['"\`](${STAGES.join('|')})['"\`]`);
/** model.ts keeps the recorded-run legacy stage list (v1.0 streams carry no stage list). panels.ts names effect kinds (ticket, notify, dispatch): they share a word with some stages but are not stages. chain/examples.ts lists block library ids (validate, notify, archive), not app stages. */
const ALLOWED = new Set(['arena/model.ts', 'arena/panels.ts', 'chain/examples.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });
}

describe('arena UI is app-agnostic', () => {
  // covers: modular-engine/R7.4
  it('no UI file outside the allowed list names a built-in stage id', () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f);
      if (ALLOWED.has(rel)) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        if (RE.test(code) && !/data-act=|class="/.test(code)) bad.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(bad).toEqual([]);
  });

  const state = { app: 'coffee', stages: [{ id: 'read_request', label: 'Read request', role: 'input' }, { id: 'pay', label: 'Take payment', role: 'effect' }, { id: 'brew', label: 'Brew', role: 'work' }], lanes: [] };

  // covers: modular-engine/R7.1, R7.3
  it('a snapshot of an unknown app gives stage chips with fallbacks and its own app id', () => {
    const vm = emptyVM();
    loadSnapshot(vm, state as never, 0);
    expect(vm.app).toBe('coffee');
    expect(vm.stages.map((s) => s.label)).toEqual(['Read request', 'Take payment', 'Brew']);
    expect(vm.stages.every((s) => typeof s.workAnimation === 'string' && s.workAnimation !== '')).toBe(true);
    expect(isInboxVM(vm)).toBe(false);
  });

  // covers: modular-engine/R7.2
  it('wording of an unknown app is generic, not Orders; Stream has its own', () => {
    expect(vocabOf('coffee').unit).toBe('job');
    expect(vocabOf('stream').unit).toBe('video');
    const vm = emptyVM();
    loadSnapshot(vm, state as never, 0);
    applyEvent(vm, { seq: 1, ts: 1, type: 'order_start', wave: 1, lane: 1, order: 'cof-0001' } as never, 1);
    const line = tickerLine({ seq: 2, ts: 2, type: 'order_start', wave: 1, lane: 1, order: 'cof-0001' } as never, (id) => id, vm.app);
    expect(JSON.stringify(line)).not.toMatch(/grabbed order/);
  });

  // covers: modular-engine/R7.3
  it('the ledger shows the effect kinds an unknown app reports', () => {
    const vm = emptyVM();
    loadSnapshot(vm, state as never, 0);
    vm.lanes.push(newLane(1, vm.stages.length, 0));
    vm.lanes[0]!.ledger = { charge: { rows: 1, repeats: 0 }, notify: { rows: 1, repeats: 1 } } as never;
    expect(ledgerKinds(vm)).toEqual(['charge', 'notify']);
  });
});
