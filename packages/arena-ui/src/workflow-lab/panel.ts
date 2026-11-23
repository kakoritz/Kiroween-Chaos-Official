// SH-U1: Workflow Lab DOM. Everything runs in this page: the engine is injected, downloads are Blob links,
// copy goes to the clipboard. Nothing is sent anywhere.
import { copyText } from '../share/share-panel';
import {
  HONEST_LABEL, LAB_PARTS, PART_LABEL, PRESETS, ROLES, blankStage, cloneModel, labFiles, matrixView, modelFromYaml, packLines, presetModel, reviewView, scenarioLines, setAllParts, setRole, suggestionViews, worstFindings,
  type LabFile, type LabModel, type LabReport,
} from './model';

export type RunLab = (m: LabModel) => Promise<LabReport>;

const COMMANDS = ['npx haunt init', 'haunt validate', 'haunt sweep'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function saveFile(f: LabFile): void {
  const url = URL.createObjectURL(new Blob([f.text], { type: `${f.mime};charset=utf-8` }));
  const a = el('a'); a.href = url; a.download = f.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountWorkflowLab(root: HTMLElement, run: RunLab, reduced = false): { getModel(): LabModel; setModel(m: LabModel): void; run(): Promise<void> } {
  let model: LabModel = presetModel('orders');
  const form = el('section', 'wl-card'); form.setAttribute('aria-label', 'Describe your workflow');
  const out = el('section', 'wl-out'); out.setAttribute('aria-live', 'polite');
  root.append(el('p', 'wl-honest', HONEST_LABEL), form, out);

  function renderForm(): void {
    form.replaceChildren();
    form.append(el('h2', undefined, '1. Describe your workflow'));

    const top = el('div', 'wl-row');
    const preset = el('select'); preset.setAttribute('aria-label', 'Preset');
    const ph = el('option', undefined, 'Presets...'); ph.value = ''; preset.append(ph);
    for (const p of PRESETS) { const o = el('option', undefined, p.label); o.value = p.id; preset.append(o); }
    preset.onchange = () => { if (preset.value) { model = presetModel(preset.value); renderForm(); } };
    const name = el('input'); name.value = model.name; name.setAttribute('aria-label', 'Workflow name');
    name.oninput = () => { model.name = name.value; };
    top.append(el('label', undefined, 'Preset'), preset, el('label', undefined, 'Name'), name);
    form.append(top);

    const table = el('div', 'wl-stages');
    model.stages.forEach((s, i) => {
      const row = el('div', 'wl-stage');
      const id = el('input'); id.value = s.id; id.setAttribute('aria-label', `Stage ${i + 1} id`);
      id.oninput = () => { s.id = id.value; };
      const role = el('select'); role.setAttribute('aria-label', `Stage ${i + 1} role`);
      for (const r of ROLES) { const o = el('option', undefined, r); o.value = r; o.selected = r === s.role; role.append(o); }
      role.onchange = () => { model.stages[i] = setRole(s, role.value as typeof s.role); renderForm(); };
      const rm = el('button', 'wl-btn', 'Remove'); rm.type = 'button';
      rm.setAttribute('aria-label', `Remove stage ${i + 1}`);
      rm.onclick = () => { model.stages.splice(i, 1); renderForm(); };
      row.append(id, role, rm);
      if (s.role === 'effect') {
        const effs = el('div', 'wl-effects');
        (s.effects ?? []).forEach((e, j) => {
          const kind = el('input'); kind.value = e.kind; kind.setAttribute('aria-label', `Stage ${i + 1} effect ${j + 1} kind`);
          kind.oninput = () => { e.kind = kind.value; };
          const key = el('input'); key.type = 'checkbox'; key.checked = e.keyed;
          key.onchange = () => { e.keyed = key.checked; };
          const lab = el('label', 'wl-check'); lab.append(key, document.createTextNode(' uses a key'));
          effs.append(kind, lab);
        });
        row.append(effs);
      }
      table.append(row);
    });
    form.append(table);
    const add = el('button', 'wl-btn', 'Add stage'); add.type = 'button';
    add.onclick = () => { model.stages.push(blankStage(model)); renderForm(); };
    form.append(add);

    const yamlBox = el('details', 'wl-yaml');
    yamlBox.append(el('summary', undefined, 'Or paste a haunt.yaml'));
    const ta = el('textarea'); ta.rows = 8; ta.setAttribute('aria-label', 'haunt.yaml text'); ta.spellcheck = false;
    const yerr = el('p', 'wl-err'); yerr.setAttribute('role', 'alert');
    const load = el('button', 'wl-btn', 'Load yaml'); load.type = 'button';
    load.onclick = () => {
      const r = modelFromYaml(ta.value);
      if (r.ok) { model = r.model; renderForm(); } else yerr.textContent = r.errors.join('; ');
    };
    yamlBox.append(ta, load, yerr);
    form.append(yamlBox);

    form.append(el('h2', undefined, '2. Protections you have today'));
    const parts = el('div', 'wl-parts');
    for (const p of LAB_PARTS) {
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = model.parts?.[p] === true; cb.dataset.part = p;
      cb.onchange = () => { model.parts = { ...(model.parts ?? {}), [p]: cb.checked }; };
      const lab = el('label', 'wl-check'); lab.append(cb, document.createTextNode(` ${PART_LABEL[p]}`));
      parts.append(lab);
    }
    const none = el('button', 'wl-btn', 'None (my bot today)'); none.type = 'button';
    none.onclick = () => { model = setAllParts(model, false); renderForm(); };
    parts.append(none);
    form.append(parts);

    form.append(el('h2', undefined, '3. Run'));
    const go = el('button', 'wl-btn wl-go', 'Run the haunt'); go.type = 'button';
    go.onclick = () => { void doRun(); };
    form.append(go);
  }

  async function doRun(): Promise<void> {
    out.replaceChildren(el('p', 'wl-status', 'Summoning creatures...'));
    try {
      const report = await run(cloneModel(model));
      await renderReport(report);
    } catch (e) {
      const p = el('p', 'wl-err', e instanceof Error ? e.message : String(e)); p.setAttribute('role', 'alert');
      out.replaceChildren(p);
    }
  }

  async function renderReport(r: LabReport): Promise<void> {
    out.replaceChildren();
    out.append(el('h2', undefined, 'Report'), el('p', 'wl-honest', r.label));
    for (const line of packLines(r)) out.append(el('p', 'wl-pack', line));
    const rv = reviewView(r);
    if (rv) {
      const box = el('div', 'wl-review'); box.setAttribute('aria-label', rv.label);
      box.append(el('h3', undefined, `${rv.label}: ${rv.overall}`));
      const ul = el('ul');
      for (const s of rv.scores) {
        const li = el('li', 'wl-score'); li.dataset.score = s.id;
        const g = el('span', 'wl-stars', s.glyphs); g.setAttribute('aria-label', `${s.stars} of 5 stars`);
        li.append(el('span', 'wl-score-name', s.label), g);
        ul.append(li);
      }
      box.append(ul);
      out.append(box);
    }
    const scen = scenarioLines(r);
    if (scen.length) { const sl = el('ul', 'wl-scen'); for (const l of scen) sl.append(el('li', undefined, l)); out.append(el('h3', undefined, 'Boss nights and curses'), sl); }
    const head = el('div', 'wl-head');
    const grade = el('div', `wl-grade wl-grade-${r.grade}`, r.grade); grade.setAttribute('aria-label', `Grade ${r.grade}`);
    head.append(grade, el('div', undefined, `Reliability ${Math.round(r.reliability)}%. With the suggested parts: grade ${r.gradeWithSuggestions}.`));
    out.append(head);

    const mv = matrixView(r);
    const table = el('table', 'wl-matrix'); table.setAttribute('aria-label', 'Coverage matrix');
    const hr = el('tr'); hr.append(el('th', undefined, 'Stage'));
    for (const f of mv.faults) hr.append(el('th', undefined, f));
    table.append(hr);
    const cellEls: HTMLElement[][] = mv.faults.map(() => []);
    for (const s of mv.stages) {
      const tr = el('tr'); tr.append(el('th', undefined, s));
      mv.faults.forEach((f, ci) => {
        const outcome = mv.cell(s, f);
        const td = el('td', reduced ? `wl-cell wl-${outcome}` : 'wl-cell wl-pending', outcome === 'na' ? '' : outcome.replace('_', ' '));
        td.dataset.outcome = outcome;
        cellEls[ci]!.push(td); tr.append(td);
      });
      table.append(tr);
    }
    out.append(table);
    if (!reduced) {
      for (let ci = 0; ci < cellEls.length; ci++) {
        await new Promise((res) => setTimeout(res, 70));
        for (const td of cellEls[ci]!) td.className = `wl-cell wl-${td.dataset.outcome}`;
      }
    }

    out.append(el('h3', undefined, 'Worst findings'));
    const fl = el('ul');
    const worst = worstFindings(r);
    if (!worst.length) fl.append(el('li', undefined, 'No findings. Every modelled fault was handled.'));
    for (const f of worst) fl.append(el('li', undefined, `${f.severity} ${f.rule} at ${f.stage}/${f.fault}: ${f.summary}`));
    out.append(fl);

    out.append(el('h3', undefined, 'Add this part'));
    const sl = el('ul', 'wl-suggest');
    if (!r.suggestions.length) sl.append(el('li', undefined, 'Nothing to add.'));
    for (const s of suggestionViews(r)) {
      const li = el('li'); li.dataset.part = s.part;
      li.append(el('strong', undefined, s.title), document.createTextNode(` (${s.rules.map((x) => `${x.id}: ${x.text}`).join('; ')}): ${s.why} ${s.how}`));
      if (s.domain) li.append(el('div', 'wl-domain', `In ${r.pack?.title ?? 'this app'}: ${s.domain}`));
      sl.append(li);
    }
    out.append(sl);

    out.append(el('h2', undefined, '4. Export'));
    const files = labFiles(r);
    const row = el('div', 'wl-row');
    for (const f of files) {
      const b = el('button', 'wl-btn', `Download ${f.label}`); b.type = 'button'; b.dataset.file = f.name;
      b.onclick = () => saveFile(f);
      row.append(b);
    }
    out.append(row);
    const badge = files.find((f) => f.name === 'haunt-badge.svg');
    if (badge) { const prev = el('div', 'wl-badge'); prev.innerHTML = badge.text; prev.setAttribute('role', 'img'); prev.setAttribute('aria-label', 'Badge preview'); out.append(prev); }

    out.append(el('h3', undefined, 'Run the real thing on real code'));
    const cmds = el('div', 'wl-cmds');
    for (const c of r.commands.length ? r.commands : COMMANDS) {
      const line = el('div', 'wl-cmd');
      const cb = el('button', 'wl-btn', 'Copy'); cb.type = 'button';
      const st = el('span', 'wl-ok'); st.setAttribute('role', 'status');
      cb.onclick = async () => { st.textContent = (await copyText(c)) ? 'Copied' : 'Copy failed, select the text'; };
      line.append(el('code', undefined, c), cb, st);
      cmds.append(line);
    }
    out.append(cmds);
  }

  renderForm();
  return { getModel: () => model, setModel: (m) => { model = cloneModel(m); renderForm(); }, run: doRun };
}
