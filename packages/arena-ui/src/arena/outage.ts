// TV3-U7: the outage countdown ring (contract V1_2 section 5, `outage {outageMs, seed, fault, level}`, stage on the envelope).
// Pure: no DOM, no clock of its own. `now` is passed in by the caller. The real countdown is outageMs / speed from the event.

export interface OutageVM {
  stage: string;
  fault: string;
  level: number;
  seed: number;
  /** 1x length of the drawn window in ms. */
  outageMs: number;
  /** Real time the window lasts at the speed it started with, in ms. */
  realMs: number;
  /** When the ring started (caller's clock). */
  startedAt: number;
  /** When the stage recovered (null while it is still down). */
  endedAt: number | null;
  /** The fault waits for the lane to reach the stage (the bot runs ahead of the arena): the ring is full and does not count yet. */
  pending?: boolean;
}

export interface OutageHost { outages?: OutageVM[] }

/** How long a finished ring stays on screen before it fades out, in ms. */
export const OUTAGE_FADE_MS = 700;

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Open a ring for an `outage` event. A second outage at the same stage replaces the first. Returns null for a malformed event. */
export function openOutage(l: OutageHost, now: number, speed: number, stage: string | undefined, d: Record<string, unknown>, pending = false): OutageVM | null {
  const outageMs = num(d.outageMs, NaN);
  if (!stage || !Number.isFinite(outageMs) || outageMs <= 0) return null;
  const o: OutageVM = {
    stage, fault: typeof d.fault === 'string' ? d.fault : '', level: num(d.level), seed: num(d.seed),
    outageMs, realMs: outageMs / Math.max(0.1, speed), startedAt: now, endedAt: null, ...(pending ? { pending: true } : {}),
  };
  l.outages = (l.outages ?? []).filter((x) => x.stage !== stage);
  l.outages.push(o);
  return o;
}

/** The lane reached the stage a waiting ring is about: it starts counting now. */
export function startOutage(l: OutageHost, now: number, stage: string): void {
  for (const o of l.outages ?? []) if (o.pending && o.stage === stage) { o.pending = false; o.startedAt = now; }
}

/** The stage recovered (or the order ended): the ring stops counting and fades. `stage` omitted ends every ring of the lane. */
export function endOutage(l: OutageHost, now: number, stage?: string): void {
  for (const o of l.outages ?? []) if (o.endedAt === null && (stage === undefined || o.stage === stage)) o.endedAt = now;
}

/** Drop rings that finished and faded. */
export function pruneOutages(l: OutageHost, now: number): void {
  if (!l.outages?.length) return;
  const keep = l.outages.filter((o) => o.endedAt === null || now - o.endedAt < OUTAGE_FADE_MS);
  if (keep.length !== l.outages.length) l.outages = keep;
}

export interface OutageFrame {
  /** 1 at the start, 0 when the window is over. */
  frac: number;
  leftMs: number;
  /** Whole seconds left, rounded up, for the label. */
  seconds: number;
  /** The window ran out and the stage has not recovered yet. */
  overrun: boolean;
  /** 0..1 fade after recovery. */
  fade: number;
}

export function outageFrame(o: OutageVM, now: number): OutageFrame {
  const stop = o.endedAt ?? now;
  const left = o.pending ? o.realMs : Math.max(0, o.realMs - Math.max(0, stop - o.startedAt));
  const fade = o.endedAt === null ? 0 : Math.min(1, Math.max(0, (now - o.endedAt) / OUTAGE_FADE_MS));
  return { frac: o.realMs > 0 ? left / o.realMs : 0, leftMs: left, seconds: Math.ceil(left / 1000), overrun: o.endedAt === null && left <= 0, fade };
}

/** Text inside the ring: whole seconds left; "0" while the stage is still catching up. */
export const ringLabel = (f: OutageFrame): string => `${f.seconds}s`;

/** Tooltip fragment for a chip with a ring. */
export function outageTip(o: OutageVM, now: number): string {
  const f = outageFrame(o, now);
  const why = o.fault ? ` (${o.fault.replace(/_/g, ' ')})` : '';
  if (o.endedAt !== null) return `Outage over${why}.`;
  return f.overrun ? `Outage window over${why}: waiting for the stage to recover.` : `Outage${why}: about ${f.seconds} s left of ${Math.round(o.outageMs / 100) / 10} s.`;
}

/** The ring on a stage at this moment, if any (most recent one that is still visible). */
export function outageAt(l: OutageHost, stage: string): OutageVM | undefined {
  const list = l.outages;
  if (!list) return undefined;
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.stage === stage) return list[i];
  return undefined;
}
