import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError, api } from './api';
import { activeUrl, changeServerUrl, dispatch, getSnapshot, signIn, signOut, withServer } from './store';

const MAIN = 'https://meds.example.com';
const LOCAL = '192.168.1.20:8060';
const ID = 'a'.repeat(32);

/** A pretend network: which addresses answer, and what server id each reports. */
let reachable: Record<string, string | undefined> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      const origin = url.origin;
      if (!(origin in reachable)) throw new TypeError('Failed to fetch');
      if (url.pathname === '/api/status') return json({ app: 'rxmindly', version: '1.1.2', instanceId: reachable[origin], setupRequired: false, signupAllowed: false });
      if (url.pathname === '/api/sync') return json({ username: 'me', state: { meds: [], doses: [], refills: [], questions: [], journal: [] } });
      return json({ ok: true });
    }),
  );
});
afterEach(async () => {
  reachable = {};
  await signOut();
  vi.unstubAllGlobals();
});

const start = async (useBackup = false) => {
  reachable = { [MAIN]: ID, 'http://192.168.1.20:8060': ID };
  await signIn({ serverUrl: MAIN, backupUrl: LOCAL, useBackup, instanceId: ID }, { token: 't', username: 'me' });
};

describe('main and local address', () => {
  test('when the main address is unreachable, the local one is used and remembered', async () => {
    await start();
    delete reachable[MAIN];
    const seen: string[] = [];
    await withServer(async (url) => {
      seen.push(url);
      return api.sync(url, 't', []);
    });
    expect(seen).toEqual([MAIN, 'http://192.168.1.20:8060']);
    expect(getSnapshot().useBackup).toBe(true);
    expect(getSnapshot().backupUrl).toBe('http://192.168.1.20:8060');
    expect(activeUrl()).toBe('http://192.168.1.20:8060');

    // Away from home again: back to the main address.
    reachable = { [MAIN]: ID };
    await withServer((url) => api.sync(url, 't', []));
    expect(activeUrl()).toBe(MAIN);
  });

  test('a refusal from the server is not a reason to switch', async () => {
    await start();
    const call = vi.fn(async () => {
      throw new ApiError('Please sign in again', 401);
    });
    await expect(withServer(call)).rejects.toMatchObject({ status: 401 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(getSnapshot().useBackup).toBe(false);
  });

  test('the token never goes to a device that is not this server', async () => {
    await start();
    // On someone else's Wi-Fi, the "local address" is a stranger's device.
    reachable = { 'http://192.168.1.20:8060': 'b'.repeat(32) };
    const call = vi.fn((url: string) => api.sync(url, 't', []));
    await expect(withServer(call)).rejects.toMatchObject({ status: 0 });
    expect(call.mock.calls.map((c) => c[0])).toEqual([MAIN]);

    // An older server that reports no id is refused too.
    reachable = { 'http://192.168.1.20:8060': undefined };
    call.mockClear();
    await expect(withServer(call)).rejects.toMatchObject({ status: 0 });
    expect(call.mock.calls.map((c) => c[0])).toEqual([MAIN]);
  });

  test('signing in again through the other address keeps unsent changes', async () => {
    await start();
    reachable = {}; // offline, so the change stays queued
    dispatch({ type: 'journal.put', entry: { date: '2026-11-13', answers: { mood: 4 }, note: '' } });
    await signIn({ serverUrl: 'meds.example.com', backupUrl: 'http://192.168.1.20:8060', useBackup: true, instanceId: ID }, { token: 't2', username: 'me' });
    expect(getSnapshot().outbox.length).toBe(1);
    expect(getSnapshot().state.journal.length).toBe(1);
  });
});

describe('changing the main address', () => {
  test('a new address for the same server is saved, with its scheme worked out', async () => {
    await start();
    reachable['http://203.0.113.5:8060'] = ID;
    expect(await changeServerUrl('203.0.113.5:8060/')).toBeNull();
    expect(getSnapshot().serverUrl).toBe('http://203.0.113.5:8060');
    expect(getSnapshot().token).toBe('t');
  });

  test('a different server, or nothing answering, is refused and changes nothing', async () => {
    await start();
    reachable['https://stranger.example.com'] = 'b'.repeat(32);
    expect(await changeServerUrl('stranger.example.com')).toMatch(/isn’t yours/);
    expect(await changeServerUrl('nowhere.example.com')).toMatch(/reach/);
    expect(getSnapshot().serverUrl).toBe(MAIN);
  });
});
