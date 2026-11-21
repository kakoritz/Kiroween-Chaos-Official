import { apiBaseFromQuery, modeBadge } from '../src/mode';
import { autoplayDecision, pickScript } from '../src/demo';
import { ArenaScene, STAGE_H, STAGE_W } from '../src/arena/scene';
import { applyEvent, emptyVM, loadSnapshot, reconcileLedger, totalScore } from '../src/arena/model';
import { LedgerPanel, RankBoard } from '../src/arena/panels';
import { EventTicker } from '../src/arena/ticker';
import { StageInspector, chipAt } from '../src/arena/inspector';
import { BossBar, bossAnnouncement } from '../src/arena/boss';
import { ChaosModeControl, readChaosState } from '../src/arena/chaosmode';
import { ApiError, createApi, resolveHttpBase, type ArenaApi, type ArenaEvent, type ConnectionStatus, type HauntInPage } from '../src/api';

// W1/W2 shell plus the A3 canvas arena: the client connects the same way for mock, live and\n// browser. Events feed a pure reducer; the canvas redraws every animation frame from that state.

const root = document.getElementById('app')!;
root.innerHTML = `
  <div class="stage-root" id="stage">
    <canvas id="arena" width="1920" height="1080" aria-label="The haunted arena" role="img"></canvas>
    <header class="hdr">
      <span class="logo">HAUNT</span>
      <span class="wave" id="wave">Wave -</span>
      <div id="chaos-mode"></div>
      <span class="spacer"></span>
      <span class="total" id="total" title="Total score"></span>
      <span class="pill hidden" id="demo-pill">DEMO</span>
      <span class="badge badge--offline" id="badge" role="status"></span>
      <button class="btn btn--ghost hidden" id="demo-stop" type="button">Stop demo</button>
      <button class="btn" id="demo-open" type="button">Open in demo mode</button>
    </header>
    <div class="boss" id="boss" aria-hidden="true"></div>
    <aside class="insp hidden" id="insp"></aside>
    <div class="sr-only" id="live-assertive" aria-live="assertive"></div>
    <section class="panel panel--rank hidden" id="rank" aria-label="Rank board"><h2>Rank board</h2><div class="rb-body" id="rank-body"></div></section>
    <section class="panel panel--ledger hidden" id="ledger" aria-label="Ledger"><h2>Ledger</h2><div id="ledger-body"></div></section>
    <section class="panel panel--ticker hidden" id="ticker" aria-label="Event ticker"><h2>Event log</h2><div class="tk-body" id="ticker-body"></div></section>
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
let chaosCtl: ChaosModeControl;
let demoRunning = false;
let waveRunning = false;
let chainDemo = false;
let currentScript: string | null = null;
let lastDemoStart = 0;
let demoScripts: string[] | null = null;

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
const tickerEl = $('ticker');
const ticker = new EventTicker($('ticker-body'), (id) => vm.stages.find((s) => s.id === id)?.label ?? id);
const bossBar = new BossBar($('boss'));
const liveAssertive = $('live-assertive');
const inspector = new StageInspector($('insp'), {
  stageLabel: (id) => vm.stages.find((s) => s.id === id)?.label ?? id,
  chaos: (lane) => api.chaos({ lane }),
  fetchStage: (lane, stage, order) => api.getLaneStage(lane, stage, order),
  chipState: (laneIdx, i) => vm.lanes[laneIdx]?.chips[i] ?? 'pending',
  onError: showError,
});
canvas.style.cursor = 'default';
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const hit = chipAt(((e.clientX - r.left) / r.width) * STAGE_W, ((e.clientY - r.top) / r.height) * STAGE_H, vm.lanes.length, vm.stages.length);
  const lane = hit ? vm.lanes[hit.lane] : null;
  const st = hit ? vm.stages[hit.stage] : null;
  if (hit && lane && st) inspector.open(lane.lane, hit.stage, st.id, lane.order);
});
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  canvas.style.cursor = chipAt(((e.clientX - r.left) / r.width) * STAGE_W, ((e.clientY - r.top) / r.height) * STAGE_H, vm.lanes.length, vm.stages.length) ? 'pointer' : 'default';
});
async function reconcile() {
  try { reconcileLedger(vm, await api.getLedger()); } catch { /* the event-built cells stay */ }
}

function onEvent(ev: ArenaEvent) {
  queue.push(ev);
  inspector.record(ev);
  ticker.push(ev);
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
    const cs = readChaosState(s);
    if (cs) chaosCtl.adopt(cs);
    waveNo = s.wave?.n ?? 0;
    waveRunning = !!s.wave?.running;
    demoRunning = !!s.demo?.running;
    demoScripts = Array.isArray(s.demo?.scripts) ? s.demo.scripts : demoScripts;
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
    currentScript = script;
    lastDemoStart = performance.now();
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
  chaosCtl = new ChaosModeControl($('chaos-mode'), { setChaosMode: (o) => api.setChaosMode(o), onError: showError });

  for (const b of demoBtns) b.addEventListener('click', () => { chainDemo = true; void startDemo('hero'); });
  demoStop.addEventListener('click', async () => {
    try { chainDemo = false; await api.stopDemo(); demoRunning = false; paintDemo(); } catch (e) { showError(e); }
  });

  await loadState();
  api.subscribe({
    onEvent,
    onStatus: (s) => { status = s; paintBadge(); },
    onGone: () => void loadState(),
  });

  // Demo mode plays on load (?demo=off keeps it quiet, ?demo=<script> plays one script).
  const plan = autoplayDecision({ search, demoRunning, waveRunning, available: demoScripts });
  chainDemo = plan.chain;
  if (plan.start) void startDemo(plan.start);
  // Chain the playlist: when a script ends, start the next one so the show never goes quiet.
  window.setInterval(async () => {
    if (!chainDemo || performance.now() - lastDemoStart < 6000) return;
    try {
      const s = await api.getState();
      if (s.demo?.running || s.wave?.running) return;
      const next = pickScript(currentScript, Array.isArray(s.demo?.scripts) ? s.demo.scripts : demoScripts);
      if (next) void startDemo(next);
    } catch { /* retry on the next tick */ }
  }, 3000);
}

// ?inspect=<lane>:<stage id> opens the inspector once the lane exists (used for screenshots).
let pendingInspect = new URLSearchParams(window.location.search).get('inspect');

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
  while (queue.length) {
    const ev = queue.shift()!;
    const before = vm.boss.phase;
    applyEvent(vm, ev, now);
    const kind = ev.type === 'boss_warning' ? 'warning' : ev.type === 'boss_start' ? 'start' : ev.type === 'boss_end' ? 'end' : null;
    if (kind && (kind !== 'end' || before !== 'none')) liveAssertive.textContent = bossAnnouncement(kind, vm.boss);
  }
  scene.speed = vm.speed || 1;
  totalEl.textContent = vm.lanes.length ? `Score ${totalScore(vm)}` : '';
  quietEl.classList.toggle('hidden', vm.lanes.length > 0);
  rankEl.classList.toggle('hidden', vm.lanes.length === 0);
  ledgerEl.classList.toggle('hidden', vm.lanes.length === 0);
  tickerEl.classList.toggle('hidden', vm.lanes.length === 0);
  ticker.render();
  if (pendingInspect) {
    const [ln, sid] = pendingInspect.split(':');
    const lane = vm.lanes.find((l) => l.lane === Number(ln));
    const si = vm.stages.findIndex((s) => s.id === sid);
    if (lane && lane.order && si >= 0) { inspector.open(lane.lane, si, sid!, lane.order); pendingInspect = null; }
  }
  inspector.render(now);
  rankBoard.update(vm);
  ledgerPanel.update(vm, now);
  scene.draw(vm, now);
  bossBar.update(vm.boss, now, reduceMotion.matches);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __arena?: unknown }).__arena = { vm };