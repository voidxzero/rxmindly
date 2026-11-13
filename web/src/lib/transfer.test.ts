import { describe, expect, test } from 'vitest';
import { parseCsv, parseTable, toCsv } from './csv';
import { applyOp } from './logic';
import { dosesCsv, journalCsv, medicinesCsv, parseSchedules, planImport, refillsCsv, schedulesToText } from './transfer';
import { EMPTY_STATE, type AppState, type Med } from './types';

const TODAY = '2026-11-12';
const run = (state: AppState, text: string) => {
  const plan = planImport(text, state, TODAY);
  return { plan, state: plan.ops.reduce(applyOp, state) };
};

const med: Med = {
  id: 'm1',
  name: 'Lisinopril',
  strength: '10 mg',
  form: 'tablet',
  color: 'blue',
  icon: 'round',
  instructions: 'With food, "always"',
  prescriber: '',
  pharmacy: '',
  rxNumber: '',
  stock: 28,
  lowDays: 7,
  refillsLeft: 2,
  asNeeded: false,
  archivedAt: null,
  schedules: [{ id: 's1', time: '08:00', qty: 1, days: '0123456', startDate: '2026-11-01', endDate: null, followUps: [{ afterMinutes: 240, qty: 2 }] }],
};

describe('csv', () => {
  test('survives commas, quotes and line breaks', () => {
    const rows = [['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', '']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsv('﻿a,b\r\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('text that looks like a formula is defused on the way out and restored on the way in', () => {
    const state = applyOp(EMPTY_STATE, { type: 'med.put', med: { ...med, name: '=SUM(A1)' } });
    const csv = medicinesCsv(state);
    expect(csv).toContain("'=SUM(A1)");
    expect(parseTable(csv).rows[0].name).toBe('=SUM(A1)');
  });
});

describe('schedules as text', () => {
  test('round-trip, and most of it can be left out', () => {
    expect(schedulesToText(med.schedules)).toBe('08:00 x1 daily +240m x2 #s1');
    expect(parseSchedules('08:00 x1 daily +240m x2 #s1', TODAY)).toEqual([{ ...med.schedules[0], startDate: TODAY }]);
    expect(parseSchedules('8:00; 20:30 x2 Mon-Wed-Fri', TODAY).map((s) => [s.time, s.qty, s.days])).toEqual([['08:00', 1, '0123456'], ['20:30', 2, '135']]);
    expect(() => parseSchedules('breakfast')).toThrow();
    expect(() => parseSchedules('08:00 sometimes')).toThrow();
  });
});

describe('import', () => {
  test('a hand-written medicines file adds medicines; importing it again changes nothing', () => {
    const file = 'name,strength,times,stock\nMetformin,500 mg,"08:00; 20:00 x2 weekdays",60\nAlbuterol,,,\nMystery,,breakfast,\n,,08:00,\n';
    const first = run(EMPTY_STATE, file);
    expect(first.plan.kind).toBe('medicines');
    expect(first.plan.problems.length).toBe(2);
    expect(first.state.meds.map((m) => [m.name, m.asNeeded, m.stock, m.schedules.length])).toEqual([['Albuterol', true, null, 0], ['Metformin', false, 60, 2]]);
    const again = run(first.state, file);
    expect(again.state.meds).toEqual(first.state.meds);
    expect(again.plan.summary[0]).toContain('updated');
  });

  test('every export can be imported back into an empty account', () => {
    let s = applyOp(EMPTY_STATE, { type: 'med.put', med });
    s = applyOp(s, { type: 'dose.put', dose: { id: 's1:2026-11-10', medId: 'm1', scheduleId: 's1', date: '2026-11-10', time: '08:00', status: 'taken', qty: 1, takenAt: '2026-11-10T13:02:00.000Z' } });
    s = applyOp(s, { type: 'refill.add', refill: { id: 'r1', medId: 'm1', date: '2026-11-09', qty: 30, note: '90-day, new pharmacy' }, useRefill: true });
    s = applyOp(s, { type: 'question.put', question: { id: 'q1', text: 'How was my pain?', archived: false } });
    s = applyOp(s, { type: 'journal.put', entry: { date: '2026-11-10', answers: { mood: 4, q1: 2 }, note: 'Fine, mostly.\nSecond line.' } });

    let copy = run(EMPTY_STATE, medicinesCsv(s)).state;
    copy = run(copy, dosesCsv(s)).state;
    copy = run(copy, refillsCsv(s)).state;
    const journal = run(copy, journalCsv(s));
    copy = journal.state;

    expect(copy.meds).toEqual([{ ...s.meds[0], schedules: [{ ...med.schedules[0], startDate: TODAY }] }]);
    expect(copy.doses).toEqual(s.doses);
    expect(copy.refills).toEqual(s.refills);
    // The custom question is new here, so it gets a new id; the answers follow it.
    expect(journal.plan.summary.join(' ')).toContain('How was my pain?');
    const q = copy.questions.find((x) => x.text === 'How was my pain?')!;
    expect(copy.journal).toEqual([{ date: '2026-11-10', answers: { mood: 4, [q.id]: 2 }, note: 'Fine, mostly.\nSecond line.' }]);

    // And the one-file backup restores everything exactly, pill counts included.
    const restored = run(EMPTY_STATE, JSON.stringify({ exportedAt: 'x', ...s }));
    expect(restored.plan.kind).toBe('backup');
    expect(restored.state).toEqual(s);
    expect(run(restored.state, JSON.stringify(s)).state).toEqual(s);
  });

  test('dose history needs its medicine, and never changes the pill count', () => {
    const s = applyOp(EMPTY_STATE, { type: 'med.put', med });
    const file = 'medicine,date,time,status\nLisinopril,2026-11-01,8:05,taken\nlisinopril,2026-11-02,08:00,skipped\nAspirin,2026-11-02,08:00,taken\nLisinopril,soon,08:00,taken\n';
    const { plan, state } = run(s, file);
    expect(plan.kind).toBe('doses');
    expect(plan.problems.length).toBe(2);
    expect(state.doses.map((d) => [d.date, d.time, d.status])).toEqual([['2026-11-01', '08:05', 'taken'], ['2026-11-02', '08:00', 'skipped']]);
    expect(state.meds[0].stock).toBe(28);
    expect(run(state, file).state.doses.length).toBe(2);
  });

  test('files that make no sense are refused outright', () => {
    expect(() => planImport('colour,shape\nred,round\n', EMPTY_STATE)).toThrow();
    expect(() => planImport('{"hello": 1}', EMPTY_STATE)).toThrow();
    expect(() => planImport('name\n', EMPTY_STATE)).toThrow();
  });
});
