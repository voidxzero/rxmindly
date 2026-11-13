import { useEffect, useState } from 'react';
import { Bell, Download, KeyRound, LogOut, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Field, Sheet } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatClock, today } from '../lib/dates';
import { DEFAULT_QUESTIONS, customQuestions, defaultIsOn } from '../lib/journal';
import { dosesCsv, importKindLabel, journalCsv, medicinesCsv, planImport, refillsCsv, type ImportPlan } from '../lib/transfer';
import { EMPTY_STATE, type AppState } from '../lib/types';
import { uid } from '../lib/logic';
import { isNative, reminderPermission, requestReminderPermission, sendTestReminder, type ReminderPermission } from '../lib/reminders';
import { dispatch, signOut, sync, updateSettings, useStore } from '../lib/store';

export function syncSummary(snap: ReturnType<typeof useStore>): { text: string; tone: 'ok' | 'warn' } {
  const waiting = snap.outbox.length;
  const queued = waiting ? ` ${waiting} ${waiting === 1 ? 'change is' : 'changes are'} saved on this device and will be sent when it’s back.` : '';
  if (snap.syncStatus === 'offline') return { text: `Can’t reach your server.${queued}`, tone: 'warn' };
  if (snap.syncStatus === 'error') return { text: `Sync problem: ${snap.syncError}.${queued}`, tone: 'warn' };
  if (snap.syncStatus === 'syncing') return { text: 'Syncing…', tone: 'ok' };
  if (!snap.lastSyncAt) return { text: 'Not synced yet', tone: 'ok' };
  return { text: `Saved to your server at ${formatClock(snap.lastSyncAt)}`, tone: 'ok' };
}

export function Settings() {
  const snap = useStore();
  const [permission, setPermission] = useState<ReminderPermission>('ask');
  const [changingPassword, setChangingPassword] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [message, setMessage] = useState('');
  const summary = syncSummary(snap);

  useEffect(() => {
    void reminderPermission().then(setPermission);
  }, []);

  const [plan, setPlan] = useState<ImportPlan | null>(null);

  /** Saves a file to the computer. The data comes fresh from the server, with the whole history. */
  const exportData = async (kind: 'backup' | 'medicines' | 'doses' | 'journal' | 'refills') => {
    setMessage('');
    try {
      const data = await api.exportAll(snap.serverUrl, snap.token!);
      const state: AppState = { ...EMPTY_STATE, ...(data as Partial<AppState>) };
      const csv = { medicines: medicinesCsv, doses: dosesCsv, journal: journalCsv, refills: refillsCsv };
      const blob = kind === 'backup' ? new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }) : new Blob(['\uFEFF', csv[kind](state)], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = kind === 'backup' ? `rxmindly-${today()}.json` : `rxmindly-${kind}-${today()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const chooseImport = async (file: File | undefined) => {
    setMessage('');
    if (!file) return;
    try {
      setPlan(planImport(await file.text(), snap.state));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That file could not be read.');
    }
  };

  return (
    <div className="screen narrow">
      <header className="screen-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Signed in as {snap.username}</p>
        </div>
      </header>

      <section className="card">
        <h2 className="card-title">Your server</h2>
        {isNative && <p className="muted card-sub">{snap.serverUrl}</p>}
        <p className={`note ${summary.tone}`}>{summary.text}</p>
        <button className="btn" onClick={() => void sync()} disabled={snap.syncStatus === 'syncing'}>
          <RefreshCw size={18} /> Sync now
        </button>
      </section>

      <section className="card">
        <h2 className="card-title">Reminders</h2>
        {!isNative ? (
          <p className="muted">Reminders come from the Rxmindly Android app. Sign in there with this account and your phone will remind you at each scheduled time, even with no connection.</p>
        ) : (
          <>
            <label className="check">
              <input type="checkbox" checked={snap.settings.reminders} onChange={(e) => updateSettings({ reminders: e.target.checked })} />
              <span>Remind me when it’s time to take my medicine</span>
            </label>
            {snap.settings.reminders && permission !== 'granted' && (
              <div className="note warn">
                <p>Notifications are turned off for Rxmindly, so reminders can’t appear.</p>
                <button className="btn small" onClick={() => void requestReminderPermission().then(setPermission)}>
                  <Bell size={18} /> Allow notifications
                </button>
                {permission === 'denied' && <p>If nothing happens, allow notifications for Rxmindly in Android’s Settings → Apps.</p>}
              </div>
            )}
            {snap.settings.reminders && (
              <>
                <Field label="If I haven’t taken it, remind me again after">
                  <select className="input" value={snap.settings.followUpMinutes} onChange={(e) => updateSettings({ followUpMinutes: Number(e.target.value) })}>
                    <option value={0}>Don’t remind again</option>
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                  </select>
                </Field>
                {permission === 'granted' && (
                  <button
                    className="btn"
                    onClick={() => {
                      void sendTestReminder();
                      setMessage('A test reminder will appear in a few seconds.');
                    }}
                  >
                    <Bell size={18} /> Send a test reminder
                  </button>
                )}
              </>
            )}
          </>
        )}
      </section>

      <JournalQuestions />

      <section className="card">
        <h2 className="card-title">Your data</h2>
        {!isNative && (
          <>
            <p className="muted card-sub">Save a copy to this computer. The CSV files open in any spreadsheet; the full backup holds everything in one file.</p>
            <div className="export-grid">
              <button className="btn" onClick={() => void exportData('medicines')}>
                <Download size={18} /> Medicines
              </button>
              <button className="btn" onClick={() => void exportData('doses')}>
                <Download size={18} /> Doses
              </button>
              <button className="btn" onClick={() => void exportData('journal')}>
                <Download size={18} /> Journal
              </button>
              <button className="btn" onClick={() => void exportData('refills')}>
                <Download size={18} /> Refills
              </button>
            </div>
            <button className="btn block" onClick={() => void exportData('backup')}>
              <Download size={18} /> Full backup
            </button>
          </>
        )}
        <label className="btn block file-btn">
          <Upload size={18} /> Import a file
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(e) => {
              void chooseImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <p className="field-hint">Takes any of the files above: a medicines, dose, journal or refill CSV, or a full backup. You’ll see what it will do before anything changes.</p>
      </section>

      <section className="card">
        <h2 className="card-title">Account</h2>
        <div className="action-list">
          <button className="btn block" onClick={() => setChangingPassword(true)}>
            <KeyRound size={18} /> Change password
          </button>
          {!confirmSignOut ? (
            <button className="btn block" onClick={() => setConfirmSignOut(true)}>
              <LogOut size={18} /> Sign out
            </button>
          ) : (
            <div className="confirm">
              <p>
                {snap.outbox.length
                  ? `${snap.outbox.length} ${snap.outbox.length === 1 ? 'change hasn’t' : 'changes haven’t'} reached your server yet and will be lost if you sign out now.`
                  : 'Sign out of this device? Your data stays on your server.'}
              </p>
              <div className="button-row">
                <button className="btn" onClick={() => setConfirmSignOut(false)}>
                  Stay signed in
                </button>
                <button className="btn danger-solid" onClick={() => void signOut()}>
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {message && <p className="note ok" role="status">{message}</p>}
      {plan && (
        <Sheet
          title="Import this file?"
          subtitle={importKindLabel(plan.kind)}
          onClose={() => setPlan(null)}
          footer={
            <button
              className="btn primary block"
              disabled={!plan.ops.length}
              onClick={() => {
                dispatch(...plan.ops);
                setPlan(null);
                setMessage('Imported. It’s on this device now and is being saved to your server.');
              }}
            >
              Import
            </button>
          }
        >
          {plan.summary.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {!plan.ops.length && <p>Nothing in this file can be imported.</p>}
          {plan.problems.length > 0 && (
            <div className="note warn">
              <p>
                {plan.problems.length} {plan.problems.length === 1 ? 'row' : 'rows'} will be left out:
              </p>
              <ul className="problem-list">
                {plan.problems.slice(0, 8).map((p) => (
                  <li key={p}>{p}</li>
                ))}
                {plan.problems.length > 8 && <li>…and {plan.problems.length - 8} more.</li>}
              </ul>
            </div>
          )}
        </Sheet>
      )}
      {changingPassword && (
        <PasswordSheet
          onClose={() => setChangingPassword(false)}
          onDone={() => {
            setChangingPassword(false);
            setMessage('Password changed. Other devices have been signed out.');
          }}
        />
      )}
    </div>
  );
}

/** Which questions the daily journal asks: the built-in ones can be switched off, and you can add your own. */
function JournalQuestions() {
  const { state } = useStore();
  const [text, setText] = useState('');
  const own = customQuestions(state);
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    dispatch({ type: 'question.put', question: { id: uid(), text: text.trim(), archived: false } });
    setText('');
  };
  return (
    <section className="card">
      <h2 className="card-title">Journal questions</h2>
      <p className="muted card-sub">What the journal asks each day. Every question is answered from 1 (low) to 5 (high).</p>
      {DEFAULT_QUESTIONS.map((q) => (
        <label className="check" key={q.id}>
          <input type="checkbox" checked={defaultIsOn(state, q.id)} onChange={(e) => dispatch({ type: 'question.put', question: { id: q.id, text: q.text, archived: !e.target.checked } })} />
          <span>{q.text}</span>
        </label>
      ))}
      {own.length > 0 && (
        <ul className="plain-list">
          {own.map((q) => (
            <li className="row" key={q.id}>
              <span>{q.text}</span>
              <button className="icon-btn" onClick={() => dispatch({ type: 'question.put', question: { id: q.id, text: q.text, archived: true } })} aria-label={`Remove the question “${q.text}”`}>
                <Trash2 size={20} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="add-question" onSubmit={add}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add your own question" maxLength={200} aria-label="A question of your own" />
        <button className="btn" disabled={!text.trim()}>
          <Plus size={18} /> Add
        </button>
      </form>
      <p className="field-hint">Removing a question keeps the answers you already gave; they just stop showing.</p>
    </section>
  );
}

function PasswordSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const snap = useStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setError('The new password needs at least 8 characters.');
    setBusy(true);
    setError('');
    try {
      await api.changePassword(snap.serverUrl, snap.token!, current, next);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password');
      setBusy(false);
    }
  };

  return (
    <Sheet title="Change password" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <Field label="Current password">
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </Sheet>
  );
}
