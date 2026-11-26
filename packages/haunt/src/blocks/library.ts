// Block library (modular-engine M5, R4.1): reusable steps an app manifest composes with `use: <id>`.
// Data only, no node imports: it bundles for the browser. docs/BLOCKS.md is generated from this list (npm run blocks:doc).
import type { StageRole } from '../config/haunt-config';

export interface BlockEffect { kind: string; key: string; idempotent: 'required' | 'preferred' }
export interface Block {
  id: string;
  label: string;
  role: StageRole;
  /** What it is for, one line (shown in the chain wizard and in docs/BLOCKS.md). */
  about: string;
  effects: BlockEffect[];
  /** Work time range at 1x, ms. */
  duration: [number, number];
  /** How it usually breaks and what protects it, one line. A custom block may omit it; `hintOf` then gives the role's line. */
  hint?: string;
}

const eff = (kind: string, key: string, idempotent: 'required' | 'preferred' = 'required'): BlockEffect => ({ kind, key, idempotent });

export const BLOCKS: Block[] = [
  // input: read something from the outside
  { id: 'read_request', label: 'Read request', role: 'input', about: 'Read a job file or request that starts the work.', effects: [], duration: [300, 600] },
  { id: 'read_message', label: 'Read message', role: 'input', about: 'Take the next message from a queue or inbox.', effects: [], duration: [300, 600] },
  { id: 'browse', label: 'Browse', role: 'input', about: 'Look something up in a catalog before choosing.', effects: [], duration: [300, 700] },
  // work: think or compute, no side effect
  { id: 'validate', label: 'Validate', role: 'work', about: 'Check the input is complete and well formed.', effects: [], duration: [400, 900] },
  { id: 'transform', label: 'Transform', role: 'work', about: 'Convert or enrich the data.', effects: [], duration: [600, 1200] },
  { id: 'decide', label: 'Decide', role: 'work', about: 'Pick a route or answer.', effects: [], duration: [500, 1000] },
  { id: 'render', label: 'Render', role: 'work', about: 'Produce the output the user sees.', effects: [], duration: [600, 1300] },
  { id: 'transcode', label: 'Transcode', role: 'work', about: 'Heavy conversion that takes a while.', effects: [], duration: [800, 1400] },
  // effect: change the outside world (each one is a ledger row; the idempotency key decides repeats)
  { id: 'create_account', label: 'Create account', role: 'effect', about: 'Sign someone up or log them in.', effects: [eff('account_create', 'account:1')], duration: [400, 800] },
  { id: 'charge', label: 'Take payment', role: 'effect', about: 'Charge money. A repeat is a double charge.', effects: [eff('charge', 'charge:1')], duration: [500, 1000] },
  { id: 'refund', label: 'Refund', role: 'effect', about: 'Give money back.', effects: [eff('refund', 'refund:1')], duration: [400, 800] },
  { id: 'store_record', label: 'Store record', role: 'effect', about: 'Write a record to the database or storage.', effects: [eff('store', 'store:1')], duration: [300, 700] },
  { id: 'send_email', label: 'Send email', role: 'effect', about: 'Send a message to a person.', effects: [eff('email', 'email:1', 'preferred')], duration: [300, 700] },
  { id: 'notify', label: 'Notify', role: 'effect', about: 'Push a notification.', effects: [eff('notify', 'notify:1', 'preferred')], duration: [300, 600] },
  { id: 'dispatch_job', label: 'Dispatch', role: 'effect', about: 'Hand work to another service or a courier.', effects: [eff('dispatch', 'dispatch:1')], duration: [400, 800] },
  { id: 'file_ticket', label: 'File ticket', role: 'effect', about: 'Open a ticket. A repeat is a duplicate ticket.', effects: [eff('ticket', 'ticket:1')], duration: [400, 800] },
  { id: 'place_order', label: 'Place order', role: 'effect', about: 'Place an order with another party.', effects: [eff('order', 'order:1')], duration: [400, 800] },
  // poll: wait for something outside
  { id: 'wait_for_callback', label: 'Wait for callback', role: 'poll', about: 'Wait for the other side to answer.', effects: [], duration: [800, 1600] },
  { id: 'check_status', label: 'Check status', role: 'poll', about: 'Ask again until a job is done.', effects: [], duration: [600, 1400] },
  { id: 'buffer_wait', label: 'Buffering', role: 'poll', about: 'Wait for data to arrive at a steady rate.', effects: [], duration: [800, 1600] },
  // final: close the loop
  { id: 'confirm', label: 'Confirm', role: 'final', about: 'Tell the user it is done.', effects: [], duration: [300, 600] },
  { id: 'archive', label: 'Archive', role: 'effect', about: 'Keep a copy for later.', effects: [eff('store', 'archive:1')], duration: [300, 600] },
];

const HINTS: Record<string, string> = {
  read_request: 'Breaks when the request is missing or half written. A journal lets a restart pick the same request up again.',
  read_message: 'Breaks when the same message is delivered twice. Idempotency keys make a repeat harmless.',
  browse: 'Breaks when the catalog is slow or down. Retry with a short wait, and a circuit breaker so you stop hammering it.',
  validate: 'Rarely breaks on its own; bad data passes through it. A clear error beats a silent skip.',
  transform: 'Breaks on odd input or a crash halfway. A journal keeps the finished part.',
  decide: 'Breaks when it picks a route on stale data. Keep the decision the same on a replay.',
  render: 'Breaks when it is slow and the user gives up. Cap how long it can take.',
  transcode: 'Breaks by hanging or by a crash after a long run. A journal and a time cap protect it.',
  create_account: 'Breaks by making two accounts after a retry. Idempotency keys and a journal.',
  charge: 'Breaks by charging twice after a timeout. Idempotency keys are a must; retry only with the same key.',
  refund: 'Breaks by refunding twice. Idempotency keys; check the first refund before a second.',
  store_record: 'Breaks by writing a duplicate row on retry. Idempotency keys; a journal after a crash.',
  send_email: 'Breaks by sending the same email twice. An idempotency key helps; an offline queue holds mail while the service is down.',
  notify: 'Breaks by a double push or a lost one. An offline queue keeps it until the service is back.',
  dispatch_job: 'Breaks by handing the same job out twice. Idempotency keys and a journal.',
  file_ticket: 'Breaks by opening a duplicate ticket on retry. Idempotency keys.',
  place_order: 'Breaks by placing the order twice after a timeout. Idempotency keys, then retry.',
  wait_for_callback: 'Breaks when the callback never comes. Set a time limit and ask again with a back-off.',
  check_status: 'Breaks by polling too fast and making a retry storm. Back off, and let a circuit breaker open.',
  buffer_wait: 'Breaks when data stalls and the wait never ends. A time cap and a retry.',
  confirm: 'Breaks when the work is done but the user is never told. An offline queue holds the message.',
  archive: 'Breaks by storing the copy twice. Idempotency keys.',
};
const ROLE_HINTS: Record<string, string> = {
  input: 'Reading can fail or repeat. Plan for a missing and a repeated input.',
  work: 'Work changes nothing outside, so it is safe to run again. Cap how long it can take.',
  effect: 'An effect changes the outside world, so a repeat is a bug. Use idempotency keys.',
  poll: 'Waiting can last forever. Set a time limit and back off between asks.',
  final: 'The last step should survive a crash. A journal remembers what was done.',
};
/** The hint line of a block: its own, the built-in one, or the line for its role. */
export const hintOf = (b: Pick<Block, 'id' | 'role' | 'hint'>): string => b.hint ?? HINTS[b.id] ?? ROLE_HINTS[b.role] ?? '';

export const BUILTIN_BLOCK_COUNT = BLOCKS.length;
export const blockById = (id: string): Block | undefined => BLOCKS.find((b) => b.id === id);

/** Problems with a block definition; an empty list means it is valid. */
export function validateBlock(b: unknown): string[] {
  const errs: string[] = [];
  const o = b as Partial<Block> | null;
  if (typeof o !== 'object' || o === null) return ['block: expected a map'];
  if (typeof o.id !== 'string' || !/^[a-z][a-z0-9_]{1,31}$/.test(o.id)) errs.push('id: 2 to 32 lowercase letters, digits or underscore, starting with a letter');
  if (typeof o.label !== 'string' || !o.label.trim()) errs.push('label: required text');
  if (!['input', 'work', 'effect', 'poll', 'final'].includes(String(o.role))) errs.push('role: one of input | work | effect | poll | final');
  const effects = Array.isArray(o.effects) ? o.effects : [];
  if (o.role === 'effect' && effects.length === 0) errs.push('effects: an effect block needs at least one effect');
  if (o.role !== 'effect' && effects.length > 0) errs.push('effects: only an effect block can have effects');
  effects.forEach((e, i) => { if (!e || typeof e.kind !== 'string' || typeof e.key !== 'string' || !['required', 'preferred'].includes(String(e.idempotent))) errs.push(`effects[${i}]: needs kind, key and idempotent (required | preferred)`); });
  if (!Array.isArray(o.duration) || o.duration.length !== 2 || !(o.duration[0] >= 0) || !(o.duration[1] >= o.duration[0])) errs.push('duration: [min, max] in ms with 0 <= min <= max');
  return errs;
}

/** Adds a custom block to the library for this process (a promoted custom block, modular-engine R13.3). Throws with the problems. */
export function registerBlock(b: Block): void {
  const errs = validateBlock(b);
  if (blockById(b.id)) errs.push(`id: "${b.id}" is already a block`);
  if (errs.length > 0) throw new Error(`block "${(b as { id?: string }).id}" is not valid:\n- ${errs.join('\n- ')}`);
  BLOCKS.push({ ...b, effects: b.effects.map((e) => ({ ...e })), duration: [b.duration[0], b.duration[1]] });
}
/** Provider kinds the fake provider can record. A block or manifest effect kind outside this list is stored as `store`. */
export const PROVIDER_KINDS: readonly string[] = ['account_create', 'order', 'charge', 'email', 'store', 'dispatch', 'notify', 'ticket', 'refund', 'discount'];
