// Feeds the Android home screen widget. The widget can't read the web view's
// storage, so each time the data changes the app hands it a short list of the
// doses still to take over the next two weeks; the widget works out "overdue"
// and "next" from that by itself, without the app running.
// The native side is web/android/app/src/main/java/app/rxmindly/NextDoseWidget.java.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { addDays, today } from './dates';
import { dueOn, groupByTime, indexDoses } from './logic';
import { getSnapshot } from './store';

const WidgetBridge = registerPlugin<{ update(options: { data: string }): Promise<void> }>('WidgetBridge');

const HORIZON_DAYS = 14;

export interface WidgetSlot {
  /** When the doses are due, in epoch milliseconds. */
  at: number;
  names: string;
  count: number;
}

/** Every time of day with something still to take, from yesterday (a late follow-up can come due after midnight) on. */
export function widgetSlots(start = today()): WidgetSlot[] {
  const { state } = getSnapshot();
  const doses = indexDoses(state);
  const slots: WidgetSlot[] = [];
  for (let i = -1; i < HORIZON_DAYS; i++) {
    for (const slot of groupByTime(dueOn(state, addDays(start, i), doses))) {
      const pending = slot.items.filter((item) => !item.dose && !item.estimated);
      if (pending.length) slots.push({ at: pending[0].at.getTime(), names: pending.map((p) => p.med.name).join(', '), count: pending.length });
    }
  }
  return slots.sort((a, b) => a.at - b.at);
}

let last = '';

export async function updateWidget() {
  if (!Capacitor.isNativePlatform()) return;
  const signedIn = getSnapshot().token != null;
  const body = JSON.stringify({ signedIn, slots: signedIn ? widgetSlots() : [] });
  if (body === last) return; // nothing the widget shows has changed
  last = body;
  await WidgetBridge.update({ data: JSON.stringify({ generatedAt: Date.now(), ...JSON.parse(body) }) });
}
