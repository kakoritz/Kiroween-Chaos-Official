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
}

const eff = (kind: string, key: string, idempotent: 'required' | 'preferred' = 'required'): BlockEffect => ({ kind, key, idempotent });

export const BLOCKS: readonly Block[] = [
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

const BY_ID = new Map(BLOCKS.map((b) => [b.id, b]));
export const blockById = (id: string): Block | undefined => BY_ID.get(id);
/** Provider kinds the fake provider can record. A block or manifest effect kind outside this list is stored as `store`. */
export const PROVIDER_KINDS: readonly string[] = ['account_create', 'order', 'charge', 'email', 'store', 'dispatch', 'notify', 'ticket', 'refund', 'discount'];
