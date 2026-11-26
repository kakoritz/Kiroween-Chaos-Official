// The stage to blame when an event stream does not say where something happened. Orders keep `payment`; an app registered from a
// haunt.yaml uses its own first effect stage, so a Casebook or a corpse never names a stage that app does not have.
import { APPS } from '../shared/catalog';
import { isBuiltinApp, isRegisteredApp } from '../shared/registry';

export function fallbackStage(events: readonly { type?: unknown; detail?: unknown }[]): string {
  const ws = events.find((e) => e.type === 'wave_start');
  const app = (ws?.detail as { app?: unknown } | undefined)?.app;
  if (typeof app === 'string' && isRegisteredApp(app) && !isBuiltinApp(app)) {
    const a = APPS[app]!;
    return (a.stages.find((s) => s.effects.length > 0) ?? a.stages[0]!).id;
  }
  return 'payment';
}
