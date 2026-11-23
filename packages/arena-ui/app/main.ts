import { apiBaseFromQuery, modeBadge, presentFromQuery } from '../src/mode';
import { autoplayDecision, pickScript } from '../src/demo';
import { ArenaScene, BOSS_INSET, STAGE_H, STAGE_W, laneBoxes } from '../src/arena/scene';
import { applyEvent, emptyVM, loadSnapshot, reconcileLedger, totalScore } from '../src/arena/model';
import { LedgerPanel, RankBoard } from '../src/arena/panels';
import { LaneTickerModel, LaneTickerView } from '../src/arena/lanes-ticker';
import { chipAt } from '../src/arena/inspector';
import { computeFit } from '../src/arena/layout';
import { LanePopup } from '../src/arena/lane-popup';
import '../src/arena/lane-popup.css';
import { WaveSummary } from '../src/arena/wave-summary';
import { chipTipAt } from '../src/arena/chiptip';
import { BossBar, bossAnnouncement } from '../src/arena/boss';
import { ChaosModeControl, readChaosState } from '../src/arena/chaosmode';
import { AppSwitcher, currentApp } from '../src/arena/appswitch';
import { GearMenu, DEFAULT_PACE, badgeTitle, type Pace } from '../src/arena/gearmenu';
import '../src/arena/gearmenu.css';
import { IntensityDial, applyIntensity, readDial, defaultDial } from '../src/arena/dial';
import '../src/arena/dial.css';
import { RoundIndicator, RoundCard, FinalScreen, type TournamentHost } from '../src/arena/tournament-view';
import '../src/arena/tournament.css';
import { applyCasebookEvent, emptyCasebook, lessonsTip, loadCasebook, loadLessons, mechanismWord } from '../src/arena/casebook';
import { awardsRow, casebookTable, curseTableEl, fallbackAwards } from '../src/arena/casebook-view';
import { countAnswer, emptyCurseLedger, isClass } from '../src/arena/curses';
import { PatternsPanel } from '../src/arena/patterns-view';
import '../src/arena/patterns.css';
import { LegendModal } from '../src/arena/legend-modal';
import { ArenaSound } from '../src/sound';
import { FrameSampler, perfSecondsFromQuery } from '../src/perf';
import { KEY_HELP, chaosAnnouncement, isNextKey, keyAction, nextMode, renderLegend } from '../src/arena/keys';
import { Splash, splashDecision, splashTarget } from '../src/onboarding/splash';
import '../src/onboarding/splash.css';
import { CaptionOverlay, CaptionPlayer, freezeFromQuery } from '../src/onboarding/captions';
import '../src/onboarding/captions.css';
import { quietBadge, waveLabel } from '../src/onboarding/polish';
import { SPLASH_TAGLINE } from '../src/onboarding/splash';
import { Tour, tourRequested } from '../src/onboarding/tour';
import '../src/onboarding/tour.css';
import '../src/arena/lanes-ticker.css';
import { ReviewCardView } from '../src/arena/review-card';
import '../src/arena/review-card.css';
import { DecisionPopupView } from '../src/arena/decision';
import '../src/arena/decision.css';
import { ScoreVisuals } from '../src/arena/score-visuals';
import '../src/arena/score-visuals.css';
import { mountCampaignHub } from '../src/campaign/hub';
import '../src/campaign/hub.css';
import { gearShopStarter } from '../src/campaign/shop';
import '../src/campaign/shop.css';
import { mountCampaignResults } from '../src/campaign/results';
import '../src/campaign/results.css';
import { mountCampaignSandbox } from '../src/campaign/sandbox';
import '../src/campaign/sandbox.css';
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
      <span id="round-ind"></span>
      <div id="app-switch"></div>
      <div id="chaos-mode"></div>
      <div id="dial"></div>
      <span class="spacer"></span>
      <span class="total" id="total" title="Total score"></span>
      <button class="btn btn--ghost" id="tour-open" type="button" title="Guided tour">Tour</button>
      <button class="btn btn--ghost" id="keys-btn" type="button" aria-expanded="false" aria-controls="keys-pop" title="Keyboard and state legend (?)">&#9000; Keys</button>
      <button class="btn btn--ghost" id="patterns-btn" type="button" title="Recurring trouble, fix specs and the improve loop">Patterns<span class="pt-badge hidden" id="patterns-badge"></span></button>
      <button class="btn btn--ghost" id="legend-btn" type="button" aria-expanded="false" title="What do R J I B Q mean?">?</button>
      <span class="gear-wrap" id="gear-wrap"><button class="btn btn--ghost" id="gear-btn" type="button" title="Settings: chaos, pace, speed, sound, motion" aria-label="Settings">&#9881;</button></span>
      <span class="pace-tag" id="pace-tag" title="Slow pace is on"></span>
      <button class="btn btn--ghost" id="mute" type="button" aria-pressed="true" title="Sound is off until you turn it on">&#128263; Sound off</button>
      <span class="pill hidden" id="demo-pill">DEMO</span>
      <span class="badge badge--offline" id="badge" role="status"></span>
      <button class="btn btn--ghost hidden" id="demo-stop" type="button">&#9632; Stop demo</button>
      <button class="btn hidden" id="next-btn" type="button" title="Review the logs first. Press N or Space for the next wave.">&#9654; Next wave</button>
      <button class="btn" id="demo-open" type="button">&#9654; Play demo</button>
    </header>
    <div id="chaos-mode"></div>
    <div class="boss" id="boss" aria-hidden="true"></div>
    <div id="insp"></div>
    <div class="keys-pop hidden" id="keys-pop" role="dialog" aria-label="Keyboard and state legend"><h2>Keyboard</h2><ul class="keys-list" id="keys-list"></ul><h2>States</h2><ul class="lg-list" id="legend-list"></ul></div>
    <div class="sr-only" id="live-assertive" aria-live="assertive"></div>
    <div class="present-hint" id="present-hint" aria-hidden="true">Present mode. Press P or Esc to exit.</div>
    <section class="panel panel--rank hidden" id="rank" aria-label="Rank board"><h2>Rank board</h2><div class="rb-body" id="rank-body"></div></section>
    <section class="panel panel--ledger hidden" id="ledger" aria-label="Ledger"><h2>Ledger</h2><div id="ledger-body"></div></section>
    <section class="panel panel--ticker hidden" id="ticker" aria-label="Lane ticker"><h2>Lane ticker</h2><div class="lt-body" id="ticker-body"></div></section>
    <section class="quiet" id="quiet">
      <h1>The crypt is quiet</h1>
      <p>Five skeletons are asleep. Start the show.</p>
      <div class="quiet-btns"><button class="btn btn--big" id="demo-big" type="button">&#9654; Play demo</button><button class="btn btn--big btn--ghost" id="tour-big" type="button" title="Five lanes race. The worst drops each round.">&#9876; Start tournament</button></div>
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
const nextBtn = $('next-btn');
const demoBtns = [$<HTMLButtonElement>('demo-open'), $<HTMLButtonElement>('demo-big')];

let mode: string | null = null;
let status: ConnectionStatus = 'connecting';
let events = 0;
let lastSeq = 0;
let waveNo = 0;
let api: ArenaApi;
let chaosCtl: ChaosModeControl;
let dial: IntensityDial | null = null;
// TV3-U8: true once any tournament event arrived; Next then calls POST /api/next instead of starting a wave.
let tourActive = false;
let appSwitch: AppSwitcher | null = null;
let demoRunning = false;
let waveRunning = false;
let chainDemo = false;
let currentScript: string | null = null;
let lastDemoStart = 0;
// TV3-U2: after a wave ends the show waits in a review state until the player presses Next (button, N or Space).
let awaitingNext = false;
let demoScripts: string[] | null = null;

function paintBadge() {
  const b = quietBadge(modeBadge(mode, status), { waveNo, demoRunning });
  badgeEl.className = `badge badge--${b.tone}`;
  badgeEl.textContent = `${b.icon} ${b.label}`;
  badgeEl.title = badgeTitle(b.title);
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
document.body.classList.toggle('reduced-motion', reduceMotion.matches);
reduceMotion.addEventListener('change', () => { scene.reducedMotion = reduceMotion.matches; document.body.classList.toggle('reduced-motion', reduceMotion.matches); });
const rankBoard = new RankBoard($('rank-body'));
const ledgerPanel = new LedgerPanel($('ledger-body'));
const rankEl = $('rank');
const ledgerEl = $('ledger');
const reviewCards = new ReviewCardView(stageEl, (n) => { const i = vm.lanes.findIndex((x) => x.lane === n); return i < 0 ? null : laneBoxes(vm.lanes.length, vm.boss.phase === 'none' ? 0 : BOSS_INSET)[i] ?? null; });
// PT-U11: the wrong-order popup over the lane that asked; POST /api/decision with the chosen card, keys 1 2 3.
const decisionPopup = new DecisionPopupView(stageEl, (n) => { const i = vm.lanes.findIndex((x) => x.lane === n); const b = i < 0 ? null : laneBoxes(vm.lanes.length, vm.boss.phase === 'none' ? 0 : BOSS_INSET)[i]; return b ? { top: b.top, h: b.h } : null; }, (lane, order, choice) => api.decide(lane, order, choice), (id) => vm.stages.find((s) => s.id === id)?.label ?? id);
const scoreVisuals = new ScoreVisuals(stageEl, (n) => { const i = vm.lanes.findIndex((x) => x.lane === n); return i < 0 ? null : laneBoxes(vm.lanes.length, vm.boss.phase === 'none' ? 0 : BOSS_INSET)[i] ?? null; });
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
const inspector = new LanePopup($('insp'), {
  stageIds: () => vm.stages.map((s) => s.id),
  stageLabel: (id) => vm.stages.find((s) => s.id === id)?.label ?? id,
  laneInfo: (n) => { const l = vm.lanes.find((x) => x.lane === n); return l ? { tier: l.tier, order: l.order, running: l.mode !== 'sleep' && l.mode !== 'done' && l.order !== null } : null; },
  laneBox: (n) => { const i = vm.lanes.findIndex((x) => x.lane === n); return i < 0 ? null : laneBoxes(vm.lanes.length, vm.boss.phase === 'none' ? 0 : BOSS_INSET)[i] ?? null; },
  chaos: (lane, creature) => api.chaos(creature ? { lane, creature } : { lane }),
  creatures: () => api.getCreatures(),
  lessons: (lane) => casebook.lessons[lane] ?? [],
  fetchOrder: (lane, order) => api.getLaneOrder(lane, order),
  fetchLaps: (lane) => api.getLaneLaps(lane),
  onError: showError,
}, canvas);
canvas.style.cursor = 'default';
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * STAGE_W;
  const y = ((e.clientY - r.top) / r.height) * STAGE_H;
  const inset = vm.boss.phase === 'none' ? 0 : BOSS_INSET;
  const hit = chipAt(x, y, vm.lanes.length, vm.stages.length, inset);
  const lane = hit ? vm.lanes[hit.lane] : null;
  const st = hit ? vm.stages[hit.stage] : null;
  if (hit && lane && st) { inspector.open(lane.lane, hit.stage, st.id, lane.order); return; }
  if (x < 260) {
    const i = laneBoxes(vm.lanes.length, inset).findIndex((b) => y >= b.top && y <= b.top + b.h);
    const l = i >= 0 ? vm.lanes[i] : null;
    if (l) inspector.open(l.lane, null, null, l.order);
  }
});
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  canvas.style.cursor = chipAt(((e.clientX - r.left) / r.width) * STAGE_W, ((e.clientY - r.top) / r.height) * STAGE_H, vm.lanes.length, vm.stages.length, vm.boss.phase === 'none' ? 0 : BOSS_INSET) ? 'pointer' : 'default';
  const dx = ((e.clientX - r.left) / r.width) * STAGE_W, dy = ((e.clientY - r.top) / r.height) * STAGE_H;
  const hot = scene.hot.find((h) => dx >= h.x && dx <= h.x + h.w && dy >= h.y && dy <= h.y + h.h);
  canvas.title = hot ? hot.tip : chipTipAt(vm, dx, dy, vm.boss.phase === 'none' ? 0 : BOSS_INSET);
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
  // A wrong order waits for an answer: 1, 2 and 3 pick refund, discount or redo before they mean Chaos on a lane.
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName ?? '') && decisionPopup.key(e.key)) { e.preventDefault(); return; }
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

let curseLedger = emptyCurseLedger();
const waveSummary = new WaveSummary(stageEl, {
  stageIds: () => vm.stages.map((s) => s.id),
  stageLabel: (id) => vm.stages.find((s) => s.id === id)?.label ?? id,
  laneTitle: (n) => vm.lanes.find((l) => l.lane === n)?.tier ?? '',
  fetchStars: (n) => api.getWaveStars(n),
  nextWave: () => { awaitingNext = true; void goNext(); },
  playDemo: () => { void startDemo(pickScript(currentScript, demoScripts) ?? 'hero'); },
  reportUrl: (n) => `report.html?live=1#/report/${n}`,
  extra: () => curseTableEl(curseLedger, casebookHost),
}); // PT-U6
const shopStart = gearShopStarter(stageEl, { getCampaign: () => api.getCampaign(), startWave: async (o) => {
  // The attract demo (or a leftover wave) plays behind the splash; a night cannot start until it stops.
  chainDemo = false; captionPlayer.stop();
  if (demoRunning) { await api.stopDemo(); demoRunning = false; paintDemo(); }
  try { await api.stopWave(); } catch { /* no wave running */ }
  waveRunning = false;
  campaignResults.begin(o.campaign.night);
  waveSummary.suppressNext();
  return api.startWave(o);
} });
const campaignSandbox = mountCampaignSandbox(stageEl, { getCampaign: () => api.getCampaign(), startWave: async (o) => {
  // CP-U4: practice run. Same clean start as a night, but results are NOT begun, so no credits or unlocks are recorded.
  chainDemo = false; captionPlayer.stop();
  if (demoRunning) { await api.stopDemo(); demoRunning = false; paintDemo(); }
  try { await api.stopWave(); } catch { /* no wave running */ }
  waveRunning = false;
  waveSummary.suppressNext();
  return api.startWave(o);
} });
const tournamentHost: TournamentHost = {
  laneTitle: (n) => vm.lanes.find((l) => l.lane === n)?.label || vm.lanes.find((l) => l.lane === n)?.tier || '',
  laneTier: (n) => vm.lanes.find((l) => l.lane === n)?.tier ?? 'rookie',
  stageLabel: (id) => vm.stages.find((s) => s.id === id)?.label ?? id,
  next: () => { awaitingNext = true; void goNext(); },
  startTournament: () => { void beginTournament(); },
  reducedMotion: () => reduceMotion.matches || document.body.classList.contains('reduced-motion'),
};
const roundInd = new RoundIndicator($('round-ind'));
const roundCard = new RoundCard(stageEl, tournamentHost);
const finalScreen = new FinalScreen(stageEl, tournamentHost);
// TV3-U9: lessons ledger and Casebook, fed straight from the event stream (the DOM cards need them the moment round_end lands).
const patternsBtn = $<HTMLButtonElement>('patterns-btn');
const patternsBadge = $('patterns-badge');
const patternsPanel = new PatternsPanel(stageEl, {
  getPatterns: () => api.getPatterns(), writeSpecs: () => api.writeSpecs(), startImprove: () => api.startImprove({ speed: 4, pace: 'normal' }), getImprove: () => api.getImprove(),
  stageLabel: tournamentHost.stageLabel, laneTitle: tournamentHost.laneTitle, onError: showError,
  onBadge: (n, running) => { patternsBadge.textContent = running ? '\u21BB' : String(n); patternsBadge.classList.toggle('hidden', !running && n === 0); patternsBadge.classList.toggle('run', running); },
}, () => reduceMotion.matches || document.body.classList.contains('reduced-motion'));
patternsBtn.addEventListener('click', () => void patternsPanel.open());
roundCard.muted = () => patternsPanel.running;
finalScreen.muted = () => patternsPanel.running;
const casebook = emptyCasebook();
const casebookHost = { laneTitle: tournamentHost.laneTitle, stageLabel: tournamentHost.stageLabel };
scene.lessonInfo = (lane) => {
  const list = casebook.lessons[lane] ?? [];
  const la = casebook.learnedAt[lane];
  return { count: list.length, tip: list.length ? lessonsTip(list, tournamentHost.stageLabel) : '', learnedAt: la?.at ?? -1, mechanism: la ? mechanismWord(la.mechanism) : '' };
};
roundCard.extra = (r) => {
  const box = document.createElement('div');
  const learned = Object.entries(casebook.lessons).map(([lane, list]) => ({ lane: Number(lane), n: list.filter((x) => x.round === r.round).length })).filter((x) => x.n > 0);
  if (learned.length > 0) {
    const p = document.createElement('p'); p.className = 'tv-learned';
    p.textContent = `Learned this round: ${learned.map((x) => `${tournamentHost.laneTitle(x.lane) || `Lane ${x.lane}`} +${x.n}`).join(', ')}`;
    box.append(p);
  }
  const crs = curseTableEl(curseLedger, casebookHost);
  if (crs) box.append(crs);
  box.append(casebookTable(casebook, casebookHost, { max: 4, title: 'Casebook so far' }));
  return box;
};
finalScreen.sections = [
  (t) => awardsRow(t.awards.length > 0 ? t.awards : fallbackAwards(t, casebook), casebookHost),
  () => casebookTable(casebook, casebookHost, { max: 6 }),
];
$('round-ind').addEventListener('click', () => { if (vm.tournament.phase === 'ended') finalScreen.reopen(); });
const TOURNAMENT_EVENTS = new Set(['round_start', 'round_end', 'awaiting_next', 'lane_eliminated', 'corpse', 'tournament_end']);
const campaignResults = mountCampaignResults(stageEl, { getCampaign: () => api.getCampaign() }, { onNight: (n) => shopStart(n), onHub: () => window.dispatchEvent(new CustomEvent('haunt:splash', { detail: { action: 'campaign' } })) }); // CP-U3

function onEvent(ev: ArenaEvent) {
  if (TOURNAMENT_EVENTS.has(ev.type)) tourActive = true;
  if (ev.type === 'reset') tourActive = false;
  applyCasebookEvent(casebook, ev, performance.now());
  if ((ev.type === 'round_end' || ev.type === 'tournament_end') && ev.detail?.casebook) loadCasebook(casebook, ev.detail.casebook);
  if (ev.type === 'wave_start' || ev.type === 'reset') curseLedger = emptyCurseLedger();
  if (ev.type === 'curse_response' && typeof ev.lane === 'number' && isClass(ev.detail?.class)) countAnswer(curseLedger, ev.lane, ev.detail!.class as never);
  patternsPanel.onEvent(ev);
  roundCard.onEvent(ev);
  finalScreen.onEvent(ev);
  campaignResults.onEvent(ev);
  campaignSandbox.onEvent(ev);
  // In a tournament the standings card replaces the wave card.
  if (tourActive && ev.type === 'wave_end') waveSummary.suppressNext();
  if (tourActive && ev.type === 'round_end') waveSummary.close();
  waveSummary.onEvent(ev);
  queue.push(ev);
  captionPlayer.event(ev, performance.now());
  sound.onEvent(ev, performance.now());
  inspector.record(ev);
  tickerModel.push(ev, performance.now());
  reviewCards.onEvent(ev);
  decisionPopup.onEvent(ev);
  scoreVisuals.onEvent(ev);
  events++;
  if (typeof ev.seq === 'number') lastSeq = ev.seq;
  if (ev.type === 'intensity') {
    const next = defaultDial();
    if (applyIntensity(next, ev.detail)) dial?.adopt({ level: next.level, source: next.source, ...(typeof ev.detail?.autoRamp === 'boolean' ? { autoRamp: next.autoRamp } : {}) });
  }
  if (ev.type === 'hello') {
    mode = typeof ev.mode === 'string' ? ev.mode : mode;
    if (ev.contractVersion !== 1) errEl.textContent = 'Update the UI: the server speaks contract version ' + String(ev.contractVersion) + '.';
  } else if (ev.type === 'reset') {
    waveNo = 0; waveRunning = false; demoRunning = false; awaitingNext = false; nextBtn.classList.add('hidden');
  } else if (ev.type === 'wave_start') {
    waveNo = typeof ev.wave === 'number' ? ev.wave : waveNo + 1;
    waveRunning = true;
    awaitingNext = false; nextBtn.classList.add('hidden');
    errEl.textContent = '';
  } else if (ev.type === 'awaiting_next') {
    awaitingNext = true; waveRunning = false;
    nextBtn.textContent = '\u25B6 Next round';
    nextBtn.classList.remove('hidden');
    void reconcile();
  } else if (ev.type === 'round_start' || ev.type === 'tournament_end') {
    awaitingNext = false; nextBtn.classList.add('hidden');
  } else if (ev.type === 'wave_end') {
    waveRunning = false;
    awaitingNext = !(ev.detail && (ev.detail as { stopped?: unknown }).stopped);
    nextBtn.textContent = tourActive ? '▶ Next round' : '▶ Next wave';
    nextBtn.classList.toggle('hidden', !awaitingNext);
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
    const ds = readDial(s);
    if (ds) dial?.adopt(ds);
    const cs = readChaosState(s);
    if (cs) chaosCtl.adopt(cs);
    appSwitch?.setActive(currentApp(s));
    waveNo = s.wave?.n ?? 0;
    waveRunning = !!s.wave?.running;
    demoRunning = !!s.demo?.running;
    demoScripts = Array.isArray(s.demo?.scripts) ? s.demo.scripts : demoScripts;
    waveEl.textContent = waveLabel(waveNo);
    queue.length = 0;
    // Rounds, standings and awards for a late joiner; a server without the tournament endpoint just answers 404.
    const tour = await api.getTournament().catch(() => null);
    loadSnapshot(vm, tour ? { ...s, tournament: { ...(s.tournament ?? {}), ...(tour as object) } } : s, performance.now());
    if (vm.tournament.active) {
      tourActive = true;
      if (vm.tournament.awaitingNext) { awaitingNext = true; nextBtn.textContent = '\u25B6 Next round'; nextBtn.classList.remove('hidden'); }
      void hydrateCasebook().then(() => { roundCard.adopt(vm.tournament); finalScreen.adopt(vm.tournament); });
    }
    await reconcile();
    void patternsPanel.hydrate();
  } catch (e) { showError(e); }
  paintBadge();
  paintDemo();
}

/** Casebook and lessons for a page that loads mid-tournament (GET /api/casebook, GET /api/lessons/:lane). A server without them answers 404. */
async function hydrateCasebook() {
  try { loadCasebook(casebook, await api.getCasebook()); } catch { /* the events fill it from here */ }
  await Promise.all(vm.lanes.map((l) => api.getLessons(l.lane).then((raw) => loadLessons(casebook, l.lane, raw)).catch(() => { /* none yet */ })));
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
  let pace: Pace = DEFAULT_PACE;
  const startWave0 = api.startWave.bind(api);
  api.startWave = (o) => startWave0({ pace, ...o });
  chaosCtl = new ChaosModeControl($('chaos-mode'), { setChaosMode: (o) => api.setChaosMode(o), onError: showError });

  dial = new IntensityDial($('dial'), { setIntensity: (level, o) => api.setIntensity(level, o).then((st) => { const ds = readDial({ intensity: st as never }); if (ds) dial?.adopt(ds); return st; }), onError: showError });
  new GearMenu($<HTMLButtonElement>('gear-btn'), $('gear-wrap'), $('pace-tag'), {
    setPace: (p) => { pace = p; },
    setSpeed: (s) => { void api.setSpeed(s).catch(showError); },
    toggleSound: () => muteBtn.click(),
    startTournament: () => { void beginTournament(); },
    resetLessons: () => { void api.resetLessons().then(() => { casebook.lessons = {}; casebook.learnedAt = {}; }).catch(showError); },
    setReducedMotion: (on) => { scene.reducedMotion = on || reduceMotion.matches; document.body.classList.toggle('reduced-motion', on || reduceMotion.matches); },
  }, $('chaos-mode'));
  new LegendModal(stageEl, $<HTMLButtonElement>('legend-btn'));

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
    if (!chainDemo || awaitingNext || performance.now() - lastDemoStart < 6000) return;
    try {
      const s = await api.getState();
      if (s.demo?.running || s.wave?.running) return;
      const next = pickScript(currentScript, Array.isArray(s.demo?.scripts) ? s.demo.scripts : demoScripts);
      if (next) void startDemo(next);
    } catch { /* retry on the next tick */ }
  }, 3000);
}

// Start tournament (TV3-U8): five lanes, the worst drops each round. Clears whatever plays behind the splash first.
async function beginTournament() {
  errEl.textContent = '';
  try {
    chainDemo = false; captionPlayer.stop();
    if (demoRunning) { await api.stopDemo(); demoRunning = false; paintDemo(); }
    if (waveRunning) { try { await api.stopWave(); } catch { /* none running */ } waveRunning = false; }
    waveSummary.suppressNext();
    await api.startTournament();
    tourActive = true;
  } catch (e) { showError(e); }
}
$('tour-big').addEventListener('click', () => void beginTournament());

// Next wave (TV3-U2) and next round (TV3-U8): the only thing that starts the next one after a review.
async function goNext() {
  if (!awaitingNext) return;
  awaitingNext = false; nextBtn.classList.add('hidden');
  try {
    if (tourActive) { await api.next(); return; }
    if (chainDemo) {
      const s = await api.getState();
      const next = pickScript(currentScript, Array.isArray(s.demo?.scripts) ? s.demo.scripts : demoScripts);
      if (next) { void startDemo(next); return; }
    }
    await api.startWave();
  } catch (e) { showError(e); }
}
nextBtn.addEventListener('click', () => void goNext());
window.addEventListener('keydown', (e) => {
  if (!awaitingNext || !isNextKey({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, targetTag: (e.target as HTMLElement | null)?.tagName, editable: (e.target as HTMLElement | null)?.isContentEditable })) return;
  if (document.querySelector('dialog[open], .lp-dlg:not(.hidden)')) return;
  e.preventDefault(); void goNext();
});

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
    placeOverlays(document.body.classList.contains('narrow'));
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

// Fixed 1920x1080 design stage, scaled uniformly to fit and centred (letterboxed). On narrow or portrait viewports the arena
// band is fitted to the width and the header and panels move out of the scaled stage into a normal scrolling flow below it.
// The canvas backing store stays at design size; all drawing uses design pixels.
const NARROW_IDS = ['rank', 'ledger', 'ticker', 'quiet', 'insp', 'keys-pop'];
const flowEl = document.createElement('div');
flowEl.id = 'flow';
const bandEl = document.createElement('div');
bandEl.id = 'arena-band';
const moved = new Map<HTMLElement, Comment>();
// The splash covers the whole screen in design pixels; on a phone it is hoisted out of the scaled stage so it can be real-sized.
function placeOverlays(on: boolean) {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.splash'))) {
    const to = on ? root : stageEl;
    if (el.parentElement !== to) to.appendChild(el);
  }
}
function setNarrow(on: boolean) {
  document.body.classList.toggle('narrow', on);
  placeOverlays(on);
  if (on === (moved.size > 0)) return;
  if (on) {
    const hdr = stageEl.querySelector<HTMLElement>('.hdr')!;
    const els = Object.fromEntries(NARROW_IDS.map((id) => [id, $(id)]));
    for (const el of [hdr, ...Object.values(els)]) { const ph = document.createComment(el.id || 'hdr'); el.replaceWith(ph); moved.set(el, ph); }
    stageEl.replaceWith(bandEl);
    bandEl.appendChild(stageEl);
    root.appendChild(flowEl);
    flowEl.append(hdr, bandEl, els['quiet']!, els['rank']!, els['ledger']!, els['ticker']!, els['insp']!, els['keys-pop']!);
  } else {
    for (const [el, ph] of moved) ph.replaceWith(el);
    moved.clear();
    flowEl.remove();
    root.appendChild(stageEl);
    bandEl.remove();
  }
}
function fit() {
  const footEl = document.getElementById('hosted-badge');
  document.body.style.setProperty('--foot', `${footEl ? footEl.offsetHeight : 0}px`);
  const w = root.clientWidth, h = root.clientHeight;
  const f = computeFit(w, h);
  setNarrow(f.narrow);
  if (f.narrow) bandEl.style.height = `${f.bandH}px`;
  stageEl.style.transform = `translate(${f.left}px, ${f.top}px) scale(${f.scale})`;
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
  roundInd.update(vm.tournament);
  document.body.classList.toggle('tour-on', vm.tournament.active && vm.tournament.round > 0);
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
  scoreVisuals.ensure(vm.lanes.map((l) => l.lane));
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

// Dev and screenshot hook: __arena.inject(event) feeds one event through the normal pipeline (no server needed).
(window as unknown as { __arena?: unknown }).__arena = { vm, inject: (ev: Partial<ArenaEvent> & { type: string }) => onEvent({ seq: ++lastSeq, ts: Date.now(), ...ev } as ArenaEvent) };
