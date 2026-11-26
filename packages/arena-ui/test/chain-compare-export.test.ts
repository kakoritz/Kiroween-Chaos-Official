// Compare two chains and export a result. Spec: .kiro/specs/chain-wizard-v2 (second build list, items 5 and 6).
import { describe, expect, it } from 'vitest';
import { chainReport, protectionsOf } from '../../haunt/src/blocks/cards';
import { exampleChain, CHAIN_EXAMPLES } from '../src/chain/examples';
import { toConfig } from '../src/chain/model';
import { compareChains } from '../src/chain/compare';
import { chainBadge, chainReportHtml, exportFileName } from '../src/chain/export';

const run = async (tier: 'rookie' | 'phoenix') => {
  const m = exampleChain(CHAIN_EXAMPLES[0]!.id)!;
  const c = toConfig(m);
  if (!c.ok) throw new Error('example must run');
  return { m, report: await chainReport(c.config, protectionsOf(tier)) };
};

describe('compare two chains', () => {
  it('rookie to phoenix is better, row by row', async () => {
    const a = await run('rookie'), b = await run('phoenix');
    const c = compareChains({ name: 'a', protections: 'rookie', report: a.report }, { name: 'b', protections: 'phoenix', report: b.report });
    expect(c.verdict).toBe('better');
    expect(c.failedB).toBeLessThan(c.failedA);
    expect(c.rows.length).toBe(a.report.blame.length);
    expect(c.rows.every((r) => r.change !== 'worse')).toBe(true);
    expect(c.summary).toMatch(/^Better/);
  });
  it('the other way is worse, and the same is same', async () => {
    const a = await run('rookie'), b = await run('phoenix');
    const pa = { name: 'a', protections: 'rookie', report: a.report }, pb = { name: 'b', protections: 'phoenix', report: b.report };
    expect(compareChains(pb, pa).verdict).toBe('worse');
    expect(compareChains(pa, pa).verdict).toBe('same');
  });
  it('a stage only on one side is marked', async () => {
    const a = await run('rookie');
    const less = { ...a.report, blame: a.report.blame.slice(1) };
    const c = compareChains({ name: 'a', protections: 'x', report: a.report }, { name: 'b', protections: 'x', report: less });
    expect(c.rows.filter((r) => r.change === 'only-a')).toHaveLength(1);
  });
});

describe('export a chain result', () => {
  it('the report page is one file with the grade, the blame table, the yaml and the honest note, and no script or outside link', async () => {
    const { m, report } = await run('rookie');
    const html = chainReportHtml({ model: { ...m, name: 'Tom & <Jerry>' }, report, protections: 'rookie', date: '2026-11-26' });
    expect(html).toContain(`>${report.grade}</div>`);
    expect(html).toContain('Tom &amp; &lt;Jerry&gt;');
    expect(html).not.toContain('<Jerry>');
    expect(html).toContain('Model-based what-if');
    expect(html).toContain('<table>');
    expect(html).toMatch(/stages:/);
    expect(html).not.toMatch(/<script|<link|(?:href|src)=|url\(/);
  });
  it('the badge is an svg with the grade', async () => {
    const { report } = await run('phoenix');
    const svg = chainBadge(report);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`>${report.grade}</text>`);
  });
  it('file names are safe', () => {
    expect(exportFileName({ name: 'My Chain!!', stages: [] }, 'report')).toBe('my-chain-chaos-report.html');
    expect(exportFileName({ name: '', stages: [] }, 'badge')).toBe('chain-chaos-badge.svg');
  });
});
