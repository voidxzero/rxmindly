// The full-screen alarm as the web side sees it: setting alarms, silencing the
// sound, and what is on screen right now. The native side is AlarmPlugin.java,
// AlarmService.java and AlarmReceiver.java in web/android/app/src/main/java/app/rxmindly/.
// In a browser none of this exists and every call does nothing.

import { useSyncExternalStore } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { AlarmItem, AlarmSlot } from './alarms';

/** The alarm waiting to be answered. `ringing` is false once its sound has been stopped (or timed out). */
export interface ActiveAlarm {
  items: AlarmItem[];
  ringing: boolean;
}

interface RxAlarmPlugin {
  schedule(options: { alarms: AlarmSlot[]; sound: boolean; vibrate: boolean; silenceMinutes: number }): Promise<void>;
  test(options: { items: AlarmItem[]; delaySeconds: number }): Promise<void>;
  getActive(): Promise<ActiveAlarm>;
  stopSound(): Promise<void>;
  dismiss(): Promise<void>;
  status(): Promise<{ fullScreen: boolean }>;
  openFullScreenSettings(): Promise<void>;
  addListener(event: 'alarm', handler: (active: ActiveAlarm) => void): Promise<{ remove: () => Promise<void> }>;
}

const native = Capacitor.isNativePlatform();
const RxAlarm = registerPlugin<RxAlarmPlugin>('RxAlarm');

let active: ActiveAlarm = { items: [], ringing: false };
const listeners = new Set<() => void>();
const set = (next: ActiveAlarm) => {
  active = { items: next.items ?? [], ringing: !!next.ringing };
  listeners.forEach((l) => l());
};

/** True while an alarm is waiting to be answered. */
export const hasActiveAlarm = () => active.items.length > 0;

export const useActiveAlarm = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => active,
  );

const refresh = () => RxAlarm.getActive().then(set).catch(() => {});

/** Picks up an alarm that went off while the app wasn't open, and follows changes from then on. */
export function initAlarm() {
  if (!native) return;
  void refresh();
  void RxAlarm.addListener('alarm', set);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
}

export const alarmNative = {
  schedule: (options: Parameters<RxAlarmPlugin['schedule']>[0]) => (native ? RxAlarm.schedule(options) : Promise.resolve()),
  test: (items: AlarmItem[], delaySeconds = 10) => (native ? RxAlarm.test({ items, delaySeconds }) : Promise.resolve()),
  stopSound: () => {
    set({ ...active, ringing: false });
    return native ? RxAlarm.stopSound() : Promise.resolve();
  },
  /** Every medicine is answered: the sound, the notification and the screen all go. */
  dismiss: () => {
    set({ items: [], ringing: false });
    return native ? RxAlarm.dismiss() : Promise.resolve();
  },
  /** False when Android has switched off full-screen alarms for this app. */
  fullScreenAllowed: () => (native ? RxAlarm.status().then((s) => s.fullScreen).catch(() => true) : Promise.resolve(true)),
  openFullScreenSettings: () => (native ? RxAlarm.openFullScreenSettings() : Promise.resolve()),
};
