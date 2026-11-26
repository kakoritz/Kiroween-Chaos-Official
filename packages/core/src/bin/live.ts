// `npm run live`: starts the live server on 127.0.0.1:7070 and the provider on 127.0.0.1:7071. Optional first argument: port. `HAUNT_PORT` and `HAUNT_PROVIDER_PORT` override the two ports (a second server can run beside the first).
import { join } from 'node:path';
import { EventLog } from '../../../haunt/src/events/eventlog';
import { LIVE_PORT, LiveServer, createLiveRuntime, loopFixEvents, makeBotCommand, readHardening } from '../live';
import { startProvider } from '../provider/server';
import { registerAppFromDir } from '../../../haunt/src/config/register-dir';
import { registerBundledApps } from '../../../haunt/src/config/bundled-apps';

// Apps that ship as config only (Haunted Playback, Coffee Shop) sit next to the three built-in apps.
for (const r of registerBundledApps()) if (!r.ok) console.error(`bundled app skipped:\n- ${r.errors.join('\n- ')}`);
// `--app <dir>` (repeatable): register an app from a folder with a haunt.yaml. A bad manifest stops the start with a plain message.
process.argv.forEach((a, i, all) => {
  if (a !== '--app') return;
  const dir = all[i + 1];
  const r = dir ? registerAppFromDir(dir) : { ok: false as const, errors: ['--app needs a folder'] };
  if (!r.ok) { console.error(`cannot register app:\n- ${r.errors.join('\n- ')}`); process.exit(2); }
  console.log(`registered app ${r.app.id} (${r.app.stages.length} stages)`);
});
const port = Number(process.argv.find((a, i) => i >= 2 && /^\d+$/.test(a)) ?? process.env.HAUNT_PORT ?? LIVE_PORT);
const runDir = join(process.cwd(), '.haunt');
const provider = await startProvider({ port: Number(process.env.HAUNT_PROVIDER_PORT) || undefined });
// `--loop`: lane 1 (Rookie) runs the recorded hardened bundle from wave 2 on (runtime.md section 32).
const loop = process.argv.includes('--loop');
// Lanes spawn dist/bots/<tier>.js per lane (npm run build:bots). A tier with no built bot is left unspawned; demos and chaos still arm the director.
const botCommand = makeBotCommand({
  root: process.cwd(), runDir, providerUrl: provider.url, policyDir: join(runDir, 'lessons'),
  onWave: () => provider.provider.reset(),
  bundleFor: (lane, wave, tier) => (loop && lane === '1' && tier === 'rookie' && wave >= 2 ? 'rookie.hardened' : undefined),
});
const specsDir = join(process.cwd(), '.kiro', 'specs');
const rt = createLiveRuntime({
  botCommand,
  // Provider faults (http_500, order_typo, ...) land on the provider the bots call.
  post: async (body) => { provider.provider.addFault(body); },
  ledgerRows: (lane) => provider.provider.ledger(lane),
  // Loop: when lane 1 swaps to the hardened bundle, emit the reviewer spec, the recorded fix and the new parts before wave_start (runtime.md section 32).
  betweenWaves: loop
    ? (prev, next) => (next >= 2 && prev < 2
      ? loopFixEvents({
        lane: '1', root: process.cwd(),
        beforeSrc: 'apps/haunted-orders/src/bots/rookie.ts', afterSrc: 'apps/haunted-orders/src/bots/rookie.hardened.ts',
        beforeBundle: join(process.cwd(), 'dist', 'bots', 'rookie.js'), afterBundle: join(process.cwd(), 'dist', 'bots', 'rookie.hardened.js'),
        hardening: () => readHardening(specsDir),
      })
      : [])
    : undefined,
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
console.log(`live server on ${url}, provider on ${provider.url}`);
const stop = () => void Promise.all([server.close(), provider.close()]).then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
