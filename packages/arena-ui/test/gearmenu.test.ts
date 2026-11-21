import { describe, expect, it } from 'vitest';
import { BADGE_TIP, DEFAULT_PACE, badgeTitle, paceTag, shouldClose } from '../src/arena/gearmenu';
import { GEAR_PARTS, gearTip, legendHtml } from '../src/arena/legend-modal';

describe('gear menu (PT-U9)', () => {
  it('defaults to slow pace and shows the SLOW tag only then', () => {
    expect(DEFAULT_PACE).toBe('slow');
    expect(paceTag('slow')).toBe('SLOW');
    expect(paceTag('normal')).toBe('');
  });
  it('closes after radio or button, outside click and Esc; keeps open for sliders and text', () => {
    expect(shouldClose({ kind: 'select', insideMenu: true, control: 'radio' })).toBe(true);
    expect(shouldClose({ kind: 'select', insideMenu: true, control: 'button' })).toBe(true);
    expect(shouldClose({ kind: 'select', insideMenu: true, control: 'slider' })).toBe(false);
    expect(shouldClose({ kind: 'select', insideMenu: true, control: 'text' })).toBe(false);
    expect(shouldClose({ kind: 'outside', insideMenu: false })).toBe(true);
    expect(shouldClose({ kind: 'outside', insideMenu: true })).toBe(false);
    expect(shouldClose({ kind: 'key', key: 'Escape', insideMenu: true })).toBe(true);
    expect(shouldClose({ kind: 'key', key: 'a', insideMenu: true })).toBe(false);
  });
  it('badge tooltip explains the three modes', () => {
    expect(badgeTitle('')).toBe(BADGE_TIP);
    expect(badgeTitle('Live.')).toContain('MOCK = recorded replay');
  });
  it('legend explains R J I B Q and gear tips say whether the tier has the part', () => {
    expect(GEAR_PARTS.map((p) => p.letter).join('')).toBe('RJIBQ');
    const html = legendHtml();
    for (const p of GEAR_PARTS) expect(html).toContain(p.name);
    expect(gearTip(GEAR_PARTS[0]!, true)).toContain('This tier has it');
    expect(gearTip(GEAR_PARTS[4]!, false)).toContain('Add this part to survive');
  });
});
