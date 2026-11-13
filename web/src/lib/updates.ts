// Updating the Android app from its GitHub releases. The web app needs none of
// this: it is always whatever the server is serving.
//
// A release is a git tag like "v1.2.0" with the built APK attached (see
// .github/workflows/release.yml). The app asks GitHub for the latest release
// when it opens or comes back into view, and offers it if it is newer.

import { useSyncExternalStore } from 'react';
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Where releases are published. */
export const UPDATE_REPO = 'voidxzero/rxmindly';

const MIN_GAP_MS = 5 * 60_000;

interface UpdaterPlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  install(options: { url: string }): Promise<void>;
  addListener(event: 'progress', handler: (p: { received: number; total: number }) => void): Promise<PluginListenerHandle>;
}
const Updater = registerPlugin<UpdaterPlugin>('Updater');

export interface UpdateState {
  /** The version installed on this phone. */
  current: string | null;
  /** The newest version on GitHub, once a check has succeeded. */
  latest: string | null;
  notes: string;
  assetUrl: string | null;
  status: 'idle' | 'checking' | 'downloading';
  /** 0–1 while downloading, when the size is known. */
  progress: number | null;
  error: string | null;
  checkedAt: number | null;
  /** True after Android's "allow installing from this app" screen was opened; the user taps update again afterwards. */
  askedPermission: boolean;
}

let state: UpdateState = { current: null, latest: null, notes: '', assetUrl: null, status: 'idle', progress: null, error: null, checkedAt: null, askedPermission: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const useUpdates = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

/** "1.10.0" is newer than "1.9.3": compares number by number, not as text. */
export function isNewer(candidate: string, than: string): boolean {
  const parts = (v: string) => v.replace(/^v/, '').split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(candidate);
  const b = parts(than);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export const updateAvailable = (s: UpdateState) => s.current != null && s.latest != null && s.assetUrl != null && isNewer(s.latest, s.current);

interface Release {
  tag_name?: string;
  body?: string;
  assets?: { name: string; url: string }[];
}

/** Asks GitHub for the latest release. `force` skips the "checked a moment ago" guard (the button in Settings). */
export async function checkForUpdate(force = false) {
  if (!Capacitor.isNativePlatform() || state.status !== 'idle') return;
  if (!force && state.checkedAt && Date.now() - state.checkedAt < MIN_GAP_MS) return;
  set({ status: 'checking', error: null });
  try {
    const current = state.current ?? (await App.getInfo()).version;
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) throw new Error('No release found.');
    if (!res.ok) throw new Error(`GitHub answered with an error (${res.status}).`);
    const release = (await res.json()) as Release;
    const apk = release.assets?.find((a) => a.name.endsWith('.apk'));
    set({ current, latest: (release.tag_name ?? '').replace(/^v/, '') || null, notes: release.body ?? '', assetUrl: apk?.url ?? null, status: 'idle', checkedAt: Date.now() });
  } catch (err) {
    set({ status: 'idle', checkedAt: Date.now(), error: err instanceof TypeError ? 'Couldn’t reach GitHub.' : err instanceof Error ? err.message : 'The check failed.' });
  }
}

/** Downloads the new version and opens Android's installer. */
export async function installUpdate() {
  if (!updateAvailable(state) || state.status !== 'idle') return;
  try {
    if (!(await Updater.canInstall()).allowed) {
      // Android asks once per app. The user allows it there, comes back, and taps update again.
      await Updater.openInstallSettings();
      set({ askedPermission: true });
      return;
    }
    set({ status: 'downloading', progress: null, error: null, askedPermission: false });
    const handle = await Updater.addListener('progress', (p) => set({ progress: p.total > 0 ? p.received / p.total : null }));
    try {
      await Updater.install({ url: state.assetUrl! });
    } finally {
      void handle.remove();
    }
    set({ status: 'idle', progress: null });
  } catch (err) {
    set({ status: 'idle', progress: null, error: err instanceof Error ? err.message : 'The update failed.' });
  }
}

/** Checks when the app opens and each time it comes back into view. There is no background timer. */
export function initUpdates() {
  if (!Capacitor.isNativePlatform()) return;
  void App.getInfo().then((info) => set({ current: info.version }));
  void checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
}
