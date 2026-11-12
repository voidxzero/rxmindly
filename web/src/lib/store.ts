import { useSyncExternalStore } from 'react';
import { ApiError, api, type Session } from './api';
import { applyOp } from './logic';
import { EMPTY_STATE, type AppState, type Op } from './types';

export interface Settings {
  reminders: boolean;
  /** Minutes before a second nudge for pills still not taken; 0 turns it off. */
  followUpMinutes: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface Snapshot {
  serverUrl: string;
  token: string | null;
  username: string;
  /** Server data with any not-yet-synced changes already applied. */
  state: AppState;
  /** Changes waiting to reach the server, oldest first. */
  outbox: Op[];
  settings: Settings;
  lastSyncAt: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  /** True once this device has loaded the account's data at least once. */
  loaded: boolean;
}

const STORAGE_KEY = 'rxmindly';
const DEFAULT_SETTINGS: Settings = { reminders: true, followUpMinutes: 30 };

function load(): Snapshot {
  const base: Snapshot = {
    serverUrl: '',
    token: null,
    username: '',
    state: EMPTY_STATE,
    outbox: [],
    settings: DEFAULT_SETTINGS,
    lastSyncAt: null,
    syncStatus: 'idle',
    syncError: null,
    loaded: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      return {
        ...base,
        ...saved,
        // Data saved by an older version of the app has no journal yet.
        state: { ...EMPTY_STATE, ...saved.state },
        settings: { ...DEFAULT_SETTINGS, ...saved.settings },
        syncStatus: 'idle',
        syncError: null,
      };
    }
  } catch {
    /* unreadable storage: start fresh */
  }
  return base;
}

let snapshot = load();
const listeners = new Set<() => void>();

function set(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  try {
    const { syncStatus: _s, syncError: _e, ...persisted } = snapshot;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* storage full or blocked: keep working from memory */
  }
  listeners.forEach((l) => l());
}

export const getSnapshot = () => snapshot;

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useStore = () => useSyncExternalStore(subscribe, getSnapshot);

// ---------------------------------------------------------------------------
// Sync

let syncing: Promise<void> | null = null;
let syncAgain = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

export function syncSoon(delayMs = 400) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void sync(), delayMs);
}

export function sync(): Promise<void> {
  if (!snapshot.token) return Promise.resolve();
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = runSync().finally(() => {
    syncing = null;
    if (syncAgain) {
      syncAgain = false;
      syncSoon(0);
    }
  });
  return syncing;
}

async function runSync() {
  const { serverUrl, token } = snapshot;
  if (!token) return;
  const sending = snapshot.outbox;
  set({ syncStatus: 'syncing' });
  try {
    const result = await api.sync(serverUrl, token, sending);
    if (snapshot.token !== token) return; // signed out while this was in flight
    // Anything queued while the request was in flight is replayed on top of the fresh copy.
    const remaining = snapshot.outbox.slice(sending.length);
    set({
      state: remaining.reduce(applyOp, { ...EMPTY_STATE, ...result.state }),
      outbox: remaining,
      username: result.username,
      lastSyncAt: new Date().toISOString(),
      syncStatus: 'idle',
      syncError: null,
      loaded: true,
    });
  } catch (err) {
    if (snapshot.token !== token) return;
    if (err instanceof ApiError && err.status === 401) {
      // The session ended (password changed, or signed out elsewhere). Local
      // changes stay queued and go up after signing back in.
      set({ token: null, syncStatus: 'idle', syncError: null });
    } else if (err instanceof ApiError && err.status === 0) {
      set({ syncStatus: 'offline', syncError: err.message });
    } else {
      set({ syncStatus: 'error', syncError: err instanceof Error ? err.message : 'Sync failed' });
    }
  }
}

// ---------------------------------------------------------------------------
// Actions

/** Records a change: the screen updates at once, the server catches up. */
export function dispatch(...ops: Op[]) {
  if (!ops.length) return;
  set({ state: ops.reduce(applyOp, snapshot.state), outbox: [...snapshot.outbox, ...ops] });
  syncSoon();
}

export function signIn(serverUrl: string, session: Session) {
  const sameAccount =
    snapshot.serverUrl === serverUrl && snapshot.username.toLowerCase() === session.username.toLowerCase();
  set({
    serverUrl,
    token: session.token,
    username: session.username,
    // A different account must never inherit this device's cached data or queue.
    ...(sameAccount ? {} : { state: EMPTY_STATE, outbox: [], loaded: false, lastSyncAt: null }),
  });
  return sync();
}

export async function signOut() {
  const { serverUrl, token } = snapshot;
  set({ token: null, username: '', state: EMPTY_STATE, outbox: [], loaded: false, lastSyncAt: null, syncStatus: 'idle', syncError: null });
  if (token) await api.logout(serverUrl, token).catch(() => {});
}

export function updateSettings(patch: Partial<Settings>) {
  set({ settings: { ...snapshot.settings, ...patch } });
}
