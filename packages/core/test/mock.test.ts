import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TIER_ORDER, resolveOutcome } from '@haunt/shared';
import { findRepoRoot } from '../../haunt/src/contract/validate';
import { OutcomeTable, buildOutcomeTable } from '../src/mock/outcomes';
import { createMockServer } from '../src/mock/server';

const file = resolve(findRepoRoot(), 'packages', 'core', 'mock', 'outcomes.json');

describe('outcome table (H0.7)', () => {
  it('the committed outcomes.json matches the shared resolver', () => {
    const committed = JSON.parse(readFileSync(file, 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOutcomeTable())));
  });

  it('matches acceptance table A for payment rows', () => {
    const t = new OutcomeTable(JSON.parse(readFileSync(file, 'utf8')));
    const o = (tier: string, fault: string, point?: string) => t.lookup('orders', tier as any, fault, 'payment', point)?.outcome;
    expect(o('rookie', 'crash', 'after_effect_before_journal')).toBe('REPEAT');
    expect(o('journaler', 'crash', 'after_effect_before_journal')).toBe('REPEAT');
    expect(o('reconciler', 'crash', 'after_effect_before_journal')).toBe('OK');
    expect(o('rookie', 'timeout')).toBe('FAILED');
    expect(o('phoenix', 'http_429')).toBe('OK');
    expect(o('reconciler', 'http_429')).toBe('FAILED');
    expect(o('phoenix', 'internet_outage')).toBe('PARKED_OK');
    expect(o('rookie', 'http_404')).toBe('FAILED');
  });

  it('every row agrees with resolveOutcome', () => {
    for (const r of buildOutcomeTable()) {
      const got = resolveOutcome(r.app, r.tier, r.fault, r.stage, r.point);
      expect(got?.outcome).toBe(r.outcome);
      expect(TIER_ORDER).toContain(r.tier);
    }
  });
});

describe('mock server REST and SSE (H0.7)', () => {
  it('boots quiet: no wave, bare SSE streams only hello, demo start answers 200 (#116)', async () => {
    const m = createMockServer({ port: 0 });
    const base = `http://127.0.0.1:${await m.listen()}`;
    const ctrl = new AbortController();
    try {
      const state = await (await fetch(`${base}/api/state`)).json() as any;
      expect(state.wave).toBeNull();
      expect(state.lanes).toEqual([]);
      expect(state.demo.running).toBeNull();
      const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      expect(JSON.parse(first.slice(first.indexOf('{'))).type).toBe('hello');
      ctrl.abort();
      const after = await (await fetch(`${base}/api/state`)).json() as any;
      expect(after.wave).toBeNull();
      expect(after.demo.running).toBeNull();
      expect((await fetch(`${base}/api/demo/start`, { method: 'POST', body: JSON.stringify({ script: 'hero', speed: 4 }) })).status).toBe(200);
    } finally { await m.close(); }
  });

  it('serves health, creatures, state and outcome lookups', async () => {
    const m = createMockServer({ port: 0 });
    const port = await m.listen();
    try {
      const base = `http://127.0.0.1:${port}`;
      const health = await (await fetch(`${base}/api/health`)).json() as any;
      expect(health.contractVersion).toBe(1);
      expect((await (await fetch(`${base}/api/creatures`)).json() as any).length).toBeGreaterThan(5);
      const state = await (await fetch(`${base}/api/state`)).json() as any;
      expect(state.scripts).toEqual(['hero', 'full', 'loop']);
      expect(state.contractVersion).toBe(1);
      expect(state.stages.length).toBe(8);
      const row = await (await fetch(`${base}/api/outcome?tier=phoenix&fault=internet_outage&stage=payment`)).json() as any;
      expect(row.outcome).toBe('PARKED_OK');
      expect((await fetch(`${base}/api/outcome?tier=nope&fault=x&stage=y`)).status).toBe(404);
      const bad = await fetch(`${base}/api/demo/start`, { method: 'POST', body: JSON.stringify({ script: 'nope' }) });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as any).error.code).toBe('bad_request');
      const ok = await fetch(`${base}/api/demo/start`, { method: 'POST', body: JSON.stringify({ script: 'hero', speed: 4 }) });
      expect(((await ok.json() as any)).script).toBe('hero');
    } finally {
      await m.close();
    }
  });

  it('streams the calm fixture over SSE starting with hello', async () => {
    const m = createMockServer({ port: 0 });
    const port = await m.listen();
    try {
      const ctrl = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/events?script=calm&speed=4`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      const first = JSON.parse(new TextDecoder().decode(value).replace(/^data: /, '').trim());
      expect(first.type).toBe('hello');
      ctrl.abort();
    } finally {
      await m.close();
    }
  });
});
