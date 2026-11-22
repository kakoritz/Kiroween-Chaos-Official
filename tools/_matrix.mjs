import { readFileSync } from 'node:fs';
import { client } from './lib/haunt-client.mjs';
const nights = JSON.parse(readFileSync('packages/core/campaign/nights.json','utf8'));
const c = client('http://127.0.0.1:7171');
await new Promise(r=>setTimeout(r,500));
const jobs = process.argv.slice(2).map(a=>{const [n,g='']=a.split(':');return {n:Number(n),g:g==='-'?[]:g.split(',').filter(Boolean)};});
function medal(night,s){ let best='none'; for(const t of ['bronze','silver','gold']){const m=night.medals[t]; const per=(s.downtimeMs??Infinity)/4; if(!(s.score>=m.credits)|| (m.repeats!==undefined&&!(s.repeats<=m.repeats))||(m.avgStars!==undefined&&!(s.stars?.avg>=m.avgStars))||(m.cancelled!==undefined&&!(s.orders.cancelled<=m.cancelled))||(m.abandoned!==undefined&&!(s.orders.abandoned<=m.abandoned))||(m.maxDowntimeMsPerOrder!==undefined&&!(per<=m.maxDowntimeMsPerOrder))) break; best=t;} return best; }
for (const j of jobs) {
  const night = nights.find(x=>x.id===j.n);
  const r = await c.post('/api/wave/start', { campaign: { night:j.n, parts:j.g }, speed: 4 });
  if (r.status!==200) { console.log(j.n, r.json); continue; }
  const W = r.json.wave;
  const end = await c.waitFor(e=>e.type==='wave_end'&&e.wave===W, 400000, 0);
  const S = end.detail.summary; const s=S['1'];
  console.log(`N${j.n} [${j.g.join(',')||'none'}] ${medal(night,s)} score=${s.score} rep=${s.repeats} orders=${JSON.stringify(s.orders)} stars=${s.stars?.avg} down=${s.downtimeMs} issues=${s.issues} | rivals ${[2,3,4,5].map(l=>S[l]?.score+'/'+S[l]?.orders.cancelled).join(' ')}`);
  await new Promise(r=>setTimeout(r,500));
}
c.close(); process.exit(0);
