import { describe, expect, it } from 'vitest';
import { parseYaml, YamlError } from '../src/config/yaml';
import { parseHauntConfig } from '../src/config/haunt-config';

const GOOD = `
name: haunted-orders   # demo
start: node bot.js
adapter: sdk
stages:
  - id: intake
    label: Order intake
    role: input
    duration: [400, 900]
  - id: charge
    role: effect
    effects: [{ kind: charge, key: charge, idempotent: required }]
    duration: [100, 200]
  - id: handoff
    role: final
inputs: ./orders/
truth: http://127.0.0.1:7071
targets:
  recoverMs: 15000
  concurrency: 16
`;

describe('parseYaml', () => {
  it('parses maps, lists, flow values and scalars', () => {
    expect(parseYaml('a: 1\nb: [x, "y z", true]\nc:\n  - k: v\n    n: null\n  - 2\nd: {p: 1, q: two}\n')).toEqual({
      a: 1, b: ['x', 'y z', true], c: [{ k: 'v', n: null }, 2], d: { p: 1, q: 'two' },
    });
  });
  it('keeps # inside quotes and rejects tabs and duplicate keys', () => {
    expect(parseYaml('a: "x # y"')).toEqual({ a: 'x # y' });
    expect(() => parseYaml('a:\n\tb: 1')).toThrow(YamlError);
    expect(() => parseYaml('a: 1\na: 2')).toThrow(/duplicate/);
  });
});

describe('parseHauntConfig', () => {
  it('accepts a valid file and applies defaults', () => {
    const r = parseHauntConfig(GOOD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.adapter).toEqual(['sdk']);
    expect(r.config.stages.map((s) => s.id)).toEqual(['intake', 'charge', 'handoff']);
    expect(r.config.stages[2]!.label).toBe('handoff');
    expect(r.config.stages[1]!.effects[0]).toEqual({ kind: 'charge', key: 'charge', idempotent: 'required' });
    expect(r.config.targets).toEqual({ recoverMs: 15000, repeats: 0, concurrency: 16 });
  });

  it('accepts an adapter list and defaults adapter to sdk', () => {
    const r = parseHauntConfig('name: a\nstart: x\nadapter: [process, proxy]\nstages:\n  - id: s\n    role: work\n');
    expect(r.ok && r.config.adapter).toEqual(['process', 'proxy']);
  });

  it('reports clear errors with paths', () => {
    const r = parseHauntConfig(
      'name: a\nstages:\n  - id: s\n    role: bogus\n  - id: s\n    role: effect\n    duration: [9, 1]\nextra: 1\ntargets:\n  concurrency: 0\n',
    );
    expect(r.ok).toBe(false);
    const e = r.errors.join('\n');
    expect(e).toContain('start: required');
    expect(e).toContain('stages[0].role');
    expect(e).toContain('duplicate stage id "s"');
    expect(e).toContain('stages[1].duration');
    expect(e).toContain('truth: required when any stage has role "effect"');
    expect(e).toContain('extra: unknown field');
    expect(e).toContain('targets.concurrency');
  });

  it('rejects effects on non-effect stages and bad idempotent values', () => {
    const r = parseHauntConfig(
      'name: a\nstart: x\nstages:\n  - id: s\n    role: work\n    effects: [{kind: k, idempotent: maybe}]\n',
    );
    expect(r.ok).toBe(false);
    const e = r.errors.join('\n');
    expect(e).toContain('only allowed on role "effect"');
    expect(e).toContain('idempotent');
  });

  it('turns yaml syntax errors into errors', () => {
    const r = parseHauntConfig('name: [oops\n');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/^yaml: line 1/);
  });
});
