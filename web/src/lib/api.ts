import type { AppState, Op } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the server couldn't be reached at all. */
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ServerStatus {
  app: string;
  version: string;
  /** Missing on servers older than 1.1.2. */
  instanceId?: string;
  setupRequired: boolean;
  signupAllowed: boolean;
}

export interface Session {
  token: string;
  username: string;
}

export interface SyncResult {
  username: string;
  state: AppState;
  rejected?: { index: number; error: string }[];
}

async function request<T>(serverUrl: string, path: string, options: { method?: string; body?: unknown; token?: string | null; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // On Android, fetch goes through Capacitor's native HTTP, which may ignore the abort
  // signal; racing a timer makes sure an address that never answers is given up on.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, options.timeoutMs ?? 15_000);
  });
  let res: Response;
  try {
    res = await Promise.race([
      fetch(serverUrl + path, {
        method: options.method ?? (options.body ? 'POST' : 'GET'),
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      }),
      timeout,
    ]);
  } catch {
    throw new ApiError("Can't reach the server", 0);
  } finally {
    clearTimeout(timer);
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* not JSON: handled below */
  }
  if (!res.ok) {
    const message = (payload as { error?: string } | null)?.error ?? `The server answered with an error (${res.status})`;
    throw new ApiError(message, res.status);
  }
  if (payload == null) throw new ApiError("That address doesn't look like a Rxmindly server", 0);
  return payload as T;
}

export const api = {
  status: (server: string, timeoutMs?: number) => request<ServerStatus>(server, '/api/status', { timeoutMs }),
  login: (server: string, username: string, password: string) =>
    request<Session>(server, '/api/login', { body: { username, password } }),
  setup: (server: string, username: string, password: string) =>
    request<Session>(server, '/api/setup', { body: { username, password } }),
  logout: (server: string, token: string) => request<unknown>(server, '/api/logout', { method: 'POST', token }),
  sync: (server: string, token: string, ops: Op[]) => request<SyncResult>(server, '/api/sync', { body: { ops }, token }),
  changePassword: (server: string, token: string, current: string, next: string) =>
    request<unknown>(server, '/api/password', { body: { current, next }, token }),
  exportAll: (server: string, token: string) => request<unknown>(server, '/api/export', { token }),
};

/**
 * Finds the server behind whatever the user typed ("192.168.1.20:8080",
 * "meds.example.com"). Without a scheme, https is tried first, then http.
 */
export const cleanAddress = (input: string) => input.trim().replace(/\/+$/, '');

export async function findServer(input: string, timeoutMs?: number): Promise<{ url: string; status: ServerStatus }> {
  const trimmed = cleanAddress(input);
  if (!trimmed) throw new ApiError('Enter your server address', 0);
  const candidates = /^https?:\/\//i.test(trimmed) ? [trimmed] : [`https://${trimmed}`, `http://${trimmed}`];
  let lastError: unknown;
  for (const url of candidates) {
    try {
      const status = await api.status(url, timeoutMs);
      if (status.app !== 'rxmindly') throw new ApiError("That address doesn't look like a Rxmindly server", 0);
      return { url, status };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
