// SH-K3 / K-power: the committed handshake proof lists every tool the server exposes (it went stale when haunt_specs was added).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOLS } from '../packages/haunt/src/mcp/server';

describe('docs/proof/installed/mcp-handshake.json', () => {
  const proof = JSON.parse(readFileSync(resolve(__dirname, '../docs/proof/installed/mcp-handshake.json'), 'utf8'));
  it('lists the same tools, in order, as the server', () => {
    expect(proof.tools).toEqual(TOOLS.map((t) => t.name));
    expect(proof.tools).toContain('haunt_specs');
  });
  it('says the Power and the Crew app start the same server', () => {
    expect(proof.server.name).toBe('haunt-mcp');
    expect(proof.powerAndAppUseSameServerArgs).toBe(true);
  });
});
