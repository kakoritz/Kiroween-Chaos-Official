// The Stream pipeline: five stages on the shared SDK (stream-pack-app SP-C2). Same `run(id)` contract as the orders Pipeline,
// so journal, keys, retry, breaker and the offline queue come from the SDK and nothing in the harness is forked.
import { LaneHalted, stageDuration, type PipelineDeps, type PipelineResult, type StageDef } from '../../../packages/haunt/src/pipeline';
import { STREAM_STAGES } from '../../../packages/haunt/src/shared/catalog';

export const STREAM_WORK: readonly StageDef[] = STREAM_STAGES.map((s) => ({ id: s.id, label: s.label, min: s.min, max: s.max }));

export class StreamPipeline {
  private readonly runs = new Map<string, number>();
  private readonly idem: boolean;

  constructor(private readonly d: PipelineDeps) {
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
    const def = STREAM_WORK.find((s) => s.id === stage)!;
    const k = `${order}|${stage}`;
    const n = (this.runs.get(k) ?? 0) + 1;
    this.runs.set(k, n);
    return stageDuration(def, this.d.seed, this.d.lane, order, this.d.attempt ?? 1, n) / (this.d.speed ?? 1);
  }

  private key(s: { key(n: string): string }, name: string): string | undefined {
    return this.idem ? s.key(name) : undefined;
  }

  private async stages(id: string): Promise<void> {
    const { sdk } = this.d;
    let asset = '';
    await sdk.stage('fetch', async (s) => {
      await s.work(this.work('fetch', id));
      asset = idOf(await s.effect('store', { key: this.key(s, 'store:1'), index: 1, body: { step: 'fetch', video: id } }));
    });
    asset ||= idOf(sdk.recorded('fetch', 'store'));
    await sdk.stage('classify', async (s) => {
      await s.work(this.work('classify', id));
    });
    await sdk.stage('draft', async (s) => {
      await s.work(this.work('draft', id));
      await s.effect('dispatch', { key: this.key(s, 'dispatch'), body: { asset } });
    });
    await sdk.stage('reply', async (s) => {
      await s.work(this.work('reply', id));
      await s.effect('notify', { key: this.key(s, 'notify:1'), index: 1 });
    });
    await sdk.stage('archive', async (s) => {
      await s.work(this.work('archive', id));
      await s.effect('store', { key: this.key(s, 'store:2'), index: 2, body: { step: 'archive', asset } });
    });
  }
}

function idOf(v: unknown): string {
  const id = (v as { id?: unknown } | null | undefined)?.id;
  return id === undefined ? '' : String(id);
}
