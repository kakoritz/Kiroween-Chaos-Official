import { HttpApi, type HttpOptions } from './http';
import { InPageApi, type HauntInPage } from './inpage';
import type { ArenaApi } from './types';

export * from './types';
export { HttpApi, type HttpOptions } from './http';
export { InPageApi, type HauntInPage } from './inpage';
export { SseParser } from './sse';

export interface CreateApiOptions extends HttpOptions {
  /** Force a transport. Default: `inpage` when `inpage` object is given, otherwise `http`. */
  transport?: 'http' | 'inpage';
  /** window.__haunt, passed in so this module never touches `window`. */
  inpage?: HauntInPage | null;
}

export const DEFAULT_SERVER = 'http://127.0.0.1:7070';

/**
 * Transport resolution order from ui-spec section 9: `?api=` base if present, else same origin,
 * else the default loopback server. A candidate is accepted when GET /api/health answers.
 */
export async function resolveHttpBase(
  apiFromQuery: string,
  f: typeof fetch = (...a) => fetch(...a),
): Promise<string> {
  const candidates = apiFromQuery ? [apiFromQuery] : ['', DEFAULT_SERVER];
  for (const base of candidates) {
    try {
      const res = await f(base + '/api/health');
      if (res.ok && typeof ((await res.json()) as { mode?: unknown } | null)?.mode === 'string') return base;
    } catch { /* try the next candidate */ }
  }
  return candidates[0] ?? '';
}

/**
 * The one transport switch (PROTOCOL.md). Everything above this call is identical
 * for `mock`, `live` and `browser`: the mode only comes back in the `hello` event.
 */
export function createApi(opts: CreateApiOptions = {}): ArenaApi {
  const transport = opts.transport ?? (opts.inpage ? 'inpage' : 'http');
  if (transport === 'inpage') {
    if (!opts.inpage) throw new Error('inpage transport requested but window.__haunt is missing');
    return new InPageApi(opts.inpage);
  }
  return new HttpApi(opts);
}
