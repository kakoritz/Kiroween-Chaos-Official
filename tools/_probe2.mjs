import { client } from './lib/haunt-client.mjs';
const c = client('http://127.0.0.1:7171');
await new Promise(r=>setTimeout(r,500));
const night = Number(process.argv[2]); const parts = (process.argv[3]||'').split(',').filter(Boolean);
const W = (await c.post('/api/wave/start', { campaign: { night, parts }, speed: 4 })).json.wave;
await c.waitFor(e=>e.type==='wave_end'&&e.wave===W, 300000, 0);
for (const e of c.events.filter(e=>e.wave===W)) {
  if (String(e.lane)==='1' && ['chaos','repeat','order_failed','order_done','order_parked','recover_start','world','curse','intensity','stage_fail','boss_start','lane_halted'].includes(e.type)) console.log(e.type, e.order, e.stage, JSON.stringify(e.detail).slice(0,160));
  if (e.lane===undefined && !['wave_start','wave_end'].includes(e.type)) console.log('G', e.type, JSON.stringify(e.detail||{}).slice(0,120));
}
c.close(); process.exit(0);
