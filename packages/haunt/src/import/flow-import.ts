// Import an existing automation (n8n workflow JSON or a Zapier-style step list) as a chain of library blocks (third build list, item 2).
// Pure: JSON in, a list of block ids out. The guess is by node type and name, and every guess is reported so the owner can fix it.
import { blockById } from '../blocks/library';

export interface ImportedStep { from: string; block: string; why: string }
export interface ImportResult { ok: true; name: string; source: 'n8n' | 'zapier'; steps: ImportedStep[]; notes: string[] }
export type ImportOutcome = ImportResult | { ok: false; error: string };

type Rule = { test: RegExp; block: string; why: string };
// First match wins. Tested against "<type> <name>" in lower case. Effects first (they are what chaos hurts), then inputs, polls, work.
const RULES: Rule[] = [
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
  { test: /\bif\b|switch|filter|validate|check|compare|merge|split|\bset\b|code|function|expression|transform|map|aggregate|sort|date|json|html|edit fields|noop|decide|openai|\bai\b|agent|llm|chat/, block: 'transform', why: 'works on the data' },
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

type ZapStep = { app?: string; title?: string; action?: string; type?: string; name?: string; event?: string };

/** Read an n8n workflow export, or a Zapier-style `{ steps: [...] }` / `{ zap: { steps: [...] } }` list. */
export function importFlow(text: string): ImportOutcome {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return { ok: false, error: 'This is not JSON. Paste the exported workflow file.' }; }
  if (!j || typeof j !== 'object') return { ok: false, error: 'Expected a JSON object.' };
  const o = j as Record<string, unknown>;
  const notes: string[] = [];
  const steps: ImportedStep[] = [];
  let name = typeof o.name === 'string' && o.name ? o.name : 'imported-flow';
  let source: 'n8n' | 'zapier';
  let raw: Array<{ label: string; clues: string[] }>;
  if (Array.isArray(o.nodes)) {
    source = 'n8n';
    const order = n8nOrder(o as N8n);
    raw = order.map((n) => ({ label: n.name!, clues: [n.type ?? '', n.name!] }));
    if ((o.nodes as N8nNode[]).some((n) => n?.disabled)) notes.push('Disabled nodes were skipped.');
    if (Object.values((o as N8n).connections ?? {}).some((c) => (c.main ?? []).length > 1 || (c.main ?? []).some((l) => (l ?? []).length > 1))) notes.push('The flow branches. The branches are placed one after the other, in the order a run reaches them.');
  } else {
    const list = (Array.isArray(o.steps) ? o.steps : Array.isArray((o.zap as { steps?: unknown })?.steps) ? (o.zap as { steps: unknown[] }).steps : undefined) as ZapStep[] | undefined;
    if (!list) return { ok: false, error: 'Not an n8n export (no "nodes") and not a step list (no "steps"). Nothing was imported.' };
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
