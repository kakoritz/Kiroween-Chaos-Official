// covers: haunted-house/R5.6
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installHosted, RECORDED_LABEL } from '../src/onboarding/hosted';

afterEach(() => { vi.useRealTimers(); });

describe('hosted demo (in-page mock)', () => {
  it('installs window.__haunt in browser mode with the three demo scripts', async () => {
    const win: any = {};
    const h = installHosted(win);
    expect(win.__haunt).toBe(h);
    expect(await h.getHealth()).toMatchObject({ ok: true, mode: 'browser' });
    const st = await h.getState();
    expect(st.demo.scripts).toEqual(['hero', 'full', 'loop']);
    expect(st.demo.running).toBeNull();
  });

  it('plays the hero recording through subscribe with no network', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const h = installHosted({} as any);
    const seen: any[] = [];
    h.subscribe((e) => seen.push(e));
    expect(seen[0].type).toBe('hello');
    await h.startDemo('hero' as never);
    await vi.advanceTimersByTimeAsync(120_000);
    const types = new Set(seen.map((e) => e.type));
    expect(types.has('wave_start')).toBe(true);
    expect(seen.length).toBeGreaterThan(50);
    expect((await h.getState()).demo.running === 'hero' || types.has('wave_end')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('rejects an unknown script with a contract error', async () => {
    const h = installHosted({} as any);
    await expect(h.startDemo('nope' as never)).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('labels the runs as recorded', () => {
    expect(RECORDED_LABEL).toBe('Recorded run');
  });
});

describe('hosted badge placement', () => {
  it('is a footer strip that the page reserves, not a corner overlay', async () => {
    const { mountRecordedBadge } = await import('../src/onboarding/hosted');
    const added: string[] = [];
    const doc: any = { createElement: () => ({ setAttribute(_k: string, v: string) { this.style = v; }, style: '' }), body: { classList: { add: (c: string) => added.push(c) }, appendChild() {} } };
    const el: any = mountRecordedBadge(doc);
    expect(added).toContain('hosted');
    expect(el.style).toContain('left:0;right:0;bottom:0');
    expect(el.style).not.toContain('left:8px');
  });
});
