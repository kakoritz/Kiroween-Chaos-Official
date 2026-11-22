import { readFileSync } from 'node:fs';
const W = Number(process.argv[2]); const L = process.argv[3]||'1';
const l=readFileSync('.haunt/events.jsonl','utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x));
let start=-1; l.forEach((e,i)=>{ if(e.type==='wave_start'&&e.wave===W) start=i; });
const types=(process.argv[4]||'chaos,process_dead,repeat,order_failed,order_done,recover_start,stage_fail,order_parked,lane_halted,breaker,boss_start,boss_end,outage,curse,intensity').split(',');
for(let i=start;i<l.length;i++){ const e=l[i]; if(i>start&&e.type==='wave_start') break; if((e.lane===undefined||String(e.lane)===L)&&types.includes(e.type)) console.log(e.seq,e.type,e.order||'',e.stage||'',JSON.stringify(e.detail||{}).slice(0,200)); }
