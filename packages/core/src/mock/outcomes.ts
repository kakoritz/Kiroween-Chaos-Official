// The outcome-template table of runtime.md section 15, loaded from packages/core/mock/outcomes.json.
// The JSON is generated from the shared resolver (npm run make:outcomes) so the mock and the tests share one source.
import { allOutcomeRows, type AppId, type OutcomeRow, type TierId } from '@haunt/shared';

export const APP_LIST: AppId[] = ['orders', 'inbox'];

/** The full table, in the shape that is written to packages/core/mock/outcomes.json. */
export function buildOutcomeTable(): OutcomeRow[] {
  return APP_LIST.flatMap((app) => allOutcomeRows(app));
}

export class OutcomeTable {
  private readonly index = new Map<string, OutcomeRow>();

  constructor(public readonly rows: OutcomeRow[]) {
    for (const r of rows) this.index.set(OutcomeTable.key(r.app, r.tier, r.fault, r.stage, r.point), r);
  }

  static key(app: string, tier: string, fault: string, stage: string, point?: string): string {
    return [app, tier, fault, stage, point ?? ''].join('|');
  }

  /** Given (app, tier, fault, stage, point) return the template row, or undefined when the fault does not apply. */
  lookup(app: AppId, tier: TierId, fault: string, stage: string, point?: string): OutcomeRow | undefined {
    return this.index.get(OutcomeTable.key(app, tier, fault, stage, point)) ?? this.index.get(OutcomeTable.key(app, tier, fault, stage));
  }
}
