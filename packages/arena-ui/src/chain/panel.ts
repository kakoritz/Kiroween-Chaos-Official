// Chain wizard DOM (modular-engine R12.3): library on the left, the chain in the middle, warnings and the test on the right.
// Everything runs in this page; nothing is sent anywhere.
import { CARD_TIERS, PROTECTIONS, chainChecks, chainReport, protectionsOf, runBlock, tierOfProtections, type BlockCard, type CardTier, type ChainReport, type Protections } from '../../../haunt/src/blocks/cards';
import { PART_LABEL } from '../workflow-lab/model';
import { addBlock, addCustom, chainProblems, emptyChain, fromConfig, libraryByRole, move, removeAt, rename, toConfig, toYaml, type ChainModel } from './model';
import { parseHauntConfig } from '../../../haunt/src/config/haunt-config';

export const HONEST = 'Model-based what-if: results come from the same rules as the Workflow Lab, not from your running code. Run your real bot in the arena to confirm.';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountChain(root: HTMLElement): { getModel(): ChainModel; setModel(m: ChainModel): void; test(): Promise<ChainReport | null>; setProtections(p: Protections): Promise<void> } {
  let model = emptyChain();
  let prot: Protections = protectionsOf('rookie');
  let before: { grade: string; failed: number; label: string } | null = null;
  const protKey = (): string => PROTECTIONS.map((k) => (prot[k] ? '1' : '0')).join('');
  const protLabel = (): string => { const t = tierOfProtections(prot); return t === 'custom' ? `custom (${PROTECTIONS.filter((k) => prot[k]).map((k) => PART_LABEL[k]).join(', ') || 'none'})` : t; };
  const cards = new Map<string, BlockCard>();
  let report: ChainReport | null = null;
  const lib = el('section', 'ch-card'); lib.setAttribute('aria-label', 'Block library');
  const chain = el('section', 'ch-card'); chain.setAttribute('aria-label', 'Your chain');
  const side = el('section', 'ch-card'); side.setAttribute('aria-label', 'Warnings and test');
  const grid = el('div', 'ch-grid'); grid.append(lib, chain, side);
  root.append(el('p', 'ch-honest', HONEST), grid);

  async function cardFor(blockId: string): Promise<BlockCard | undefined> {
    const k = `${blockId}@${protKey()}`;
    if (!cards.has(k)) { const c = await runBlock(blockId, prot); if (c) cards.set(k, c); }
    return cards.get(k);
  }
  /** Re-run the chain test when a protection changes and a result is already showing, and keep the grade before the change. */
  async function changed(): Promise<void> {
    if (report) before = { grade: report.grade, failed: report.failed, label: String(report.tier) };
    const had = report !== null;
    report = null;
    if (had) await test(); else await render();
  }
  const protectionPanel = (): HTMLElement => {
    const box = el('div', 'ch-prot'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Protections your bot has');
    box.append(el('h3', undefined, 'Protections your bot has'));
    const preset = el('select'); preset.setAttribute('aria-label', 'Preset');
    const cur = tierOfProtections(prot);
    for (const t of [...CARD_TIERS, 'custom' as const]) { const o = el('option', undefined, t === 'custom' ? 'custom' : t); o.value = t; o.selected = t === cur; o.disabled = t === 'custom'; preset.append(o); }
    preset.onchange = () => { if (preset.value !== 'custom') { prot = protectionsOf(preset.value as CardTier); void changed(); } };
    box.append(preset);
    for (const k of PROTECTIONS) {
      const row = el('label', 'ch-toggle');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!prot[k]; cb.setAttribute('aria-label', PART_LABEL[k]);
      cb.onchange = () => { prot = { ...prot, [k]: cb.checked }; void changed(); };
      row.append(cb, document.createTextNode(` ${PART_LABEL[k]}`));
      box.append(row);
    }
    return box;
  };

  async function renderLib(): Promise<void> {
    lib.replaceChildren(el('h2', undefined, '1. Pick blocks'));
    lib.append(el('p', 'ch-note', `Cards: each block alone with: ${protLabel()}.`));
    for (const [role, list] of Object.entries(libraryByRole())) {
      lib.append(el('h3', undefined, role));
      const ul = el('ul', 'ch-lib');
      for (const b of list) {
        const li = el('li');
        const c = await cardFor(b.id);
        const btn = el('button', 'ch-btn', `+ ${b.label}`); btn.type = 'button'; btn.title = b.about; btn.setAttribute('aria-label', `Add ${b.label}`);
        btn.onclick = () => { model = addBlock(model, b.id); report = null; void render(); };
        const badge = el('span', 'ch-badge', c ? `${c.survived}/${c.tried} ${c.grade}` : '');
        badge.title = c ? `Alone with ${protLabel()}: survived ${c.survived} of ${c.tried} attacks, grade ${c.grade}` : '';
        li.append(btn, badge);
        ul.append(li);
      }
      lib.append(ul);
    }
    const custom = el('div', 'ch-custom');
    const id = el('input'); id.placeholder = 'custom_stage'; id.setAttribute('aria-label', 'Custom stage id');
    const role = el('select'); role.setAttribute('aria-label', 'Custom stage role');
    for (const r of ['input', 'work', 'effect', 'poll', 'final']) { const o = el('option', undefined, r); o.value = r; role.append(o); }
    const add = el('button', 'ch-btn', 'Add my own block'); add.type = 'button';
    add.onclick = () => { model = addCustom(model, id.value, role.value as never); id.value = ''; report = null; void render(); };
    custom.append(el('h3', undefined, 'Your own block'), id, role, add);
    lib.append(custom);
  }

  function renderChain(): void {
    chain.replaceChildren(el('h2', undefined, '2. Order your chain'));
    const name = el('input'); name.value = model.name; name.setAttribute('aria-label', 'Chain name');
    name.oninput = () => { model = { ...model, name: name.value }; };
    chain.append(name);
    if (model.stages.length === 0) chain.append(el('p', 'ch-empty', 'Empty. Pick blocks on the left.'));
    const ol = el('ol', 'ch-stages');
    model.stages.forEach((s, i) => {
      const li = el('li');
      const id = el('input'); id.value = s.id; id.setAttribute('aria-label', `Stage ${i + 1} id`);
      id.onchange = () => { model = rename(model, i, id.value); void render(); };
      const tag = el('span', `ch-role ch-role--${s.role}`, s.role);
      const blame = report?.blame.find((b) => b.stage === s.id);
      const share = el('span', 'ch-share', blame && report!.failed > 0 ? `${Math.round(blame.share * 100)}% of failures` : '');
      const up = el('button', 'ch-btn', 'Up'); up.type = 'button'; up.disabled = i === 0; up.onclick = () => { model = move(model, i, i - 1); report = null; void render(); };
      const dn = el('button', 'ch-btn', 'Down'); dn.type = 'button'; dn.disabled = i === model.stages.length - 1; dn.onclick = () => { model = move(model, i, i + 1); report = null; void render(); };
      const rm = el('button', 'ch-btn', 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', `Remove stage ${i + 1}`); rm.onclick = () => { model = removeAt(model, i); report = null; void render(); };
      li.append(id, tag, share, up, dn, rm);
      ol.append(li);
    });
    chain.append(ol);
    const yaml = el('textarea', 'ch-yaml'); yaml.value = toYaml(model); yaml.setAttribute('aria-label', 'haunt.yaml of this chain');
    yaml.onchange = () => { const r = parseHauntConfig(yaml.value); if (r.ok) { model = fromConfig(r.config); report = null; void render(); } else yaml.title = r.errors.join('\n'); };
    chain.append(el('h3', undefined, 'haunt.yaml (edit it, the chain follows)'), yaml);
  }

  function renderSide(): void {
    side.replaceChildren(el('h2', undefined, '3. Test the chain'));
    const problems = chainProblems(model);
    const btn = el('button', 'ch-btn ch-btn--go', 'Test chain'); btn.type = 'button'; btn.disabled = problems.length > 0;
    btn.onclick = () => { void test(); };
    side.append(btn);
    side.append(protectionPanel());
    for (const p of problems) side.append(el('p', 'ch-problem', p));
    const cfg = toConfig(model);
    if (cfg.ok) {
      const warn = chainChecks(cfg.config, [...cards.entries()].filter(([k]) => k.endsWith(`@${protKey()}`)).map(([, c]) => c));
      side.append(el('h3', undefined, `Warnings (${warn.length})`));
      if (warn.length === 0) side.append(el('p', 'ch-ok', 'No warnings.'));
      const ul = el('ul', 'ch-warn');
      for (const w of warn) ul.append(el('li', undefined, w.message));
      side.append(ul);
    }
    if (report) {
      side.append(el('h3', undefined, `Result with ${protLabel()}: grade ${report.grade}`));
      if (before) side.append(el('p', 'ch-delta', `Before: grade ${before.grade}, ${before.failed} failures (${before.label}). Now: grade ${report.grade}, ${report.failed} failures.`));
      side.append(el('p', undefined, `${report.failed} of ${report.tried} attacks did not end clean. Reliability ${Math.round(report.reliability * 100)}%.`));
      const t = el('table', 'ch-blame');
      t.append(Object.assign(el('tr'), { innerHTML: '<th>Stage</th><th>Block</th><th>Failed</th><th>Share</th>' }));
      for (const b of [...report.blame].sort((a, c) => c.failed - a.failed)) {
        const tr = el('tr');
        tr.append(el('td', undefined, b.stage), el('td', undefined, b.block ?? 'custom'), el('td', undefined, `${b.failed}/${b.tried}`), el('td', undefined, `${Math.round(b.share * 100)}%`));
        t.append(tr);
      }
      side.append(t);
    }
  }

  async function render(): Promise<void> { await renderLib(); renderChain(); renderSide(); }

  async function test(): Promise<ChainReport | null> {
    const cfg = toConfig(model);
    if (!cfg.ok) return null;
    report = await chainReport(cfg.config, prot);
    await render();
    return report;
  }

  void render();
  return { getModel: () => model, setModel: (m) => { model = m; report = null; before = null; void render(); }, test, setProtections: (p) => { prot = { ...p }; return changed(); } };
}
