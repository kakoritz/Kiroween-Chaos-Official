import { afterEach, describe, expect, it } from 'vitest';
import { LiveServer } from '../src/live';
import { buildReport } from '../src/live/report';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

describe('live server: report and postmortem', () => {
  it('404 not_ready while running, then report JSON and markdown after stop', async () => {
    srv = new LiveServer({ staticDir: '/nonexistent' });
    const { url } = await srv.listen(0);
    await fetch(url + '/api/wave/start', { method: 'POST', body: JSON.stringify({ orders: 3, lanes: 2, seed: 5 }) });
    const early = await fetch(url + '/api/waves/1/report');
    expect(early.status).toBe(404);
    expect(((await early.json()) as any).error.code).toBe('not_ready');
    await fetch(url + '/api/wave/stop', { method: 'POST' });
    const rep = await fetch(url + '/api/waves/1/report');
    expect(rep.status).toBe(200);
    const j = (await rep.json()) as any;
    expect(j.run).toBe(1);
    expect(j.seed).toBe(5);
    expect(Array.isArray(j.matrix)).toBe(true);
    expect(j.recovery).toHaveProperty('p95');
    const pm = await fetch(url + '/api/waves/1/postmortem');
    expect(pm.headers.get('content-type')).toContain('text/markdown');
    expect(await pm.text()).toContain('# Wave 1 postmortem');
    expect((await fetch(url + '/api/waves/1/hardening')).status).toBe(404);
  });
});

describe('buildReport: failed vs lost', () => {
  const rec: any = { n: 1, grade: 'B', grades: {}, startedAt: 0, endedAt: 1, score: 0 };
  const ev = (type: string, lane: string, seq: number, order?: string, detail: any = {}) => ({ type, lane, seq, order, wave: 1, detail }) as any;

  it('a failed order is not lost, and fails only the press it follows', () => {
    const evs = [
      ev('chaos', '2', 1, undefined, { fault: 'crash' }),
      ev('order_failed', '2', 2, 'ord-0002'),
      ev('chaos', '2', 3, undefined, { fault: 'crash' }),
      ev('chaos', '1', 4, undefined, { fault: 'crash' }),
    ];
    const r = buildReport(rec, evs, { app: 'a', seed: 1 });
    expect(r.lost).toEqual([]);
    expect(r.matrix.map((m) => m.result)).toEqual(['fail', 'pass', 'pass']);
  });

  it('an abandoned order is lost', () => {
    const r = buildReport(rec, [ev('order_abandoned', '2', 5, 'ord-0009')], { app: 'a', seed: 1 });
    expect(r.lost).toEqual([{ order: 'ord-0009', reason: 'abandoned' }]);
  });
});