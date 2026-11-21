import type { ConnectionStatus } from './api/types';

export interface ModeBadge {
  /** Short text on the badge. Icon plus text, never color alone. */
  label: string;
  /** Glyph shown before the label (color-blind safe pairing). */
  icon: string;
  /** CSS modifier: mock | live | browser | offline | warn */
  tone: 'mock' | 'live' | 'browser' | 'offline' | 'warn';
  title: string;
}

/** Pure mapping from (mode from `hello`, connection status) to what the badge shows. */
export function modeBadge(mode: string | null, status: ConnectionStatus): ModeBadge {
  if (status === 'version_mismatch') {
    return { label: 'Version mismatch', icon: '!', tone: 'warn', title: 'The server speaks a different contract version.' };
  }
  if (status === 'closed') {
    return { label: 'Disconnected', icon: 'x', tone: 'offline', title: 'Not connected.' };
  }
  if (!mode || status === 'connecting') {
    return { label: 'Connecting', icon: '~', tone: 'offline', title: 'Waiting for the server.' };
  }
  if (status === 'reconnecting') {
    return { label: 'Reconnecting', icon: '~', tone: 'warn', title: `Lost the ${mode} stream. Retrying.` };
  }
  switch (mode) {
    case 'live':
      return { label: 'LIVE', icon: '●', tone: 'live', title: 'Real engine, real bots, real provider.' };
    case 'mock':
      return { label: 'MOCK', icon: '◆', tone: 'mock', title: 'Simulated server. Same events, no real processes.' };
    case 'browser':
      return { label: 'BROWSER', icon: '▲', tone: 'browser', title: 'Engine running inside this page. No server.' };
    default:
      return { label: mode.toUpperCase(), icon: '?', tone: 'warn', title: 'Unknown mode.' };
  }
}

/** Demo script requested by the URL (`?demo=hero`), or null. Only known-safe script names pass. */
export function demoFromQuery(search: string): string | null {
  const v = new URLSearchParams(search).get('demo');
  return v && /^[a-z0-9_-]{1,32}$/i.test(v) ? v : null;
}

/** Optional `?api=http://127.0.0.1:7070` override for the HTTP transport. Loopback only. */
export function apiBaseFromQuery(search: string): string {
  const v = new URLSearchParams(search).get('api');
  if (!v) return '';
  try {
    const u = new URL(v);
    const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    return u.protocol === 'http:' && loopback ? u.origin : '';
  } catch {
    return '';
  }
}
