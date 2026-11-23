// Workflow Lab engine: a generic bot built from declared stages and parts, swept against the fault catalog in memory.
// Model-based: outcomes come from rules over the declared parts, not from running real code.
// No node imports (bundles for the browser). Spec: .kiro/specs/share/spec.md section 4 (SH-C3).
import { faultById } from '../chaos/catalog';
import { reviewEvents } from '../reviewer/rules';
import type { Finding } from '../report/builder';
import type { HauntEvent } from '../score/score';
import { runSweep, type CellDetail, type SweepReport } from '../sweep/executor';
import type { CellOutcome, SweepPlan } from '../sweep/matrix';
import { labCommands, labToYaml, partSet, validateLabModel, type LabPackMeta, type LabModel, type LabPart, type LabStage, type PartSet, type PackFault } from './model';

export const LAB_LABEL = 'Model-based what-if: results come from rules over the protections you declare, not from running your real code.';

interface LabCreature { id: string; label: string; fault: string; roles: string[] }

/** Creatures the lab sends, one per fault family. Fault ids come from the shared catalog. */
export const LAB_CREATURES: readonly LabCreature[] = [
  { id: 'reaper', label: 'Reaper', fault: 'crash', roles: ['input', 'work', 'effect', 'poll', 'final'] },
  { id: 'wraith', label: 'Wraith', fault: 'power_outage', roles: ['input', 'work', 'effect', 'poll', 'final'] },
  { id: 'banshee', label: 'Banshee', fault: 'internet_outage', roles: ['effect', 'poll'] },
  { id: 'zombie', label: 'Zombie', fault: 'timeout', roles: ['effect'] },
  { id: 'ghost', label: 'Ghost', fault: 'http_404', roles: ['effect'] },
  { id: 'goblin', label: 'Goblin', fault: 'http_429', roles: ['effect', 'poll'] },
  { id: 'imp', label: 'Imp', fault: 'http_500', roles: ['effect', 'poll'] },
  { id: 'poltergeist', label: 'Poltergeist', fault: 'missing_file', roles: ['input'] },
  { id: 'doppelganger', label: 'Doppelganger', fault: 'duplicate_request', roles: ['input'] },
  { id: 'witch', label: 'Witch', fault: 'malformed_payload', roles: ['input'] },
  { id: 'mummy', label: 'Mummy', fault: 'disk_full', roles: ['work', 'final'] },
];

const PROCESS_FAULTS = new Set(['crash', 'out_of_memory', 'power_outage']);
const LONG_FAULTS = new Set(['internet_outage', 'endpoint_down', 'slow_link']);

/** What a pack fault does in the lab, from its `mode` (falls back to the fault of its art creature). */
const MODE_FAULT: Record<string, string> = {
  duplicate: 'duplicate_request', timeout: 'timeout', stall: 'timeout', status: 'http_500', crash: 'crash', outage: 'internet_outage',
  expire: 'http_404', corrupt: 'malformed_payload', misroute: 'malformed_payload',
};
export function packFaultOf(f: PackFault): string {
  return MODE_FAULT[f.mode] ?? LAB_CREATURES.find((c) => c.id === f.art)?.fault ?? 'crash';
}

export function labPlan(model: LabModel): SweepPlan {
  const cells: SweepPlan['cells'] = [];
  for (const s of model.stages) for (const c of LAB_CREATURES) if (c.roles.includes(s.role)) cells.push({ stage: s.id, creature: c.id, fault: c.fault });
  // The pack's own faults land on the stage the pack declares (faults on "any" stage are covered by the generic creatures).
  const known = new Set(model.stages.map((s) => s.id));
  for (const f of model.pack?.faults ?? []) {
    if (!known.has(f.stage) || cells.some((c) => c.stage === f.stage && c.creature === f.art)) continue;
    cells.push({ stage: f.stage, creature: f.art, fault: packFaultOf(f) });
  }
  return { stages: model.stages.map((s) => s.id), creatures: LAB_CREATURES.map((c) => c.id), cells };
}

const RANK: Record<string, number> = { pass: 0, recovered_late: 1, repeat: 2, fail: 3, halt: 4 };
const worse = (a: CellDetail, b: CellDetail): CellDetail => ((RANK[b.outcome] ?? 0) > (RANK[a.outcome] ?? 0) ? b : a);

export interface LabCurse { id: string; endpoint: string; stage: string; fault: string }
/** Curses are persistent traits: the cursed stage sees the fault in every cell, not once. */
export function labCurses(model: LabModel): LabCurse[] {
  const known = new Set(model.stages.map((s) => s.id));
  const dflt = (model.stages.find((s) => s.role === 'effect') ?? model.stages[0])?.id;
  const out: LabCurse[] = [];
  for (const c of model.pack?.curses ?? []) {
    const stage = c.stage ?? dflt;
    if (stage && known.has(stage)) out.push({ id: c.id, endpoint: c.endpoint, stage, fault: c.fault ?? 'http_500' });
  }
  return out;
}

/** What the generic bot does in one cell, from the declared parts. */
export function labCell(stage: LabStage, fault: string, p: PartSet): CellDetail {
  const effects = stage.role === 'effect' ? stage.effects ?? [] : [];
  const unprotected = effects.filter((e) => !(p.idempotency && e.keyed));
  const repeat = (): CellDetail => ({
    outcome: 'repeat',
    repeatedKinds: unprotected.length ? unprotected.map((e) => e.kind) : [stage.id],
  });

  if (PROCESS_FAULTS.has(fault)) {
    if (p.journal) return unprotected.length ? repeat() : { outcome: 'pass' };
    if (unprotected.length && !p.offline_queue) return repeat();
    if (p.offline_queue) return { outcome: 'recovered_late' };
    if (fault === 'power_outage') return { outcome: 'halt', lost: effects.length > 0 };
    return { outcome: 'fail', lost: effects.length > 0 };
  }
  if (fault === 'timeout') {
    // A timeout may hide an effect that happened: retrying without a key repeats it.
    if (p.retry) return unprotected.length ? repeat() : { outcome: 'pass' };
    return p.offline_queue ? { outcome: 'recovered_late' } : { outcome: 'fail' };
  }
  if (LONG_FAULTS.has(fault)) {
    if (p.retry && p.breaker) return { outcome: 'pass' };
    if (p.offline_queue || p.breaker) return { outcome: 'recovered_late' };
    return { outcome: 'fail' };
  }
  if (fault === 'http_404' || fault === 'http_429' || fault === 'http_500') {
    if (p.retry) return { outcome: 'pass' };
    return p.offline_queue ? { outcome: 'recovered_late' } : { outcome: 'fail' };
  }
  if (fault === 'missing_file') return p.offline_queue ? { outcome: 'recovered_late' } : { outcome: 'fail' };
  if (fault === 'duplicate_request') return p.idempotency ? { outcome: 'pass' } : repeat();
  if (fault === 'malformed_payload') return p.offline_queue ? { outcome: 'recovered_late' } : { outcome: 'halt' };
  if (fault === 'disk_full') return p.offline_queue ? { outcome: 'recovered_late' } : { outcome: 'fail' };
  return { outcome: 'pass' };
}

interface Evidence { events: HauntEvent[]; journal: { order: string; kind: string }[]; ledger: { order: string; kind: string }[] }

/** Builds the events a real run would have produced, so the real reviewer rules (R1 to R8) can read them. */
function evidenceFor(report: Pick<SweepReport, 'cells'>, p: PartSet): Evidence {
  const events: HauntEvent[] = [];
  const journal: Evidence['journal'] = [];
  const ledger: Evidence['ledger'] = [];
  let seq = 0;
  const push = (type: string, lane: string, order: string, stage: string, detail: Record<string, unknown> = {}) =>
    events.push({ seq: ++seq, type, lane, order, stage, detail });
  for (const c of report.cells) {
    if (c.outcome === 'pass') continue;
    const lane = `${c.stage}/${c.creature}`;
    const order = `${c.stage}-${c.creature}`;
    push('chaos', lane, order, c.stage, { fault: c.fault });
    if (c.outcome === 'repeat') {
      for (const kind of c.repeatedKinds ?? [c.stage]) {
        push('repeat', lane, order, c.stage, { kind, fault: c.fault });
        if (p.journal) { journal.push({ order, kind }); ledger.push({ order, kind }, { order, kind }); }
      }
    } else if (c.outcome === 'halt') {
      push('lane_halted', lane, order, c.stage, { error: `unhandled ${c.fault}` });
    } else if (c.outcome === 'fail') {
      const err = c.fault === 'missing_file' ? 'ENOENT: no such file' : c.fault === 'http_500' ? 'status 500' : c.fault === 'http_429' ? 'status 429' : c.fault === 'timeout' || LONG_FAULTS.has(c.fault) ? 'timeout' : c.fault;
      const transient = c.fault !== 'disk_full' && !PROCESS_FAULTS.has(c.fault);
      const n = p.retry && LONG_FAULTS.has(c.fault) ? 3 : 1;
      for (let i = 0; i < n; i++) push('stage_fail', lane, order, c.stage, { error: err, fault: c.fault, retryable: transient });
      if (PROCESS_FAULTS.has(c.fault)) push('recover_done', lane, order, c.stage, { ms: 45000 });
      push('order_failed', lane, order, c.stage, { error: err });
    }
  }
  return { events, journal, ledger };
}

export interface LabSuggestion {
  part: string;
  rules: string[];
  stages: string[];
  findings: number;
  /** True when the part is already on and the fix is something else (for example a missing key). */
  alreadyOn: boolean;
  why: string;
  how: string;
}

const PART_TEXT: Record<string, { why: string; how: string }> = {
  retry: { why: 'A transient error ended an order that a second try would have saved.', how: 'Add bounded retries with backoff around the call.' },
  journal: { why: 'After a crash the bot has no record of where it was, so recovery is slow or the order is lost.', how: 'Write each completed step to a journal and replay it on start.' },
  idempotency: { why: 'A side effect ran twice (a repeat or a retry after a timeout).', how: 'Send an idempotency key with every effect and check it before acting.' },
  breaker: { why: 'Repeated failures hammered a dead dependency.', how: 'Open a circuit breaker after a few failures and probe before closing.' },
  offline_queue: { why: 'A missing input, bad payload or outage halted the lane.', how: 'Park the order in an offline queue, quarantine bad input and resume later.' },
};
const partId = (s: string): string => s.replace(/ /g, '_');

export function suggestionsFrom(findings: Finding[], p: PartSet, model: LabModel): LabSuggestion[] {
  const by = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = partId(f.suggestedPart);
    by.set(key, [...(by.get(key) ?? []), f]);
  }
  const out: LabSuggestion[] = [];
  for (const [part, fs] of by) {
    const on = p[part as LabPart] === true;
    const text = PART_TEXT[part] ?? { why: 'The reviewer flagged this stage.', how: 'Review the recovery code.' };
    let how = text.how;
    if (part === 'idempotency' && on) {
      const unkeyed = model.stages.flatMap((s) => (s.effects ?? []).filter((e) => !e.keyed).map((e) => `${s.id}.${e.kind}`));
      how = unkeyed.length ? `The part is on, but these effects carry no key: ${unkeyed.join(', ')}. Add one to each.` : how;
    }
    out.push({
      part, rules: [...new Set(fs.map((f) => f.rule))].sort(), stages: [...new Set(fs.map((f) => f.stage))],
      findings: fs.length, alreadyOn: on, why: text.why, how,
    });
  }
  const rank = (s: LabSuggestion) => -s.findings;
  return out.sort((a, b) => rank(a) - rank(b) || (a.part < b.part ? -1 : 1));
}

export interface LabReport {
  modelBased: true;
  /** Pack labels (creature names, review name, tier text) when the model came from a scenario pack. */
  pack?: LabPackMeta;
  /** Creature id to the label to show (pack names override the defaults). */
  creatureLabels: Record<string, string>;
  label: string;
  name: string;
  seed: number;
  parts: PartSet;
  grade: SweepReport['grade'];
  reliability: number;
  /** Pack bosses as sweep scenarios (empty for plain presets). */
  bosses: LabBossResult[];
  /** Pack curses as persistent traits, with what each one does to the current protections. */
  curses: LabCurseResult[];
  /** The pack's review with sub-scores. */
  review?: LabReview;
  matrix: SweepReport['matrix'];
  cells: SweepReport['cells'];
  findings: Finding[];
  suggestions: LabSuggestion[];
  /** Grade if every suggested part were added (and every effect keyed). */
  gradeWithSuggestions: SweepReport['grade'];
  yaml: string;
  commands: readonly string[];
  elapsedMs: number;
}

async function sweepModel(model: LabModel, p: PartSet, seed: number): Promise<SweepReport> {
  const byId = new Map(model.stages.map((s) => [s.id, s]));
  const curses = labCurses(model);
  return runSweep(labPlan(model), (cell) => {
    const stage = byId.get(cell.stage)!;
    let d = labCell(stage, cell.fault, p);
    for (const c of curses) if (c.stage === cell.stage) d = worse(d, labCell(stage, c.fault, p));
    return d;
  }, seed);
}

export interface LabCurseResult extends LabCurse { creature: string; outcome: CellOutcome }
export interface LabBossCell { stage: string; fault: string; creature: string; outcome: CellOutcome }
export interface LabBossResult { id: string; label: string; story?: string; hits: string[]; cells: LabBossCell[]; outcome: CellOutcome; survived: boolean }
export interface LabReviewScore { id: string; stars: number; stages: string[] }
export interface LabReview { label: string; overall: number; subscores: LabReviewScore[] }

/** A boss is a night: every stage it hits gets that stage's pack faults at once (a crash when the pack lists none), plus the curses. */
export function labBosses(model: LabModel, p: PartSet): LabBossResult[] {
  const pack = model.pack;
  if (!pack) return [];
  const byId = new Map(model.stages.map((s) => [s.id, s]));
  const curses = labCurses(model);
  return pack.bosses.filter((b) => b.hits.every((h) => byId.has(h))).map((b) => {
    const cells: LabBossCell[] = [];
    for (const h of b.hits) {
      const stage = byId.get(h)!;
      const faults = pack.faults.filter((f) => f.stage === h);
      const list = faults.length ? faults.map((f) => ({ fault: packFaultOf(f), creature: f.creature })) : [{ fault: 'crash', creature: 'Reaper' }];
      for (const x of list) {
        let d = labCell(stage, x.fault, p);
        for (const c of curses) if (c.stage === h) d = worse(d, labCell(stage, c.fault, p));
        // Three or more stages failing together: retries with no breaker or queue pile onto each other and finish late.
        if (b.hits.length >= 3 && d.outcome === 'pass' && p.retry && !p.breaker && !p.offline_queue && x.fault !== 'duplicate_request') d = { outcome: 'recovered_late' };
        cells.push({ stage: h, fault: x.fault, creature: x.creature, outcome: d.outcome });
      }
    }
    const outcome = cells.reduce<CellOutcome>((w, c) => ((RANK[c.outcome] ?? 0) > (RANK[w] ?? 0) ? c.outcome : w), 'pass');
    return { id: b.id, label: b.label ?? b.id, ...(b.story ? { story: b.story } : {}), hits: [...b.hits], cells, outcome, survived: RANK[outcome]! <= RANK.recovered_late! };
  });
}

/** Sub-scores of the pack's review (1 to 5 stars): each is judged on the stages the pack maps to it, or on the whole sweep. */
export function labReview(model: LabModel, cells: SweepReport['cells']): LabReview | undefined {
  const rv = model.pack?.review;
  if (!rv) return undefined;
  const score = (stages: string[]): number => {
    const own = stages.length ? cells.filter((c) => stages.includes(c.stage)) : cells;
    if (!own.length) return 5;
    const frac = own.reduce((n, c) => n + (c.outcome === 'pass' ? 1 : c.outcome === 'recovered_late' ? 0.5 : 0), 0) / own.length;
    let stars = Math.max(1, Math.round(1 + 4 * frac));
    if (own.some((c) => c.outcome === 'repeat')) stars = Math.min(stars, 2);
    if (own.some((c) => c.lost)) stars = 1;
    return stars;
  };
  const subscores = rv.subscores.map((id) => ({ id, stars: score(rv.stages?.[id] ?? []), stages: rv.stages?.[id] ?? [] }));
  const overall = Math.round((subscores.reduce((n, s) => n + s.stars, 0) / Math.max(1, subscores.length)) * 10) / 10;
  return { label: rv.label, overall, subscores };
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

/** Sweeps a modelled workflow and returns the graded report with "add this part" suggestions. Deterministic. */
export async function labRun(model: LabModel): Promise<LabReport> {
  const errs = validateLabModel(model);
  if (errs.length) throw new Error(`invalid lab model: ${errs.join('; ')}`);
  const t0 = nowMs();
  const seed = model.seed ?? 1;
  const p = partSet(model);
  const report = await sweepModel(model, p, seed);
  const bosses = labBosses(model, p);
  const curses: LabCurseResult[] = labCurses(model).map((c) => {
    const st = model.stages.find((s) => s.id === c.stage)!;
    return { ...c, creature: LAB_CREATURES.find((x) => x.fault === c.fault)?.label ?? c.fault, outcome: labCell(st, c.fault, p).outcome };
  });
  // Boss cells feed the reviewer as extra lanes, so a failed boss night yields "add this part" suggestions like any sweep cell.
  const bossCells = bosses.flatMap((b) => b.cells.filter((c) => c.outcome !== 'pass').map((c) => ({ stage: c.stage, creature: `boss-${b.id}`, fault: c.fault, outcome: c.outcome })));
  const ev = evidenceFor({ cells: [...report.cells, ...bossCells] as SweepReport['cells'] }, p);
  const review = labReview(model, report.cells);
  const inputStages = model.stages.filter((s) => s.role === 'input').map((s) => s.id);
  const findings = reviewEvents(ev.events, {
    inputStages,
    ...(p.journal && ev.ledger.length ? { journal: ev.journal, ledger: ev.ledger } : {}),
  });
  const suggestions = suggestionsFrom(findings, p, model);

  const all: PartSet = { ...p };
  for (const s of suggestions) if (s.part in all) all[s.part as LabPart] = true;
  const keyed: LabModel = { ...model, stages: model.stages.map((s) => ({ ...s, effects: s.effects?.map((e) => ({ ...e, keyed: all.idempotency ? true : e.keyed })) })) };
  const after = await sweepModel(keyed, all, seed);

  return {
    modelBased: true, label: LAB_LABEL, name: model.name, seed, parts: p,
    ...(model.pack ? { pack: model.pack } : {}),
    creatureLabels: { ...Object.fromEntries(LAB_CREATURES.map((c) => [c.id, c.label])), ...(model.pack?.creatures ?? {}) },
    grade: report.grade, reliability: report.reliability, bosses, curses, ...(review ? { review } : {}), matrix: report.matrix, cells: report.cells,
    findings, suggestions, gradeWithSuggestions: after.grade,
    yaml: labToYaml(model), commands: labCommands(model), elapsedMs: Math.max(0, Math.round(nowMs() - t0)),
  };
}

/** Every fault id the lab uses exists in the shared catalog (checked by the tests). */
export function labFaultsKnown(): boolean {
  return LAB_CREATURES.every((c) => faultById(c.fault) !== undefined);
}

export type { CellOutcome };
