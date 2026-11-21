// The Crew bot's parts (CP-C2). Spec: .kiro/specs/campaign/spec.md section 4 requirements 2 and 3.
// The Crew is lane 1 of a campaign night: the same pipeline as the five tiers, with the parts the player equipped.
// The runner passes them as `HAUNT_PARTS`. Idempotency keys flow only when `idempotency` is in the list (the pipeline
// reads `use`), so a Crew without a Seal sends no keys.
import { PARTS, type Part } from '../sdk';
import type { BotDef } from '../bot/runtime';

export const CREW_TIER_ID = 'crew' as const;
export const CREW_LABEL = 'Your Crew';
export const PARTS_ENV = 'HAUNT_PARTS';

/** Gear badge letters (R J I B Q) to part ids. Same letters as `gear.json`. */
export const BADGE_PART: Record<string, Part> = { R: 'retry', J: 'journal', I: 'idempotency', B: 'breaker', Q: 'offline_queue' };

/**
 * Parses a parts list: ids or badge letters, separated by commas, spaces, `+` or `|` ("retry,journal", "R J I", "JI").
 * A JSON array of ids also works. The result is unique and in the canonical `PARTS` order. Throws on an unknown token.
 */
export function parseCrewParts(raw: string | readonly string[] | undefined | null): Part[] {
  if (raw === undefined || raw === null) return [];
  let tokens: string[];
  if (typeof raw !== 'string') tokens = [...raw];
  else if (raw.trim().startsWith('[')) tokens = (JSON.parse(raw) as unknown[]).map(String);
  else tokens = raw.split(/[\s,+|]+/).filter(Boolean);
  const out = new Set<Part>();
  for (const tok of tokens) {
    const t = tok.trim();
    if (!t) continue;
    if ((PARTS as readonly string[]).includes(t)) { out.add(t as Part); continue; }
    // A run of badge letters such as "JI" is allowed; any other token is an error.
    const letters = [...t.toUpperCase()];
    if (letters.length > 0 && letters.every((c) => c in BADGE_PART)) { for (const c of letters) out.add(BADGE_PART[c]!); continue; }
    throw new Error(`unknown part ${JSON.stringify(t)}`);
  }
  return PARTS.filter((p) => out.has(p));
}

/** Parts from `HAUNT_PARTS`. Unset or empty means a bare Crew with no parts. */
export function crewPartsFromEnv(env: Record<string, string | undefined> = process.env): Part[] {
  return parseCrewParts(env[PARTS_ENV]);
}

/** Options for `defineBot` in `apps/haunted-orders/src/bots/crew.ts`. */
export function crewBotOptions(env: Record<string, string | undefined> = process.env): BotDef {
  return { tier: CREW_TIER_ID, use: crewPartsFromEnv(env) };
}

/** Value for `HAUNT_PARTS`. */
export function crewPartsEnv(parts: readonly Part[]): string {
  return PARTS.filter((p) => parts.includes(p)).join(',');
}
