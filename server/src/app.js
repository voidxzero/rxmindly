import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { openDb, transaction } from './db.js';
import {
  LoginLimiter,
  burnPasswordCheck,
  createSession,
  deleteOtherSessions,
  deleteSession,
  findSession,
  hashPassword,
  verifyPassword,
} from './auth.js';
import { applyOps, exportAll, getState } from './store.js';

const VERSION = '1.0.0';
const MAX_BODY = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolveBody({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
        resolveBody(body);
      } catch {
        reject(new HttpError(400, 'Request body must be a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

function credentials(body) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  return { username, password };
}

function checkNewAccount({ username, password }) {
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) {
    throw new HttpError(400, 'Username must be 2–40 letters, numbers, dots, dashes or underscores');
  }
  checkNewPassword(password);
}

function checkNewPassword(password) {
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (password.length > 200) throw new HttpError(400, 'Password is too long');
}

export function createApp({ dbPath, staticDir, allowSignup = false, trustProxy = false }) {
  const db = openDb(dbPath);
  const limiter = new LoginLimiter();
  const staticRoot = staticDir ? resolve(staticDir) : null;

  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  const clientAddress = (req) => {
    if (trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const authenticate = (req) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = findSession(db, token);
    if (!session) throw new HttpError(401, 'Please sign in');
    return session;
  };

  const routes = {
    'GET /api/status': () => {
      const users = userCount();
      return { app: 'rxmindly', version: VERSION, setupRequired: users === 0, signupAllowed: users === 0 || allowSignup };
    },

    // Creates the first account. Closed afterwards unless signup is enabled.
    'POST /api/setup': async (req) => {
      const body = credentials(await readJson(req));
      checkNewAccount(body);
      const hash = hashPassword(body.password);
      const userId = transaction(db, () => {
        if (userCount() > 0 && !allowSignup) throw new HttpError(403, 'This server already has an account');
        if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) {
          throw new HttpError(409, 'That username is taken');
        }
        const result = db
          .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
          .run(body.username, hash, new Date().toISOString());
        return Number(result.lastInsertRowid);
      });
      return { token: createSession(db, userId), username: body.username };
    },

    'POST /api/login': async (req) => {
      const address = clientAddress(req);
      if (limiter.blocked(address)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      const { username, password } = credentials(await readJson(req));
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      let ok = false;
      if (user) ok = verifyPassword(password, user.password_hash);
      else burnPasswordCheck(password);
      if (!ok) {
        limiter.fail(address);
        throw new HttpError(401, 'Wrong username or password');
      }
      limiter.reset(address);
      return { token: createSession(db, user.id), username: user.username };
    },

    'POST /api/logout': (req) => {
      deleteSession(db, authenticate(req).tokenHash);
      return { ok: true };
    },

    'POST /api/password': async (req) => {
      const session = authenticate(req);
      const body = await readJson(req);
      const current = typeof body.current === 'string' ? body.current : '';
      const next = typeof body.next === 'string' ? body.next : '';
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId);
      if (!verifyPassword(current, user.password_hash)) throw new HttpError(403, 'Current password is wrong');
      checkNewPassword(next);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
      deleteOtherSessions(db, user.id, session.tokenHash);
      return { ok: true };
    },

    'GET /api/state': (req) => {
      const session = authenticate(req);
      return { username: session.username, state: getState(db, session.userId) };
    },

    'POST /api/sync': async (req) => {
      const session = authenticate(req);
      const body = await readJson(req);
      const ops = Array.isArray(body.ops) ? body.ops : [];
      if (ops.length > 5000) throw new HttpError(400, 'Too many changes in one request');
      const rejected = transaction(db, () => applyOps(db, session.userId, ops));
      return { username: session.username, rejected, state: getState(db, session.userId) };
    },

    'GET /api/export': (req) => {
      const session = authenticate(req);
      return exportAll(db, session.userId);
    },
  };

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  function serveStatic(req, res, pathname) {
    if (!staticRoot || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (decoded.includes('\0')) return false;
    let file = resolve(join(staticRoot, normalize(decoded)));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) return false;
    const isFile = (p) => existsSync(p) && statSync(p).isFile();
    if (!isFile(file)) {
      // Unknown paths without an extension are app routes: hand back the shell.
      if (extname(decoded)) return false;
      file = join(staticRoot, 'index.html');
      if (!isFile(file)) return false;
    }
    const ext = extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': statSync(file).size,
      'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
    return true;
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );

    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) {
        const handler = routes[`${req.method} ${pathname}`];
        if (!handler) throw new HttpError(404, 'Not found');
        sendJson(res, 200, await handler(req));
      } else if (!serveStatic(req, res, pathname)) {
        throw new HttpError(404, 'Not found');
      }
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      sendJson(res, 500, { error: 'Something went wrong on the server' });
    }
  });

  server.on('close', () => db.close());
  return server;
}
