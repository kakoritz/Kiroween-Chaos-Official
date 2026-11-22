import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPack } from '../src/packs/load';
import { PACK_TIERS, packToLabModel, parsePack, validatePack } from '../src/packs/pack';
import { checkPackId, packTemplate, scaffoldPack } from '../src/packs/scaffold';
import { initCommand, packCommand } from '../src/packs/cli';
import { EMBEDDED_PACKS } from '../src/packs/embedded';
import { LAB_PRESETS } from '../src/lab/model';
import { labBosses, labCurses, labPlan, labRun, packFaultOf } from '../src/lab/engine';
import { partSet } from '../src/lab/model';
import { parseHauntConfig } from '../src/config/haunt-config';
import { parseYaml } from '../src/config/yaml';

const ROOT = resolve(__dirname, '../../..');
const PACKS = resolve(ROOT, 'packs');
const lf = (t: string): string => t.split(String.fromCharCode(13)).join('');
const tmp: string[] = [];
const mk = (): string => { const d = mkdtempSync(join(tmpdir(), 'haunt-packs-')); tmp.push(d); return d; };
afterEach(() => { while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true }); });

describe('embedded copies never drift (packs:embed)', () => {
  it('embedded.ts equals every packs/*/pack.yaml, and the script says so with --check', async () => {
    const { embedPacks, readPacks } = await import(pathToFileURL(resolve(ROOT, 'tools/embed-packs.mjs')).href) as { embedPacks(o: { check?: boolean; base?: string }): string[]; readPacks(b?: string): Record<string, string> };
    expect(embedPacks({ check: true })).toEqual([]);
    const files = readPacks();
    expect(Object.keys(EMBEDDED_PACKS).sort()).toEqual(Object.keys(files).sort());
    for (const [id, text] of Object.entries(files)) expect(lf(EMBEDDED_PACKS[id]!)).toBe(lf(text));
  });
  it('a new pack folder is embedded by the script with no hand edit', async () => {
    const { embedPacks } = await import(pathToFileURL(resolve(ROOT, 'tools/embed-packs.mjs')).href) as { embedPacks(o: { check?: boolean; base?: string }): string[] };
    const base = mk();
    scaffoldPack(join(base, 'packs'), 'shop-desk');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(base, 'packages/haunt/src/packs'), { recursive: true });
    expect(embedPacks({ check: true, base })).toHaveLength(1);
    expect(embedPacks({ base })).toHaveLength(1);
    expect(embedPacks({ check: true, base })).toEqual([]);
    expect(readFileSync(join(base, 'packages/haunt/src/packs/embedded.ts'), 'utf8')).toContain('"shop-desk"');
  });
});

describe('ticketing preset', () => {
  const pack = loadPack(PACKS, 'ticketing');
  it('lists the full fault list from the spec, duplicate_storm included', () => {
    expect(pack.faults.map((f) => f.id).sort()).toEqual(['assignee_deleted', 'duplicate_storm', 'field_mapping_error', 'notify_down', 'rate_limited', 'sla_breach', 'sso_expired', 'webhook_retry_storm', 'wrong_queue']);
    expect(pack.faults.find((f) => f.id === 'duplicate_storm')).toMatchObject({ stage: 'dedupe', creature: 'Zombie horde' });
  });
  it('is a Lab preset and sweeps the pack faults on their own stages', async () => {
    const m = LAB_PRESETS.ticketing!;
    expect(m.pack?.id).toBe('ticketing');
    const plan = labPlan(m);
    expect(plan.cells).toContainEqual({ stage: 'dedupe', creature: 'zombie', fault: 'duplicate_request' });
    const rookie = await labRun(m);
    const storm = rookie.cells.find((c) => c.stage === 'dedupe' && c.creature === 'zombie')!;
    expect(storm.outcome).toBe('repeat');
    const keyed = await labRun(packToLabModel(pack, PACK_TIERS.reconciler));
    expect(keyed.cells.find((c) => c.stage === 'dedupe' && c.creature === 'zombie')!.outcome).toBe('pass');
    expect(keyed.cells.filter((c) => c.outcome === 'repeat')).toHaveLength(0);
  });
  it('Rookie F to Phoenix A with the Requester CSAT sub-scores', async () => {
    const rookie = await labRun(packToLabModel(pack, PACK_TIERS.rookie));
    const phoenix = await labRun(packToLabModel(pack, PACK_TIERS.phoenix));
    expect(rookie.grade).toBe('F');
    expect(phoenix.grade).toBe('A');
    expect(phoenix.review?.label).toBe('Requester CSAT');
    expect(phoenix.review?.subscores.map((s) => s.id)).toEqual(['first_response', 'resolution_time', 'reassignments', 'sla', 'ease']);
    expect(phoenix.review?.overall).toBeGreaterThan(rookie.review!.overall);
  });
});

describe('bosses are sweep scenarios (consumed by the lab model)', () => {
  const pack = loadPack(PACKS, 'streaming');
  it('maps each boss to its stages and their pack faults', () => {
    const b = labBosses(packToLabModel(pack), partSet({}));
    expect(b.map((x) => x.id)).toEqual(['cdn_kraken', 'server_lich']);
    const kraken = b[0]!;
    expect(kraken.cells.map((c) => c.stage)).toEqual(expect.arrayContaining(['start_stream', 'buffering', 'render']));
    expect(kraken.cells.find((c) => c.creature === 'CDN Kraken')).toBeTruthy();
    expect(kraken.survived).toBe(false);
  });
  it('Phoenix survives every boss, the Rookie none, and the report carries them', async () => {
    const phoenix = await labRun(packToLabModel(pack, PACK_TIERS.phoenix));
    const rookie = await labRun(packToLabModel(pack, PACK_TIERS.rookie));
    expect(phoenix.bosses.every((x) => x.survived)).toBe(true);
    expect(rookie.bosses.some((x) => x.survived)).toBe(false);
  });
  it('a night of three or more hits punishes retries that have no breaker or queue', () => {
    const m = packToLabModel(pack, { retry: true, journal: true, idempotency: true });
    const kraken = labBosses(m, partSet(m)).find((x) => x.id === 'cdn_kraken')!;
    expect(kraken.cells.some((c) => c.outcome === 'recovered_late')).toBe(true);
    const one = labBosses({ ...m, pack: { ...m.pack!, bosses: [{ id: 'solo', hits: ['render'] }] } }, partSet(m))[0]!;
    expect(one.cells.every((c) => c.outcome === 'pass')).toBe(true);
  });
  it('a failed boss night produces "add this part" suggestions', async () => {
    const r = await labRun(packToLabModel(pack, { retry: true, journal: true, idempotency: true }));
    expect(r.suggestions.map((s) => s.part)).toEqual(expect.arrayContaining(['breaker']));
  });
  it('plain presets have no bosses, curses or review', async () => {
    const r = await labRun(LAB_PRESETS.orders!);
    expect(r.bosses).toEqual([]);
    expect(r.curses).toEqual([]);
    expect(r.review).toBeUndefined();
  });
});

describe('curses are persistent traits', () => {
  const pack = loadPack(PACKS, 'streaming');
  it('resolves each curse to a declared stage and a catalog fault', () => {
    expect(labCurses(packToLabModel(pack))).toEqual([
      { id: 'cursed_404', endpoint: 'catalog', stage: 'browse', fault: 'http_404' },
      { id: 'cursed_manifest', endpoint: 'manifest', stage: 'buffering', fault: 'http_500' },
    ]);
  });
  it('turns a passing cell into a failure when the protection that would absorb the curse is missing', async () => {
    const parts = { journal: true, idempotency: true, breaker: true, offline_queue: false };
    const cursed = await labRun({ ...packToLabModel(pack, parts) });
    const clean = await labRun({ ...packToLabModel(pack, parts), pack: { ...packToLabModel(pack).pack!, curses: [] } });
    // the Doppelganger at the browse stage is absorbed by idempotency; with no retry the always-on 404 curse still fails the stage
    const key = (r: typeof cursed): string | undefined => r.cells.find((c) => c.stage === 'browse' && c.creature === 'doppelganger')?.outcome;
    expect(key(clean)).toBe('pass');
    expect(key(cursed)).toBe('fail');
    expect(cursed.curses.find((c) => c.id === 'cursed_404')?.outcome).toBe('fail');
    expect(cursed.reliability).toBeLessThan(clean.reliability);
  });
  it('with retry the curse is absorbed', async () => {
    const r = await labRun(packToLabModel(pack, PACK_TIERS.phoenix));
    expect(r.curses.every((c) => c.outcome === 'pass')).toBe(true);
  });
});

describe('review sub-scores', () => {
  it('are stars from 1 to 5 judged on the mapped stages', async () => {
    const pack = loadPack(PACKS, 'streaming');
    const rookie = await labRun(packToLabModel(pack, PACK_TIERS.rookie));
    const phoenix = await labRun(packToLabModel(pack, PACK_TIERS.phoenix));
    for (const s of rookie.review!.subscores.concat(phoenix.review!.subscores)) { expect(s.stars).toBeGreaterThanOrEqual(1); expect(s.stars).toBeLessThanOrEqual(5); }
    expect(phoenix.review!.subscores.every((s) => s.stars === 5)).toBe(true);
    expect(rookie.review!.subscores.find((s) => s.id === 'startup_time')!.stages).toEqual(['login', 'entitlement', 'license', 'start_stream']);
    expect(rookie.review!.overall).toBeLessThan(3);
    // the duplicate purchase pitfall caps the stars of the stage group that holds it
    const retrier = await labRun(packToLabModel(pack, PACK_TIERS.retrier));
    expect(retrier.review!.subscores.find((s) => s.id === 'startup_time')!.stars).toBeLessThanOrEqual(2);
  });
  it('mode mapping falls back to the art creature', () => {
    expect(packFaultOf({ id: 'x', stage: 's', creature: 'X', art: 'ghost', mode: 'nonsense', behavior: 'b' })).toBe('http_404');
    expect(packFaultOf({ id: 'x', stage: 's', creature: 'X', art: 'ghost', mode: 'duplicate', behavior: 'b' })).toBe('duplicate_request');
  });
  it('validates the new curse and review fields', () => {
    const good = parseYaml(readFileSync(resolve(PACKS, 'streaming/pack.yaml'), 'utf8')) as Record<string, any>;
    expect(validatePack(good)).toEqual([]);
    expect(validatePack({ ...good, curses: [{ id: 'c', endpoint: 'e', stage: 'nope' }] }).join()).toMatch(/curses\[0\]\.stage/);
    expect(validatePack({ ...good, curses: [{ id: 'c', endpoint: 'e', fault: 'frost' }] }).join()).toMatch(/curses\[0\]\.fault/);
    expect(validatePack({ ...good, reviews: { ...good.reviews, stages: { render: ['zzz'] } } }).join()).toMatch(/reviews\.stages\.render/);
    expect(validatePack({ ...good, reviews: { ...good.reviews, stages: { bogus: ['render'] } } }).join()).toMatch(/not a declared subscore/);
  });
});

describe('haunt pack new / init (reusable skeleton)', () => {
  it('the template is valid and a new pack runs through the Lab the same day', async () => {
    const r = parsePack(packTemplate('shop-desk'));
    expect(r.ok).toBe(true);
    const dir = mk();
    const made = scaffoldPack(dir, 'shop-desk', { title: 'Haunted Shop' });
    expect(existsSync(made.file)).toBe(true);
    const pack = loadPack(dir, 'shop-desk');
    expect(pack.title).toBe('Haunted Shop');
    const rookie = await labRun(packToLabModel(pack, PACK_TIERS.rookie));
    const phoenix = await labRun(packToLabModel(pack, PACK_TIERS.phoenix));
    expect(rookie.grade).toBe('F');
    expect(phoenix.grade).toBe('A');
    expect(phoenix.bosses.every((b) => b.survived)).toBe(true);
  });
  it('refuses bad, reserved and existing ids', () => {
    const dir = mk();
    expect(checkPackId('Bad Id')).toMatch(/^id:/);
    expect(checkPackId('payments')).toMatch(/built-in/);
    expect(() => scaffoldPack(dir, 'x')).toThrow(/id:/);
    scaffoldPack(dir, 'a-pack');
    expect(() => scaffoldPack(dir, 'a-pack')).toThrow(/already exists/);
    expect(() => scaffoldPack(dir, 'a-pack', { force: true })).not.toThrow();
  });
  it('the CLI creates, lists and checks a pack and reports errors with exit code 2', async () => {
    const dir = mk();
    const out: string[] = [];
    const log = (s: string): void => { out.push(s); };
    expect(await packCommand(['new', 'queue-app', '--dir', dir], log)).toBe(0);
    expect(await packCommand(['new', 'queue-app', '--dir', dir], log)).toBe(2);
    expect(await packCommand(['new'], log)).toBe(2);
    expect(await packCommand(['list', '--dir', dir], log)).toBe(0);
    expect(await packCommand(['check', 'queue-app', '--dir', dir], log)).toBe(0);
    expect(await packCommand(['check', 'missing', '--dir', dir], log)).toBe(2);
    expect(out.join('\n')).toMatch(/queue-app: valid.*Phoenix A/s);
    expect(await packCommand(['bogus'], log)).toBe(2);
  });
  it('init writes a haunt.yaml that validates, from a pack or from the template, and never overwrites silently', () => {
    const dir = mk();
    const log = (): void => {};
    expect(initCommand(['--pack', 'ticketing', '--dir', dir, '--packs', PACKS], log)).toBe(0);
    const text = readFileSync(join(dir, 'haunt.yaml'), 'utf8');
    expect(parseHauntConfig(text).ok).toBe(true);
    expect(text).toContain('name: ticketing-lab');
    expect(initCommand(['--pack', 'ticketing', '--dir', dir, '--packs', PACKS], log)).toBe(2);
    expect(initCommand(['--pack', 'ticketing', '--dir', dir, '--packs', PACKS, '--force'], log)).toBe(0);
    const blank = mk();
    expect(initCommand(['--dir', blank], log)).toBe(0);
    expect(parseHauntConfig(readFileSync(join(blank, 'haunt.yaml'), 'utf8')).ok).toBe(true);
    expect(initCommand(['--pack', 'nope', '--dir', mk(), '--packs', PACKS], log)).toBe(2);
  });
});

describe('lab commands follow the pack', () => {
  it('pack presets show pack commands; plain presets keep the generic ones', async () => {
    for (const id of ['streaming', 'ticketing']) {
      const r = await labRun(LAB_PRESETS[id]!);
      expect(r.commands).toEqual([`npx haunt init --pack ${id}`, `npx haunt pack check ${id}`, 'haunt validate', 'haunt sweep']);
    }
    for (const id of ['orders', 'inbox']) {
      expect((await labRun(LAB_PRESETS[id]!)).commands).toEqual(['npx haunt init', 'haunt validate', 'haunt sweep']);
    }
  });
});
