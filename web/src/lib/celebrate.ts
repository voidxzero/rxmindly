// A little burst of confetti for taking a dose. Purely for fun: it draws over
// the page, ignores touches, and cleans up after itself.

import { MED_COLORS } from './types';

const SHAPES = ['pill', 'dot', 'square'];

/**
 * Throws confetti out from the middle of `origin` (or the middle of the screen).
 * `big` is for finishing the whole day.
 */
export function celebrate(origin?: Element | null, big = false) {
  if (typeof document === 'undefined' || typeof Element.prototype.animate !== 'function') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const rect = origin?.getBoundingClientRect();
  // Kept on screen, in case the button that was pressed has scrolled out of view.
  const within = (value: number, size: number) => Math.min(size - 20, Math.max(20, value));
  const x = within(rect ? rect.left + rect.width / 2 : window.innerWidth / 2, window.innerWidth);
  const y = within(rect ? rect.top + rect.height / 2 : window.innerHeight / 2, window.innerHeight);
  const count = big ? 70 : 18;
  const reach = big ? Math.min(window.innerWidth, 520) * 0.6 : 90;

  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  let longest = 0;

  for (let i = 0; i < count; i++) {
    const bit = document.createElement('span');
    bit.className = `confetti-bit ${SHAPES[i % SHAPES.length]}`;
    bit.style.left = `${x}px`;
    bit.style.top = `${y}px`;
    bit.style.background = `var(--med-${MED_COLORS[i % MED_COLORS.length]})`;
    layer.append(bit);

    // Mostly upward, like something popped.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * (big ? 1.5 : 1.7);
    const distance = reach * (0.45 + Math.random() * 0.55);
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    const fall = (big ? 220 : 70) * (0.6 + Math.random() * 0.8);
    const spin = (Math.random() - 0.5) * 900;
    const duration = (big ? 1500 : 800) + Math.random() * (big ? 700 : 300);
    longest = Math.max(longest, duration);
    const at = (px: number, py: number, turn: number, scale: number) => `translate(-50%, -50%) translate(${px}px, ${py}px) rotate(${turn}deg) scale(${scale})`;
    bit.animate(
      [
        { transform: at(0, 0, 0, 0.3), opacity: 1, easing: 'cubic-bezier(0.15, 0.8, 0.3, 1)' },
        { transform: at(dx, dy, spin * 0.6, 1), opacity: 1, offset: 0.45, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' },
        { transform: at(dx * 1.2, dy + fall, spin, 0.8), opacity: 0 },
      ],
      { duration, fill: 'forwards' },
    );
  }

  document.body.append(layer);
  setTimeout(() => layer.remove(), longest + 100);
}
