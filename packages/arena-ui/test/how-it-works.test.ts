// covers: SH-U3
import { describe, expect, it } from 'vitest';
import { HOW_LABEL, architectureSvg, mountHowItWorks } from '../src/onboarding/how-it-works';

class El {
  id = ''; type = ''; textContent = ''; innerHTML = ''; style: Record<string, string> = {};
  attrs: Record<string, string> = {}; listeners: Record<string, (e: unknown) => void> = {}; removed = false; focused = false;
  inner = new Map<string, El>();
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  addEventListener(k: string, f: (e: unknown) => void): void { this.listeners[k] = f; }
  querySelector(sel: string): El | null { if (!this.inner.has(sel)) this.inner.set(sel, new El()); return this.inner.get(sel)!; }
  remove(): void { this.removed = true; }
  focus(): void { this.focused = true; }
}
const mkDoc = () => {
  const body = { added: [] as El[], appendChild(e: El) { this.added.push(e); return e; } };
  return { body, createElement: () => new El() } as unknown as Document & { body: typeof body };
};

describe('How it works (SH-U3)', () => {
  it('inlines the repo architecture diagram, with no external reference', () => {
    const svg = architectureSvg();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Kiroween Chaos architecture');
    expect(svg).not.toMatch(/(?:href|src)=["']https?:/i);
  });

  it('adds a labelled footer button and opens and closes the dialog', () => {
    const doc = mkDoc();
    const footer = new El();
    const h = mountHowItWorks(doc as never, footer as never);
    const btn = h.button as unknown as El;
    expect(btn.textContent).toBe(HOW_LABEL);
    expect(btn.attrs['aria-haspopup']).toBe('dialog');
    expect(footer.style.paddingRight).toBe('124px');
    expect(h.isOpen()).toBe(false);
    btn.listeners.click!({});
    expect(h.isOpen()).toBe(true);
    const dlg = doc.body.added.find((e) => e.attrs.role === 'dialog')!;
    expect(dlg.attrs['aria-modal']).toBe('true');
    expect(dlg.innerHTML).toContain('<svg');
    expect(dlg.innerHTML).toContain('max-width:100%');
    dlg.listeners.keydown!({ key: 'Escape', stopPropagation() {} });
    expect(h.isOpen()).toBe(false);
    expect(dlg.removed).toBe(true);
    expect(btn.focused).toBe(true);
  });

  it('closes on a backdrop click but not on a click inside the card', () => {
    const doc = mkDoc();
    const h = mountHowItWorks(doc as never, null);
    h.open();
    const dlg = doc.body.added.find((e) => e.attrs.role === 'dialog')!;
    dlg.listeners.click!({ target: {} });
    expect(h.isOpen()).toBe(true);
    dlg.listeners.click!({ target: dlg });
    expect(h.isOpen()).toBe(false);
  });
});
