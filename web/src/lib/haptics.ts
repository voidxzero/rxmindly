// Little vibrations that go with the sounds: a pop for a dose taken, a rising
// run for finishing the day, a rattle for a refill, a wobble when a bottle runs
// low, detents on the journal slider. On Android they come from HapticsPlugin
// (web/android/app/src/main/java/app/rxmindly/HapticsPlugin.java), which plays
// crisp haptic "primitives" where the phone has them and a plain waveform where
// it doesn't. In a browser, navigator.vibrate does what it can (usually nothing
// on a desktop). Turned off in Settings.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { getSnapshot } from './store';

type Primitive = 'click' | 'tick' | 'lowTick' | 'thud' | 'spin' | 'quickRise' | 'slowRise' | 'quickFall';

interface Step {
  p: Primitive;
  /** Strength, 0–1. */
  s: number;
  /** Pause before this step, in ms, counted from the end of the one before. */
  d?: number;
}

/** One vibration: primitives for phones that have them, and a waveform (ms off, ms on, … with strengths 0–255) for the rest. */
export interface Pattern {
  steps: Step[];
  timings: number[];
  amplitudes: number[];
}

const RxHaptics = registerPlugin<{ play(pattern: Pattern): Promise<void> }>('RxHaptics');

/** Builds the waveform from [off, on, strength] pulses. */
function pulses(...list: [off: number, on: number, strength: number][]): Pick<Pattern, 'timings' | 'amplitudes'> {
  const timings: number[] = [];
  const amplitudes: number[] = [];
  for (const [off, on, strength] of list) {
    timings.push(off, on);
    amplitudes.push(0, Math.round(strength * 255));
  }
  return { timings, amplitudes };
}

let lastAt = 0;

function play(pattern: Pattern, { light = false } = {}) {
  if (!getSnapshot().settings.haptics) return;
  // Light ticks (slider detents) never pile up into a hum.
  const now = Date.now();
  if (light && now - lastAt < 35) return;
  lastAt = now;
  if (Capacitor.isNativePlatform()) {
    void RxHaptics.play(pattern).catch(() => {});
    return;
  }
  try {
    // The Vibration API's pattern starts with a buzz and has no strengths.
    navigator.vibrate?.([0, ...pattern.timings]);
  } catch {
    // Not available: nothing to feel.
  }
}

/** Joins two patterns, the second `gap` ms after the first. */
function then(a: Pattern, gap: number, b: Pattern): Pattern {
  const [first, ...rest] = b.steps;
  return {
    steps: [...a.steps, ...(first ? [{ ...first, d: (first.d ?? 0) + gap }, ...rest] : [])],
    timings: [...a.timings, (b.timings[0] ?? 0) + gap, ...b.timings.slice(1)],
    amplitudes: [...a.amplitudes, ...b.amplitudes],
  };
}

export const patterns = {
  /** A soft swell into a crisp click, like a pill popping out of its blister. */
  take: {
    steps: [{ p: 'quickRise', s: 0.35 }, { p: 'click', s: 0.9, d: 10 }],
    ...pulses([0, 14, 0.3], [30, 18, 1]),
  },
  /** Every dose of the day taken: four clicks climbing with the four notes, then a little spin. */
  dayDone: {
    steps: [
      { p: 'quickRise', s: 0.4 },
      { p: 'click', s: 0.45, d: 40 },
      { p: 'click', s: 0.6, d: 60 },
      { p: 'click', s: 0.8, d: 60 },
      { p: 'click', s: 1, d: 60 },
      { p: 'spin', s: 0.5, d: 80 },
    ],
    ...pulses([0, 14, 0.3], [50, 12, 0.45], [70, 12, 0.6], [70, 14, 0.8], [70, 18, 1], [110, 60, 0.35]),
  },
  /** One low, soft tock: set aside, not done. */
  skip: {
    steps: [{ p: 'lowTick', s: 0.8 }],
    ...pulses([0, 22, 0.45]),
  },
  /** A step down. */
  undo: {
    steps: [{ p: 'quickFall', s: 0.6 }],
    ...pulses([0, 12, 0.6], [25, 18, 0.25]),
  },
  /** Pills rattling into the bottle, then the cap clicking shut. */
  refill: {
    steps: [
      ...[0.5, 0.3, 0.6, 0.25, 0.45, 0.3].map((s, i): Step => ({ p: 'tick', s, d: i ? 22 + ((i * 13) % 20) : 0 })),
      { p: 'thud', s: 0.7, d: 90 },
      { p: 'click', s: 0.9, d: 40 },
    ],
    ...pulses(...[0.5, 0.3, 0.6, 0.25, 0.45, 0.3].map((s, i): [number, number, number] => [i ? 22 + ((i * 13) % 20) : 0, 8, s]), [110, 30, 0.6], [50, 14, 1]),
  },
  /** Two loose knocks, like the bottle wobbling: it's running low. */
  lowBottle: {
    steps: [{ p: 'thud', s: 0.5 }, { p: 'thud', s: 0.35, d: 120 }],
    ...pulses([0, 35, 0.45], [140, 30, 0.3]),
  },
  /** A soft double tap: synced. */
  synced: {
    steps: [{ p: 'tick', s: 0.6 }, { p: 'click', s: 0.5, d: 70 }],
    ...pulses([0, 10, 0.4], [80, 12, 0.5]),
  },
  /** Two firm knocks: that didn't work. */
  failed: {
    steps: [{ p: 'thud', s: 0.9 }, { p: 'thud', s: 0.9, d: 90 }],
    ...pulses([0, 40, 0.8], [90, 40, 0.8]),
  },
} satisfies Record<string, Pattern>;

/** The faintest tick. `strength` 0–1. */
function tick(strength: number): Pattern {
  const s = Math.max(0.15, Math.min(1, strength));
  return { steps: [{ p: 'tick', s }], ...pulses([0, 6 + Math.round(s * 6), s * 0.6]) };
}

export const haptics = {
  take: () => play(patterns.take),
  dayDone: () => play(patterns.dayDone),
  skip: () => play(patterns.skip),
  undo: () => play(patterns.undo),
  refill: () => play(patterns.refill),
  /** A dose taken that left a bottle running low: the pop, then the wobble. */
  takeLow: (dayDone = false) => play(then(dayDone ? patterns.dayDone : patterns.take, 180, patterns.lowBottle)),
  synced: () => play(patterns.synced),
  failed: () => play(patterns.failed),
  /** Answering a journal question. Higher answers feel a little firmer. */
  answer: (fraction: number) => play({ steps: [{ p: 'click', s: 0.35 + fraction * 0.55 }], ...pulses([0, 12, 0.3 + fraction * 0.5]) }),
  /** A slider passing a whole number, or a pull reaching far enough to let go. */
  detent: (fraction = 0.5) => play(tick(0.3 + fraction * 0.5), { light: true }),
  /** Moving to another day or screen. */
  step: () => play(tick(0.35), { light: true }),
};
