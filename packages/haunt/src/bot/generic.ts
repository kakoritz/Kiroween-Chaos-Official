// The generic bot (modular-engine M5, R5): a runnable bot for any app manifest. Same SDK and parts as the Orders and Stream bots,
// so the five tiers behave the same way: a Rookie repeats an effect after a crash, a Reconciler or Phoenix does not.
// Node only (reads the manifest folder at start).
import { LaneHalted, stageDuration, type PipelineDeps, type PipelineResult, type StageDef } from '../pipeline';
import { APPS, type AppDef } from '../shared/catalog';
import { PROVIDER_KINDS } from '../blocks/library';
import { registerAppFromDir } from '../config/register-dir';
import { defineBot, type BotDef } from './runtime';

/** The provider kind an effect is written as. The ledger kind `account_create` is posted to the `account` endpoint; a kind the fake provider does not know is stored as `store`, with the declared kind in the body. */
export const providerKind = (kind: string): string => (kind === 'account_create' ? 'account' : PROVIDER_KINDS.includes(kind) ? kind : /^[a-z][a-z0-9_]{1,31}$/.test(kind) && kind !== 'tracking' && kind !== 'handoff' ? kind : 'store');

export const workTable = (app: AppDef): readonly StageDef[] => app.stages.map((s) => ({ id: s.id, label: s.label, min: s.min, max: s.max }));

export class GenericPipeline {
  private readonly runs = new Map<string, number>();
  private readonly idem: boolean;

  constructor(private readonly d: PipelineDeps, private readonly app: AppDef) {
    this.idem = d.tier.use.includes('idempotency');
  }

  async run(id: string): Promise<PipelineResult> {
    let halted = false;
    const res = await this.d.sdk.order(id, async () => {
      try {
        await this.stages(id);
      } catch (e) {
        if (e instanceof LaneHalted) halted = true;
        throw e;
      }
    });
    if (halted) throw new LaneHalted(`lane ${this.d.lane} halted on ${id}`);
    return res;
  }

  private work(stage: string, order: string): number {
    const def = this.app.stages.find((s) => s.id === stage)!;
    const k = `${order}|${stage}`;
    const n = (this.runs.get(k) ?? 0) + 1;
    this.runs.set(k, n);
    return stageDuration({ id: def.id, label: def.label, min: def.min, max: def.max }, this.d.seed, this.d.lane, order, this.d.attempt ?? 1, n) / (this.d.speed ?? 1);
  }

  private async stages(id: string): Promise<void> {
    const { sdk } = this.d;
    // The provider counts a repeat per (order, kind, index): each use of a kind in one order gets the next index, so two payments in one order are two rows, and a crash that redoes one is the repeat.
    const used = new Map<string, number>();
    for (const st of this.app.stages) {
      await sdk.stage(st.id, async (s) => {
        await s.work(this.work(st.id, id));
        for (const e of st.effects) {
          const kind = providerKind(e.kind);
          const index = (used.get(kind) ?? 0) + 1;
          used.set(kind, index);
          // The key follows the provider's own repeat identity (order, kind, index), as the Orders bots do, so a `repeat` event reads as the effect that caused it.
          const ledgerKind = kind === 'account' ? 'account_create' : kind;
          await s.effect(kind, { key: this.idem ? s.key(`${ledgerKind}:${index}`) : undefined, index, body: { step: st.id, declared: e.kind, order: id } });
        }
      });
    }
  }
}

/** A tier bot for the app named by `HAUNT_APP`, loaded from the folder in `HAUNT_APP_DIR` (set by the live runner). */
export function defineGenericBot(def: BotDef): BotDef {
  const id = process.env.HAUNT_APP ?? '';
  const dir = process.env.HAUNT_APP_DIR;
  if (dir && !APPS[id]) {
    const r = registerAppFromDir(dir);
    if (!r.ok) { process.stderr.write(`generic bot: cannot load app from ${dir}:\n- ${r.errors.join('\n- ')}\n`); process.exit(1); }
  }
  const app = APPS[id] ?? (process.argv.includes('--parts') ? APPS.orders! : undefined);
  if (!app) { process.stderr.write(`generic bot: app "${id}" is not registered (set HAUNT_APP and HAUNT_APP_DIR)\n`); process.exit(1); }
  return defineBot({ ...def, pipeline: (d) => new GenericPipeline(d, app), stages: workTable(app) });
}
