// Job files for a generic-app lane: `ord-0001.json ...` in the lane folder, the same file protocol as every app.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Writes `count` job files into a lane's orders folder: `ord-0001.json ...`, the same file protocol as every app. */
export function writeGenericJobs(dir: string, count: number): void {
  if (!existsSync(dir)) return;
  for (let i = 1; i <= count; i++) writeFileSync(join(dir, `ord-${String(i).padStart(4, '0')}.json`), JSON.stringify({ id: `ord-${String(i).padStart(4, '0')}`, title: `Job ${i}`, owner: `user${i}@example.test` }));
}
