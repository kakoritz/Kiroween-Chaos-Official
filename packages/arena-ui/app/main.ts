import { apiBaseFromQuery, demoFromQuery, modeBadge } from '../src/mode';
import { ApiError, createApi, resolveHttpBase, type ArenaApi, type ArenaEvent, type ConnectionStatus, type HauntInPage } from '../src/api';

// W1/W2 shell: the client connects the same way for mock, live and browser, and the
// header shows the mode badge and the demo control. Scene and panels come in later tasks.

const root = document.getElementById('app')!;
root.innerHTML = `
  <header class="hdr">
    <span class="logo">HAUNT</span>
    <span class="wave" id="wave">Wave -</span>
    <span class="spacer"></span>
    <span class="pill hidden" id="demo-pill">DEMO</span>
    <span class="badge badge--offline" id="badge" role="status"></span>
    <button class="btn btn--ghost hidden" id="demo-stop" type="button">Stop demo</button>
    <button class="btn" id="demo-open" type="button">Open in demo mode</button>
  </header>
  <main class="stage">
    <div>
      <h1>The crypt is quiet</h1>
      <p>Five skeletons are asleep. Start the show.</p>
      <button class="btn btn--big" id="demo-big" type="button">Open in demo mode</button>
      <div class="err" id="err" role="alert"></div>
      <div class="stats" id="stats"></div>
    </div>
  </main>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const badgeEl = $('badge');
const errEl = $('err');
const statsEl = $('stats');
const waveEl = $('wave');
const demoPill = $('demo-pill');
const demoStop = $('demo-stop');
const demoBtns = [$<HTMLButtonElement>('demo-open'), $<HTMLButtonElement>('demo-big')];

let mode: string | null = null;
let status: ConnectionStatus = 'connecting';
let events = 0;
let lastSeq = 0;
let waveNo = 0;
let api: ArenaApi;
let demoRunning = false;
let waveRunning = false;

function paintBadge() {
  const b = modeBadge(mode, status);
  badgeEl.className = `badge badge--${b.tone}`;
  badgeEl.textContent = `${b.icon} ${b.label}`;
  badgeEl.title = b.title;
}

function paintDemo() {
  demoPill.classList.toggle('hidden', !demoRunning);
  demoStop.classList.toggle('hidden', !demoRunning);
  for (const b of demoBtns) b.classList.toggle('hidden', demoRunning);
}

function showError(e: unknown) {
  errEl.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
}

function onEvent(ev: ArenaEvent) {
  events++;
  if (typeof ev.seq === 'number') lastSeq = ev.seq;
  if (ev.type === 'hello') {
    mode = typeof ev.mode === 'string' ? ev.mode : mode;
    if (ev.contractVersion !== 1) errEl.textContent = 'Update the UI: the server speaks contract version ' + String(ev.contractVersion) + '.';
  } else if (ev.type === 'reset') {
    waveNo = 0; waveRunning = false; demoRunning = false;
  } else if (ev.type === 'wave_start') {
    waveNo = typeof ev.wave === 'number' ? ev.wave : waveNo + 1;
    waveRunning = true;
    errEl.textContent = '';
  } else if (ev.type === 'wave_end') {
    waveRunning = false;
  }
  waveEl.textContent = waveNo ? `Wave ${waveNo}` : 'Wave -';
  statsEl.textContent = `${events} events received, last seq ${lastSeq}`;
  paintBadge();
  paintDemo();
}

async function loadState() {
  try {
    const s = await api.getState();
    mode = String(s.mode);
    waveNo = s.wave?.n ?? 0;
    waveRunning = !!s.wave?.running;
    demoRunning = !!s.demo?.running;
    waveEl.textContent = waveNo ? `Wave ${waveNo}` : 'Wave -';
  } catch (e) { showError(e); }
  paintBadge();
  paintDemo();
}

async function startDemo(script: string) {
  errEl.textContent = '';
  try {
    if (waveRunning) await api.stopWave();
    await api.startDemo(script);
    demoRunning = true;
    paintDemo();
  } catch (e) { showError(e); }
}

async function boot() {
  paintBadge();
  paintDemo();
  const search = window.location.search;
  const inpage = (window as unknown as { __haunt?: HauntInPage }).__haunt ?? null;
  const base = inpage ? '' : await resolveHttpBase(apiBaseFromQuery(search));
  api = createApi({ inpage, baseUrl: base });

  for (const b of demoBtns) b.addEventListener('click', () => void startDemo('hero'));
  demoStop.addEventListener('click', async () => {
    try { await api.stopDemo(); demoRunning = false; paintDemo(); } catch (e) { showError(e); }
  });

  await loadState();
  api.subscribe({
    onEvent,
    onStatus: (s) => { status = s; paintBadge(); },
    onGone: () => void loadState(),
  });

  const demo = demoFromQuery(search);
  if (demo) void startDemo(demo);
}

void boot();
