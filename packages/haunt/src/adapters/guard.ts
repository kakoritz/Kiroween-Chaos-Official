// H9.2: Haunt only targets localhost by default. A non-local upstream needs `--i-own-this` (the owner says it is theirs).
import { isIP } from 'node:net';

const LOCAL_NAMES = new Set(['localhost', 'ip6-localhost', 'host.docker.internal']);

/** True for loopback names and addresses: localhost, *.localhost, 127.0.0.0/8, ::1 and ::ffff:127.x. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (LOCAL_NAMES.has(h) || h.endsWith('.localhost')) return true;
  const v4 = h.startsWith('::ffff:') ? h.slice(7) : h;
  if (isIP(v4) === 4) return v4.split('.')[0] === '127';
  return h === '::1';
}

export class NonLocalTargetError extends Error {
  constructor(readonly target: string) {
    super(`refusing non-local target ${target}: Haunt only targets localhost. Pass --i-own-this if you own it and may break it.`);
    this.name = 'NonLocalTargetError';
  }
}

/** Throws `NonLocalTargetError` when `url` is not local and `iOwnThis` is not set. Returns the parsed URL. */
export function assertLocalTarget(url: string, iOwnThis = false): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`bad target url ${url}`); }
  if (!iOwnThis && !isLocalHost(u.hostname)) throw new NonLocalTargetError(`${u.protocol}//${u.host}`);
  return u;
}
