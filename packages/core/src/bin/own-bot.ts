// `npm run own-bot -- <path-or-command> [--app <dir>]`: starts the live server on 127.0.0.1:7070 with your bot on every lane and prints the arena URL.
// Same wiring as bin/live.ts. With no --app the Stream app is selected: its stages are fetch, draft and reply (docs/OWN-BOT.md). With `--app <dir>` your own app (a folder with a haunt.yaml, docs/INTEGRATE.md) is registered and selected, so your bot uses your own stage names. Fixes are never applied for you.
import { join } from 'node:path';
import { EventLog } from '../../../haunt/src/events/eventlog';
import { LIVE_PORT, LiveServer, createLiveRuntime, makeBotCommand, readHardening, resolveOwnBot } from '../live';
import { startProvider } from '../provider/server';
import { registerAppFromDir } from '../../../haunt/src/config/register-dir';

const raw = process.argv.slice(2);
const appAt = raw.indexOf('--app');
let appId = 'stream';
if (appAt >= 0) {
  const dir = raw[appAt + 1];
  const r = dir ? registerAppFromDir(dir) : { ok: false as const, errors: ['--app needs a folder with a haunt.yaml'] };
  if (!r.ok) { console.error(`cannot register app:\n- ${r.errors.join('\n- ')}`); process.exit(2); }
  appId = r.app.id;
  raw.splice(appAt, 2);
}
const args = raw.filter((a) => !/^\d+$/.test(a));
const bot = resolveOwnBot(args.join(' '));
if (!bot.ok) {
  console.error(bot.error);
  process.exit(2);
}
const port = Number(raw.find((a) => /^\d+$/.test(a)) ?? process.env.HAUNT_PORT ?? LIVE_PORT);
const runDir = join(process.cwd(), '.haunt');
const provider = await startProvider({ port: Number(process.env.HAUNT_PROVIDER_PORT) || undefined });
const botCommand = makeBotCommand({
  root: process.cwd(), runDir, providerUrl: provider.url, policyDir: join(runDir, 'lessons'),
  onWave: () => provider.provider.reset(),
  custom: { command: bot.command, args: bot.args },
});
const specsDir = join(process.cwd(), '.kiro', 'specs');
const rt = createLiveRuntime({
  botCommand,
  post: async (body) => { provider.provider.addFault(body); },
  ledgerRows: (lane) => provider.provider.ledger(lane),
});
provider.provider.onRow = rt.ledgerRow;
provider.provider.onCurse = (h) => rt.engine.noteCurse(h);
provider.provider.onReplay = (row) => rt.ledgerRow(row, true);
const server = new LiveServer({
  log: new EventLog(join(runDir, 'events.jsonl')),
  engine: rt.live,
  ledger: rt.ledger,
  hardening: () => readHardening(specsDir),
  runDir,
  specsDir,
});
const { url } = await server.listen(port);
const sw = await fetch(`${url}/api/app`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: appId }) });
if (!sw.ok) console.error(`could not select the ${appId} app (${sw.status}); pick it in the arena app switcher`);
console.log(`own bot: ${[bot.command, ...bot.args].join(' ')}`);
console.log(`arena: ${url}   (provider ${provider.url}, fake, local only)`);
console.log('Start a wave in the arena. Ctrl+C stops.');
const stop = () => void Promise.all([server.close(), provider.close()]).then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
