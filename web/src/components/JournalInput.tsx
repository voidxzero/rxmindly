// Answering a journal question: numbered buttons for a short scale, a stepped
// slider for a long one, or a plain slider with no numbers at all. Used by the
// Journal and by the preview in Settings.

import { useEffect, useRef, useState } from 'react';
import { haptics } from '../lib/haptics';
import { fromScale, toScale, type Question } from '../lib/journal';

/** The middle of the stored 1–5 range, where the smooth slider catches (a little either side). */
const CENTER = 3;
const CENTER_CATCH = 0.02;

interface Props {
  question: Question;
  /** The stored answer (1–5), or null when not answered. */
  value: number | null;
  /** Top of the scale shown, e.g. 10 for 1–10. */
  max: number;
  /** A plain slider with no numbers. */
  slider: boolean;
  /** A finished day: shown, but not changeable until Edit is tapped. */
  locked?: boolean;
  /** Sliders never snap: the thumb stays where it is let go, and the whole number is saved in the background. The Journal page and the preview in Settings. */
  smooth?: boolean;
  /** Gets the answer as stored (1–5), or null when a chosen number is tapped again. */
  onAnswer: (value: number | null) => void;
}

export function QuestionInput(props: Props) {
  const { question: q, value, max, locked = false } = props;
  if (!props.slider && max <= 10) {
    const chosen = value == null ? null : Math.round(toScale(value, max));
    return (
      <div className={`question${locked ? ' locked' : ''}`} role="radiogroup" aria-label={q.text}>
        <span className="question-text">{q.text}</span>
        <div className={`scale${max > 5 ? ' many' : ''}`} style={{ gridTemplateColumns: `repeat(${max}, 1fr)` }}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={chosen === n}
              aria-label={`${n} of ${max}${n === 1 ? `, ${q.low}` : n === max ? `, ${q.high}` : ''}`}
              className={chosen === n ? 'on' : ''}
              disabled={locked}
              // Tapping the chosen answer again clears it.
              onClick={() => props.onAnswer(chosen === n ? null : fromScale(n, max))}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="scale-ends">
          <span>{q.low}</span>
          {locked && chosen == null && <span>Not answered</span>}
          <span>{q.high}</span>
        </div>
      </div>
    );
  }
  return <SliderInput {...props} locked={locked} numbered={!props.slider} />;
}

/**
 * What is saved is always a whole number on the chosen scale, so answers given
 * with the slider and with numbered buttons are the same kind of answer, and
 * switching between the two styles shows each one exactly.
 *
 * Normally the slider settles on the nearest whole number when let go. With
 * `smooth` (the Journal page and the Settings preview) it has no steps and never snaps: the thumb stays
 * exactly where it is let go (except for a light catch, with a click, at the
 * center) and the nearest whole number is saved in the background. (After a reload the thumb sits on that whole number.)
 */
function SliderInput({ question: q, value, max, numbered, locked, smooth = false, onAnswer }: Props & { numbered: boolean; locked: boolean }) {
  const snap = (stored: number) => fromScale(Math.round(toScale(stored, max)), max);
  // Held here while sliding and saved once it settles, so one drag is one save.
  const [pos, setPos] = useState(value ?? 3);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<number | null>(null);
  const dragging = useRef(false);
  useEffect(() => {
    if (pending.current == null && value != null) {
      // Smooth: only follows a change that didn't come from here, so saving never nudges the thumb.
      if (!smooth || Math.abs(snap(pos) - value) > 1e-6) setPos(value);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    clearTimeout(timer.current);
    if (pending.current == null) return;
    const settled = snap(pending.current);
    pending.current = null;
    if (!smooth) setPos(settled);
    onAnswer(settled);
  };
  useEffect(() => () => commit(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (raw: number) => {
    // The smooth slider still catches at the center, with a firmer click, then lets go again past it.
    const stored = smooth && Math.abs(raw - CENTER) < CENTER_CATCH ? CENTER : raw;
    if (smooth && stored === CENTER && pos !== CENTER) haptics.answer(0.5);
    // A soft tick at each whole number the thumb passes, firmer toward the top.
    const n = Math.round(toScale(stored, max));
    if (n !== Math.round(toScale(pos, max))) haptics.detent((n - 1) / Math.max(1, max - 1));
    setPos(stored);
    pending.current = stored;
    clearTimeout(timer.current);
    // While a finger is still on it, wait for it to let go before settling.
    if (!dragging.current) timer.current = setTimeout(commit, 400);
  };
  /** Arrow keys step one whole number on the scale, since the slider itself moves in tiny steps. */
  const stepBy = (delta: number) => move(fromScale(Math.min(max, Math.max(1, Math.round(toScale(pos, max)) + delta)), max));
  const answered = value != null || pending.current != null;
  const shownNumber = Math.round(toScale(pos, max));

  return (
    <div className={`question${locked ? ' locked' : ''}`}>
      <div className="question-top">
        <span className="question-text" id={`q-${q.id}`}>
          {q.text}
        </span>
        {numbered && answered && <span className="slider-number">{shownNumber}</span>}
      </div>
      <input
        type="range"
        className={`answer-slider${answered ? '' : ' unset'}`}
        aria-labelledby={`q-${q.id}`}
        aria-valuetext={answered ? (numbered ? `${shownNumber} of ${max}` : `${Math.round(((pos - 1) / 4) * 100)}% of the way to ${q.high}`) : 'Not answered'}
        min={1}
        max={smooth || !numbered ? 5 : max}
        step={smooth ? 'any' : numbered ? 1 : 0.01}
        value={numbered && !smooth ? shownNumber : pos}
        disabled={locked}
        onChange={(e) => move(numbered && !smooth ? fromScale(Number(e.target.value), max) : Number(e.target.value))}
        onPointerDown={() => {
          dragging.current = true;
        }}
        // A tap right on the unanswered thumb doesn't move it, but still counts as an answer.
        onPointerUp={() => {
          dragging.current = false;
          if (locked) return;
          if (!answered) move(pos);
          commit();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (numbered && !smooth) return;
          const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
          if (!delta) return;
          e.preventDefault();
          stepBy(delta);
        }}
        onKeyUp={commit}
      />
      <div className="scale-ends">
        <span>{q.low}</span>
        {!answered && <span>{locked ? 'Not answered' : 'Slide to answer'}</span>}
        <span>{q.high}</span>
      </div>
    </div>
  );
}
