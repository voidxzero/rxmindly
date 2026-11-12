import { useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Clock, Plus, SkipForward, TriangleAlert, Undo2 } from 'lucide-react';
import { PillMark, Sheet, useNow } from '../components/ui';
import { celebrate } from '../lib/celebrate';
import { DAY_LETTERS, addDays, dateTimeOf, dayOfWeek, formatClock, formatDate, formatDuration, formatTime, friendlyDate, nowTime, partOfDay, timeOf, toDateStr, today, weekStart } from '../lib/dates';
import { dueOn, groupByTime, indexDoses, phaseOf, supplyOf, uid, unitLabel, type DoseIndex, type DueItem } from '../lib/logic';
import { dispatch, getSnapshot, useStore } from '../lib/store';
import type { AppState, Dose, Med } from '../lib/types';

const doseFor = (item: DueItem, status: Dose['status']): Dose => ({
  id: item.doseId,
  medId: item.med.id,
  scheduleId: item.schedule.id,
  date: item.date,
  time: item.time,
  status,
  qty: item.qty,
  takenAt: status === 'taken' ? new Date().toISOString() : null,
});

// Doses marked taken a moment ago, so their rows can play the little "taken" animation once.
const fresh = new Set<string>();
function markFresh(ids: string[]) {
  ids.forEach((id) => fresh.add(id));
  setTimeout(() => ids.forEach((id) => fresh.delete(id)), 900);
}

/** Marks doses taken (now, or at an earlier time) and celebrates from the button that was pressed. */
function take(origin: Element | null, items: DueItem[], takenAt = new Date()) {
  if (!items.length) return;
  markFresh(items.map((i) => i.doseId));
  dispatch(...items.map((i) => ({ type: 'dose.put' as const, dose: { ...doseFor(i, 'taken'), takenAt: takenAt.toISOString() } })));
  const { state } = getSnapshot();
  const dayDone = dueOn(state, items[0].date, indexDoses(state)).every((i) => i.dose?.status === 'taken');
  celebrate(origin, dayDone);
}
const skip = (item: DueItem) => dispatch({ type: 'dose.put', dose: doseFor(item, 'skipped') });
const undo = (doseId: string) => dispatch({ type: 'dose.delete', id: doseId });

export function Organizer(props: { date: string; onDate: (date: string) => void; onOpenCabinet: (addNew?: boolean) => void }) {
  const { state } = useStore();
  useNow();
  const t = today();
  const now = nowTime();
  const { date } = props;
  const doses = useMemo(() => indexDoses(state), [state]);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const week = weekStart(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const items = dueOn(state, date, doses);
  const slots = groupByTime(items);
  const done = items.filter((i) => i.dose?.status === 'taken').length;
  const asNeeded = state.meds.filter((m) => m.asNeeded && !m.archivedAt);
  const low = state.meds.filter((m) => !m.archivedAt && supplyOf(m, state).level !== 'ok');
  const activeMeds = state.meds.filter((m) => !m.archivedAt);
  const sheetItem = items.find((i) => i.doseId === openItem);

  // Swiping sideways moves a day at a time. Only quick, clearly horizontal swipes count,
  // so scrolling the page never changes the day by accident.
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const go = (to: string, direction: 'next' | 'prev' | null = null) => {
    setSlide(direction);
    props.onDate(to);
  };
  const onTouchStart = (e: React.TouchEvent) => {
    const inSheet = (e.target as Element).closest?.('dialog');
    touch.current = e.touches.length === 1 && !inSheet ? { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const from = touch.current;
    touch.current = null;
    if (!from) return;
    const dx = e.changedTouches[0].clientX - from.x;
    const dy = e.changedTouches[0].clientY - from.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - from.at > 700) return;
    go(addDays(date, dx < 0 ? 1 : -1), dx < 0 ? 'next' : 'prev');
  };

  return (
    <div className="screen" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={() => (touch.current = null)}>
      <header className="screen-head">
        <div>
          <h1>Pill organizer</h1>
          <p className="muted">{formatDate(week, { month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="week-nav">
          {!days.includes(t) && (
            <button className="btn small" onClick={() => go(t)}>
              Today
            </button>
          )}
          <button className="icon-btn" onClick={() => go(addDays(date, -7))} aria-label="Previous week">
            <ChevronLeft size={22} />
          </button>
          <button className="icon-btn" onClick={() => go(addDays(date, 7))} aria-label="Next week">
            <ChevronRight size={22} />
          </button>
        </div>
      </header>

      <div className="organizer" role="tablist" aria-label="Days of the week">
        {days.map((d) => (
          <Compartment key={d} date={d} state={state} doses={doses} selected={d === date} isToday={d === t} onSelect={() => go(d)} />
        ))}
      </div>

      <section className={`day${slide ? ` slide-${slide}` : ''}`} key={date}>
        <div className="day-head">
          <h2>{friendlyDate(date)}</h2>
          {items.length > 0 && (
            <span className="muted">
              {done} of {items.length} taken
            </span>
          )}
        </div>
        {items.length > 0 && (
          <div className="progress" role="img" aria-label={`${done} of ${items.length} taken`}>
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        )}

        {date === t && low.length > 0 && (
          <button className="banner" onClick={() => props.onOpenCabinet()}>
            <TriangleAlert size={20} />
            <span>
              {low.length > 1
                ? `${low.length} medicines need a refill.`
                : supplyOf(low[0], state).level === 'out'
                  ? `You’re out of ${low[0].name}.`
                  : `${low[0].name} is running low.`}{' '}
              <u>Open the cabinet</u>
            </span>
          </button>
        )}

        {activeMeds.length === 0 && (
          <div className="empty">
            <h3>Your organizer is empty</h3>
            <p className="muted">Add a prescription to your medicine cabinet and its doses will show up here each day.</p>
            <button className="btn primary" onClick={() => props.onOpenCabinet(true)}>
              <Plus size={20} /> Add a medicine
            </button>
          </div>
        )}
        {activeMeds.length > 0 && items.length === 0 && <p className="quiet-note">Nothing scheduled for this day.</p>}

        {slots.map((slot, slotIndex) => {
          const waiting = slot.items.filter((i) => !i.dose);
          const takeable = date <= t;
          return (
            <article className="slot" key={`${slot.time}-${slotIndex}`}>
              <header className="slot-head">
                <div>
                  <strong>
                    {slot.items.every((i) => i.estimated) && 'About '}
                    {/* A follow-up to a late dose can land after midnight; say which day. */}
                    {toDateStr(slot.items[0].at) !== date && `${formatDate(toDateStr(slot.items[0].at), { weekday: 'short' })} `}
                    {formatTime(slot.time)}
                  </strong>
                  <span className="muted"> · {partOfDay(slot.time)}</span>
                </div>
                {takeable && waiting.length > 1 && (
                  <button className="btn small" onClick={(e) => take(e.currentTarget, waiting)}>
                    <Check size={18} /> Take all {waiting.length}
                  </button>
                )}
              </header>
              <ul className="dose-list">
                {slot.items.map((item) => (
                  <DoseRow key={item.doseId} item={item} today={t} now={now} onOpen={() => setOpenItem(item.doseId)} />
                ))}
              </ul>
            </article>
          );
        })}

        {asNeeded.length > 0 && <AsNeeded meds={asNeeded} state={state} date={date} isToday={date === t} />}
      </section>

      {sheetItem && <DoseSheet item={sheetItem} today={t} now={now} onClose={() => setOpenItem(null)} />}
    </div>
  );
}

/** One lidded compartment of the weekly organizer; the pills still inside are the ones left to take. */
function Compartment(props: { date: string; state: AppState; doses: DoseIndex; selected: boolean; isToday: boolean; onSelect: () => void }) {
  const items = dueOn(props.state, props.date, props.doses);
  const waiting = items.filter((i) => !i.dose);
  const t = today();
  const missed = props.date < t && waiting.length > 0;
  const allDone = items.length > 0 && waiting.length === 0;
  const dayNumber = Number(props.date.slice(8));
  const label =
    `${formatDate(props.date)}: ` +
    (items.length === 0 ? 'nothing scheduled' : allDone ? 'all done' : `${waiting.length} of ${items.length} ${missed ? 'missed' : 'left to take'}`);

  return (
    <button
      role="tab"
      aria-selected={props.selected}
      aria-label={label}
      className={`compartment${props.selected ? ' selected' : ''}${props.isToday ? ' today' : ''}${missed ? ' missed' : ''}`}
      onClick={props.onSelect}
    >
      <span className="lid">
        <span className="lid-letter">{DAY_LETTERS[dayOfWeek(props.date)]}</span>
        <span className="lid-date">{dayNumber}</span>
      </span>
      <span className="well">
        {allDone ? (
          <Check className="well-check" size={22} strokeWidth={3} />
        ) : (
          <>
            {waiting.slice(0, 6).map((i) => (
              <PillMark key={i.doseId} med={i.med} />
            ))}
            {waiting.length > 6 && <span className="well-more">+{waiting.length - 6}</span>}
          </>
        )}
      </span>
    </button>
  );
}

function DoseRow({ item, today: t, now, onOpen }: { item: DueItem; today: string; now: string; onOpen: () => void }) {
  const phase = phaseOf(item, t, now);
  const future = item.date > t;
  return (
    <li className={`dose ${phase}${fresh.has(item.doseId) ? ' fresh' : ''}`}>
      <button className="dose-main" onClick={onOpen}>
        <PillMark med={item.med} hollow={phase === 'taken' || phase === 'skipped'} />
        <span className="dose-text">
          <span className="dose-name">
            {item.med.name} {item.med.strength && <span className="muted">{item.med.strength}</span>}
          </span>
          <span className="dose-sub">
            {unitLabel(item.med, item.qty)}
            {item.followUp && ` · ${formatDuration(item.followUp.afterMinutes)} after the dose before`}
            {item.med.instructions && ` · ${item.med.instructions}`}
          </span>
          {phase === 'overdue' && (
            <span className="tag warn">
              <Clock size={14} /> Overdue
            </span>
          )}
          {phase === 'missed' && (
            <span className="tag bad">
              <TriangleAlert size={14} /> Missed
            </span>
          )}
        </span>
      </button>
      {phase === 'taken' ? (
        <button className="take-btn done" onClick={() => undo(item.doseId)} aria-label={`Undo ${item.med.name}`}>
          <Check size={20} strokeWidth={3} />
          <span>{item.dose?.takenAt ? formatClock(item.dose.takenAt) : 'Taken'}</span>
        </button>
      ) : phase === 'skipped' ? (
        <button className="take-btn skipped" onClick={() => undo(item.doseId)} aria-label={`Undo skipping ${item.med.name}`}>
          <span>Skipped</span>
        </button>
      ) : (
        <>
          {!future && (
            <button className="skip-btn" onClick={() => skip(item)} aria-label={`Skip ${item.med.name}`}>
              Skip
            </button>
          )}
          <button className="take-btn" onClick={(e) => take(e.currentTarget, [item])} disabled={future} aria-label={`Take ${item.med.name}`}>
            {future ? 'Not yet' : 'Take'}
          </button>
        </>
      )}
    </li>
  );
}

function DoseSheet({ item, today: t, now, onClose }: { item: DueItem; today: string; now: string; onClose: () => void }) {
  const { state } = useStore();
  const phase = phaseOf(item, t, now);
  const supply = supplyOf(item.med, state);
  const future = item.date > t;
  const [earlier, setEarlier] = useState(false);
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  // A late follow-up dose can fall after midnight; times typed here belong to the day it is due.
  const day = toDateStr(item.at);
  const takenAt = item.dose?.status === 'taken' ? item.dose.takenAt : null;
  return (
    <Sheet title={item.med.name} subtitle={`${friendlyDate(item.date)} ${item.estimated ? 'around' : 'at'} ${formatTime(item.time)}`} onClose={onClose}>
      <dl className="facts">
        <div>
          <dt>Dose</dt>
          <dd>
            {unitLabel(item.med, item.qty)}
            {item.med.strength && ` of ${item.med.strength}`}
          </dd>
        </div>
        {item.med.instructions && (
          <div>
            <dt>Instructions</dt>
            <dd>{item.med.instructions}</dd>
          </div>
        )}
        {supply.tracked && (
          <div>
            <dt>In the cabinet</dt>
            <dd>
              {unitLabel(item.med, supply.stock)} left{supply.daysLeft != null && ` · about ${supply.daysLeft} days`}
            </dd>
          </div>
        )}
        {item.followUp && (
          <div>
            <dt>Follow-up dose</dt>
            <dd>
              Due {formatDuration(item.followUp.afterMinutes)} after the dose before it is taken
              {item.estimated && item.date >= t && '. You’ll get the reminder once that one is marked taken.'}
            </dd>
          </div>
        )}
      </dl>
      {item.dose && takenAt && (
        <TimeEdit
          key={takenAt}
          label="Taken at"
          initial={timeOf(new Date(takenAt))}
          date={day}
          saveLabel="Change"
          onSave={(at) => dispatch({ type: 'dose.put', dose: { ...item.dose!, takenAt: at.toISOString() } })}
        />
      )}
      <div className="action-list">
        {phase !== 'taken' && !future && (
          <button
            className="btn primary block"
            onClick={(e) => {
              take(e.currentTarget, [item]);
              onClose();
            }}
          >
            <Check size={20} /> {phase === 'missed' ? 'I did take it' : 'Take now'}
          </button>
        )}
        {phase !== 'taken' && !future && !earlier && (
          <button className="btn block" onClick={() => setEarlier(true)}>
            <Clock size={20} /> I took it earlier…
          </button>
        )}
        {phase !== 'taken' && !future && earlier && (
          <TimeEdit
            label="What time did you take it?"
            initial={item.at.getTime() <= Date.now() ? item.time : nowTime()}
            date={day}
            saveLabel="Save"
            allowSame
            onSave={(at, button) => {
              take(button, [item], at);
              onClose();
            }}
          />
        )}
        {phase !== 'skipped' && phase !== 'taken' && !future && (
          <button className="btn block" onClick={act(() => skip(item))}>
            <SkipForward size={20} /> Skip this dose
          </button>
        )}
        {item.dose && (
          <button className="btn block" onClick={act(() => undo(item.doseId))}>
            <Undo2 size={20} /> {item.dose.status === 'taken' ? 'Undo: I haven’t taken it' : 'Undo skip'}
          </button>
        )}
        {future && <p className="quiet-note">This dose isn’t due yet.</p>}
      </div>
    </Sheet>
  );
}

/** A time box with a save button, for saying when a dose was really taken. It won't accept a time still to come. */
function TimeEdit(props: { label: string; initial: string; date: string; saveLabel: string; allowSame?: boolean; onSave: (at: Date, button: Element) => void }) {
  const [time, setTime] = useState(props.initial);
  const at = dateTimeOf(props.date, time);
  const notYet = at.getTime() > Date.now();
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      <div className="time-edit">
        <input className="input" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} aria-label={props.label} />
        <button className="btn primary" disabled={notYet || (!props.allowSame && time === props.initial)} onClick={(e) => props.onSave(at, e.currentTarget)}>
          {props.saveLabel}
        </button>
      </div>
      {notYet && <span className="field-error">That time hasn’t come yet.</span>}
    </div>
  );
}

function AsNeeded({ meds, state, date, isToday }: { meds: Med[]; state: AppState; date: string; isToday: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const editDose = state.doses.find((d) => d.id === editing);
  const editMed = editDose && meds.find((m) => m.id === editDose.medId);
  const takeNow = (med: Med, button: Element) => {
    const id = uid();
    markFresh([id]);
    dispatch({
      type: 'dose.put',
      dose: { id, medId: med.id, scheduleId: null, date: today(), time: nowTime(), status: 'taken', qty: 1, takenAt: new Date().toISOString() },
    });
    celebrate(button);
  };
  return (
    <article className="slot">
      <header className="slot-head">
        <div>
          <strong>As needed</strong>
          <span className="muted"> · only when you need it</span>
        </div>
      </header>
      <ul className="dose-list">
        {meds.map((med) => {
          const logged = state.doses.filter((d) => d.medId === med.id && d.scheduleId == null && d.date === date).sort((a, b) => a.time.localeCompare(b.time));
          return (
            <li className="dose" key={med.id}>
              <div className="dose-main static">
                <PillMark med={med} />
                <span className="dose-text">
                  <span className="dose-name">
                    {med.name} {med.strength && <span className="muted">{med.strength}</span>}
                  </span>
                  <span className="dose-sub">{logged.length === 0 ? (isToday ? 'Not taken today' : 'None taken') : `Taken ${logged.length}×`}</span>
                  {logged.length > 0 && (
                    <span className="chips">
                      {logged.map((d) => (
                        <button key={d.id} className={`chip${fresh.has(d.id) ? ' fresh' : ''}`} onClick={() => setEditing(d.id)} aria-label={`Change or remove the ${formatTime(d.time)} dose`}>
                          {formatTime(d.time)}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              </div>
              {isToday && (
                <button className="take-btn" onClick={(e) => takeNow(med, e.currentTarget)} aria-label={`Take ${med.name} now`}>
                  Take
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {editDose && editMed && (
        <Sheet title={editMed.name} subtitle={`As needed · ${friendlyDate(editDose.date)}`} onClose={() => setEditing(null)}>
          <TimeEdit
            label="Taken at"
            initial={editDose.time}
            date={editDose.date}
            saveLabel="Change"
            onSave={(at) => {
              dispatch({ type: 'dose.put', dose: { ...editDose, time: timeOf(at), takenAt: at.toISOString() } });
              setEditing(null);
            }}
          />
          <div className="action-list">
            <button
              className="btn block"
              onClick={() => {
                undo(editDose.id);
                setEditing(null);
              }}
            >
              <Undo2 size={20} /> Remove this dose
            </button>
          </div>
        </Sheet>
      )}
    </article>
  );
}
