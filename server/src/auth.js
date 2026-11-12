import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const SESSION_IDLE_DAYS = 365;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, n, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    ...SCRYPT,
    N: Number(n),
  });
  return timingSafeEqual(actual, expected);
}

// Used so a login for an unknown username costs the same as a real one.
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));
export function burnPasswordCheck(password) {
  verifyPassword(password, DUMMY_HASH);
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), userId, now, now);
  return token;
}

export function findSession(db, token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT s.token_hash, s.last_used_at, u.id AS user_id, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(tokenHash);
  if (!row) return null;
  const idleMs = Date.now() - Date.parse(row.last_used_at);
  if (idleMs > SESSION_IDLE_DAYS * 86400_000) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  if (idleMs > 3600_000) {
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').run(
      new Date().toISOString(),
      tokenHash,
    );
  }
  return { userId: row.user_id, username: row.username, tokenHash };
}

export function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteOtherSessions(db, userId, keepTokenHash) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, keepTokenHash);
}

/** Sliding-window limiter for failed logins, keyed by client address. */
export class LoginLimiter {
  constructor({ max = 10, windowMs = 15 * 60_000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.failures = new Map();
  }

  #recent(key) {
    const cutoff = Date.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  blocked(key) {
    return this.#recent(key).length >= this.max;
  }

  fail(key) {
    const list = this.#recent(key);
    list.push(Date.now());
    this.failures.set(key, list);
  }

  reset(key) {
    this.failures.delete(key);
  }
}
