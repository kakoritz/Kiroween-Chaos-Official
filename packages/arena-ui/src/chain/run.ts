// "Run in the arena" (chain-wizard-v2 R2): hand the chain to the real arena. Pure of the DOM: fetch and storage are passed in.
// With a live server on this origin the chain is registered there (real bots, real ledger). On the hosted page there is no server,
// so the haunt.yaml goes through sessionStorage and the hosted page registers it in the browser engine.
export const CHAIN_HANDOFF_KEY = 'haunt:chain';

export interface RunDeps {
  fetchFn?: typeof fetch;
  store?: Pick<Storage, 'setItem'>;
}

export type RunResult =
  | { ok: true; where: 'live' | 'hosted'; url: string; id?: string }
  | { ok: false; error: string };

export async function sendToArena(yamlText: string, deps: RunDeps = {}): Promise<RunResult> {
  const f = deps.fetchFn ?? fetch;
  let live = false;
  try {
    const r = await f('./api/health');
    live = r.ok && ((await r.json()) as { mode?: string }).mode === 'live';
  } catch { live = false; }
  if (live) {
    const reg = await f('./api/apps/register', { method: 'POST', body: JSON.stringify({ manifest: yamlText }) });
    const body = (await reg.json().catch(() => ({}))) as { id?: string; error?: { message?: string } | string; message?: string };
    if (!reg.ok || !body.id) return { ok: false, error: `The arena refused the chain: ${typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? reg.status}` };
    const sw = await f('./api/app', { method: 'POST', body: JSON.stringify({ app: body.id }) });
    if (!sw.ok) return { ok: false, error: `The arena would not switch to the chain (status ${sw.status}). Stop the running wave and try again.` };
    return { ok: true, where: 'live', url: './index.html?splash=0', id: body.id };
  }
  const store = deps.store ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!store) return { ok: false, error: 'No arena to hand the chain to (no server and no browser storage).' };
  try { store.setItem(CHAIN_HANDOFF_KEY, yamlText); } catch { return { ok: false, error: 'The browser would not keep the chain for the next page.' }; }
  return { ok: true, where: 'hosted', url: './hosted.html?splash=0' };
}
