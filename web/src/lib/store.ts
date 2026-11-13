import { useSyncExternalStore } from 'react';
import { ApiError, api, type Session } from './api';
import { applyOp } from './logic';
import { EMPTY_STATE, type AppState, type Op } from './types';

export interface Settings {
  reminders: boolean;
  /** Minutes before a second nudge for pills still not taken; 0 turns it off. */
  followUpMinutes: number;
  /** Only needed to update the Android app when its GitHub repository is private. Kept on this device. */
  githubToken: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface Snapshot {
  /** The main server address. Usually one that works from anywhere. */
  serverUrl: string;
  /** Optional second address for the same server, typically its home-network IP. Tried when the main one can't be reached. */
  backupUrl: string;
  /** True when the backup address is the one that worked last, so it is tried first. */
  useBackup: boolean;
  /** The server's own id (from /api/status). The token is only ever sent to an address that reports this same id. */
  instanceId: string;
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
const MAX_OPS_PER_SYNC = 1000;
const MAX_BYTES_PER_SYNC = 500_000;

/** The oldest waiting changes that fit in one request (always at least one). */
function firstBatch(outbox: Op[]): Op[] {
  let bytes = 0;
  let n = 0;
  while (n < outbox.length && n < MAX_OPS_PER_SYNC) {
    bytes += JSON.stringify(outbox[n]).length * 2;
    if (n > 0 && bytes > MAX_BYTES_PER_SYNC) break;
    n += 1;
  }
  return outbox.slice(0, n);
}
const DEFAULT_SETTINGS: Settings = { reminders: true, followUpMinutes: 30, githubToken: '' };

function load(): Snapshot {
  const base: Snapshot = {
    serverUrl: '',
    backupUrl: '',
    useBackup: false,
    instanceId: '',
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

// ---------------------------------------------------------------------------
// Which address to use

const PROBE_MS = 4000;
const hasScheme = (url: string) => /^https?:\/\//i.test(url);

/** The address requests go to right now. */
export const activeUrl = (s: Snapshot = snapshot) => (s.useBackup && s.backupUrl ? s.backupUrl : s.serverUrl);
const otherUrl = (s: Snapshot) => (!s.backupUrl ? '' : s.useBackup ? s.serverUrl : s.backupUrl);

/**
 * Checks that an address leads to this same server, and returns it with its
 * scheme worked out. Returns null for anything else: an unknown id, an older
 * server that doesn't report one, or nothing answering. This is what keeps the
 * token from going to a stranger's device that happens to have the home
 * network's IP on some other Wi-Fi.
 */
async function sameServer(address: string): Promise<string | null> {
  const id = snapshot.instanceId;
  if (!id || !address) return null;
  const candidates = hasScheme(address) ? [address] : [`https://${address}`, `http://${address}`];
  for (const url of candidates) {
    try {
      const status = await api.status(url, PROBE_MS);
      if (status.app === 'rxmindly' && status.instanceId === id) return url;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/**
 * Runs a request against the server, falling back to the other address when the
 * one in use can't be reached at all. Only "can't reach it" switches: a refusal
 * such as an expired sign-in comes from the real server and is passed on as is.
 */
export async function withServer<T>(call: (url: string) => Promise<T>): Promise<T> {
  const before = snapshot;
  try {
    const result = await call(activeUrl(before));
    if (!snapshot.instanceId && !before.useBackup) void learnInstanceId(before.serverUrl);
    return result;
  } catch (err) {
    const other = otherUrl(before);
    if (!other || !(err instanceof ApiError && err.status === 0)) throw err;
    const url = await sameServer(other);
    if (!url) throw err;
    const result = await call(url);
    // Remember which one works, with its scheme filled in.
    const toBackup = other === before.backupUrl;
    set(toBackup ? { useBackup: true, backupUrl: url } : { useBackup: false, serverUrl: url });
    return result;
  }
}

/**
 * Accounts signed in before servers had an id learn it from the main address,
 * the one the user signed in through, so the backup address can be used later.
 */
async function learnInstanceId(url: string) {
  try {
    const status = await api.status(url, PROBE_MS);
    if (status.app === 'rxmindly' && status.instanceId && snapshot.serverUrl === url && !snapshot.instanceId) set({ instanceId: status.instanceId });
  } catch {
    /* next time */
  }
}

/** Sets or clears the backup address from Settings, without signing out. */
export function setBackupUrl(address: string) {
  set({ backupUrl: address.trim().replace(/\/+$/, ''), useBackup: false });
}

async function runSync() {
  const { token } = snapshot;
  if (!token) return;
  // A big import goes up in batches the server will accept.
  const sending = firstBatch(snapshot.outbox);
  set({ syncStatus: 'syncing' });
  try {
    const result = await withServer((url) => api.sync(url, token, sending));
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
    if (remaining.length) syncAgain = true;
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

export interface SignInPlace {
  /** The main address, as entered or with its scheme worked out. */
  serverUrl: string;
  backupUrl: string;
  /** True when sign-in went through the backup address. */
  useBackup: boolean;
  instanceId: string;
}

export function signIn(place: SignInPlace, session: Session) {
  const sameServerAsBefore =
    place.instanceId && snapshot.instanceId
      ? place.instanceId === snapshot.instanceId
      : [snapshot.serverUrl, snapshot.backupUrl].filter(Boolean).includes(place.useBackup ? place.backupUrl : place.serverUrl);
  const sameAccount = sameServerAsBefore && snapshot.username.toLowerCase() === session.username.toLowerCase();
  set({
    ...place,
    token: session.token,
    username: session.username,
    // A different account must never inherit this device's cached data or queue.
    ...(sameAccount ? {} : { state: EMPTY_STATE, outbox: [], loaded: false, lastSyncAt: null }),
  });
  return sync();
}

export async function signOut() {
  const url = activeUrl();
  const { token } = snapshot;
  set({ token: null, username: '', state: EMPTY_STATE, outbox: [], loaded: false, lastSyncAt: null, syncStatus: 'idle', syncError: null });
  if (token) await api.logout(url, token).catch(() => {});
}

export function updateSettings(patch: Partial<Settings>) {
  set({ settings: { ...snapshot.settings, ...patch } });
}
