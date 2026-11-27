// covers: contract v1.4, open effect kinds (third build list item 4, owner approved). Spec: contract/V1_4.md.
import { describe, expect, it } from 'vitest';
import { startProvider } from '../../core/src/provider';
import { schemaErrors } from '../src/contract/validate';
import { parseHauntConfig } from '../src/config/haunt-config';
import { providerKind } from '../src/bot/generic';
import { starterStages } from '../src/scaffold/bot-starter';
import { RepeatDetector } from '../src/runner/provider';

const eff = (kind: string) => ({ seq: 1, ts: 1, wave: 1, lane: 1, order: 'ord-0001', stage: 'pay', type: 'effect', detail: { kind, key: 'k', replayed: false } });
const rep = (kind: string) => ({ seq: 2, ts: 2, wave: 1, lane: 1, order: 'ord-0001', type: 'repeat', detail: { kind, key: 'k', count: 2 } });

describe('the contract', () => {
  it('takes any well-formed kind in effect and repeat, and still refuses a malformed one', () => {
    for (const k of ['sms', 'ledger_entry', 'charge', 'account_create']) expect(schemaErrors(eff(k)), k).toEqual([]);
    for (const k of ['sms', 'charge']) expect(schemaErrors(rep(k)), k).toEqual([]);
    for (const k of ['Bad Kind', '9lives', 'x', '']) expect(schemaErrors(eff(k)).length, k).toBeGreaterThan(0);
  });
});

describe('the manifest', () => {
  const base = 'name: x\nstart: y\ntruth: http://127.0.0.1:7071\nstages:\n';
  it('accepts a new kind, and says why it refuses a bad one', () => {
    expect(parseHauntConfig(base + '  - { id: text, label: Text, role: effect, effects: [{ kind: sms, key: s, idempotent: required }] }\n').ok).toBe(true);
    const bad = parseHauntConfig(base + '  - { id: text, label: Text, role: effect, effects: [{ kind: Send SMS, key: s, idempotent: required }] }\n');
    expect(!bad.ok && bad.errors.join()).toMatch(/kind: "Send SMS" must be lowercase/);
    const res = parseHauntConfig(base + '  - { id: text, label: Text, role: effect, effects: [{ kind: tracking, key: s, idempotent: required }] }\n');
    expect(res.ok).toBe(false);
  });
  it('the generic bot and the starter send the declared kind', () => {
    expect(providerKind('sms')).toBe('sms');
    expect(providerKind('account_create')).toBe('account');
    expect(providerKind('Bad Kind')).toBe('store');
    const r = parseHauntConfig(base + '  - { id: text, label: Text, role: effect, effects: [{ kind: sms, key: s, idempotent: required }] }\n');
    if (!r.ok) throw new Error('config');
    expect(starterStages(r.config)[0]!.calls[0]).toMatchObject({ path: '/effects/sms', kind: 'sms', body: { index: 1 } });
  });
});

describe('the provider', () => {
  it('records a new kind under its own name, keeps a key idempotent, and counts a repeat', async () => {
    const prov = await startProvider({ port: 0 });
    try {
      const post = (path: string, key?: string) => fetch(`${prov.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify({ lane: '1', order: 'ord-0001', index: 1 }) });
      expect((await post('/effects/sms', 'k1')).status).toBe(201);
      const again = await post('/effects/sms', 'k1');
      expect(again.headers.get('idempotent-replayed')).toBe('true');
      expect((await post('/effects/sms')).status).toBe(201);
      const rows = prov.provider.ledger('1');
      expect(rows.map((r) => r.kind)).toEqual(['sms', 'sms']);
      expect(rows[0]!.id).toMatch(/^fx_/);
      const det = new RepeatDetector();
      expect(det.add(rows[0]!)).toBeNull();
      expect(det.add(rows[1]!)).toMatchObject({ kind: 'sms', count: 2 });
      expect((await post('/effects/tracking')).status).toBe(404);
      expect((await post('/effects/Bad')).status).toBe(404);
      expect((await post('/charges')).status).toBe(201);
    } finally { await prov.close(); }
  });
});

describe('the in-browser ledger', () => {
  it('records any lowercase kind under its name, once per key', async () => {
    const { PageLedger } = await import('../src/browser/ledger');
    const l = new PageLedger(() => 0);
    const a = l.apply({ lane: '1', kind: 'sms', order: 'ord-0001', key: 'k', index: 1 });
    const b = l.apply({ lane: '1', kind: 'sms', order: 'ord-0001', key: 'k', index: 1 });
    expect(a.row.kind).toBe('sms');
    expect(a.row.id).toMatch(/^fx_/);
    expect(b.replayed).toBe(true);
    expect(l.count('ord-0001', 'sms')).toBe(1);
  });
});
