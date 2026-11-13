import { useEffect, useState } from 'react';
import { Bell, Check, Download, KeyRound, LogOut, Plus, RefreshCw, Trash2, Upload, Wifi, X } from 'lucide-react';
import { QuestionInput } from '../components/JournalInput';
import { Field, Sheet } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatClock, today } from '../lib/dates';
import { DEFAULT_QUESTIONS, SCALE_SIZES, customQuestions, defaultIsOn } from '../lib/journal';
import { dosesCsv, importKindLabel, journalCsv, medicinesCsv, planImport, refillsCsv, type ImportPlan } from '../lib/transfer';
import { saveFile } from '../lib/save-file';
import { EMPTY_STATE, type AppState } from '../lib/types';
import { checkForUpdate, installUpdate, updateAvailable, useUpdates } from '../lib/updates';
import { uid } from '../lib/logic';
import { isNative, reminderPermission, requestReminderPermission, sendTestReminder, type ReminderPermission } from '../lib/reminders';
import { activeUrl, checkAddress, dispatch, serverHasFeature, setBackupUrl, signOut, sync, updateSettings, useStore, withServer, type AddressCheck } from '../lib/store';

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

  /** Saves a file to the computer or phone. The data comes fresh from the server, with the whole history. */
  const exportData = async (kind: 'backup' | 'medicines' | 'doses' | 'journal' | 'refills') => {
    setMessage('');
    try {
      const data = await withServer((url) => api.exportAll(url, snap.token!));
      const state: AppState = { ...EMPTY_STATE, ...(data as Partial<AppState>) };
      const csv = { medicines: medicinesCsv, doses: dosesCsv, journal: journalCsv, refills: refillsCsv };
      const saved =
        kind === 'backup'
          ? await saveFile(`rxmindly-${today()}.json`, 'application/json', JSON.stringify(data, null, 2))
          : // The byte-order mark tells spreadsheets the file is UTF-8, so accented names survive.
            await saveFile(`rxmindly-${kind}-${today()}.csv`, 'text/csv', '\uFEFF' + csv[kind](state));
      if (saved && isNative) setMessage('Saved.');
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

      {isNative && <AppUpdates />}

      <section className="card">
        <h2 className="card-title">Your server</h2>
        {isNative && <ServerAddresses />}
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
            {(snap.settings.reminders || snap.settings.journalReminder) && permission !== 'granted' && (
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
            <label className="check">
              <input
                type="checkbox"
                checked={snap.settings.journalReminder}
                onChange={(e) => {
                  updateSettings({ journalReminder: e.target.checked });
                  if (e.target.checked && permission !== 'granted') void requestReminderPermission().then(setPermission);
                }}
              />
              <span>Send me a gentle nudge to write in my journal</span>
            </label>
            {snap.settings.journalReminder && (
              <Field label="Every day at" hint="A little reminder to check in with yourself. If you’ve already written that day, it stays quiet.">
                <input
                  className="input"
                  type="time"
                  value={snap.settings.journalReminderTime}
                  onChange={(e) => e.target.value && updateSettings({ journalReminderTime: e.target.value })}
                />
              </Field>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Sounds</h2>
        <label className="check">
          <input type="checkbox" checked={snap.settings.sounds} onChange={(e) => updateSettings({ sounds: e.target.checked })} />
          <span>Play little sounds when I take, skip or refill a medicine</span>
        </label>
      </section>

      <JournalQuestions />

      <section className="card">
        <h2 className="card-title">Your data</h2>
        <>
            <p className="muted card-sub">Save a copy to this {isNative ? 'phone' : 'computer'}. The CSV files open in any spreadsheet; the full backup holds everything in one file.</p>
            <div className="export-grid">
              <button className="btn" onClick={() => void exportData('medicines')}>
                <Upload size={18} /> Medicines
              </button>
              <button className="btn" onClick={() => void exportData('doses')}>
                <Upload size={18} /> Doses
              </button>
              <button className="btn" onClick={() => void exportData('journal')}>
                <Upload size={18} /> Journal
              </button>
              <button className="btn" onClick={() => void exportData('refills')}>
                <Upload size={18} /> Refills
              </button>
            </div>
            <button className="btn block" onClick={() => void exportData('backup')}>
              <Upload size={18} /> Full backup
            </button>
        </>
        <label className="btn block file-btn">
          <Download size={18} /> Import a file
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

/** Android only: the main address, the optional local one, and which is in use. */
function ServerAddresses() {
  const snap = useStore();
  const [backup, setBackup] = useState(snap.backupUrl);
  const inUse = activeUrl(snap);
  const changed = backup.trim().replace(/\/+$/, '') !== snap.backupUrl;
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<{ label: string; address: string; result: AddressCheck }[] | null>(null);
  // Tests what's typed in the local box, so an address can be tried before saving it.
  const test = async () => {
    const targets = [{ label: 'Main', address: snap.serverUrl }];
    if (backup.trim()) targets.push({ label: 'Local', address: backup.trim() });
    setTesting(true);
    setResults(null);
    setResults(await Promise.all(targets.map(async (t) => ({ ...t, result: await checkAddress(t.address) }))));
    setTesting(false);
  };
  return (
    <>
      <dl className="facts">
        <div>
          <dt>Main address</dt>
          <dd>
            {snap.serverUrl}
            {snap.backupUrl && inUse === snap.serverUrl && <span className="muted"> · in use</span>}
          </dd>
        </div>
        {snap.backupUrl && (
          <div>
            <dt>Local address</dt>
            <dd>
              {snap.backupUrl}
              {inUse === snap.backupUrl && <span className="muted"> · in use</span>}
            </dd>
          </div>
        )}
      </dl>
      <Field label="Local address (optional)" hint="Used when the main address can’t be reached, such as your server’s address on your home Wi-Fi.">
        <div className="add-question">
          <input className="input" value={backup} onChange={(e) => setBackup(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="192.168.1.20:8060" />
          <button className="btn" disabled={!changed} onClick={() => setBackupUrl(backup)}>
            {backup.trim() ? 'Save' : 'Remove'}
          </button>
        </div>
      </Field>
      <button className="btn" onClick={() => void test()} disabled={testing}>
        <Wifi size={18} /> {testing ? 'Testing…' : 'Test connection'}
      </button>
      {results && (
        <ul className="plain-list connection-results" aria-live="polite">
          {results.map(({ label, address, result }) => (
            <li className="row" key={label}>
              <span>
                {label} <span className="muted">· {address}</span>
              </span>
              <span className={`status-text ${result.ok ? 'taken' : 'missed'}`}>
                {result.ok ? <Check size={16} /> : <X size={16} />} {result.ok ? `Connected · ${result.ms} ms` : result.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Android only: the installed version, whether GitHub has a newer one, and the button that installs it. */
function AppUpdates() {
  const updates = useUpdates();
  const available = updateAvailable(updates);
  const busy = updates.status !== 'idle';
  return (
    <section className="card">
      <h2 className="card-title">App updates</h2>
      <p className="muted card-sub">
        {updates.current ? `You have version ${updates.current}.` : 'Checking which version you have…'}{' '}
        {available ? `Version ${updates.latest} is available.` : updates.latest && !updates.error ? 'That’s the latest.' : ''}
      </p>
      {updates.error && <p className="note warn">{updates.error}</p>}
      {updates.askedPermission && <p className="note ok">Allow Rxmindly to install updates on the screen that just opened, come back, and tap the button again.</p>}
      {available && (
        <button className="btn primary block" onClick={() => void installUpdate()} disabled={busy}>
          <Download size={18} />
          {updates.status === 'downloading' ? (updates.progress != null ? `Downloading… ${Math.round(updates.progress * 100)}%` : 'Downloading…') : `Update to ${updates.latest}`}
        </button>
      )}
      <button className="btn block" onClick={() => void checkForUpdate(true)} disabled={busy}>
        <RefreshCw size={18} /> {updates.status === 'checking' ? 'Checking…' : 'Check for updates'}
      </button>
    </section>
  );
}

/** Which questions the daily journal asks: the built-in ones can be switched off, and you can add your own. */
function JournalQuestions() {
  const { state, settings } = useStore();
  const max = settings.journalScale;
  const index = Math.max(0, SCALE_SIZES.indexOf(max as (typeof SCALE_SIZES)[number]));
  // Anything but numbers 1–5 saves decimals, which servers before 1.2.1 refuse; check before offering it.
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    void serverHasFeature('journal-decimals').then(setSupported);
  }, []);
  const locked = supported !== true && max === 5 && settings.journalScaleKind === 'numbers';
  // The preview's answer lives only here; nothing is saved.
  const [sample, setSample] = useState<number | null>(4);
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
      <p className="muted card-sub">What the journal asks each day, and how you answer.</p>
      <div className="field">
        <span className="field-label">Answer with</span>
        <div className="segmented" role="radiogroup" aria-label="Answer with">
          {(['numbers', 'slider'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={settings.journalScaleKind === kind}
              className={settings.journalScaleKind === kind ? 'on' : ''}
              disabled={locked && kind === 'slider'}
              onClick={() => updateSettings({ journalScaleKind: kind })}
            >
              {kind === 'numbers' ? 'Numbers' : 'A slider'}
            </button>
          ))}
        </div>
      </div>
      <Field
        label={`Scale: 1 to ${max}`}
        hint={
          settings.journalScaleKind === 'slider'
            ? 'The slider shows no numbers. This is the scale your charts use.'
            : 'Every question runs from 1 (low) to this number (high). Changing it keeps your past answers; they’re just shown on the new scale.'
        }
      >
        <input
          type="range"
          className="scale-picker"
          min={0}
          max={SCALE_SIZES.length - 1}
          step={1}
          value={index}
          disabled={locked}
          list="scale-sizes"
          aria-valuetext={`1 to ${max}`}
          onChange={(e) => updateSettings({ journalScale: SCALE_SIZES[Number(e.target.value)] })}
        />
        <datalist id="scale-sizes">
          {SCALE_SIZES.map((n, i) => (
            <option key={n} value={i} />
          ))}
        </datalist>
        <div className="scale-picker-labels" aria-hidden="true">
          {SCALE_SIZES.map((n) => (
            <span key={n} className={n === max ? 'on' : ''}>
              1–{n}
            </span>
          ))}
        </div>
      </Field>
      <div className="field">
        <span className="field-label">Preview</span>
        <div className="scale-preview">
          <QuestionInput
            key={`${settings.journalScaleKind}-${max}`}
            question={{ ...DEFAULT_QUESTIONS[0], id: 'preview' }}
            value={sample}
            max={max}
            slider={settings.journalScaleKind === 'slider'}
            onAnswer={setSample}
          />
        </div>
      </div>
      {locked && supported === false && <p className="note warn">Other scales and the slider need your server updated to the latest version first.</p>}
      {locked && supported === null && <p className="note warn">Can’t reach your server to check it supports other scales. Try again when it’s back.</p>}
      <h3 className="section-title">Questions</h3>
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
      await withServer((url) => api.changePassword(url, snap.token!, current, next));
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
