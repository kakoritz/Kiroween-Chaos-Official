// covers: docs-truth-pass/R1 docs-truth-pass/R1.1 docs-truth-pass/R1.2 docs-truth-pass/R2 docs-truth-pass/R2.1 docs-truth-pass/R3 docs-truth-pass/R3.1 docs-truth-pass/R3.2 docs-truth-pass/R3.3 docs-truth-pass/R3.4 docs-truth-pass/R4 docs-truth-pass/R4.1 docs-truth-pass/R5 docs-truth-pass/R5.1 DT-D1 DT-D2 DT-D3 DT-D4 DT-T1 haunted-house/R8.2 PK-C3 stream-pack-app/R6 stream-pack-app/R6.1 stream-pack-app/R6.2 SP-D1
// The docs say one true thing about the Ticket Desk (11 stages) and README links the Kiro write-up.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

describe('Stream app docs (stream-pack-app R6)', () => {
  it('README and PACKS say the streaming pack has a runnable app and no doc still calls it label-only or not runnable', () => {
    for (const d of ['README.md', 'docs/PACKS.md', 'docs/JUDGES.md']) {
      const t = read(d);
      expect(t, d).not.toMatch(/It has no runnable app|Not built: a runnable streaming app|Two real apps live/);
    }
    expect(read('README.md')).toContain('apps/haunted-stream');
    expect(read('docs/PACKS.md')).toMatch(/Three real apps live/);
    expect(existsSync(join(root, 'apps/haunted-stream/haunt.yaml'))).toBe(true);
  });
});

describe('Docs truth pass (docs-truth-pass R1 to R5)', () => {
  const HOSTED = 'https://kakoritz.github.io/Kiroween-Chaos-Official/';
  const live = ['README.md', 'docs/JUDGES.md', 'docs/START-HERE.md', 'docs/DEMO-SCRIPT.md', 'docs/HOW-KIRO-BUILT-THIS.md', 'docs/KIRO-WRITEUP.md', 'submission/project-story.md', 'submission/gallery-captions.md', 'kiro-power/README.md', 'kiro-crew-app/README.md'];
  it('START-HERE exists, is linked from the README top, and every relative link in it resolves', () => {
    expect(existsSync(join(root, 'docs/START-HERE.md'))).toBe(true);
    expect(read('README.md').split('\n').slice(0, 6).join('\n')).toContain('docs/START-HERE.md');
    const t = read('docs/START-HERE.md');
    for (const m of t.matchAll(/\]\(((?!https?:)[^)#]+)\)/g)) expect(existsSync(join(root, 'docs', m[1])), m[1]).toBe(true);
    for (const p of ['.kiro/specs', '.kiro/steering', '.kiro/hooks', '.kiro/agents', 'kiro-power', 'kiro-crew-app', 'apps/haunted-orders', 'apps/haunted-inbox', 'apps/haunted-stream']) {
      expect(t).toContain(p);
      expect(existsSync(join(root, p)), p).toBe(true);
    }
  });
  it('the hosted link is in README, JUDGES and the story Try it section', () => {
    for (const d of ['README.md', 'docs/JUDGES.md', 'docs/START-HERE.md']) expect(read(d), d).toContain(HOSTED);
    const story = read('submission/project-story.md');
    expect(story.slice(story.indexOf('## Try it'))).toContain(HOSTED);
  });
  it('no live doc uses a stale name', () => {
    for (const d of live) expect(read(d), d).not.toMatch(/Chaos Haunt|Chaos Monkey|haunt-crew-app/i);
  });
  it('the docs say three apps, and the apps folder has exactly three', () => {
    const apps = readdirSync(join(root, 'apps')).filter((n) => n.startsWith('haunted-'));
    expect(apps.sort()).toEqual(['haunted-inbox', 'haunted-orders', 'haunted-stream']);
    for (const d of ['README.md', 'docs/JUDGES.md', 'kiro-power/README.md', 'kiro-crew-app/README.md']) {
      const t = read(d);
      expect(t, d).not.toMatch(/One engine, two apps/);
      expect(t, d).toMatch(/three apps/i);
    }
    expect(read('submission/project-story.md')).toMatch(/three apps/);
    expect(read('submission/project-story.md')).not.toMatch(/\*\*Haunted Orders\*\*/);
  });
  it('the story spec and campaign counts match the repo', () => {
    const specs = readdirSync(join(root, '.kiro/specs'), { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    const words: Record<number, string> = { 15: 'Fifteen', 16: 'Sixteen', 17: 'Seventeen' };
    expect(read('submission/project-story.md')).toContain(`${words[specs] ?? specs} specs live`);
    const nights = Object.keys(JSON.parse(read('packages/core/campaign/nights.json'))).length;
    expect(nights).toBe(7);
    expect(read('submission/gallery-captions.md')).toContain('seven nights');
  });
  it('no doc says the hooks guard the contract; they check on save', () => {
    for (const d of ['docs/HOW-KIRO-BUILT-THIS.md', 'docs/KIRO-WRITEUP.md', 'submission/project-story.md', 'README.md']) {
      expect(read(d), d).not.toMatch(/guarding the contract|guards? the (two )?seams|guards on save/i);
    }
    const hook = JSON.parse(read('.kiro/hooks/fixtures-on-contract-save.kiro.hook'));
    expect(hook.then.command).toBe('npm run validate:events');
  });
});
