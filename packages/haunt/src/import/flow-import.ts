// Import an existing automation (n8n workflow JSON or a Zapier-style step list) as a chain of library blocks (third build list, item 2).
// Pure: JSON in, a list of block ids out. The guess is by node type and name, and every guess is reported so the owner can fix it.
import { blockById } from '../blocks/library';
import { parseYaml } from '../config/yaml';

export interface ImportedStep { from: string; block: string; why: string }
export interface ImportResult { ok: true; name: string; source: 'n8n' | 'zapier' | 'github-actions' | 'langgraph'; steps: ImportedStep[]; notes: string[] }
export type ImportOutcome = ImportResult | { ok: false; error: string };

type Rule = { test: RegExp; block: string; why: string };
// First match wins. Tested against "<type> <name>" in lower case. Effects first (they are what chaos hurts), then inputs, polls, work.
const RULES: Rule[] = [
  { test: /actions\/checkout|git clone|git pull|\bfetch\b/, block: 'read_request', why: 'gets the input' },
  { test: /deploy|release|publish|rollout|docker push|kubectl|helm|terraform apply|\bpush\b/, block: 'dispatch_job', why: 'sends work out' },
  { test: /stripe|paypal|payment|charge|invoice|checkout|\bpay\b|billing/, block: 'charge', why: 'takes money' },
  { test: /refund/, block: 'refund', why: 'gives money back' },
  { test: /gmail|sendgrid|mailgun|smtp|send ?email|emailsend|outlook|mailchimp|\bmail\b/, block: 'send_email', why: 'sends mail' },
  { test: /slack|telegram|discord|twilio|sms|whatsapp|teams|pushover|notif/, block: 'notify', why: 'tells someone' },
  { test: /jira|zendesk|freshdesk|helpscout|intercom|ticket|servicenow/, block: 'file_ticket', why: 'files a ticket' },
  { test: /shopify|woocommerce|\border\b|purchase/, block: 'place_order', why: 'places an order' },
  { test: /signup|sign-up|register|createuser|create ?account|auth0|cognito|newuser/, block: 'create_account', why: 'creates an account' },
  { test: /ship|deliver|dispatch|fedex|ups\b|dhl|job queue/, block: 'dispatch_job', why: 'sends work out' },
  { test: /postgres|mysql|mongodb|mongo|redis|airtable|googlesheets|google sheets|sheets|notion|supabase|dynamodb|s3\b|dropbox|database|insert|\bsave\b|\bstore\b|spreadsheet|\bsql\b/, block: 'store_record', why: 'writes a record' },
  { test: /respondtowebhook|respond to webhook|\bdone\b|\bfinish\b|\bconfirm\b|\bend\b/, block: 'confirm', why: 'ends the flow' },
  { test: /\bwait\b|delay|sleep|poll|callback|webhookwait|approval/, block: 'wait_for_callback', why: 'waits for something outside' },
  { test: /\bget status\b|check ?status|status/, block: 'check_status', why: 'asks how it is going' },
  { test: /webhook|trigger|cron|schedule|manual|formtrigger|emailreadimap|imap|receive|\bform\b|\bread\b/, block: 'read_request', why: 'starts the flow' },
  { test: /\bif\b|switch|filter|validate|check|\btests?\b|lint|build|compile|verify|scan|compare|merge|split|\bset\b|code|function|expression|transform|map|aggregate|sort|date|json|html|edit fields|noop|decide|openai|\bai\b|agent|llm|chat/, block: 'transform', why: 'works on the data' },
  { test: /httprequest|http request|\bhttp\b|api|request|\bget\b|\bpost\b/, block: 'store_record', why: 'calls another service (counted as a write)' },
];

/** The first clue that matches wins, so put the strongest clue first: the node type or app, then the name or action. */
const guess = (...clues: string[]): { block: string; why: string } | undefined => {
  for (const c of clues) {
    const t = c.toLowerCase().replace(/^n8n-nodes-base\./, '');
    const r = RULES.find((x) => x.test.test(t));
    if (r && blockById(r.block)) return { block: r.block, why: r.why };
  }
  return undefined;
};

/** Steps that only prepare the machine. They are left out without a note. */
const NOISE = /setup-|actions\/cache|upload-artifact|download-artifact|harden-runner/;
const INSTALL = /^\s*(npm (ci|install)|pip install|yarn( install)?|pnpm install)\b/;

/** The YAML subset parser has no block scalars: fold `key: |` bodies into one quoted line. */
export function flattenBlockScalars(text: string): string {
  const lines = text.split('\n'), out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*(?:-\s+)?[A-Za-z0-9_.-]+:\s*)[|>][+-]?\s*$/.exec(lines[i]!);
    if (!m) { out.push(lines[i]!); continue; }
    const base = lines[i]!.search(/\S/);
    const body: string[] = [];
    while (i + 1 < lines.length && (lines[i + 1]!.trim() === '' || lines[i + 1]!.search(/\S/) > base)) body.push(lines[++i]!.trim());
    out.push(`${m[1]}${JSON.stringify(body.filter(Boolean).join(' ; ').slice(0, 200))}`);
  }
  return out.join('\n');
}

type N8nNode = { name?: string; type?: string; disabled?: boolean };
type N8n = { name?: string; nodes?: N8nNode[]; connections?: Record<string, { main?: Array<Array<{ node?: string }> | null> }> };

/** Nodes in the order a run reaches them: from the triggers (no inbound link) along the main connections, depth first, each node once. */
function n8nOrder(w: N8n): N8nNode[] {
  const nodes = (w.nodes ?? []).filter((n) => n && n.name && !n.disabled);
  const byName = new Map(nodes.map((n) => [n.name!, n]));
  const inbound = new Set<string>();
  for (const out of Object.values(w.connections ?? {})) for (const lane of out.main ?? []) for (const l of lane ?? []) if (l.node) inbound.add(l.node);
  const starts = nodes.filter((n) => !inbound.has(n.name!));
  const seen = new Set<string>(), order: N8nNode[] = [];
  const visit = (n: N8nNode): void => {
    if (seen.has(n.name!)) return;
    seen.add(n.name!); order.push(n);
    for (const lane of w.connections?.[n.name!]?.main ?? []) for (const l of lane ?? []) { const next = l.node ? byName.get(l.node) : undefined; if (next) visit(next); }
  };
  for (const s of starts) visit(s);
  for (const n of nodes) visit(n);
  return order;
}

type Graph = { name?: string; nodes: Array<{ id?: unknown; name?: unknown; label?: unknown; type?: unknown; data?: { label?: unknown; name?: unknown } }>; edges: Array<{ source?: unknown; target?: unknown; from?: unknown; to?: unknown } | [unknown, unknown]> };

/** A graph of nodes and edges (LangGraph, React Flow): follow the edges from the start node, depth first, each node once. */
function graphSteps(g: Graph, notes: string[]): Array<{ label: string; clues: string[] }> {
  const nameOf = (n: Graph['nodes'][number]): string => String(n.name ?? n.label ?? n.data?.label ?? n.data?.name ?? n.id ?? '');
  const idOf = (n: Graph['nodes'][number]): string => String(n.id ?? nameOf(n));
  const nodes = g.nodes.filter((n) => n && idOf(n) !== '' && !/^(__start__|__end__|start|end)$/i.test(idOf(n)));
  const by = new Map(nodes.map((n) => [idOf(n), n]));
  const next = new Map<string, string[]>(), inbound = new Set<string>();
  for (const e of g.edges) {
    const [a, b] = Array.isArray(e) ? [String(e[0]), String(e[1])] : [String(e.source ?? e.from ?? ''), String(e.target ?? e.to ?? '')];
    next.set(a, [...(next.get(a) ?? []), b]);
    if (by.has(a)) inbound.add(b);
  }
  const seen = new Set<string>(), order: Array<typeof nodes[number]> = [];
  const visit = (id: string): void => { const n = by.get(id); if (!n || seen.has(id)) { for (const x of (!n ? next.get(id) ?? [] : [])) visit(x); return; } seen.add(id); order.push(n); for (const x of next.get(id) ?? []) visit(x); };
  for (const n of nodes) if (!inbound.has(idOf(n))) visit(idOf(n));
  for (const n of nodes) visit(idOf(n));
  if (next.size > 0 && [...next.values()].some((l) => l.length > 1)) notes.push('The graph branches. The branches are placed one after the other, in the order a run reaches them.');
  return order.map((n) => ({ label: nameOf(n), clues: [String(n.type ?? ''), nameOf(n), idOf(n)].filter(Boolean) }));
}

type GhJob = { needs?: string | string[]; name?: string; steps?: Array<{ name?: string; uses?: string; run?: string }> };

/** A GitHub Actions workflow: jobs in `needs` order, steps in file order. Setup, cache and artifact steps are left out. */
function ghSteps(jobs: Record<string, GhJob>, notes: string[]): Array<{ label: string; clues: string[] }> {
  const ids = Object.keys(jobs), done = new Set<string>(), order: string[] = [];
  const visit = (id: string, depth = 0): void => {
    if (done.has(id) || depth > ids.length) return;
    done.add(id);
    const needs = ([] as string[]).concat(jobs[id]?.needs ?? []);
    for (const n of needs) if (jobs[n]) visit(n, depth + 1);
    order.push(id);
  };
  for (const id of ids) visit(id);
  const out: Array<{ label: string; clues: string[] }> = [];
  let skipped = 0;
  for (const id of order) for (const st of jobs[id]?.steps ?? []) {
    const onlyInstall = st.run !== undefined && st.run.split(';').every((c) => INSTALL.test(c));
    if ((NOISE.test(st.uses ?? '') || onlyInstall) && !st.name?.match(/deploy|release|notify|slack/i)) { skipped++; continue; }
    out.push({ label: st.name ?? st.uses ?? (st.run ?? '').slice(0, 30), clues: [st.uses ?? '', st.name ?? '', st.run ?? ''].filter(Boolean) });
  }
  if (skipped) notes.push(`${skipped} setup, cache or install step(s) were left out.`);
  return out;
}

type ZapStep = { app?: string; title?: string; action?: string; type?: string; name?: string; event?: string };

/** Read an n8n workflow export, or a Zapier-style `{ steps: [...] }` / `{ zap: { steps: [...] } }` list. */
export function importFlow(text: string): ImportOutcome {
  let j: unknown;
  if (/^\s*[{[]/.test(text)) {
    try { j = JSON.parse(text); } catch { return { ok: false, error: 'This is not valid JSON. Paste the exported workflow file.' }; }
  } else {
    try { j = parseYaml(flattenBlockScalars(text)); } catch (e) { return { ok: false, error: `This is not JSON, and it is not YAML this reader understands (${(e as Error).message}).` }; }
  }
  if (!j || typeof j !== 'object') return { ok: false, error: 'Expected a JSON object or a workflow file.' };
  const o = j as Record<string, unknown>;
  const notes: string[] = [];
  const steps: ImportedStep[] = [];
  let name = typeof o.name === 'string' && o.name ? o.name : 'imported-flow';
  let source: ImportResult['source'];
  let raw: Array<{ label: string; clues: string[] }>;
  if (Array.isArray(o.nodes) && Array.isArray(o.edges)) {
    source = 'langgraph';
    raw = graphSteps(o as Graph, notes);
  } else if (Array.isArray(o.nodes)) {
    source = 'n8n';
    const order = n8nOrder(o as N8n);
    raw = order.map((n) => ({ label: n.name!, clues: [n.type ?? '', n.name!] }));
    if ((o.nodes as N8nNode[]).some((n) => n?.disabled)) notes.push('Disabled nodes were skipped.');
    if (Object.values((o as N8n).connections ?? {}).some((c) => (c.main ?? []).length > 1 || (c.main ?? []).some((l) => (l ?? []).length > 1))) notes.push('The flow branches. The branches are placed one after the other, in the order a run reaches them.');
  } else if (o.jobs && typeof o.jobs === 'object') {
    source = 'github-actions';
    raw = ghSteps(o.jobs as Record<string, GhJob>, notes);
  } else {
    const list = (Array.isArray(o.steps) ? o.steps : Array.isArray((o.zap as { steps?: unknown })?.steps) ? (o.zap as { steps: unknown[] }).steps : undefined) as ZapStep[] | undefined;
    if (!list) return { ok: false, error: 'Not recognized: expected an n8n export ("nodes" and "connections"), a graph ("nodes" and "edges"), a GitHub Actions workflow ("jobs") or a step list ("steps"). Nothing was imported.' };
    source = 'zapier';
    if (typeof (o.zap as { title?: unknown })?.title === 'string') name = (o.zap as { title: string }).title;
    raw = list.map((s, i) => ({ label: s.title ?? s.name ?? s.app ?? `step ${i + 1}`, clues: [s.app ?? '', [s.action, s.event, s.type].filter(Boolean).join(' '), s.title ?? s.name ?? ''].filter(Boolean) }));
  }
  raw.forEach((r, i) => {
    const g = guess(...r.clues);
    if (g) steps.push({ from: r.label, ...g });
    else { notes.push(`"${r.label}": no block matched, left out.`); }
    if (i === 0 && g && blockById(g.block)?.role !== 'input') notes.push(`The first step "${r.label}" is not an input. Add a "read_request" block first if the flow starts from a trigger.`);
  });
  if (steps.length === 0) return { ok: false, error: 'No step matched a library block. Nothing was imported.' };
  return { ok: true, name: name.slice(0, 60), source, steps, notes };
}

/** The block ids for the Chain Wizard: duplicates stay (the wizard gives them their own ids). */
export const importedBlocks = (r: ImportResult): string[] => r.steps.map((s) => s.block);
