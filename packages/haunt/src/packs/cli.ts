// `haunt pack new|list|check` and `haunt init`. Library functions so the bin stays a thin wrapper. Node only.
import { resolve } from 'node:path';
import { labRun } from '../lab/engine';
import { listPacks, loadPack } from './load';
import { PACK_TIERS, packToLabModel } from './pack';
import { scaffoldPack, writeInit } from './scaffold';

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};

export const PACK_USAGE = 'usage: haunt pack new <id> [--title "Haunted Thing"] [--dir packs] [--force]\n       haunt pack list [--dir packs]\n       haunt pack check <id> [--dir packs]\n       haunt init [--pack <id>] [--dir .] [--packs packs] [--force]';

export async function packCommand(argv: string[], log: (s: string) => void = console.log): Promise<number> {
  const sub = argv[0];
  const dir = resolve(flag(argv, '--dir') ?? 'packs');
  if (sub === 'list') {
    const ids = listPacks(dir);
    for (const id of ids) { const p = loadPack(dir, id); log(`${id}: ${p.title} (${p.stages.length} stages, ${p.faults.length} faults, ${p.bosses.length} bosses${p.modelBased ? ', model-based' : ''})`); }
    if (!ids.length) log(`no packs under ${dir}`);
    return 0;
  }
  if (sub === 'new') {
    const id = argv[1];
    if (!id || id.startsWith('--')) { log('error: pack id required'); log(PACK_USAGE); return 2; }
    try {
      const title = flag(argv, '--title');
      const r = scaffoldPack(dir, id, { ...(title ? { title } : {}), force: argv.includes('--force') });
      log(`created ${r.file} (${r.pack.stages.length} stages, ${r.pack.faults.length} faults): valid`);
      log(`next: edit it, then  npm run haunt -- pack check ${id}  and  npm run packs:embed   (see docs/PACKS.md)`);
      return 0;
    } catch (e) { log(`error: ${(e as Error).message}`); return 2; }
  }
  if (sub === 'check') {
    const id = argv[1];
    if (!id || id.startsWith('--')) { log('error: pack id required'); return 2; }
    try {
      const p = loadPack(dir, id);
      const rookie = await labRun(packToLabModel(p, PACK_TIERS.rookie));
      const phoenix = await labRun(packToLabModel(p, PACK_TIERS.phoenix));
      log(`${id}: valid. ${p.stages.length} stages, ${p.faults.length} faults, ${p.curses.length} curses, ${p.bosses.length} bosses.`);
      log(`model-based sweep: Rookie ${rookie.grade} (${Math.round(rookie.reliability)}%), Phoenix ${phoenix.grade} (${Math.round(phoenix.reliability)}%); bosses survived by Phoenix: ${phoenix.bosses.filter((b) => b.survived).length} of ${phoenix.bosses.length}`);
      return 0;
    } catch (e) { log(`error: ${(e as Error).message}`); return 2; }
  }
  log(PACK_USAGE);
  return sub ? 2 : 0;
}

export function initCommand(argv: string[], log: (s: string) => void = console.log): number {
  try {
    const r = writeInit(resolve(flag(argv, '--dir') ?? '.'), resolve(flag(argv, '--packs') ?? 'packs'), flag(argv, '--pack'), argv.includes('--force'));
    log(r.created ? `wrote ${r.file}. Next: haunt validate, then haunt sweep` : `${r.file} already exists (use --force to overwrite)`);
    return r.created ? 0 : 2;
  } catch (e) { log(`error: ${(e as Error).message}`); return 2; }
}
