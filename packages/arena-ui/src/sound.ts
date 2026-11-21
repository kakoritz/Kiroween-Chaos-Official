/** UI-D2/UI-S7: sound effects generated in code with WebAudio. No audio files. */
export type SoundName = 'rattle' | 'creak' | 'wail' | 'thud' | 'sting';

/** Pure mapping from an arena event to the sound it triggers, or null for silence. */
export function soundFor(ev: { type?: string }): SoundName | null {
  switch (ev.type) {
    case 'stage_done': return 'rattle';
    case 'order_start': return 'creak';
    case 'process_dead': return 'wail';
    case 'stage_fail': return 'thud';
    case 'boss_warning':
    case 'boss_start': return 'sting';
    default: return null;
  }
}

/** Minimum gap between two plays of the same sound, so a 200 events/s burst stays listenable. */
export const MIN_GAP_MS: Record<SoundName, number> = { rattle: 120, creak: 250, wail: 900, thud: 150, sting: 1500 };

/** True when this sound may play now (rate limit per sound). */
export function canPlay(name: SoundName, now: number, last: Partial<Record<SoundName, number>>): boolean {
  const t = last[name];
  return t === undefined || now - t >= MIN_GAP_MS[name];
}

/** Mute state: muted until a user gesture unmutes it; the button toggles afterwards. */
export class MuteState {
  muted = true;
  toggle(): boolean { this.muted = !this.muted; return this.muted; }
}

type Ctx = AudioContext;

function noise(ctx: Ctx, secs: number): AudioBufferSourceNode {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * secs)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function env(ctx: Ctx, g: GainNode, t: number, peak: number, attack: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

const synth: Record<SoundName, (ctx: Ctx, out: AudioNode, t: number) => void> = {
  // Bone rattle: three quick band-passed noise ticks.
  rattle(ctx, out, t) {
    for (let i = 0; i < 3; i++) {
      const s = noise(ctx, 0.05);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200 + i * 500; f.Q.value = 6;
      const g = ctx.createGain(); env(ctx, g, t + i * 0.045, 0.35, 0.004, 0.04);
      s.connect(f).connect(g).connect(out); s.start(t + i * 0.045);
    }
  },
  // Creak: a sawtooth with a wobbling pitch through a narrow filter.
  creak(ctx, out, t) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t); o.frequency.linearRampToValueAtTime(190, t + 0.35); o.frequency.linearRampToValueAtTime(130, t + 0.6);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 28;
    const lg = ctx.createGain(); lg.gain.value = 14; lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 8;
    const g = ctx.createGain(); env(ctx, g, t, 0.18, 0.08, 0.6);
    o.connect(f).connect(g).connect(out); o.start(t); lfo.start(t); o.stop(t + 0.65); lfo.stop(t + 0.65);
  },
  // Wail: a falling sine with vibrato.
  wail(ctx, out, t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(260, t + 1.1);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
    const lg = ctx.createGain(); lg.gain.value = 18; lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain(); env(ctx, g, t, 0.3, 0.12, 1.2);
    o.connect(g).connect(out); o.start(t); lfo.start(t); o.stop(t + 1.25); lfo.stop(t + 1.25);
  },
  // Thud: a short low sine drop plus a soft noise knock.
  thud(ctx, out, t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain(); env(ctx, g, t, 0.7, 0.005, 0.25);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.3);
    const s = noise(ctx, 0.06);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const ng = ctx.createGain(); env(ctx, ng, t, 0.3, 0.003, 0.05);
    s.connect(f).connect(ng).connect(out); s.start(t);
  },
  // Sting: a dissonant minor-second stab with a low swell.
  sting(ctx, out, t) {
    for (const [hz, type] of [[220, 'sawtooth'], [233, 'sawtooth'], [110, 'square']] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
      const g = ctx.createGain(); env(ctx, g, t, 0.16, 0.02, 1.1);
      o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 1.15);
    }
  },
};

/** Owns the AudioContext. It is created only on the first unmute, which is a user gesture. */
export class ArenaSound {
  readonly state = new MuteState();
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private last: Partial<Record<SoundName, number>> = {};

  /** Toggle mute. Returns true when now muted. Unmuting creates and resumes the context. */
  toggle(): boolean {
    const muted = this.state.toggle();
    if (!muted) {
      const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!this.ctx && AC) {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
      }
      void this.ctx?.resume();
    }
    return muted;
  }

  onEvent(ev: { type?: string }, now: number): void {
    if (this.state.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const name = soundFor(ev);
    if (!name || !canPlay(name, now, this.last)) return;
    this.last[name] = now;
    synth[name](this.ctx, this.master, this.ctx.currentTime + 0.01);
  }
}
