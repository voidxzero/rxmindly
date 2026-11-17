// The full-screen medicine alarm, like the Clock app's but showing what to take.
// Every medicine due at that time is listed with its own Taken, Skip and Snooze
// buttons. "Stop alarm" only silences the sound and vibration. The screen stays
// until every medicine has been answered, which is when the alarm is dismissed.

import { useEffect, useMemo, useState } from 'react';
import { BellOff, Check, Clock, SkipForward, Undo2 } from 'lucide-react';
import { alarmNative, useActiveAlarm } from '../lib/alarm-native';
import { isTestItem, type AlarmItem } from '../lib/alarms';
import { formatTime } from '../lib/dates';
import { haptics } from '../lib/haptics';
import { indexDoses } from '../lib/logic';
import { cancelSnooze, loadSnoozes, recordDose, snoozeDoses } from '../lib/reminders';
import { sounds } from '../lib/sounds';
import { dispatch, useStore } from '../lib/store';
import { PillMark } from './ui';

type Answer = 'taken' | 'skipped' | 'snoozed';

export function AlarmScreen() {
  const active = useActiveAlarm();
  const snap = useStore();
  const { state, settings } = snap;
  // Answers to the made-up alarm from Settings, which isn't recorded anywhere.
  const [tests, setTests] = useState<Record<string, Answer>>({});
  // Snoozes are saved, so they're read back; this makes the screen read them again after a change.
  const [, bump] = useState(0);
  const doses = useMemo(() => indexDoses(state), [state]);
  const snoozed = new Set(loadSnoozes().map((s) => s.doseId));
  const snooze = settings.alarmSnoozeMinutes;

  const answerOf = (item: AlarmItem): Answer | null => {
    if (isTestItem(item)) return tests[item.id] ?? null;
    const dose = doses.get(item.id);
    if (dose?.status === 'taken' || dose?.status === 'skipped') return dose.status === 'taken' ? 'taken' : 'skipped';
    return snoozed.has(item.id) ? 'snoozed' : null;
  };

  const items = active.items;
  const open = items.filter((i) => !answerOf(i));
  const done = items.length > 0 && open.length === 0;
  // The doses were already recorded some other way, or the last answer was just given: the alarm is over.
  useEffect(() => {
    if (!done) return;
    setTests({});
    void alarmNative.dismiss();
  }, [done]);

  if (!items.length) return null;

  const time = items.map((i) => i.time).sort()[0];
  const answer = (item: AlarmItem, what: 'taken' | 'skipped') => {
    if (isTestItem(item)) setTests((t) => ({ ...t, [item.id]: what }));
    else recordDose(item.date, item.id, what);
    if (what === 'taken') {
      sounds.take();
      haptics.take();
    } else {
      sounds.skip();
      haptics.skip();
    }
  };
  const snoozeThese = (list: AlarmItem[]) => {
    const real = list.filter((i) => !isTestItem(i));
    const fake = list.filter(isTestItem);
    if (real.length) snoozeDoses(real.map((i) => i.id), snooze);
    if (fake.length) {
      setTests((t) => ({ ...t, ...Object.fromEntries(fake.map((i) => [i.id, 'snoozed' as const])) }));
      void alarmNative.test(fake, snooze * 60);
    }
    haptics.skip();
    bump((n) => n + 1);
  };
  const undo = (item: AlarmItem) => {
    const was = answerOf(item);
    if (isTestItem(item)) {
      setTests((t) => {
        const { [item.id]: _gone, ...rest } = t;
        return rest;
      });
      return;
    }
    if (was === 'snoozed') cancelSnooze(item.id);
    else dispatch({ type: 'dose.delete', id: item.id });
    sounds.undo();
    haptics.undo();
    bump((n) => n + 1);
  };

  return (
    <div className="alarm-screen" role="alertdialog" aria-modal="true" aria-labelledby="alarm-title">
      <div className="alarm-top">
        <p className="alarm-time">{formatTime(time)}</p>
        <h1 id="alarm-title" className="alarm-title">
          Time to take your medicine
        </h1>
        <p className="alarm-sub">
          {open.length === 1 ? '1 medicine left to answer' : `${open.length} medicines left to answer`}
        </p>
      </div>

      <ul className="alarm-list">
        {items.map((item) => {
          const state_ = answerOf(item);
          const med = item.medId ? state.meds.find((m) => m.id === item.medId) : undefined;
          return (
            <li key={item.id} className={`alarm-item${state_ ? ` answered ${state_}` : ''}`}>
              <div className="alarm-item-head">
                <PillMark med={med ?? { color: 'teal', form: 'tablet', icon: '' }} hollow={!!state_ && state_ !== 'snoozed'} />
                <div className="alarm-item-text">
                  <strong>{item.name}</strong>
                  {item.detail && <span>{item.detail}</span>}
                </div>
              </div>
              {state_ ? (
                <div className="alarm-answered">
                  <span className="alarm-chip">
                    {state_ === 'taken' && (
                      <>
                        <Check size={18} strokeWidth={3} /> Taken
                      </>
                    )}
                    {state_ === 'skipped' && (
                      <>
                        <SkipForward size={18} /> Skipped
                      </>
                    )}
                    {state_ === 'snoozed' && (
                      <>
                        <Clock size={18} /> Snoozed {snooze} min
                      </>
                    )}
                  </span>
                  <button type="button" className="alarm-undo" onClick={() => undo(item)} aria-label={`Undo for ${item.name}`}>
                    <Undo2 size={18} /> Undo
                  </button>
                </div>
              ) : (
                <div className="alarm-buttons">
                  <button type="button" className="alarm-btn take" onClick={() => answer(item, 'taken')}>
                    <Check size={20} strokeWidth={3} /> Taken
                  </button>
                  <button type="button" className="alarm-btn" onClick={() => answer(item, 'skipped')}>
                    <SkipForward size={20} /> Skip
                  </button>
                  <button type="button" className="alarm-btn" onClick={() => snoozeThese([item])}>
                    <Clock size={20} /> Snooze
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="alarm-foot">
        {open.length > 1 && (
          <button type="button" className="alarm-btn wide" onClick={() => snoozeThese(open)}>
            <Clock size={20} /> Snooze all {snooze} min
          </button>
        )}
        {active.ringing ? (
          <button type="button" className="alarm-stop" onClick={() => void alarmNative.stopSound()}>
            <BellOff size={22} /> Stop alarm
          </button>
        ) : (
          <p className="alarm-quiet">Alarm stopped. Answer each medicine to close this screen.</p>
        )}
      </div>
    </div>
  );
}
