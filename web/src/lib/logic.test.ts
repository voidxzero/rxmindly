import { describe, expect, test } from 'vitest';
import { applyOp, buildHistory, dailyUse, dueOn, followUpDoseId, iconOf, indexDoses, phaseOf, reviseSchedules, scheduledDoseId, supplyOf } from './logic';
import { activeQuestions, formatScaled, fromScale, journalTrends, scaleTicks, toScale } from './journal';
import { EMPTY_STATE, type AppState, type Dose, type Med, type Schedule } from './types';

const schedule = (over: Partial<Schedule> = {}): Schedule => ({ id: 's1', time: '08:00', qty: 1, days: '0123456', startDate: '2026-11-01', endDate: null, ...over });

const med = (over: Partial<Med> = {}): Med => ({
  id: 'm1',
  name: 'Lisinopril',
  strength: '10 mg',
  form: 'tablet',
  color: 'blue',
  instructions: '',
  prescriber: '',
  pharmacy: '',
  rxNumber: '',
  stock: 30,
  lowDays: 7,
  refillsLeft: 2,
  asNeeded: false,
  archivedAt: null,
  schedules: [schedule()],
  ...over,
});

const dose = (date: string, over: Partial<Dose> = {}): Dose => ({
  id: scheduledDoseId('s1', date),
  medId: 'm1',
  scheduleId: 's1',
  date,
  time: '08:00',
  status: 'taken',
  qty: 1,
  takenAt: new Date(`${date}T08:05:00`).toISOString(),
  ...over,
});

const withMed = (m = med()): AppState => applyOp(EMPTY_STATE, { type: 'med.put', med: m });

describe('pill count', () => {
  test('taking lowers it, undoing restores it, repeating changes nothing', () => {
    let s = withMed();
    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-10') });
    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-10') });
    expect(s.meds[0].stock).toBe(29);
    expect(s.doses).toHaveLength(1);
    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-10', { status: 'skipped' }) });
    expect(s.meds[0].stock).toBe(30);
    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-10') });
    s = applyOp(s, { type: 'dose.delete', id: dose('2026-11-10').id });
    expect(s.meds[0].stock).toBe(30);
  });

  test('editing details keeps the count; a refill adds to it and uses a refill', () => {
    let s = withMed();
    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-10') });
    s = applyOp(s, { type: 'med.put', med: med({ name: 'Renamed', stock: 30 }) });
    expect(s.meds[0]).toMatchObject({ name: 'Renamed', stock: 29 });
    const refill = { type: 'refill.add' as const, refill: { id: 'r1', medId: 'm1', date: '2026-11-11', qty: 90, note: '' }, useRefill: true };
    s = applyOp(applyOp(s, refill), refill);
    expect(s.meds[0]).toMatchObject({ stock: 119, refillsLeft: 1 });
  });

  test('supply warns when few days are left', () => {
    const twice = med({ stock: 10, schedules: [schedule(), schedule({ id: 's2', time: '20:00' })] });
    const supply = supplyOf(twice, withMed(twice));
    expect(supply.daysLeft).toBe(5);
    expect(supply.level).toBe('low');
    expect(supplyOf(med({ stock: 0 }), withMed()).level).toBe('out');
    expect(supplyOf(med({ stock: null }), withMed()).tracked).toBe(false);
  });
});

describe('what is due', () => {
  test('follows days of the week, start and end dates, and archiving', () => {
    const s = withMed(med({ schedules: [schedule({ days: '135', endDate: '2026-11-13' })], archivedAt: null }));
    const due = (date: string, state = s) => dueOn(state, date, indexDoses(state)).length;
    expect(due('2026-11-09')).toBe(1); // Monday
    expect(due('2026-11-10')).toBe(0); // Tuesday
    expect(due('2026-10-30')).toBe(0); // before it started
    expect(due('2026-11-16')).toBe(0); // after it ended
    const archived = withMed(med({ archivedAt: '2026-11-10' }));
    expect(due('2026-11-09', archived)).toBe(1);
    expect(due('2026-11-10', archived)).toBe(0);
  });
});

describe('editing a schedule', () => {
  const today = '2026-11-11';

  test('changing a time keeps the old time for past days', () => {
    const before = [schedule()];
    const after = reviseSchedules(before, [schedule({ time: '09:00' })], new Map(), today);
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ id: 's1', time: '08:00', endDate: '2026-11-10' });
    expect(after[1]).toMatchObject({ time: '09:00', startDate: today, endDate: null });
    expect(after[1].id).not.toBe('s1');
  });

  test('a dose already taken today stays put; the new time starts tomorrow', () => {
    const doses = new Map([[scheduledDoseId('s1', today), dose(today)]]);
    const after = reviseSchedules([schedule()], [schedule({ time: '09:00' })], doses, today);
    expect(after[0]).toMatchObject({ id: 's1', endDate: today });
    expect(after[1]).toMatchObject({ time: '09:00', startDate: '2026-11-12' });
  });

  test('untouched times are left alone, removed ones end, new ones start today', () => {
    const after = reviseSchedules(
      [schedule(), schedule({ id: 's2', time: '20:00' })],
      [schedule(), schedule({ id: 'new', time: '12:00', startDate: 'x' })],
      new Map(),
      today,
    );
    expect(after.find((s) => s.id === 's1')).toMatchObject({ endDate: null });
    expect(after.find((s) => s.id === 's2')).toMatchObject({ endDate: '2026-11-10' });
    expect(after.find((s) => s.id === 'new')).toMatchObject({ startDate: today });
  });

  test('a time added and removed the same day leaves no trace', () => {
    expect(reviseSchedules([schedule({ startDate: today })], [], new Map(), today)).toEqual([]);
  });
});

describe('history', () => {
  test('counts taken, skipped and missed, and leaves today open', () => {
    let s = withMed();
    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-08') });
    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-09', { status: 'skipped', takenAt: null }) });
    // the 10th is missed; the 11th (today) has not been taken yet
    const h = buildHistory(s, '2026-11-08', '2026-11-11', '2026-11-11');
    expect(h.rows[0].cells.map((c) => c.status)).toEqual(['taken', 'skipped', 'missed', 'pending']);
    expect(h).toMatchObject({ expected: 3, taken: 1, skipped: 1, missed: 1, streak: 0 });
    expect(h.adherence).toBeCloseTo(1 / 3);
    expect(h.onTimeRate).toBe(1);
  });

  test('streak counts perfect days and is not broken by an unfinished today', () => {
    let s = withMed();
    for (const d of ['2026-11-08', '2026-11-09', '2026-11-10']) s = applyOp(s, { type: 'dose.put', dose: dose(d) });
    expect(buildHistory(s, '2026-11-05', '2026-11-11', '2026-11-11').streak).toBe(3);
    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-11') });
    expect(buildHistory(s, '2026-11-05', '2026-11-11', '2026-11-11').streak).toBe(4);
  });

  test('a day with some doses taken is partial', () => {
    const two = med({ schedules: [schedule(), schedule({ id: 's2', time: '20:00' })] });
    let s = withMed(two);
    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-09') });
    const h = buildHistory(s, '2026-11-09', '2026-11-09', '2026-11-11');
    expect(h.rows[0].cells[0]).toMatchObject({ status: 'partial', taken: 1, expected: 2 });
  });
});

describe('follow-up doses', () => {
  const chained = med({ schedules: [schedule({ followUps: [{ afterMinutes: 240, qty: 1 }, { afterMinutes: 90, qty: 2 }] })] });
  const due = (s: AppState) => dueOn(s, '2026-11-11', indexDoses(s));

  test('are timed from the schedule until the dose before is taken', () => {
    const items = due(withMed(chained));
    expect(items.map((i) => [i.doseId, i.time, i.qty, i.estimated])).toEqual([
      ['s1:2026-11-11', '08:00', 1, false],
      ['s1:2026-11-11:1', '12:00', 1, true],
      ['s1:2026-11-11:2', '13:30', 2, true],
    ]);
    // Not due, and no reminder, until the first dose is recorded.
    expect(phaseOf(items[1], '2026-11-11', '15:00')).toBe('upcoming');
    expect(phaseOf(items[1], '2026-11-12', '15:00')).toBe('missed');
  });

  test('start their clock when the dose before is marked taken, and follow a corrected time', () => {
    const at = (time: string) => new Date(`2026-11-11T${time}:00`).toISOString();
    let s = applyOp(withMed(chained), { type: 'dose.put', dose: dose('2026-11-11', { takenAt: at('08:40') }) });
    let items = due(s);
    expect(items.map((i) => [i.time, i.estimated])).toEqual([['08:00', false], ['12:40', false], ['14:10', true]]);
    expect(phaseOf(items[1], '2026-11-11', '12:39')).toBe('upcoming');
    expect(phaseOf(items[1], '2026-11-11', '12:40')).toBe('overdue');

    // "I actually took it at 7:15": the same op again with a new time.
    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-11', { takenAt: at('07:15') }) });
    expect(s.meds[0].stock).toBe(29);
    expect(due(s)[1].time).toBe('11:15');

    s = applyOp(s, { type: 'dose.put', dose: dose('2026-11-11', { id: followUpDoseId('s1', '2026-11-11', 1), time: '11:20', takenAt: at('11:20') }) });
    items = due(s);
    expect(items[2]).toMatchObject({ time: '12:50', estimated: false, qty: 2 });
    expect(s.meds[0].stock).toBe(28);
  });

  test('count toward daily use, and changing them starts a new schedule', () => {
    expect(dailyUse(chained)).toBe(4);
    const today = '2026-11-11';
    const same = reviseSchedules(chained.schedules, [{ ...chained.schedules[0] }], new Map(), today);
    expect(same.map((s) => s.id)).toEqual(['s1']);
    const changed = reviseSchedules(chained.schedules, [{ ...chained.schedules[0], followUps: [{ afterMinutes: 300, qty: 1 }] }], new Map(), today);
    expect(changed.map((s) => [s.id === 's1', s.endDate, s.followUps?.length])).toEqual([[true, '2026-11-10', 2], [false, null, 1]]);
  });
});

describe('icons', () => {
  test('follow the form unless one was chosen', () => {
    expect(iconOf(med())).toBe('round');
    expect(iconOf(med({ form: 'inhaler' }))).toBe('inhaler');
    expect(iconOf(med({ form: 'tablet', icon: 'softgel' }))).toBe('softgel');
  });
});

describe('journal', () => {
  test('one entry per day, replaced by the latest save and removed when emptied', () => {
    let s = applyOp(EMPTY_STATE, { type: 'journal.put', entry: { date: '2026-11-11', answers: { mood: 4 }, note: ' ok ' } });
    s = applyOp(s, { type: 'journal.put', entry: { date: '2026-11-10', answers: { mood: 2 }, note: '' } });
    s = applyOp(s, { type: 'journal.put', entry: { date: '2026-11-11', answers: { mood: 5, energy: 3 }, note: 'better' } });
    expect(s.journal).toEqual([
      { date: '2026-11-10', answers: { mood: 2 }, note: '' },
      { date: '2026-11-11', answers: { mood: 5, energy: 3 }, note: 'better' },
    ]);
    s = applyOp(s, { type: 'journal.put', entry: { date: '2026-11-10', answers: {}, note: ' ' } });
    expect(s.journal.map((e) => e.date)).toEqual(['2026-11-11']);
  });

  test('built-in questions can be switched off and your own added; deleting a medicine leaves the journal alone', () => {
    let s = withMed();
    s = applyOp(s, { type: 'journal.put', entry: { date: '2026-11-11', answers: { mood: 4, q1: 2 }, note: '' } });
    s = applyOp(s, { type: 'question.put', question: { id: 'q1', text: ' Did I get outside? ', archived: false } });
    s = applyOp(s, { type: 'question.put', question: { id: 'sleep', text: 'sleep', archived: true } });
    expect(activeQuestions(s).map((q) => q.id)).toEqual(['mood', 'energy', 'calm', 'q1']);
    const trends = journalTrends(s, ['2026-11-10', '2026-11-11']);
    expect(trends.map((t) => [t.question.id, t.values, t.average])).toEqual([
      ['mood', [null, 4], 4],
      ['energy', [null, null], null],
      ['calm', [null, null], null],
      ['q1', [null, 2], 2],
    ]);
    s = applyOp(s, { type: 'question.put', question: { id: 'q1', text: 'Did I get outside?', archived: true } });
    expect(activeQuestions(s).map((q) => q.id)).toEqual(['mood', 'energy', 'calm']);
    s = applyOp(s, { type: 'med.delete', id: 'm1' });
    expect(s.journal.length).toBe(1);
    expect(s.questions.length).toBe(2);
  });
});

describe('app updates', () => {
  test('versions are compared number by number', async () => {
    const { isNewer } = await import('./updates');
    expect(isNewer('1.10.0', '1.9.3')).toBe(true);
    expect(isNewer('v1.2.0', '1.2.0')).toBe(false);
    expect(isNewer('1.1.9', '1.2.0')).toBe(false);
    expect(isNewer('2.0', '1.99.99')).toBe(true);
  });
});

describe('journal scales', () => {
  test('answers on any scale are stored on 1–5 and come back the same', () => {
    for (const max of [5, 10, 15, 20]) {
      for (let n = 1; n <= max; n++) expect(Math.round(toScale(fromScale(n, max), max))).toBe(n);
      expect(fromScale(1, max)).toBe(1);
      expect(fromScale(max, max)).toBe(5);
    }
    expect(fromScale(7, 10)).toBe(3.667);
  });

  test('charts write values on the chosen scale to a tenth', () => {
    expect(formatScaled(3, 5)).toBe('3.0');
    expect(formatScaled(3, 10)).toBe('5.5');
    expect(formatScaled(3.667, 10)).toBe('7.0');
    expect(scaleTicks(5)).toEqual([1, 2, 3, 4, 5]);
    expect(scaleTicks(20)).toEqual([4, 8, 12, 16, 20]);
  });
});
