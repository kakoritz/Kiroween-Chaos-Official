// `npm run block:add -- <haunt.yaml> <stage-id>`: promote an inline stage of your manifest to a reusable block (blocks/user.yaml).
import { resolve } from 'node:path';
import { promoteStageToBlock } from '../../../haunt/src/blocks/user-blocks';

const [manifest, stage] = process.argv.slice(2);
if (!manifest || !stage) { console.error('usage: npm run block:add -- <haunt.yaml> <stage-id>'); process.exit(2); }
const r = promoteStageToBlock(resolve(manifest), stage);
if (!r.ok) { console.error(`cannot add block:\n- ${r.errors.join('\n- ')}`); process.exit(1); }
console.log(`added block "${r.block.id}" (${r.block.role}) to ${r.file}\nUse it with:  - { use: ${r.block.id} }`);
