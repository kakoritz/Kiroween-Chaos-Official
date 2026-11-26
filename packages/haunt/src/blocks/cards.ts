// Block score cards and chain reports (modular-engine M5b, R12). Model-based, like the Workflow Lab: the same rules over the
// protections a tier has. Pure and seeded, no node imports, so the arena can run it in the browser.
import type { HauntConfig } from '../config/haunt-config';
import { labRun, type LabReport } from '../lab/engine';
import { configToLab, type LabModel, type LabPart } from '../lab/model';
import { PACK_TIERS } from '../packs/pack';
import { blockAsConfig } from './alone';
import { BLOCKS, blockById } from './library';

export type CardTier = keyof typeof PACK_TIERS;
/** Any mix of the five protections (retry, journal, idempotency, breaker, offline_queue), for the wizard's switches. */
export type Protections = Partial<Record<LabPart, boolean>>;
export const PROTECTIONS: readonly LabPart[] = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];
export const protectionsOf = (tier: CardTier): Protections => ({ ...PACK_TIERS[tier] });
/** The named tier these protections equal, or `custom`. */
export function tierOfProtections(p: Protections): CardTier | 'custom' {
  const on = (x: Protections) => PROTECTIONS.filter((k) => x[k]).join();
  return CARD_TIERS.find((t) => on(PACK_TIERS[t]) === on(p)) ?? 'custom';
}
export const CARD_TIERS: readonly CardTier[] = ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix'];
const BAD = new Set(['fail', 'halt', 'repeat']);

export interface BlockCard {
  blockId: string;
  tier: CardTier | 'custom';
  role: string;
  grade: string;
  reliability: number;
  /** Attacks tried, and how many ended clean (pass or recovered late). */
  tried: number;
  survived: number;
  /** Attacks that made a repeat (a double effect). */
  repeats: number;
  /** `<fault>:<outcome>` of every attack that did not end clean. */
  failedFaults: string[];
  /** The model, not a real process (the Lab says so too). */
  modelBased: true;
}

/**
 * The model of a bot with these protections. The generic bot sends an idempotency key on every effect exactly when the idempotency
 * protection is on, so in the model an effect is keyed iff that switch is on (the manifest's `idempotent: required` says a repeat is a bug, not that the bot keys it).
 */
const withTier = (m: LabModel, tier: CardTier | Protections): LabModel => {
  const parts = typeof tier === 'string' ? protectionsOf(tier) : { ...tier };
  return { ...m, parts, stages: m.stages.map((s) => (s.effects ? { ...s, effects: s.effects.map((e) => ({ ...e, keyed: parts.idempotency === true })) } : s)) };
};

function cardOf(blockId: string, tier: CardTier | 'custom', role: string, rep: LabReport): BlockCard {
  const cells = rep.cells;
  return {
    blockId, tier, role, grade: String(rep.grade), reliability: rep.reliability, tried: cells.length,
    survived: cells.filter((c) => c.outcome === 'pass' || c.outcome === 'recovered_late').length,
    repeats: cells.filter((c) => c.outcome === 'repeat').length,
    failedFaults: cells.filter((c) => BAD.has(c.outcome)).map((c) => `${c.fault}:${c.outcome}`),
    modelBased: true,
  };
}

/** One block alone against every fault that fits its role, with the parts of `tier`. Null for an unknown block. */
export async function runBlock(blockId: string, tier: CardTier | Protections, seed = 1): Promise<BlockCard | null> {
  const cfg = blockAsConfig(blockId);
  if (!cfg) return null;
  return cardOf(blockId, typeof tier === 'string' ? tier : tierOfProtections(tier), blockById(blockId)!.role, await labRun({ ...withTier(configToLab(cfg), tier), seed }));
}

/** Cards of every library block at every tier. */
export async function allBlockCards(seed = 1): Promise<BlockCard[]> {
  const out: BlockCard[] = [];
  for (const b of BLOCKS) for (const t of CARD_TIERS) { const c = await runBlock(b.id, t, seed); if (c) out.push(c); }
  return out;
}

export interface ChainBlame { stage: string; block?: string; tried: number; failed: number; /** Share of all failures of the chain, 0 to 1. */ share: number }
export interface ChainReport { grade: string; reliability: number; tier: CardTier | 'custom'; tried: number; failed: number; blame: ChainBlame[]; modelBased: true }

/** A chain (any manifest) run as one flow; failures are split back to the stage, and its block, that produced them. */
export async function chainReport(cfg: HauntConfig, tier: CardTier | Protections, seed = 1): Promise<ChainReport> {
  const rep = await labRun({ ...withTier(configToLab(cfg), tier), seed });
  const blockOf = new Map(cfg.stages.map((s) => [s.id, s.block]));
  const per = new Map<string, { tried: number; failed: number }>();
  for (const c of rep.cells) {
    const p = per.get(c.stage) ?? { tried: 0, failed: 0 };
    p.tried++;
    if (BAD.has(c.outcome)) p.failed++;
    per.set(c.stage, p);
  }
  const failed = [...per.values()].reduce((a, p) => a + p.failed, 0);
  const blame = cfg.stages.map((s) => { const p = per.get(s.id) ?? { tried: 0, failed: 0 }; const b = blockOf.get(s.id); return { stage: s.id, ...(b ? { block: b } : {}), tried: p.tried, failed: p.failed, share: failed === 0 ? 0 : p.failed / failed }; });
  return { grade: String(rep.grade), reliability: rep.reliability, tier: typeof tier === 'string' ? tier : tierOfProtections(tier), tried: rep.cells.length, failed, blame, modelBased: true };
}

export interface ChainWarning { id: string; stage?: string; message: string }

/**
 * Checks of a chain that its blocks do not show alone (R12.5). They are warnings, never errors.
 * `cards` (optional) are the blocks' alone cards at the tier being tested.
 */
export function chainChecks(cfg: HauntConfig, cards: readonly BlockCard[] = []): ChainWarning[] {
  const out: ChainWarning[] = [];
  const st = cfg.stages;
  if (!st.some((s) => s.role === 'input')) out.push({ id: 'no_input', message: 'The chain has no input stage, so a lost or bad input cannot be tested.' });
  const effects = st.filter((s) => s.role === 'effect');
  const keyOf = (s: HauntConfig['stages'][number]) => s.effects.map((e) => e.key);
  const seen = new Map<string, string>();
  for (const s of effects) for (const k of keyOf(s)) { if (seen.has(k)) out.push({ id: 'shared_key', stage: s.id, message: `${s.id} and ${seen.get(k)} use the same effect key "${k}", so one can hide the other's repeat.` }); else seen.set(k, s.id); }
  for (const s of effects) for (const e of s.effects) if (e.idempotent !== 'required' && effects.length > 1) out.push({ id: 'loose_effect', stage: s.id, message: `${s.id}: "${e.kind}" does not require an idempotency key, so a retry after a crash can repeat it.` });
  st.forEach((s, i) => {
    if (s.role === 'poll' && !(s.duration && s.duration[1] > 0)) out.push({ id: 'poll_no_limit', stage: s.id, message: `${s.id}: a poll with no time limit can wait forever.` });
    if (s.role === 'poll' && i > 0 && st[i - 1]!.role === 'effect') out.push({ id: 'poll_after_effect', stage: s.id, message: `${s.id} waits right after the effect in ${st[i - 1]!.id}; a crash while waiting must not redo that effect.` });
  });
  if (st.length > 12 && !st.some((s) => s.role === 'input')) out.push({ id: 'long_chain', message: 'A long chain with no input stage is hard to test.' });
  for (const s of st) {
    const bad = cards.filter((c) => c.blockId === s.block && (c.repeats > 0 || c.failedFaults.length > 0));
    if (s.block && bad.length > 0 && st.length > 1) out.push({ id: 'weak_block', stage: s.id, message: `${s.id} (${s.block}) did not pass alone at ${bad[0]!.tier}: ${bad[0]!.failedFaults.slice(0, 3).join(', ')}.` });
  }
  return out;
}
