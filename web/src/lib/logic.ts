import { addDays, dateRange, dateTimeOf, dayOfWeek, formatTime, timeOf, today as todayStr, nowTime } from './dates';
import type { AppState, Dose, FollowUp, Med, MedForm, MedIcon, Op, Schedule } from './types';

export function uid(): string {
  // crypto.randomUUID needs HTTPS; getRandomValues works on a plain-http home server too.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const clampStock = (stock: number | null, delta: number) => (stock == null ? null : Math.max(0, stock + delta));

/**
 * Applies a change to the local copy. The server applies the same op with the
 * same rules (server/src/store.js), so the screen is right before the sync lands.
 */
export function applyOp(state: AppState, op: Op): AppState {
  switch (op.type) {
    case 'med.put': {
      const existing = state.meds.find((m) => m.id === op.med.id);
      const med = existing ? { ...op.med, stock: existing.stock } : op.med;
      const meds = existing ? state.meds.map((m) => (m.id === med.id ? med : m)) : [...state.meds, med];
      meds.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      return { ...state, meds };
    }
    case 'med.delete':
      return {
        ...state,
        meds: state.meds.filter((m) => m.id !== op.id),
        doses: state.doses.filter((d) => d.medId !== op.id),
        refills: state.refills.filter((r) => r.medId !== op.id),
      };
    case 'stock.set':
      return { ...state, meds: state.meds.map((m) => (m.id === op.medId ? { ...m, stock: op.stock } : m)) };
    case 'dose.put': {
      if (!state.meds.some((m) => m.id === op.dose.medId)) return state;
      const old = state.doses.find((d) => d.id === op.dose.id);
      const before = old?.status === 'taken' ? old.qty : 0;
      const after = op.dose.status === 'taken' ? op.dose.qty : 0;
      return {
        ...state,
        doses: old ? state.doses.map((d) => (d.id === op.dose.id ? op.dose : d)) : [...state.doses, op.dose],
        meds: state.meds.map((m) => (m.id === op.dose.medId ? { ...m, stock: clampStock(m.stock, before - after) } : m)),
      };
    }
    case 'dose.delete': {
      const old = state.doses.find((d) => d.id === op.id);
      if (!old) return state;
      return {
        ...state,
        doses: state.doses.filter((d) => d.id !== op.id),
        meds:
          old.status === 'taken'
            ? state.meds.map((m) => (m.id === old.medId ? { ...m, stock: clampStock(m.stock, old.qty) } : m))
            : state.meds,
      };
    }
    case 'refill.add': {
      const med = state.meds.find((m) => m.id === op.refill.medId);
      if (!med || state.refills.some((r) => r.id === op.refill.id)) return state;
      const useRefill = op.useRefill && med.refillsLeft != null && med.refillsLeft > 0;
      return {
        ...state,
        refills: [op.refill, ...state.refills],
        meds: state.meds.map((m) =>
          m.id === med.id
            ? { ...m, stock: (m.stock ?? 0) + op.refill.qty, refillsLeft: useRefill ? m.refillsLeft! - 1 : m.refillsLeft }
            : m,
        ),
      };
    }
    case 'question.put': {
      const question = { id: op.question.id, text: op.question.text.trim(), archived: !!op.question.archived };
      if (!question.text) return state;
      const known = state.questions.some((q) => q.id === question.id);
      return { ...state, questions: known ? state.questions.map((q) => (q.id === question.id ? question : q)) : [...state.questions, question] };
    }
    case 'journal.put': {
      // The whole day is replaced; an entry with nothing in it is removed.
      const entry = { date: op.entry.date, answers: { ...op.entry.answers }, note: op.entry.note.trim() };
      const others = state.journal.filter((e) => e.date !== entry.date);
      const empty = !Object.keys(entry.answers).length && !entry.note;
      return { ...state, journal: empty ? others : [...others, entry].sort((a, b) => a.date.localeCompare(b.date)) };
    }
  }
}

// ---------------------------------------------------------------------------
// The pill organizer: what is due on a given day

export interface DueItem {
  med: Med;
  schedule: Schedule;
  /** The day this dose belongs to (the day of the scheduled dose it follows from). */
  date: string;
  /** Clock time it is due, "HH:MM". For a follow-up dose this moves with when the dose before was taken. */
  time: string;
  /** The same moment as a Date. A late follow-up can land after midnight. */
  at: Date;
  qty: number;
  doseId: string;
  dose: Dose | undefined;
  /** Set on follow-up doses. */
  followUp?: FollowUp;
  /** True while a follow-up's time is only a guess, because the dose before it isn't recorded yet. */
  estimated: boolean;
}

export type DoseIndex = Map<string, Dose>;

export const indexDoses = (state: AppState): DoseIndex => new Map(state.doses.map((d) => [d.id, d]));

export const scheduledDoseId = (scheduleId: string, date: string) => `${scheduleId}:${date}`;

/** Follow-up doses are numbered from 1, so their ids are as repeatable as the scheduled dose's. */
export const followUpDoseId = (scheduleId: string, date: string, n: number) => `${scheduleId}:${date}:${n}`;

const scheduleApplies = (s: Schedule, date: string, weekday: number) =>
  s.startDate <= date && (s.endDate == null || date <= s.endDate) && s.days.includes(String(weekday));

const medActiveOn = (med: Med, date: string) => !med.asNeeded && (med.archivedAt == null || date < med.archivedAt);

export function dueOn(state: AppState, date: string, doses: DoseIndex): DueItem[] {
  const weekday = dayOfWeek(date);
  const items: DueItem[] = [];
  for (const med of state.meds) {
    if (!medActiveOn(med, date)) continue;
    for (const schedule of med.schedules) {
      if (!scheduleApplies(schedule, date, weekday)) continue;
      const doseId = scheduledDoseId(schedule.id, date);
      const dose = doses.get(doseId);
      let prev: DueItem = { med, schedule, date, time: schedule.time, at: dateTimeOf(date, schedule.time), qty: dose?.qty ?? schedule.qty, doseId, dose, estimated: false };
      items.push(prev);
      (schedule.followUps ?? []).forEach((followUp, i) => {
        // The clock starts when the dose before was actually taken; until then, go by when it was due.
        const taken = prev.dose?.status === 'taken' && prev.dose.takenAt ? new Date(prev.dose.takenAt) : null;
        const at = new Date((taken ?? prev.at).getTime() + followUp.afterMinutes * 60_000);
        at.setSeconds(0, 0);
        const id = followUpDoseId(schedule.id, date, i + 1);
        const own = doses.get(id);
        prev = {
          med,
          schedule,
          date,
          time: timeOf(at),
          at,
          qty: own?.qty ?? followUp.qty,
          doseId: id,
          dose: own,
          followUp,
          estimated: taken ? false : !prev.dose || prev.estimated,
        };
        items.push(prev);
      });
    }
  }
  return items.sort((a, b) => a.at.getTime() - b.at.getTime() || a.med.name.localeCompare(b.med.name));
}

export interface TimeSlot {
  time: string;
  items: DueItem[];
}

export function groupByTime(items: DueItem[]): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (const item of items) {
    const last = slots[slots.length - 1];
    if (last?.time === item.time) last.items.push(item);
    else slots.push({ time: item.time, items: [item] });
  }
  return slots;
}

export type ItemPhase = 'taken' | 'skipped' | 'upcoming' | 'overdue' | 'missed';

/** Where a scheduled dose stands right now. */
export function phaseOf(item: DueItem, today = todayStr(), now = nowTime()): ItemPhase {
  if (item.dose) return item.dose.status;
  if (item.date < today && item.estimated) return 'missed';
  if (item.estimated || item.at > dateTimeOf(today, now)) return 'upcoming';
  return item.date < today ? 'missed' : 'overdue';
}

// ---------------------------------------------------------------------------
// The medicine cabinet: supply

export const activeSchedules = (med: Med, on = todayStr()) =>
  med.schedules.filter((s) => s.endDate == null || s.endDate >= on);

/** Average units used per day by the current schedule. */
export function dailyUse(med: Med): number {
  if (med.asNeeded) return 0;
  const perDay = (s: Schedule) => s.qty + (s.followUps ?? []).reduce((n, f) => n + f.qty, 0);
  return activeSchedules(med).reduce((sum, s) => sum + (perDay(s) * s.days.length) / 7, 0);
}

export interface Supply {
  tracked: boolean;
  stock: number;
  /** Whole days of supply left; null when it can't be worked out (as-needed, or no schedule). */
  daysLeft: number | null;
  runsOutOn: string | null;
  level: 'ok' | 'low' | 'out';
  /** 0–1, how full to draw the bottle. */
  fill: number;
}

export function supplyOf(med: Med, state: AppState): Supply {
  if (med.stock == null) return { tracked: false, stock: 0, daysLeft: null, runsOutOn: null, level: 'ok', fill: 0.6 };
  const use = dailyUse(med);
  const daysLeft = use > 0 ? Math.floor(med.stock / use + 1e-9) : null;
  const lastRefill = state.refills.find((r) => r.medId === med.id)?.qty ?? 0;
  const full = Math.max(med.stock, lastRefill, use * 30, 1);
  let level: Supply['level'] = 'ok';
  if (med.stock <= 0) level = 'out';
  else if (daysLeft != null ? daysLeft <= med.lowDays : med.stock <= 5) level = 'low';
  return {
    tracked: true,
    stock: med.stock,
    daysLeft,
    runsOutOn: daysLeft != null ? addDays(todayStr(), daysLeft) : null,
    level,
    fill: Math.min(1, med.stock / full),
  };
}

export const formatQty = (n: number) => String(Math.round(n * 100) / 100);

const UNIT: Record<string, [string, string]> = {
  tablet: ['tablet', 'tablets'],
  capsule: ['capsule', 'capsules'],
  liquid: ['dose', 'doses'],
  injection: ['injection', 'injections'],
  inhaler: ['puff', 'puffs'],
  drops: ['drop', 'drops'],
  cream: ['application', 'applications'],
  patch: ['patch', 'patches'],
  other: ['dose', 'doses'],
};

export function unitLabel(med: Med, qty: number): string {
  const [one, many] = UNIT[med.form] ?? UNIT.other;
  return `${formatQty(qty)} ${qty === 1 ? one : many}`;
}

const FORM_ICON: Record<MedForm, MedIcon> = {
  tablet: 'round',
  capsule: 'capsule',
  liquid: 'liquid',
  injection: 'syringe',
  inhaler: 'inhaler',
  drops: 'drops',
  cream: 'tube',
  patch: 'patch',
  other: 'round',
};

export const defaultIcon = (form: MedForm): MedIcon => FORM_ICON[form] ?? 'round';

/** The picture to draw for a medicine: the one chosen, or one that suits its form. */
export const iconOf = (med: Pick<Med, 'form' | 'icon'>): MedIcon => med.icon || defaultIcon(med.form);

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeDays(days: string): string {
  if (days.length === 7) return 'every day';
  if (days === '12345') return 'weekdays';
  if (days === '06') return 'weekends';
  return [...days].map((d) => DAY_SHORT[Number(d)]).join(', ');
}

export function describeSchedule(med: Med): string {
  if (med.asNeeded) return 'As needed';
  const schedules = activeSchedules(med).slice().sort((a, b) => a.time.localeCompare(b.time));
  if (!schedules.length) return 'No schedule';
  const sameDays = schedules.every((s) => s.days === schedules[0].days);
  const times = schedules.map((s) => {
    const first = s.qty === 1 ? formatTime(s.time) : `${formatQty(s.qty)} at ${formatTime(s.time)}`;
    return s.followUps?.length ? `${first} + ${s.followUps.length} more` : first;
  });
  if (sameDays) return `${times.join(', ')} · ${describeDays(schedules[0].days)}`;
  return schedules.map((s, i) => `${times[i]} (${describeDays(s.days)})`).join(', ');
}

const sameFollowUps = (a: Schedule, b: Schedule) => {
  const x = a.followUps ?? [];
  const y = b.followUps ?? [];
  return x.length === y.length && x.every((f, i) => f.afterMinutes === y[i].afterMinutes && f.qty === y[i].qty);
};

/**
 * Works out the schedule list to save after an edit. Past days keep the
 * schedule they actually had: a changed or removed time is ended rather than
 * rewritten, so history doesn't shift under you.
 */
export function reviseSchedules(previous: Schedule[], edited: Schedule[], doses: DoseIndex, today = todayStr()): Schedule[] {
  const yesterday = addDays(today, -1);
  const result: Schedule[] = previous.filter((s) => s.endDate != null && s.endDate < today);
  const current = previous.filter((s) => s.endDate == null || s.endDate >= today);
  const editedById = new Map(edited.map((s) => [s.id, s]));

  const retire = (old: Schedule): string => {
    // Returns the first day a replacement may start.
    if (old.startDate >= today && !doses.has(scheduledDoseId(old.id, today))) return today; // never used: drop it
    const usedToday = doses.has(scheduledDoseId(old.id, today));
    result.push({ ...old, endDate: usedToday ? today : yesterday });
    return usedToday ? addDays(today, 1) : today;
  };

  for (const old of current) {
    const next = editedById.get(old.id);
    if (!next) {
      retire(old);
    } else if (next.time === old.time && next.qty === old.qty && next.days === old.days && sameFollowUps(old, next)) {
      result.push({ ...old, endDate: null });
    } else {
      const startDate = retire(old);
      result.push({ ...next, id: uid(), startDate, endDate: null });
    }
  }
  const known = new Set(current.map((s) => s.id));
  for (const added of edited) {
    if (!known.has(added.id)) result.push({ ...added, startDate: today, endDate: null });
  }
  return result;
}

// ---------------------------------------------------------------------------
// History

export type CellStatus = 'none' | 'taken' | 'partial' | 'missed' | 'skipped' | 'pending' | 'asNeeded';

export interface Cell {
  date: string;
  status: CellStatus;
  expected: number;
  taken: number;
  skipped: number;
  items: DueItem[];
  /** As-needed doses logged that day. */
  extra: Dose[];
}

export interface MedHistory {
  med: Med;
  cells: Cell[];
  expected: number;
  taken: number;
  skipped: number;
  missed: number;
  onTime: number;
  asNeededCount: number;
}

export interface History {
  dates: string[];
  rows: MedHistory[];
  expected: number;
  taken: number;
  skipped: number;
  missed: number;
  /** Share of scheduled doses taken, 0–1; null when nothing was scheduled. */
  adherence: number | null;
  /** Share of taken doses that were within an hour of schedule. */
  onTimeRate: number | null;
  /** Consecutive days, counting back from today, with every scheduled dose taken. */
  streak: number;
}

const ON_TIME_MS = 60 * 60_000;

export function buildHistory(state: AppState, from: string, to: string, today = todayStr()): History {
  const doses = indexDoses(state);
  const dates = dateRange(from, to);
  const extraByMedDay = new Map<string, Dose[]>();
  for (const d of state.doses) {
    if (d.scheduleId != null || d.date < from || d.date > to) continue;
    const key = `${d.medId}|${d.date}`;
    extraByMedDay.set(key, [...(extraByMedDay.get(key) ?? []), d]);
  }

  const rows = new Map<string, MedHistory>();
  const rowFor = (med: Med) => {
    let row = rows.get(med.id);
    if (!row) {
      row = { med, cells: [], expected: 0, taken: 0, skipped: 0, missed: 0, onTime: 0, asNeededCount: 0 };
      rows.set(med.id, row);
    }
    return row;
  };

  const perDay = dates.map((date) => ({ date, byMed: new Map<string, DueItem[]>() }));
  for (const day of perDay) {
    for (const item of dueOn(state, day.date, doses)) {
      day.byMed.set(item.med.id, [...(day.byMed.get(item.med.id) ?? []), item]);
      rowFor(item.med);
    }
  }
  for (const med of state.meds) {
    if (med.asNeeded && dates.some((d) => extraByMedDay.has(`${med.id}|${d}`))) rowFor(med);
  }

  for (const row of rows.values()) {
    for (const day of perDay) {
      const items = day.byMed.get(row.med.id) ?? [];
      const extra = extraByMedDay.get(`${row.med.id}|${day.date}`) ?? [];
      // Today's doses only count once they've been recorded: the day isn't over.
      const counted = items.filter((i) => i.dose || day.date < today);
      const taken = counted.filter((i) => i.dose?.status === 'taken').length;
      const skipped = counted.filter((i) => i.dose?.status === 'skipped').length;
      let status: CellStatus = 'none';
      if (extra.length && !items.length) status = 'asNeeded';
      else if (!items.length) status = 'none';
      else if (!counted.length) status = 'pending';
      // A day still in progress with everything so far taken reads as pending.
      else if (taken === counted.length) status = counted.length < items.length ? 'pending' : 'taken';
      else if (taken > 0) status = 'partial';
      else status = skipped === counted.length ? 'skipped' : 'missed';

      row.cells.push({ date: day.date, status, expected: counted.length, taken, skipped, items, extra });
      row.expected += counted.length;
      row.taken += taken;
      row.skipped += skipped;
      row.missed += counted.length - taken - skipped;
      row.asNeededCount += extra.length;
      for (const item of counted) {
        if (item.dose?.status !== 'taken' || !item.dose.takenAt) continue;
        const drift = Math.abs(Date.parse(item.dose.takenAt) - item.at.getTime());
        if (drift <= ON_TIME_MS) row.onTime += 1;
      }
    }
  }

  const list = [...rows.values()].sort((a, b) => a.med.name.localeCompare(b.med.name));
  const sum = (pick: (r: MedHistory) => number) => list.reduce((n, r) => n + pick(r), 0);
  const expected = sum((r) => r.expected);
  const taken = sum((r) => r.taken);

  return {
    dates,
    rows: list,
    expected,
    taken,
    skipped: sum((r) => r.skipped),
    missed: sum((r) => r.missed),
    adherence: expected ? taken / expected : null,
    onTimeRate: taken ? sum((r) => r.onTime) / taken : null,
    streak: currentStreak(state, doses, today),
  };
}

function currentStreak(state: AppState, doses: DoseIndex, today: string): number {
  let streak = 0;
  let anyScheduled = false;
  for (let i = 0; i < 180; i++) {
    const date = addDays(today, -i);
    const items = dueOn(state, date, doses);
    if (!items.length) continue;
    anyScheduled = true;
    const allTaken = items.every((item) => item.dose?.status === 'taken');
    if (allTaken) streak += 1;
    else if (i === 0) continue; // today isn't finished yet, so it can't break the streak
    else break;
  }
  return anyScheduled ? streak : 0;
}
