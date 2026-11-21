import { apiBaseFromQuery, demoFromQuery, modeBadge } from '../src/mode';
import { ArenaScene, STAGE_H, STAGE_W } from '../src/arena/scene';
import { applyEvent, emptyVM, loadSnapshot, reconcileLedger, totalScore } from '../src/arena/model';
import { LedgerPanel, RankBoard } from '../src/arena/panels';
import { ApiError, createApi, resolveHttpBase, type ArenaApi, type ArenaEvent, type ConnectionStatus, type HauntInPage } from '../src/api';

// W1/W2 shell plus the A3 canvas arena: the client connects the same way for mock, live and\n// browser. Events feed a pure reducer; the canvas redraws every animation frame from that state.

const root = document.getElementById('app')!;
root.innerHTML = `
  <div class="stage-root" id="stage">
    <canvas id="arena" width="1920" height="1080" aria-label="The haunted arena" role="img"></canvas>
    <header class="hdr">
      <span class="logo">HAUNT</span>
      <span class="wave" id="wave">Wave -</span>
      <span class="spacer"></span>
      <span class="total" id="total" title="Total score"></span>
      <span class="pill hidden" id="demo-pill">DEMO</span>
      <span class="badge badge--offline" id="badge" role="status"></span>
      <button class="btn btn--ghost hidden" id="demo-stop" type="button">Stop demo</button>
      <button class="btn" id="demo-open" type="button">Open in demo mode</button>
    </header>
    <section class="panel panel--rank hidden" id="rank" aria-label="Rank board"><h2>Rank board</h2><div class="rb-body" id="rank-body"></div></section>
    <section class="panel panel--ledger hidden" id="ledger" aria-label="Ledger"><h2>Ledger</h2><div id="ledger-body"></div></section>
    <section class="quiet" id="quiet">
      <h1>The crypt is quiet</h1>
      <p>Five skeletons are asleep. Start the show.</p>
      <button class="btn btn--big" id="demo-big" type="button">Open in demo mode</button>
      <div class="err" id="err" role="alert"></div>
      <div class="stats" id="stats"></div>
    </section>
  </div>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const badgeEl = $('badge');
const errEl = $('err');
const statsEl = $('stats');
const waveEl = $('wave');
const totalEl = $('total');
const quietEl = $('quiet');
const stageEl = $('stage');
const canvas = $<HTMLCanvasElement>('arena');
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

// Arena state: a pure reducer fed from a queue and drained once per animation frame, so a burst
// of events (200 per second in the stress stream) never stutters. Events are never dropped.
const vm = emptyVM();
const queue: ArenaEvent[] = [];
const scene = new ArenaScene(canvas.getContext('2d')!);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
scene.reducedMotion = reduceMotion.matches;
reduceMotion.addEventListener('change', () => { scene.reducedMotion = reduceMotion.matches; });
const rankBoard = new RankBoard($('rank-body'));
const ledgerPanel = new LedgerPanel($('ledger-body'));
const rankEl = $('rank');
const ledgerEl = $('ledger');
async function reconcile() {
  try { reconcileLedger(vm, await api.getLedger()); } catch { /* the event-built cells stay */ }
}

function onEvent(ev: ArenaEvent) {
  queue.push(ev);
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
    void reconcile();
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
    queue.length = 0;
    loadSnapshot(vm, s, performance.now());
    await reconcile();
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

// Fixed 1920x1080 design stage, scaled uniformly to fit and centred (letterboxed). The canvas
// backing store follows the scale and DPR so lines stay crisp; all drawing uses design pixels.
let lastFit = '';
function fit() {
  const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  const left = (window.innerWidth - STAGE_W * s) / 2;
  const top = (window.innerHeight - STAGE_H * s) / 2;
  stageEl.style.transform = `translate(${left}px, ${top}px) scale(${s})`;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(STAGE_W * s * dpr);
  const key = ``;
  if (key !== lastFit) {
    lastFit = key;
    canvas.width = w;
    canvas.height = Math.round(STAGE_H * s * dpr);
    canvas.getContext('2d')!.setTransform(w / STAGE_W, 0, 0, w / STAGE_W, 0, 0);
  }
}
window.addEventListener('resize', fit);
fit();

let slow = 0;
let prev = performance.now();
function frame(now: number) {
  const dt = now - prev; prev = now;
  // Lite mode (fewer particles, no fog) if frames stay above 24 ms for 2 seconds.
  slow = dt > 24 ? slow + dt : 0;
  scene.setLite(slow > 2000);
  while (queue.length) applyEvent(vm, queue.shift()!, now);
  scene.speed = vm.speed || 1;
  totalEl.textContent = vm.lanes.length ? `Score ${totalScore(vm)}` : '';
  quietEl.classList.toggle('hidden', vm.lanes.length > 0);
  rankEl.classList.toggle('hidden', vm.lanes.length === 0);
  ledgerEl.classList.toggle('hidden', vm.lanes.length === 0);
  rankBoard.update(vm);
  ledgerPanel.update(vm, now);
  scene.draw(vm, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __arena?: unknown }).__arena = { vm };