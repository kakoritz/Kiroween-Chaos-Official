// Hosted demo, recorded runs (ON-C1). The in-page engine has no tournament, Casebook, lessons, patterns or improve loop,
// so the hosted page replays event streams recorded from a real run of the live server (site/recorded/*.json, made by
// tools/record-hosted.mjs): one 4-round tournament and one improve loop. Replay goes through the same Hub as every other
// in-page wave, so the arena, Casebook and Patterns panel fill exactly as they do against a server.
// Honest by construction: the page labels all of it "Recorded run"; nothing here claims to be live.
import { TIER_ORDER } from '@haunt/shared';
import { Player } from '../../../core/src/mock/play';
import type { Hub } from '../../../core/src/mock/hub';
import { campaignFixture } from '../../../core/mock/campaign-fixtures-core';
import type { HauntInPage } from '../api';

type Ev = { type: string; ts: number; wave?: number; lane?: number; detail?: any; [k: string]: any };
interface TournamentRec { app?: string; events: Ev[]; tournament: any; casebook: any; patterns: any; lessons: Record<string, any> }
interface ImproveRec { events: Ev[]; phases: { atMs: number; state: any }[]; final: any; patterns: any }

export type Loader = (name: string) => Promise<any>;

/** Apps that have their own recorded tournament (site/recorded/tournament-<app>.json, made by tools/record-app.mjs). Others replay the Orders run. */
export const RECORDED_TOURNAMENT_APPS: readonly string[] = ['playback'];

/** Default loader: the JSON sits beside the page (./recorded/NAME.json), so it works under any base path such as /Kiroween-Chaos/. */
export const fetchRecorded: Loader = async (name) => {
  const url = new URL(`./recorded/${name}.json`, document.baseURI);
  const res = await fetch(url);
  if (!res.ok) throw { code: 'not_ready', message: `recorded run ${name} is missing` };
  return res.json();
};

/** Squeeze the recorded clock: long waits (the real run waited on real bots) are capped so a replay stays watchable. */
export function compressTs(events: Ev[], capMs = 1200): Ev[] {
  let t = events[0]?.ts ?? 0;
  let prev = t;
  return events.map((e) => { t += Math.min(Math.max(0, e.ts - prev), capMs); prev = e.ts; return { ...e, ts: t }; });
}

/** Cut a stream into one segment per wave (by the recorded wave number), keeping the order of appearance. */
export function segmentsByWave(events: Ev[]): Ev[][] {
  const out: Ev[][] = [];
  let cur: Ev[] = [];
  let curWave: number | undefined;
  for (const e of events) {
    if (e.type === 'wave_start' && curWave !== undefined && curWave !== e.wave) { out.push(cur); cur = []; }
    if (e.type === 'wave_start') curWave = e.wave;
    cur.push(e);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Cut the tournament stream at each awaiting_next (the player presses Next for the following round). */
export function segmentsByRound(events: Ev[]): Ev[][] {
  const out: Ev[][] = [];
  let cur: Ev[] = [];
  for (const e of events) { cur.push(e); if (e.type === 'awaiting_next') { out.push(cur); cur = []; } }
  if (cur.length) out.push(cur);
  return out;
}

const reject = (code: string, message: string): Promise<never> => Promise.reject({ code, message });

/** Add the server-only calls to the in-page facade, backed by recordings. Returns the same object. */
export function addRecordedRuns(facade: HauntInPage, hub: Hub, load: Loader = fetchRecorded): HauntInPage {
  const f = facade as any;
  const player = new Player(hub);
  const cache = new Map<string, Promise<any>>();
  const rec = <T>(name: string): Promise<T> => {
    if (!cache.has(name)) cache.set(name, load(name).catch((e) => { cache.delete(name); throw e; }));
    return cache.get(name)!;
  };
  let tour: { segs: Ev[][]; idx: number; rec: TournamentRec } | undefined;
  let improve: { rec: ImproveRec; startedAt: number; segs: Ev[][]; token: number } | undefined;
  let token = 0;

  const baseStop = f.stopWave.bind(f);
  const stopAll = async () => { token++; player.clear(); improve = improve && { ...improve, token: -1 }; return baseStop(); };
  f.stopWave = stopAll;
  f.stopDemo = stopAll;
  const baseStartDemo = f.startDemo.bind(f);
  f.startDemo = async (script: string, speed?: number) => { token++; player.clear(); return baseStartDemo(script, speed); };

  /** The tournament and improve recordings are orders-app runs: leave the inbox skin first so stages, ledger and ticker agree. */
  const useOrders = () => { if (hub.app !== 'orders') hub.app = 'orders'; };
  const playRound = () => {
    const t = tour!;
    hub.awaitingNext = false;
    player.play(t.segs[t.idx++]!.map((e) => ({ ...e })) as never, ++hub.waveNo, { speed: 2, script: 'tournament' });
  };

  let campaignData: any;
  const baseStartWave = f.startWave.bind(f);
  f.getCampaign = async () => (campaignData ??= await rec('campaign'));
  f.startWave = async (o: Record<string, any> = {}) => {
    if (o.campaign === undefined) return baseStartWave(o);
    if (hub.running) return reject('wave_running', 'a wave is already running');
    const data = await f.getCampaign();
    const req = { night: Number(o.campaign?.night), parts: Array.isArray(o.campaign?.parts) ? o.campaign.parts : [] };
    if (!data.nights.some((n: any) => n.id === req.night)) return reject('bad_request', 'unknown night');
    const app = data.nights.find((n: any) => n.id === req.night)?.app ?? 'orders';
    if (app !== hub.app) { hub.app = app; hub.reset(); }
    token++; player.clear();
    player.play(campaignFixture(req.night, req.parts, data) as never, ++hub.waveNo, { speed: o.speed ?? hub.speed });
    return { wave: hub.waveNo };
  };

  f.startTournament = async () => {
    if (hub.running && player.active) return reject('wave_running', 'a wave is already running');
    const own = RECORDED_TOURNAMENT_APPS.includes(hub.app) ? `tournament-${hub.app}` : 'tournament';
    const r = await rec<TournamentRec>(own).catch(() => rec<TournamentRec>('tournament'));
    token++; player.clear();
    hub.app = r.app ?? 'orders';
    hub.reset();
    tour = { segs: segmentsByRound(compressTs(r.events)), idx: 0, rec: r };
    playRound();
    return { tournament: true, round: 1, wave: hub.waveNo };
  };
  f.next = async () => {
    if (!tour || !hub.awaitingNext || tour.idx >= tour.segs.length) return reject('not_awaiting_next', 'no round is waiting for Next');
    playRound();
    return { round: tour.idx, wave: hub.waveNo };
  };
  f.getTournament = async () => {
    if (!hub.tournament) return { phase: 'idle' };
    if (hub.tournament.phase === 'done' && tour) return { ...tour.rec.tournament, wave: hub.waveNo };
    const rounds = hub.buffer.filter((e) => e.type === 'round_end').map((e) => e.detail);
    return { ...hub.tournament, history: rounds, standings: (rounds.at(-1) as { standings?: unknown } | undefined)?.standings ?? [], corpses: [...hub.corpses] };
  };
  f.getCasebook = async () => {
    const last = [...hub.buffer].reverse().find((e) => e.type === 'tournament_end' || e.type === 'round_end');
    const d = (last?.detail ?? {}) as { casebook?: object; awards?: unknown };
    return last ? { ...(d.casebook ?? {}), awards: d.awards ?? [] } : { rounds: 0, cases: [], open: [], awards: [], note: 'No tournament yet.' };
  };
  f.getLessons = async (lane: number) => {
    const lessons = hub.lessons.get(lane) ?? [];
    return { lane, tier: TIER_ORDER[lane - 1], lessons, suggestions: [], overcame: [], policy: { version: 1, rules: [] } };
  };
  f.resetLessons = async () => { hub.lessons.clear(); return {}; };
  f.getPatterns = async () => {
    const all = [...hub.patterns.values()];
    return { thresholds: { count: 3, lostOrders: 1, downtimeMs: 30000 }, patterns: all, qualifying: all.filter((p: any) => p.qualifies).length };
  };

  // Improve loop: the three recorded waves (run, rerun, compare) play back to back; the phase follows the replay clock.
  const playNext = (im: NonNullable<typeof improve>, i: number) => {
    if (im.token !== token || i >= im.segs.length) return;
    player.play(im.segs[i]!.map((e) => ({ ...e })) as never, ++hub.waveNo, { speed: 2, script: 'improve' });
    const wait = () => { if (im.token !== token) return; if (player.active) setTimeout(wait, 150); else setTimeout(() => playNext(im, i + 1), 400); };
    setTimeout(wait, 150);
  };
  f.startImprove = async () => {
    if (hub.running && player.active) return reject('wave_running', 'a wave is already running');
    const r = await rec<ImproveRec>('improve');
    const keep = new Map(hub.patterns);
    token++; player.clear();
    useOrders();
    hub.reset();
    for (const [k, v] of keep) hub.patterns.set(k, v);
    improve = { rec: r, startedAt: Date.now(), segs: segmentsByWave(compressTs(r.events)), token };
    playNext(improve, 0);
    return { improve: 'recorded', phase: 'before' };
  };
  f.getImprove = async () => {
    if (!improve) return { phase: 'idle' };
    const total = improve.segs.length;
    const doneWaves = hub.waves.filter((w) => w.endedAt !== undefined).length;
    const finished = !player.active && improve.token === token && doneWaves >= total;
    const { final } = improve.rec;
    if (finished) return { ...final, id: 'recorded', phase: 'done', startedAt: improve.startedAt };
    // before = the first wave, after = the rerun, then compare until the last wave has ended.
    const phase = doneWaves === 0 ? 'before' : 'after';
    return { id: 'recorded', phase, startedAt: improve.startedAt, request: final?.request ?? {} };
  };
  f.writeSpecs = async () => improve?.rec.final?.spec ?? {};
  return facade;
}

