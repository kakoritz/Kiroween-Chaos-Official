import { apiBaseFromQuery, modeBadge, presentFromQuery } from '../src/mode';
import { autoplayDecision, pickScript } from '../src/demo';
import { ArenaScene, BOSS_INSET, STAGE_H, STAGE_W } from '../src/arena/scene';
import { applyEvent, emptyVM, loadSnapshot, reconcileLedger, totalScore } from '../src/arena/model';
import { LedgerPanel, RankBoard } from '../src/arena/panels';
import { LaneTickerModel, LaneTickerView } from '../src/arena/lanes-ticker';
import { StageInspector, chipAt } from '../src/arena/inspector';
import { chipTipAt } from '../src/arena/chiptip';
import { BossBar, bossAnnouncement } from '../src/arena/boss';
import { ChaosModeControl, readChaosState } from '../src/arena/chaosmode';
import { AppSwitcher, currentApp } from '../src/arena/appswitch';
import { ArenaSound } from '../src/sound';
import { FrameSampler, perfSecondsFromQuery } from '../src/perf';
import { KEY_HELP, chaosAnnouncement, keyAction, nextMode, renderLegend } from '../src/arena/keys';
import { Splash, splashDecision, splashTarget } from '../src/onboarding/splash';
import '../src/onboarding/splash.css';
import { CaptionOverlay, CaptionPlayer, freezeFromQuery } from '../src/onboarding/captions';
import '../src/onboarding/captions.css';
import { quietBadge, waveLabel } from '../src/onboarding/polish';
import { SPLASH_TAGLINE } from '../src/onboarding/splash';
import { Tour, tourRequested } from '../src/onboarding/tour';
import '../src/onboarding/tour.css';
import '../src/arena/lanes-ticker.css';
import { mountCampaignHub } from '../src/campaign/hub';
import '../src/campaign/hub.css';
import { gearShopStarter } from '../src/campaign/shop';
import '../src/campaign/shop.css';
import { mountCampaignResults } from '../src/campaign/results';
import '../src/campaign/results.css';
import { ApiError, createApi, resolveHttpBase, type ArenaApi, type ArenaEvent, type ConnectionStatus, type HauntInPage } from '../src/api';

// W1/W2 shell plus the A3 canvas arena: the client connects the same way for mock, live and\n// browser. Events feed a pure reducer; the canvas redraws every animation frame from that state.

const root = document.getElementById('app')!;
root.innerHTML = `
  <div class="stage-root" id="stage">
    <canvas id="arena" width="1920" height="1080" aria-label="The haunted arena" role="img"></canvas>
    <header class="hdr">
      <span class="logo">HAUNT</span>
      <span class="tagline">${SPLASH_TAGLINE}</span>
      <span class="wave" id="wave"></span>
      <div id="app-switch"></div>
      <div id="chaos-mode"></div>
      <span class="spacer"></span>
      <span class="total" id="total" title="Total score"></span>
      <button class="btn btn--ghost" id="tour-open" type="button" title="Six-step guided tour">Tour</button>
      <button class="btn btn--ghost" id="keys-btn" type="button" aria-expanded="false" aria-controls="keys-pop" title="Keyboard and state legend (?)">&#9000; Keys</button>
      <button class="btn btn--ghost" id="mute" type="button" aria-pressed="true" title="Sound is off until you turn it on">&#128263; Sound off</button>
      <span class="pill hidden" id="demo-pill">DEMO</span>
      <span class="badge badge--offline" id="badge" role="status"></span>
      <button class="btn btn--ghost hidden" id="demo-stop" type="button">Stop demo</button>
      <button class="btn" id="demo-open" type="button">Open in demo mode</button>
    </header>
    <div class="boss" id="boss" aria-hidden="true"></div>
    <aside class="insp hidden" id="insp"></aside>
    <div class="keys-pop hidden" id="keys-pop" role="dialog" aria-label="Keyboard and state legend"><h2>Keyboard</h2><ul class="keys-list" id="keys-list"></ul><h2>States</h2><ul class="lg-list" id="legend-list"></ul></div>
    <div class="sr-only" id="live-assertive" aria-live="assertive"></div>
    <div class="present-hint" id="present-hint" aria-hidden="true">Present mode. Press P or Esc to exit.</div>
    <section class="panel panel--rank hidden" id="rank" aria-label="Rank board"><h2>Rank board</h2><div class="rb-body" id="rank-body"></div></section>
    <section class="panel panel--ledger hidden" id="ledger" aria-label="Ledger"><h2>Ledger</h2><div id="ledger-body"></div></section>
    <section class="panel panel--ticker hidden" id="ticker" aria-label="Lane ticker"><h2>Lane ticker</h2><div class="lt-body" id="ticker-body"></div></section>
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
let appSwitch: AppSwitcher | null = null;
let demoRunning = false;
let waveRunning = false;
let chainDemo = false;
let currentScript: string | null = null;
let lastDemoStart = 0;
let demoScripts: string[] | null = null;

function paintBadge() {
  const b = quietBadge(modeBadge(mode, status), { waveNo, demoRunning });
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
const tickerModel = new LaneTickerModel((id) => vm.stages.find((s) => s.id === id)?.label ?? id);
const ticker = new LaneTickerView($('ticker-body'), tickerModel, {
  tier: (lane) => vm.lanes.find((l) => l.lane === lane)?.tier ?? '',
  open: (lane) => {
    const l = vm.lanes.find((x) => x.lane === lane);
    if (!l) return;
    const at = Math.max(0, l.chips.findIndex((c) => c === 'active' || c === 'retrying' || c === 'failed' || c === 'dead'));
    const st = vm.stages[at];
    if (st) inspector.open(l.lane, at, st.id, l.order);
  },
});
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
  const hit = chipAt(((e.clientX - r.left) / r.width) * STAGE_W, ((e.clientY - r.top) / r.height) * STAGE_H, vm.lanes.length, vm.stages.length, vm.boss.phase === 'none' ? 0 : BOSS_INSET);
  const lane = hit ? vm.lanes[hit.lane] : null;
  const st = hit ? vm.stages[hit.stage] : null;
  if (hit && lane && st) inspector.open(lane.lane, hit.stage, st.id, lane.order);
});
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  canvas.style.cursor = chipAt(((e.clientX - r.left) / r.width) * STAGE_W, ((e.clientY - r.top) / r.height) * STAGE_H, vm.lanes.length, vm.stages.length, vm.boss.phase === 'none' ? 0 : BOSS_INSET) ? 'pointer' : 'default';
  canvas.title = chipTipAt(vm, ((e.clientX - r.left) / r.width) * STAGE_W, ((e.clientY - r.top) / r.height) * STAGE_H, vm.boss.phase === 'none' ? 0 : BOSS_INSET);
});
const keysPop = $('keys-pop');
const keysBtn = $<HTMLButtonElement>('keys-btn');
$('keys-list').innerHTML = KEY_HELP.map((k) => `<li><kbd>${k.keys}</kbd> ${k.does}</li>`).join('');
renderLegend($('legend-list'));
function toggleKeys(force?: boolean) {
  const open = force ?? keysPop.classList.contains('hidden');
  keysPop.classList.toggle('hidden', !open);
  keysBtn.setAttribute('aria-expanded', String(open));
}
keysBtn.addEventListener('click', () => toggleKeys());
const presentHint = $('present-hint');
let hintTimer: number | undefined;
function setPresent(on: boolean, hint = true) {
  document.body.classList.toggle('present', on);
  if (on) toggleKeys(false);
  presentHint.classList.toggle('on', on && hint);
  window.clearTimeout(hintTimer);
  if (on && hint) hintTimer = window.setTimeout(() => presentHint.classList.remove('on'), 2500);
}
if (presentFromQuery(window.location.search)) setPresent(true, false);
if (new URLSearchParams(window.location.search).get('keys') === 'open') toggleKeys(true);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { toggleKeys(false); setPresent(false); return; }
  const t = e.target as HTMLElement | null;
  const act = keyAction({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, targetTag: t?.tagName, editable: !!t?.isContentEditable }, vm.lanes.length);
  if (!act || !api) return;
  if (act.type === 'help') { e.preventDefault(); toggleKeys(); return; }
  if (act.type === 'present') { e.preventDefault(); setPresent(!document.body.classList.contains('present')); return; }
  if (act.type === 'cycle-mode') { e.preventDefault(); const m = nextMode(chaosCtl.model.mode); chaosCtl.model.choose(m); liveAssertive.textContent = `Chaos mode ${m}`; return; }
  if (act.type === 'chaos') {
    e.preventDefault();
    api.chaos(act.lane === undefined ? {} : { lane: vm.lanes[act.lane]?.lane ?? act.lane }).then(
      (r) => { liveAssertive.textContent = chaosAnnouncement(act.lane, r.creature); }, showError);
  }
});
async function reconcile() {
  try { reconcileLedger(vm, await api.getLedger()); } catch { /* the event-built cells stay */ }
}

const sound = new ArenaSound();
const muteBtn = $<HTMLButtonElement>('mute');
muteBtn.addEventListener('click', () => {
  const muted = sound.toggle();
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.textContent = muted ? '\u{1F507} Sound off' : '\u{1F50A} Sound on';
});

const captionPlayer = new CaptionPlayer(freezeFromQuery(window.location.search));
const captionOverlay = new CaptionOverlay(stageEl, captionPlayer, { demoRunning: new URLSearchParams(window.location.search).get('demo') !== 'off' });

const shopStart = gearShopStarter(stageEl, { getCampaign: () => api.getCampaign(), startWave: (o) => { campaignResults.begin(o.campaign.night); return api.startWave(o); } });
const campaignResults = mountCampaignResults(stageEl, { getCampaign: () => api.getCampaign() }, { onNight: (n) => shopStart(n), onHub: () => window.dispatchEvent(new CustomEvent('haunt:splash', { detail: { action: 'campaign' } })) }); // CP-U3

function onEvent(ev: ArenaEvent) {
  campaignResults.onEvent(ev);
  queue.push(ev);
  captionPlayer.event(ev, performance.now());
  sound.onEvent(ev, performance.now());
  inspector.record(ev);
  tickerModel.push(ev, performance.now());
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
  waveEl.textContent = waveLabel(waveNo);
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
    appSwitch?.setActive(currentApp(s));
    waveNo = s.wave?.n ?? 0;
    waveRunning = !!s.wave?.running;
    demoRunning = !!s.demo?.running;
    demoScripts = Array.isArray(s.demo?.scripts) ? s.demo.scripts : demoScripts;
    waveEl.textContent = waveLabel(waveNo);
    queue.length = 0;
    loadSnapshot(vm, s, performance.now());
    await reconcile();
  } catch (e) { showError(e); }
  paintBadge();
  paintDemo();
}

async function startCaptions(script: string) {
  try { captionPlayer.start(script, (await api.getCaptions?.(script)) ?? [], performance.now()); } catch { captionPlayer.stop(); }
}

async function startDemo(script: string) {
  errEl.textContent = '';
  try {
    if (waveRunning) await api.stopWave();
    currentScript = script;
    lastDemoStart = performance.now();
    void startCaptions(script);
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
    try { chainDemo = false; captionPlayer.stop(); await api.stopDemo(); demoRunning = false; paintDemo(); } catch (e) { showError(e); }
  });

  appSwitch = new AppSwitcher($('app-switch'), {
    getApps: () => api.getApps(),
    setApp: (id) => api.setApp(id),
    stopRunning: async () => {
      chainDemo = false;
      if (demoRunning) { await api.stopDemo(); demoRunning = false; }
      if (waveRunning) { await api.stopWave(); waveRunning = false; }
      paintDemo();
    },
    reload: loadState,
    onError: showError,
  });

  await loadState();
  void appSwitch.load(currentApp(await api.getState().catch(() => null)));
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

// Title splash (ON-U1). Buttons also emit `haunt:splash` so the tour (ON-U3) and campaign can hook in.
{
  const sd = splashDecision(window.location.search);
  if (sd.show) {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    new Splash(stageEl, {
      onAction: (action) => {
        window.dispatchEvent(new CustomEvent('haunt:splash', { detail: { action } }));
        const href = splashTarget(action);
        if (href) window.location.assign(href);
      },
      onDismiss: () => { /* the demo already plays behind the splash */ },
    }, { reduced, autoDismissMs: sd.autoDismissMs });
  }
}

mountCampaignHub(stageEl, { getCampaign: () => api.getCampaign() }, { onStart: shopStart }); // CP-U1/U2: hub on the splash, gear shop on "Choose gear and start"

// Guided tour (ON-U3): header button, ?tour=1, and the splash "Take the tour" button.
{
  let tour: Tour | null = null;
  const keysBtn = $<HTMLButtonElement>('keys-btn');
  const beginTour = async () => {
    if (tour) return;
    if (!demoRunning && !waveRunning) await startDemo('hero');
    tour = new Tour(stageEl, {
      onAction: (a) => {
        if (a === 'legend' && keysBtn.getAttribute('aria-expanded') !== 'true') keysBtn.click();
        else if (a === 'chaos') void api.chaos({ lane: 0 }).catch(showError);
        else if (a === 'report') {
          window.dispatchEvent(new CustomEvent('haunt:tour-report'));
          document.getElementById('report-btn')?.click();
        }
      },
      onEnd: () => {
        tour = null;
        if (keysBtn.getAttribute('aria-expanded') === 'true') keysBtn.click();
      },
    });
  };
  $('tour-open').addEventListener('click', () => void beginTour());
  window.addEventListener('haunt:splash', (e) => { if ((e as CustomEvent).detail?.action === 'tour') void beginTour(); });
  if (tourRequested(window.location.search)) window.setTimeout(() => void beginTour(), 600);
}

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
// ?perf=<seconds> samples frame times in-page and reports them (UI-D3); ?perfsink=<http://127.0.0.1:port/> receives the JSON.
const perfSeconds = perfSecondsFromQuery(window.location.search);
const sampler = perfSeconds ? new FrameSampler() : null;
let perfStart = -1;
function frame(now: number) {
  const t0 = sampler ? performance.now() : 0;
  const dt = now - prev; prev = now;
  // Lite mode (fewer particles, no fog) if frames stay above 24 ms for 2 seconds.
  slow = dt > 24 ? slow + dt : 0;
  scene.setLite(slow > 2000);
  captionOverlay.update(now);
  if (captionPlayer.frozen(now)) { requestAnimationFrame(frame); return; }
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
  ticker.ensure(vm.lanes.map((l) => l.lane));
  ticker.render(performance.now());
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
  if (sampler) {
    sampler.frame(now, performance.now() - t0, vm.lanes.length);
    if (perfStart < 0) perfStart = now;
    if (now - perfStart >= perfSeconds * 1000) { reportPerf(sampler.summary()); return; }
  }
  requestAnimationFrame(frame);
}

function reportPerf(summary: unknown) {
  (window as unknown as { __perf?: unknown }).__perf = summary;
  document.title = 'perf-done';
  const sink = new URLSearchParams(window.location.search).get('perfsink');
  if (sink && /^http:\/\/127\.0\.0\.1:\d+\//.test(sink)) void fetch(sink, { method: 'POST', body: JSON.stringify(summary) }).catch(() => {});
}
requestAnimationFrame(frame);

(window as unknown as { __arena?: unknown }).__arena = { vm };
