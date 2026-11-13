// Getting data out of the app and back in: CSV files a spreadsheet can open
// (medicines, dose history, journal, refills) and the full JSON backup.
//
// Importing never talks to the server directly. A file is turned into the same
// ops the app uses for everything else, so it works offline, is checked by the
// server like any other change, and importing the same file twice is harmless.

import { guard, parseTable, toCsv, type CsvValue } from './csv';
import { dateTimeOf, today as todayStr } from './dates';
import { DEFAULT_QUESTIONS } from './journal';
import { activeSchedules, applyOp, indexDoses, reviseSchedules, uid } from './logic';
import { MED_COLORS, MED_FORMS, MED_ICONS, isCustomColor, type AppState, type Dose, type FollowUp, type JournalEntry, type Med, type Op, type Refill, type Schedule } from './types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------------
// Schedules as text, for the "times" column: "08:00 x1 daily +240m x1; 20:00 x2 Mon-Wed-Fri"

function daysText(days: string): string {
  if (days.length === 7) return 'daily';
  if (days === '12345') return 'weekdays';
  if (days === '06') return 'weekends';
  return [...days].map((d) => DAY_NAMES[Number(d)]).join('-');
}

function parseDays(token: string): string | null {
  const t = token.toLowerCase();
  if (t === 'daily' || t === 'everyday') return '0123456';
  if (t === 'weekdays') return '12345';
  if (t === 'weekends') return '06';
  const days = new Set<number>();
  for (const part of t.split('-')) {
    const i = DAY_NAMES.findIndex((n) => n.toLowerCase() === part.slice(0, 3));
    if (i < 0 || part.length < 3) return null;
    days.add(i);
  }
  return [...days].sort().join('');
}

export function schedulesToText(schedules: Schedule[]): string {
  return schedules
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((s) => [s.time, `x${s.qty}`, daysText(s.days), ...(s.followUps ?? []).flatMap((f) => [`+${f.afterMinutes}m`, `x${f.qty}`]), `#${s.id}`].join(' '))
    .join('; ');
}

/** The reverse of `schedulesToText`. Everything but the time is optional. Throws with a plain message when it can't be read. */
export function parseSchedules(text: string, today = todayStr()): Schedule[] {
  return text
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [first, ...tokens] = part.split(/\s+/);
      const time = /^(\d{1,2}):(\d{2})$/.exec(first);
      if (!time || Number(time[1]) > 23 || Number(time[2]) > 59) throw new Error(`“${first}” is not a time like 08:00`);
      const schedule: Schedule = { id: '', time: `${time[1].padStart(2, '0')}:${time[2]}`, qty: 1, days: '0123456', startDate: today, endDate: null, followUps: [] };
      let target: { qty: number } = schedule;
      for (const token of tokens) {
        const qty = /^x(\d+(?:\.\d+)?)$/i.exec(token);
        const wait = /^\+(\d+)m$/i.exec(token);
        if (qty && Number(qty[1]) > 0) target.qty = Number(qty[1]);
        else if (wait && Number(wait[1]) >= 1 && Number(wait[1]) <= 2880) {
          const followUp: FollowUp = { afterMinutes: Number(wait[1]), qty: 1 };
          schedule.followUps!.push(followUp);
          target = followUp;
        } else if (token.startsWith('#') && /^#[A-Za-z0-9_-]{1,60}$/.test(token)) schedule.id = token.slice(1);
        else {
          const days = parseDays(token);
          if (!days) throw new Error(`“${token}” in “${part}” isn’t something a schedule can have`);
          schedule.days = days;
        }
      }
      return schedule;
    });
}

// ---------------------------------------------------------------------------
// Export

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

export function medicinesCsv(state: AppState): string {
  const head = ['id', 'name', 'strength', 'form', 'color', 'icon', 'as_needed', 'times', 'stock', 'low_days', 'refills_left', 'instructions', 'prescriber', 'pharmacy', 'rx_number', 'archived_on'];
  return toCsv([
    head,
    ...state.meds.map((m): CsvValue[] => [
      m.id,
      guard(m.name),
      guard(m.strength),
      m.form,
      m.color,
      m.icon ?? '',
      yesNo(m.asNeeded),
      m.asNeeded ? '' : schedulesToText(activeSchedules(m)),
      m.stock,
      m.lowDays,
      m.refillsLeft,
      guard(m.instructions),
      guard(m.prescriber),
      guard(m.pharmacy),
      guard(m.rxNumber),
      m.archivedAt,
    ]),
  ]);
}

export function dosesCsv(state: AppState): string {
  const name = new Map(state.meds.map((m) => [m.id, m.name]));
  return toCsv([
    ['id', 'medicine_id', 'medicine', 'schedule_id', 'date', 'time', 'status', 'qty', 'taken_at'],
    ...state.doses.map((d): CsvValue[] => [d.id, d.medId, guard(name.get(d.medId) ?? ''), d.scheduleId, d.date, d.time, d.status, d.qty, d.takenAt]),
  ]);
}

export function refillsCsv(state: AppState): string {
  const name = new Map(state.meds.map((m) => [m.id, m.name]));
  return toCsv([
    ['id', 'medicine_id', 'medicine', 'date', 'qty', 'note'],
    ...state.refills
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r): CsvValue[] => [r.id, r.medId, guard(name.get(r.medId) ?? ''), r.date, r.qty, guard(r.note)]),
  ]);
}

/** Every question that exists or has ever been answered, built-in ones first. */
function journalColumns(state: AppState): { id: string; text: string }[] {
  const columns = DEFAULT_QUESTIONS.map((q) => ({ id: q.id, text: q.text }));
  for (const q of state.questions) if (!columns.some((c) => c.id === q.id)) columns.push({ id: q.id, text: q.text });
  return columns;
}

export function journalCsv(state: AppState): string {
  const columns = journalColumns(state);
  return toCsv([['date', 'note', ...columns.map((c) => c.text)], ...state.journal.map((e): CsvValue[] => [e.date, guard(e.note), ...columns.map((c) => e.answers[c.id] ?? '')])]);
}

// ---------------------------------------------------------------------------
// Import

export type ImportKind = 'backup' | 'medicines' | 'doses' | 'refills' | 'journal';

export interface ImportPlan {
  kind: ImportKind;
  ops: Op[];
  /** What importing will do, in plain sentences. */
  summary: string[];
  /** Rows that were left out, and why. */
  problems: string[];
}

const KIND_LABEL: Record<ImportKind, string> = { backup: 'A full backup', medicines: 'A list of medicines', doses: 'Dose history', refills: 'Refill history', journal: 'Journal entries' };
export const importKindLabel = (kind: ImportKind) => KIND_LABEL[kind];

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const truthy = (text: string) => /^(yes|y|true|1)$/i.test(text);
const numberOr = <T>(text: string, fallback: T): number | T => (text !== '' && Number.isFinite(Number(text)) ? Number(text) : fallback);
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Doses and refills change the pill count as they are recorded; an import of old history must not, so the count is put back afterwards. */
const keepStock = (state: AppState, medIds: Iterable<string>): Op[] =>
  [...new Set(medIds)].flatMap((medId) => {
    const med = state.meds.find((m) => m.id === medId);
    return med ? [{ type: 'stock.set' as const, medId, stock: med.stock }] : [];
  });

function findMed(state: AppState, id: string, name: string): Med | undefined {
  return (id && state.meds.find((m) => m.id === id)) || (name ? state.meds.find((m) => sameText(m.name, name)) : undefined);
}

function importMedicines(rows: Record<string, string>[], state: AppState, today: string): ImportPlan {
  const plan: ImportPlan = { kind: 'medicines', ops: [], summary: [], problems: [] };
  const doses = indexDoses(state);
  let work = state;
  let added = 0;
  let updated = 0;
  rows.forEach((row, i) => {
    const line = i + 2;
    const name = row.name ?? '';
    if (!name) return void plan.problems.push(`Row ${line}: no name.`);
    const strength = row.strength ?? '';
    const existing = (row.id && work.meds.find((m) => m.id === row.id)) || (!row.id ? work.meds.find((m) => sameText(m.name, name) && sameText(m.strength, strength)) : undefined);
    const asNeeded = row.as_needed !== undefined && row.as_needed !== '' ? truthy(row.as_needed) : (existing?.asNeeded ?? !(row.times ?? ''));
    let schedules: Schedule[] = existing?.schedules ?? [];
    if (asNeeded) schedules = existing ? reviseSchedules(existing.schedules, [], doses, today) : [];
    else if (row.times) {
      let parsed: Schedule[];
      try {
        parsed = parseSchedules(row.times, today);
      } catch (err) {
        return void plan.problems.push(`Row ${line} (${name}): ${(err as Error).message}.`);
      }
      if (new Set(parsed.map((s) => s.time)).size !== parsed.length) return void plan.problems.push(`Row ${line} (${name}): two of the times are the same.`);
      // A time with no id is matched to the schedule already at that time, so re-importing changes nothing.
      const current = existing ? activeSchedules(existing, today) : [];
      const edited = parsed.map((s) => ({ ...s, id: s.id || current.find((c) => c.time === s.time)?.id || uid() }));
      schedules = existing ? reviseSchedules(existing.schedules, edited, doses, today) : edited;
    } else if (!existing) return void plan.problems.push(`Row ${line} (${name}): no times given, and it isn’t marked as needed.`);

    const pick = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
    const color = isCustomColor(row.color ?? '') ? (row.color as Med['color']) : pick(row.color, MED_COLORS, existing?.color ?? MED_COLORS.find((c) => !work.meds.some((m) => m.color === c)) ?? 'blue');
    const stock = row.stock === undefined ? (existing?.stock ?? null) : numberOr(row.stock, null);
    const med: Med = {
      id: existing?.id ?? (/^[A-Za-z0-9_:-]{1,100}$/.test(row.id ?? '') ? row.id : uid()),
      name,
      strength,
      form: pick(row.form?.toLowerCase(), MED_FORMS, existing?.form ?? 'tablet'),
      color,
      icon: pick(row.icon, MED_ICONS, existing?.icon || '') as Med['icon'],
      asNeeded,
      schedules,
      stock,
      lowDays: Math.round(numberOr(row.low_days ?? '', existing?.lowDays ?? 7)),
      refillsLeft: row.refills_left === undefined ? (existing?.refillsLeft ?? null) : numberOr(row.refills_left, null),
      instructions: row.instructions ?? existing?.instructions ?? '',
      prescriber: row.prescriber ?? existing?.prescriber ?? '',
      pharmacy: row.pharmacy ?? existing?.pharmacy ?? '',
      rxNumber: row.rx_number ?? existing?.rxNumber ?? '',
      archivedAt: row.archived_on === undefined ? (existing?.archivedAt ?? null) : DATE.test(row.archived_on) ? row.archived_on : null,
    };
    const ops: Op[] = [{ type: 'med.put', med }];
    if (existing && existing.stock !== stock) ops.push({ type: 'stock.set', medId: med.id, stock });
    plan.ops.push(...ops);
    work = ops.reduce(applyOp, work);
    if (existing) updated += 1;
    else added += 1;
  });
  if (added) plan.summary.push(`${count(added, 'medicine')} will be added to the cabinet.`);
  if (updated) plan.summary.push(`${count(updated, 'medicine')} already in the cabinet will be updated.`);
  return plan;
}

function importDoses(rows: Record<string, string>[], state: AppState): ImportPlan {
  const plan: ImportPlan = { kind: 'doses', ops: [], summary: [], problems: [] };
  const touched: string[] = [];
  rows.forEach((row, i) => {
    const line = i + 2;
    const med = findMed(state, row.medicine_id ?? '', row.medicine ?? '');
    if (!med) return void plan.problems.push(`Row ${line}: no medicine called “${row.medicine || row.medicine_id || '?'}” in the cabinet. Import the medicines first.`);
    const time = /^(\d{1,2}):(\d{2})/.exec(row.time ?? '');
    if (!DATE.test(row.date ?? '') || !time) return void plan.problems.push(`Row ${line}: needs a date like 2026-03-09 and a time like 08:00.`);
    const hhmm = `${time[1].padStart(2, '0')}:${time[2]}`;
    const status = sameText(row.status ?? '', 'skipped') ? 'skipped' : 'taken';
    const scheduleId = row.schedule_id || null;
    const dose: Dose = {
      // With no id, the same row always gets the same id, so importing a file twice doesn't double anything.
      id: row.id || (scheduleId ? `${scheduleId}:${row.date}` : `imp-${med.id}-${row.date}-${hhmm}`),
      medId: med.id,
      scheduleId,
      date: row.date,
      time: hhmm,
      status,
      qty: numberOr(row.qty ?? '', 1) || 1,
      takenAt: status === 'taken' ? (row.taken_at && !Number.isNaN(Date.parse(row.taken_at)) ? new Date(row.taken_at).toISOString() : dateTimeOf(row.date, hhmm).toISOString()) : null,
    };
    plan.ops.push({ type: 'dose.put', dose });
    touched.push(med.id);
  });
  const n = plan.ops.length;
  plan.ops.push(...keepStock(state, touched));
  if (n) plan.summary.push(`${count(n, 'dose')} will be added to your history. Your pill counts stay as they are.`);
  return plan;
}

function importRefills(rows: Record<string, string>[], state: AppState): ImportPlan {
  const plan: ImportPlan = { kind: 'refills', ops: [], summary: [], problems: [] };
  const touched: string[] = [];
  rows.forEach((row, i) => {
    const line = i + 2;
    const med = findMed(state, row.medicine_id ?? '', row.medicine ?? '');
    if (!med) return void plan.problems.push(`Row ${line}: no medicine called “${row.medicine || row.medicine_id || '?'}” in the cabinet. Import the medicines first.`);
    const qty = numberOr(row.qty ?? '', 0);
    if (!DATE.test(row.date ?? '') || qty <= 0) return void plan.problems.push(`Row ${line}: needs a date like 2026-03-09 and an amount.`);
    const id = row.id || `imp-r-${med.id}-${row.date}-${String(qty).replace('.', '_')}`;
    if (state.refills.some((r) => r.id === id)) return;
    const refill: Refill = { id, medId: med.id, date: row.date, qty, note: row.note ?? '' };
    plan.ops.push({ type: 'refill.add', refill, useRefill: false });
    touched.push(med.id);
  });
  const n = plan.ops.length;
  plan.ops.push(...keepStock(state, touched));
  if (n) plan.summary.push(`${count(n, 'refill')} will be added to the refill history. Your pill counts stay as they are.`);
  else if (!plan.problems.length) plan.summary.push('Every refill in this file is already here.');
  return plan;
}

/** A journal answer as stored: a number from 1 to 5, decimals allowed. */
const isAnswer = (cell: string | undefined) => !!cell?.trim() && Number(cell) >= 1 && Number(cell) <= 5;

function importJournal(headers: string[], rows: Record<string, string>[], state: AppState): ImportPlan {
  const plan: ImportPlan = { kind: 'journal', ops: [], summary: [], problems: [] };
  const known = journalColumns(state);
  const columns: { key: string; id: string }[] = [];
  const created: string[] = [];
  for (const header of headers) {
    const key = header.toLowerCase();
    if (key === 'date' || key === 'note' || key === 'notes' || !header) continue;
    if (!rows.some((r) => isAnswer(r[key]))) continue; // nothing usable in this column
    const match = known.find((q) => sameText(q.text, header) || q.id === header);
    const stored = match && state.questions.find((q) => q.id === match.id);
    if (!match) {
      const id = uid();
      plan.ops.push({ type: 'question.put', question: { id, text: header.slice(0, 200), archived: false } });
      created.push(header);
      columns.push({ key, id });
    } else {
      // A question that was removed comes back, or its answers would be imported but never shown.
      if (stored?.archived) plan.ops.push({ type: 'question.put', question: { ...stored, archived: false } });
      columns.push({ key, id: match.id });
    }
  }
  let days = 0;
  rows.forEach((row, i) => {
    if (!DATE.test(row.date ?? '')) return void plan.problems.push(`Row ${i + 2}: needs a date like 2026-03-09.`);
    const old = state.journal.find((e) => e.date === row.date);
    const answers = { ...old?.answers };
    // Stored on 1–5 whatever scale the app shows, so decimals (from another scale) come back as they went out.
    for (const c of columns) if (isAnswer(row[c.key])) answers[c.id] = Math.round(Number(row[c.key]) * 1000) / 1000;
    const entry: JournalEntry = { date: row.date, answers, note: row.note || row.notes || old?.note || '' };
    if (!Object.keys(entry.answers).length && !entry.note) return;
    plan.ops.push({ type: 'journal.put', entry });
    days += 1;
  });
  if (days) plan.summary.push(`${count(days, 'day')} of journal entries will be added or updated.`);
  if (created.length) plan.summary.push(`${count(created.length, 'new question')} will be added: ${created.map((c) => `“${c}”`).join(', ')}.`);
  return plan;
}

function importBackup(data: Partial<AppState>): ImportPlan {
  const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
  const meds = list(data.meds);
  const ops: Op[] = [
    ...meds.map((med) => ({ type: 'med.put' as const, med })),
    ...list(data.questions).map((question) => ({ type: 'question.put' as const, question })),
    ...list(data.journal).map((entry) => ({ type: 'journal.put' as const, entry })),
    ...list(data.doses).map((dose) => ({ type: 'dose.put' as const, dose })),
    ...list(data.refills).map((refill) => ({ type: 'refill.add' as const, refill, useRefill: false })),
    // Last, so the counts end up exactly as they were when the backup was made.
    ...meds.map((med) => ({ type: 'stock.set' as const, medId: med.id, stock: med.stock ?? null })),
  ];
  const summary = [
    `${count(meds.length, 'medicine')}, ${count(list(data.doses).length, 'dose')}, ${count(list(data.refills).length, 'refill')} and ${count(list(data.journal).length, 'journal day')} will be restored.`,
    'Anything with the same id that is already here is overwritten with the backup’s version; everything else you have is kept.',
  ];
  return { kind: 'backup', ops, summary, problems: meds.length || ops.length ? [] : ['This backup is empty.'] };
}

/** Works out what a chosen file is and what importing it would do. Throws with a plain message if it can't be used at all. */
export function planImport(text: string, state: AppState, today = todayStr()): ImportPlan {
  if (/^\s*\{/.test(text)) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('This file isn’t a readable backup.');
    }
    if (!data || typeof data !== 'object' || !Array.isArray((data as AppState).meds)) throw new Error('This file isn’t a Rxmindly backup.');
    return importBackup(data as Partial<AppState>);
  }
  const { headers, rows } = parseTable(text);
  const has = (name: string) => headers.some((h) => h.toLowerCase() === name);
  if (!rows.length) throw new Error('This file has no rows to import.');
  if (has('name')) return importMedicines(rows, state, today);
  if (has('date') && has('time')) return importDoses(rows, state);
  if (has('date') && has('qty')) return importRefills(rows, state);
  if (has('date')) return importJournal(headers, rows, state);
  throw new Error('Can’t tell what this file is. A medicines file needs a “name” column; dose, refill and journal files need a “date” column.');
}
