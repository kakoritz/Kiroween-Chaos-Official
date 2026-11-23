// Python-dependent Ticket Desk tests skip with a reason in the test name (visible in every reporter), not just a console warning.
import { it } from 'vitest';

export const PY_SKIP_REASON = 'Python 3.11+ not found on PATH (python, python3 or py): install it to run the Ticket Desk bot tests';

/** `it` when Python exists, else an `it.skip` whose title says why it was skipped. */
export function pyTest(py: string | null | undefined): typeof it {
  if (py) return it;
  const skipped = ((name: string, fn?: unknown, timeout?: unknown) => (it.skip as (...a: unknown[]) => unknown)(`${name} [skipped: ${PY_SKIP_REASON}]`, fn, timeout)) as unknown as typeof it;
  return skipped;
}
