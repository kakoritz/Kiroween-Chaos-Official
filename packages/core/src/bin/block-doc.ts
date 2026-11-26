// `npm run blocks:doc`: writes docs/BLOCKS.md from the block library.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blocksMarkdown } from '../../../haunt/src/blocks/doc';

writeFileSync(resolve('docs/BLOCKS.md'), blocksMarkdown());
console.log('wrote docs/BLOCKS.md');
