// `npm run live`: starts the live server on 127.0.0.1:7070. Optional first argument: port.
import { join } from 'node:path';
import { EventLog } from '../../../haunt/src/events/eventlog';
import { LIVE_PORT, LiveServer } from '../live';

const port = Number(process.argv[2] ?? process.env.HAUNT_PORT ?? LIVE_PORT);
const runDir = join(process.cwd(), '.haunt');
const server = new LiveServer({ log: new EventLog(join(runDir, 'events.jsonl')) });
const { url } = await server.listen(port);
console.log(`live server on ${url}`);
const stop = () => void server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
