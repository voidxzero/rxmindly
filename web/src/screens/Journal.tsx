import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { useNow } from '../components/ui';
import { addDays, dateRange, formatDate, friendlyDate, today } from '../lib/dates';
import { activeQuestions, entryFor, formatScaled, fromScale, journalTrends, scaleTicks, toScale, type Question, type Trend } from '../lib/journal';
import { sounds } from '../lib/sounds';
import { dispatch, getSnapshot, useStore } from '../lib/store';
import { cssColor, type JournalEntry } from '../lib/types';

const RANGES = [7, 30, 90] as const;
const OVERLAP_KEY = 'rxmindly.journalOverlap';
// Colors for the questions on the combined chart, picked to sit well apart.
const SERIES_COLORS = ['blue', 'orange', 'aqua', 'magenta', 'violet', 'yellow', 'red', 'teal', 'lime', 'brown', 'indigo', 'gray'];

/** Saves a change to one day's entry, on top of whatever is stored for that day right now. */
function saveEntry(date: string, change: (entry: JournalEntry) => JournalEntry) {
  dispatch({ type: 'journal.put', entry: change(entryFor(getSnapshot().state, date)) });
}

export function Journal() {
  const { state, settings } = useStore();
  const max = settings.journalScale;
  useNow();
  const t = today();
  const [date, setDate] = useState(t);
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [overlap, setOverlapState] = useState(() => {
    try {
      return localStorage.getItem(OVERLAP_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setOverlap = (on: boolean) => {
    setOverlapState(on);
    try {
      localStorage.setItem(OVERLAP_KEY, on ? '1' : '0');
    } catch {
      // Remembering the choice is only a convenience.
    }
  };
  const questions = activeQuestions(state);
  const entry = entryFor(state, date);

  const dates = useMemo(() => dateRange(addDays(t, -(range - 1)), t), [t, range]);
  const trends = useMemo(() => journalTrends(state, dates), [state, dates]);
  const inRange = state.journal.filter((e) => e.date >= dates[0] && e.date <= t);
  const notes = inRange.filter((e) => e.note).reverse();

  /** Saves one answer (stored on 1–5), or clears it with null. */
  const answer = (question: Question, value: number | null) => {
    if (value != null) sounds.tap();
    saveEntry(date, (e) => {
      const answers = { ...e.answers };
      if (value == null) delete answers[question.id];
      else answers[question.id] = value;
      return { ...e, answers };
    });
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>Journal</h1>
          <p className="muted">{friendlyDate(date)}</p>
        </div>
        <div className="week-nav">
          {date !== t && (
            <button className="btn small" onClick={() => setDate(t)}>
              Today
            </button>
          )}
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
            <ChevronLeft size={22} />
          </button>
          <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} disabled={date >= t} aria-label="Next day">
            <ChevronRight size={22} />
          </button>
        </div>
      </header>

      <section className="card">
        <h2 className="card-title">{date === t ? 'How are you today?' : 'How was this day?'}</h2>
        {questions.length === 0 && <p className="muted">All the questions are switched off. You can turn them back on, or add your own, in Settings.</p>}
        {questions.map((q) => (
          <QuestionInput
            key={`${date}:${q.id}`}
            question={q}
            value={entry.answers[q.id] ?? null}
            max={max}
            slider={settings.journalScaleKind === 'slider'}
            onAnswer={(v) => answer(q, v)}
          />
        ))}
      </section>

      <section className="card">
        <h2 className="card-title">Notes</h2>
        <NoteBox key={date} date={date} saved={entry.note} />
      </section>

      <header className="screen-head">
        <div>
          <h2>How you’ve been</h2>
          <p className="muted">
            {inRange.length === 0 ? 'Nothing written in this stretch yet' : `${inRange.length} ${inRange.length === 1 ? 'day' : 'days'} written in the last ${range}`}
          </p>
        </div>
        <div className="chart-controls">
          <div className="segmented compact" role="radiogroup" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r} role="radio" aria-checked={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
                {r} days
              </button>
            ))}
          </div>
          <div className="segmented compact">
            <button aria-pressed={overlap} className={overlap ? 'on' : ''} onClick={() => setOverlap(!overlap)} title="Show every question on one chart">
              <Layers size={16} /> Overlap
            </button>
          </div>
        </div>
      </header>

      {inRange.length === 0 ? (
        <div className="empty">
          <h3>Your charts start here</h3>
          <p className="muted">Answer the questions above and each one gets a chart of how it changes from day to day.</p>
        </div>
      ) : overlap ? (
        <OverlapCard trends={trends} dates={dates} max={max} onPick={setDate} />
      ) : (
        <div className="trends">
          {trends.map((trend) => (
            <TrendCard key={trend.question.id} trend={trend} dates={dates} max={max} onPick={setDate} />
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <section className="card">
          <h2 className="card-title">Recent notes</h2>
          <ul className="plain-list">
            {notes.slice(0, 20).map((e) => (
              <li key={e.date}>
                <button
                  className="row-btn note-row"
                  onClick={() => {
                    setDate(e.date);
                    window.scrollTo({ top: 0 });
                  }}
                >
                  <span className="muted">{formatDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span className="note-text">{e.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The day's free-text note. Saves by itself shortly after you stop typing, and when you leave the box. */
function NoteBox({ date, saved }: { date: string; saved: string }) {
  const [text, setText] = useState(saved);
  const latest = useRef(text);
  latest.current = text;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = text.trim() !== saved;

  const save = () => {
    clearTimeout(timer.current);
    const note = latest.current.trim();
    if (note !== entryFor(getSnapshot().state, date).note) saveEntry(date, (e) => ({ ...e, note }));
  };
  // Don't lose the last few words when moving to another day or screen.
  useEffect(() => save, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <textarea
        className="input note-box"
        value={text}
        rows={4}
        maxLength={5000}
        placeholder="Anything worth remembering about the day: how you felt, side effects, what helped…"
        aria-label="Notes for this day"
        onChange={(e) => {
          setText(e.target.value);
          clearTimeout(timer.current);
          timer.current = setTimeout(save, 1200);
        }}
        onBlur={save}
      />
      <span role="status">
        {dirty ? (
          <span className="save-state">Saving…</span>
        ) : saved ? (
          <span className="save-state saved">
            <Check size={14} strokeWidth={3} /> Saved
          </span>
        ) : (
          <span className="field-hint">Saves as you type.</span>
        )}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// One small line chart per question: the answer (1–5) for each day in the range.

const W = 340;
const H = 132;
const LEFT = 22;
const RIGHT = 10;
const TOP = 10;
const BOTTOM = 22;

function TrendCard({ trend, dates, max, onPick }: { trend: Trend; dates: string[]; max: number; onPick: (date: string) => void }) {
  const { question, values, average, answered } = trend;
  const lastAnswered = values.reduce<number>((found, v, i) => (v != null ? i : found), -1);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? (lastAnswered >= 0 ? lastAnswered : null);

  const step = (W - LEFT - RIGHT) / Math.max(1, dates.length - 1);
  const x = (i: number) => LEFT + i * step;
  const y = (v: number) => TOP + ((5 - v) / 4) * (H - TOP - BOTTOM);
  const radius = dates.length > 45 ? 2.5 : 4;

  // Days next to each other are joined; a gap in answers is left as a gap in the line.
  let path = '';
  values.forEach((v, i) => {
    if (v == null) return;
    path += `${i > 0 && values[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
  });

  const indexAt = (clientX: number, box: DOMRect) => {
    const px = ((clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(dates.length - 1, Math.round((px - LEFT) / step)));
  };
  const day = (i: number) => formatDate(dates[i], { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <section className="card trend">
      <div className="trend-head">
        <h3>{question.text}</h3>
        <span className="trend-average">
          {average == null ? '—' : formatScaled(average, max)}
          <span className="muted"> avg</span>
        </span>
      </div>
      {answered === 0 ? (
        <p className="muted">Not answered in this stretch.</p>
      ) : (
        <>
          <svg
            className="trend-chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${question.text} Answered on ${answered} of ${dates.length} days, average ${formatScaled(average!, max)} out of ${max}.`}
            onPointerMove={(e) => setHover(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
            onPointerDown={(e) => setHover(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
            onPointerLeave={() => setHover(null)}
            onClick={() => hover != null && values[hover] != null && onPick(dates[hover])}
          >
            <Axis max={max} y={y} left={LEFT} right={W - RIGHT} />
            <text className="trend-axis" x={LEFT} y={H - 5}>
              {formatDate(dates[0], { month: 'short', day: 'numeric' })}
            </text>
            <text className="trend-axis" x={W - RIGHT} y={H - 5} textAnchor="end">
              Today
            </text>
            {hover != null && <line className="trend-cross" x1={x(hover)} x2={x(hover)} y1={TOP - 4} y2={H - BOTTOM + 4} />}
            <path className="trend-line" d={path} />
            {values.map((v, i) => v != null && <circle key={i} className={`trend-dot${i === shown ? ' on' : ''}`} cx={x(i)} cy={y(v)} r={i === shown ? radius + 1.5 : radius} />)}
          </svg>
          <p className="trend-caption" aria-live="off">
            {shown == null ? '' : values[shown] == null ? `${day(shown)} · not answered` : `${day(shown)} · ${formatScaled(values[shown]!, max)} of ${max}`}
            <span className="muted">
              {' '}
              (1 {question.low.toLowerCase()}, {max} {question.high.toLowerCase()})
            </span>
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Every question on one chart, each in its own color, with a legend that also
// shows the values for the day under your finger.


function OverlapCard({ trends, dates, max, onPick }: { trends: Trend[]; dates: string[]; max: number; onPick: (date: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the card's real width, so text and lines stay their normal size on a wide screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(340);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setW(Math.max(260, Math.round(el.clientWidth))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const series = trends.map((trend, k) => ({ trend, color: cssColor(SERIES_COLORS[k % SERIES_COLORS.length]) }));
  const OH = W > 600 ? 240 : 180;
  const step = (W - LEFT - RIGHT) / Math.max(1, dates.length - 1);
  const x = (i: number) => LEFT + i * step;
  // Answers are whole numbers, so lines would sit exactly on top of each other;
  // each one is nudged a hair up or down so they all stay visible.
  const nudge = (k: number) => (k - (series.length - 1) / 2) * 1.8;
  const y = (v: number, k: number) => TOP + ((5 - v) / 4) * (OH - TOP - BOTTOM) + nudge(k);
  const radius = dates.length > 45 ? 2 : 3;
  const indexAt = (clientX: number, box: DOMRect) => {
    const px = ((clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(dates.length - 1, Math.round((px - LEFT) / step)));
  };
  const answeredOn = (i: number) => series.some(({ trend }) => trend.values[i] != null);

  return (
    <section className="card trend">
      <div className="trend-head">
        <h3>All questions</h3>
        <span className="muted">{hover == null ? 'Averages' : formatDate(dates[hover], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </div>
      <div ref={box}>
        <svg
          className="trend-chart"
          viewBox={`0 0 ${W} ${OH}`}
          role="img"
          aria-label={`All questions on one chart, from 1 to ${max}. ${series.map(({ trend }) => `${trend.question.text} average ${trend.average == null ? 'none' : formatScaled(trend.average, max)}`).join('. ')}.`}
          onPointerMove={(e) => setHover(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerDown={(e) => setHover(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setHover(null)}
          onClick={() => hover != null && answeredOn(hover) && onPick(dates[hover])}
        >
          <Axis max={max} y={(v) => y(v, (series.length - 1) / 2)} left={LEFT} right={W - RIGHT} />
          <text className="trend-axis" x={LEFT} y={OH - 5}>
            {formatDate(dates[0], { month: 'short', day: 'numeric' })}
          </text>
          <text className="trend-axis" x={W - RIGHT} y={OH - 5} textAnchor="end">
            Today
          </text>
          {hover != null && <line className="trend-cross" x1={x(hover)} x2={x(hover)} y1={TOP - 4} y2={OH - BOTTOM + 4} />}
          {series.map(({ trend, color }, k) => {
            let path = '';
            trend.values.forEach((v, i) => {
              if (v == null) return;
              path += `${i > 0 && trend.values[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v, k).toFixed(1)}`;
            });
            return (
              <g key={trend.question.id} style={{ color }}>
                <path className="overlap-line" d={path} />
                {trend.values.map((v, i) => v != null && <circle key={i} className="overlap-dot" cx={x(i)} cy={y(v, k)} r={i === hover ? radius + 1.5 : radius} />)}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="overlap-legend">
        {series.map(({ trend, color }) => {
          const value = hover == null ? trend.average : trend.values[hover];
          return (
            <li key={trend.question.id}>
              <span className="overlap-swatch" style={{ background: color }} aria-hidden="true" />
              <span className="overlap-name">{trend.question.text}</span>
              <span className="overlap-value">{value == null ? '—' : formatScaled(value, max)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Grid lines and numbers up the side of a chart, on the chosen scale. `y` takes a stored (1–5) value. */
function Axis({ max, y, left, right }: { max: number; y: (stored: number) => number; left: number; right: number }) {
  const ticks = scaleTicks(max);
  return (
    <>
      {/* The bottom of the scale; only labelled when it is one of the ticks. */}
      {ticks[0] !== 1 && <line className="trend-grid" x1={left} x2={right} y1={y(1)} y2={y(1)} />}
      {ticks.map((n) => (
        <g key={n}>
          <line className="trend-grid" x1={left} x2={right} y1={y(fromScale(n, max))} y2={y(fromScale(n, max))} />
          <text className="trend-axis" x={left - 8} y={y(fromScale(n, max)) + 3.5} textAnchor="end">
            {n}
          </text>
        </g>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Answering a question: numbered buttons for a short scale, a stepped slider
// for a long one, or a plain slider with no numbers at all.

function QuestionInput(props: { question: Question; value: number | null; max: number; slider: boolean; onAnswer: (value: number | null) => void }) {
  const { question: q, value, max } = props;
  if (!props.slider && max <= 10) {
    const chosen = value == null ? null : Math.round(toScale(value, max));
    return (
      <div className="question" role="radiogroup" aria-label={q.text}>
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
              // Tapping the chosen answer again clears it.
              onClick={() => props.onAnswer(chosen === n ? null : fromScale(n, max))}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="scale-ends">
          <span>{q.low}</span>
          <span>{q.high}</span>
        </div>
      </div>
    );
  }
  return <SliderInput {...props} numbered={!props.slider} />;
}

function SliderInput({ question: q, value, max, numbered, onAnswer }: { question: Question; value: number | null; max: number; numbered: boolean; onAnswer: (value: number | null) => void }) {
  // Held here while sliding and saved a moment after it stops, so one drag is one save.
  const [pos, setPos] = useState(value ?? 3);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<number | null>(null);
  useEffect(() => {
    if (pending.current == null && value != null) setPos(value);
  }, [value]);
  const commit = () => {
    clearTimeout(timer.current);
    if (pending.current != null) onAnswer(pending.current);
    pending.current = null;
  };
  useEffect(() => () => commit(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (stored: number) => {
    setPos(stored);
    pending.current = stored;
    clearTimeout(timer.current);
    timer.current = setTimeout(commit, 400);
  };
  const answered = value != null || pending.current != null;
  const shownNumber = Math.round(toScale(pos, max));

  return (
    <div className="question">
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
        min={numbered ? 1 : 1}
        max={numbered ? max : 5}
        step={numbered ? 1 : 0.01}
        value={numbered ? shownNumber : pos}
        onChange={(e) => move(numbered ? fromScale(Number(e.target.value), max) : Number(e.target.value))}
        // A tap right on the unanswered thumb doesn't move it, but still counts as an answer.
        onPointerUp={() => {
          if (!answered) move(pos);
          commit();
        }}
        onKeyUp={commit}
      />
      <div className="scale-ends">
        <span>{q.low}</span>
        {answered ? (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              clearTimeout(timer.current);
              pending.current = null;
              setPos(3);
              onAnswer(null);
            }}
          >
            Clear
          </button>
        ) : (
          <span>Slide to answer</span>
        )}
        <span>{q.high}</span>
      </div>
    </div>
  );
}
