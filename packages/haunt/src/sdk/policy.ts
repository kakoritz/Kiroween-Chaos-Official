// `haunt.policy`: the policy overlay a bot reads at start (spec 4, V1_2 section 5). A lesson is a small table, not code:
// it only switches on behavior the bot's own parts already allow (a Rookie has no `retry` part, so it can learn nothing).

export type PolicyAction = 'retry_backoff' | 'idempotency_key' | 'journal_replay' | 'breaker_park' | 'hold_and_reroute';

/** What each action needs from the bot's parts. */
export const ACTION_PARTS: Readonly<Record<PolicyAction, readonly string[]>> = {
  retry_backoff: ['retry'],
  journal_replay: ['journal'],
  idempotency_key: ['idempotency'],
  breaker_park: ['breaker', 'offline_queue'],
  hold_and_reroute: ['offline_queue'],
};

/**
 * The actions the SDK enforces. Each one is a lever a tier's own parts leave switched off until a lesson turns it on for a stage:
 * - retry_backoff: retry that stage with exponential backoff (more attempts, growing waits) for any transient failure; also read by the transit poll and the handoff.
 * - idempotency_key: an effect of that stage the bot sent without a key gets one derived from the order (needs the `idempotency` part), so a repeat is found, not redone.
 * - journal_replay: when that stage ends in a failure the retries could not beat, replay the order from the journal after a cool-down instead of failing it (needs `journal`).
 * - breaker_park: that stage trips the breaker after two failed attempts instead of four, and the order is parked and resumed when the breaker closes (needs `breaker` and `offline_queue`).
 * `hold_and_reroute` is recorded and shown only.
 */
export const ENFORCED_ACTIONS: readonly PolicyAction[] = ['retry_backoff', 'idempotency_key', 'journal_replay', 'breaker_park'];

export interface PolicyRule {
  stage: string;
  /** The fault the rule answers: `timeout`, `endpoint_down`, `http_500`, ... or `*`. */
  fault: string;
  action: PolicyAction;
  /** retry_backoff: exponential, attempts including the first call. */
  backoff?: 'exp';
  maxAttempts?: number;
  key?: 'order-id';
}

export interface Policy { version: 1; rules: PolicyRule[] }

export const EMPTY_POLICY: Policy = { version: 1, rules: [] };

/** The actions a bot with these parts can learn. Rookie none, Retrier retry, Journaler retry and journal, Reconciler adds idempotency, Phoenix all. */
/** Does a policy overlay change what a bot with these parts does? Only an enforced action does, and a breaker bot already backs off on its own. */
export function policyTakes(parts: readonly string[], action: PolicyAction): boolean {
  if (!ENFORCED_ACTIONS.includes(action) || !actionsFor(parts).includes(action)) return false;
  return !(action === 'retry_backoff' && parts.includes('breaker'));
}

export function actionsFor(parts: readonly string[]): PolicyAction[] {
  const have = new Set(parts);
  return (Object.keys(ACTION_PARTS) as PolicyAction[]).filter((a) => ACTION_PARTS[a].every((p) => have.has(p)));
}

/** Does a rule's fault answer this failed call? Status and message are all the bot sees. */
export function faultMatches(fault: string, status: number | null, message: string): boolean {
  if (fault === '*') return true;
  const m = message.toLowerCase();
  switch (fault) {
    case 'timeout': case 'comm_timeout': case 'slow_link': return status === null && /timeout|timed out|abort/.test(m) || status === 408 || status === 504;
    case 'endpoint_down': case 'internet_outage': case 'sms_down': case 'app_down': case 'updates_down': return status === null || status === 503 || status === 502;
    case 'http_404': return status === 404;
    case 'http_429': return status === 429;
    case 'http_500': return status !== null && status >= 500;
    default: return true;
  }
}

/** A failure worth waiting out: no answer, not found yet, a timeout, a rate limit or a server error. A 400, 401, 403 or 409 will not change by waiting. */
export function isTransient(status: number | null): boolean {
  return status === null || status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * The rule of `action` that answers a failed call at `stage`, if the bot has learned one. A lesson is about the stage, not the exact status: it was taught by
 * one fault (a 404, say) but the same stage fails as a 429 or a 500 in the next round, so any transient failure of the stage matches.
 * Without a failed call (`status` undefined) a rule matches by stage alone.
 */
export function ruleFor(policy: Policy | undefined, action: PolicyAction, stage: string, status?: number | null, message = ''): PolicyRule | undefined {
  return policy?.rules.find((r) => r.action === action && (r.stage === stage || r.stage === '*') && (status === undefined || (isTransient(status) && r.fault !== 'crash') || faultMatches(r.fault, status, message)));
}

/** The retry_backoff rule that answers a failed call at `stage`, if the bot has learned one. */
export function backoffRule(policy: Policy | undefined, stage: string, status: number | null, message: string): PolicyRule | undefined {
  return ruleFor(policy, 'retry_backoff', stage, status, message);
}

export function parsePolicy(raw: unknown): Policy {
  const p = raw as Partial<Policy> | null;
  if (!p || p.version !== 1 || !Array.isArray(p.rules)) return { ...EMPTY_POLICY, rules: [] };
  const rules = p.rules.filter((r): r is PolicyRule => !!r && typeof r.stage === 'string' && typeof r.fault === 'string' && typeof r.action === 'string' && r.action in ACTION_PARTS);
  return { version: 1, rules };
}
