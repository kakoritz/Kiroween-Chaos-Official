// PK-U3: talks to the live server's monkey routes. Absent (the mock server, the hosted page): every call rejects with `unavailable`.
export interface MonkeyClient {
  getState(): Promise<unknown>;
  start(mode: string): Promise<unknown>;
  stop(): Promise<unknown>;
  preview(mode: string): Promise<unknown>;
}

export class MonkeyUnavailable extends Error {
  constructor(msg = 'The chaos monkey needs the live server (npm run live). The hosted demo does not run it.') { super(msg); }
}

export function monkeyClient(base: string | null, fetchFn: typeof fetch = fetch): MonkeyClient {
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    if (base === null) throw new MonkeyUnavailable();
    let r: Response;
    try { r = await fetchFn(`${base}${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }); }
    catch { throw new MonkeyUnavailable(); }
    if (r.status === 404) throw new MonkeyUnavailable('This server has no monkey routes. Start the live server: npm run live');
    const j = await r.json().catch(() => ({})) as { error?: { message?: string } };
    if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
    return j;
  };
  return {
    getState: () => call('GET', '/api/monkey?audit=12'),
    start: (mode) => call('POST', '/api/monkey/start', { mode }),
    stop: () => call('POST', '/api/monkey/stop', {}),
    preview: (mode) => call('GET', `/api/monkey/preview?mode=${encodeURIComponent(mode)}`),
  };
}
