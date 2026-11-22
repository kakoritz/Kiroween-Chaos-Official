// The self-improving loop (spec 8.3, TV3-C13): run -> mine -> apply the cheap patterns as policy overlay -> write specs for the rest -> rerun the
// same plan and seed -> compare ("closed 7 of 9 patterns"). No full rewrite, and no code is applied: a policy overlay is data a tier's parts allow,
// a spec is a document Kiro applies with the review step (AGENTS.md).
import { policyTakes, type PolicyAction, type PolicyRule } from '../sdk/policy';
import { gradeFor, TIERS, type Grade } from '../shared/catalog';
import { tierOfLane } from '../tournament/rounds';
import { LessonsStore, type Lesson } from '../tournament/lessons';
import type { Ev } from '../tournament/rp';
import { PatternStore, minePatterns, qualifies, patternId, type MinedPattern, type Pattern } from './patterns';
import { lintSpecDir, patchFor, writeFixSpec, type LintResult } from './specs';

/** One run of the plan, as the loop sees it. */
export interface RunResult {
  run: string;
  events: readonly Ev[];
  orders: number;
  ok: number;
  lost: number;
  repeats: number;
  /** Sum of the round points of every lane in every round. */
  score: number;
  reports?: string[];
}

/** A run's reliability: orders done over orders given, each repeated effect costing half an order. */
export function runReliability(r: Pick<RunResult, 'orders' | 'ok' | 'repeats'>): number {
  return Math.max(0, Math.round((100 * (r.ok - 0.5 * r.repeats)) / Math.max(1, r.orders)));
}
export const runGrade = (r: Pick<RunResult, 'orders' | 'ok' | 'repeats'>): Grade => gradeFor(runReliability(r));

export interface ImproveDeps {
  /** Runs the same plan and seed. `label` is `before` or `after`. */
  runPlan(label: 'before' | 'after'): Promise<RunResult>;
  store: PatternStore;
  lessons: LessonsStore;
  /** Where the spec for the patterns that need code is written. Omit to skip the spec step. */
  specsDir?: string;
  /** What was run, for the acceptance lines of the spec. */
  plan?: string;
  /** Progress, for a status endpoint. */
  onPhase?(phase: 'before' | 'mining' | 'applying' | 'after' | 'comparing'): void;
  /** Called for each pattern whose status changes. */
  onStatus?(p: Pattern): void;
  /** Called once the spec is written. */
  onSpec?(s: { runId: string; path: string; patterns: string[]; refused: string[]; lint: LintResult }): void;
  /** A name for the spec folder. */
  specRunId?: string;
}

/** `existing`: the lane had already learned it (a lesson from a round), so the loop only confirmed it. */
export interface OverlayApplied { lane: number; tier: string; signature: string; action: PolicyAction; stage: string; fault: string; existing: boolean }

export interface PatternOutcome {
  id: string;
  signature: string;
  /** What the loop did about it. */
  handling: 'overlay' | 'spec' | 'overlay+spec' | 'nothing';
  before: number;
  after: number;
  status: Pattern['status'];
  closed: boolean;
}

export interface ImproveReport {
  closed: number;
  of: number;
  summary: string;
  grade: { before: Grade; after: Grade };
  reliability: { before: number; after: number };
  score: { before: number; after: number };
  lost: { before: number; after: number };
  repeats: { before: number; after: number };
  patterns: PatternOutcome[];
  overlays: OverlayApplied[];
  spec: { runId: string; path: string; patterns: string[]; refused: string[]; lint: LintResult } | null;
  /** Patterns the rerun shows that the first run did not. */
  newPatterns: string[];
  runs: { before: string; after: string };
  text: string;
}

const ruleOf = (stage: string, fault: string, action: PolicyAction): PolicyRule => {
  const r: PolicyRule = { stage, fault, action };
  if (action === 'retry_backoff') { r.backoff = 'exp'; r.maxAttempts = 5; }
  if (action === 'idempotency_key') r.key = 'order-id';
  return r;
};

/** The loop. Throws only for a spec that fails its own lint (a bug in the writer, never silently ignored). */
export async function improve(deps: ImproveDeps): Promise<ImproveReport> {
  const { store, lessons } = deps;
  deps.onPhase?.('before');
  const before = await deps.runPlan('before');

  // ---- mine ----
  deps.onPhase?.('mining');
  const mined1 = minePatterns({ run: before.run, events: before.events, ...(before.reports?.[0] ? { reportLink: before.reports[0] } : {}) });
  // The live server already mined each round into the store; only what it did not see (run-level shapes) is added here.
  const known = new Set(store.list().map((p) => p.id));
  store.ingest(mined1.filter((m) => !known.has(patternId(m.signature))), `${before.run}#all`);
  const targets = mined1.filter((m) => qualifies({ count: m.count, lostOrders: m.lostOrders, downtimeMsTotal: m.downtimeMs }));
  const targetIds = targets.map((m) => patternId(m.signature));

  // ---- apply the cheap ones as policy (lessons) for tiers that support them ----
  deps.onPhase?.('applying');
  const overlays: OverlayApplied[] = [];
  const needsCode: Pattern[] = [];
  const handling = new Map<string, PatternOutcome['handling']>();
  const touched = new Set<number>();
  for (const m of targets) {
    const p = store.get(patternId(m.signature))!;
    const patch = patchFor(p);
    const action = patch?.action as PolicyAction | undefined;
    let applied = 0;
    let unsupported = 0;
    for (const lane of m.lanes) {
      const tier = tierOfLane(lane);
      // Only an action the SDK enforces is applied as policy; anything else would be a claim with no effect.
      if (action && policyTakes(TIERS[tier].parts, action)) {
        const l = lessons.get(lane, tier);
        const existing = l.lessons.some((x) => x.signature === m.signature && x.rule);
        if (!existing) {
          const lesson: Lesson = { signature: m.signature, stage: m.stage, fault: m.fault, mechanism: action, action, via: 'suggested', learnedRound: 0, applied: true, rule: ruleOf(m.stage, m.fault, action) };
          l.lessons.push(lesson);
          lessons.save(l);
        }
        overlays.push({ lane, tier, signature: m.signature, action, stage: m.stage, fault: m.fault, existing });
        touched.add(lane);
        applied++;
      } else unsupported++;
    }
    // Needs code when some lane that met it cannot take the policy, or there is no policy action at all (the patch is a part or a wrapper).
    const code = !action || unsupported > 0;
    if (code && patch) needsCode.push(p);
    handling.set(p.id, applied && code ? 'overlay+spec' : applied ? 'overlay' : code && patch ? 'spec' : 'nothing');
    if (applied) { const u = store.setStatus(p.id, 'accepted'); if (u) deps.onStatus?.(u); }
  }
  for (const lane of touched) lessons.writePolicy(lessons.get(lane, tierOfLane(lane)));

  // ---- write the spec for the ones that need code (never applied here) ----
  let spec: ImproveReport['spec'] = null;
  if (needsCode.length && deps.specsDir) {
    const runId = deps.specRunId ?? `improve-${before.run}`;
    const w = writeFixSpec(deps.specsDir, { runId, patterns: needsCode, plan: deps.plan ?? 'the same plan and seed', totals: { orders: before.orders }, ...(before.reports?.length ? { reports: before.reports } : {}) });
    if (!w.lint.ok) throw new Error(`generated spec fails lint: ${w.lint.issues.map((i) => `${i.file} ${i.id ?? ''} ${i.message}`).join('; ')}`);
    for (const p of store.setStatuses(w.included.map((x) => x.id), 'suggested')) deps.onStatus?.(p);
    spec = { runId, path: `.kiro/specs/hardening-${runId}`, patterns: w.included.map((x) => x.id), refused: w.refused.map((r) => r.pattern.signature), lint: lintSpecDir(w.dir) };
    deps.onSpec?.(spec);
  }

  // ---- rerun the same plan and seed ----
  deps.onPhase?.('after');
  const after = await deps.runPlan('after');
  deps.onPhase?.('comparing');
  const mined2 = minePatterns({ run: after.run, events: after.events, ...(after.reports?.[0] ? { reportLink: after.reports[0] } : {}) });
  const present = new Map<string, MinedPattern>(mined2.map((m) => [patternId(m.signature), m]));
  const knownNow = new Set(store.list().map((p) => p.id));
  store.ingest(mined2.filter((m) => !knownNow.has(patternId(m.signature))), `${after.run}#all`);

  // A pattern is verified only if the rerun shows it gone. One the loop acted on and that is still there is `applied`.
  const outcomes: PatternOutcome[] = [];
  for (const m of targets) {
    const id = patternId(m.signature);
    const now = present.get(id);
    const gone = !now;
    const cur = store.get(id)!;
    const status: Pattern['status'] = gone ? 'verified' : (cur.status === 'accepted' || cur.status === 'suggested') && handling.get(id) !== 'nothing' && handling.get(id) !== 'spec' ? 'applied' : cur.status;
    const u = store.setStatus(id, status);
    if (u) deps.onStatus?.(u);
    outcomes.push({ id, signature: m.signature, handling: handling.get(id) ?? 'nothing', before: m.count, after: now?.count ?? 0, status, closed: gone });
  }
  const newPatterns = mined2.filter((m) => !targetIds.includes(patternId(m.signature)) && qualifies({ count: m.count, lostOrders: m.lostOrders, downtimeMsTotal: m.downtimeMs })).map((m) => m.signature);

  const closed = outcomes.filter((o) => o.closed).length;
  const report: Omit<ImproveReport, 'text'> = {
    closed, of: outcomes.length, summary: `closed ${closed} of ${outcomes.length} patterns`,
    grade: { before: runGrade(before), after: runGrade(after) }, reliability: { before: runReliability(before), after: runReliability(after) },
    score: { before: before.score, after: after.score }, lost: { before: before.lost, after: after.lost }, repeats: { before: before.repeats, after: after.repeats },
    patterns: outcomes, overlays, spec, newPatterns, runs: { before: before.run, after: after.run },
  };
  return { ...report, text: renderImprove(report) };
}

export function renderImprove(r: Omit<ImproveReport, 'text'>): string {
  const L = [
    `# Improve: ${r.summary}`, '',
    `| | Before | After |`, '|---|---|---|',
    `| Grade | ${r.grade.before} | ${r.grade.after} |`, `| Reliability | ${r.reliability.before} | ${r.reliability.after} |`,
    `| Round points | ${r.score.before} | ${r.score.after} |`, `| Lost orders | ${r.lost.before} | ${r.lost.after} |`, `| Repeated effects | ${r.repeats.before} | ${r.repeats.after} |`, '',
    '## Patterns', '',
    ...(r.patterns.length ? ['| Pattern | Handled by | Before | After | Status |', '|---|---|---|---|---|', ...r.patterns.map((p) => `| \`${p.signature}\` | ${p.handling} | ${p.before} | ${p.after} | ${p.status}${p.closed ? ' (gone)' : ''} |`)] : ['None above the threshold.']), '',
    '## Applied as policy (lessons)', '',
    ...(r.overlays.length ? r.overlays.map((o) => `- lane ${o.lane} (${o.tier}): \`${o.action}\` for ${o.stage} + ${o.fault}${o.existing ? ' (already learned in a round)' : ''}`) : ['- Nothing: no tier that met these patterns can take a policy for them.']), '',
    '## Spec for the rest (not applied)', '',
    r.spec ? `- \`${r.spec.path}\`: ${r.spec.patterns.length} requirement${r.spec.patterns.length === 1 ? '' : 's'}, lint ${r.spec.lint.ok ? 'ok' : 'failed'}${r.spec.refused.length ? `; not proposed: ${r.spec.refused.join(', ')}` : ''}. Kiro applies it with the review step.` : '- None: every pattern was handled as policy or none needed code.', '',
    ...(r.newPatterns.length ? ['## New in the rerun', '', ...r.newPatterns.map((s) => `- \`${s}\``), ''] : []),
    'A pattern is verified only when the rerun shows it gone. Lessons learned in the first run carry into the rerun.', '',
  ];
  return L.join('\n');
}
