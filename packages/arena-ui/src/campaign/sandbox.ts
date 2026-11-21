// Campaign sandbox (CP-U4): any night, any gear, no credits. Toggle parts, run, and compare with the last sandbox run.
// Practice only: this module never calls applyResult or saveOutcome, so credits, medals, best scores and unlocks stay untouched.
// Mounted on the `haunt:sandbox` window event (fired by the hub's Sandbox button). `onEvent(ev)` must see every arena event.
import { describeCompare, compareRuns, formatTime, loadLastRun, saveLastRun, summarizeRun, type SandboxRun } from './sandbox-model';
import type { LaneSummary, ResultNight } from './results-model';

export interface SandboxGear { id: string; label: string; part: string; effect?: string }
export interface SandboxApi {
  getCampaign(): Promise<{ nights?: ResultNight[]; gear?: SandboxGear[] }>;
  startWave(opts: { campaign: { night: number; parts: string[] } }): Promise<unknown>;
}
export interface SandboxHandle { open(): void; close(): void; onEvent(ev: { type?: string; detail?: unknown }): void }

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const ARROW = { better: '\u25B2 better', worse: '\u25BC worse', same: '= same' } as const;

export function renderSandbox(nights: ResultNight[], gear: SandboxGear[], night: number, parts: readonly string[], last: SandboxRun | undefined, current: SandboxRun | undefined, msg: string): string {
  const cmp = current && last ? compareRuns(last, current) : undefined;
  const shown = current ?? last;
  return `<div class="cpsbx__card" role="dialog" aria-label="Sandbox">
    <h2 class="cpsbx__title">Sandbox</h2>
    <p class="cpsbx__note">Practice any night with any gear. No credits are earned and nothing unlocks.</p>
    <label class="cpsbx__row">Night <select class="cpsbx__night" aria-label="Night">${nights.map((n) => `<option value="${n.id}"${n.id === night ? ' selected' : ''}>${n.finale ? 'Finale' : `Night ${n.id}`}: ${esc(n.title)}</option>`).join('')}</select></label>
    <fieldset class="cpsbx__gear"><legend>Gear on lane 1</legend>${gear.map((g) => `<label class="cpsbx__part"><input type="checkbox" data-part="${esc(g.part)}"${parts.includes(g.part) ? ' checked' : ''}> ${esc(g.label)}${g.effect ? ` <span class="cpsbx__fx">${esc(g.effect)}</span>` : ''}</label>`).join('')}</fieldset>
    <div class="cpsbx__cmp" role="status" aria-live="polite">
      <h3>${cmp ? 'Compared to your last run' : current ? 'This run' : 'Last run'}</h3>
      ${cmp ? `<ul class="cpsbx__lines">${describeCompare(cmp).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <p class="cpsbx__trend">Score ${ARROW[cmp.score.trend]}. Time ${ARROW[cmp.time.trend]}. Medal ${ARROW[cmp.medal.trend]}.</p>`
        : shown ? `<p>Night ${shown.night}: score <b>${shown.score}</b>, time <b>${formatTime(shown.timeMs)}</b>, medal <b>${shown.medal}</b>${shown.parts.length ? `, gear ${esc(shown.parts.join(', '))}` : ', no gear'}.</p>${current ? '<p>This is your first sandbox run, so there is nothing to compare yet.</p>' : ''}`
        : '<p>No sandbox run yet. Pick gear and press Run.</p>'}
    </div>
    <p class="cpsbx__msg" role="status">${esc(msg)}</p>
    <div class="cpsbx__btns"><button class="btn" type="button" data-act="run">Run sandbox night</button><button class="btn" type="button" data-act="reset">Reset gear</button><button class="btn btn--ghost" type="button" data-act="close">Close (Esc)</button></div></div>`;
}

export function mountCampaignSandbox(stage: HTMLElement, api: SandboxApi, store: Storage | undefined = window.localStorage): SandboxHandle {
  let el: HTMLElement | null = null;
  let nights: ResultNight[] = [];
  let gear: SandboxGear[] = [];
  let night = 1;
  let parts: string[] = [];
  let current: SandboxRun | undefined;
  let base: SandboxRun | undefined;
  let msg = '';
  let running: { night: ResultNight; parts: string[]; t0: number } | null = null;

  const close = (): void => { el?.remove(); el = null; };
  const paint = (): void => {
    if (!el) return;
    el.innerHTML = renderSandbox(nights, gear, night, parts, current ? base : loadLastRun(store), current, msg);
    const q = <T extends HTMLElement>(s: string) => el!.querySelector<T>(s);
    q<HTMLSelectElement>('.cpsbx__night')?.addEventListener('change', (e) => { night = Number((e.target as HTMLSelectElement).value); });
    el.querySelectorAll<HTMLInputElement>('[data-part]').forEach((c) => c.addEventListener('change', () => {
      parts = gear.map((g) => g.part).filter((p) => (p === c.dataset.part ? c.checked : parts.includes(p)));
    }));
    q('[data-act=reset]')?.addEventListener('click', () => { parts = []; msg = 'Gear reset. Everything is off.'; paint(); q<HTMLElement>('[data-act=reset]')?.focus(); });
    q('[data-act=close]')?.addEventListener('click', close);
    q('[data-act=run]')?.addEventListener('click', () => void run());
    q<HTMLSelectElement>('.cpsbx__night')?.addEventListener('change', () => { current = undefined; });
    (q('[data-act=run]') as HTMLElement | null)?.focus();
  };

  const run = async (): Promise<void> => {
    const n = nights.find((x) => x.id === night);
    if (!n || running) return;
    const chosen = [...parts];
    try {
      running = { night: n, parts: chosen, t0: performance.now() };
      await api.startWave({ campaign: { night: n.id, parts: chosen } });
      close();
      (document.querySelector('.cphub [data-act=close]') as HTMLElement | null)?.click();
    } catch { running = null; msg = 'Could not start the night. Is the arena running?'; paint(); }
  };

  const open = (): void => {
    if (el) return;
    el = document.createElement('div');
    el.className = 'cpsbx';
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    stage.appendChild(el);
    el.innerHTML = '<p class="cpsbx__note">Opening the sandbox...</p>';
    void api.getCampaign().then((c) => { nights = c.nights ?? []; gear = c.gear ?? []; if (!nights.some((x) => x.id === night)) night = nights[0]?.id ?? 1; current = undefined; msg = ''; paint(); })
      .catch(() => { if (el) el.innerHTML = '<p class="cpsbx__note">Could not load the campaign.</p>'; });
  };

  window.addEventListener('haunt:sandbox', open);

  return {
    open, close,
    onEvent(ev) {
      if (!running || ev.type !== 'wave_end') return;
      const r = running;
      const d = (ev.detail ?? {}) as Record<string, unknown>;
      running = null;
      const s = (d.summary as Record<string, LaneSummary> | undefined)?.['1'];
      if (!s || d.stopped) return;
      const run = summarizeRun(r.night, s, r.parts, performance.now() - r.t0);
      base = loadLastRun(store);
      saveLastRun(store, run);
      night = r.night.id; parts = r.parts;
      current = run;
      msg = 'Sandbox run: no credits earned, nothing unlocked.';
      close();
      el = document.createElement('div');
      el.className = 'cpsbx';
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
      stage.appendChild(el);
      paint();
    },
  };
}
