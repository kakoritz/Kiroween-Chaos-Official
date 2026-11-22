import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listPacks, loadPack } from '../src/packs/load';
import { PACK_TIERS, packToLabModel, parsePack, validatePack } from '../src/packs/pack';
import { STREAMING_PACK_YAML } from '../src/packs/streaming';
import { LAB_CREATURE_IDS, LAB_PRESETS } from '../src/lab/model';
import { LAB_CREATURES, labRun } from '../src/lab';
import { parseYaml } from '../src/config/yaml';

const PACKS = resolve(__dirname, '../../../packs');

describe('pack format (PK-C1)', () => {
  it('lists and loads the streaming and ticketing packs', () => {
    expect(listPacks(PACKS)).toEqual(['streaming', 'ticketing']);
    for (const id of ['streaming', 'ticketing']) expect(loadPack(PACKS, id).id).toBe(id);
  });
  it('keeps the creature id list in step with the engine', () => {
    expect([...LAB_CREATURE_IDS]).toEqual(LAB_CREATURES.map((c) => c.id));
  });
  it('rejects bad packs with readable errors', () => {
    const good = parseYaml(readFileSync(resolve(PACKS, 'streaming/pack.yaml'), 'utf8')) as Record<string, any>;
    expect(validatePack(null)).toEqual(['pack: expected a map']);
    expect(validatePack({ ...good, id: 'Bad Id' })[0]).toMatch(/^id:/);
    expect(validatePack({ ...good, stages: [...good.stages, { ...good.stages[0] }] }).join()).toMatch(/duplicate/);
    expect(validatePack({ ...good, faults: [{ ...good.faults[0], stage: 'nope' }] }).join()).toMatch(/faults\[0\]\.stage/);
    expect(validatePack({ ...good, faults: [{ ...good.faults[0], art: 'dragon' }] }).join()).toMatch(/art/);
    expect(validatePack({ ...good, tiers: { warp: 'x' } }).join()).toMatch(/unknown part/);
    expect(validatePack({ ...good, bosses: [{ id: 'b', hits: ['zzz'] }] }).join()).toMatch(/unknown stage/);
    expect(parsePack('id: [').ok).toBe(false);
  });
  it('builds a generic bot model carrying the pack labels', async () => {
    const p = loadPack(PACKS, 'ticketing');
    const m = packToLabModel(p, PACK_TIERS.phoenix);
    expect(m.stages).toHaveLength(11);
    const r = await labRun(m);
    expect(r.pack?.review.label).toBe('Requester CSAT');
    expect(r.creatureLabels.doppelganger).toBe('Doppelganger');
    expect(r.creatureLabels.wraith).toBe('Banshee Queen');
  });
});

describe('streaming pack (PK-C2)', () => {
  const pack = loadPack(PACKS, 'streaming');
  it('has 11 stages and the nine faults from the spec', () => {
    expect(pack.stages.map((s) => s.id)).toEqual(['login', 'profile', 'browse', 'title_select', 'entitlement', 'license', 'start_stream', 'buffering', 'render', 'ads', 'finish']);
    expect(pack.faults.map((f) => f.id)).toEqual(['buffering', 'cdn_timeout', 'drm_denied', 'render_fail', 'remote_server_down', 'region_lock', 'double_play', 'watch_history_dup', 'token_expired']);
    expect(pack.faults.find((f) => f.id === 'cdn_timeout')).toMatchObject({ creature: 'CDN Kraken', stage: 'start_stream' });
    expect(pack.bosses.map((b) => b.label)).toEqual(['Kraken', 'Server Lich']);
    expect(pack.reviews).toEqual({ label: 'Viewer rating', subscores: ['startup_time', 'buffering', 'render', 'ads', 'ease'] });
    expect(Object.keys(pack.tiers).sort()).toEqual(['breaker', 'idempotency', 'journal', 'offline_queue', 'retry']);
  });
  it('the embedded browser copy equals the pack file', () => {
    expect(STREAMING_PACK_YAML).toBe(readFileSync(resolve(PACKS, 'streaming/pack.yaml'), 'utf8'));
  });
  it('is a labelled Workflow Lab preset', async () => {
    const m = LAB_PRESETS.streaming!;
    expect(m.pack?.modelBased).toBe(true);
    const r = await labRun(m);
    expect(r.label).toMatch(/Model-based/);
    expect(r.creatureLabels.zombie).toBe('CDN Kraken');
  });
  it('the five tiers sweep in order, Rookie F to Phoenix A', async () => {
    const grades: string[] = [];
    const rel: number[] = [];
    for (const parts of Object.values(PACK_TIERS)) {
      const r = await labRun(packToLabModel(pack, parts));
      grades.push(r.grade);
      rel.push(r.reliability);
    }
    expect(grades[0]).toBe('F');
    expect(grades[4]).toBe('A');
    for (let i = 1; i < 5; i++) expect(rel[i]!).toBeGreaterThanOrEqual(rel[i - 1]!);
    expect(rel[4]!).toBeGreaterThan(rel[3]!);
    expect(rel[3]!).toBeGreaterThan(rel[2]!);
  });
  it('tells the double-stream / duplicate-purchase story: blind retry repeats effects, keys fix it', async () => {
    const retrier = await labRun(packToLabModel(pack, PACK_TIERS.retrier));
    const repeats = retrier.cells.filter((c) => c.outcome === 'repeat').flatMap((c) => c.repeatedKinds ?? []);
    expect(repeats).toEqual(expect.arrayContaining(['purchase', 'playback']));
    expect(retrier.suggestions.map((s) => s.part)).toContain('idempotency');
    const rec = await labRun(packToLabModel(pack, PACK_TIERS.reconciler));
    expect(rec.cells.filter((c) => c.outcome === 'repeat')).toHaveLength(0);
  });
});
