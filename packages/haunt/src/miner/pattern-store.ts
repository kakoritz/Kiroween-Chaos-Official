// The pattern store on disk and the journal references (node only). The mining code and the in-memory store are pure (./patterns).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, isAbsolute } from 'node:path';
import { PatternStore, type Pattern } from './patterns';

/** Lines of a lane journal that mention the order and stage: `path:line`. */
export function journalRefs(path: string, order: string, stage: string, max = 3): string[] {
  if (!existsSync(path)) return [];
  const out: string[] = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const l = lines[i]!;
    if (!l.includes(order) || !l.includes(stage)) continue;
    // Relative to the working folder when it lives under it, so a spec does not carry one machine's paths.
    const rel = isAbsolute(path) ? relative(process.cwd(), path) : path;
    out.push(`${(rel.startsWith('..') || isAbsolute(rel) ? path : rel).split('\\').join('/')}:${i + 1}`);
  }
  return out;
}

/** `file` is the path of `patterns.json`. The list is read and written on every call, so two processes see each other's changes. */
export class FilePatternStore extends PatternStore {
  override list(): Pattern[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { patterns?: Pattern[] };
      return Array.isArray(raw.patterns) ? raw.patterns : [];
    } catch { return []; }
  }

  protected override save(ps: Pattern[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ version: 1, patterns: ps }, null, 2) + '\n');
  }
}
