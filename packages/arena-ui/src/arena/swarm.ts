// TV3-U5: creature swarms (tournament-v3 spec section 7.1). Pure model: positions for the little attackers that orbit a
// harassed skeleton, dart in to peck, and dissipate in a puff when the problem is overcome. No canvas, no clock.

export interface Bug {
  /** Offset from the skeleton's torso in px. */
  x: number;
  y: number;
  /** 0..1 wing flap phase. */
  flap: number;
  /** 0..1: how far the bug is into a peck dive (0 orbiting). */
  peck: number;
  /** Alpha 0..1. */
  a: number;
  /** Radius scale. */
  s: number;
}

export interface SwarmInput {
  /** Fault depth and attempts widen the swarm. */
  depth: number;
  attempts?: number;
  /** Seconds-independent seed (stable per creature). */
  seed: number;
  /** ms since the creature appeared. */
  age: number;
  /** 0..1 progress of the exit (dissipate). 0 while the problem is open. */
  exit: number;
  /** The lane is dead or halted: the swarm lingers over the corpse, dimmed and slow. */
  corpse?: boolean;
  /** The fault has started acting: bugs dart in and peck. Before that they loom at a distance. */
  harass?: boolean;
  /** Divides animation time (wave speed). */
  speed?: number;
}

export const MAX_BUGS = 9;
export const SWARM_SAFETY_MS = 45000;

/** 3 to 9 attackers: a base of three, plus two per extra depth level, plus one per retry attempt. */
export function bugCount(depth: number, attempts = 0): number {
  return Math.max(3, Math.min(MAX_BUGS, 3 + Math.max(0, depth - 1) * 2 + Math.max(0, attempts)));
}

const hash = (n: number): number => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Where every bug is at this moment. Stable for the same input. */
export function swarmBugs(i: SwarmInput): Bug[] {
  const sp = Math.max(0.1, i.speed ?? 1);
  const n = bugCount(i.depth, i.attempts);
  const t = (i.age * sp) / 1000;
  const slow = i.corpse ? 0.35 : 1;
  const out: Bug[] = [];
  for (let k = 0; k < n; k++) {
    const h = hash(i.seed * 13 + k);
    const h2 = hash(i.seed * 31 + k * 7);
    const rate = (0.9 + h * 0.9) * slow;
    const ang = h * Math.PI * 2 + t * rate * (k % 2 ? 1 : -1) * 2.2;
    const rad = (i.harass === false ? 52 : 30) + h2 * 26 + Math.sin(t * 1.7 + k) * 5;
    // A peck dive every ~1.4 s per bug, offset per bug, 260 ms long.
    const cyc = (t * 1000 + h * 1400) % 1400;
    const peck = i.corpse || i.exit > 0 || i.harass === false ? 0 : cyc < 260 ? Math.sin((cyc / 260) * Math.PI) : 0;
    const r = rad * (1 - 0.72 * peck);
    let x = Math.cos(ang) * r;
    let y = Math.sin(ang) * r * 0.62 - 6;
    let a = i.corpse ? 0.45 : 1;
    if (i.exit > 0) {
      // Dissipate: burst outward and fade (each bug pops at a slightly different moment).
      const e = Math.min(1, Math.max(0, (i.exit - h2 * 0.35) / 0.65));
      x *= 1 + e * 1.6; y = y * (1 + e * 1.6) - e * 14;
      a *= 1 - e;
    }
    out.push({ x, y, flap: (t * (9 + h * 4) + k) % 1, peck, a, s: 0.8 + h2 * 0.5 });
  }
  return out;
}

/** The puff ring that plays while the swarm dissipates: radius and alpha from the exit progress, null when not exiting. */
export function puff(exit: number): { r: number; a: number } | null {
  if (!(exit > 0) || exit >= 1) return null;
  return { r: 14 + exit * 46, a: 0.55 * (1 - exit) };
}

/** True when a swarm outlived its problem. The caller then forces the exit so no swarm is ever stuck. */
export function swarmStale(age: number, speed: number, laneIdle: boolean): boolean {
  return laneIdle && age * Math.max(0.1, speed) > SWARM_SAFETY_MS;
}

/** Stable numeric seed from a creature id and its birth time. */
export function seedOf(id: string, born: number): number {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) { h ^= id.charCodeAt(k); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 997) + (Math.floor(born) % 89);
}

/** Bug body colour per creature family. */
export function bugTint(id: string): { body: string; wing: string } {
  switch (id) {
    case 'banshee': case 'banshee_queen': case 'wisp': return { body: '#bda7ff', wing: 'rgba(220,210,255,0.7)' };
    case 'gremlin': return { body: '#7fa89b', wing: 'rgba(255,200,120,0.7)' };
    case 'goblin': case 'imp': return { body: '#7fd36b', wing: 'rgba(200,255,190,0.65)' };
    case 'zombie': case 'mummy': return { body: '#a9b88a', wing: 'rgba(225,235,200,0.6)' };
    case 'witch': case 'poltergeist': return { body: '#d96bff', wing: 'rgba(240,190,255,0.65)' };
    case 'reaper': case 'lich': case 'wraith': return { body: '#7a7a96', wing: 'rgba(190,190,220,0.6)' };
    default: return { body: '#ffc93c', wing: 'rgba(255,245,200,0.7)' };
  }
}
