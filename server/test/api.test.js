import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';

let server;
let base;
let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rxmindly-test-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>shell</title>');
  server = createApp({ dbPath: join(dir, 'test.db'), staticDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

async function call(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const med = (overrides = {}) => ({
  id: 'med-1',
  name: 'Lisinopril',
  strength: '10 mg',
  form: 'tablet',
  color: 'blue',
  stock: 30,
  lowDays: 7,
  refillsLeft: 2,
  asNeeded: false,
  schedules: [{ id: 'sch-1', time: '08:00', qty: 1, days: '0123456', startDate: '2026-01-01', endDate: null }],
  ...overrides,
});

const dose = (overrides = {}) => ({
  id: 'sch-1:2026-11-11',
  medId: 'med-1',
  scheduleId: 'sch-1',
  date: '2026-11-11',
  time: '08:00',
  status: 'taken',
  qty: 1,
  takenAt: '2026-11-11T08:03:00.000Z',
  ...overrides,
});

let token;

test('everything is locked until an account exists and you sign in', async () => {
  const status = await call('GET', '/api/status');
  assert.equal(status.json.setupRequired, true);

  assert.equal((await call('GET', '/api/state')).status, 401);
  assert.equal((await call('POST', '/api/sync', { body: { ops: [] } })).status, 401);
  assert.equal((await call('GET', '/api/export')).status, 401);
  assert.equal((await call('GET', '/api/state', { token: 'made-up' })).status, 401);

  const weak = await call('POST', '/api/setup', { body: { username: 'richard', password: 'short' } });
  assert.equal(weak.status, 400);

  const setup = await call('POST', '/api/setup', { body: { username: 'richard', password: 'correct horse' } });
  assert.equal(setup.status, 200);
  token = setup.json.token;

  const again = await call('POST', '/api/setup', { body: { username: 'intruder', password: 'correct horse' } });
  assert.equal(again.status, 403);
  assert.equal((await call('GET', '/api/status')).json.setupRequired, false);
});

test('login accepts the right password only', async () => {
  const bad = await call('POST', '/api/login', { body: { username: 'richard', password: 'wrong password' } });
  assert.equal(bad.status, 401);
  const unknown = await call('POST', '/api/login', { body: { username: 'nobody', password: 'correct horse' } });
  assert.equal(unknown.status, 401);
  const good = await call('POST', '/api/login', { body: { username: 'RICHARD', password: 'correct horse' } });
  assert.equal(good.status, 200);
  assert.equal((await call('GET', '/api/state', { token: good.json.token })).status, 200);
  await call('POST', '/api/logout', { token: good.json.token });
  assert.equal((await call('GET', '/api/state', { token: good.json.token })).status, 401);
});

test('taking, retrying and undoing a dose keeps the pill count right', async () => {
  const sync = (ops) => call('POST', '/api/sync', { token, body: { ops } });
  const stock = (res) => res.json.state.meds[0].stock;

  let res = await sync([{ type: 'med.put', med: med() }]);
  assert.equal(stock(res), 30);
  assert.equal(res.json.state.meds[0].schedules.length, 1);

  res = await sync([{ type: 'dose.put', dose: dose() }]);
  assert.equal(stock(res), 29);

  // A phone that never saw the response sends the same op again.
  res = await sync([{ type: 'dose.put', dose: dose() }]);
  assert.equal(stock(res), 29);
  assert.equal(res.json.state.doses.length, 1);

  res = await sync([{ type: 'dose.put', dose: dose({ status: 'skipped' }) }]);
  assert.equal(stock(res), 30);

  res = await sync([{ type: 'dose.put', dose: dose({ qty: 2 }) }]);
  assert.equal(stock(res), 28);

  res = await sync([{ type: 'dose.delete', id: dose().id }, { type: 'dose.delete', id: dose().id }]);
  assert.equal(stock(res), 30);
  assert.equal(res.json.state.doses.length, 0);
});

test('editing a medication does not overwrite its pill count', async () => {
  const res = await call('POST', '/api/sync', {
    token,
    body: {
      ops: [
        { type: 'dose.put', dose: dose() },
        { type: 'med.put', med: med({ name: 'Lisinopril (new)', stock: 30 }) },
      ],
    },
  });
  assert.equal(res.json.state.meds[0].name, 'Lisinopril (new)');
  assert.equal(res.json.state.meds[0].stock, 29);
});

test('changing when a dose was taken keeps the pill count', async () => {
  const sync = (ops) => call('POST', '/api/sync', { token, body: { ops } });
  const before = (await sync([])).json.state.meds[0].stock;
  let res = await sync([{ type: 'dose.put', dose: dose({ id: 'sch-1:2026-11-10', date: '2026-11-10' }) }]);
  assert.equal(res.json.state.meds[0].stock, before - 1);

  const earlier = dose({ id: 'sch-1:2026-11-10', date: '2026-11-10', takenAt: '2026-11-10T06:30:00.000Z' });
  res = await sync([{ type: 'dose.put', dose: earlier }, { type: 'dose.put', dose: earlier }]);
  assert.equal(res.json.state.meds[0].stock, before - 1);
  assert.equal(res.json.state.doses.find((d) => d.id === earlier.id).takenAt, '2026-11-10T06:30:00.000Z');

  await sync([{ type: 'dose.delete', id: earlier.id }]);
});

test('a medicine keeps its icon and follow-up doses', async () => {
  const sync = (ops) => call('POST', '/api/sync', { token, body: { ops } });
  const withFollowUps = (followUps) => med({ id: 'med-fu', name: 'Amoxicillin', icon: 'capsule', schedules: [{ ...med().schedules[0], id: 'sch-fu', followUps }] });

  let res = await sync([{ type: 'med.put', med: withFollowUps([{ afterMinutes: 240, qty: 1 }, { afterMinutes: 240.4, qty: 2 }]) }]);
  assert.deepEqual(res.json.rejected, []);
  let saved = res.json.state.meds.find((m) => m.id === 'med-fu');
  assert.equal(saved.icon, 'capsule');
  assert.deepEqual(saved.schedules[0].followUps, [{ afterMinutes: 240, qty: 1 }, { afterMinutes: 240, qty: 2 }]);

  // A follow-up dose is recorded like any other and uses up stock once.
  const followUp = dose({ id: 'sch-fu:2026-11-11:1', medId: 'med-fu', scheduleId: 'sch-fu', time: '12:03' });
  res = await sync([{ type: 'dose.put', dose: followUp }, { type: 'dose.put', dose: followUp }]);
  saved = res.json.state.meds.find((m) => m.id === 'med-fu');
  assert.equal(saved.stock, 29);

  // Nonsense is refused and leaves what was saved alone; an unknown icon falls back to the default.
  res = await sync([{ type: 'med.put', med: withFollowUps([{ afterMinutes: 0, qty: 1 }]) }]);
  assert.equal(res.json.rejected.length, 1);
  res = await sync([{ type: 'med.put', med: { ...withFollowUps(undefined), icon: 'unicorn' } }]);
  saved = res.json.state.meds.find((m) => m.id === 'med-fu');
  assert.equal(saved.icon, '');
  assert.deepEqual(saved.schedules[0].followUps, []);

  await sync([{ type: 'med.delete', id: 'med-fu' }]);
});

test('the journal keeps one entry per day and its questions', async () => {
  const sync = (ops) => call('POST', '/api/sync', { token, body: { ops } });
  const entry = { date: '2026-11-11', answers: { mood: 4, 'q-walk': 2 }, note: '  Felt fine.  ' };

  let res = await sync([
    { type: 'question.put', question: { id: 'q-walk', text: 'Did I get outside?', archived: false } },
    { type: 'question.put', question: { id: 'mood', text: 'How was your mood today?', archived: true } },
    { type: 'journal.put', entry },
    { type: 'journal.put', entry },
  ]);
  assert.deepEqual(res.json.rejected, []);
  assert.deepEqual(res.json.state.questions, [
    { id: 'q-walk', text: 'Did I get outside?', archived: false },
    { id: 'mood', text: 'How was your mood today?', archived: true },
  ]);
  assert.deepEqual(res.json.state.journal, [{ date: '2026-11-11', answers: { mood: 4, 'q-walk': 2 }, note: 'Felt fine.' }]);

  // A later save replaces the day; nonsense is refused and changes nothing.
  res = await sync([
    { type: 'journal.put', entry: { date: '2026-11-11', answers: { mood: 5 }, note: '' } },
    { type: 'journal.put', entry: { date: '2026-11-11', answers: { mood: 9 }, note: '' } },
    { type: 'question.put', question: { id: 'q-empty', text: '   ' } },
    { type: 'question.put', question: { id: 'q-walk', text: 'Did I get outside?', archived: true } },
  ]);
  assert.equal(res.json.rejected.length, 2);
  assert.deepEqual(res.json.state.journal, [{ date: '2026-11-11', answers: { mood: 5 }, note: '' }]);
  assert.equal(res.json.state.questions.find((q) => q.id === 'q-walk').archived, true);

  const backup = await call('GET', '/api/export', { token });
  assert.equal(backup.json.journal.length, 1);

  // An emptied entry goes away.
  res = await sync([{ type: 'journal.put', entry: { date: '2026-11-11', answers: {}, note: '' } }]);
  assert.deepEqual(res.json.state.journal, []);
});

test('a refill adds pills once and uses up one refill', async () => {
  const op = { type: 'refill.add', refill: { id: 'ref-1', medId: 'med-1', date: '2026-11-11', qty: 90 }, useRefill: true };
  const res = await call('POST', '/api/sync', { token, body: { ops: [op, op] } });
  assert.equal(res.json.state.meds[0].stock, 119);
  assert.equal(res.json.state.meds[0].refillsLeft, 1);
  assert.equal(res.json.state.refills.length, 1);

  const set = await call('POST', '/api/sync', { token, body: { ops: [{ type: 'stock.set', medId: 'med-1', stock: 12 }] } });
  assert.equal(set.json.state.meds[0].stock, 12);
});

test('a bad change is reported and skipped without blocking the rest', async () => {
  const res = await call('POST', '/api/sync', {
    token,
    body: {
      ops: [
        { type: 'nonsense' },
        { type: 'dose.put', dose: dose({ id: 'x', date: 'yesterday' }) },
        { type: 'med.put', med: med({ id: 'med-2', name: 'Vitamin D', stock: null, schedules: [] }) },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.rejected.map((r) => r.index), [0, 1]);
  assert.equal(res.json.state.meds.length, 2);
});

test('one account cannot see or change another account’s medicines', async () => {
  const other = createApp({ dbPath: join(dir, 'multi.db'), allowSignup: true });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${other.address().port}`;
  const post = async (path, body, tok) =>
    (
      await fetch(url + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify(body),
      })
    ).json();

  const a = await post('/api/setup', { username: 'alice', password: 'alice-password' });
  const b = await post('/api/setup', { username: 'bob', password: 'bob-password' });
  await post('/api/sync', { ops: [{ type: 'med.put', med: med() }] }, a.token);

  const attack = await post(
    '/api/sync',
    {
      ops: [
        { type: 'med.put', med: med({ name: 'Hijacked' }) },
        { type: 'med.delete', id: 'med-1' },
        { type: 'stock.set', medId: 'med-1', stock: 0 },
        { type: 'dose.put', dose: dose() },
      ],
    },
    b.token,
  );
  assert.equal(attack.state.meds.length, 0);
  assert.equal(attack.state.doses.length, 0);

  const mine = await post('/api/sync', { ops: [] }, a.token);
  assert.equal(mine.state.meds[0].name, 'Lisinopril');
  assert.equal(mine.state.meds[0].stock, 30);
  await new Promise((r) => other.close(r));
});

test('changing the password signs out other devices', async () => {
  const phone = await call('POST', '/api/login', { body: { username: 'richard', password: 'correct horse' } });
  const wrong = await call('POST', '/api/password', { token, body: { current: 'nope', next: 'battery staple' } });
  assert.equal(wrong.status, 403);
  const ok = await call('POST', '/api/password', { token, body: { current: 'correct horse', next: 'battery staple' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/state', { token: phone.json.token })).status, 401);
  assert.equal((await call('GET', '/api/state', { token })).status, 200);
  const relogin = await call('POST', '/api/login', { body: { username: 'richard', password: 'battery staple' } });
  assert.equal(relogin.status, 200);
});

test('repeated wrong passwords get locked out', async () => {
  let last;
  for (let i = 0; i < 11; i++) {
    last = await call('POST', '/api/login', { body: { username: 'richard', password: `guess-${i}` } });
  }
  assert.equal(last.status, 429);
});

test('static files are served without escaping the web folder', async () => {
  const shell = await fetch(`${base}/cabinet`);
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /shell/);
  const escape = await fetch(`${base}/..%2f..%2f..%2fetc%2fpasswd`);
  assert.doesNotMatch(await escape.text(), /root:/); // falls back to the app shell, never /etc/passwd
  const dotted = await fetch(`${base}/..%2f..%2f..%2fetc%2fhosts.txt`);
  assert.equal(dotted.status, 404);
});
