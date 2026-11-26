// The Chain Wizard tour. Spec: .kiro/specs/chain-wizard-v2 (second build list, item 3). The page itself is checked in headless Chrome.
import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, mountTour } from '../src/chain/tour';

/** A tiny fake document: enough for the tour (createElement, querySelector, addEventListener). */
function fakeDoc() {
  const lit = new Set<string>();
  const mk = (tag: string): any => {
    const e: any = { tag, children: [], hidden: false, className: '', textContent: '', disabled: false, attrs: {}, focused: false,
      append(...c: any[]) { this.children.push(...c); }, setAttribute(k: string, v: string) { this.attrs[k] = v; }, focus() { this.focused = true; },
      classList: { add: (c: string) => lit.add(`${tag}.${c}`), remove: (c: string) => lit.delete(`${tag}.${c}`) }, scrollIntoView() {} };
    return e;
  };
  const targets = new Map<string, any>(TOUR_STEPS.map((s) => [s.target, mk(`T:${s.id}`)]));
  const keys: ((e: { key: string }) => void)[] = [];
  const doc: any = { createElement: mk, querySelector: (s: string) => targets.get(s) ?? null, addEventListener: (_: string, f: (e: { key: string }) => void) => { keys.push(f); } };
  return { doc, lit, keys, host: mk('host') };
}

describe('tour', () => {
  it('has six steps, each with a target, a title and text', () => {
    expect(TOUR_STEPS.length).toBe(6);
    for (const s of TOUR_STEPS) { expect(s.target.length).toBeGreaterThan(2); expect(s.title).toBeTruthy(); expect(s.text.length).toBeGreaterThan(30); }
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(6);
  });

  it('opens on step 1, lights one part at a time, walks forward and back, and closes clean', () => {
    const { doc, lit, host } = fakeDoc();
    const t = mountTour(doc, host);
    expect(t.isOpen).toBe(false);
    t.open();
    expect(t.isOpen).toBe(true);
    expect(t.index).toBe(0);
    expect([...lit]).toEqual(['T:library.ch-tour-hl']);
    t.step(1);
    expect([...lit]).toEqual(['T:add.ch-tour-hl']);
    t.step(99);
    expect(t.index).toBe(5);
    t.step(-3);
    expect(t.index).toBe(0);
    t.close();
    expect(t.isOpen).toBe(false);
    expect([...lit]).toEqual([]);
  });

  it('Escape closes it, and a key press does nothing while it is closed', () => {
    const { doc, keys, host } = fakeDoc();
    const t = mountTour(doc, host);
    keys.forEach((f) => f({ key: 'Escape' }));
    expect(t.isOpen).toBe(false);
    t.open();
    keys.forEach((f) => f({ key: 'a' }));
    expect(t.isOpen).toBe(true);
    keys.forEach((f) => f({ key: 'Escape' }));
    expect(t.isOpen).toBe(false);
  });

  it('a step whose target is missing does not break the tour', () => {
    const { doc, host } = fakeDoc();
    const t = mountTour(doc, host, [{ id: 'x', target: '#nope', title: 'X', text: 'No such part on this page.' }]);
    t.open();
    expect(t.index).toBe(0);
    t.close();
  });
});
