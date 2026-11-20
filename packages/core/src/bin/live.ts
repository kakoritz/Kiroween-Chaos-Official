// `npm run live`: starts the live server on 127.0.0.1:7070 and the provider on 127.0.0.1:7071. Optional first argument: port.
import { join } from 'node:path';
import { EventLog } from '../../../haunt/src/events/eventlog';
import { LIVE_PORT, LiveServer, createLiveRuntime, makeBotCommand, readHardening } from '../live';
import { startProvider } from '../provider/server';

const port = Number(process.argv.find((a, i) => i >= 2 && /^\d+$/.test(a)) ?? process.env.HAUNT_PORT ?? LIVE_PORT);
const runDir = join(process.cwd(), '.haunt');
const provider = await startProvider();
// `--loop`: lane 1 (Rookie) runs the recorded hardened bundle from wave 2 on (runtime.md section 32).
const loop = process.argv.includes('--loop');
// Lanes spawn dist/bots/<tier>.js per lane (npm run build:bots). A tier with no built bot is left unspawned; demos and chaos still arm the director.
const botCommand = makeBotCommand({
  root: process.cwd(), runDir, providerUrl: provider.url,
  onWave: () => provider.provider.reset(),
  bundleFor: (lane, wave, tier) => (loop && lane === '1' && tier === 'rookie' && wave >= 2 ? 'rookie.hardened' : undefined),
});
const rt = createLiveRuntime({ botCommand, ledgerRows: (lane) => provider.provider.ledger(lane) });
const server = new LiveServer({
  log: new EventLog(join(runDir, 'events.jsonl')),
  engine: rt.live,
  ledger: rt.ledger,
  hardening: () => readHardening(join(process.cwd(), '.kiro', 'specs')),
});
const { url } = await server.listen(port);
console.log(`live server on ${url}, provider on ${provider.url}`);
const stop = () => void Promise.all([server.close(), provider.close()]).then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
