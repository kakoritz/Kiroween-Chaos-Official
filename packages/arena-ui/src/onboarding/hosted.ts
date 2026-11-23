// Hosted demo (ON-C1). Installs window.__haunt backed by the in-page mock (recorded fixture runs), then the arena
// loads as usual. No server, no login, no external request. The page says plainly that the runs are recorded.
import { createInPageMock } from '../../../core/src/mock/inpage-mock';
import outcomes from '../../../core/mock/outcomes.json';
import type { HauntInPage } from '../api';
import { addRecordedRuns, type Loader } from './recorded';

export const RECORDED_LABEL = 'Recorded run';

/** Install the in-page host on `win`. Returns the facade (used by tests). */
export function installHosted(win: Window & { __haunt?: unknown }, load?: Loader): HauntInPage {
  const { api, hub } = createInPageMock(outcomes as never);
  const facade = addRecordedRuns(api as unknown as HauntInPage, hub as never, load);
  win.__haunt = facade;
  return facade;
}

/** A footer strip under the arena: "Recorded run" and the clone hint. The page reserves its height (body.hosted, --foot), so it never covers a panel. */
export function mountRecordedBadge(doc: Document): HTMLElement {
  const el = doc.createElement('a');
  el.id = 'hosted-badge';
  el.href = 'https://github.com/kakoritz/Kiroween-Chaos#readme';
  el.target = '_blank';
  el.rel = 'noopener';
  el.textContent = `Hosted demo: runs in your browser. Tournament, Casebook and improve loop are a ${RECORDED_LABEL}. The real engine runs locally: npm run demo`;
  el.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;z-index:50;box-sizing:border-box;padding:3px 8px;font:12px/1.3 system-ui,sans-serif;color:#cfd3ff;background:#0a0818;border-top:1px solid #4a4a7a;text-align:center;text-decoration:none');
  doc.body.classList.add('hosted');
  doc.body.appendChild(el);
  return el;
}

export function bootHosted(win: Window & { __haunt?: unknown }): void {
  installHosted(win);
  mountRecordedBadge(win.document);
  void import('../../app/main');
}


