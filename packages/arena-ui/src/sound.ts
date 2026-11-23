/** UI-D2/UI-S7: sound effects generated in code with WebAudio. No audio files. */
export type SoundName =
  | 'rattle' | 'creak' | 'wail' | 'thud' | 'sting' | 'rise'
  | 'doorOpen' | 'doorClose' | 'star' | 'ding' | 'trombone' | 'slam' | 'tick' | 'fanfare' | 'jingle' | 'rustle' | 'meow' | 'crash';

export interface SoundEv { type?: string; detail?: { level?: unknown; stars?: unknown; reason?: unknown; creature?: unknown; ceremonyMs?: unknown } }
/** One scheduled sound: `after` ms from the event, `pitch` a multiplier (1 = normal). */
export interface SoundCue { name: SoundName; after: number; pitch: number }

const WORLD_SOUND: Record<string, SoundName> = { scarecrow: 'rustle', black_cat: 'meow', phantom_car: 'crash' };
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Pitch multiplier for a star chime: 1 star is low, 5 stars is high (about one octave across the range). */
export function starPitch(stars: number): number {
  return 2 ** ((Math.min(5, Math.max(1, stars)) - 3) / 4);
}

/** PT-U12 (ui.md section 13): every cue an event triggers, in order. Empty for silent events. */
export function cuesFor(ev: SoundEv): SoundCue[] {
  const d = ev.detail ?? {};
  switch (ev.type) {
    case 'order_done': {
      const ms = finite(d.ceremonyMs);
      const close = ms !== null && ms > 400 ? ms - 250 : 900;
      return [{ name: 'doorOpen', after: 0, pitch: 1 }, { name: 'doorClose', after: close, pitch: 1 }];
    }
    case 'review': {
      const s = finite(d.stars);
      if (s === null) return [];
      const cues: SoundCue[] = [{ name: 'star', after: 0, pitch: starPitch(s) }];
      if (s >= 4.5) cues.push({ name: 'ding', after: 160, pitch: 1 });
      else if (s <= 2) cues.push({ name: 'trombone', after: 220, pitch: 1 });
      return cues;
    }
    case 'order_failed': return [{ name: 'slam', after: 0, pitch: 1 }];
    case 'score':
      if (d.reason === 'downtime') return [{ name: 'tick', after: 0, pitch: 1 }];
      if (d.reason === 'boss recovered') return [{ name: 'fanfare', after: 0, pitch: 1 }];
      return [];
    case 'decision_needed': return [{ name: 'jingle', after: 0, pitch: 1 }];
    case 'chaos': {
      const w = typeof d.creature === 'string' ? WORLD_SOUND[d.creature] : undefined;
      return w ? [{ name: w, after: 0, pitch: 1 }] : [];
    }
    default: {
      const n = soundFor(ev);
      return n ? [{ name: n, after: 0, pitch: 1 }] : [];
    }
  }
}

/** Pure mapping from an arena event to the sound it triggers, or null for silence. */
export function soundFor(ev: SoundEv): SoundName | null {
  switch (ev.type) {
    // TV3-U6: the dial hitting the 11 override (THROW EVERYTHING) rises.
    case 'intensity': return ev.detail?.level === 11 ? 'rise' : null;
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
export const MIN_GAP_MS: Record<SoundName, number> = { rattle: 120, creak: 250, wail: 900, thud: 150, sting: 1500, rise: 2500,
  doorOpen: 400, doorClose: 400, star: 200, ding: 400, trombone: 1200, slam: 800, tick: 1500, fanfare: 2000, jingle: 1500, rustle: 600, meow: 800, crash: 1000,
};

/** At most this many sounds sound at once (ui-spec section 14). */
export const MAX_VOICES = 8;

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

const synth: Record<SoundName, (ctx: Ctx, out: AudioNode, t: number, pitch: number) => void> = {
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
  // Rise: a sawtooth climbing two octaves through an opening filter, over a noise swell (the 11 override).
  rise(ctx, out, t) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + 1.3);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 5;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3600, t + 1.3);
    const g = ctx.createGain(); env(ctx, g, t, 0.22, 1.1, 1.45);
    o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 1.5);
    const s = noise(ctx, 1.4);
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 2;
    nf.frequency.setValueAtTime(400, t); nf.frequency.exponentialRampToValueAtTime(5000, t + 1.3);
    const ng = ctx.createGain(); env(ctx, ng, t, 0.16, 1.1, 1.4);
    s.connect(nf).connect(ng).connect(out); s.start(t);
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
  // Door open: a slow creak, pitch sliding up like a hinge.
  doorOpen(ctx, out, t) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(150, t + 0.4);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 10;
    const g = ctx.createGain(); env(ctx, g, t, 0.16, 0.1, 0.45);
    o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 0.5);
  },
  // Door close: a heavy wooden thud.
  doorClose(ctx, out, t) {
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    const g = ctx.createGain(); env(ctx, g, t, 0.6, 0.004, 0.3);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.32);
    const s = noise(ctx, 0.05);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const ng = ctx.createGain(); env(ctx, ng, t, 0.25, 0.002, 0.04);
    s.connect(f).connect(ng).connect(out); s.start(t);
  },
  // Star chime: two bell partials; `pitch` follows the star count.
  star(ctx, out, t, pitch) {
    for (const [mul, peak] of [[1, 0.25], [2.76, 0.08]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 660 * pitch * mul;
      const g = ctx.createGain(); env(ctx, g, t, peak, 0.005, 0.5);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.55);
    }
  },
  // Ding: a bright two-note bell for 4.5 stars and up.
  ding(ctx, out, t) {
    [1320, 1760].forEach((hz, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz;
      const g = ctx.createGain(); env(ctx, g, t + i * 0.09, 0.22, 0.004, 0.6);
      o.connect(g).connect(out); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.65);
    });
  },
  // Sad trombone blip: a short falling, wobbling sawtooth.
  trombone(ctx, out, t) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t); o.frequency.linearRampToValueAtTime(196, t + 0.18); o.frequency.linearRampToValueAtTime(147, t + 0.55);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain(); env(ctx, g, t, 0.2, 0.03, 0.6);
    o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 0.65);
  },
  // Cancel slam: a deep hit with a noise crack.
  slam(ctx, out, t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.3);
    const g = ctx.createGain(); env(ctx, g, t, 0.8, 0.003, 0.45);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.5);
    const s = noise(ctx, 0.12);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 1;
    const ng = ctx.createGain(); env(ctx, ng, t, 0.35, 0.002, 0.1);
    s.connect(f).connect(ng).connect(out); s.start(t);
  },
  // Downtime tick: a very quiet click.
  tick(ctx, out, t) {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1500;
    const g = ctx.createGain(); env(ctx, g, t, 0.025, 0.002, 0.03);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.04);
  },
  // Boss recovered: a short rising major fanfare.
  fanfare(ctx, out, t) {
    [392, 523, 659, 784].forEach((hz, i) => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
      const dur = i === 3 ? 0.5 : 0.14;
      const g = ctx.createGain(); env(ctx, g, t + i * 0.13, 0.13, 0.01, dur);
      o.connect(f).connect(g).connect(out); o.start(t + i * 0.13); o.stop(t + i * 0.13 + dur + 0.05);
    });
  },
  // Decision jingle: two questioning notes.
  jingle(ctx, out, t) {
    [523, 784].forEach((hz, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz;
      const g = ctx.createGain(); env(ctx, g, t + i * 0.16, 0.2, 0.01, 0.3);
      o.connect(g).connect(out); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.35);
    });
  },
  // Scarecrow rustle: a dry swell of high noise.
  rustle(ctx, out, t) {
    const s = noise(ctx, 0.5);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
    const g = ctx.createGain(); env(ctx, g, t, 0.18, 0.15, 0.5);
    s.connect(f).connect(g).connect(out); s.start(t);
  },
  // Black cat meow: a vowel-like sine bend through a formant filter.
  meow(ctx, out, t) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t); o.frequency.linearRampToValueAtTime(780, t + 0.18); o.frequency.linearRampToValueAtTime(480, t + 0.5);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1800, t + 0.2); f.frequency.linearRampToValueAtTime(1000, t + 0.5);
    const g = ctx.createGain(); env(ctx, g, t, 0.22, 0.05, 0.55);
    o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 0.6);
  },
  // Phantom car crash: a noise burst over a falling square screech.
  crash(ctx, out, t) {
    const s = noise(ctx, 0.5);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const ng = ctx.createGain(); env(ctx, ng, t, 0.4, 0.004, 0.45);
    s.connect(f).connect(ng).connect(out); s.start(t);
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.35);
    const g = ctx.createGain(); env(ctx, g, t, 0.14, 0.004, 0.35);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.4);
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

  private voices = 0;

  onEvent(ev: SoundEv, now: number): void {
    for (const cue of cuesFor(ev)) this.play(cue, now);
  }

  private play(cue: SoundCue, now: number): void {
    if (this.state.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    if (!canPlay(cue.name, now, this.last) || this.voices >= MAX_VOICES) return;
    this.last[cue.name] = now;
    this.voices++;
    synth[cue.name](this.ctx, this.master, this.ctx.currentTime + 0.01 + cue.after / 1000, cue.pitch);
    setTimeout(() => { this.voices = Math.max(0, this.voices - 1); }, cue.after + 1500);
  }
}
