import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveServer } from '../packages/core/src/live/server';
import { createSimEngine } from '../packages/core/src/sim/engine';
const seed = Number(process.argv[2] ?? 7);
const dir = mkdtempSync(join(tmpdir(), 'probe-'));
const lessonsDir = join(dir, 'lessons');
const srv = new LiveServer({ engine: createSimEngine({ policyDir: lessonsDir }), staticDir: '/nonexistent', lessonsDir, patternsFile: join(dir, 'p.json'), runDir: dir, specsDir: join(dir, 'specs') });
const { url } = await srv.listen(0);
await fetch(url + '/api/improve', { method: 'POST', body: JSON.stringify({ seed }) });
let j: any;
for (;;) { j = await (await fetch(url + '/api/improve')).json(); if (j.phase === 'done' || j.phase === 'error') break; await new Promise((r) => setTimeout(r, 50)); }
const evs = srv.log.events;
const ends = evs.filter((e) => e.type === 'tournament_end').length;
const tab: Record<string, Record<string, number>> = {};
let phase = 0; 
for (const e of evs) {
  if (e.type === 'tournament_end') phase++;
  if (!e.lane) continue;
  const k = `${phase ? 'after' : 'before'} lane${e.lane}`;
  const t = (tab[k] ??= { started: 0, done: 0, failed: 0, repeat: 0 });
  if (e.type === 'order_start') t.started++;
  if (e.type === 'order_done') t.done++;
  if (e.type === 'order_failed') t.failed++;
  if (e.type === 'repeat') t.repeat++;
}
console.log(j.report?.summary, j.report?.grade, j.report?.reliability, j.error, ends);
console.table(tab);
console.log(JSON.stringify(j.report?.patterns.slice(0, 12).map((p: any) => [p.signature, p.handling, p.before, p.after, p.lanes])));
await srv.close();
