import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Minus, X } from 'lucide-react';
import { PillMark, Sheet, useNow } from '../components/ui';
import { DAY_LETTERS, addDays, dayOfWeek, formatClock, formatDate, formatTime, friendlyDate, partOfDay, today } from '../lib/dates';
import { buildHistory, phaseOf, unitLabel, type Cell, type CellStatus, type History as HistoryData, type MedHistory } from '../lib/logic';
import { useStore } from '../lib/store';

const RANGES = [7, 30, 90] as const;

const STATUS_LABEL: Record<CellStatus, string> = {
  taken: 'All taken',
  partial: 'Some taken',
  missed: 'Missed',
  skipped: 'Skipped',
  pending: 'Still to take',
  asNeeded: 'Taken as needed',
  none: 'Not scheduled',
};

const percent = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

function Glyph({ cell }: { cell: Cell }) {
  switch (cell.status) {
    case 'taken':
      return <Check size={16} strokeWidth={3.5} />;
    case 'missed':
      return <X size={16} strokeWidth={3.5} />;
    case 'skipped':
      return <Minus size={16} strokeWidth={3.5} />;
    case 'partial':
      return <span className="cell-count">{cell.taken}/{cell.expected}</span>;
    case 'asNeeded':
      return <span className="cell-count">{cell.extra.length}</span>;
    default:
      return null;
  }
}

/** Rolls every medicine's cell for a day into one "all doses" cell. */
function totalCells(history: HistoryData): Cell[] {
  return history.dates.map((date, i) => {
    const cells = history.rows.map((r) => r.cells[i]);
    const items = cells.flatMap((c) => c.items);
    const expected = cells.reduce((n, c) => n + c.expected, 0);
    const taken = cells.reduce((n, c) => n + c.taken, 0);
    const skipped = cells.reduce((n, c) => n + c.skipped, 0);
    let status: CellStatus = 'none';
    if (!items.length) status = 'none';
    else if (!expected) status = 'pending';
    else if (taken === expected) status = expected < items.length ? 'pending' : 'taken';
    else if (taken > 0) status = 'partial';
    else status = skipped === expected ? 'skipped' : 'missed';
    return { date, status, expected, taken, skipped, items, extra: [] };
  });
}

export function History() {
  const { state } = useStore();
  useNow();
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [picked, setPicked] = useState<{ title: string; cell: Cell } | null>(null);
  const t = today();
  const history = useMemo(() => buildHistory(state, addDays(t, -(range - 1)), t), [state, range, t]);
  const totals = useMemo(() => totalCells(history), [history]);
  const scroller = useRef<HTMLDivElement>(null);

  // Open on the most recent days.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [range, history.rows.length]);

  const byPart = useMemo(() => {
    const parts = new Map<string, { expected: number; taken: number }>();
    for (const row of history.rows) {
      for (const cell of row.cells) {
        for (const item of cell.items) {
          if (!item.dose && cell.date >= t) continue;
          const part = partOfDay(item.time);
          const entry = parts.get(part) ?? { expected: 0, taken: 0 };
          entry.expected += 1;
          if (item.dose?.status === 'taken') entry.taken += 1;
          parts.set(part, entry);
        }
      }
    }
    return ['Morning', 'Afternoon', 'Evening', 'Night'].filter((p) => parts.has(p)).map((p) => ({ part: p, ...parts.get(p)! }));
  }, [history, t]);

  const scheduledRows = history.rows.filter((r) => !r.med.asNeeded);
  const hasData = history.rows.length > 0;

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>History</h1>
          <p className="muted">
            {formatDate(history.dates[0], { month: 'short', day: 'numeric' })} – {formatDate(t, { month: 'short', day: 'numeric' })}
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

      {!hasData ? (
        <div className="empty">
          <h3>No history yet</h3>
          <p className="muted">Once you start taking doses from the pill organizer, each day’s record shows up here.</p>
        </div>
      ) : (
        <>
          <div className="tiles">
            <div className="tile hero">
              <span className="tile-label">Doses taken</span>
              <span className="tile-value">{percent(history.adherence)}</span>
              <span className="tile-sub">
                {history.taken} of {history.expected} scheduled
              </span>
            </div>
            <div className="tile">
              <span className="tile-label">Perfect days in a row</span>
              <span className="tile-value">{history.streak}</span>
              <span className="tile-sub">{history.streak === 1 ? 'day' : 'days'}, up to today</span>
            </div>
            <div className="tile">
              <span className="tile-label">Missed</span>
              <span className="tile-value">{history.missed}</span>
              <span className="tile-sub">{history.skipped ? `plus ${history.skipped} skipped on purpose` : 'none skipped on purpose'}</span>
            </div>
            <div className="tile">
              <span className="tile-label">Taken on time</span>
              <span className="tile-value">{percent(history.onTimeRate)}</span>
              <span className="tile-sub">within an hour of schedule</span>
            </div>
          </div>

          <section className="card">
            <h2 className="card-title">Day by day</h2>
            <p className="muted card-sub">Each square is one day. Tap a square to see that day’s doses.</p>
            <div className="grid-scroll" ref={scroller}>
              <table className="daygrid">
                <thead>
                  <tr>
                    <th className="rowhead" scope="col">
                      <span className="sr-only">Medicine</span>
                    </th>
                    {history.dates.map((date, i) => {
                      const day = Number(date.slice(8));
                      const showMonth = i === 0 || day === 1;
                      return (
                        <th key={date} scope="col" className={date === t ? 'is-today' : ''}>
                          <span className="col-month">{showMonth ? formatDate(date, { month: 'short' }) : ''}</span>
                          <span className="col-letter">{DAY_LETTERS[dayOfWeek(date)]}</span>
                          <span className="col-day">{day}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {scheduledRows.length > 1 && <GridRow label="All doses" cells={totals} today={t} onPick={(cell) => setPicked({ title: 'All doses', cell })} bold />}
                  {history.rows.map((row) => (
                    <GridRow
                      key={row.med.id}
                      label={row.med.name}
                      mark={<PillMark med={row.med} />}
                      cells={row.cells}
                      today={t}
                      onPick={(cell) => setPicked({ title: row.med.name, cell })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="legend" aria-label="Legend">
              {(['taken', 'partial', 'missed', 'skipped', 'pending'] as const).map((status) => (
                <li key={status}>
                  <span className={`cell ${status}`} aria-hidden="true">
                    <Glyph cell={{ date: '', status, expected: 2, taken: 1, skipped: 0, items: [], extra: [] }} />
                  </span>
                  {STATUS_LABEL[status]}
                </li>
              ))}
            </ul>
          </section>

          {scheduledRows.length > 0 && (
            <section className="card">
              <h2 className="card-title">By medicine</h2>
              <p className="muted card-sub">Share of scheduled doses taken.</p>
              <ul className="meters">
                {scheduledRows.map((row) => (
                  <Meter key={row.med.id} label={row.med.name} mark={<PillMark med={row.med} />} taken={row.taken} expected={row.expected} note={missNote(row)} />
                ))}
              </ul>
            </section>
          )}

          {byPart.length > 1 && (
            <section className="card">
              <h2 className="card-title">By time of day</h2>
              <p className="muted card-sub">Which doses are easiest to forget.</p>
              <ul className="meters">
                {byPart.map((p) => (
                  <Meter key={p.part} label={p.part} taken={p.taken} expected={p.expected} note={p.expected - p.taken ? `${p.expected - p.taken} not taken` : 'none missed'} />
                ))}
              </ul>
            </section>
          )}

          {history.rows.some((r) => r.asNeededCount > 0) && (
            <section className="card">
              <h2 className="card-title">As needed</h2>
              <ul className="plain-list">
                {history.rows
                  .filter((r) => r.asNeededCount > 0)
                  .map((r) => (
                    <li className="row" key={r.med.id}>
                      <span className="with-mark">
                        <PillMark med={r.med} /> {r.med.name}
                      </span>
                      <span>
                        {r.asNeededCount}× in {range} days
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}

      {picked && <DaySheet title={picked.title} cell={picked.cell} today={t} onClose={() => setPicked(null)} />}
    </div>
  );
}

function missNote(row: MedHistory): string {
  const parts = [];
  if (row.missed) parts.push(`${row.missed} missed`);
  if (row.skipped) parts.push(`${row.skipped} skipped`);
  return parts.length ? parts.join(' · ') : 'none missed';
}

function GridRow(props: { label: string; mark?: React.ReactNode; cells: Cell[]; today: string; onPick: (cell: Cell) => void; bold?: boolean }) {
  return (
    <tr className={props.bold ? 'total-row' : ''}>
      <th className="rowhead" scope="row">
        <span className="with-mark">
          {props.mark}
          <span className="rowhead-name">{props.label}</span>
        </span>
      </th>
      {props.cells.map((cell) => {
        const label = `${props.label}, ${formatDate(cell.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${STATUS_LABEL[cell.status]}${
          cell.expected > 1 ? ` (${cell.taken} of ${cell.expected})` : ''
        }`;
        return (
          <td key={cell.date} className={cell.date === props.today ? 'is-today' : ''}>
            {cell.status === 'none' ? (
              <span className="cell none" title={label} aria-label={label} />
            ) : (
              <button className={`cell ${cell.status}`} title={label} aria-label={label} onClick={() => props.onPick(cell)}>
                <Glyph cell={cell} />
              </button>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function Meter(props: { label: string; mark?: React.ReactNode; taken: number; expected: number; note: string }) {
  const share = props.expected ? props.taken / props.expected : 0;
  return (
    <li className="meter">
      <div className="meter-top">
        <span className="with-mark">
          {props.mark}
          <span className="meter-name">{props.label}</span>
        </span>
        <span className="meter-figure">{props.expected ? percent(share) : '—'}</span>
      </div>
      <div className="meter-track" role="img" aria-label={`${props.label}: ${props.taken} of ${props.expected} taken`}>
        <span style={{ width: `${share * 100}%` }} />
      </div>
      <div className="meter-note muted">
        {props.taken} of {props.expected} · {props.note}
      </div>
    </li>
  );
}

const PHASE_LABEL = { taken: 'Taken', skipped: 'Skipped', upcoming: 'Still to take', overdue: 'Overdue', missed: 'Missed' } as const;

function DaySheet({ title, cell, today: t, onClose }: { title: string; cell: Cell; today: string; onClose: () => void }) {
  return (
    <Sheet title={friendlyDate(cell.date)} subtitle={title} onClose={onClose}>
      <ul className="plain-list">
        {cell.items.map((item) => {
          const phase = phaseOf(item, t);
          return (
            <li className="row" key={item.doseId}>
              <span className="with-mark">
                <PillMark med={item.med} hollow={phase === 'taken' || phase === 'skipped'} />
                <span>
                  {item.med.name} <span className="muted">· {unitLabel(item.med, item.qty)}</span>
                  <br />
                  <span className="muted">Scheduled {formatTime(item.time)}</span>
                </span>
              </span>
              <span className={`status-text ${phase}`}>
                {PHASE_LABEL[phase]}
                {phase === 'taken' && item.dose?.takenAt && <span className="muted"> {formatClock(item.dose.takenAt)}</span>}
              </span>
            </li>
          );
        })}
        {cell.extra.map((dose) => (
          <li className="row" key={dose.id}>
            <span>As needed · {formatTime(dose.time)}</span>
            <span className="status-text taken">Taken</span>
          </li>
        ))}
      </ul>
      <p className="quiet-note">To change a dose, open that day in the pill organizer.</p>
    </Sheet>
  );
}
