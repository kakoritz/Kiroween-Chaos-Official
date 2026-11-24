// SH-U2: pure model for the report viewer Share panel. No DOM and no network here, so it is unit tested.
// Everything stays local: files are built as strings, the caller downloads them as Blobs or copies text.
import { renderBadgeFiles, type BadgeFiles } from '../../../haunt/src/share/badge';

export type ShareFileName = keyof BadgeFiles;

export interface ShareFile { name: ShareFileName; mime: string; label: string; text: string }

export const README_SNIPPET = '![Chaos Haunt grade](./haunt-badge.svg)';

const MIME: Record<ShareFileName, string> = {
  'haunt-badge.svg': 'image/svg+xml',
  'haunt-scorecard.svg': 'image/svg+xml',
  'haunt-scorecard.html': 'text/html',
};
const LABEL: Record<ShareFileName, string> = {
  'haunt-badge.svg': 'Badge (SVG)',
  'haunt-scorecard.svg': 'Scorecard (SVG)',
  'haunt-scorecard.html': 'Scorecard (HTML)',
};

/** Build the three share files from one report. Deterministic: same report, same bytes. */
export function shareFiles(report: unknown): ShareFile[] {
  const f = renderBadgeFiles(report);
  return (Object.keys(f) as ShareFileName[]).map((name) => ({ name, mime: MIME[name], label: LABEL[name], text: f[name] }));
}

/** README snippet for a badge file name; defaults to the standard one. */
export function readmeSnippet(file: ShareFileName = 'haunt-badge.svg'): string {
  return `![Chaos Haunt grade](./${file})`;
}
