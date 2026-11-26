// The browser copy of the config-only apps. Spec: .kiro/specs/modular-engine (M6, hosted page).
import { afterEach, describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { BUNDLED_APP_DIRS } from '../src/config/bundled-apps';
import { registerEmbeddedApps } from '../src/config/embedded-register';
import { unregisterApp } from '../src/shared/registry';
import { createInPageMock } from '../../core/src/mock/inpage-mock';
import outcomes from '../../core/mock/outcomes.json';

afterEach(() => { unregisterApp('playback'); unregisterApp('coffee-shop'); });

const embedder = async () => (await import(pathToFileURL(resolve(__dirname, '../../../tools/embed-apps.mjs')).href)) as { embedApps(o: { check?: boolean }): string[]; APP_DIRS: string[] };

describe('embedded apps', () => {
  it('the generated copy matches the files', async () => {
    expect((await embedder()).embedApps({ check: true })).toEqual([]);
  });
  it('the embed list equals the bundled list', async () => {
    expect([...(await embedder()).APP_DIRS]).toEqual([...BUNDLED_APP_DIRS]);
  });
  it('registers Playback and the Coffee Shop with no fs', () => {
    const r = registerEmbeddedApps();
    expect(r.errors).toEqual([]);
    expect(r.apps.map((a) => a.id)).toEqual(['playback', 'coffee-shop']);
    expect(r.apps[0]!.creatureNames?.length).toBe(9);
  });
  it('the in-page mock then lists them and plays a wave of the Coffee Shop on its own stages', async () => {
    registerEmbeddedApps();
    const { api } = createInPageMock(outcomes as never);
    expect((await api.getApps()).map((a: { id: string }) => a.id)).toEqual(['orders', 'inbox', 'stream', 'playback', 'coffee-shop']);
    await api.setApp('coffee-shop');
    const st = await api.getState();
    expect(st.app).toBe('coffee-shop');
    expect(st.stages.map((s: { id: string }) => s.id)).toEqual(['read_request', 'pay', 'brew', 'ready']);
  });
});

import { registerManifestText } from '../src/config/embedded-register';

describe('registerManifestText (a chain from the Chain Wizard on the hosted page)', () => {
  // covers: chain-wizard-v2/R2.3
  it('registers a chain and the in-page mock then plays it; a bad one is refused with the fix', async () => {
    const r = registerManifestText('name: wiz-chain\nstart: x\ntruth: http://127.0.0.1:7071\nstages:\n  - { use: read_request }\n  - { use: charge }\n');
    expect(r.ok).toBe(true);
    const { api } = createInPageMock(outcomes as never);
    await api.setApp('wiz-chain');
    expect((await api.getState()).stages.map((s: { id: string }) => s.id)).toEqual(['read_request', 'charge']);
    unregisterApp('wiz-chain');
    const bad = registerManifestText('name: orders\nstart: x\nstages:\n  - { id: aa, label: A, role: input }\n');
    expect(!bad.ok && bad.errors.join()).toMatch(/built in/);
    expect(registerManifestText('x'.repeat(40_000)).ok).toBe(false);
  });
});
