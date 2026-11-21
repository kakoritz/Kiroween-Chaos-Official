// Optional LLM reviewer: drafts the hardening diff inside the spec. The rule reviewer always runs; the LLM only adds a draft.
// Any failure (no provider, error, timeout, empty answer) falls back to the rule result. Spec: share/spec.md section 7 (SH-C5).
// The reviewer never changes source code: the draft is text inside design.md for a human or Kiro to review and apply.
import { spawn } from 'node:child_process';
import type { HauntEvent } from '../score/score';
import type { Finding } from '../report/builder';
import { runReviewer, type ReviewResult } from './index';
import type { ReviewOptions } from './rules';

export type LlmProvider = (prompt: string) => Promise<string>;
export type ReviewSource = 'llm' | 'rules';

export interface LlmReviewResult extends ReviewResult { source: ReviewSource; fallbackReason?: string; provider?: string }
export interface LlmReviewOptions extends ReviewOptions {
  botFile?: string;
  /** Injected provider. When omitted, `pickProvider(env)` is used. */
  provider?: LlmProvider;
  providerName?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export const MAX_DRAFT_CHARS = 6000;

export function buildPrompt(run: string, findings: Finding[], botFile: string): string {
  const L = [
    `You are the Haunt reviewer. Run ${run}. Target bot file: ${botFile}.`,
    'Write a unified diff (one fenced block, no prose) that hardens the bot against the findings below.',
    'Use only SDK parts named in "Suggested part". Do not touch any other file. Keep it under 60 lines.',
    '',
    'Findings:',
  ];
  for (const f of findings.slice(0, 12)) L.push(`- ${f.id} ${f.rule} (${f.severity}) at ${f.stage || '-'}${f.fault ? '/' + f.fault : ''}: ${f.summary}. Suggested part: ${f.suggestedPart}.`);
  return L.join('\n');
}

/** Strips control chars, removes code fences from the answer, caps the length. Output is placed inside one ```diff fence. */
export function sanitizeDraft(raw: string): string {
  const noCtl = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const m = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(noCtl);
  const body = (m ? m[1]! : noCtl).replace(/```/g, "'''").replace(/\r\n/g, '\n').trim();
  return body.length > MAX_DRAFT_CHARS ? body.slice(0, MAX_DRAFT_CHARS) + '\n... (truncated)' : body;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

/** Kiro CLI, headless. Runs a local binary; no network code here. */
export function kiroCliProvider(bin = 'kiro-cli', timeoutMs = 120000): LlmProvider {
  return (prompt) => new Promise<string>((resolve, reject) => {
    const child = spawn(bin, ['chat', '--no-interactive', prompt], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const t = setTimeout(() => { child.kill(); reject(new Error('kiro cli timeout')); }, timeoutMs);
    child.stdout.on('data', (b) => { if (out.length < 200000) out += String(b); });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(`kiro cli exit ${code}`)); });
  });
}

/** Anthropic API, used only when ANTHROPIC_API_KEY is set and `--llm` was requested. `fetchFn` is injectable for tests. */
export function anthropicProvider(key: string, fetchFn: typeof fetch = fetch, model = 'claude-sonnet-4-5'): LlmProvider {
  return async (prompt) => {
    const r = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error(`api status ${r.status}`);
    const j = (await r.json()) as { content?: { text?: string }[] };
    return (j.content ?? []).map((c) => c.text ?? '').join('');
  };
}

/** `HAUNT_REVIEWER_LLM=kiro|api` forces a choice; otherwise an API key wins, then the Kiro CLI. Returns undefined when none is configured. */
export function pickProvider(env: Record<string, string | undefined> = process.env): { name: string; provider: LlmProvider } | undefined {
  const want = env.HAUNT_REVIEWER_LLM;
  if (want === 'kiro' || (!want && !env.ANTHROPIC_API_KEY && env.HAUNT_KIRO_CLI)) return { name: 'kiro-cli', provider: kiroCliProvider(env.HAUNT_KIRO_CLI || 'kiro-cli') };
  if ((want === 'api' || !want) && env.ANTHROPIC_API_KEY) return { name: 'anthropic-api', provider: anthropicProvider(env.ANTHROPIC_API_KEY) };
  return undefined;
}

export async function runReviewerLlm(run: string, events: HauntEvent[], opts: LlmReviewOptions = {}): Promise<LlmReviewResult> {
  const base = runReviewer(run, events, opts);
  const botFile = opts.botFile ?? 'apps/haunted-orders/src/bots/rookie.ts';
  const picked = opts.provider ? { name: opts.providerName ?? 'custom', provider: opts.provider } : pickProvider(opts.env ?? process.env);
  const fallback = (reason: string): LlmReviewResult => ({
    ...base,
    source: 'rules',
    fallbackReason: reason,
    postmortem: base.postmortem + `\n_Reviewer source: rules (LLM not used: ${reason})._\n`,
  });
  if (!picked) return fallback('no provider configured');
  if (!base.findings.length) return fallback('no findings to draft');
  try {
    const raw = await withTimeout(picked.provider(buildPrompt(run, base.findings, botFile)), opts.timeoutMs ?? 120000);
    const draft = sanitizeDraft(String(raw ?? ''));
    if (!draft) return fallback('empty answer');
    const design = base.hardening.design + [
      '', `## Draft diff (LLM: ${picked.name}, not applied)`, '',
      'Drafted by a language model from the findings above. Review every line before applying; the reviewer never edits source.', '',
      '```diff', draft, '```', '',
    ].join('\n');
    return {
      ...base,
      source: 'llm',
      provider: picked.name,
      postmortem: base.postmortem + `\n_Reviewer source: LLM draft via ${picked.name}, rule findings unchanged._\n`,
      hardening: { ...base.hardening, design },
    };
  } catch (e) {
    return fallback(e instanceof Error ? e.message.slice(0, 120) : 'provider error');
  }
}
