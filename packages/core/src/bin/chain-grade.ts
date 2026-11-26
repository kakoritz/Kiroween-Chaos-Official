// `npm run chain:grade -- <haunt.yaml> [--tier rookie|retrier|journaler|reconciler|phoenix] [--min A|B|C|D] [--out dir]`
// Grades the chain in a haunt.yaml with the block model (no bot needed). Exit 1 when the grade is below --min. Used by the GitHub Action template (docs/GITHUB-ACTION.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadHauntConfig } from '../../../haunt/src/config/load';
import { CARD_TIERS, chainReport, type CardTier } from '../../../haunt/src/blocks/cards';
import { chainBadge, chainReportHtml } from '../../../arena-ui/src/chain/export';
import { fromConfig } from '../../../arena-ui/src/chain/model';

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]!.startsWith('--')));
if (!file) { console.error('usage: npm run chain:grade -- <haunt.yaml> [--tier rookie|...|phoenix] [--min A|B|C|D] [--out dir]'); process.exit(2); }
const tier = (flag('--tier') ?? 'rookie') as CardTier;
if (!CARD_TIERS.includes(tier)) { console.error(`--tier must be one of ${CARD_TIERS.join(', ')}`); process.exit(2); }
const min = (flag('--min') ?? '').toUpperCase();
if (min && !'ABCD'.includes(min)) { console.error('--min must be A, B, C or D'); process.exit(2); }
const r = loadHauntConfig(resolve(file));
if (!r.ok) { console.error(`${file}:\n- ${r.errors.join('\n- ')}`); process.exit(2); }
const report = await chainReport(r.config, tier);
console.log(`${r.config.name}: grade ${report.grade} with ${tier} (${report.failed} of ${report.tried} attacks did not end clean)`);
for (const b of [...report.blame].sort((a, c) => c.failed - a.failed).filter((b) => b.failed > 0)) console.log(`  ${b.stage}: ${b.failed}/${b.tried} (${Math.round(b.share * 100)}%)`);
const out = flag('--out');
if (out) {
  mkdirSync(resolve(out), { recursive: true });
  writeFileSync(join(resolve(out), 'chaos-report.html'), chainReportHtml({ model: fromConfig(r.config), report, protections: tier }));
  writeFileSync(join(resolve(out), 'chaos-badge.svg'), chainBadge(report));
  console.log(`wrote ${join(out, 'chaos-report.html')} and ${join(out, 'chaos-badge.svg')}`);
}
const order = 'FDCBA';
const bad = min && order.indexOf(report.grade.charAt(0)) < order.indexOf(min);
if (bad) console.error(`grade ${report.grade} is below the minimum ${min}`);
process.exit(bad ? 1 : 0);
