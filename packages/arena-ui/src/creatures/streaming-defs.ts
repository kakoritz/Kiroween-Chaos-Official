// Streaming-pack creature catalogue (PK-U2). Pure data, no DOM. The pack names them (packs/streaming/pack.yaml);
// the art is code-drawn in streaming.ts. Region Warden of the pack is drawn as the Region Ghost.
import type { AnimDef, SpriteGroup } from '../lab/registry';

export type StreamingId = 'buffer_wraith' | 'cdn_kraken' | 'drm_gatekeeper' | 'render_gremlin' | 'cloud_banshee' | 'region_ghost';

export interface StreamingDef { id: StreamingId; name: string; group: SpriteGroup; does: string; act: string; anims: AnimDef[]; aliases: string[] }

const idle = (duration = 2200): AnimDef => ({ id: 'idle', label: 'Idle', loop: true, duration });
const act = (id: string, label: string, duration: number, loop = false): AnimDef => ({ id, label, loop, duration });

export const STREAMING: StreamingDef[] = [
  { id: 'buffer_wraith', name: 'Buffer Wraith', group: 'creature', does: 'Stalls the stream. A progress ring spins and never fills.', act: 'stall', anims: [idle(2400), act('stall', 'Stall the stream', 1600, true)], aliases: [] },
  { id: 'cdn_kraken', name: 'CDN Kraken', group: 'boss', does: 'Boss. Tentacles wrap the delivery network and squeeze the stream.', act: 'squeeze', anims: [idle(3000), act('squeeze', 'Squeeze the CDN', 1800)], aliases: ['kraken'] },
  { id: 'drm_gatekeeper', name: 'DRM Gatekeeper', group: 'creature', does: 'Bars the door and stamps DENIED on the licence.', act: 'deny', anims: [idle(2400), act('deny', 'Deny the licence', 1200)], aliases: [] },
  { id: 'render_gremlin', name: 'Render Gremlin', group: 'creature', does: 'Smashes the player: the picture tears into glitch blocks.', act: 'glitch', anims: [idle(1300), act('glitch', 'Glitch the frame', 1400)], aliases: [] },
  { id: 'cloud_banshee', name: 'Cloud Banshee', group: 'creature', does: 'Wails from a storm cloud. The backend goes dark.', act: 'wail', anims: [idle(2600), act('wail', 'Wail', 1500)], aliases: [] },
  { id: 'region_ghost', name: 'Region Ghost', group: 'creature', does: 'Holds up a map with a red border: not available in your region.', act: 'lock', anims: [idle(2400), act('lock', 'Lock the region', 1300)], aliases: ['region_warden'] },
];

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Map a creature id or display name ("Buffer Wraith", "buffer_wraith") to a streaming sprite id, or null. */
export function streamingId(raw: string): StreamingId | null {
  const k = slug(raw);
  return STREAMING.find((d) => d.id === k || d.aliases.includes(k))?.id ?? null;
}

export const streamingById = (id: StreamingId): StreamingDef => STREAMING.find((d) => d.id === id)!;
