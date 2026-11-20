// `npm run live`: starts the live server on 127.0.0.1:7070 and the provider on 127.0.0.1:7071. Optional first argument: port.
import { join } from 'node:path';
import { EventLog } from '../../../haunt/src/events/eventlog';
import { LIVE_PORT, LiveServer, createLiveRuntime, makeBotCommand, readHardening } from '../live';
import { startProvider } from '../provider/server';

const port = Number(process.argv[2] ?? process.env.HAUNT_PORT ?? LIVE_PORT);
const runDir = join(process.cwd(), '.haunt');
const provider = await startProvider();
// Lanes spawn dist/bots/<tier>.js per lane (npm run build:bots). A tier with no built bot is left unspawned; demos and chaos still arm the director.
const rt = createLiveRuntime({ botCommand: makeBotCommand({ root: process.cwd(), runDir, providerUrl: provider.url }), ledgerRows: (lane) => provider.provider.ledger(lane) });
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
