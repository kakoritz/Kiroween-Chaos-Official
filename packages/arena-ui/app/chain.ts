// Entry for the chain wizard page (modular-engine R12.3).
import { mountChain } from '../src/chain/panel';
import { addBlock, emptyChain } from '../src/chain/model';
import { decodeChain } from '../src/chain/save';
import './chain.css';

const w = mountChain(document.getElementById('chain')!);
(window as unknown as { __chain?: unknown }).__chain = w;

// `?blocks=read_request,charge,notify&run=1` preloads a chain (shareable local links).
const q = new URLSearchParams(location.search);
const list = (q.get('blocks') ?? '').split(',').filter(Boolean);
const shared = location.hash.startsWith('#c=') ? decodeChain(location.hash) : undefined;
if (shared) w.setModel(shared);
else if (list.length) w.setModel(list.reduce(addBlock, emptyChain()));
if (q.get('run') === '1') void w.test();
