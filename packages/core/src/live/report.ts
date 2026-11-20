// Wave report and postmortem derived from a finished wave's event slice (PROTOCOL.md "Compare, report, hardening").
import type { HauntEvent } from '../../../haunt/src/score/score';
import type { WaveRecord } from '../../../haunt/src/score/wave';

export interface WaveInfo { app: string; seed: number }

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

export function waveEvents(all: HauntEvent[], n: number): HauntEvent[] {
  return all.filter((e) => e.wave === n);
}

export function buildReport(rec: WaveRecord, evs: HauntEvent[], info: WaveInfo) {
  const d = (e: HauntEvent) => (e.detail ?? {}) as Record<string, any>;
  const repeats = evs.filter((e) => e.type === 'repeat').map((e) => ({ order: e.order!, kind: d(e).kind, extra: Math.max(0, (d(e).count ?? 2) - 1), stage: e.stage ?? '', fault: '' }));
  const lost = evs.filter((e) => e.type === 'order_failed' || e.type === 'order_abandoned')
    .map((e) => ({ order: e.order!, reason: 'abandoned' as const }));
  const rec_ms = evs.filter((e) => e.type === 'recover_done').map((e) => Number(d(e).ms)).filter((x) => Number.isFinite(x));
  const chaos = evs.filter((e) => e.type === 'chaos');
  const matrix = chaos.map((e) => {
    const lane = e.lane;
    const rp = repeats.some((r) => evs.some((x) => x.type === 'repeat' && x.lane === lane && x.order === r.order));
    const failed = evs.some((x) => x.type === 'order_failed' && x.lane === lane);
    return { stage: e.stage ?? '', fault: String(d(e).fault), result: failed ? 'fail' : rp ? 'repeat' : 'pass', repeats: [], evidenceSeq: [e.seq!] };
  });
  const findings = repeats.map((r, i) => ({
    id: `F${i + 1}`, rule: 'R1', severity: 'high', stage: r.stage, fault: r.fault,
    summary: `${r.kind} repeated on order ${r.order}`, evidenceSeq: [] as number[], suggestedPart: 'idempotency',
  }));
  return {
    run: rec.n, mode: 'wave', seed: info.seed, app: info.app, generatedAt: rec.endedAt ?? rec.startedAt,
    grade: rec.grade ?? 'F', reliability: rec.grade ?? 'F', matrix,
    recovery: { p50: pct(rec_ms, 50), p95: pct(rec_ms, 95), max: rec_ms.length ? Math.max(...rec_ms) : 0 },
    repeats, lost, targets: [], findings,
    tiers: Object.entries(rec.grades ?? {}).map(([tier, grade]) => ({ tier, grade, score: 0 })),
  };
}

export function buildPostmortem(rec: WaveRecord, report: ReturnType<typeof buildReport>): string {
  const out = [`# Wave ${rec.n} postmortem`, '', `Grade ${report.grade}, score ${rec.score}.`, ''];
  out.push('## Lanes', '', ...Object.entries(rec.grades ?? {}).map(([k, g]) => `- Lane ${k}: ${g}`), '');
  out.push('## Findings', '');
  if (!report.findings.length) out.push('None.');
  for (const f of report.findings) out.push(`- [${f.severity}] ${f.rule}: ${f.summary}`);
  out.push('', `Chaos injected: ${report.matrix.length}. Repeats: ${report.repeats.length}. Lost orders: ${report.lost.length}.`, '');
  return out.join('\n');
}
