// Alarm-style reminders: the pure rules. A full-screen alarm rings at a time
// of day and shows every medicine due then, so doses that share a time become
// one alarm. The native side (AlarmPlugin.java and friends) rings it; the
// screen it shows is components/AlarmScreen.tsx; reminders.ts schedules them.

import type { DueItem } from './logic';

/** One medicine on an alarm. A snapshot, so the screen can show it even before the app's data has loaded. */
export interface AlarmItem {
  /** The dose id (`<scheduleId>:<date>[:n]`). Test alarms use `test:<n>`. */
  id: string;
  date: string;
  time: string;
  name: string;
  detail: string;
  /** For the pill picture; missing on a test alarm. */
  medId?: string;
}

/** Everything due at one moment. */
export interface AlarmSlot {
  /** Epoch milliseconds. */
  at: number;
  items: AlarmItem[];
}

export interface Snooze {
  doseId: string;
  at: number;
}

export const isTestItem = (item: Pick<AlarmItem, 'id'>) => item.id.startsWith('test:');

/**
 * The alarms to set for doses still to take: one per moment, however many
 * medicines share it. A dose that was snoozed also rings at its snooze time
 * (joining any other snoozed doses set for the same moment). Moments already
 * past are dropped, and the soonest `limit` are kept.
 */
export function alarmSlots(
  pending: DueItem[],
  describe: (item: DueItem) => Pick<AlarmItem, 'name' | 'detail' | 'medId'>,
  snoozes: Snooze[],
  now: number,
  limit = 150,
): AlarmSlot[] {
  const slots = new Map<number, AlarmItem[]>();
  const add = (at: number, item: DueItem) => {
    if (at <= now) return;
    const list = slots.get(at) ?? [];
    if (!list.some((i) => i.id === item.doseId)) list.push({ id: item.doseId, date: item.date, time: item.time, ...describe(item) });
    slots.set(at, list);
  };
  for (const item of pending) {
    add(item.at.getTime(), item);
    const snooze = snoozes.find((s) => s.doseId === item.doseId);
    if (snooze) add(snooze.at, item);
  }
  return [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([at, items]) => ({ at, items }));
}

/** What the lock screen notification says: the medicines, however many. */
export function alarmSummary(items: Pick<AlarmItem, 'name'>[]): string {
  const names = items.map((i) => i.name);
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
