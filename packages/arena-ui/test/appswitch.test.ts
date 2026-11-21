import { describe, expect, it } from 'vitest';
import { appChoices, appTitle, currentApp } from '../src/arena/appswitch';
import { emptyVM, loadSnapshot } from '../src/arena/model';
import type { ArenaState } from '../src/api/types';

const apps = [
  { id: 'orders', label: 'Orders', stages: [{ id: 'intake', label: 'Intake', icon: 'i', workAnimation: 'x' }, { id: 'ship', label: 'Ship', icon: 's', workAnimation: 'y' }] },
  { id: 'inbox', label: 'Inbox', stages: ['Receive', 'Sort'] },
];

describe('app switcher helpers', () => {
  it('normalises /api/apps with object and string stages', () => {
    const c = appChoices(apps);
    expect(c.map((x) => x.id)).toEqual(['orders', 'inbox']);
    expect(c[0]!.stageLabels).toEqual(['Intake', 'Ship']);
    expect(c[1]!.stageLabels).toEqual(['Receive', 'Sort']);
  });
  it('ignores junk entries and non-arrays', () => {
    expect(appChoices(null)).toEqual([]);
    expect(appChoices([{ label: 'x' }, null, { id: 'a' }]).map((x) => x.id)).toEqual(['a']);
  });
  it('titles apps from the server label', () => {
    expect(appTitle({ id: 'orders', label: 'Orders', stageLabels: [] })).toBe('Haunted Orders');
    expect(appTitle({ id: 'inbox', label: 'Haunted Inbox', stageLabels: [] })).toBe('Haunted Inbox');
  });
  it('reads the current app from state', () => {
    expect(currentApp({ app: 'inbox' })).toBe('inbox');
    expect(currentApp(null)).toBe('');
  });
  it('takes stage names and icons from state for each app', () => {
    const vm = emptyVM();
    const mk = (i: number): ArenaState => ({ stages: apps[i]!.stages, lanes: [], wave: null } as unknown as ArenaState);
    loadSnapshot(vm, mk(0), 0);
    expect(vm.stages.map((s) => s.label)).toEqual(['Intake', 'Ship']);
    loadSnapshot(vm, { ...mk(0), stages: [{ id: 'receive', label: 'Receive', icon: 'r', workAnimation: 'z' }] } as ArenaState, 0);
    expect(vm.stages[0]!.id).toBe('receive');
  });
});
