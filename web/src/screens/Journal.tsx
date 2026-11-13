import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { QuestionInput } from '../components/JournalInput';
import { useNow } from '../components/ui';
import { addDays, dateRange, formatDate, friendlyDate, today } from '../lib/dates';
import { activeQuestions, entryFor, formatScaled, fromScale, journalTrends, scaleTicks, type Question, type Trend } from '../lib/journal';
import { sounds } from '../lib/sounds';
import { dispatch, getSnapshot, useStore } from '../lib/store';
import { cssColor, type JournalEntry } from '../lib/types';

const RANGES = [7, 30, 90] as const;
// Colors for the questions on the chart, picked to sit well apart.
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
  // A finished day's answers are locked against stray taps until Edit is pressed.
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const past = date < t;
  const locked = past && editingDay !== date;
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
        <div className="card-head">
          <h2 className="card-title">{date === t ? 'How are you today?' : 'How was this day?'}</h2>
          {past &&
            (locked ? (
              <button className="btn small" onClick={() => setEditingDay(date)}>
                <Pencil size={16} /> Edit
              </button>
            ) : (
              <button className="btn small" onClick={() => setEditingDay(null)}>
                <Check size={16} /> Done
              </button>
            ))}
        </div>
        {questions.length === 0 && <p className="muted">All the questions are switched off. You can turn them back on, or add your own, in Settings.</p>}
        {questions.map((q) => (
          <QuestionInput
            key={`${date}:${q.id}`}
            question={q}
            value={entry.answers[q.id] ?? null}
            max={max}
            slider={settings.journalScaleKind === 'slider'}
            locked={locked}
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
          <h3>Your chart starts here</h3>
          <p className="muted">Answer the questions above and you’ll see how each one changes from day to day.</p>
        </div>
      ) : (
        <JournalChart key={range} trends={trends} dates={dates} max={max} onPick={setDate} />
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

/**
 * The day's free-text note. Saves by itself shortly after you stop typing, and
 * when you leave the box. Once written and saved it is locked, so a stray tap
 * can't change it; Edit opens it again.
 */
function NoteBox({ date, saved }: { date: string; saved: string }) {
  const [editing, setEditing] = useState(!saved);
  const [text, setText] = useState(saved);
  const latest = useRef(text);
  latest.current = text;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const box = useRef<HTMLTextAreaElement>(null);
  const focusNext = useRef(false);
  const dirty = editing && text.trim() !== saved;

  const save = () => {
    clearTimeout(timer.current);
    const note = latest.current.trim();
    if (note !== entryFor(getSnapshot().state, date).note) saveEntry(date, (e) => ({ ...e, note }));
  };
  // Don't lose the last few words when moving to another day or screen.
  useEffect(() => save, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (editing && focusNext.current) {
      focusNext.current = false;
      const el = box.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const finish = () => {
    save();
    if (latest.current.trim()) setEditing(false);
  };

  if (!editing) {
    return (
      <>
        <p className="note-locked">{saved}</p>
        <div className="note-foot">
          <span className="save-state saved" role="status">
            <Check size={14} strokeWidth={3} /> Saved
          </span>
          <button
            className="btn small"
            onClick={() => {
              setText(saved);
              focusNext.current = true;
              setEditing(true);
            }}
          >
            <Pencil size={16} /> Edit
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <textarea
        ref={box}
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
        onBlur={finish}
      />
      <div className="note-foot">
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
        {text.trim() && (
          <button className="btn small" onClick={finish}>
            <Check size={16} /> Done
          </button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// One chart with every question, each in its own color. Tapping a question in
// the legend shows it alone; pinching (or ctrl + scroll) zooms into the days.

const LEFT = 22;
const RIGHT = 10;
const TOP = 10;
const BOTTOM = 22;

interface View {
  from: number;
  to: number;
}

function JournalChart({ trends, dates, max, onPick }: { trends: Trend[]; dates: string[]; max: number; onPick: (date: string) => void }) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [solo, setSolo] = useState<string | null>(null);
  const last = dates.length - 1;
  const [view, setView] = useState<View>({ from: 0, to: last });
  const zoomed = view.from > 0 || view.to < last;

  // Drawn at the card's real width, so text and lines stay their normal size on a wide screen.
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(340);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setW(Math.max(260, Math.round(el.clientWidth))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const H = W > 600 ? 240 : 190;
  const plotW = W - LEFT - RIGHT;
  const span = view.to - view.from;
  const x = (i: number) => LEFT + ((i - view.from) / span) * plotW;

  const all = trends.map((trend, k) => ({ trend, color: cssColor(SERIES_COLORS[k % SERIES_COLORS.length]) }));
  const shown = solo ? all.filter((s) => s.trend.question.id === solo) : all;
  // Answers often land on the same value, so lines would sit exactly on top of
  // each other; each one is nudged a hair up or down so they all stay visible.
  const nudge = (k: number) => (shown.length > 1 ? (k - (shown.length - 1) / 2) * 1.8 : 0);
  const y = (v: number, k = (shown.length - 1) / 2) => TOP + ((5 - v) / 4) * (H - TOP - BOTTOM) + nudge(k);
  const visibleDays = span + 1;
  const radius = visibleDays > 45 ? 2 : visibleDays > 14 ? 3 : 4;

  /** Where across the plot a point on screen is, 0 (left) to 1 (right). */
  const fracAt = (clientX: number) => {
    const box = svg.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (((clientX - box.left) / box.width) * W - LEFT) / plotW));
  };
  const indexAt = (clientX: number) => Math.round(view.from + fracAt(clientX) * span);

  /** Zooms so the day under `frac` stays where it is, to show `nextSpan` days' worth. */
  const zoomTo = (base: View, frac: number, nextSpan: number, atFrac = frac) => {
    const minSpan = Math.min(last, 6);
    const s = Math.max(minSpan, Math.min(last, nextSpan));
    const anchor = base.from + frac * (base.to - base.from);
    const from = Math.max(0, Math.min(last - s, anchor - atFrac * s));
    setView({ from, to: from + s });
  };

  // Two fingers on the chart: pinch to zoom, and move them together to pan.
  const pointers = useRef(new Map<number, number>());
  const pinch = useRef<{ dist: number; mid: number; view: View } | null>(null);
  const pinched = useRef(false);
  const twoFinger = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.max(10, Math.abs(a - b)), mid: fracAt((a + b) / 2) };
  };

  // Trackpad pinches arrive as ctrl + wheel; that needs a listener that may cancel the page zoom.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const v = viewRef.current;
      zoomTo(v, fracAt(e.clientX), (v.to - v.from) * Math.exp(e.deltaY * 0.01));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const day = (i: number) => formatDate(dates[i], { weekday: 'short', month: 'short', day: 'numeric' });
  const firstShown = Math.ceil(view.from - 1e-6);
  const lastShown = Math.floor(view.to + 1e-6);
  const soloQuestion = solo ? all.find((s) => s.trend.question.id === solo)?.trend.question : null;

  return (
    <section className="card trend">
      <div className="trend-head">
        <h3>{soloQuestion ? soloQuestion.text : 'All questions'}</h3>
        <span className="muted">{hover == null ? 'Averages' : day(hover)}</span>
      </div>
      <div ref={wrap}>
        <svg
          ref={svg}
          className="trend-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Journal answers from 1 to ${max}. ${shown.map(({ trend }) => `${trend.question.text} average ${trend.average == null ? 'none' : formatScaled(trend.average, max)}`).join('. ')}.`}
          onPointerDown={(e) => {
            if (pointers.current.size === 0) pinched.current = false;
            pointers.current.set(e.pointerId, e.clientX);
            if (pointers.current.size === 2) {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Not every pointer can be captured; the pinch still works without it.
              }
              pinch.current = { ...twoFinger(), view };
              pinched.current = true;
              setHover(null);
            } else if (pointers.current.size === 1) {
              setHover(indexAt(e.clientX));
            }
          }}
          onPointerMove={(e) => {
            if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, e.clientX);
            const p = pinch.current;
            if (p && pointers.current.size >= 2) {
              const now = twoFinger();
              zoomTo(p.view, p.mid, (p.view.to - p.view.from) * (p.dist / now.dist), now.mid);
            } else if (!pinched.current) {
              setHover(indexAt(e.clientX));
            }
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId);
            if (pointers.current.size < 2) pinch.current = null;
          }}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            if (pointers.current.size < 2) pinch.current = null;
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setHover(null);
          }}
          onClick={() => {
            if (!pinched.current && hover != null && shown.some(({ trend }) => trend.values[hover] != null)) onPick(dates[hover]);
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={LEFT - 6} y={0} width={plotW + 12} height={H} />
            </clipPath>
          </defs>
          <Axis max={max} y={(v) => y(v)} left={LEFT} right={W - RIGHT} />
          <text className="trend-axis" x={LEFT} y={H - 5}>
            {formatDate(dates[firstShown], { month: 'short', day: 'numeric' })}
          </text>
          <text className="trend-axis" x={W - RIGHT} y={H - 5} textAnchor="end">
            {lastShown >= last ? 'Today' : formatDate(dates[lastShown], { month: 'short', day: 'numeric' })}
          </text>
          {hover != null && <line className="trend-cross" x1={x(hover)} x2={x(hover)} y1={TOP - 4} y2={H - BOTTOM + 4} />}
          <g clipPath={`url(#${clipId})`}>
            {shown.map(({ trend, color }, k) => {
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
          </g>
        </svg>
      </div>
      <ul className="overlap-legend">
        {all.map(({ trend, color }) => {
          const value = hover == null ? trend.average : trend.values[hover];
          const on = !solo || solo === trend.question.id;
          return (
            <li key={trend.question.id}>
              <button
                type="button"
                className={`legend-item${on ? '' : ' off'}`}
                aria-pressed={solo === trend.question.id}
                onClick={() => setSolo(solo === trend.question.id ? null : trend.question.id)}
              >
                <span className="overlap-swatch" style={{ background: color }} aria-hidden="true" />
                <span className="overlap-name">{trend.question.text}</span>
                <span className="overlap-value">{value == null ? '—' : formatScaled(value, max)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="chart-foot">
        <span className="field-hint">
          {soloQuestion ? `1 ${soloQuestion.low.toLowerCase()}, ${max} ${soloQuestion.high.toLowerCase()}. Tap it again to see them all.` : 'Tap a question to see it alone. Pinch the chart to zoom.'}
        </span>
        {zoomed && (
          <button className="link-btn" onClick={() => setView({ from: 0, to: last })}>
            Show all days
          </button>
        )}
      </div>
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
