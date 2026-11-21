// SH-U2: the Share panel DOM. Downloads are Blob links and the snippet goes to the clipboard. Nothing is sent anywhere.
import { README_SNIPPET, shareFiles, type ShareFile } from './share-model';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function download(f: ShareFile): void {
  const url = URL.createObjectURL(new Blob([f.text], { type: `${f.mime};charset=utf-8` }));
  const a = el('a'); a.href = url; a.download = f.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Clipboard copy with a textarea fallback for pages without the async clipboard API (file:// or plain http). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  const t = el('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.append(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}

/** The Share panel for one report. Returns a section with a badge preview, download buttons and a copy button. */
export function sharePanel(report: unknown, appName = ''): HTMLElement {
  const sec = el('section', 'share');
  sec.setAttribute('aria-label', 'Share this grade');
  const files = shareFiles(report);
  const badge = files.find((f) => f.name === 'haunt-badge.svg')!;

  sec.append(el('h3', undefined, `Share${appName ? `: ${appName}` : ''}`));
  const prev = el('div', 'share-preview'); prev.innerHTML = badge.text;
  prev.setAttribute('role', 'img'); prev.setAttribute('aria-label', 'Badge preview');
  sec.append(prev);

  const row = el('div', 'share-actions');
  for (const f of files) {
    const b = el('button', 'share-btn', `Download ${f.label}`); b.type = 'button';
    b.dataset.file = f.name;
    b.onclick = () => download(f);
    row.append(b);
  }
  sec.append(row);

  const snip = el('div', 'share-snippet');
  const code = el('code', undefined, README_SNIPPET);
  const cp = el('button', 'share-btn share-copy', 'Copy README snippet'); cp.type = 'button';
  const status = el('span', 'share-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  cp.onclick = async () => { status.textContent = (await copyText(README_SNIPPET)) ? 'Copied' : 'Copy failed, select the text'; };
  snip.append(code, cp, status);
  sec.append(snip);
  sec.append(el('p', 'muted share-note', 'Files are built in this page and saved locally. Put haunt-badge.svg next to your README.'));
  return sec;
}
