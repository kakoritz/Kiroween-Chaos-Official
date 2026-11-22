// Reads a haunt config file (node only). The parser in ./haunt-config is pure so the browser bundle can use it.
import { readFileSync } from 'node:fs';
import { parseHauntConfig, type LoadResult } from './haunt-config';

export function loadHauntConfig(path: string): LoadResult {
  let src: string;
  try {
    src = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, errors: [`${path}: cannot read file (${(e as NodeJS.ErrnoException).code ?? 'error'})`] };
  }
  return parseHauntConfig(src);
}
