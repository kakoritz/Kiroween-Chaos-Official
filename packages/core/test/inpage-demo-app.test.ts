import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInPageMock } from '../src/mock/inpage-mock';
import outcomes from '../mock/outcomes.json';

afterEach(() => { vi.useRealTimers(); });

describe('in-page demo follows the selected app', () => {
  it('plays an inbox stream (tickets, not orders) when the Inbox app is selected', async () => {
    vi.useFakeTimers();
    const { api } = createInPageMock(outcomes as never);
    const seen: any[] = [];
    api.subscribe((e: any) => seen.push(e));
    await api.setApp('inbox');
    await api.startDemo('hero');
    await vi.advanceTimersByTimeAsync(120_000);
    const kinds = new Set(seen.filter((e) => e.type === 'effect').map((e) => e.detail.kind));
    expect(kinds.has('charge')).toBe(false);
    expect(kinds.has('account_create')).toBe(false);
    expect(kinds.size).toBeGreaterThan(0);
    expect((await api.getState()).app).toBe('inbox');
  });
});
