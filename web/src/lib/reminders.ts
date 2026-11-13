// Reminders on the phone. They are scheduled on the device itself from the
// locally stored schedule, so they fire with no connection to the server.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { addDays, dateTimeOf, formatTime, fromDateStr, today } from './dates';
import { dueOn, indexDoses, supplyOf, unitLabel, type DueItem } from './logic';
import { dispatch, getSnapshot, subscribe } from './store';
import type { Dose } from './types';
import { updateWidget } from './widget';

export const isNative = Capacitor.isNativePlatform();

const CHANNEL = 'doses';
const ACTION_TYPE = 'DOSE';
const HORIZON_DAYS = 14;
// Android keeps at most 500 alarms per app; stay well under it. The soonest are kept.
const MAX_NOTIFICATIONS = 400;
const SNOOZE_MINUTES = 10;
const LOW_STOCK_ID = 1;
const TEST_ID = 2;
const SNOOZE_KEY = 'rxmindly.snoozes';

type Kind = 0 | 1 | 2; // first reminder, follow-up, snooze

interface Snooze {
  doseId: string;
  at: number;
}

const FIRST_DOSE_ID = 1000;

/**
 * Each dose gets its own notification, so its id comes from the dose id
 * (a string) and the kind. Android wants a positive 32-bit int, so this is a
 * hash (FNV-1a); with a few hundred live reminders a clash is vanishingly rare.
 */
function notificationId(doseId: string, kind: Kind): number {
  let h = 0x811c9dc5;
  for (const ch of `${doseId}|${kind}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return FIRST_DOSE_ID + ((h >>> 0) % (0x7fffffff - FIRST_DOSE_ID));
}

/** Doses that still want a reminder: not yet recorded, and with a known time. */
const pendingOn = (date: string, state = getSnapshot().state, doses = indexDoses(state)) =>
  dueOn(state, date, doses).filter((item) => !item.dose && !item.estimated);

/**
 * Takes dose reminders that no longer apply out of the notification shade:
 * ones from earlier days (those doses now count as missed) and ones whose
 * doses have since been taken or skipped. It can only run while the app is
 * running, so yesterday's reminders go when the app is next opened.
 */
async function clearStaleReminders() {
  const { state } = getSnapshot();
  const doses = indexDoses(state);
  const start = today();
  const startOfToday = fromDateStr(start).getTime();
  const live = new Set<number>();
  for (const date of [addDays(start, -1), start]) {
    for (const item of pendingOn(date, state, doses)) {
      // Yesterday's only still count if they came due after midnight (a late follow-up dose).
      if (item.at.getTime() < startOfToday) continue;
      for (const kind of [0, 1, 2] as Kind[]) live.add(notificationId(item.doseId, kind));
    }
  }
  const delivered = await LocalNotifications.getDeliveredNotifications();
  const stale = delivered.notifications.filter((n) => n.id >= FIRST_DOSE_ID && !live.has(n.id));
  if (stale.length) await LocalNotifications.removeDeliveredNotifications({ notifications: stale });
}

const loadSnoozes = (): Snooze[] => {
  try {
    return (JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '[]') as Snooze[]).filter((s) => s.doseId && s.at > Date.now());
  } catch {
    return [];
  }
};
const saveSnoozes = (list: Snooze[]) => localStorage.setItem(SNOOZE_KEY, JSON.stringify(list));

function describe(item: DueItem) {
  return {
    title: `Time for ${item.med.name}`,
    body: [item.med.strength, unitLabel(item.med, item.qty)].filter(Boolean).join(' · '),
  };
}

function build(): LocalNotificationSchema[] {
  const { state, settings } = getSnapshot();
  const doses = indexDoses(state);
  const now = Date.now();
  const start = today();
  const snoozes = loadSnoozes();
  const out: LocalNotificationSchema[] = [];

  const add = (item: DueItem, kind: Kind, at: Date, prefix = '') => {
    if (at.getTime() <= now) return;
    const text = describe(item);
    out.push({
      id: notificationId(item.doseId, kind),
      title: prefix + text.title,
      body: [formatTime(item.time), text.body].filter(Boolean).join(' · '),
      summaryText: formatTime(item.time),
      schedule: { at, allowWhileIdle: true },
      channelId: CHANNEL,
      actionTypeId: ACTION_TYPE,
      extra: { date: item.date, doseId: item.doseId },
    });
  };

  // One notification per dose. Starts from yesterday: a follow-up dose to a
  // late-evening dose can come due after midnight. A follow-up dose gets its
  // reminder once the dose before it is recorded and its time is known.
  for (let i = -1; i < HORIZON_DAYS; i++) {
    for (const item of pendingOn(addDays(start, i), state, doses)) {
      add(item, 0, item.at);
      if (settings.followUpMinutes > 0) {
        add(item, 1, new Date(item.at.getTime() + settings.followUpMinutes * 60_000), 'Still waiting: ');
      }
      const snooze = snoozes.find((s) => s.doseId === item.doseId);
      if (snooze) add(item, 2, new Date(snooze.at));
    }
  }
  out.sort((a, b) => a.schedule!.at!.getTime() - b.schedule!.at!.getTime());
  out.splice(MAX_NOTIFICATIONS - 1); // leaves room for the low-stock reminder

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
  await updateWidget().catch((err) => console.error('widget', err));
  await clearStaleReminders().catch((err) => console.error('clearing reminders', err));
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }
  if (!token || !settings.reminders) return;
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
  const notifications = build();
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}

function takeDose(date: string, doseId: string) {
  const item = pendingOn(date).find((i) => i.doseId === doseId);
  if (!item) return; // already recorded
  dispatch({
    type: 'dose.put',
    dose: {
      id: item.doseId,
      medId: item.med.id,
      scheduleId: item.schedule.id,
      date,
      time: item.time,
      status: 'taken',
      qty: item.qty,
      takenAt: new Date().toISOString(),
    } satisfies Dose,
  });
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
          { id: 'take', title: 'Mark taken' },
          { id: 'snooze', title: `Remind me in ${SNOOZE_MINUTES} min` },
        ],
      },
    ],
  });
  await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    const { date, doseId } = (event.notification.extra ?? {}) as { date?: string; doseId?: string };
    if (!date) return;
    if (doseId && event.actionId === 'take') {
      takeDose(date, doseId);
    } else if (doseId && event.actionId === 'snooze') {
      saveSnoozes([
        ...loadSnoozes().filter((s) => s.doseId !== doseId),
        { doseId, at: Date.now() + SNOOZE_MINUTES * 60_000 },
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
