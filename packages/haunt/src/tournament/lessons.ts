// Lessons ledger (spec 4): what a lane learned, as a policy overlay limited to what its tier's parts allow.
// `learnRound` is pure; `LessonsStore` keeps `<dir>/<lane>.json` and the overlay file `<dir>/lane-<lane>.policy.json` the bot reads.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIERS, type TierId } from '../shared/catalog';
import { ACTION_PARTS, actionsFor, type Policy, type PolicyAction, type PolicyRule } from '../sdk/policy';
import type { Case, Mechanism } from './signature';

export interface Lesson {
  signature: string;
  stage: string;
  fault: string;
  /** What worked (`overcame`) or what the reviewer rule proposes (`suggested`). */
  mechanism: string;
  action?: PolicyAction;
  via: 'overcame' | 'suggested';
  learnedRound: number;
  /** In the overlay the bot reads from the next round on. */
  applied: boolean;
  rule?: PolicyRule;
}

/** A loss the tier cannot fix with its parts: it becomes a spec suggestion (section 8) instead of a lesson. */
export interface Suggestion {
  signature: string;
  stage: string;
  fault: string;
  action: PolicyAction;
  /** The part that would allow it, as the reviewer rule names it. */
  part: string;
  rule: string;
  round: number;
}

export interface LaneLessons {
  lane: number;
  tier: TierId;
  lessons: Lesson[];
  suggestions: Suggestion[];
  /** Signatures this lane has overcome at least once (the +25 bonus is for the first time only). */
  overcame: string[];
}

export const emptyLessons = (lane: number, tier: TierId): LaneLessons => ({ lane, tier, lessons: [], suggestions: [], overcame: [] });

const MECH_ACTION: Partial<Record<Mechanism, PolicyAction>> = {
  retry: 'retry_backoff', retry_backoff: 'retry_backoff', journal_replay: 'journal_replay', idempotency_key: 'idempotency_key',
  reconcile: 'idempotency_key', breaker: 'breaker_park', queue: 'breaker_park',
};

const TRANSIENT = new Set(['timeout', 'comm_timeout', 'slow_link', 'http_404', 'http_429', 'http_500', 'endpoint_down', 'internet_outage', 'sms_down', 'app_down', 'updates_down']);

/** The reviewer rules of reviewer/rules.ts as the proposals for a lost case: R1 repeated effect -> idempotency, R2 retryable error ended the order -> retry, R3/R4 -> breaker and queue. */
export function suggestionFor(c: Pick<Case, 'fault' | 'consequence'>): { action: PolicyAction; part: string; rule: string } | null {
  if (c.consequence === 'duplicate_effect') return { action: 'idempotency_key', part: 'idempotency', rule: 'R1' };
  if (c.consequence === 'lane_halted') return { action: 'breaker_park', part: 'offline_queue', rule: 'R4' };
  if (c.consequence === 'order_lost' || c.consequence === 'order_quarantined') {
    if (TRANSIENT.has(c.fault)) return { action: 'retry_backoff', part: 'retry', rule: 'R2' };
    if (c.fault === 'crash' || c.fault === 'power_outage' || c.fault === 'out_of_memory') return { action: 'journal_replay', part: 'journal', rule: 'R7' };
    return { action: 'breaker_park', part: 'offline_queue', rule: 'R3' };
  }
  return null;
}

function ruleFor(c: Case, action: PolicyAction): PolicyRule {
  const r: PolicyRule = { stage: c.stage, fault: c.fault, action };
  if (action === 'retry_backoff') { r.backoff = 'exp'; r.maxAttempts = 5; }
  if (action === 'idempotency_key') r.key = 'order-id';
  return r;
}

export interface LearnResult { next: LaneLessons; newLessons: Lesson[]; newSuggestions: Suggestion[]; firstOvercome: string[] }

/**
 * What a lane learns from its cases of a round. Overcame (recovered, no repeat, a mechanism used) becomes a lesson and earns the
 * first-time bonus. Lost or partly solved cases take the reviewer rule's proposal: a lesson (`suggested`) if the tier's parts allow the
 * action, else a spec suggestion. Anything already known is skipped.
 */
export function learnRound(prev: LaneLessons, cases: readonly Case[], round: number): LearnResult {
  const can = new Set(actionsFor(TIERS[prev.tier].parts));
  const known = new Set(prev.lessons.map((l) => l.signature));
  const sug = new Set(prev.suggestions.map((s) => s.signature));
  const overcame = new Set(prev.overcame);
  const next: LaneLessons = { ...prev, lessons: [...prev.lessons], suggestions: [...prev.suggestions], overcame: [...prev.overcame] };
  const newLessons: Lesson[] = [];
  const newSuggestions: Suggestion[] = [];
  const firstOvercome: string[] = [];
  for (const c of cases) {
    if (c.outcome === 'solved' && c.mechanism !== 'absorbed' && c.mechanism !== 'none') {
      if (!overcame.has(c.signature)) { overcame.add(c.signature); next.overcame.push(c.signature); firstOvercome.push(c.signature); }
      if (known.has(c.signature)) continue;
      const action = MECH_ACTION[c.mechanism];
      const lesson: Lesson = { signature: c.signature, stage: c.stage, fault: c.fault, mechanism: c.mechanism, ...(action && can.has(action) ? { action, rule: ruleFor(c, action) } : {}), via: 'overcame', learnedRound: round, applied: false };
      known.add(c.signature); next.lessons.push(lesson); newLessons.push(lesson);
    } else if (c.outcome !== 'solved') {
      if (known.has(c.signature) || sug.has(c.signature)) continue;
      const s = suggestionFor(c);
      if (!s) continue;
      if (can.has(s.action)) {
        const lesson: Lesson = { signature: c.signature, stage: c.stage, fault: c.fault, mechanism: s.action, action: s.action, rule: ruleFor(c, s.action), via: 'suggested', learnedRound: round, applied: false };
        known.add(c.signature); next.lessons.push(lesson); newLessons.push(lesson);
      } else {
        const sg: Suggestion = { signature: c.signature, stage: c.stage, fault: c.fault, action: s.action, part: s.part, rule: s.rule, round };
        sug.add(c.signature); next.suggestions.push(sg); newSuggestions.push(sg);
      }
    }
  }
  return { next, newLessons, newSuggestions, firstOvercome };
}

/** The overlay the bot reads: every lesson with an enforceable action. Lessons learned this round apply from the next round. */
export function policyOf(l: LaneLessons, round?: number): Policy {
  const rules = l.lessons.filter((x) => x.rule && x.action && (round === undefined || x.learnedRound < round)).map((x) => x.rule!);
  return { version: 1, rules };
}

/** The `lesson` event of V1_2 section 5. */
export const lessonEvent = (lane: number, l: Lesson): { type: 'lesson'; lane: number; stage: string; detail: Record<string, unknown> } => ({
  type: 'lesson', lane, stage: l.stage, detail: { lane, signature: l.signature, mechanism: l.mechanism, round: l.learnedRound, via: l.via, ...(l.action ? { action: l.action } : {}) },
});

// ------------------------------------------------------------------------------------------------------------------ store

export class LessonsStore {
  constructor(readonly dir: string) {}

  private file(lane: number): string { return join(this.dir, `${lane}.json`); }
  policyFile(lane: number): string { return join(this.dir, `lane-${lane}.policy.json`); }

  get(lane: number, tier: TierId): LaneLessons {
    try {
      const raw = JSON.parse(readFileSync(this.file(lane), 'utf8')) as Partial<LaneLessons>;
      return { lane, tier, lessons: raw.lessons ?? [], suggestions: raw.suggestions ?? [], overcame: raw.overcame ?? [] };
    } catch { return emptyLessons(lane, tier); }
  }

  save(l: LaneLessons): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(l.lane), JSON.stringify(l, null, 2) + '\n');
  }

  /** Write the overlay for the next round: lessons learned up to and including `round - 1`. An empty overlay removes the file. */
  writePolicy(l: LaneLessons, round?: number): Policy {
    const p = policyOf(l, round);
    mkdirSync(this.dir, { recursive: true });
    if (p.rules.length) writeFileSync(this.policyFile(l.lane), JSON.stringify(p, null, 2) + '\n');
    else rmSync(this.policyFile(l.lane), { force: true });
    return p;
  }

  /** Learn from a round, save, and return what is new. */
  learn(lane: number, tier: TierId, cases: readonly Case[], round: number): LearnResult {
    const r = learnRound(this.get(lane, tier), cases, round);
    this.save(r.next);
    return r;
  }

  lanes(): number[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter((x): x is string => !!x).map(Number).sort((a, b) => a - b);
  }

  /** `DELETE /api/lessons`: forget everything. */
  reset(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export { ACTION_PARTS };
