// Tiny client for the live server: JSON calls plus an SSE collector. Node 20, no dependencies.
export function client(base) {
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { status: r.status, json };
  };
  const events = [];
  const waiters = [];
  const ctl = new AbortController();
  (async () => {
    try {
      const r = await fetch(base + '/api/events', { signal: ctl.signal });
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (!data) continue;
          let ev; try { ev = JSON.parse(data); } catch { continue; }
          events.push(ev);
          for (const w of [...waiters]) if (w.pred(ev)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.t); w.res(ev); }
        }
      }
    } catch { /* closed */ }
  })();
  return {
    get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), del: (p) => call('DELETE', p),
    events,
    /** Resolve with the first event after `from` (index into events) that satisfies pred. */
    waitFor(pred, ms = 120000, from = 0) {
      const hit = events.slice(from).find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((res, rej) => {
        const w = { pred, res, t: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error('timeout waiting for event')); }, ms) };
        waiters.push(w);
      });
    },
    close: () => ctl.abort(),
  };
}
