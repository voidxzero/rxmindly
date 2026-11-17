import { describe, expect, it } from 'vitest';
import { alarmSlots, alarmSummary } from './alarms';
import type { DueItem } from './logic';

const item = (doseId: string, time: string, at: number): DueItem =>
  ({ doseId, date: '2026-11-17', time, at: new Date(at), qty: 1, dose: undefined, estimated: false, med: { name: doseId } }) as unknown as DueItem;
const describe_ = (i: DueItem) => ({ name: i.med.name, detail: '' });

describe('alarmSlots', () => {
  it('combines doses due at the same moment into one alarm', () => {
    const slots = alarmSlots([item('a', '08:00', 2000), item('b', '08:00', 2000), item('c', '20:00', 5000)], describe_, [], 1000);
    expect(slots.map((s) => [s.at, s.items.map((i) => i.id)])).toEqual([
      [2000, ['a', 'b']],
      [5000, ['c']],
    ]);
  });

  it('drops moments already past and keeps the soonest ones', () => {
    const slots = alarmSlots([item('a', '08:00', 500), item('b', '09:00', 3000), item('c', '10:00', 2000), item('d', '11:00', 4000)], describe_, [], 1000, 2);
    expect(slots.map((s) => s.at)).toEqual([2000, 3000]);
  });

  it('rings a snoozed dose again, with the other snoozed doses of that moment', () => {
    const items = [item('a', '08:00', 100), item('b', '08:00', 100), item('c', '20:00', 9000)];
    const slots = alarmSlots(items, describe_, [{ doseId: 'a', at: 1900 }, { doseId: 'b', at: 1900 }], 1000);
    expect(slots.map((s) => [s.at, s.items.map((i) => i.id)])).toEqual([
      [1900, ['a', 'b']],
      [9000, ['c']],
    ]);
  });

  it('puts a snoozed dose in the same alarm as a dose already due then', () => {
    const slots = alarmSlots([item('a', '08:00', 100), item('c', '08:15', 1900)], describe_, [{ doseId: 'a', at: 1900 }], 1000);
    expect(slots).toHaveLength(1);
    expect(slots[0].items.map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('alarmSummary', () => {
  it('reads like a sentence', () => {
    expect(alarmSummary([{ name: 'Aspirin' }])).toBe('Aspirin');
    expect(alarmSummary([{ name: 'Aspirin' }, { name: 'Zinc' }])).toBe('Aspirin and Zinc');
    expect(alarmSummary([{ name: 'A' }, { name: 'B' }, { name: 'C' }])).toBe('A, B and C');
  });
});
