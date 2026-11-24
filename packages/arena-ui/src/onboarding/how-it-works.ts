/// <reference lib="dom" />
// SH-U3: a "How it works" button in the hosted footer that opens the architecture diagram (docs/img/architecture.svg).
// The SVG is inlined at build time (no request), so the hosted page stays free of external fetches.
import archSvg from '../../../../docs/img/architecture.svg?raw';

export const HOW_LABEL = 'How it works';
export const HOW_TITLE = 'How Chaos Haunt works';
export const HOW_CAPTION = 'Two apps on one skeleton, the core server, the arena UI and the Kiro loop that turns a failed run into a hardening spec.';

/** The diagram markup. The svg already carries role="img" and an aria-label; the dialog adds the caption. */
export const architectureSvg = (): string => archSvg;

const BTN_STYLE = 'position:fixed;right:8px;bottom:3px;z-index:52;box-sizing:border-box;padding:1px 10px;font:600 12px/1.3 system-ui,sans-serif;color:#14101f;background:#ffc247;border:2px solid #14101f;border-radius:8px;cursor:pointer';
const OVERLAY_STYLE = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(8,6,14,0.86)';
const CARD_STYLE = 'box-sizing:border-box;width:min(1000px,100%);max-height:100%;overflow:auto;padding:16px;border:3px solid #4a4268;border-radius:14px;background:#1c1830;color:#f3ecff;font:14px/1.4 system-ui,sans-serif';

export interface HowHandle { button: HTMLElement; open(): void; close(): void; isOpen(): boolean }

/** Add the button next to the hosted footer and wire the dialog. `footer` is the strip from mountRecordedBadge; it gets right padding so the text never sits under the button. */
export function mountHowItWorks(doc: Document, footer: HTMLElement | null): HowHandle {
  const button = doc.createElement('button');
  button.type = 'button';
  button.id = 'hosted-how';
  button.textContent = HOW_LABEL;
  button.setAttribute('style', BTN_STYLE);
  button.setAttribute('aria-haspopup', 'dialog');
  if (footer) footer.style.paddingRight = '124px';
  let overlay: HTMLElement | null = null;

  const close = (): void => {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    button.focus();
  };
  const open = (): void => {
    if (overlay) return;
    overlay = doc.createElement('div');
    overlay.id = 'how-it-works';
    overlay.setAttribute('style', OVERLAY_STYLE);
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', HOW_TITLE);
    overlay.innerHTML = `<div style="${CARD_STYLE}"><h2 style="margin:0 0 6px;font-size:20px;color:#ff9a3c">${HOW_TITLE}</h2><p style="margin:0 0 10px;color:#cfd3ff">${HOW_CAPTION}</p><div class="how-svg" style="width:100%;overflow:auto">${archSvg.replace(/<svg /, '<svg style="width:100%;height:auto;max-width:100%;display:block" ')}</div><div style="margin-top:12px"><button type="button" data-how="close" style="padding:6px 16px;font:600 14px system-ui,sans-serif;color:#14101f;background:#ffc247;border:2px solid #14101f;border-radius:8px;cursor:pointer">Close (Esc)</button></div></div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') { e.stopPropagation(); close(); } });
    overlay.querySelector('[data-how=close]')!.addEventListener('click', close);
    doc.body.appendChild(overlay);
    (overlay.querySelector('[data-how=close]') as HTMLElement).focus();
  };
  button.addEventListener('click', open);
  doc.body.appendChild(button);
  return { button, open, close, isOpen: () => overlay !== null };
}
