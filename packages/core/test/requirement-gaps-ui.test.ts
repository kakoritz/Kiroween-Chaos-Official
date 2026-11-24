// covers: haunted-house/R5.2 haunted-house/R5.3 playtest-v2/R8.3 playtest-v2/R9.3
// Spec: .kiro/specs/test-gaps. Core-lane test that reads the arena model and sources; it does not edit packages/arena-ui.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEvent, emptyVM, type ArenaVM } from '../../arena-ui/src/arena/model';
import { BADGE_TIP, badgeTitle } from '../../arena-ui/src/arena/gearmenu';
import type { ArenaEvent } from '../../arena-ui/src/api/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

const stages = ['intake', 'account', 'payment'].map((id) => ({ id, label: id, icon: 'mail', workAnimation: 'read_mail' }));
const ev = (type: string, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq: 1, ts: 0, type, wave: 1, lane: 1, ...extra });
function crashedLane(): ArenaVM {
  const vm = emptyVM(); vm.stages = stages;
  applyEvent(vm, ev('wave_start', { lane: undefined, detail: { lanes: 1, speed: 1 } }), 0);
  applyEvent(vm, ev('order_start', { order: 'o1', detail: { index: 1, total: 1 } }), 1);
  applyEvent(vm, ev('stage_start', { stage: 'intake', detail: { attempt: 1 } }), 2);
  applyEvent(vm, ev('stage_done', { stage: 'intake', detail: { skipped: false } }), 3);
  applyEvent(vm, ev('stage_start', { stage: 'account', detail: { attempt: 1 } }), 4);
  applyEvent(vm, ev('stage_done', { stage: 'account', detail: { skipped: false } }), 5);
  applyEvent(vm, ev('stage_start', { stage: 'payment', detail: { attempt: 1 } }), 6);
  applyEvent(vm, ev('process_dead', { stage: 'payment', detail: { restartInMs: 1000 } }), 7);
  return vm;
}

describe('R5.2 a crash shows the ghost dying and the crash point highlighted', () => {
  it('process_dead puts the lane in dead mode and marks the stage that was running as dead', () => {
    const l = crashedLane().lanes[0]!;
    expect(l.mode).toBe('dead');
    expect(l.chips).toEqual(['done', 'done', 'dead']);
    expect(l.restartInMs).toBe(1000);
  });
});

describe('R5.3 a resumed bot rises and replays completed steps greyed out', () => {
  it('process_up reassembles the ghost, and journal-skipped stages show as replayed, not done', () => {
    const vm = crashedLane();
    applyEvent(vm, ev('process_up'), 8);
    const l = vm.lanes[0]!;
    expect(l.mode).toBe('reassembling');
    applyEvent(vm, ev('order_start', { order: 'o1', detail: { index: 1, total: 1 } }), 9);
    applyEvent(vm, ev('stage_start', { stage: 'intake', detail: { attempt: 1 } }), 10);
    applyEvent(vm, ev('stage_done', { stage: 'intake', detail: { skipped: true } }), 11);
    applyEvent(vm, ev('stage_start', { stage: 'account', detail: { attempt: 1 } }), 12);
    applyEvent(vm, ev('stage_done', { stage: 'account', detail: { skipped: true } }), 13);
    expect(l.chips.slice(0, 2)).toEqual(['replayed', 'replayed']);
  });
});

describe('R8.3 Play demo and Stop demo buttons and the mode badge tooltip', () => {
  const main = read('packages/arena-ui/app/main.ts');
  it('the page has a Play demo button and a Stop demo button that starts hidden', () => {
    expect(main).toMatch(/id="demo-open"[^>]*>[^<]*Play demo/);
    expect(main).toMatch(/class="[^"]*hidden[^"]*" id="demo-stop"[^>]*>[^<]*Stop demo/);
    expect(main).toMatch(/await api\.stopDemo\(\)/);
  });
  it('the mode badge tooltip explains the modes', () => {
    expect(BADGE_TIP).toMatch(/MOCK/);
    expect(badgeTitle('Live.')).toContain('MOCK = recorded replay');
  });
});

describe('R9.3 npm run demo and npm run fresh-clone keep working', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  it('both scripts exist and point at files that exist', () => {
    for (const name of ['demo', 'fresh-clone']) {
      const file = /node (\S+)/.exec(pkg.scripts[name] ?? '')?.[1];
      expect(file, name).toBeTruthy();
      expect(existsSync(join(root, file!)), file).toBe(true);
    }
  });
  it('fresh-clone ends in demo --check, and npm run verify runs demo --check on every change', () => {
    expect(read('tools/fresh-clone.mjs')).toMatch(/'demo', '--', '--check'/);
    expect(read('tools/verify.mjs')).toMatch(/'demo', '--', '--check'/);
    expect(read('tools/demo.mjs')).toMatch(/args\.includes\('--check'\)/);
  });
});
