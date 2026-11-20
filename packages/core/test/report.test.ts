import { afterEach, describe, expect, it } from 'vitest';
import { LiveServer } from '../src/live';

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
