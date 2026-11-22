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

/** The retry_backoff rule that answers a failed call at `stage`, if the bot has learned one. */
export function backoffRule(policy: Policy | undefined, stage: string, status: number | null, message: string): PolicyRule | undefined {
  return policy?.rules.find((r) => r.action === 'retry_backoff' && (r.stage === stage || r.stage === '*') && faultMatches(r.fault, status, message));
}

export function parsePolicy(raw: unknown): Policy {
  const p = raw as Partial<Policy> | null;
  if (!p || p.version !== 1 || !Array.isArray(p.rules)) return { ...EMPTY_POLICY, rules: [] };
  const rules = p.rules.filter((r): r is PolicyRule => !!r && typeof r.stage === 'string' && typeof r.fault === 'string' && typeof r.action === 'string' && r.action in ACTION_PARTS);
  return { version: 1, rules };
}
