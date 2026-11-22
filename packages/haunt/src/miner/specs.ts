// Fix spec writer and lint (spec 8.2, TV3-C12): one Kiro spec folder `.kiro/specs/hardening-<runId>/` per run, one EARS requirement per
// qualifying pattern with evidence, impact and a root-cause hypothesis; the smallest patch with a diff budget (a rewrite is refused); tasks that
// each carry a regression test and an acceptance line; sorted by downtime cost; README with the expected grade change and what lessons cover.
// Nothing here changes code: Kiro applies a spec with the review step (AGENTS.md).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionsFor, policyTakes, type PolicyAction } from '../sdk/policy';
import { gradeFor, TIERS } from '../shared/catalog';
import { qualifies, type Pattern } from './patterns';
import { tierOfLane } from '../tournament/rounds';

/** No patch may be bigger than this many lines. The miner refuses to propose more: a bigger change is a design discussion, not a patch. */
export const DIFF_BUDGET_MAX = 40;

export interface Patch {
  part: string;
  files: string[];
  summary: string;
  budgetLines: number;
  ears: string;
  hypothesis: string;
  risk: string;
  rollback: string;
  test: { kind: 'property' | 'fixture'; title: string; file: string; how: string };
  /** The policy action that covers it without code, when a tier has the parts for it. */
  action?: string;
}

const bot = (lane: number): string => `apps/haunted-orders/src/bots/${tierOfLane(lane)}.ts`;
const botsOf = (p: Pattern): string[] => [...new Set(p.lanes.map(bot))];
const tiersOf = (p: Pattern): string => [...new Set(p.lanes.map((l) => TIERS[tierOfLane(l)].label))].join(', ') || 'the bot';
const faultText = (f: string): string => f.replace(/_/g, ' ');

/** The smallest patch for a pattern, or null when no small patch is known (the pattern is refused, never "rewritten"). */
export function patchFor(p: Pattern): Patch | null {
  const patch = rawPatchFor(p);
  // If every lane that met it already has the parts for the action and the SDK does not enforce it as policy, adding the part changes nothing:
  // the cause is tuning, which needs a design discussion, so no patch is proposed.
  if (patch?.action && p.lanes.length > 0) {
    const act = patch.action as PolicyAction;
    const has = p.lanes.every((l) => actionsFor(TIERS[tierOfLane(l)].parts).includes(act));
    if (has && !p.lanes.some((l) => policyTakes(TIERS[tierOfLane(l)].parts, act))) return null;
  }
  return patch;
}

/** The lanes of the pattern whose tier lacks any of these parts (all of them when none lacks: the change is then tuning). */
function lacking(p: Pattern, parts: readonly string[]): number[] {
  const ls = p.lanes.filter((l) => !parts.every((x) => (TIERS[tierOfLane(l)].parts as readonly string[]).includes(x)));
  return ls.length ? ls : p.lanes;
}
const botsOfLanes = (ls: readonly number[]): string[] => [...new Set(ls.map(bot))];
const tiersOfLanes = (ls: readonly number[]): string => [...new Set(ls.map((l) => TIERS[tierOfLane(l)].label))].join(', ') || 'the bot';

function rawPatchFor(p: Pattern): Patch | null {
  const stage = p.stage;
  const when = `WHEN ${faultText(p.fault)} hits the ${stage} stage`;
  let bots = botsOf(p);
  let tiers = tiersOf(p);
  /** Narrow the files and the tier names to the lanes that really lack the parts. */
  const narrow = (parts: readonly string[]): void => { const ls = lacking(p, parts); bots = botsOfLanes(ls); tiers = tiersOfLanes(ls); };
  const probe = (title: string, how: string, kind: 'property' | 'fixture' = 'property'): Patch['test'] => ({ kind, title, how, file: `packages/haunt/test/hardening-${p.id}.test.ts` });
  const c = p.consequence;

  if (c === 'duplicate_effect') {
    narrow(['idempotency']);
    return {
      part: 'idempotency', files: [...bots, 'packages/haunt/src/pipeline/pipeline.ts'], budgetLines: 6, action: 'idempotency_key',
      summary: `Add \`idempotency\` to the \`use\` list of ${tiers} so the ${stage} effect is sent with its order key (\`this.key(s, ...)\` in \`Pipeline.stages\` already forwards it).`,
      ears: `${when} and the call is retried, THE bot SHALL send the order's idempotency key so the effect is created at most once.`,
      hypothesis: `${tiers} retries the ${stage} call after ${faultText(p.fault)} without a key, so the provider cannot tell the retry from a new request and writes a second row.`,
      risk: 'Low: keys only add a header. A provider that ignores keys behaves as before.', rollback: 'Remove `idempotency` from the `use` list.',
      test: probe(`no repeated effect at ${stage} under ${p.fault}`, `fast-check: for any seed and a ${p.fault} armed at ${stage}, the provider ledger has one row per (order, kind).`),
    };
  }
  if (c === 'order_lost' && ['timeout', 'comm_timeout', 'slow_link', 'http_404', 'http_429', 'http_500', 'endpoint_down', 'internet_outage', 'sms_down', 'app_down', 'updates_down'].includes(p.fault)) {
    const haveRetry = p.lanes.every((l) => policyTakes(TIERS[tierOfLane(l)].parts, 'retry_backoff'));
    narrow(['retry']);
    return {
      part: 'retry', files: haveRetry ? ['.haunt/lessons/<lane>.json (haunt.policy overlay)'] : [...bots, 'packages/haunt/src/sdk/sdk.ts'], budgetLines: haveRetry ? 8 : 5, action: 'retry_backoff',
      summary: haveRetry
        ? `Add one \`haunt.policy\` rule \`{stage: "${stage}", fault: "${p.fault}", action: "retry_backoff", backoff: "exp", maxAttempts: 5}\` (a lesson); \`Sdk.call\` already honours it.`
        : `Add the \`retry\` part to the \`use\` list of ${tiers}, then the policy rule \`{stage: "${stage}", fault: "${p.fault}", action: "retry_backoff"}\` so \`Sdk.call\` backs off instead of failing the order.`,
      ears: `${when}, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.`,
      hypothesis: `${tiers} makes at most three plain retries 500 ms apart, which is shorter than a typical ${faultText(p.fault)} window, so the order is cancelled while the endpoint is only briefly down.`,
      risk: 'Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.', rollback: 'Delete the policy rule (and the part from the `use` list).',
      test: probe(`order survives ${p.fault} at ${stage}`, `fixture replay: arm ${p.fault} at ${stage} for 3 s on a lane with the change; expect order_done and one row per effect.`, 'fixture'),
    };
  }
  if (c === 'order_lost' && ['crash', 'power_outage', 'out_of_memory'].includes(p.fault)) {
    narrow(['journal']);
    return {
      part: 'journal', files: [...bots, 'packages/haunt/src/sdk/sdk.ts'], budgetLines: 5, action: 'journal_replay',
      summary: `Add the \`journal\` part to the \`use\` list of ${tiers} so a restarted process replays the ${stage} stage from the journal (\`Sdk.stage\` already skips journaled stages) instead of losing the order.`,
      ears: `${when} and the process dies, THE bot SHALL resume the order from its journal after the restart instead of cancelling it.`,
      hypothesis: `${tiers} keeps no journal, so a crash at ${stage} forgets what the order already did and the restart cannot finish it.`,
      risk: 'Low: the journal is an append-only file per lane; a disk-full fault is already absorbed.', rollback: 'Remove `journal` from the `use` list.',
      test: probe(`order survives a crash at ${stage}`, `fast-check: for any seed and a ${p.fault} at ${stage} (any crash point), the order ends done with one row per effect.`),
    };
  }
  if (c === 'lane_halted' || c === 'order_parked' || c === 'order_quarantined') {
    narrow(['breaker', 'offline_queue']);
    return {
      part: 'offline_queue', files: [...bots, 'packages/haunt/src/pipeline/pipeline.ts'], budgetLines: 10, action: 'breaker_park',
      summary: `Add \`breaker\` and \`offline_queue\` to the \`use\` list of ${tiers} so a stuck ${stage} parks the order and the lane keeps running (\`Pipeline.inputFailure\` already maps input errors to park or quarantine).`,
      ears: `${when} and the order cannot finish, THE bot SHALL park it in the offline queue and carry on with the next order instead of halting the lane.`,
      hypothesis: `${tiers} has no offline queue, so one order it cannot finish stops the whole lane.`,
      risk: 'Medium: parked orders must be resumed; the queue needs a resume trigger.', rollback: 'Remove the two parts from the `use` list.',
      test: probe(`lane keeps running after ${p.fault} at ${stage}`, `fast-check: for any seed, a ${p.fault} at ${stage} never ends in lane_halted and no order is lost.`),
    };
  }
  if (p.shapes.includes('hang') || c === 'stuck') {
    return {
      part: 'timeout', files: ['packages/haunt/src/bot/runtime.ts'], budgetLines: 15,
      summary: `In \`runBot\` (\`call\` helper) cap the ${stage} call at 1500 ms and retry once, so a hung call is not waited out.`,
      ears: `WHEN a call at the ${stage} stage takes longer than its p95, THE bot SHALL time out after 1500 ms and retry once instead of waiting.`,
      hypothesis: `A single call at ${stage} hangs past its normal time and the bot waits for it, which shows as downtime without any error.`,
      risk: 'Medium: a slow but healthy call may be cut; a retry can double an effect unless keys are used.', rollback: 'Restore the previous timeout argument of `call`.',
      test: probe(`a hung ${stage} call is cut short`, `fixture replay: a 15 s stall at ${stage}; expect the order done in under 5 s of downtime.`, 'fixture'),
    };
  }
  if (c === 'retry_storm' || p.shapes.includes('retry_storm') || p.shapes.includes('failure_rate')) {
    narrow(['breaker']);
    return {
      part: 'breaker', files: [...bots, 'packages/haunt/src/sdk/sdk.ts'], budgetLines: 6, action: 'breaker_park',
      summary: `Add the \`breaker\` part to the \`use\` list of ${tiers} so repeated failures at ${stage} open the circuit and back off (\`Sdk.noteFailure\` counts them).`,
      ears: `WHEN calls at the ${stage} stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.`,
      hypothesis: `${tiers} keeps calling a failing ${stage} endpoint at a fixed pace, so every order pays the full retry cost.`,
      risk: 'Low: an open breaker pauses calls for 5 s.', rollback: 'Remove `breaker` from the `use` list.',
      test: probe(`no retry storm at ${stage}`, `fast-check: under ${p.fault === 'errors' ? 'a failing endpoint' : p.fault} at ${stage}, calls per order stay under 6.`),
    };
  }
  if (p.shapes.includes('curse')) {
    return {
      part: 'wrapper', files: ['packages/haunt/src/sdk/sdk.ts'], budgetLines: 20,
      summary: `In \`Sdk.call\` treat an unexpected ${faultText(p.fault)} answer as a failure to report (log it, park the order) instead of skipping the step.`,
      ears: `WHEN an endpoint answers with ${faultText(p.fault)} at the ${stage} stage, THE bot SHALL report the failure in the log and park the order instead of skipping the step.`,
      hypothesis: `The bot treats the odd answer as success or ignores it, so the step is skipped silently.`,
      risk: 'Medium: stricter handling may park orders that used to pass.', rollback: 'Revert the `Sdk.call` change.',
      test: probe(`${p.fault} is reported, not swallowed`, `fixture replay: a cursed ${stage} endpoint; expect curse_response class reported or handled, never swallowed.`, 'fixture'),
    };
  }
  if (c === 'outage') {
    narrow(['breaker', 'offline_queue']);
    return {
      part: 'offline_queue', files: [...bots], budgetLines: 8, action: 'breaker_park',
      summary: `Add \`breaker\` and \`offline_queue\` to the \`use\` list of ${tiers} so orders wait out a ${stage} outage parked.`,
      ears: `WHEN the ${stage} endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.`,
      hypothesis: `The lane sits through every outage window at ${stage} in the foreground, so downtime equals the window.`,
      risk: 'Medium: parked orders must be resumed.', rollback: 'Remove the two parts from the `use` list.',
      test: probe(`outage at ${stage} parks and resumes`, `fixture replay: a 20 s outage at ${stage}; expect order_parked then order_resumed then order_done.`, 'fixture'),
    };
  }
  return null;
}

/** What a lesson (a policy overlay) already covers for a pattern: the lanes whose tier can take the patch's action, and who already solved it. */
export function lessonCover(p: Pattern, patch: Patch | null): { lanes: number[]; solved: string[] } {
  const lanes = patch?.action ? p.lanes.filter((l) => policyTakes(TIERS[tierOfLane(l)].parts, patch.action as PolicyAction)) : [];
  return { lanes, solved: p.solvedBy.map((s) => `${TIERS[tierOfLane(s.lane)].label} (${s.mechanism})`) };
}

const sec = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export interface FixSpecInput {
  runId: string;
  patterns: readonly Pattern[];
  /** What was run, for the acceptance lines: e.g. `tournament seed 7, rounds 5/4/3/2 lanes`. */
  plan?: string;
  /** Totals for the expected grade change. */
  totals?: { orders: number };
  /** Report links, e.g. `/api/waves/3/report`. */
  reports?: string[];
}

export interface FixSpec {
  requirements: string;
  design: string;
  tasks: string;
  readme: string;
  included: Pattern[];
  refused: { pattern: Pattern; reason: string }[];
}

/** Reliability the planner would score: orders done minus 15 points per repeated effect row. */
function reliability(orders: number, lost: number, repeats: number): number {
  return Math.max(0, Math.round((100 * (orders - lost)) / Math.max(1, orders) - 15 * repeats));
}

export function renderFixSpec(input: FixSpecInput): FixSpec {
  const { runId } = input;
  const plan = input.plan ?? 'the same plan and seed';
  // Sorted by downtime cost; lost orders and repeats break ties.
  const ranked = input.patterns.filter(qualifies).sort((a, b) => b.downtimeMsTotal - a.downtimeMsTotal || b.lostOrders - a.lostOrders || b.repeats - a.repeats || a.signature.localeCompare(b.signature));
  const included: Pattern[] = [];
  const refused: FixSpec['refused'] = [];
  const patches = new Map<string, Patch>();
  for (const p of ranked) {
    const patch = patchFor(p);
    if (!patch) refused.push({ pattern: p, reason: 'no small patch is known for this shape; it needs a design discussion before any change' });
    else if (patch.budgetLines > DIFF_BUDGET_MAX) refused.push({ pattern: p, reason: `the smallest known patch is ${patch.budgetLines} lines, over the budget of ${DIFF_BUDGET_MAX}` });
    else { included.push(p); patches.set(p.id, patch); }
  }

  const req = [`# Hardening requirements ${runId}`, '', `Run ${runId}. ${included.length} pattern${included.length === 1 ? '' : 's'}, sorted by downtime cost. Each requirement has evidence, a patch (design.md) and a regression test (tasks.md).`, ''];
  const des = [`# Hardening design ${runId}`, '', 'The smallest patch for each requirement. Every patch has a diff budget; a change that does not fit its budget is not proposed here.', ''];
  const tasks = [`# Hardening tasks ${runId}`, '', 'Ordered by downtime cost. Each task adds a regression test and has an acceptance line. Apply with the review step; nothing here is applied automatically.', ''];
  const rows: string[] = [];
  let lostTotal = 0, repeatTotal = 0;

  included.forEach((p, i) => {
    const n = i + 1;
    const patch = patches.get(p.id)!;
    const cover = lessonCover(p, patch);
    const ev = p.evidence[p.evidence.length - 1] ?? { run: runId, seq: [], journal: [] };
    const refs = [
      `run ${p.runs[0]?.split('#')[0] ?? runId}${ev.round !== undefined ? ` round ${ev.round}` : ''}`,
      ...(p.evidence.flatMap((e) => e.seq).length ? [`events seq ${[...new Set(p.evidence.flatMap((e) => e.seq))].slice(0, 6).join(', ')}`] : []),
      ...(p.evidence.flatMap((e) => e.journal).length ? [`journal ${[...new Set(p.evidence.flatMap((e) => e.journal))].slice(0, 3).join(', ')}`] : []),
      ...(p.evidence.some((e) => e.report) ? [`report ${[...new Set(p.evidence.map((e) => e.report).filter(Boolean))].slice(0, 2).join(', ')}`] : []),
    ];
    const points = p.lostOrders * 300 + p.repeats * 150 + p.points;
    lostTotal += p.lostOrders; repeatTotal += p.repeats;
    req.push(
      `## R${n}. ${p.signature}`, '',
      patch.ears, '',
      `**Evidence:** ${refs.join('; ')}.`, '',
      `**Impact:** downtime ${sec(p.downtimeMsTotal)}, ${p.lostOrders} lost ${p.lostOrders === 1 ? 'order' : 'orders'}, ${p.repeats} repeated ${p.repeats === 1 ? 'effect' : 'effects'}, about ${points} points; seen ${p.count} times on lane${p.lanes.length === 1 ? '' : 's'} ${p.lanes.join(', ')} (${tiersOf(p)}). Lost orders review as one star.`, '',
      `**Root-cause hypothesis:** ${patch.hypothesis}`, '',
      `**Covered by lessons:** ${cover.lanes.length ? `lanes ${cover.lanes.join(', ')} can take \`${patch.action}\` as a policy overlay` : 'no tier that met it can take this as a policy; it needs the code change'}${cover.solved.length ? `; already solved by ${cover.solved.join(', ')}` : ''}.`, '',
    );
    des.push(
      `### D${n} (R${n}) ${p.signature}`, '',
      `**Patch:** ${patch.summary}`, '',
      `**Files:** ${patch.files.map((f) => `\`${f}\``).join(', ')}`, '',
      `**Why:** ${patch.hypothesis}`, '',
      `**Risk:** ${patch.risk}`, '',
      `**Rollback:** ${patch.rollback}`, '',
      `**Diff budget:** under ${patch.budgetLines} lines.`, '',
    );
    tasks.push(
      `- [ ] T${n} (R${n}) ${patch.summary}`,
      `  - **Regression test:** ${patch.test.kind === 'property' ? 'fast-check property' : 'fixture replay'} \`${patch.test.title}\` in \`${patch.test.file}\`. ${patch.test.how}`,
      `  - **Acceptance:** rerun ${plan}, expect no \`${p.signature}\`${p.consequence === 'duplicate_effect' ? ' and no repeated effect' : ''} and downtime under 5 s for it.`, '',
    );
    rows.push(`| ${n} | \`${p.signature}\` | ${sec(p.downtimeMsTotal)} | ${p.lostOrders} | ${p.repeats} | ${p.status} | ${cover.lanes.length ? `yes (lanes ${cover.lanes.join(', ')})` : 'no'} |`);
  });
  if (!included.length) { req.push('No pattern is above the threshold. Nothing to harden.', ''); des.push('No patches.', ''); tasks.push('No tasks.', ''); }

  const orders = input.totals?.orders;
  const nowRel = orders ? reliability(orders, lostTotal, repeatTotal) : undefined;
  const readme = [
    `# Hardening ${runId}`, '',
    `${included.length} fix${included.length === 1 ? '' : 'es'} for the patterns above the threshold (count 3, any lost order, or over 30 s of downtime), sorted by downtime cost. Written by the pattern miner; Kiro applies a spec with the review step, never automatically.`, '',
    '| # | Pattern | Downtime | Lost | Repeats | Status when written | Lessons cover it |', '|---|---|---|---|---|---|---|', ...(rows.length ? rows : ['| - | none | - | - | - | - | - |']), '',
    '## Expected grade change', '',
    orders && nowRel !== undefined
      ? `Over ${orders} orders these patterns cost ${lostTotal} lost orders and ${repeatTotal} repeated effects: reliability ${nowRel} (grade ${gradeFor(nowRel)}) now, about 100 (grade A) once every requirement holds. Rerun ${plan} to verify; a pattern is verified only when the rerun shows it gone.`
      : `Removing these patterns removes ${lostTotal} lost orders and ${repeatTotal} repeated effects. Rerun ${plan} to verify; a pattern is verified only when the rerun shows it gone.`, '',
    '## What lessons already cover', '',
    ...(included.length ? included.map((p, i) => { const c = lessonCover(p, patches.get(p.id)!); return `- R${i + 1}: ${c.lanes.length ? `lanes ${c.lanes.join(', ')} can take the overlay now (no code)` : 'needs code'}${c.solved.length ? `; solved by ${c.solved.join(', ')}` : ''}.`; }) : ['- Nothing to cover.']), '',
    ...(refused.length ? ['## Not proposed', '', 'These patterns are above the threshold, but no small patch is known, so no change is proposed. They need a design discussion first.', '', ...refused.map((r) => `- \`${r.pattern.signature}\`: ${r.reason}.`), ''] : []),
    ...(input.reports?.length ? ['## Reports', '', ...input.reports.map((r) => `- ${r}`), ''] : []),
    `Lint: \`npm run haunt -- spec-lint .kiro/specs/hardening-${runId}\``, '',
  ].join('\n');

  return { requirements: req.join('\n') + '\n', design: des.join('\n') + '\n', tasks: tasks.join('\n') + '\n', readme, included, refused };
}

// ------------------------------------------------------------------------------------------------------------------ lint

export interface LintIssue { file: string; id?: string; message: string }
export interface LintResult { ok: boolean; issues: LintIssue[]; requirements: number }

const REWRITE = /\brewrit(?:e|es|ing|ten)\b|from scratch|re-?architect|replace the (?:whole|entire)/i;

function sections(text: string, head: RegExp): { id: string; n: number; body: string }[] {
  const out: { id: string; n: number; body: string }[] = [];
  const lines = text.split('\n');
  let cur: { id: string; n: number; body: string[] } | null = null;
  for (const line of lines) {
    const m = head.exec(line);
    if (m) { if (cur) out.push({ id: cur.id, n: cur.n, body: cur.body.join('\n') }); cur = { id: m[0].trim(), n: Number(m[1]), body: [line] }; }
    else if (cur) cur.body.push(line);
  }
  if (cur) out.push({ id: cur.id, n: cur.n, body: cur.body.join('\n') });
  return out;
}

/** `haunt spec-lint`: every requirement has evidence, a patch and a test; no task or patch says rewrite; every patch fits its diff budget. */
export function lintSpecDir(dir: string): LintResult {
  const issues: LintIssue[] = [];
  const add = (file: string, message: string, id?: string): void => { issues.push({ file, message, ...(id ? { id } : {}) }); };
  const read = (f: string): string | undefined => { const p = join(dir, f); return existsSync(p) ? readFileSync(p, 'utf8') : undefined; };
  const reqs = read('requirements.md'), des = read('design.md'), tasks = read('tasks.md');
  if (reqs === undefined) add('requirements.md', 'missing');
  if (des === undefined) add('design.md', 'missing');
  if (tasks === undefined) add('tasks.md', 'missing');
  if (read('README.md') === undefined) add('README.md', 'missing');
  if (reqs === undefined || des === undefined || tasks === undefined) return { ok: false, issues, requirements: 0 };

  const R = sections(reqs, /^## R(\d+)\./);
  const D = sections(des, /^### D(\d+) /);
  const T = sections(tasks, /^- \[[ xX]\] T(\d+) /);
  for (const r of R) {
    const id = `R${r.n}`;
    if (!/\bWHEN\b[\s\S]*\bSHALL\b/.test(r.body)) add('requirements.md', 'is not an EARS requirement (WHEN ... THE bot SHALL ...)', id);
    const ev = /\*\*Evidence:\*\*\s*([^\n]+)/.exec(r.body)?.[1] ?? '';
    if (!ev.trim() || !/\brun\s+\S+|seq\s*\d|journal|report/i.test(ev)) add('requirements.md', 'lacks evidence (a run id, event seq, journal line or report link)', id);
    if (!/\*\*Impact:\*\*/.test(r.body)) add('requirements.md', 'lacks impact', id);
    if (!/\*\*Root-cause hypothesis:\*\*/.test(r.body)) add('requirements.md', 'lacks a root-cause hypothesis', id);
    const d = D.find((x) => x.n === r.n);
    if (!d) add('design.md', 'has no patch for this requirement', id);
    else {
      const patch = /\*\*Patch:\*\*\s*([^\n]+)/.exec(d.body)?.[1]?.trim();
      if (!patch) add('design.md', 'patch is empty', id);
      if (!/\*\*Files:\*\*\s*\S/.test(d.body)) add('design.md', 'patch names no file', id);
      if (!/\*\*Risk:\*\*/.test(d.body) || !/\*\*Rollback:\*\*/.test(d.body)) add('design.md', 'patch lacks risk or rollback', id);
      const b = /\*\*Diff budget:\*\*\s*under\s+(\d+)\s+lines/i.exec(d.body);
      if (!b) add('design.md', 'patch lacks a diff budget ("under N lines")', id);
      else if (Number(b[1]) > DIFF_BUDGET_MAX) add('design.md', `diff budget ${b[1]} is over ${DIFF_BUDGET_MAX} lines: this is a rewrite, not a patch`, id);
    }
    const t = T.find((x) => x.n === r.n);
    if (!t) add('tasks.md', 'has no task for this requirement', id);
    else {
      if (!/\*\*Regression test:\*\*\s*\S/.test(t.body)) add('tasks.md', 'task lacks a regression test', id);
      if (!/\*\*Acceptance:\*\*\s*\S/.test(t.body)) add('tasks.md', 'task lacks an acceptance line', id);
    }
  }
  for (const d of D) if (!R.some((r) => r.n === d.n)) add('design.md', 'patch has no requirement', `D${d.n}`);
  for (const t of T) {
    if (!R.some((r) => r.n === t.n)) add('tasks.md', 'task has no requirement', `T${t.n}`);
    if (REWRITE.test(t.body)) add('tasks.md', 'a task says rewrite: only small patches are allowed', `T${t.n}`);
  }
  for (const d of D) if (REWRITE.test(d.body)) add('design.md', 'a patch says rewrite: only small patches are allowed', `D${d.n}`);
  return { ok: issues.length === 0, issues, requirements: R.length };
}

export function renderLint(r: LintResult, dir: string): string {
  if (r.ok) return `spec-lint ok: ${dir} (${r.requirements} requirement${r.requirements === 1 ? '' : 's'})`;
  return [`spec-lint failed: ${dir}`, ...r.issues.map((i) => `  ${i.file}${i.id ? ` ${i.id}` : ''}: ${i.message}`)].join('\n');
}

// ------------------------------------------------------------------------------------------------------------------ write

export interface WrittenSpec { dir: string; files: string[]; included: Pattern[]; refused: FixSpec['refused']; lint: LintResult }

/** Writes `<specsDir>/hardening-<runId>/{requirements,design,tasks,README}.md` and lints them. Throws on an unsafe run id. */
export function writeFixSpec(specsDir: string, input: FixSpecInput): WrittenSpec {
  if (!/^[A-Za-z0-9._-]+$/.test(input.runId) || input.runId.startsWith('.')) throw new Error(`unsafe run id: ${input.runId}`);
  const spec = renderFixSpec(input);
  const dir = join(specsDir, `hardening-${input.runId}`);
  mkdirSync(dir, { recursive: true });
  const files = [['requirements.md', spec.requirements], ['design.md', spec.design], ['tasks.md', spec.tasks], ['README.md', spec.readme]] as const;
  for (const [f, text] of files) writeFileSync(join(dir, f), text);
  return { dir, files: files.map(([f]) => join(dir, f)), included: spec.included, refused: spec.refused, lint: lintSpecDir(dir) };
}

/** Hardening folders under a specs folder. */
export function listSpecs(specsDir: string): string[] {
  return existsSync(specsDir) ? readdirSync(specsDir).filter((n) => /^hardening-[A-Za-z0-9._-]+$/.test(n)).sort() : [];
}
