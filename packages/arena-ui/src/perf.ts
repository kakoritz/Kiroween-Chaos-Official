// UI-D3: in-page frame timing. Enabled only by ?perf=<seconds>; adds nothing to a normal run.

export interface PerfSummary {
  frames: number;
  seconds: number;
  fps: number;
  frameMsAvg: number;
  frameMsP50: number;
  frameMsP95: number;
  frameMsP99: number;
  frameMsMax: number;
  over20ms: number;
  workMsAvg: number;
  workMsP95: number;
  workMsMax: number;
  lanesMax: number;
}

const pct = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
const avg = (a: number[]): number => (a.length === 0 ? 0 : a.reduce((s, x) => s + x, 0) / a.length);
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Seconds requested by ?perf=<n> (1 to 600), or 0 when perf sampling is off. */
export function perfSecondsFromQuery(search: string): number {
  const raw = new URLSearchParams(search).get('perf');
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 600 ? Math.floor(n) : 0;
}

export class FrameSampler {
  private readonly dts: number[] = [];
  private readonly work: number[] = [];
  private lanesMax = 0;
  private last = -1;
  /** Skip the first frames (layout, first paint) so startup cost is not counted. */
  constructor(private readonly warmup = 30) {}

  /** Call once per animation frame with the rAF timestamp, the CPU ms spent in the frame callback and lane count. */
  frame(now: number, workMs: number, lanes: number): void {
    if (this.last >= 0) {
      if (this.warmup > 0 && this.dts.length === 0 && this.skipped < this.warmup) this.skipped++;
      else { this.dts.push(now - this.last); this.work.push(workMs); }
    }
    this.last = now;
    if (lanes > this.lanesMax) this.lanesMax = lanes;
  }
  private skipped = 0;

  get count(): number { return this.dts.length; }

  summary(): PerfSummary {
    const s = [...this.dts].sort((a, b) => a - b);
    const w = [...this.work].sort((a, b) => a - b);
    const total = this.dts.reduce((x, y) => x + y, 0);
    return {
      frames: this.dts.length,
      seconds: r2(total / 1000),
      fps: total > 0 ? r2((this.dts.length * 1000) / total) : 0,
      frameMsAvg: r2(avg(this.dts)),
      frameMsP50: r2(pct(s, 50)),
      frameMsP95: r2(pct(s, 95)),
      frameMsP99: r2(pct(s, 99)),
      frameMsMax: r2(s[s.length - 1] ?? 0),
      over20ms: this.dts.filter((d) => d > 20).length,
      workMsAvg: r2(avg(this.work)),
      workMsP95: r2(pct(w, 95)),
      workMsMax: r2(w[w.length - 1] ?? 0),
      lanesMax: this.lanesMax,
    };
  }
}
