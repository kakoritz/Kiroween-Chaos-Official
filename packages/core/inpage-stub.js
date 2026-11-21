/*
 * window.__haunt stub for the in-page transport (contract/PROTOCOL.md, "window.__haunt").
 * It forwards every call to the mock server, so Lane B can build and test the `inpage`
 * transport switch before the browser target (E12) exists.
 *
 * Usage: load this file (script tag or import), then call `window.__haunt.getState()`.
 * Set `window.__HAUNT_BASE__ = 'http://127.0.0.1:7070'` first to change the mock address.
 * Each function returns a Promise of the JSON body, or rejects with {code, message}.
 * Plain ES2020, no dependencies, no build step.
 */
export function createHaunt(options = {}) {
  const base = (options.base || 'http://127.0.0.1:7070').replace(/\/+$/, '');
  const doFetch = options.fetch || ((...a) => globalThis.fetch(...a));

  async function call(method, path, body) {
    let res;
    try {
      res = await doFetch(base + path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw { code: 'unreachable', message: String((e && e.message) || e) };
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    if (!res.ok) {
      const err = data && data.error ? data.error : { code: 'http_' + res.status, message: String(data) };
      throw { code: err.code, message: err.message };
    }
    return data;
  }

  const get = (p) => call('GET', p);
  const post = (p, b) => call('POST', p, b || {});
  const q = (o) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null) s.set(k, String(v));
    const t = s.toString();
    return t ? '?' + t : '';
  };

  function subscribe(fn, opts = {}) {
    const ctl = new AbortController();
    (async () => {
      try {
        const res = await doFetch(base + '/api/events' + q({ since: opts.since }), { signal: ctl.signal });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = block.split('\n').find((l) => l.startsWith('data:'));
            if (line) fn(JSON.parse(line.slice(5).trim()));
          }
        }
      } catch {
        /* aborted or dropped: the caller resubscribes with since */
      }
    })();
    return () => ctl.abort();
  }

  return {
    getHealth: () => get('/api/health'),
    getState: () => get('/api/state'),
    startWave: (opts) => post('/api/wave/start', opts),
    stopWave: () => post('/api/wave/stop'),
    setSpeed: (speed) => post('/api/speed', { speed }),
    chaos: (opts) => post('/api/chaos', opts),
    setChaosMode: (opts) => post('/api/chaos/mode', opts),
    startDemo: (script) => post('/api/demo/start', typeof script === 'string' ? { script } : script),
    stopDemo: () => post('/api/demo/stop'),
    getCreatures: () => get('/api/creatures'),
    getApps: () => get('/api/apps'),
    setApp: (app) => post('/api/app', { app }),
    getLaneStage: (lane, stage, order) => get(`/api/lane/${lane}/stage/${stage}${q({ order })}`),
    getLaneLog: (lane, opts) => get(`/api/lane/${lane}/log${q(opts)}`),
    getLaneOrders: (lane) => get(`/api/lane/${lane}/orders`),
    getLedger: () => get('/api/ledger'),
    getWaves: () => get('/api/waves'),
    getReport: (n) => get(`/api/waves/${n}/report`),
    getCompare: (n, m) => get(`/api/waves/${n}/compare/${m}`),
    getPostmortem: (n) => get(`/api/waves/${n}/postmortem`),
    getHardening: (n) => get(`/api/waves/${n}/hardening`),
    subscribe,
  };
}

if (typeof window !== 'undefined' && !window.__haunt) {
  window.__haunt = createHaunt({ base: window.__HAUNT_BASE__ });
}
