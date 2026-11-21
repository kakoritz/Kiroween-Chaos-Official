// Hosted demo (ON-C1). Installs window.__haunt backed by the in-page mock (recorded fixture runs), then the arena
// loads as usual. No server, no login, no external request. The page says plainly that the runs are recorded.
import { createInPageMock } from '../../../core/src/mock/inpage-mock';
import outcomes from '../../../core/mock/outcomes.json';
import type { HauntInPage } from '../api';

export const RECORDED_LABEL = 'Recorded run';

/** Install the in-page host on `win`. Returns the facade (used by tests). */
export function installHosted(win: Window & { __haunt?: unknown }): HauntInPage {
  const { api } = createInPageMock(outcomes as never);
  const facade = api as unknown as HauntInPage;
  win.__haunt = facade;
  return facade;
}

/** A small corner badge, "Recorded run", with the clone hint. Pure DOM, no styles file needed. */
export function mountRecordedBadge(doc: Document): HTMLElement {
  const el = doc.createElement('a');
  el.id = 'hosted-badge';
  el.href = 'https://github.com/kakoritz/Kiroween-Chaos#readme';
  el.target = '_blank';
  el.rel = 'noopener';
  el.textContent = `${RECORDED_LABEL}. Run it yourself: git clone, npm run demo`;
  el.setAttribute('style', 'position:fixed;left:8px;bottom:8px;z-index:50;padding:3px 8px;font:12px/1.3 system-ui,sans-serif;color:#cfd3ff;background:rgba(10,8,24,.78);border:1px solid #4a4a7a;border-radius:4px;text-decoration:none');
  doc.body.appendChild(el);
  return el;
}

export function bootHosted(win: Window & { __haunt?: unknown }): void {
  installHosted(win);
  mountRecordedBadge(win.document);
  void import('../../app/main');
}
