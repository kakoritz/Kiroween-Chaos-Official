// Campaign results (CP-U3): medal, credits, "what happened", credits roll, and save export/import.
// `mountCampaignResults` returns a handle: call `begin(night)` when a campaign night starts and `onEvent(ev)` for every arena event.
import { medalSvg } from './art';
import { loadProgress } from './hub-model';
import {
  applyResult, exportProgress, explain, loadEarned, nextGoal, parseImport, saveImport, saveOutcome,
  nightCases, type LaneSummary, type NightCase, type Outcome, type ResultGear, type ResultNight, type ScoreHit,
} from './results-model';

export interface ResultsApi { getCampaign(): Promise<{ nights?: ResultNight[]; gear?: ResultGear[] }>; /** GET /api/casebook: the Crew lane's cases of the night that just ended. */ getCasebook?(): Promise<unknown> }
export interface ResultsHandlers { onNight?: (night: ResultNight) => void; onHub?: () => void }
export interface ResultsHandle { begin(nightId: number): void; onEvent(ev: { type?: string; lane?: number; detail?: unknown }): void; close(): void }

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const CREDITS_ROLL = ['Haunted Nights', 'A game about the patterns that keep real software alive.', 'Retries, journals, idempotency keys, breakers and queues.', 'Thank you for playing.'];

export function renderResults(night: ResultNight, o: Outcome, summary: LaneSummary, hits: ScoreHit[], gear: ResultGear[], nights: ResultNight[], cases: readonly NightCase[] = []): string {
  const causes = explain(summary, hits, gear, night);
  const next = nights.find((n) => n.id === night.id + 1);
  const goal = nextGoal(night, o.medal);
  const name = night.finale ? 'Finale' : `Night ${night.id}`;
  const title = o.medal === 'none' ? 'The night got away from you' : `${o.medal[0].toUpperCase()}${o.medal.slice(1)} medal`;
  return `<div class="cpres__card" role="dialog" aria-label="${esc(name)} results">
    <h2 class="cpres__title">${esc(name)}: ${esc(night.title)}</h2>
    <div class="cpres__medal cpres__medal--${o.medal}">${o.medal === 'none' ? '' : medalSvg(o.medal, 120)}<span class="cpres__tier">${esc(title)}</span></div>
    <p class="cpres__line">Score <b>${Math.floor(summary.score ?? 0)}</b>. Credits earned <b>+${o.credits}</b>. You now have <b>${o.progress.credits}</b>.</p>
    ${o.unlockedNext && next ? `<p class="cpres__unlock">A new door opens: ${esc(next.title)}.</p>` : ''}
    ${goal ? `<p class="cpres__goal">${esc(goal)}</p>` : ''}
    <h3>What happened</h3>
    ${causes.length ? `<ol class="cpres__causes">${causes.map((c) => `<li>${esc(c.text)}${c.lost ? ` <span class="cpres__lost">-${c.lost}</span>` : ''}${c.gear ? ` Try the <b>${esc(c.gear)}</b>.` : ''}</li>`).join('')}</ol>` : '<p>Nothing went wrong. Clean night.</p>'}
    ${cases.length ? `<h3>Casebook for this night</h3><ul class="cpres__cases">${cases.map((c) => `<li><b>${esc(c.title)}</b> ${esc(c.verdict)}${c.fix ? ` Fix: ${esc(c.fix)}.` : ''}</li>`).join('')}</ul>` : ''}
    <div class="cpres__btns">
      ${next && o.bestMedal !== 'none' ? '<button class="btn" type="button" data-act="next">Next night</button>' : ''}
      <button class="btn" type="button" data-act="retry">Retry</button>
      <button class="btn btn--ghost" type="button" data-act="hub">Back to the crypt</button>
      ${night.finale && o.bestMedal !== 'none' ? '<button class="btn btn--ghost" type="button" data-act="credits">Credits</button>' : ''}
    </div></div>`;
}

export function mountCampaignResults(stage: HTMLElement, api: ResultsApi, handlers: ResultsHandlers = {}, store: Storage | undefined = window.localStorage): ResultsHandle {
  let nightId = 0;
  let hits: ScoreHit[] = [];
  let el: HTMLElement | null = null;
  const close = (): void => { el?.remove(); el = null; };

  const show = async (summary: LaneSummary): Promise<void> => {
    const c = await api.getCampaign();
    const nights = c.nights ?? [];
    const night = nights.find((n) => n.id === nightId);
    if (!night) return;
    const cases = await api.getCasebook?.().then((raw) => nightCases(raw, 5, night.id), () => [] as NightCase[]) ?? [];
    const o = applyResult(night, summary, loadProgress(store), loadEarned(store));
    saveOutcome(store, o);
    close();
    el = document.createElement('div');
    el.className = 'cpres';
    el.innerHTML = renderResults(night, o, summary, hits, c.gear ?? [], nights, cases);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    const act = (a: string, f: () => void) => el!.querySelector(`[data-act=${a}]`)?.addEventListener('click', f);
    act('next', () => { const n = nights.find((x) => x.id === night.id + 1); close(); if (n) handlers.onNight?.(n); });
    act('retry', () => { close(); handlers.onNight?.(night); });
    act('hub', () => { close(); handlers.onHub?.(); });
    act('credits', () => rollCredits(el!));
    stage.appendChild(el);
    (el.querySelector('.cpres__btns .btn') as HTMLElement | null)?.focus();
  };

  return {
    begin(id) { nightId = id; hits = []; close(); },
    close,
    onEvent(ev) {
      if (!nightId) return;
      const d = (ev.detail ?? {}) as Record<string, unknown>;
      if (ev.type === 'score' && ev.lane === 1 && typeof d.delta === 'number') hits.push({ delta: d.delta, reason: String(d.reason ?? '') });
      else if (ev.type === 'wave_end') {
        const s = (d.summary as Record<string, LaneSummary> | undefined)?.['1'];
        if (!s || d.stopped) { nightId = 0; return; }
        const id = nightId;
        void show(s).catch(() => undefined).finally(() => { if (nightId === id) nightId = 0; });
      }
    },
  };
}

function rollCredits(host: HTMLElement): void {
  const r = document.createElement('div');
  r.className = 'cpres__roll';
  r.setAttribute('role', 'dialog');
  r.setAttribute('aria-label', 'Credits');
  r.innerHTML = `${CREDITS_ROLL.map((l) => `<p>${esc(l)}</p>`).join('')}<button class="btn btn--ghost" type="button">Close</button>`;
  r.querySelector('button')!.addEventListener('click', () => r.remove());
  r.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); r.remove(); } });
  host.appendChild(r);
  (r.querySelector('button') as HTMLElement).focus();
}

/** Save data dialog: copy the progress JSON out, or paste JSON in. Opened from the hub. */
export function openSaveDialog(host: HTMLElement, store: Storage | undefined = window.localStorage, onImported?: () => void): HTMLElement {
  const d = document.createElement('div');
  d.className = 'cpsave';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-label', 'Save data');
  d.innerHTML = `<div class="cpsave__card"><h2>Save data</h2>
    <p>Your progress lives in this browser only. Copy it to move to another machine, or paste a saved copy to load it.</p>
    <textarea class="cpsave__text" rows="10" spellcheck="false" aria-label="Progress JSON"></textarea>
    <p class="cpsave__msg" role="status"></p>
    <div class="cpsave__btns"><button class="btn" type="button" data-act="export">Export</button><button class="btn" type="button" data-act="import">Import</button><button class="btn btn--ghost" type="button" data-act="close">Close (Esc)</button></div></div>`;
  const ta = d.querySelector('textarea')!;
  const msg = d.querySelector('.cpsave__msg') as HTMLElement;
  d.querySelector('[data-act=export]')!.addEventListener('click', () => {
    ta.value = exportProgress(store);
    ta.select();
    msg.textContent = 'Copy this text and keep it somewhere safe.';
  });
  d.querySelector('[data-act=import]')!.addEventListener('click', () => {
    const r = parseImport(ta.value);
    if (!r.ok) { msg.textContent = r.reason; return; }
    saveImport(store, r);
    msg.textContent = 'Loaded. Your credits, gear and medals are restored.';
    onImported?.();
  });
  d.querySelector('[data-act=close]')!.addEventListener('click', () => d.remove());
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); d.remove(); } });
  host.appendChild(d);
  ta.focus();
  return d;
}
