// SH-C5 LLM reviewer: draft inside the spec, rule fallback on any failure, wave-end hook.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runReviewerLlm, sanitizeDraft, buildPrompt, pickProvider, anthropicProvider, MAX_DRAFT_CHARS } from '../src/reviewer/llm';
import { onWaveEnd, hasWaveEnd } from '../src/reviewer/hook';
import { runReviewer } from '../src/reviewer';

const evs: any[] = [
  { seq: 1, type: 'repeat', wave: 1, lane: '1', order: 'o1', stage: 'payment', detail: { kind: 'charge', count: 2 } },
  { seq: 2, type: 'order_failed', wave: 1, lane: '3', order: 'o3', stage: 'intake', detail: { error: 'ENOENT: no such file' } },
];
const ended = [...evs, { seq: 3, type: 'wave_end', wave: 1, lane: '1', detail: {} }];

describe('llm reviewer', () => {
  it('adds a draft diff to design.md and keeps rule findings', async () => {
    const r = await runReviewerLlm('r1', evs, { provider: async () => '```diff\n--- a\n+++ b\n+retry()\n```' });
    expect(r.source).toBe('llm');
    expect(r.hardening.design).toContain('```diff\n--- a\n+++ b\n+retry()\n```');
    expect(r.findings).toEqual(runReviewer('r1', evs).findings);
    expect(r.hardening.tasks).toBe(runReviewer('r1', evs).hardening.tasks);
  });
  it('falls back to rules when the provider throws, is empty, or hangs', async () => {
    const base = runReviewer('r1', evs);
    for (const provider of [async () => { throw new Error('boom'); }, async () => '  ', () => new Promise<string>(() => {})]) {
      const r = await runReviewerLlm('r1', evs, { provider, timeoutMs: 30 });
      expect(r.source).toBe('rules');
      expect(r.fallbackReason).toBeTruthy();
      expect(r.hardening).toEqual(base.hardening);
    }
  });
  it('falls back when no provider is configured', async () => {
    const r = await runReviewerLlm('r1', evs, { env: {} });
    expect(r.source).toBe('rules');
    expect(r.fallbackReason).toMatch(/no provider/);
  });
  it('sanitizes fences, control chars and length', () => {
    expect(sanitizeDraft('x\x1b[31m\x00y')).toBe('xy');
    expect(sanitizeDraft('text ```inner``` more')).not.toContain('```');
    expect(sanitizeDraft('a'.repeat(MAX_DRAFT_CHARS + 50)).length).toBeLessThan(MAX_DRAFT_CHARS + 30);
  });
  it('prompt names findings and the target file only', () => {
    const f = runReviewer('r1', evs).findings;
    const p = buildPrompt('r1', f, 'bot.ts');
    expect(p).toContain('bot.ts');
    expect(p).toContain(f[0]!.id);
  });
  it('pickProvider chooses by env and the API provider uses an injected fetch', async () => {
    expect(pickProvider({})).toBeUndefined();
    expect(pickProvider({ ANTHROPIC_API_KEY: 'k' })?.name).toBe('anthropic-api');
    expect(pickProvider({ HAUNT_REVIEWER_LLM: 'kiro' })?.name).toBe('kiro-cli');
    const fake = (async () => ({ ok: true, json: async () => ({ content: [{ text: 'd' }] }) })) as unknown as typeof fetch;
    expect(await anthropicProvider('k', fake)('p')).toBe('d');
    const bad = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
    await expect(anthropicProvider('k', bad)('p')).rejects.toThrow(/401/);
  });
});

describe('wave-end hook', () => {
  it('does nothing before wave_end and writes files after', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-hook-'));
    try {
      expect(hasWaveEnd(evs)).toBe(false);
      expect(await onWaveEnd(root, 'r2', evs)).toBeUndefined();
      const r = await onWaveEnd(root, 'r2', ended, { llm: true, provider: async () => '+x' });
      expect(r!.result.source).toBe('llm');
      expect(readFileSync(join(r!.written.specDir, 'design.md'), 'utf8')).toContain('Draft diff');
      expect(readFileSync(r!.written.postmortem, 'utf8')).toContain('Reviewer source');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('ignores the provider unless llm is set', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-hook-'));
    try {
      const r = await onWaveEnd(root, 'r3', ended, { provider: async () => '+x' });
      expect(r!.result.source).toBe('rules');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('no network unless the flag and the key are both present', () => {
  const net = (): { spy: ReturnType<typeof vi.fn>; done: () => void } => {
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: '+retry()' }] }) }));
    vi.stubGlobal('fetch', spy);
    return { spy, done: () => vi.unstubAllGlobals() };
  };
  it('key set but no --llm: rules, fetch never called', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-nonet-'));
    const n = net();
    try {
      const r = await onWaveEnd(root, 'n1', ended, { env: { ANTHROPIC_API_KEY: 'sk-test' } });
      expect(r!.result.source).toBe('rules');
      expect(n.spy).not.toHaveBeenCalled();
    } finally { n.done(); rmSync(root, { recursive: true, force: true }); }
  });
  it('--llm but no key: rules, says why, fetch never called', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-nonet-'));
    const n = net();
    try {
      const r = await onWaveEnd(root, 'n2', ended, { llm: true, env: {} });
      expect(r!.result.source).toBe('rules');
      expect((r!.result as any).fallbackReason).toMatch(/no provider/);
      expect(readFileSync(r!.written.postmortem, 'utf8')).toContain('LLM not used');
      expect(n.spy).not.toHaveBeenCalled();
    } finally { n.done(); rmSync(root, { recursive: true, force: true }); }
  });
  it('--llm and key: the mocked API is used once and the draft lands in the spec', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-nonet-'));
    const n = net();
    try {
      const r = await onWaveEnd(root, 'n3', ended, { llm: true, env: { ANTHROPIC_API_KEY: 'sk-test' } });
      expect(r!.result.source).toBe('llm');
      expect(n.spy).toHaveBeenCalledTimes(1);
    } finally { n.done(); rmSync(root, { recursive: true, force: true }); }
  });
});
