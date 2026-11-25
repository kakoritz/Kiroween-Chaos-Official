// Stream runs in the mock server and the in-page mock. Spec: .kiro/specs/stream-in-mock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockServer } from '../src/mock/server';
import { createInPageMock } from '../src/mock/inpage-mock';
import outcomes from '../mock/outcomes.json';

const STREAM = ['fetch', 'classify', 'draft', 'reply', 'archive'];
afterEach(() => { vi.useRealTimers(); });

describe('stream in the mock server', () => {
  // covers: stream-in-mock/R1.1, stream-in-mock/R1.2
  it('switches to Stream, lists it, and reports its five stages', async () => {
    const m = createMockServer({ port: 0 });
    const base = `http://127.0.0.1:${await m.listen()}`;
    try {
      const r = await fetch(`${base}/api/app`, { method: 'POST', body: JSON.stringify({ app: 'stream' }) });
      expect(r.status).toBe(200);
      const apps = (await (await fetch(`${base}/api/apps`)).json()) as any[];
      expect(apps.map((a) => a.id)).toContain('stream');
      const state = (await (await fetch(`${base}/api/state`)).json()) as any;
      expect(state.app).toBe('stream');
      expect(state.stages.map((s: any) => s.id)).toEqual(STREAM);
    } finally { await m.close(); }
  });
});

describe('stream in the in-page mock', () => {
  // covers: stream-in-mock/R2.1, stream-in-mock/R2.2
  it('runs a Stream wave with only Stream stage ids', async () => {
    vi.useFakeTimers();
    const { api } = createInPageMock(outcomes as never);
    const seen: any[] = [];
    api.subscribe((e: any) => seen.push(e));
    expect((await api.getApps()).map((a: any) => a.id)).toContain('stream');
    await api.setApp('stream');
    await api.startWave({ app: 'stream', orders: 2 });
    await vi.advanceTimersByTimeAsync(120_000);
    const stages = new Set(seen.filter((e) => typeof e.stage === 'string').map((e) => e.stage));
    expect(stages.size).toBeGreaterThan(0);
    for (const s of stages) expect(STREAM).toContain(s);
    expect((await api.getState()).app).toBe('stream');
  });
});
