import { describe, expect, it } from 'vitest';
import { patterns } from './haptics';

describe('haptic patterns', () => {
  for (const [name, p] of Object.entries(patterns)) {
    it(`${name} is something the phone can play`, () => {
      // Waveform: off/on pairs, a strength for each, all in range.
      expect(p.timings.length).toBe(p.amplitudes.length);
      expect(p.timings.length % 2).toBe(0);
      expect(p.timings.every((t) => Number.isInteger(t) && t >= 0)).toBe(true);
      expect(p.amplitudes.every((a, i) => Number.isInteger(a) && a >= 0 && a <= 255 && (i % 2 === 1 || a === 0))).toBe(true);
      // Short enough to feel like feedback, not an alarm.
      expect(p.timings.reduce((a, b) => a + b, 0)).toBeLessThan(800);
      // Primitives: strengths 0–1, no negative pauses.
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.steps.every((s) => s.s > 0 && s.s <= 1 && (s.d ?? 0) >= 0)).toBe(true);
    });
  }
});
