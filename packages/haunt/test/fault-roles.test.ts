// Faults attach by role in a registered app. Spec: .kiro/specs/modular-engine (M2, R2).
import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { FAULTS, faultById, faultFacesStage } from '../src/chaos/catalog';
import { registerAppFromDir } from '../src/config/register-dir';
import { unregisterApp } from '../src/shared/registry';
import { DialChaos } from '../src/runner/intensity';

const COFFEE = resolve(__dirname, 'fixtures/apps/coffee');
afterEach(() => { unregisterApp('coffee'); });
const facing = (stage: string, app?: string) => FAULTS.filter((f) => faultFacesStage(f, stage, app)).map((f) => f.id);

describe('role-based fault resolver', () => {
  // covers: modular-engine/R2.4
  it('a new app gets faults from its stage roles with no catalog edit', () => {
    registerAppFromDir(COFFEE);
    const effect = facing('pay', 'coffee');
    expect(effect).toEqual(expect.arrayContaining(['crash', 'internet_outage', 'timeout', 'http_429', 'http_500', 'disk_full']));
    expect(effect).not.toContain('missing_file');
    expect(facing('read_request', 'coffee')).toEqual(expect.arrayContaining(['missing_file', 'malformed_payload', 'duplicate_request', 'crash']));
    expect(facing('read_request', 'coffee')).not.toContain('http_500');
    // a work stage takes only the process and disk faults
    expect(facing('brew', 'coffee').sort()).toEqual(['crash', 'disk_full', 'out_of_memory', 'power_outage']);
  });

  // covers: modular-engine/R2.5
  it('world and desk faults stay off a new app (they belong to Orders and the Ticket Desk)', () => {
    registerAppFromDir(COFFEE);
    for (const stage of ['read_request', 'pay', 'brew', 'ready']) for (const id of ['weather', 'sla_breach', 'wrong_address', 'order_typo']) {
      expect(faultFacesStage(faultById(id)!, stage, 'coffee'), `${id} on ${stage}`).toBe(false);
    }
  });

  it('without an app, a registered stage id is found by name; built-in stage ids keep their exact lists', () => {
    registerAppFromDir(COFFEE);
    expect(faultFacesStage(faultById('http_500')!, 'pay')).toBe(true);
    expect(faultFacesStage(faultById('timeout')!, 'updates')).toBe(false);
    expect(faultFacesStage(faultById('weather')!, 'transit')).toBe(true);
  });

  // covers: modular-engine/R2.4
  it('the dial presses faults on a registered app stage', () => {
    registerAppFromDir(COFFEE);
    const d = new DialChaos(7, true);
    const hit = new Set<string>();
    for (let t = 0; t < 120_000; t += 250) for (const p of d.tick('1', 'pay', t, 9)) hit.add(p.fault);
    expect(hit.size).toBeGreaterThan(3);
    for (const id of hit) expect(faultFacesStage(faultById(id)!, 'pay', 'coffee')).toBe(true);
  });

  // covers: modular-engine/R2.2
  it('a stage can deny a fault by id in its manifest', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'app-'));
    writeFileSync(resolve(dir, 'haunt.yaml'), 'name: coffee\nstart: x\ntruth: http://127.0.0.1:7071\nstages:\n  - id: pay\n    label: Pay\n    role: effect\n    deny: [http_429]\n    effects:\n      - { kind: charge, key: c1, idempotent: required }\n');
    expect(registerAppFromDir(dir).ok).toBe(true);
    expect(faultFacesStage(faultById('http_429')!, 'pay', 'coffee')).toBe(false);
    expect(faultFacesStage(faultById('http_500')!, 'pay', 'coffee')).toBe(true);
  });
});
