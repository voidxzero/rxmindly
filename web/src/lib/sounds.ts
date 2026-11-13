// Small, soft sounds for taking, skipping and refilling. They are made on the
// spot with Web Audio (no sound files), kept quiet, and can be turned off in
// Settings. A browser only lets a page make sound after a tap, which is always
// when these play.

import { getSnapshot } from './store';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!getSnapshot().settings.sounds) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface Tone {
  freq: number;
  /** Glide to this pitch by the end. */
  to?: number;
  at?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

function play(...tones: Tone[]) {
  const c = audio();
  if (!c) return;
  const now = c.currentTime + 0.01;
  for (const { freq, to, at = 0, dur, type = 'sine', gain = 0.06 } of tones) {
    const t0 = now + at;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

export const sounds = {
  /** A soft pop and a little chime. */
  take: () => play({ freq: 440, to: 880, dur: 0.09, gain: 0.07 }, { freq: 1318, at: 0.07, dur: 0.35, gain: 0.04 }),
  /** Every dose of the day taken: a happy four-note run. */
  dayDone: () =>
    play(
      { freq: 440, to: 880, dur: 0.09, gain: 0.07 },
      ...[784, 988, 1175, 1568].map((freq, i) => ({ freq, at: 0.08 + i * 0.085, dur: 0.32, gain: 0.045 })),
    ),
  /** A gentle low tock. */
  skip: () => play({ freq: 330, to: 220, dur: 0.14, type: 'triangle', gain: 0.06 }),
  /** A quick step down. */
  undo: () => play({ freq: 700, to: 420, dur: 0.12, gain: 0.05 }),
  /** Pills rattling into the bottle, then a chime. */
  refill: () =>
    play(
      ...Array.from({ length: 6 }, (_, i) => ({ freq: 1900 + ((i * 397) % 900), at: i * 0.045, dur: 0.035, type: 'triangle' as const, gain: 0.025 })),
      { freq: 988, at: 0.32, dur: 0.3, gain: 0.04 },
      { freq: 1318, at: 0.4, dur: 0.4, gain: 0.035 },
    ),
  /** The faintest tick, for answering a journal question. */
  tap: () => play({ freq: 1200, dur: 0.05, gain: 0.025 }),
};
