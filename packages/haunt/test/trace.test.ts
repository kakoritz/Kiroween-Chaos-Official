// covers: SH-K1
import { describe, expect, it } from 'vitest';
import { coversIds, parseSpec, subjectIds, taskIdsIn } from '../../../tools/trace';

describe('trace generator', () => {
  it('parses task and requirement IDs and ignores fenced code', () => {
    const md = [
      '### R4. Reports',
      '1. THE SYSTEM SHALL write a report.',
      '2. WHEN a run ends, THE SYSTEM SHALL grade it.',
      '```',
      '- [x] **FAKE-1 inside fence**',
      '```',
      '- [x] **PT-C4 Scoring.** Uses R4.1 and R4.',
      '- [ ] **H1.2 Open task** text',
    ].join('\n');
    const items = parseSpec('demo', md);
    expect(items.map((i) => i.id)).toEqual(['R4', 'R4.1', 'R4.2', 'PT-C4', 'H1.2']);
    expect(items.find((i) => i.id === 'PT-C4')).toMatchObject({ status: 'done', refs: ['R4.1', 'R4'] });
    expect(items.find((i) => i.id === 'H1.2')?.status).toBe('open');
  });

  it('finds IDs in commit subjects, including dash prefixes', () => {
    const ids = subjectIds('PT-C3-remainder: live order record endpoint (#207)');
    expect(ids.has('PT-C3')).toBe(true);
    expect(ids.has('PT-C3-remainder')).toBe(true);
  });

  it('reads covers comments with several IDs', () => {
    expect(coversIds('// covers: SH-U1, R4.1\nit()\n# covers: H1.2')).toEqual(['SH-U1', 'R4.1', 'H1.2']);
    expect(coversIds('// covers: haunted-house/R2.1')).toEqual(['haunted-house/R2.1']);
    expect(coversIds('no marker here')).toEqual([]);
  });

  it('reads the task ids a requirement names in parentheses', () => {
    expect(taskIdsIn('Downtime SHALL cost 2 points. (PT-C4)')).toEqual(['PT-C4']);
    expect(taskIdsIn('Walk to the next station. (PT-C2, PT-U1)')).toEqual(['PT-C2', 'PT-U1']);
    expect(taskIdsIn('THE SYSTEM SHALL use 11 stages (TV3-C1).')).toEqual(['TV3-C1']);
    expect(taskIdsIn('Plain text with no id.')).toEqual([]);
    const items = parseSpec('demo', '## R4. Scoring\n1. Downtime costs points. (PT-C4)\n- [x] **PT-C4 Scoring.** done');
    expect(items.find((i) => i.id === 'R4.1')?.taskRefs).toEqual(['PT-C4']);
  });
});
