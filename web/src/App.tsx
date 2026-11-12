import { useEffect, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { ChartNoAxesColumn, CloudOff, LayoutGrid, NotebookPen, Pill, Settings as SettingsIcon } from 'lucide-react';
import { handleBack } from './components/ui';
import { today } from './lib/dates';
import { initReminders, isNative, requestReminderPermission } from './lib/reminders';
import { sync, useStore } from './lib/store';
import { Cabinet } from './screens/Cabinet';
import { History } from './screens/History';
import { Journal } from './screens/Journal';
import { Login } from './screens/Login';
import { Organizer } from './screens/Organizer';
import { Settings, syncSummary } from './screens/Settings';

type Tab = 'organizer' | 'cabinet' | 'journal' | 'history' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof Pill }[] = [
  { id: 'organizer', label: 'Organizer', icon: LayoutGrid },
  { id: 'cabinet', label: 'Cabinet', icon: Pill },
  { id: 'journal', label: 'Journal', icon: NotebookPen },
  { id: 'history', label: 'History', icon: ChartNoAxesColumn },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

// Set by a tapped reminder before React is listening.
let openDay: (date: string) => void = () => {};
void initReminders((date) => openDay(date));

export function App() {
  const snap = useStore();
  const [tab, setTab] = useState<Tab>('organizer');
  const [date, setDate] = useState(today());
  const [addNew, setAddNew] = useState(false);
  const signedIn = snap.token != null;

  useEffect(() => {
    openDay = (d) => {
      setDate(d);
      setTab('organizer');
    };
    return () => {
      openDay = () => {};
    };
  }, []);

  // If the app is left open overnight, follow "today" into the new day.
  const lastToday = useRef(today());
  useEffect(() => {
    const roll = () => {
      const now = today();
      if (now === lastToday.current) return;
      setDate((d) => (d === lastToday.current ? now : d));
      lastToday.current = now;
    };
    const timer = setInterval(roll, 30_000);
    document.addEventListener('visibilitychange', roll);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', roll);
    };
  }, []);

  // Keep in step with the server: on open, on return, when the network comes back, and every minute.
  useEffect(() => {
    if (!signedIn) return;
    void sync();
    const onVisible = () => document.visibilityState === 'visible' && void sync();
    const onOnline = () => void sync();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => document.visibilityState === 'visible' && void sync(), 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, [signedIn]);

  useEffect(() => {
    if (signedIn && isNative && snap.settings.reminders) void requestReminderPermission();
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isNative) return;
    const listener = NativeApp.addListener('backButton', () => {
      if (handleBack()) return;
      if (tab !== 'organizer') setTab('organizer');
      else void NativeApp.minimizeApp();
    });
    return () => void listener.then((l) => l.remove());
  }, [tab]);

  if (!signedIn) return <Login />;

  const summary = syncSummary(snap);
  const trouble = snap.syncStatus === 'offline' || snap.syncStatus === 'error';

  return (
    <div className="app">
      <nav className="nav" aria-label="Main">
        <div className="nav-brand">
          <img src="./icon.svg" alt="" width={32} height={32} />
          <span>Rxmindly</span>
        </div>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-item${tab === id ? ' on' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon size={24} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <main className="main">
        {trouble && (
          <button className="offline-bar" onClick={() => void sync()}>
            <CloudOff size={18} />
            <span>{summary.text} Tap to retry.</span>
          </button>
        )}
        {!snap.loaded && snap.syncStatus === 'syncing' ? (
          <p className="quiet-note loading">Opening your cabinet…</p>
        ) : (
          <>
            {tab === 'organizer' && (
              <Organizer
                date={date}
                onDate={setDate}
                onOpenCabinet={(add) => {
                  setAddNew(!!add);
                  setTab('cabinet');
                }}
              />
            )}
            {tab === 'cabinet' && <Cabinet addNew={addNew} onAddNewHandled={() => setAddNew(false)} />}
            {tab === 'journal' && <Journal />}
            {tab === 'history' && <History />}
            {tab === 'settings' && <Settings />}
          </>
        )}
      </main>
    </div>
  );
}
