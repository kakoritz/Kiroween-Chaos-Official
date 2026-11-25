import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packTabLabel, type PackChoice } from '../src/arena/packs';

const css = (f: string): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/arena', f), 'utf8');
const pack = (title: string): PackChoice => ({ id: title.toLowerCase(), title, modelBased: true, stageLabels: [], creatures: [], reviewLabel: '', appId: null } as unknown as PackChoice);

describe('lively lanes: header and CSS', () => {
  // covers: lively-lanes-ui/R2
  it('round review hides the tagline and Play demo so Next round stays inside the header', () => {
    expect(css('tournament.css')).toMatch(/body\.tour-on \.hdr > \.tagline, body\.tour-on #demo-open \{ display: none; \}/);
  });

  // covers: lively-lanes-ui/R3
  it('a pack tab that repeats an app tab name says pack', () => {
    expect(packTabLabel(pack('Haunted Stream'))).toBe('Stream pack');
    expect(packTabLabel(pack('Haunted Ticket Desk'))).toBe('Ticket Desk');
    expect(packTabLabel(pack('Haunted Desk'))).toBe('Desk');
    expect(packTabLabel(pack('Haunted Orders'))).toBe('Orders pack');
  });

  // covers: lively-lanes-ui/R4
  it('every declaration in review-card.css is property: value', () => {
    for (const m of css('review-card.css').matchAll(/\{([^{}]*)\}/g)) {
      for (const d of m[1]!.split(';').map((x) => x.trim()).filter(Boolean)) expect(d, d).toMatch(/^[a-z-]+\s*:/);
    }
    expect(css('review-card.css')).not.toMatch(/display: none; grid;/);
  });
});
