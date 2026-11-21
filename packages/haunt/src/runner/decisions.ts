// Runner side of the wrong-order decision (playtest-v2 design.md section 8, contract V1_1 section 7).
// The bot asks with `{k:'decision_needed'}`; the broker emits `decision_needed`, waits for `POST /api/decision` or the
// timeout, emits `decision_made` once and answers. A bot that restarts while the decision is pending asks again: the
// broker hands it the same decision and emits nothing new (P18).
import { DECISION_CHOICES, DECISION_TIMEOUT_MS, type DecisionChoice } from '../shared/catalog';

export type DecisionSource = 'user' | 'default' | 'timeout';
export type DetectedAt = 'confirmation' | 'handoff';

/** What the bot sent. */
export interface DecisionAsk {
  order: string;
  detectedAt: DetectedAt;
  defaultChoice: DecisionChoice;
}

export interface DecisionAnswer {
  choice: DecisionChoice;
  source: DecisionSource;
}

export interface DecisionEvent {
  type: 'decision_needed' | 'decision_made';
  order: string;
  detail: Record<string, unknown>;
}

export interface DecisionBrokerOptions {
  /** Where `decision_needed` and `decision_made` go: the lane's event stream. */
  emit(lane: string, ev: DecisionEvent): void;
  /** Real ms to wait for a user before the bot's default applies. Zero or less decides at once with source `default`. */
  timeoutMs(): number;
  /** Runs once per decision, after `decision_made` and before the bot hears the answer (a redo restores the order file). */
  onResolved?(lane: string, order: string, answer: DecisionAnswer): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

interface Entry {
  ask: DecisionAsk;
  timeoutMs: number;
  expiresAt: number;
  answer?: DecisionAnswer;
  delivered: boolean;
  waiters: ((a: DecisionAnswer) => void)[];
  timer?: unknown;
}

export const DECISION_OPTIONS: readonly DecisionChoice[] = DECISION_CHOICES;

export type AnswerResult = 'ok' | 'no_decision' | 'bad_choice';

export class DecisionBroker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly o: DecisionBrokerOptions) {}

  private static key(lane: string, order: string): string {
    return `${lane}|${order}`;
  }

  /** A decision of the lane waits for an answer. */
  pending(lane: string, order?: string): { order: string; options: readonly DecisionChoice[]; timeoutMs: number; expiresAt: number } | null {
    for (const [k, e] of this.entries) {
      if (e.answer || !k.startsWith(`${lane}|`)) continue;
      if (order !== undefined && e.ask.order !== order) continue;
      return { order: e.ask.order, options: DECISION_OPTIONS, timeoutMs: e.timeoutMs, expiresAt: e.expiresAt };
    }
    return null;
  }

  /**
   * The bot asks. `alive` says whether the asking process can still hear the answer; an answer nobody heard stays
   * on offer for the bot that restarts and asks again. Resolves with the one decision of this wrong order.
   */
  ask(lane: string, ask: DecisionAsk, alive: () => boolean = () => true): Promise<DecisionAnswer> {
    const key = DecisionBroker.key(lane, ask.order);
    const prior = this.entries.get(key);
    if (prior && (!prior.answer || !prior.delivered)) {
      // A restart asking again: same decision, no new events.
      return this.wait(prior, alive);
    }
    const timeoutMs = Math.max(1, Math.round(this.o.timeoutMs() > 0 ? this.o.timeoutMs() : DECISION_TIMEOUT_MS));
    const e: Entry = { ask, timeoutMs, expiresAt: Date.now() + timeoutMs, delivered: false, waiters: [] };
    this.entries.set(key, e);
    this.o.emit(lane, {
      type: 'decision_needed', order: ask.order,
      detail: { order: ask.order, kind: 'wrong_order', detectedAt: ask.detectedAt, options: [...DECISION_OPTIONS], defaultChoice: ask.defaultChoice, timeoutMs },
    });
    const wait = this.o.timeoutMs();
    if (wait <= 0) this.resolve(lane, e, { choice: ask.defaultChoice, source: 'default' });
    else e.timer = (this.o.setTimer ?? setTimeout)(() => this.resolve(lane, e, { choice: ask.defaultChoice, source: 'timeout' }), wait);
    return this.wait(e, alive);
  }

  /** `POST /api/decision`: the user chose. */
  answer(lane: string, order: string, choice: string): AnswerResult {
    const e = this.entries.get(DecisionBroker.key(lane, order));
    if (!e || e.answer) return 'no_decision';
    const c = DECISION_CHOICES.find((x) => x === choice);
    if (!c) return 'bad_choice';
    this.resolve(lane, e, { choice: c, source: 'user' });
    return 'ok';
  }

  /** Wave over: drop every decision and timer. */
  clear(): void {
    for (const e of this.entries.values()) if (e.timer !== undefined) (this.o.clearTimer ?? clearTimeout)(e.timer as never);
    this.entries.clear();
  }

  private wait(e: Entry, alive: () => boolean): Promise<DecisionAnswer> {
    return new Promise((res) => {
      const deliver = (a: DecisionAnswer): void => {
        if (alive()) e.delivered = true;
        res(a);
      };
      if (e.answer) deliver(e.answer);
      else e.waiters.push(deliver);
    });
  }

  private resolve(lane: string, e: Entry, a: DecisionAnswer): void {
    if (e.answer) return;
    e.answer = a;
    if (e.timer !== undefined) (this.o.clearTimer ?? clearTimeout)(e.timer as never);
    e.timer = undefined;
    this.o.emit(lane, { type: 'decision_made', order: e.ask.order, detail: { order: e.ask.order, choice: a.choice, source: a.source } });
    this.o.onResolved?.(lane, e.ask.order, a);
    const waiters = e.waiters;
    e.waiters = [];
    for (const w of waiters) w(a);
  }
}

/** Validates the bot's `{k:'decision_needed'}` line. */
export function parseAsk(msg: Record<string, unknown>): DecisionAsk | null {
  if (typeof msg.order !== 'string' || msg.order === '') return null;
  const defaultChoice = DECISION_CHOICES.find((c) => c === msg.defaultChoice) ?? 'refund';
  return { order: msg.order, detectedAt: msg.detectedAt === 'handoff' ? 'handoff' : 'confirmation', defaultChoice };
}
