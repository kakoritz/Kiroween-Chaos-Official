import { loadCampaign } from '../packages/haunt/src/campaign/nights';
import { computeMedal } from '../packages/haunt/src/campaign/medals';
import { simulateNight } from '../packages/core/src/campaign/night-sim';
const nights = loadCampaign().nights;
const sets: Record<string, string[]> = { none: [], J: ['journal'], I: ['idempotency'], R: ['retry'], B: ['breaker'], Q: ['offline_queue'], JI: ['journal','idempotency'], RB: ['retry','breaker'], QJ: ['offline_queue','journal'], BQR: ['breaker','offline_queue','retry'], all: ['retry','journal','idempotency','breaker','offline_queue'] };
const only = process.argv.slice(2).map(Number);
for (const n of nights) {
  if (only.length && !only.includes(n.id)) continue;
  for (const [k, parts] of Object.entries(sets)) {
    const r = await simulateNight(n, parts as never);
    const s = r.summary;
    console.log(`N${n.id} ${k.padEnd(4)} ${computeMedal(n, s).padEnd(6)} score=${s.score} rep=${s.repeats} orders=${JSON.stringify(s.orders)} stars=${s.stars?.avg} down=${s.downtimeMs}`);
  }
}
