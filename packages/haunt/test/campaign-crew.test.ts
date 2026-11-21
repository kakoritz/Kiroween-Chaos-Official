// CP-C2: the Crew bot's HAUNT_PARTS parsing and defineBot options.
import { describe, expect, it } from 'vitest';
import { CREW_LABEL, crewBotOptions, crewPartsEnv, crewPartsFromEnv, parseCrewParts } from '../src/campaign/crew';
import { tierById } from '../src/pipeline';

describe('parseCrewParts', () => {
  it('reads ids and gear letters in any order and returns the canonical order', () => {
    expect(parseCrewParts('offline_queue,retry')).toEqual(['retry', 'offline_queue']);
    expect(parseCrewParts('R J I B Q')).toEqual(['retry', 'journal', 'idempotency', 'breaker', 'offline_queue']);
    expect(parseCrewParts('ji')).toEqual(['journal', 'idempotency']);
    expect(parseCrewParts('breaker+journal | retry')).toEqual(['retry', 'journal', 'breaker']);
    expect(parseCrewParts('["idempotency","journal"]')).toEqual(['journal', 'idempotency']);
    expect(parseCrewParts(['retry', 'retry'])).toEqual(['retry']);
  });

  it('treats empty input as no parts and rejects unknown tokens', () => {
    for (const raw of [undefined, null, '', '  ', ',']) expect(parseCrewParts(raw as never)).toEqual([]);
    expect(() => parseCrewParts('retry,sword')).toThrow('unknown part "sword"');
    expect(() => parseCrewParts('Z')).toThrow('unknown part');
  });
});

describe('crew bot options', () => {
  it('reads HAUNT_PARTS from the environment', () => {
    expect(crewPartsFromEnv({ HAUNT_PARTS: 'retry,breaker' })).toEqual(['retry', 'breaker']);
    expect(crewPartsFromEnv({})).toEqual([]);
    expect(crewBotOptions({ HAUNT_PARTS: 'journal,idempotency' })).toEqual({ tier: 'crew', use: ['journal', 'idempotency'] });
    expect(crewBotOptions({ HAUNT_PARTS: '' })).toEqual({ tier: 'crew', use: [] });
  });

  it('writes HAUNT_PARTS the way it reads it', () => {
    expect(crewPartsEnv(['breaker', 'retry'])).toBe('retry,breaker');
    expect(parseCrewParts(crewPartsEnv(['offline_queue', 'journal']))).toEqual(['journal', 'offline_queue']);
  });

  it('the crew tier is known to the pipeline and is not a racing tier', () => {
    expect(tierById('crew')).toMatchObject({ id: 'crew', lane: 1, label: CREW_LABEL });
    expect(() => tierById('nope')).toThrow('unknown tier');
  });
});
