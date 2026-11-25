// covers: tournament-stall/R2.1, tournament-stall/R2.2, tournament-stall/R3.3
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('tournament stall tooling', () => {
  it('R2.1 the e2e timeout error names the phase, round, wave, lanes and the last event per lane', () => {
    const e2e = read('tools/e2e.mjs');
    for (const part of ['tournament did not finish in', 'phase=', 'round=', 'wave=', 'lanes=', 'awaiting_next=', 'last per lane']) expect(e2e).toContain(part);
  });
  it('R2.2 the wait is the HAUNT_E2E_TOURNEY_MS setting with a 20 minute default', () => {
    expect(read('tools/e2e.mjs')).toMatch(/HAUNT_E2E_TOURNEY_MS\) \|\| 20 \* 60_000/);
  });
  it('R3.3 check:hosted samples frames of the full demo and fails on a creature-free stretch', () => {
    const chk = read('tools/hosted-check.mjs');
    expect(chk).toContain("startDemo('full'");
    expect(chk).toMatch(/creature-free stretch of \$\{worst\} ms/);
  });
});
