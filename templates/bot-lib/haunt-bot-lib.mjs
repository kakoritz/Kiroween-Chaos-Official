// haunt-bot-lib: four small helpers that harden a bot (no dependencies). Written next to your bot by `npm run bot:new`.
//   import { idempotencyKey, hardenedCall, journal } from './haunt-bot-lib.mjs';
//   const key = idempotencyKey(order, 'pay');                       // same text every try, so a retry never charges twice
//   await hardenedCall(provider, '/charges', { lane, order }, { key }); // timeout, retry with backoff, honors Retry-After
//   const j = journal(dir); if (!j.has(key)) { await ...; j.mark(key); } // survives a crash: the next start skips what is done
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A stable key for one effect of one order. `n` numbers the effects of a stage (0 for the first). */
export const idempotencyKey = (order, stage, n = 0) => `${order}:${stage}:${n}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryable = (status) => status === 429 || status >= 500;

/**
 * POST `body` to `${provider}${path}` with an idempotency key, a timeout and retries.
 * Retries on a timeout, a network error, 429 and 5xx (waits Retry-After when the server sends it, else backs off). Other 4xx fail at once.
 * Returns the parsed JSON. Throws the last error after `tries` attempts.
 */
export async function hardenedCall(provider, path, body, { key, timeoutMs = 1500, tries = 4, baseMs = 100 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const headers = { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) };
      const res = await fetch(`${provider}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      if (res.status < 300) return await res.json();
      last = new Error(`provider answered ${res.status}`);
      if (!retryable(res.status)) throw Object.assign(last, { fatal: true });
      const ra = Number(res.headers.get('retry-after'));
      if (i < tries - 1) await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 5000) : baseMs * 2 ** i);
    } catch (e) {
      if (e && e.fatal) throw e;
      last = e;
      if (i < tries - 1) await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}

/** A tiny journal on disk: `mark(key)` after an effect is done, `has(key)` before doing it again after a restart. */
export function journal(dir) {
  mkdirSync(dir, { recursive: true });
  const file = (k) => join(dir, `${Buffer.from(k).toString('base64url')}.done`);
  return { has: (k) => existsSync(file(k)), mark: (k) => { writeFileSync(file(k), ''); } };
}
