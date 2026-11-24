// Video jobs for a Stream lane: `ord-0001.json ...` in the lane folder, the same file protocol as the orders and the inbox.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TITLES = ['Crypt Cam', 'Haunted Hallway', 'Moonlit Graveyard', 'Spooky Cooking Show', 'Ghost Ride', 'Raven Report', 'Midnight News', 'Candle Craft'];

export function streamJob(i: number): { id: string; title: string; durationS: number; owner: string } {
  const id = `ord-${String(i).padStart(4, '0')}`;
  return { id, title: TITLES[(i - 1) % TITLES.length]!, durationS: 60 + ((i * 37) % 540), owner: `creator${i}@example.test` };
}

/** Writes `count` job files into a lane's orders folder. */
export function writeStreamJobs(dir: string, count: number): void {
  for (let i = 1; i <= count; i++) writeFileSync(join(dir, `ord-${String(i).padStart(4, '0')}.json`), JSON.stringify(streamJob(i)));
}
