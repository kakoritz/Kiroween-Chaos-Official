// The lessons ledger on disk (node only). The learning rules and the overlay are pure (./lessons).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TierId } from '../shared/catalog';
import type { Policy } from '../sdk/policy';
import type { Case } from './signature';
import { emptyLessons, learnRound, policyOf, type LaneLessons, type LearnResult } from './lessons';

// ------------------------------------------------------------------------------------------------------------------ store

export class LessonsStore {
  constructor(readonly dir: string) {}

  private file(lane: number): string { return join(this.dir, `${lane}.json`); }
  policyFile(lane: number): string { return join(this.dir, `lane-${lane}.policy.json`); }

  get(lane: number, tier: TierId): LaneLessons {
    try {
      const raw = JSON.parse(readFileSync(this.file(lane), 'utf8')) as Partial<LaneLessons>;
      return { lane, tier, lessons: raw.lessons ?? [], suggestions: raw.suggestions ?? [], overcame: raw.overcame ?? [] };
    } catch { return emptyLessons(lane, tier); }
  }

  save(l: LaneLessons): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(l.lane), JSON.stringify(l, null, 2) + '\n');
  }

  /** Write the overlay for the next round: lessons learned up to and including `round - 1`. An empty overlay removes the file. */
  writePolicy(l: LaneLessons, round?: number): Policy {
    const p = policyOf(l, round);
    mkdirSync(this.dir, { recursive: true });
    if (p.rules.length) writeFileSync(this.policyFile(l.lane), JSON.stringify(p, null, 2) + '\n');
    else rmSync(this.policyFile(l.lane), { force: true });
    return p;
  }

  /** Learn from a round, save, and return what is new. */
  learn(lane: number, tier: TierId, cases: readonly Case[], round: number): LearnResult {
    const r = learnRound(this.get(lane, tier), cases, round);
    this.save(r.next);
    return r;
  }

  lanes(): number[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter((x): x is string => !!x).map(Number).sort((a, b) => a - b);
  }

  /** `DELETE /api/lessons`: forget everything. */
  reset(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
