import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderBadgeFiles, renderImproveFiles, type BadgeFiles, type ImproveFiles } from './badge';

/** A run is a report file path, or a name under .haunt/sweeps (with or without .json). */
export function findRunFile(root: string, id: string): string | null {
  for (const p of [resolve(root, id), join(root, '.haunt', 'sweeps', id), join(root, '.haunt', 'sweeps', `${id}.json`)]) {
    if (p.endsWith('.json') && existsSync(p)) return p;
  }
  return null;
}

/** Read a saved report and write the three share files into outDir. Local files only. */
export function writeBadgeFiles(root: string, id: string, outDir: string): { dir: string; files: string[] } | { error: string } {
  const file = findRunFile(root, id);
  if (!file) return { error: `run not found: ${id}` };
  let report: unknown;
  try { report = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { error: `unreadable report: ${String(e)}` }; }
  const dir = resolve(root, outDir);
  mkdirSync(dir, { recursive: true });
  const files = renderBadgeFiles(report) as BadgeFiles;
  const names = Object.keys(files) as (keyof BadgeFiles)[];
  for (const n of names) writeFileSync(join(dir, n), files[n]);
  return { dir, files: names.map((n) => join(dir, n)) };
}

/** Read an improve report (a saved JSON, or a run file wrapping it under `report`) and write the before and after card. */
export function writeImproveFiles(root: string, file: string, outDir: string): { dir: string; files: string[] } | { error: string } {
  const p = resolve(root, file);
  if (!existsSync(p)) return { error: `improve report not found: ${file}` };
  let report: unknown;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    report = j.report && typeof j.report === 'object' ? j.report : j;
  } catch (e) { return { error: `unreadable report: ${String(e)}` }; }
  const dir = resolve(root, outDir);
  mkdirSync(dir, { recursive: true });
  const files = renderImproveFiles(report);
  const names = Object.keys(files) as (keyof ImproveFiles)[];
  for (const n of names) writeFileSync(join(dir, n), files[n]);
  return { dir, files: names.map((n) => join(dir, n)) };
}
