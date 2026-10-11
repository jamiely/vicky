import type { PocketColor, SlotKind } from '../config';

/**
 * Procedural Web Audio sound for the cabinet. No samples: every sound is synthesized from oscillators and a generated
 * noise buffer. Reference measurements (spectral flux / centroid / chroma over `media/NEW PUSHER… [3-koMfby63A].mkv`
 * and the expo clip; commentary overlaps, so values are approximate):
 * - Ball-on-peg clicks: transient peaks 1.2–2.0 kHz, spectral centroid 1.3–1.5 kHz in normal play (0:27, 6:38, 9:20).
 * - Attract/idle music: ~92 BPM pulse in both the expo clip and the demo video; pitch classes cluster on G/F♯/D.
 * - Party Time (1:19, 1:32): pulse ~199/min (eighth notes at 100 BPM), centroid rises to ~1.9 kHz, G/B♭/A pitch
 *   classes → a driving G-minor bed. Ticket Party is the lighter major-key variant.
 */

export type ImpactKind = 'peg' | 'tray' | 'pearl' | 'disk';
type Music = 'idle' | 'ticket' | 'ball';

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const MAX_IMPACT_VOICES = 12;
/** Minimum spacing between impacts of one kind (s); bursts of simultaneous contacts collapse into one voice. */
const IMPACT_SPACING: Record<ImpactKind, number> = { peg: 0.012, tray: 0.02, pearl: 0.06, disk: 0.05 };
const LOOKAHEAD = 0.12;
const MUSIC_LEVEL: Record<Music, number> = { idle: 0.32, ticket: 0.55, ball: 0.7 };
const MUSIC_BPM: Record<Music, number> = { idle: 92, ticket: 100, ball: 100 };
/** Bar chords as [root MIDI, intervals]. Idle/Ticket: G major I–vi–IV–V. Ball Party: G minor i–VI–VII–V. */
const CHORDS: Record<Music, [number, number[]][]> = {
  idle: [[43, [0, 4, 7]], [40, [0, 3, 7]], [36, [0, 4, 7]], [38, [0, 4, 7]]],
  ticket: [[43, [0, 4, 7]], [36, [0, 4, 7]], [38, [0, 4, 7]], [36, [0, 4, 7]]],
  ball: [[43, [0, 3, 7]], [39, [0, 4, 7]], [41, [0, 4, 7]], [38, [0, 4, 7]]],
};
/** Pocket payout jingles: note count and starting pitch rise with value (G-major pentatonic). */
const POCKET_NOTES: Record<PocketColor, number[]> = { green: [79, 83], red: [79, 83, 86], yellow: [79, 81, 83, 86, 91] };
/** Ticket-counter ticks after a pocket payout, by tier. */
const POCKET_TICKS: Record<PocketColor, number> = { green: 4, red: 6, yellow: 10 };
const PENTATONIC = [0, 2, 4, 7, 9];

export class SoundEngine {
  private ctx: BaseAudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private duck!: GainNode;
  private reverb!: GainNode;
  private motor!: GainNode;
  private rattle!: GainNode;
  private noise!: AudioBuffer;
  private isMuted = false;
  /** Scheduled stop times of playing voices (pruned on read). */
  private voiceEnds: number[] = [];
  private readonly lastImpact: Record<ImpactKind, number> = { peg: -Infinity, tray: -Infinity, pearl: -Infinity, disk: -Infinity };
  private mode: Music = 'idle';
  private step = 0;
  private nextStepTime = 0;
  private lastPhase = 0;
  private lastUpdate = 0;
  private timer = 0;

  /** `createContext` is the audio device factory; tests inject an `OfflineAudioContext` to render deterministically. */
  constructor(private readonly createContext: () => BaseAudioContext = () => new AudioContext()) {}

  unlock(): void {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = this.createContext();
    this.ctx = ctx;

    // Mix: buses → master → glue compressor → brick-wall-ish limiter → speakers.
    const glue = new DynamicsCompressorNode(ctx, { threshold: -16, knee: 10, ratio: 5, attack: 0.004, release: 0.2 });
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.08 });
    this.master = new GainNode(ctx, { gain: this.isMuted ? 0 : 0.85 });
    this.master.connect(glue).connect(limiter).connect(ctx.destination);
    this.sfx = new GainNode(ctx, { gain: 0.9 });
    this.sfx.connect(this.master);
    this.duck = new GainNode(ctx, { gain: 1 });
    this.music = new GainNode(ctx, { gain: MUSIC_LEVEL.idle });
    this.music.connect(this.duck).connect(this.master);

    // Noise source shared by every percussive sound (2 s, generated once).
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Small arcade-hall reverb from a generated decaying-noise impulse.
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.3, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
    }
    this.reverb = new GainNode(ctx, { gain: 0.22 });
    this.reverb.connect(new ConvolverNode(ctx, { buffer: ir })).connect(this.master);

    // Ambience: mains hum, pusher motor (low rumble following pusher speed), disk rattle (AM'd band noise).
    const ambience = new GainNode(ctx, { gain: 1 });
    ambience.connect(this.master);
    for (const [f, g] of [[60, 0.012], [120, 0.006]] as const) {
      const hum = new OscillatorNode(ctx, { frequency: f });
      hum.connect(new GainNode(ctx, { gain: g })).connect(ambience);
      hum.start();
    }
    this.motor = new GainNode(ctx, { gain: 0 });
    this.loopNoise(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 170, Q: 0.7 }), this.motor, ambience);
    this.rattle = new GainNode(ctx, { gain: 0 });
    const rattleAm = new GainNode(ctx, { gain: 0.5 });
    const rattleLfo = new OscillatorNode(ctx, { type: 'square', frequency: 23 });
    rattleLfo.connect(new GainNode(ctx, { gain: 0.5 })).connect(rattleAm.gain);
    rattleLfo.start();
    this.loopNoise(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2600, Q: 1.4 }), rattleAm, this.rattle);
    this.rattle.connect(ambience);

    this.nextStepTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Stops the sequencer and releases the audio device. */
  close(): void {
    window.clearInterval(this.timer);
    if (this.ctx instanceof AudioContext) void this.ctx.close();
    this.ctx = null;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /** Sounds currently playing (diagnostics and voice-limit tests). */
  get activeVoices(): number {
    const now = this.ctx?.currentTime ?? Infinity;
    this.voiceEnds = this.voiceEnds.filter((end) => end > now);
    return this.voiceEnds.length;
  }

  /** Music bed currently selected by `update()`. */
  get musicMode(): Music {
    return this.mode;
  }

  /** True once `unlock()` has created the audio device. */
  get unlocked(): boolean {
    return this.ctx !== null;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.03);
  }

  launch(): void {
    const t = this.now();
    if (t === null) return;
    // Pneumatic "fwip" up the launch tube: band-passed noise sweeping upward, plus a low valve thunk.
    this.noiseHit(t, 0.17, 'bandpass', 500, 1.4, 0.22, this.sfx, 0, 2800);
    this.tone(t, 95, 0.07, 'sine', 0.25, this.sfx);
  }

  impact(kind: ImpactKind, intensity: number, pan: number): void {
    const t = this.now();
    if (t === null) return;
    if (t - this.lastImpact[kind] < IMPACT_SPACING[kind]) return;
    const busy = this.activeVoices;
    if (busy >= MAX_IMPACT_VOICES && intensity < 0.6) return;
    if (busy >= MAX_IMPACT_VOICES * 1.5) return;
    this.lastImpact[kind] = t;
    const v = Math.max(0.05, Math.min(1, intensity));
    const jitter = 0.9 + Math.random() * 0.2;
    switch (kind) {
      case 'peg':
        // Hollow celluloid ball on a chrome screw: 1.6–2.8 kHz click + faint ring (measured peaks 1.2–2.0 kHz).
        this.noiseHit(t, 0.016, 'bandpass', (1600 + 1200 * v) * jitter, 5, 0.6 * v, this.sfx, pan);
        this.tone(t, (2700 + 900 * v) * jitter, 0.03, 'sine', 0.08 * v, this.sfx, pan);
        break;
      case 'tray':
        // Balls landing in the pile: duller, lower clatter.
        this.noiseHit(t, 0.035, 'bandpass', (900 + 700 * v) * jitter, 1.2, 1.1 * v, this.sfx, pan);
        break;
      case 'pearl':
        // Heavy resin pearl: low thump with a short knock.
        this.tone(t, (150 + 80 * v) * jitter, 0.14, 'sine', 0.35 * v, this.sfx, pan);
        this.noiseHit(t, 0.05, 'lowpass', 900, 0.8, 0.18 * v, this.sfx, pan);
        break;
      case 'disk':
        this.noiseHit(t, 0.02, 'highpass', 2600, 1, 0.3 * v, this.sfx, pan);
        break;
    }
  }

  slot(kind: SlotKind): void {
    const t = this.now();
    if (t === null) return;
    if (kind === 'ball') {
      // Bright square-wave arpeggio up a G major triad.
      [79, 83, 86, 91].forEach((n, i) => this.tone(t + i * 0.055, hz(n), 0.13, 'square', 0.07, this.sfx, 0, true));
      this.duckMusic(t, 0.4);
    } else if (kind === 'ticket') {
      // Two-tone bell "ding-ding".
      for (const [dt, n] of [[0, 88], [0.12, 84]] as const) {
        this.tone(t + dt, hz(n), 0.4, 'triangle', 0.14, this.sfx, 0, true);
        this.tone(t + dt, hz(n + 12), 0.25, 'sine', 0.05, this.sfx, 0, true);
      }
      this.duckMusic(t, 0.45);
    } else {
      // LUCKY: fast sparkle run up the pentatonic scale.
      for (let i = 0; i < 8; i++) this.tone(t + i * 0.035, hz(79 + PENTATONIC[i % 5]! + 12 * Math.floor(i / 5)), 0.09, 'square', 0.05, this.sfx, 0, true);
      this.duckMusic(t, 0.4);
    }
  }

  lucky(won: boolean): void {
    const t = this.now();
    if (t === null) return;
    if (won) {
      // Rising glide as the pearl is released from the tower.
      this.glide(t + 0.25, 300, 1200, 0.45, 'sawtooth', 0.08);
      this.tone(t + 0.7, hz(91), 0.35, 'triangle', 0.12, this.sfx, 0, true);
    } else {
      this.tone(t + 0.25, hz(74), 0.14, 'triangle', 0.09, this.sfx);
      this.tone(t + 0.4, hz(69), 0.24, 'triangle', 0.09, this.sfx);
    }
  }

  pocket(color: PocketColor, party: boolean): void {
    const t = this.now();
    if (t === null) return;
    const shift = party ? 12 : 0;
    POCKET_NOTES[color].forEach((n, i) => {
      this.tone(t + i * 0.08, hz(n + shift), 0.3, 'square', 0.06, this.sfx, 0, true);
      this.tone(t + i * 0.08, hz(n + shift - 12), 0.3, 'triangle', 0.08, this.sfx, 0, true);
    });
    // Ticket-counter ticks proportional to the payout tier.
    const ticks = POCKET_TICKS[color] * (party ? 2 : 1);
    for (let i = 0; i < ticks; i++) this.noiseHit(t + 0.3 + i * 0.045, 0.012, 'highpass', 4000, 1, 0.06, this.sfx);
    this.duckMusic(t, 0.8);
  }

  jackpot(amount: number): void {
    const t = this.now();
    if (t === null) return;
    // Brass stabs G–G–C–D–G, a two-tone siren, and a run of bells; longer for bigger jackpots.
    const stabs: [number, number[]][] = [[0, [55, 59, 62, 67]], [0.22, [55, 59, 62, 67]], [0.5, [60, 64, 67, 72]], [0.85, [62, 66, 69, 74]], [1.2, [67, 71, 74, 79]]];
    for (const [dt, notes] of stabs) for (const n of notes) this.brass(t + dt, hz(n), dt === 1.2 ? 1.4 : 0.26, 0.05);
    const siren = new OscillatorNode(this.ctx!, { type: 'triangle', frequency: 800 });
    const lfo = new OscillatorNode(this.ctx!, { type: 'square', frequency: 3 });
    lfo.connect(new GainNode(this.ctx!, { gain: 250 })).connect(siren.frequency);
    const g = new GainNode(this.ctx!, { gain: 0 });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.1);
    g.gain.setValueAtTime(0.06, t + 2.4);
    g.gain.linearRampToValueAtTime(0, t + 2.8);
    siren.connect(g).connect(this.sfx);
    siren.start(t);
    lfo.start(t);
    siren.stop(t + 2.9);
    lfo.stop(t + 2.9);
    const bells = Math.min(24, 10 + Math.floor(amount / 200));
    for (let i = 0; i < bells; i++) this.tone(t + 0.3 + i * 0.09, hz(91 + PENTATONIC[i % 5]!), 0.2, 'sine', 0.06, this.sfx, (i % 2) * 0.6 - 0.3, true);
    this.duckMusic(t, 3.2);
  }

  partyStart(side: 'ball' | 'ticket'): void {
    const t = this.now();
    if (t === null) return;
    this.glide(t, 200, side === 'ball' ? 1600 : 1000, 0.5, 'sawtooth', 0.07);
    const fanfare = side === 'ball' ? [67, 70, 74, 79] : [67, 71, 74, 79];
    fanfare.forEach((n, i) => this.brass(t + 0.5 + i * 0.12, hz(n), i === 3 ? 0.7 : 0.14, 0.09));
    this.duckMusic(t, 1.4);
  }

  partyEnd(side: 'ball' | 'ticket'): void {
    const t = this.now();
    if (t === null) return;
    const notes = side === 'ball' ? [74, 70, 67] : [74, 71, 67];
    notes.forEach((n, i) => this.tone(t + i * 0.15, hz(n), 0.3, 'triangle', 0.1, this.sfx, 0, true));
  }

  credit(): void {
    const t = this.now();
    if (t === null) return;
    // Coin "ka-ching".
    this.tone(t, 1318.5, 0.07, 'square', 0.07, this.sfx);
    this.tone(t + 0.07, 2637, 0.35, 'square', 0.06, this.sfx, 0, true);
    this.noiseHit(t + 0.07, 0.2, 'highpass', 6000, 1, 0.05, this.sfx);
  }

  update(state: { pusherPhase: number; ballParty: boolean; ticketParty: boolean; diskPearls: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const dt = Math.max(1e-3, t - this.lastUpdate);
    const speed = Math.min(1, Math.abs(state.pusherPhase - this.lastPhase) / dt / 0.8);
    this.lastPhase = state.pusherPhase;
    this.lastUpdate = t;
    this.motor.gain.setTargetAtTime(0.03 + 0.07 * speed, t, 0.08);
    this.rattle.gain.setTargetAtTime(state.diskPearls > 0 ? Math.min(0.06, 0.03 + 0.01 * state.diskPearls) : 0, t, 0.1);
    const mode: Music = state.ballParty ? 'ball' : state.ticketParty ? 'ticket' : 'idle';
    if (mode !== this.mode) {
      this.mode = mode;
      this.step = 0;
      this.music.gain.setTargetAtTime(MUSIC_LEVEL[mode], t, 0.3);
    }
  }

  // ---- internals ----

  /** Current audio time, or null when sounds must not be created (locked or muted). */
  private now(): number | null {
    return this.ctx && !this.isMuted ? this.ctx.currentTime : null;
  }

  private loopNoise(filter: BiquadFilterNode, gain: AudioNode, dest: AudioNode): void {
    const src = new AudioBufferSourceNode(this.ctx!, { buffer: this.noise, loop: true });
    src.connect(filter).connect(gain).connect(dest);
    src.start();
  }

  /**
   * Stops `node` at `stopAt`; sound effects (not music-bed notes) count toward the impact voice budget until then.
   * Counting by schedule rather than `ended` events matters: lost events would leak the budget until impacts were
   * silenced for good.
   */
  private track(node: AudioScheduledSourceNode, stopAt: number, dest: AudioNode = this.sfx): void {
    node.stop(stopAt);
    if (dest !== this.music) this.voiceEnds.push(stopAt);
  }

  /** Enveloped oscillator note; `wet` also feeds the reverb. */
  private tone(t: number, freq: number, dur: number, type: OscillatorType, gain: number, dest: AudioNode, pan = 0, wet = false): void {
    const ctx = this.ctx!;
    const osc = new OscillatorNode(ctx, { type, frequency: freq });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    const out = pan === 0 ? env : env.connect(new StereoPannerNode(ctx, { pan }));
    osc.connect(env);
    out.connect(dest);
    if (wet) out.connect(this.reverb);
    osc.start(t);
    this.track(osc, t + dur + 0.02, dest);
  }

  /** Filtered noise burst; optional sweep of the filter frequency to `sweepTo`. */
  private noiseHit(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, dest: AudioNode, pan = 0, sweepTo?: number): void {
    const ctx = this.ctx!;
    const src = new AudioBufferSourceNode(ctx, { buffer: this.noise });
    const filter = new BiquadFilterNode(ctx, { type, frequency: freq, Q: q });
    if (sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.002);
    env.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    src.connect(filter).connect(env);
    (pan === 0 ? env : env.connect(new StereoPannerNode(ctx, { pan }))).connect(dest);
    src.start(t, Math.random() * 1.5);
    this.track(src, t + dur + 0.02, dest);
  }

  private glide(t: number, from: number, to: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx!;
    const osc = new OscillatorNode(ctx, { type, frequency: from });
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3000 });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.03);
    env.gain.setValueAtTime(gain, t + dur * 0.8);
    env.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    osc.connect(filter).connect(env).connect(this.sfx);
    env.connect(this.reverb);
    osc.start(t);
    this.track(osc, t + dur + 0.02);
  }

  /** Brass-like stab: detuned saws through an opening low-pass. */
  private brass(t: number, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 600, Q: 1.2 });
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.linearRampToValueAtTime(3200, t + 0.06);
    filter.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.02);
    env.gain.setValueAtTime(gain, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    filter.connect(env).connect(this.sfx);
    env.connect(this.reverb);
    for (const detune of [-8, 8]) {
      const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: freq, detune });
      osc.connect(filter);
      osc.start(t);
      this.track(osc, t + dur + 0.02);
    }
  }

  private duckMusic(t: number, seconds: number): void {
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(0.35, t, 0.02);
    this.duck.gain.setTargetAtTime(1, t + seconds, 0.25);
  }

  /** Lookahead sequencer: schedules 16th-note steps of the current music bed slightly ahead of audio time. */
  private schedule(): void {
    const ctx = this.ctx!;
    // A suspended context's clock is frozen, so this schedules at most one lookahead window until it resumes.
    if (ctx.state === 'closed') return;
    const stepDur = 60 / MUSIC_BPM[this.mode] / 4;
    if (this.nextStepTime < ctx.currentTime - 0.5) this.nextStepTime = ctx.currentTime + 0.05; // tab was hidden
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD) {
      if (!this.isMuted) this.playStep(this.step, this.nextStepTime, stepDur);
      this.step = (this.step + 1) % 64;
      this.nextStepTime += stepDur;
    }
  }

  private playStep(step: number, t: number, stepDur: number): void {
    const ctx = this.ctx!;
    const [root, intervals] = CHORDS[this.mode][Math.floor(step / 16)]!;
    const inBar = step % 16;
    const m = this.music;
    if (this.mode === 'idle') {
      // Attract bed: soft pad per bar + gentle eighth-note arpeggio.
      if (inBar === 0) for (const iv of intervals) this.pad(t, hz(root + 24 + iv), stepDur * 16, 0.03);
      if (inBar % 2 === 0) {
        const note = root + 36 + intervals[(inBar / 2) % intervals.length]! + (inBar >= 8 ? 12 : 0);
        this.tone(t, hz(note), stepDur * 3, 'triangle', 0.05, m, 0, true);
      }
      if (inBar % 4 === 0) this.tone(t, hz(root + 12), stepDur * 3.5, 'sine', 0.1, m);
      return;
    }
    const ball = this.mode === 'ball';
    // Party beds: four-on-the-floor kick, offbeat open hats, eighth hats (≈199/min), claps on 2 & 4, bass, lead.
    if (inBar % 4 === 0) this.kick(t);
    if (inBar % 2 === 0) this.noiseHit(t, inBar % 4 === 2 ? 0.09 : 0.03, 'highpass', 7500, 1, ball ? 0.07 : 0.05, m);
    if (ball && (inBar === 4 || inBar === 12)) this.noiseHit(t, 0.14, 'bandpass', 1700, 1.2, 0.16, m);
    if (ball ? inBar % 2 === 0 : inBar % 4 === 0) {
      const bass = new OscillatorNode(ctx, { type: 'sawtooth', frequency: hz(root + (inBar % 4 === 2 ? 12 : 0)) });
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: ball ? 900 : 600, Q: 4 });
      const env = new GainNode(ctx, { gain: 0 });
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.12, t + 0.005);
      env.gain.exponentialRampToValueAtTime(1e-4, t + stepDur * 1.8);
      bass.connect(lp).connect(env).connect(m);
      bass.start(t);
      bass.stop(t + stepDur * 2);
    }
    const leadEvery = ball ? 1 : 2;
    if (inBar % leadEvery === 0) {
      const idx = Math.floor(inBar / leadEvery);
      const note = root + 36 + intervals[idx % intervals.length]! + 12 * (Math.floor(idx / intervals.length) % 2);
      this.tone(t, hz(note), stepDur * 0.9, ball ? 'square' : 'triangle', ball ? 0.035 : 0.05, m, 0, true);
    }
  }

  private pad(t: number, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: freq });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1100, Q: 0.5 });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
    env.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(lp).connect(env).connect(this.music);
    env.connect(this.reverb);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const osc = new OscillatorNode(ctx, { frequency: 150 });
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.003);
    env.gain.exponentialRampToValueAtTime(1e-4, t + 0.25);
    osc.connect(env).connect(this.music);
    osc.start(t);
    osc.stop(t + 0.27);
  }
}
