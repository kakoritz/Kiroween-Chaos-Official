// covers: PK-U1
import { beforeAll, describe, expect, it } from 'vitest';
import { MODEL_TAG, PackSwitcher, bundledPackChoices, loadPackChoices, packChoices, packTip } from '../src/arena/packs';

class El {
  children: El[] = [];
  className = '';
  textContent = '';
  title = '';
  type = '';
  disabled = false;
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  private cls = new Set<string>();
  classList = {
    add: (...c: string[]) => c.forEach((x) => this.cls.add(x)),
    toggle: (c: string, on?: boolean) => { if (on ?? !this.cls.has(c)) this.cls.add(c); else this.cls.delete(c); return this.cls.has(c); },
    contains: (c: string) => this.cls.has(c),
  };
  private segEl: El | null = null;
  private get seg(): El { return (this.segEl ??= new El()); }
  set innerHTML(v: string) { this.children = []; if (v.includes('class="seg"')) this.children.push(this.seg); else if (this.segEl) this.segEl.children = []; }
  get innerHTML(): string { return ''; }
  querySelector(sel: string): El | null { return sel === '.seg' ? this.seg : null; }
  appendChild(c: El): El { this.children.push(c); return c; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  addEventListener(k: string, f: () => void): void { this.listeners[k] = f; }
}
beforeAll(() => { (globalThis as Record<string, unknown>).document = { createElement: () => new El() }; });

const host = (over: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  return {
    calls,
    h: {
      getApps: async () => [{ id: 'orders' }, { id: 'inbox' }],
      setApp: async (id: string) => { calls.push(`app:${id}`); },
      stopRunning: async () => { calls.push('stop'); },
      reload: async () => { calls.push('reload'); },
      onError: (e: unknown) => { calls.push(`err:${String(e)}`); },
      onPick: (p: { id: string } | null) => { calls.push(`pick:${p?.id ?? 'none'}`); },
      ...over,
    },
  };
};
const seg = (root: El): El[] => root.querySelector('.seg')!.children;

describe('pack switcher (PK-U1)', () => {
  it('reads packs from the bundled data: labels, creatures, review name, model-based tag', () => {
    const packs = bundledPackChoices();
    const s = packs.find((p) => p.id === 'streaming')!;
    expect(s.title).toBe('Haunted Stream');
    expect(s.modelBased).toBe(true);
    expect(s.stageLabels).toContain('Buffering and bitrate');
    expect(s.creatures.map((c) => c.name)).toEqual(expect.arrayContaining(['Buffer Wraith', 'CDN Kraken', 'DRM Gatekeeper', 'Render Gremlin', 'Cloud Banshee']));
    expect(s.reviewLabel).toBe('Viewer rating');
    const t = packs.find((p) => p.id === 'ticketing')!;
    expect(t.appId).toBe('inbox');
    expect(t.reviewLabel).toBe('Requester CSAT');
    expect(packTip(s)).toContain(MODEL_TAG);
  });

  it('prefers the server list, and falls back when the endpoint is missing or fails', async () => {
    const server = [{ id: 'bank', title: 'Haunted Bank', modelBased: false, stages: ['Open', 'Pay'], faults: [{ creature: 'Ledger Ghoul', stage: 'Pay' }], reviews: { label: 'Trust' } }];
    expect((await loadPackChoices(async () => server)).map((p) => p.id)).toEqual(['bank']);
    expect((await loadPackChoices(async () => { throw new Error('404'); })).map((p) => p.id)).toContain('streaming');
    expect((await loadPackChoices(async () => [])).map((p) => p.id)).toContain('ticketing');
    expect((await loadPackChoices()).map((p) => p.id)).toContain('streaming');
    expect(packChoices([null, { title: 'x' }, { id: 'a' }, { id: 'a' }]).map((p) => p.id)).toEqual(['a']);
    expect(packChoices('nope')).toEqual([]);
  });

  it('lists Default plus each pack, and stays hidden with no packs', async () => {
    const root = new El();
    const { h } = host({ getPacks: async () => [] });
    const sw = new PackSwitcher(root as never, { ...h, getPacks: undefined } as never);
    await sw.load();
    expect(root.classList.contains('hidden')).toBe(false);
    expect(seg(root).map((b) => b.dataset.pack)).toEqual(['', 'streaming', 'ticketing']);
    const empty = new El();
    const sw2 = new PackSwitcher(empty as never, { ...h, getPacks: async () => [{ id: 'x', title: 'X' }] } as never);
    await sw2.load();
    expect(seg(empty).map((b) => b.dataset.pack)).toEqual(['', 'x']);
  });

  it('switches the app for a pack that has one, and only previews a model-only pack', async () => {
    const root = new El();
    const { h, calls } = host();
    const sw = new PackSwitcher(root as never, h as never);
    await sw.load();
    await sw.choose('ticketing');
    expect(calls).toEqual(['stop', 'app:inbox', 'reload', 'pick:ticketing']);
    calls.length = 0;
    await sw.choose('streaming');
    expect(calls).toEqual(['pick:streaming']);
    expect(sw.current?.id).toBe('streaming');
    const on = seg(root).find((b) => b.attrs['aria-checked'] === 'true');
    expect(on?.dataset.pack).toBe('streaming');
    await sw.choose(null);
    expect(sw.current).toBeNull();
  });

  it('uses the server setPack when there is one, and reports errors', async () => {
    const root = new El();
    const { h, calls } = host({ setPack: async (id: string) => { calls.push(`pack:${id}`); } });
    const sw = new PackSwitcher(root as never, h as never);
    await sw.load();
    await sw.choose('streaming');
    expect(calls).toEqual(['stop', 'pack:streaming', 'reload', 'pick:streaming']);
    const bad = host({ setPack: async () => { throw new Error('boom'); } });
    const sw2 = new PackSwitcher(new El() as never, bad.h as never);
    await sw2.load();
    await sw2.choose('streaming');
    expect(bad.calls.some((c) => c.startsWith('err:'))).toBe(true);
    expect(sw2.current).toBeNull();
  });
});
