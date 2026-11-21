// Read-only views over the hub buffer: lane stage detail, lane log, orders, ledger, waves, reports, postmortem.
// The mock derives all of them from the events it has emitted, so they always agree with the stream.
import type { Grade, HauntEvent } from '@haunt/shared';
import { logText, waveGrades, waveScore, worstGrade, type Hub, type WaveRecord } from './hub';

const waveEvents = (hub: Hub, w: WaveRecord): HauntEvent[] => hub.buffer.filter((e) => e.wave === w.n && e.seq > 0);

export function stageDetail(hub: Hub, lane: number, stage: string, order?: string) {
  const mine = hub.buffer.filter((e) => e.lane === lane);
  const ord = order ?? [...mine].reverse().find((e) => e.order && e.stage === stage)?.order ?? hub.laneAt(lane)?.order ?? undefined;
  const evs = mine.filter((e) => e.order === ord && e.stage === stage);
  const attempts: { attempt: number; startTs: number; endTs?: number; status: string; error?: string }[] = [];
  for (const e of evs) {
    if (e.type === 'stage_start') attempts.push({ attempt: e.detail?.attempt ?? attempts.length + 1, startTs: e.ts, status: 'running' });
    const cur = attempts[attempts.length - 1];
    if (!cur) continue;
    if (e.type === 'stage_done') { cur.endTs = e.ts; cur.status = e.detail?.skipped ? 'skipped' : 'done'; }
    if (e.type === 'stage_fail') { cur.endTs = e.ts; cur.status = 'failed'; cur.error = e.detail?.error; }
  }
  const status = attempts.length === 0 ? 'pending' : attempts[attempts.length - 1].status;
  return {
    lane, order: ord ?? null, stage, status, attempts, events: evs,
    effects: evs.filter((e) => e.type === 'effect' || e.type === 'repeat'),
    chaos: evs.filter((e) => e.type === 'chaos' || e.type === 'chaos_absorbed'),
    recover: mine.filter((e) => e.order === ord && (e.type === 'recover_start' || e.type === 'recover_done' || e.type === 'process_dead' || e.type === 'process_up')),
    journal: [] as unknown[],
  };
}

export function laneLog(hub: Hub, lane: number, order?: string, since?: number) {
  const lines = [];
  for (const e of hub.buffer) {
    if (e.lane !== lane || (order && e.order !== order) || (since !== undefined && e.seq <= since)) continue;
    const t = logText(e);
    if (t) lines.push({ seq: e.seq, ts: e.ts, level: t.level, type: e.type, stage: e.stage ?? null, order: e.order ?? null, text: t.text });
  }
  return { lines };
}

export function laneOrders(hub: Hub, lane: number) {
  const out = new Map<string, string>();
  for (const e of hub.buffer) {
    if (e.lane !== lane || !e.order) continue;
    if (e.type === 'order_start') out.set(e.order, 'active');
    else if (e.type === 'order_done') out.set(e.order, 'done');
    else if (e.type === 'order_failed') out.set(e.order, 'failed');
    else if (e.type === 'order_parked') out.set(e.order, 'parked');
    else if (e.type === 'order_resumed') out.set(e.order, 'active');
    else if (e.type === 'order_quarantined') out.set(e.order, 'quarantined');
    else if (e.type === 'order_abandoned') out.set(e.order, 'abandoned');
  }
  return [...out].map(([order, outcome]) => ({ order, outcome }));
}

export function ledger(hub: Hub) {
  const lanes = [...hub.lanes.keys()].sort().map((lane) => {
    const rows: { kind: string; key: string; ts: number; order?: string }[] = [];
    const byKind: Record<string, { rows: number; repeats: number }> = {};
    for (const e of hub.buffer) {
      if (e.lane !== lane || e.type !== 'effect' || e.detail?.replayed) continue;
      rows.push({ kind: e.detail?.kind, key: e.detail?.key, ts: e.ts, order: e.order });
    }
    const keys = new Map<string, number>();
    for (const r of rows) keys.set(`${r.kind}|${r.key}`, (keys.get(`${r.kind}|${r.key}`) ?? 0) + 1);
    for (const [k, n] of keys) {
      const kind = k.split('|')[0];
      byKind[kind] ??= { rows: 0, repeats: 0 };
      byKind[kind].rows += n;
      byKind[kind].repeats += n - 1;
    }
    return { lane, byKind, rows };
  });
  return { lanes };
}

export function wavesList(hub: Hub) {
  return hub.waves.map((w) => {
    const grades = waveGrades(w);
    return { n: w.n, startedAt: w.startedAt, endedAt: w.endedAt ?? null, ...(w.endedAt ? { grade: worstGrade(grades), grades } : {}), score: waveScore(w) };
  });
}

const sum = (w: WaveRecord, k: 'repeats' | 'completed' | 'failed') => Object.values(w.summary ?? {}).reduce((a, s) => a + s[k], 0);

export function waveReport(hub: Hub, w: WaveRecord) {
  const evs = waveEvents(hub, w);
  const grades = waveGrades(w);
  const grade: Grade = worstGrade(grades) ?? 'A';
  const total = Object.values(w.summary ?? {}).reduce((a, s) => a + s.completed + s.failed + s.parked + s.quarantined, 0);
  const reliability = total === 0 ? 100 : Math.round((sum(w, 'completed') / total) * 100);
  const matrix = evs.filter((e) => e.type === 'chaos').map((e) => {
    const after = evs.filter((x) => x.seq > e.seq && x.lane === e.lane).slice(0, 12);
    const closer = after.find((x) => ['chaos_absorbed', 'order_failed', 'lane_halted', 'order_parked', 'order_quarantined', 'process_dead', 'recover_start'].includes(x.type));
    const result = !closer ? 'na' : closer.type === 'order_failed' || closer.type === 'order_quarantined' ? 'fail' : closer.type === 'lane_halted' ? 'halt' : after.some((x) => x.type === 'repeat') ? 'repeat' : 'pass';
    return { stage: e.stage ?? e.detail?.injectedAt, fault: e.detail?.fault, result, repeats: [], evidenceSeq: [e.seq] };
  });
  const repeats = evs.filter((e) => e.type === 'repeat').map((e) => ({ order: e.order, kind: e.detail?.kind, extra: (e.detail?.count ?? 2) - 1, stage: e.stage, fault: null }));
  const recoveries = evs.filter((e) => e.type === 'recover_done').map((e) => e.detail?.ms ?? 0).sort((a, b) => a - b);
  const pick = (p: number) => (recoveries.length ? recoveries[Math.min(recoveries.length - 1, Math.floor(p * recoveries.length))] : 0);
  const findings = repeats.map((r, i) => ({ id: `F${i + 1}`, rule: 'R1', severity: 'high', stage: r.stage, fault: r.fault, summary: `${r.kind} repeated for ${r.order}`, evidenceSeq: [], suggestedPart: 'idempotency' }));
  return {
    run: `run-mock-${w.seed}-${w.n}`, mode: 'mock', seed: w.seed, app: w.app, generatedAt: w.endedAt ?? Date.now(), grade, reliability, matrix,
    recovery: { p50: pick(0.5), p95: pick(0.95), max: recoveries[recoveries.length - 1] ?? 0 },
    repeats, lost: [], targets: [{ name: 'recoverMs', value: pick(0.95), target: 8000, pass: pick(0.95) <= 8000 }], findings,
    tiers: Object.entries(w.summary ?? {}).map(([lane, s]) => ({ tier: hub.laneAt(Number(lane))?.tier ?? `lane-${lane}`, grade: grades[lane], score: s.score })),
  };
}

export function waveCompare(hub: Hub, a: WaveRecord, b: WaveRecord) {
  const ga = waveGrades(a);
  const gb = waveGrades(b);
  const info = (w: WaveRecord, g: Record<string, Grade>) => ({ score: waveScore(w), grade: worstGrade(g) ?? null, repeats: sum(w, 'repeats') });
  const lanes = [...new Set([...Object.keys(a.summary ?? {}), ...Object.keys(b.summary ?? {})])].sort();
  const cells = lanes.map((l) => {
    const sa = a.summary?.[l];
    const sb = b.summary?.[l];
    const change = !sa || !sb || sa.score === sb.score ? 'same' : sb.score > sa.score ? 'improved' : 'worse';
    return {
      lane: Number(l), tier: hub.laneAt(Number(l))?.tier ?? `lane-${l}`,
      a: { grade: ga[l] ?? null, score: sa?.score ?? 0, repeats: sa?.repeats ?? 0 }, b: { grade: gb[l] ?? null, score: sb?.score ?? 0, repeats: sb?.repeats ?? 0 }, change,
    };
  });
  return { a: info(a, ga), b: info(b, gb), cells };
}

export function postmortem(hub: Hub, w: WaveRecord): string {
  const r = waveReport(hub, w);
  const lines = [`# Wave ${w.n} postmortem (mock)`, '', `Grade ${r.grade}, reliability ${r.reliability}%, score ${waveScore(w)}.`, '', '## Lanes', ''];
  for (const t of r.tiers) lines.push(`- ${t.tier}: grade ${t.grade}, score ${t.score}`);
  lines.push('', '## Findings', '');
  if (r.findings.length === 0) lines.push('No repeated side effects were seen.');
  for (const f of r.findings) lines.push(`- ${f.id} (${f.severity}): ${f.summary}. Suggested part: ${f.suggestedPart}.`);
  return lines.join('\n') + '\n';
}

export function hardening(hub: Hub, w: WaveRecord) {
  const r = waveReport(hub, w);
  const top = r.findings[0];
  const part = top?.suggestedPart ?? 'journal';
  return {
    spec: `hardening-wave-${w.n}`,
    title: `Add ${part} to the lanes that repeated work (sample)`,
    files: [{ path: `.haunt/hardening/wave-${w.n}.md`, content: `# Hardening spec (sample)\n\nFinding: ${top?.summary ?? 'none'}.\nAdd the ${part} part to the affected stage.\n` }],
  };
}

// ---- Contract v1.1 (contract/V1_1.md section 9): order records, laps, stars, decisions. Derived from the buffer.
const ENDS = new Set(['order_done', 'order_failed']);
const ISSUE_TYPES = new Set(['stage_fail', 'process_dead', 'repeat', 'order_parked']);

/** The events of one lane from the last `order_start` of `order` up to its `review` (or last order event). */
function orderWindow(hub: Hub, lane: number, order: string, wave?: number): HauntEvent[] {
  const mine = hub.buffer.filter((e) => e.lane === lane && (wave === undefined || e.wave === wave));
  let from = -1;
  mine.forEach((e, i) => { if (e.type === 'order_start' && e.order === order) from = i; });
  if (from < 0) return [];
  const out: HauntEvent[] = [];
  for (let i = from; i < mine.length; i++) {
    const e = mine[i];
    if (i > from && e.type === 'order_start') break;
    out.push(e);
    if (e.type === 'review' && e.order === order) break;
  }
  return out;
}

export function laneOrderRecord(hub: Hub, lane: number, order: string) {
  const win = orderWindow(hub, lane, order);
  if (win.length === 0) return undefined;
  const end = win.find((e) => ENDS.has(e.type));
  const review = win.find((e) => e.type === 'review');
  const outcome = laneOrders(hub, lane).find((o) => o.order === order)?.outcome ?? 'active';
  const stages = new Map<string, { stage: string; status: string; attempts: number; retries: number; recoverable: boolean; issues: number; downtimeMs: number; ms: number; recoveries: { startTs: number; endTs: number; ms: number; action: string; depth: number }[]; open?: number; failed: boolean }>();
  const get = (s: string) => {
    let r = stages.get(s);
    if (!r) { r = { stage: s, status: 'pending', attempts: 0, retries: 0, recoverable: false, issues: 0, downtimeMs: 0, ms: 0, recoveries: [], failed: false }; stages.set(s, r); }
    return r;
  };
  let cur: string | undefined;
  const pending: HauntEvent[] = [];
  for (const e of win) {
    const s = e.stage ?? cur;
    if (e.type === 'stage_start' && e.stage) {
      const r = get(e.stage);
      r.attempts++; r.status = 'running'; r.open = e.ts; cur = e.stage;
    } else if ((e.type === 'stage_done' || e.type === 'stage_fail') && e.stage) {
      const r = get(e.stage);
      if (r.open !== undefined) { r.ms += Math.max(0, e.ts - r.open); r.open = undefined; }
      if (e.type === 'stage_done') { r.status = e.detail?.skipped ? 'skipped' : 'done'; if (r.failed) r.recoverable = true; }
      else { r.status = 'failed'; r.failed = true; }
      cur = e.stage;
    }
    if (s && ISSUE_TYPES.has(e.type)) get(s).issues++;
    if (s && e.type === 'breaker' && e.detail?.state === 'open') get(s).issues++;
    if (e.type === 'recover_start') pending.push(e);
    if (e.type === 'recover_done') {
      const st = pending.pop();
      const ms = e.detail?.ms ?? (st ? e.ts - st.ts : 0);
      const action = e.detail?.action ?? st?.detail?.action ?? 'unknown';
      if (s) {
        const r = get(s);
        r.recoveries.push({ startTs: e.ts - ms, endTs: e.ts, ms, action, depth: e.detail?.depth ?? 0 });
        r.downtimeMs += ms;
        if (action === 'retry' || action === 'backoff' || action === 'restart') r.retries++;
      }
    }
  }
  const startTs = win[0].ts;
  const endTs = (end ?? win[win.length - 1]).ts;
  return {
    order, outcome, startTs, endTs: end ? endTs : null,
    lap: end?.detail?.lap ?? null, review: review?.detail ?? null,
    stages: [...stages.values()].map(({ open: _o, failed: _f, ...r }) => r),
  };
}

export function laneLaps(hub: Hub, lane: number, wave = hub.wave?.n) {
  const out: { order: string; outcome: string; lap: unknown; review: unknown }[] = [];
  const evs = hub.buffer.filter((e) => e.lane === lane && (wave === undefined || e.wave === wave));
  const reviews = new Map<string, unknown>();
  for (const e of evs) if (e.type === 'review' && e.order) reviews.set(e.order, e.detail);
  for (const e of evs) {
    if (!ENDS.has(e.type) || !e.order) continue;
    out.push({ order: e.order, outcome: e.type === 'order_done' ? 'done' : 'cancelled', lap: e.detail?.lap ?? null, review: reviews.get(e.order) ?? null });
  }
  return out;
}

const waveLanes = (hub: Hub, w: WaveRecord): number[] => [...new Set(waveEvents(hub, w).filter((e) => e.lane !== undefined).map((e) => e.lane as number))].sort((a, b) => a - b);

export function waveLaps(hub: Hub, w: WaveRecord) {
  return { lanes: waveLanes(hub, w).map((lane) => ({ lane, tier: hub.laneAt(lane)?.tier ?? `lane-${lane}`, laps: laneLaps(hub, lane, w.n) })) };
}

export function waveStars(hub: Hub, w: WaveRecord) {
  return {
    lanes: waveLanes(hub, w).map((lane) => ({
      lane,
      series: waveEvents(hub, w).filter((e) => e.lane === lane && e.type === 'review').map((e) => ({
        order: e.order, stars: e.detail?.stars, cumStars: e.detail?.cum?.stars, cumMax: e.detail?.cum?.max,
      })),
    })),
  };
}

/** The open `decision_needed` of a lane/order, if no `decision_made` followed it. */
export function pendingDecision(hub: Hub, lane: number, order: string): HauntEvent | undefined {
  let open: HauntEvent | undefined;
  for (const e of hub.buffer) {
    if (e.lane !== lane || e.order !== order) continue;
    if (e.type === 'decision_needed') open = e;
    else if (e.type === 'decision_made') open = undefined;
  }
  return open;
}
