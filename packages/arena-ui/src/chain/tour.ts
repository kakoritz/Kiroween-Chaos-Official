// A short guided tour of the Chain Wizard (second build list, item 3): six steps, each lights one part of the page. Keyboard friendly, no motion.
export interface TourStep { id: string; target: string; title: string; text: string }

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'library', target: '[aria-label="Block library"]', title: '1. Blocks', text: 'These are 22 reusable steps. The small badge is how many attacks each block survives alone, with the protections you pick later.' },
  { id: 'add', target: '[aria-label="Block library"] .ch-lib', title: '2. Add some', text: 'Click a + button to add a block to your chain. Try read_request, then charge, then notify.' },
  { id: 'chain', target: '[aria-label="Your chain"]', title: '3. Your chain', text: 'Reorder, rename or remove stages. The haunt.yaml underneath is the same chain as a file: edit either one.' },
  { id: 'protect', target: '.ch-prot', title: '4. Protections', text: 'Turn Retry, Journal, Idempotency keys, Circuit breaker and Offline queue on and off. The grade changes at once.' },
  { id: 'test', target: '.ch-btn--go', title: '5. Test the chain', text: 'This tests every block in the chain against every fault that fits it, and says which block caused which share of the failures.' },
  { id: 'arena', target: '[aria-label="Warnings and test"]', title: '6. Run it for real', text: 'Run in the arena sends the chain to the live game: bots, creatures and a ledger that counts every repeat. Results here are a model; the arena is the proof.' },
];

export interface TourHandle { open(): void; close(): void; step(i: number): void; readonly index: number; readonly isOpen: boolean }

/** The tour box. `doc` is passed in so the logic is testable; the box is added to `host`. */
export function mountTour(doc: Document, host: HTMLElement, steps: readonly TourStep[] = TOUR_STEPS): TourHandle {
  let i = 0;
  let open = false;
  let lit: Element | null = null;
  const box = doc.createElement('div');
  box.className = 'ch-tour';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Chain Wizard tour');
  box.hidden = true;
  const title = doc.createElement('strong');
  const text = doc.createElement('p');
  text.setAttribute('aria-live', 'polite');
  const btn = (label: string, fn: () => void): HTMLButtonElement => { const b = doc.createElement('button'); b.type = 'button'; b.className = 'ch-btn'; b.textContent = label; b.onclick = fn; return b; };
  const back = btn('Back', () => api.step(i - 1));
  const next = btn('Next', () => (i >= steps.length - 1 ? api.close() : api.step(i + 1)));
  const skip = btn('Close', () => api.close());
  const count = doc.createElement('span');
  count.className = 'ch-note';
  const row = doc.createElement('div');
  row.className = 'ch-row';
  row.append(back, next, skip, count);
  box.append(title, text, row);
  host.append(box);
  doc.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') api.close(); });

  const api: TourHandle = {
    get index() { return i; },
    get isOpen() { return open; },
    open() { open = true; box.hidden = false; api.step(0); next.focus(); },
    close() { open = false; box.hidden = true; lit?.classList.remove('ch-tour-hl'); lit = null; },
    step(n: number) {
      i = Math.min(steps.length - 1, Math.max(0, n));
      const s = steps[i]!;
      title.textContent = s.title;
      text.textContent = s.text;
      count.textContent = `${i + 1} of ${steps.length}`;
      back.disabled = i === 0;
      next.textContent = i === steps.length - 1 ? 'Done' : 'Next';
      lit?.classList.remove('ch-tour-hl');
      lit = doc.querySelector(s.target);
      lit?.classList.add('ch-tour-hl');
      lit?.scrollIntoView?.({ block: 'nearest' });
    },
  };
  return api;
}
