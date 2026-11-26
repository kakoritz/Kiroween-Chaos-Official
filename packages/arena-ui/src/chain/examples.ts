// Example chains for the Chain Wizard (chain-wizard-v2 R4): one click loads a believable flow.
import { addBlock, emptyChain, type ChainModel } from './model';

export interface ChainExample { id: string; title: string; about: string; blocks: string[] }

export const CHAIN_EXAMPLES: ChainExample[] = [
  { id: 'checkout', title: 'Checkout', about: 'Browse, pay, email a receipt.', blocks: ['browse', 'validate', 'charge', 'send_email', 'confirm'] },
  { id: 'signup', title: 'Sign-up', about: 'Read the form, create the account, welcome email.', blocks: ['read_request', 'validate', 'create_account', 'send_email', 'confirm'] },
  { id: 'video-playback', title: 'Video playback', about: 'Transcode, buffer, render, archive.', blocks: ['read_request', 'transcode', 'buffer_wait', 'render', 'archive', 'confirm'] },
  { id: 'support-ticket', title: 'Support ticket', about: 'Read the message, file a ticket, notify, wait for a reply.', blocks: ['read_message', 'decide', 'file_ticket', 'notify', 'wait_for_callback', 'confirm'] },
];

export function exampleChain(id: string): ChainModel | undefined {
  const e = CHAIN_EXAMPLES.find((x) => x.id === id);
  return e ? e.blocks.reduce(addBlock, emptyChain(e.id)) : undefined;
}
