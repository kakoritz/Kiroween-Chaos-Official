// TV3-C12: fix spec writer and lint (spec 8.2).
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DIFF_BUDGET_MAX, FilePatternStore, lintSpecDir, patchFor, renderFixSpec, writeFixSpec, qualifies, type Pattern } from '../src/miner';
import { runReviewer, writeReview } from '../src/reviewer';
import { callTool } from '../src/mcp/server';

const pat = (o: Partial<Pattern>): Pattern => ({
  id: 'p-00000001', signature: 'payment + endpoint_down + order_lost', stage: 'payment', fault: 'endpoint_down', consequence: 'order_lost', shapes: ['case'], count: 4, lanes: [2, 3],
  downtimeMsTotal: 12_000, lostOrders: 4, repeats: 0, points: 0, firstSeen: { run: 'run-a', round: 1, order: 'ord-0001', lane: 2 }, lastSeen: { run: 'run-a', round: 2, lane: 3 }, status: 'new', runs: ['run-a#r1'],
  evidence: [{ run: 'run-a', round: 1, seq: [12, 18], journal: ['.haunt/wave-1/lane-2/journal.jsonl:14'], report: '/api/waves/1/report' }], solvedBy: [], ...o,
});
const DUP = pat({ id: 'p-00000002', signature: 'payment + timeout + duplicate_effect', fault: 'timeout', consequence: 'duplicate_effect', count: 5, lanes: [2, 3], downtimeMsTotal: 3000, lostOrders: 0, repeats: 5, solvedBy: [{ lane: 4, mechanism: 'idempotency_key' }] });
const HANG = pat({ id: 'p-00000003', signature: 'ship + hang + stuck', stage: 'ship', fault: 'hang', consequence: 'stuck', shapes: ['hang'], count: 1, lanes: [1], downtimeMsTotal: 40_000, lostOrders: 0 });
const ODD = pat({ id: 'p-00000004', signature: 'process + weird + order_degraded', stage: 'process', fault: 'weird', consequence: 'order_degraded', count: 5, lostOrders: 0, downtimeMsTotal: 0 });

describe('patches', () => {
  it('every proposed patch fits its diff budget and names a file, a risk, a rollback and a test', () => {
    for (const p of [pat({}), pat({ id: 'p-0000000c', signature: 'payment + crash + order_lost', fault: 'crash', lanes: [1, 2] }), DUP, HANG, pat({ consequence: 'retry_storm', shapes: ['retry_storm'] }), pat({ consequence: 'lane_halted' }), pat({ consequence: 'swallowed', fault: 'curse_cursed_404', shapes: ['curse'] }), pat({ consequence: 'outage', shapes: ['outage'] })]) {
      const patch = patchFor(p)!;
      expect(patch, p.signature).not.toBeNull();
      expect(patch.budgetLines).toBeLessThanOrEqual(DIFF_BUDGET_MAX);
      expect(patch.files.length).toBeGreaterThan(0);
      expect(patch.ears).toMatch(/\bWHEN\b[\s\S]*\bSHALL\b/);
      expect(patch.risk && patch.rollback && patch.test.title && patch.test.how).toBeTruthy();
    }
  });

  it('the patch depends on what the tiers have: a policy rule when a tier can take it, the part when not; a Rookie gets the code change', () => {
    expect(patchFor(pat({ lanes: [2, 3] }))!.files).toEqual(['.haunt/lessons/<lane>.json (haunt.policy overlay)']);
    const rookie = patchFor(pat({ lanes: [1] }))!;
    expect(rookie.files).toContain('apps/haunted-orders/src/bots/rookie.ts');
    expect(rookie.summary).toMatch(/\`retry\` part/);
    expect(patchFor(DUP)!.part).toBe('idempotency');
  });

  it('refuses a patch that would change nothing: every lane that met the pattern already has the part, and the SDK does not enforce it as policy (or a breaker bot already backs off)', () => {
    // A retry storm on the Phoenix is now one the breaker_park lesson changes (it trips the breaker after two failures), so it gets a policy patch; a backoff lesson would change nothing for it.
    expect(patchFor(pat({ consequence: 'retry_storm', shapes: ['retry_storm'], lanes: [5] }))).toMatchObject({ action: 'breaker_park' });
    expect(patchFor(pat({ lanes: [5] }))).toBeNull();
    expect(patchFor(pat({ lanes: [2, 5] }))).not.toBeNull();
    expect(renderFixSpec({ runId: 'r', patterns: [pat({ lanes: [5] })] }).refused).toHaveLength(1);
  });

  it('refuses a shape with no small patch instead of proposing a rewrite', () => {
    expect(patchFor(ODD)).toBeNull();
    const spec = renderFixSpec({ runId: 'r', patterns: [ODD, DUP] });
    expect(spec.included.map((p) => p.id)).toEqual([DUP.id]);
    expect(spec.refused[0]).toMatchObject({ reason: expect.stringMatching(/no small patch/) });
    expect(spec.readme).toMatch(/## Not proposed/);
    expect(spec.requirements + spec.design + spec.tasks).not.toMatch(/process \+ weird/);
  });
});

describe('the spec', () => {
  const spec = renderFixSpec({ runId: 'run-a', patterns: [DUP, pat({}), HANG, pat({ id: 'p-00000009', signature: 'payment + http_404 + order_lost', fault: 'http_404', count: 1, lostOrders: 0, downtimeMsTotal: 0 })], plan: 'the tournament with seed 7', totals: { orders: 40 }, reports: ['/api/waves/1/report'] });

  it('has one requirement per qualifying pattern, sorted by downtime cost, with evidence, impact, hypothesis and what lessons cover', () => {
    expect(spec.included.map((p) => p.signature)).toEqual(['ship + hang + stuck', 'payment + endpoint_down + order_lost', 'payment + timeout + duplicate_effect']);
    expect(qualifies(spec.included[0]!)).toBe(true);
    const r1 = /## R2\.[\s\S]*?(?=## R3\.)/.exec(spec.requirements)![0];
    expect(r1).toMatch(/WHEN endpoint down hits the payment stage, THE bot SHALL retry the call with exponential backoff/);
    expect(r1).toMatch(/\*\*Evidence:\*\* run run-a round 1; events seq 12, 18; journal \.haunt\/wave-1\/lane-2\/journal\.jsonl:14; report \/api\/waves\/1\/report\./);
    expect(r1).toMatch(/\*\*Impact:\*\* downtime 12\.0 s, 4 lost orders, 0 repeated effects, about 1200 points/);
    expect(r1).toMatch(/\*\*Root-cause hypothesis:\*\*/);
    expect(r1).toMatch(/\*\*Covered by lessons:\*\* lanes 2, 3 can take `retry_backoff`/);
    expect(spec.requirements).toMatch(/already solved by Reconciler \(idempotency_key\)/);
  });

  it('design has a patch, risk, rollback and a diff budget; tasks have a regression test and an acceptance line', () => {
    expect(spec.design).toMatch(/### D1 \(R1\) ship \+ hang \+ stuck/);
    expect(spec.design.match(/\*\*Diff budget:\*\* under \d+ lines\./g)).toHaveLength(3);
    expect(spec.design.match(/\*\*Rollback:\*\*/g)).toHaveLength(3);
    expect(spec.tasks.match(/\*\*Regression test:\*\*/g)).toHaveLength(3);
    expect(spec.tasks).toMatch(/fast-check property/);
    expect(spec.tasks).toMatch(/fixture replay/);
    expect(spec.tasks).toMatch(/\*\*Acceptance:\*\* rerun the tournament with seed 7, expect no `payment \+ timeout \+ duplicate_effect` and no repeated effect and downtime under 5 s/);
  });

  it('README: table, expected grade change, lessons coverage, reports, lint line', () => {
    expect(spec.readme).toMatch(/\| 1 \| `ship \+ hang \+ stuck` \| 40\.0 s \|/);
    expect(spec.readme).toMatch(/## Expected grade change[\s\S]*Over 40 orders these patterns cost 4 lost orders and 5 repeated effects/);
    expect(spec.readme).toMatch(/## What lessons already cover/);
    expect(spec.readme).toMatch(/\/api\/waves\/1\/report/);
    expect(spec.readme).toMatch(/spec-lint/);
  });

  it('a clean run produces an empty spec that still lints', () => {
    const dir = mkdtempSync(join(tmpdir(), 'haunt-spec-'));
    const w = writeFixSpec(dir, { runId: 'none', patterns: [] });
    expect(w.included).toEqual([]);
    expect(w.lint.ok).toBe(true);
  });
});

describe('writing and lint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haunt-spec-'));
  const w = writeFixSpec(dir, { runId: 'run-a', patterns: [DUP, pat({}), HANG], plan: 'the tournament with seed 7' });

  it('writes the four files and the generated spec passes lint', () => {
    expect(w.dir.replace(/\\/g, '/')).toMatch(/hardening-run-a$/);
    expect(w.files.map((f) => f.split(/[\\/]/).pop())).toEqual(['requirements.md', 'design.md', 'tasks.md', 'README.md']);
    expect(w.lint).toEqual({ ok: true, issues: [], requirements: 3 });
    expect(() => writeFixSpec(dir, { runId: '../evil', patterns: [] })).toThrow(/unsafe/);
  });

  const broken = (edit: (file: 'requirements.md' | 'design.md' | 'tasks.md', text: string) => string) => {
    const d = mkdtempSync(join(tmpdir(), 'haunt-lint-'));
    const x = writeFixSpec(d, { runId: 'b', patterns: [DUP, pat({})] });
    for (const f of ['requirements.md', 'design.md', 'tasks.md'] as const) writeFileSync(join(x.dir, f), edit(f, readFileSync(join(x.dir, f), 'utf8')));
    return lintSpecDir(x.dir);
  };

  it('fails when a requirement lacks evidence, a patch or a test', () => {
    expect(broken((f, t) => (f === 'requirements.md' ? t.replace(/\*\*Evidence:\*\* [^\n]+/, '**Evidence:** none') : t)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ file: 'requirements.md', message: expect.stringMatching(/lacks evidence/) })]));
    expect(broken((f, t) => (f === 'design.md' ? t.replace(/\*\*Patch:\*\*[^\n]*/g, '') : t)).issues.map((i) => i.message)).toEqual(expect.arrayContaining(['patch is empty']));
    expect(broken((f, t) => (f === 'tasks.md' ? t.replace(/  - \*\*Regression test:\*\*[^\n]*\n/g, '') : t)).issues.map((i) => i.message)).toContain('task lacks a regression test');
    expect(broken((f, t) => (f === 'tasks.md' ? t.replace(/\*\*Acceptance:\*\*/g, '') : t)).issues.map((i) => i.message)).toContain('task lacks an acceptance line');
  });

  it('fails when a task says rewrite, or a patch is over the budget', () => {
    const r = broken((f, t) => (f === 'tasks.md' ? t.replace('- [ ] T1 (R1)', '- [ ] T1 (R1) Rewrite the bot.') : t));
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'T1', message: expect.stringMatching(/rewrite/) })]));
    const big = broken((f, t) => (f === 'design.md' ? t.replace(/under \d+ lines/, 'under 400 lines') : t));
    expect(big.issues.map((i) => i.message).join()).toMatch(/over 40 lines/);
    expect(broken((f, t) => (f === 'requirements.md' ? t.replace(/WHEN /, 'If ') : t)).issues.map((i) => i.message).join()).toMatch(/not an EARS requirement/);
  });

  it('fails a folder with a missing file, and the old rule-based spec format', () => {
    expect(lintSpecDir(join(dir, 'nope')).ok).toBe(false);
    const old = runReviewer('old', []);
    const d = mkdtempSync(join(tmpdir(), 'haunt-old-'));
    const s = writeReview(d, join(d, 'specs'), 'old', old);
    writeFileSync(join(s.specDir, 'requirements.md'), '# r\n\n1. THE bot SHALL address F1 (R1): x. Evidence: seq 1.\n');
    expect(lintSpecDir(s.specDir).ok).toBe(false);
  });
});

describe('the reviewer', () => {
  const events = [
    { type: 'order_start', lane: 2, order: 'ord-0001', seq: 1, detail: {} }, { type: 'stage_start', lane: 2, order: 'ord-0001', stage: 'payment', seq: 2, detail: {} },
    { type: 'chaos', lane: 2, seq: 3, detail: { fault: 'timeout' }, stage: 'payment' }, { type: 'repeat', lane: 2, order: 'ord-0001', stage: 'payment', seq: 4, detail: { kind: 'charge', fault: 'timeout' } },
    { type: 'order_done', lane: 2, order: 'ord-0001', seq: 5, detail: {} },
  ] as never[];

  it('keeps the rule-based text by default and writes the serious spec with fixSpec', () => {
    const base = runReviewer('r1', events);
    expect(base.fixSpec).toBeUndefined();
    expect(base.hardening.requirements).toMatch(/THE bot SHALL address F1/);
    const serious = runReviewer('r1', events, { fixSpec: true });
    expect(serious.fixSpec).toBeDefined();
    const d = mkdtempSync(join(tmpdir(), 'haunt-rev-'));
    const w = writeReview(d, join(d, 'specs'), 'r1', serious);
    expect(existsSync(join(w.specDir, 'README.md'))).toBe(true);
    // No pattern is above the threshold for one repeat, so the spec is empty but valid.
    expect(lintSpecDir(w.specDir).ok).toBe(true);
  });
});

describe('haunt spec-lint (CLI) and haunt_specs (MCP)', () => {
  const root = process.cwd();
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'tools', 'run-ts.mjs'), join(root, 'packages', 'core', 'src', 'bin', 'haunt.ts'), ...args], { cwd: root, encoding: 'utf8' });

  it('exits 0 for a good spec and 1 for a bad one, 2 for usage', () => {
    const d = mkdtempSync(join(tmpdir(), 'haunt-cli-'));
    const w = writeFixSpec(d, { runId: 'cli', patterns: [DUP] });
    const ok = cli('spec-lint', w.dir);
    expect([ok.status, ok.stdout]).toEqual([0, expect.stringMatching(/spec-lint ok/)]);
    writeFileSync(join(w.dir, 'tasks.md'), readFileSync(join(w.dir, 'tasks.md'), 'utf8').replace('- [ ] T1 (R1)', '- [ ] T1 (R1) Rewrite everything.'));
    const bad = cli('spec-lint', w.dir);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/rewrite/);
    expect(cli('spec-lint').status).toBe(2);
  }, 60000);

  it('lists qualifying patterns, writes a spec for the new ones and lints a folder', async () => {
    const work = mkdtempSync(join(tmpdir(), 'haunt-mcp-'));
    const store = new FilePatternStore(join(work, '.haunt', 'patterns.json'));
    store.ingest([{ signature: DUP.signature, stage: 'payment', fault: 'timeout', consequence: 'duplicate_effect', shape: 'case', count: 5, lanes: [2], downtimeMs: 0, lostOrders: 0, repeats: 5, points: 0, firstSeen: { run: 'r' }, evidence: { run: 'r', seq: [1], journal: [] }, solvedBy: [] }], 'r#1');
    const list = JSON.parse(((await callTool({ root: work }, 'haunt_specs', {})).content as { text: string }[])[0]!.text);
    expect(list.patterns).toHaveLength(1);
    expect((await callTool({ root: work }, 'haunt_specs', { action: 'write' })).isError).toBe(true);
    const wr = await callTool({ root: work }, 'haunt_specs', { action: 'write', run: 'mcp1' });
    expect(wr.isError).toBe(false);
    const out = JSON.parse((wr.content as { text: string }[])[0]!.text);
    expect(out.lint.ok).toBe(true);
    expect(store.list()[0]!.status).toBe('suggested');
    expect((await callTool({ root: work }, 'haunt_specs', { action: 'write', run: 'mcp2' })).isError).toBe(true);
    expect((await callTool({ root: work }, 'haunt_specs', { action: 'lint', dir: '.kiro/specs/hardening-mcp1' })).isError).toBe(false);
    expect((await callTool({ root: work }, 'haunt_specs', { action: 'lint', dir: 'nope' })).isError).toBe(true);
    expect(JSON.parse(((await callTool({ root: work }, 'haunt_specs', {})).content as { text: string }[])[0]!.text).specs).toEqual(['hardening-mcp1']);
  });
});

describe('the worked sample from a real run (docs/proof/sample-hardening-spec)', () => {
  it('passes its own lint and every requirement names evidence, a patch within budget and a test', () => {
    const dir = join(process.cwd(), 'docs', 'proof', 'sample-hardening-spec');
    const r = lintSpecDir(dir);
    expect(r.issues).toEqual([]);
    expect(r.requirements).toBeGreaterThanOrEqual(3);
    const design = readFileSync(join(dir, 'design.md'), 'utf8');
    for (const m of design.matchAll(new RegExp('[*][*]Diff budget:[*][*] under ([0-9]+) lines', 'g'))) expect(Number(m[1])).toBeLessThanOrEqual(DIFF_BUDGET_MAX);
    expect(readFileSync(join(dir, 'tasks.md'), 'utf8')).not.toMatch(/rewrite/i);
  });
});
