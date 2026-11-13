import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNow } from '../components/ui';
import { addDays, dateRange, formatDate, friendlyDate, today } from '../lib/dates';
import { SCALE, activeQuestions, entryFor, journalTrends, type Question, type Trend } from '../lib/journal';
import { sounds } from '../lib/sounds';
import { dispatch, getSnapshot, useStore } from '../lib/store';
import type { JournalEntry } from '../lib/types';

const RANGES = [7, 30, 90] as const;

/** Saves a change to one day's entry, on top of whatever is stored for that day right now. */
function saveEntry(date: string, change: (entry: JournalEntry) => JournalEntry) {
  dispatch({ type: 'journal.put', entry: change(entryFor(getSnapshot().state, date)) });
}

export function Journal() {
  const { state } = useStore();
  useNow();
  const t = today();
  const [date, setDate] = useState(t);
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const questions = activeQuestions(state);
  const entry = entryFor(state, date);

  const dates = useMemo(() => dateRange(addDays(t, -(range - 1)), t), [t, range]);
  const trends = useMemo(() => journalTrends(state, dates), [state, dates]);
  const inRange = state.journal.filter((e) => e.date >= dates[0] && e.date <= t);
  const notes = inRange.filter((e) => e.note).reverse();

  const answer = (question: Question, value: number) => {
    if (entry.answers[question.id] !== value) sounds.tap();
    saveEntry(date, (e) => {
      const answers = { ...e.answers };
      // Tapping the chosen answer again clears it.
      if (answers[question.id] === value) delete answers[question.id];
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
          <div className="question" key={q.id} role="radiogroup" aria-label={q.text}>
            <span className="question-text">{q.text}</span>
            <div className="scale">
              {SCALE.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={entry.answers[q.id] === n}
                  aria-label={`${n} of 5${n === 1 ? `, ${q.low}` : n === 5 ? `, ${q.high}` : ''}`}
                  className={entry.answers[q.id] === n ? 'on' : ''}
                  onClick={() => answer(q, n)}
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
        <div className="segmented compact" role="radiogroup" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r} role="radio" aria-checked={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r} days
            </button>
          ))}
        </div>
      </header>

      {inRange.length === 0 ? (
        <div className="empty">
          <h3>Your charts start here</h3>
          <p className="muted">Answer the questions above and each one gets a chart of how it changes from day to day.</p>
        </div>
      ) : (
        <div className="trends">
          {trends.map((trend) => (
            <TrendCard key={trend.question.id} trend={trend} dates={dates} onPick={setDate} />
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
      <span className="field-hint" role="status">
        {dirty ? 'Saving…' : saved ? 'Saved' : 'Saves as you type.'}
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

function TrendCard({ trend, dates, onPick }: { trend: Trend; dates: string[]; onPick: (date: string) => void }) {
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
          {average == null ? '—' : average.toFixed(1)}
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
            aria-label={`${question.text} Answered on ${answered} of ${dates.length} days, average ${average!.toFixed(1)} out of 5.`}
            onPointerMove={(e) => setHover(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
            onPointerDown={(e) => setHover(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
            onPointerLeave={() => setHover(null)}
            onClick={() => hover != null && values[hover] != null && onPick(dates[hover])}
          >
            {SCALE.map((n) => (
              <g key={n}>
                <line className="trend-grid" x1={LEFT} x2={W - RIGHT} y1={y(n)} y2={y(n)} />
                <text className="trend-axis" x={LEFT - 8} y={y(n) + 3.5} textAnchor="end">
                  {n}
                </text>
              </g>
            ))}
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
            {shown == null ? '' : values[shown] == null ? `${day(shown)} · not answered` : `${day(shown)} · ${values[shown]} of 5`}
            <span className="muted">
              {' '}
              (1 {question.low.toLowerCase()}, 5 {question.high.toLowerCase()})
            </span>
          </p>
        </>
      )}
    </section>
  );
}
