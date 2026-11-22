import { client } from './lib/haunt-client.mjs';
const c = client('http://127.0.0.1:7171');
await new Promise(r=>setTimeout(r,500));
const W=(await c.post('/api/wave/start', { campaign: { night:1, parts:[] }, speed: 4 })).json.wave;
await new Promise(r=>setTimeout(r,6000));
const ss = c.events.filter(e=>e.type==='stage_start'&&String(e.lane)==='1').slice(0,12);
console.log(ss.map(e=>e.stage+':'+JSON.stringify(e.detail)).join('\n'));
await c.post('/api/wave/stop');
c.close(); process.exit(0);
