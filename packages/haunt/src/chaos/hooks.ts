// Bot-side chaos: the armed list, hook matching and the kill rendezvous host.
// Spec: runtime.md section 3 (rendezvous) and section 19 (arming handshake).
import type { HookPoint, Host, Part, Sdk } from '../sdk';
import { ProcessKilled } from '../sdk';
import { CRASH_POINTS, RECOVERY_POINTS, faultById } from './catalog';

export interface ArmMsg {
  fault: string;
  point?: HookPoint;
  scope?: 'inner' | 'outer';
}

/**
 * Hooks where an inner crash fires. A bot with crash-recovery code (journal replay or reconcile)
 * uses the recovery hooks. A bot without it (Rookie, Retrier) just restarts, so `startup` is its recovery hook.
 */
export function innerPoints(parts: readonly Part[]): readonly HookPoint[] {
  const recovers = parts.includes('journal') || parts.includes('idempotency');
  return recovers ? RECOVERY_POINTS : ['startup', 'during_backoff'];
}

/** Does an armed crash-family fault fire at this hook? Shared by the bot and the director. */
export function matchesHook(arm: ArmMsg, point: HookPoint, inner: readonly HookPoint[]): boolean {
  if (arm.point) return arm.point === point;
  if (arm.scope === 'inner') return inner.includes(point);
  return (CRASH_POINTS as readonly string[]).includes(point);
}

export function isProcessFault(fault: string): boolean {
  return faultById(fault)?.kind === 'process';
}

/** Arms a bot holds. The SDK checks it at every hook. */
export class ArmedList {
  private arms: ArmMsg[] = [];

  constructor(private readonly inner: readonly HookPoint[]) {}

  add(a: ArmMsg): void {
    this.arms.push(a);
  }

  get size(): number {
    return this.arms.length;
  }

  /** The crash arm that fires at `point`, consumed, or null. */
  take(point: HookPoint): ArmMsg | null {
    const i = this.arms.findIndex((a) => isProcessFault(a.fault) && matchesHook(a, point, this.inner));
    if (i < 0) return null;
    return this.arms.splice(i, 1)[0]!;
  }
}

export interface ChaosHostOptions {
  parts: readonly Part[];
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Writes one JSON message to the runner. */
  send(msg: Record<string, unknown>): void;
  /** `child`: send `at_point` and block forever, the runner SIGKILLs us. `throw`: in-process stand-in. */
  mode: 'child' | 'throw';
}

/**
 * Host with the kill rendezvous. If no crash is armed, a hook never blocks.
 * Control messages from the runner (`go`, `arm`) go to `control()`.
 */
export class ChaosHost implements Host {
  readonly armed: ArmedList;
  private sdk: Sdk | null = null;

  constructor(private readonly o: ChaosHostOptions) {
    this.armed = new ArmedList(innerPoints(o.parts));
  }

  bind(sdk: Sdk): void {
    this.sdk = sdk;
  }

  now(): number {
    return this.o.now();
  }

  sleep(ms: number): Promise<void> {
    return this.o.sleep(ms);
  }

  emit(msg: Record<string, unknown>): void {
    this.o.send(msg);
  }

  control(msg: Record<string, unknown>): void {
    if (msg.k === 'go' && Array.isArray(msg.arms)) {
      for (const a of msg.arms as ArmMsg[]) this.arm(a);
    } else if (msg.k === 'arm') {
      this.arm(msg as unknown as ArmMsg);
    }
  }

  private arm(a: ArmMsg): void {
    if (a.fault === 'disk_full') {
      // A bot with no journal ignores it. The runner turns `absorbed` into chaos_absorbed.
      if (!this.sdk?.armDiskFull()) this.o.send({ k: 'absorbed', reason: 'no journal' });
      return;
    }
    if (isProcessFault(a.fault)) this.armed.add(a);
  }

  async hook(point: HookPoint, ctx: { order?: string; stage?: string }): Promise<void> {
    const a = this.armed.take(point);
    if (!a) return;
    if (this.o.mode === 'throw') throw new ProcessKilled(`${a.fault}@${point}`);
    this.o.send({ k: 'at_point', point, fault: a.fault, ...ctx });
    // The runner kills this process. Never busy-wait.
    await new Promise<void>(() => {});
  }
}
