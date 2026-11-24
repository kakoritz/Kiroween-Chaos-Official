// covers: haunted-house/R8.2 PK-C3
// The docs say one true thing about the Ticket Desk (11 stages) and README links the Kiro write-up.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INBOX_STAGES } from '../src/shared/catalog';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

describe('Ticket Desk stage truth', () => {
  it('the catalog, haunt.yaml and the Python bot list the same eleven stages', () => {
    expect(INBOX_STAGES).toHaveLength(11);
    const yaml = read('apps/haunted-inbox/haunt.yaml');
    for (const s of INBOX_STAGES) expect(yaml).toContain(`id: ${s.id}`);
    expect(read('apps/haunted-inbox/bot/run.py')).toMatch(/eleven stages/);
  });
  it('no doc still says the desk has 6 or 10 stages or is not runnable', () => {
    const docs = ['README.md', 'docs/JUDGES.md', 'docs/DEMO-SCRIPT.md', 'docs/KIRO-LOG.md', '.kiro/specs/inbox-app/design.md'];
    for (const d of docs) {
      const t = read(d);
      expect(t, d).not.toMatch(/runs 6 stages|Pipeline \(6 stages\)|inbox now has ten stages/);
      expect(t, d).not.toMatch(/the 11-stage Ticket Desk, a live|11-stage ticketing pack is specified/);
    }
  });
});

describe('README explains how Kiro was used', () => {
  it('links the write-up and the spec map, and the files exist', () => {
    const t = read('README.md');
    for (const p of ['docs/HOW-KIRO-BUILT-THIS.md', 'docs/SPEC-MAP.md']) {
      expect(t).toContain(p);
      expect(existsSync(join(root, p))).toBe(true);
    }
  });
});
