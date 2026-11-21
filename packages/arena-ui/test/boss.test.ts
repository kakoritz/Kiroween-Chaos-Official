import { describe, expect, it } from 'vitest';
import { applyBossEvent, bossAnnouncement, bossView, emptyBoss, secondsLeft, survivedAge, warnRealMs } from '../src/arena/boss';
import { applyEvent, emptyVM } from '../src/arena/model';
import type { ArenaEvent } from '../src/api/types';

const ev = (type: string, detail: Record<string, unknown> = {}) => ({ type, detail } as unknown as ArenaEvent);

describe('boss banner model', () => {
  it('scales the warning by wave speed', () => {
    expect(warnRealMs(8000, 2)).toBe(4000);
    expect(warnRealMs(8000, 0)).toBe(8000);
  });

  it('walks warning, start, end', () => {
    const b = emptyBoss();
    applyBossEvent(b, ev('boss_warning', { boss: 'boss_power_outage', startsInMs: 5000 }), 1000, 1);
    expect(b.phase).toBe('warning');
    expect(secondsLeft(b, 3000)).toBe(3);
    expect(bossView(b, 1000).status).toBe('arrives in 5');
    expect(bossView(b, 1000).name).toBe('Lich');
    applyBossEvent(b, ev('boss_start'), 6000, 1);
    expect(bossView(b, 6000).status).toBe('ACTIVE');
    applyBossEvent(b, ev('boss_end'), 9000, 1);
    expect(bossView(b, 9000).visible).toBe(false);
  });

  it('announces and flashes survivors on boss_end', () => {
    const vm = emptyVM();
    applyEvent(vm, ev('boss_warning', { boss: 'boss_internet_outage', startsInMs: 4000 }), 0);
    expect(bossAnnouncement('warning', vm.boss)).toContain('Banshee Queen');
    applyEvent(vm, ev('boss_end'), 100);
    expect(vm.boss.phase).toBe('none');
    expect(survivedAge({ survivedAt: 100 }, 100)).toBe(0);
    expect(survivedAge({ survivedAt: 100 }, 5000)).toBeNull();
  });
});
