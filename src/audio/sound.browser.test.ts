import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundEngine } from './sound';

/**
 * Sounds are rendered through an OfflineAudioContext (faster than real time, no wall-clock waits) and judged by the
 * signal they actually produce. The ambience hum is deterministic, so subtracting a silent render isolates each cue.
 */
const RATE = 22050;
const engines: SoundEngine[] = [];
// Fake timers everywhere: the music sequencer runs on setInterval, so with real timers it would schedule notes at
// whatever moment the timer happened to fire during offline rendering. Tests that want music tick it explicitly.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const s of engines.splice(0)) s.close();
  vi.useRealTimers();
});

function offline(seconds: number): { ctx: OfflineAudioContext; engine: SoundEngine } {
  const ctx = new OfflineAudioContext(2, RATE * seconds, RATE);
  const engine = new SoundEngine(() => ctx);
  engines.push(engine);
  return { ctx, engine };
}

function rms(buffer: AudioBuffer, from = 0, to = buffer.duration): number {
  const data = buffer.getChannelData(0);
  let sum = 0;
  const a = Math.floor(from * buffer.sampleRate);
  const b = Math.min(data.length, Math.floor(to * buffer.sampleRate));
  for (let i = a; i < b; i++) sum += data[i]! * data[i]!;
  return Math.sqrt(sum / Math.max(1, b - a));
}

/** RMS of `buffer − base` over [from, to): the cue's own signal with the ambience cancelled out. */
function added(buffer: AudioBuffer, base: AudioBuffer, from = 0, to = buffer.duration): number {
  const a = buffer.getChannelData(0);
  const b = base.getChannelData(0);
  const i0 = Math.floor(from * buffer.sampleRate);
  const i1 = Math.min(a.length, Math.floor(to * buffer.sampleRate));
  let sum = 0;
  for (let i = i0; i < i1; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum / Math.max(1, i1 - i0));
}

/** Largest sample of `buffer − base`: catches short clicks that barely move a long-window RMS. */
function peakAdded(buffer: AudioBuffer, base: AudioBuffer): number {
  const a = buffer.getChannelData(0);
  const b = base.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i]! - b[i]!));
  return peak;
}

async function render(seconds: number, play: (s: SoundEngine) => void): Promise<{ buffer: AudioBuffer; engine: SoundEngine }> {
  const { ctx, engine } = offline(seconds);
  engine.unlock();
  play(engine);
  return { buffer: await ctx.startRendering(), engine };
}

const idle = { pusherPhase: 0, ballParty: false, ticketParty: false, diskPearls: 0 };

describe('SoundEngine', () => {
  it('creates no audio device and stays silent before unlock', () => {
    const factory = vi.fn(() => new OfflineAudioContext(1, RATE, RATE));
    const s = new SoundEngine(factory);
    engines.push(s);
    s.launch();
    s.impact('peg', 1, 0);
    s.slot('ball');
    s.jackpot(1200);
    s.update(idle);
    expect(factory).not.toHaveBeenCalled();
    expect(s.unlocked).toBe(false);
    expect(s.activeVoices).toBe(0);
  });

  const cues: [string, (s: SoundEngine) => void][] = [
    ['launch', (s) => s.launch()],
    ['ball slot', (s) => s.slot('ball')],
    ['ticket slot', (s) => s.slot('ticket')],
    ['lucky slot', (s) => s.slot('lucky')],
    ['lucky win', (s) => s.lucky(true)],
    ['lucky miss', (s) => s.lucky(false)],
    ['green pocket', (s) => s.pocket('green', false)],
    ['red pocket (party)', (s) => s.pocket('red', true)],
    ['yellow pocket', (s) => s.pocket('yellow', false)],
    ['jackpot', (s) => s.jackpot(4000)],
    ['ball party start', (s) => s.partyStart('ball')],
    ['ticket party start', (s) => s.partyStart('ticket')],
    ['ball party end', (s) => s.partyEnd('ball')],
    ['ticket party end', (s) => s.partyEnd('ticket')],
    ['credit', (s) => s.credit()],
    ['peg impact', (s) => s.impact('peg', 1, -0.5)],
    ['tray impact', (s) => s.impact('tray', 1, 0.5)],
    ['pearl impact', (s) => s.impact('pearl', 1, 0)],
    ['disk impact', (s) => s.impact('disk', 1, 0)],
  ];
  it.each(cues)('%s produces sound and all its voices finish', async (_, play) => {
    const silent = await render(3.5, () => {});
    const { buffer, engine } = await render(3.5, play);
    expect(peakAdded(buffer, silent.buffer)).toBeGreaterThan(0.01);
    expect(engine.activeVoices).toBe(0);
  });

  it('jackpot fanfare outlasts a pocket payout', async () => {
    const silent = await render(3, () => {});
    const jackpot = await render(3, (s) => s.jackpot(1200));
    const pocket = await render(3, (s) => s.pocket('green', false));
    expect(added(jackpot.buffer, silent.buffer, 1.6, 2.4)).toBeGreaterThan(added(pocket.buffer, silent.buffer, 1.6, 2.4) * 3);
  });

  it('harder impacts are louder', async () => {
    const silent = await render(0.5, () => {});
    const soft = await render(0.5, (s) => s.impact('pearl', 0.1, 0));
    const hard = await render(0.5, (s) => s.impact('pearl', 1, 0));
    expect(added(hard.buffer, silent.buffer)).toBeGreaterThan(added(soft.buffer, silent.buffer) * 2);
  });

  it('collapses same-instant hits of one kind into a single voice', () => {
    const { engine } = offline(1);
    engine.unlock();
    engine.impact('peg', 1, 0);
    const one = engine.activeVoices;
    for (let i = 0; i < 10; i++) engine.impact('peg', 1, 0);
    expect(engine.activeVoices).toBe(one);
  });

  it('music-bed notes never use up the impact voice budget', () => {
    const { engine } = offline(2);
    engine.unlock();
    engine.update({ ...idle, ballParty: true });
    vi.advanceTimersByTime(25); // schedule a lookahead window of the busiest bed
    expect(engine.activeVoices).toBe(0);
    engine.impact('peg', 0.2, 0);
    expect(engine.activeVoices).toBeGreaterThan(0);
  });

  it('drops quiet impacts once the voice budget is spent', () => {
    const { engine } = offline(1);
    engine.unlock();
    engine.jackpot(1200); // fills the voice budget
    const busy = engine.activeVoices;
    engine.impact('tray', 0.2, 0);
    engine.impact('pearl', 0.2, 0);
    engine.impact('disk', 0.2, 0);
    expect(engine.activeVoices).toBe(busy);
  });

  it('is silent while muted, whether muted before or after unlock', async () => {
    const audible = await render(1, () => {});
    const { ctx, engine } = offline(1);
    engine.setMuted(true);
    engine.unlock();
    engine.slot('ticket');
    engine.pocket('yellow', true);
    expect(engine.activeVoices).toBe(0);
    expect(rms(await ctx.startRendering())).toBeLessThan(1e-5);
    expect(rms(audible.buffer)).toBeGreaterThan(1e-4);

    const later = offline(1);
    later.engine.unlock();
    later.engine.setMuted(true);
    expect(later.engine.muted).toBe(true);
    later.engine.setMuted(false);
    later.engine.credit();
    expect(later.engine.activeVoices).toBeGreaterThan(0);
  });

  /**
   * RMS of the first difference over [from, to): a high-pass view (≈ −26 dB at 170 Hz, ≈ −12 dB at 900 Hz) that drops
   * the hum and the low-passed pusher-motor noise (random per engine, so not cancellable) but keeps the music.
   */
  function hf(buffer: AudioBuffer, from = 0, to = buffer.duration): number {
    const data = buffer.getChannelData(0);
    const a = Math.max(1, Math.floor(from * buffer.sampleRate));
    const b = Math.min(data.length, Math.floor(to * buffer.sampleRate));
    let sum = 0;
    for (let i = a; i < b; i++) sum += (data[i]! - data[i - 1]!) ** 2;
    return Math.sqrt(sum / Math.max(1, b - a));
  }

  /**
   * Renders a music bed while ticking the sequencer every 0.1 s of audio time (via suspend/resume), as the real
   * 25 ms interval would. `firstTick` delays the first tick to model a stalled (hidden) tab; `ticks: false` never ticks.
   */
  async function playBed(state: typeof idle, seconds: number, options: { muted?: boolean; firstTick?: number; ticks?: boolean } = {}): Promise<AudioBuffer> {
    const { ctx, engine } = offline(seconds);
    engine.setMuted(options.muted ?? false);
    engine.unlock();
    engine.update(state);
    if (options.ticks === false) return ctx.startRendering();
    const quantum = 128 / RATE;
    const first = options.firstTick ?? 0;
    if (first === 0) vi.advanceTimersByTime(25);
    for (let t = Math.max(first, 0.1); t < seconds; t += 0.1) {
      void ctx.suspend(Math.round(t / quantum) * quantum).then(() => {
        vi.advanceTimersByTime(25);
        void ctx.resume();
      });
    }
    return ctx.startRendering();
  }

  it('selects the music bed from party state, Ball Party taking priority', () => {
    const { engine } = offline(1);
    engine.unlock();
    engine.update({ ...idle, ticketParty: true });
    expect(engine.musicMode).toBe('ticket');
    engine.update({ ...idle, ticketParty: true, ballParty: true });
    expect(engine.musicMode).toBe('ball');
    engine.update(idle);
    expect(engine.musicMode).toBe('idle');
  });

  it.each([
    ['idle', idle],
    ['ticket party', { ...idle, ticketParty: true }],
    ['ball party', { ...idle, ballParty: true, ticketParty: true }],
  ])('the %s bed keeps playing through a whole bar', async (_, state) => {
    const quiet = hf(await playBed(state, 2.7, { ticks: false }));
    const bar = await playBed(state, 2.7);
    for (let w = 0.2; w < 2.6; w += 0.5) expect(hf(bar, w, w + 0.5)).toBeGreaterThan(quiet * 3);
  });

  it('party beds are busier than the idle bed', async () => {
    const idleBed = hf(await playBed(idle, 2.5));
    expect(hf(await playBed({ ...idle, ticketParty: true }, 2.5))).toBeGreaterThan(idleBed);
    expect(hf(await playBed({ ...idle, ballParty: true }, 2.5))).toBeGreaterThan(idleBed);
  });

  it('rattles while pearls roll on the disk and hums the pusher motor', async () => {
    const still = await playBed(idle, 1, { ticks: false });
    const rolling = await playBed({ ...idle, diskPearls: 2, pusherPhase: 0.5 }, 1, { ticks: false });
    expect(hf(rolling, 0.3, 1)).toBeGreaterThan(hf(still, 0.3, 1) * 3);
  });

  it('sequencing while muted stays silent', async () => {
    const bar = await playBed({ ...idle, ballParty: true }, 1.5, { muted: true });
    expect(rms(bar)).toBeLessThan(1e-5);
  });

  it('after a stall the sequencer resumes from the present instead of replaying missed steps', async () => {
    const state = { ...idle, ballParty: true };
    const quiet = hf(await playBed(state, 2.5, { ticks: false }));
    const bar = await playBed(state, 2.5, { firstTick: 1.5 });
    expect(hf(bar, 0, 1.45)).toBeLessThan(quiet * 1.5);
    expect(hf(bar, 1.6, 2.5)).toBeGreaterThan(quiet * 3);
  });

  it('unlock is idempotent and close releases the device', () => {
    const factory = vi.fn(() => new OfflineAudioContext(1, RATE, RATE));
    const s = new SoundEngine(factory);
    engines.push(s);
    s.unlock();
    s.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    s.close();
    expect(s.unlocked).toBe(false);
    s.launch();
    expect(s.activeVoices).toBe(0);
  });

  it('opens and closes a real AudioContext', () => {
    const s = new SoundEngine();
    engines.push(s);
    s.unlock();
    expect(s.unlocked).toBe(true);
    s.unlock(); // existing device: resume path
    s.slot('ball');
    s.close();
    expect(s.unlocked).toBe(false);
  });
});
