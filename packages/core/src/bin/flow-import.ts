// `npm run flow:import -- <workflow.json> [--out haunt.yaml]`: reads an n8n export or a Zapier-style step list and writes a haunt.yaml chain of library blocks.
// Every guess is printed with its reason. Check them, then grade the chain: npm run chain:grade -- haunt.yaml
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importFlow, importedBlocks } from '../../../haunt/src/import/flow-import';
import { addBlock, emptyChain, toYaml } from '../../../arena-ui/src/chain/model';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]!.startsWith('--')));
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
if (!file) { console.error('usage: npm run flow:import -- <workflow.json> [--out haunt.yaml]'); process.exit(2); }
let text: string;
try { text = readFileSync(resolve(file), 'utf8'); } catch { console.error(`cannot read ${file}`); process.exit(2); }
const r = importFlow(text);
if (!r.ok) { console.error(r.error); process.exit(1); }
console.log(`${r.source} flow "${r.name}": ${r.steps.length} steps`);
for (const s of r.steps) console.log(`  ${s.from}  ->  ${s.block}  (${s.why})`);
for (const n of r.notes) console.log(`note: ${n}`);
const chain = importedBlocks(r).reduce(addBlock, emptyChain(r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported-flow'));
const yaml = toYaml(chain);
if (out) { writeFileSync(resolve(out), yaml); console.log(`wrote ${out}`); } else process.stdout.write('\n' + yaml);
