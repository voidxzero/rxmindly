// Reminders on the phone. They are scheduled on the device itself from the
// locally stored schedule, so they fire with no connection to the server.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { addDays, dateTimeOf, formatTime, fromDateStr, today } from './dates';
import { dueOn, groupByTime, indexDoses, supplyOf, unitLabel, type DueItem } from './logic';
import { dispatch, getSnapshot, subscribe } from './store';
import type { Dose } from './types';

export const isNative = Capacitor.isNativePlatform();

const CHANNEL = 'doses';
const ACTION_TYPE = 'DOSE';
const HORIZON_DAYS = 14;
const MAX_NOTIFICATIONS = 200;
const SNOOZE_MINUTES = 10;
const LOW_STOCK_ID = 1;
const TEST_ID = 2;
const SNOOZE_KEY = 'mediminder.snoozes';

type Kind = 0 | 1 | 2; // first reminder, follow-up, snooze

interface Snooze {
  date: string;
  time: string;
  at: number;
}

function notificationId(date: string, time: string, kind: Kind): number {
  const day = Math.round((fromDateStr(date).getTime() - new Date(2024, 0, 1).getTime()) / 86400_000);
  const [h, m] = time.split(':').map(Number);
  return 1000 + (day % 100000) * 14400 + (h * 60 + m) * 10 + kind;
}

const loadSnoozes = (): Snooze[] => {
  try {
    return (JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '[]') as Snooze[]).filter((s) => s.at > Date.now());
  } catch {
    return [];
  }
};
const saveSnoozes = (list: Snooze[]) => localStorage.setItem(SNOOZE_KEY, JSON.stringify(list));

function describe(items: DueItem[]) {
  const lines = items.map((i) => `${i.med.name}${i.med.strength ? ` ${i.med.strength}` : ''} · ${unitLabel(i.med, i.qty)}`);
  return {
    title: items.length === 1 ? `Time for ${items[0].med.name}` : `${items.length} medicines to take`,
    body: items.length === 1 ? lines[0].split(' · ').slice(1).join(' · ') || lines[0] : lines.join(', '),
    largeBody: lines.join('\n'),
  };
}

function build(): LocalNotificationSchema[] {
  const { state, settings } = getSnapshot();
  const doses = indexDoses(state);
  const now = Date.now();
  const start = today();
  const snoozes = loadSnoozes();
  const out: LocalNotificationSchema[] = [];

  const add = (date: string, time: string, kind: Kind, at: Date, items: DueItem[], prefix = '') => {
    if (at.getTime() <= now || out.length >= MAX_NOTIFICATIONS) return;
    const text = describe(items);
    out.push({
      id: notificationId(date, time, kind),
      title: prefix + text.title,
      body: `${formatTime(time)} · ${text.body}`,
      largeBody: text.largeBody,
      summaryText: formatTime(time),
      schedule: { at, allowWhileIdle: true },
      channelId: CHANNEL,
      actionTypeId: ACTION_TYPE,
      extra: { date, time },
    });
  };

  // Starts from yesterday: a follow-up dose to a late-evening dose can come due after midnight.
  for (let i = -1; i < HORIZON_DAYS; i++) {
    const date = addDays(start, i);
    for (const slot of groupByTime(dueOn(state, date, doses))) {
      // A follow-up dose gets its reminder once the dose before it is recorded and its time is known.
      const pending = slot.items.filter((item) => !item.dose && !item.estimated);
      if (!pending.length) continue;
      const due = pending[0].at;
      add(date, slot.time, 0, due, pending);
      if (settings.followUpMinutes > 0) {
        add(date, slot.time, 1, new Date(due.getTime() + settings.followUpMinutes * 60_000), pending, 'Still waiting: ');
      }
      const snooze = snoozes.find((s) => s.date === date && s.time === slot.time);
      if (snooze) add(date, slot.time, 2, new Date(snooze.at), pending);
    }
  }

  const low = state.meds.filter((m) => !m.archivedAt && supplyOf(m, state).level !== 'ok');
  if (low.length) {
    const at = dateTimeOf(addDays(start, 1), '09:00');
    out.push({
      id: LOW_STOCK_ID,
      title: low.length === 1 ? `${low[0].name} is running low` : `${low.length} medicines are running low`,
      body: low
        .map((m) => {
          const s = supplyOf(m, state);
          return `${m.name}: ${s.level === 'out' ? 'none left' : s.daysLeft != null ? `${s.daysLeft} days left` : `${s.stock} left`}`;
        })
        .join(', '),
      schedule: { at, allowWhileIdle: true },
      channelId: CHANNEL,
    });
  }
  return out;
}

let queue: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Replaces every scheduled reminder with a fresh set built from the current data. */
export function rescheduleReminders() {
  if (!isNative) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    queue = queue.then(reschedule).catch((err) => console.error('reminders', err));
  }, 500);
}

async function reschedule() {
  const { token, settings } = getSnapshot();
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }
  if (!token || !settings.reminders) return;
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
  const notifications = build();
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}

function takeSlot(date: string, time: string) {
  const { state } = getSnapshot();
  const items = dueOn(state, date, indexDoses(state)).filter((i) => i.time === time && !i.dose && !i.estimated);
  dispatch(
    ...items.map((item) => ({
      type: 'dose.put' as const,
      dose: {
        id: item.doseId,
        medId: item.med.id,
        scheduleId: item.schedule.id,
        date,
        time,
        status: 'taken',
        qty: item.qty,
        takenAt: new Date().toISOString(),
      } satisfies Dose,
    })),
  );
}

export async function initReminders(onOpenDay: (date: string) => void) {
  if (!isNative) return;
  await LocalNotifications.createChannel({
    id: CHANNEL,
    name: 'Medicine reminders',
    description: 'When it is time to take your medicine',
    importance: 5,
    visibility: 1,
    vibration: true,
  });
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: ACTION_TYPE,
        actions: [
          { id: 'take', title: 'Mark all taken' },
          { id: 'snooze', title: `Remind me in ${SNOOZE_MINUTES} min` },
        ],
      },
    ],
  });
  await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    const { date, time } = (event.notification.extra ?? {}) as { date?: string; time?: string };
    if (!date || !time) return;
    if (event.actionId === 'take') {
      takeSlot(date, time);
    } else if (event.actionId === 'snooze') {
      saveSnoozes([
        ...loadSnoozes().filter((s) => !(s.date === date && s.time === time)),
        { date, time, at: Date.now() + SNOOZE_MINUTES * 60_000 },
      ]);
      rescheduleReminders();
    }
    onOpenDay(date);
  });

  let last = getSnapshot();
  subscribe(() => {
    const next = getSnapshot();
    if (next.state !== last.state || next.settings !== last.settings || next.token !== last.token) rescheduleReminders();
    last = next;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rescheduleReminders();
  });
  rescheduleReminders();
}

export type ReminderPermission = 'granted' | 'denied' | 'ask';

export async function reminderPermission(): Promise<ReminderPermission> {
  if (!isNative) return 'denied';
  const { display } = await LocalNotifications.checkPermissions();
  return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'ask';
}

export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (!isNative) return 'denied';
  const { display } = await LocalNotifications.requestPermissions();
  rescheduleReminders();
  return display === 'granted' ? 'granted' : 'denied';
}

export async function sendTestReminder() {
  await LocalNotifications.schedule({
    notifications: [
      {
        id: TEST_ID,
        title: 'Reminders are working',
        body: 'This is what a medicine reminder looks like.',
        schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
        channelId: CHANNEL,
      },
    ],
  });
}
