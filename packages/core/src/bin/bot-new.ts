// `npm run bot:new -- <haunt.yaml> [--lang node|python] [--out <folder>]`: writes a runnable naive bot for your app (docs/INTEGRATE.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { loadHauntConfig } from '../../../haunt/src/config/load';
import { botStarter, type BotLang } from '../../../haunt/src/scaffold/bot-starter';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]!.startsWith('--')));
if (!file) { console.error('usage: npm run bot:new -- <haunt.yaml> [--lang node|python] [--out <folder>]'); process.exit(2); }
const lang = (flag('--lang') ?? 'node') as BotLang;
if (lang !== 'node' && lang !== 'python') { console.error('--lang must be node or python'); process.exit(2); }
const r = loadHauntConfig(resolve(file));
if (!r.ok) { console.error(`${file}:\n- ${r.errors.join('\n- ')}`); process.exit(1); }
const out = resolve(flag('--out') ?? join(dirname(resolve(file)), 'bot'));
mkdirSync(out, { recursive: true });
const target = join(out, lang === 'node' ? 'bot.mjs' : 'bot.py');
writeFileSync(target, botStarter(r.config, lang));
const rel = (p: string): string => relative(process.cwd(), p) || '.';
console.log(`wrote ${rel(target)} (${r.config.stages.length} stages: ${r.config.stages.map((s) => s.id).join(', ')})`);
console.log(`run it:  npm run own-bot -- ${rel(target)} --app ${rel(dirname(resolve(file)))}`);
console.log('It is naive on purpose. Chaos will break it; the HARDEN comments say where each fix goes.');
