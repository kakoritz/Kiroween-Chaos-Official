import { describe, expect, it } from 'vitest';
import { SPLASH_BUTTONS, SPLASH_HOOK, splashDecision, splashTarget, typedHook } from '../src/onboarding/splash';

describe('title splash', () => {
  it('shows by default and waits for a click', () => {
    expect(splashDecision('')).toEqual({ show: true, autoDismissMs: null });
  });
  it('skips with ?splash=0 and for capture params', () => {
    expect(splashDecision('?splash=0').show).toBe(false);
    expect(splashDecision('?present=1').show).toBe(false);
    expect(splashDecision('?inspect=0:pay').show).toBe(false);
    expect(splashDecision('?tour=1').show).toBe(false);
  });
  it('auto-dismisses after 4 s only when a named demo plays', () => {
    expect(splashDecision('?demo=hero')).toEqual({ show: true, autoDismissMs: 4000 });
    expect(splashDecision('?demo=off').autoDismissMs).toBeNull();
  });
  it('types the hook and shows it whole under reduced motion', () => {
    expect(typedHook(0, false)).toBe('');
    expect(typedHook(1e6, false)).toBe(SPLASH_HOOK);
    expect(typedHook(110, false).length).toBe(2);
    expect(typedHook(0, true)).toBe(SPLASH_HOOK);
  });
  it('has four buttons with the demo as hero', () => {
    expect(SPLASH_BUTTONS.map((b) => b.action)).toEqual(['demo', 'campaign', 'tour', 'lab', 'chain']);
    expect(SPLASH_BUTTONS.filter((b) => b.hero).map((b) => b.action)).toEqual(['demo']);
    // "Test your own workflow" opens the Workflow Lab (it used to open the hidden sprite lab by mistake).
    expect(splashTarget('lab')).toBe('./workflow-lab.html');
    expect(splashTarget('chain')).toBe('./chain.html');
    expect(splashTarget('demo')).toBeNull();
  });
});
