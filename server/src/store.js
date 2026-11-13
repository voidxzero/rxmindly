// Reads and writes a user's medicine data. Clients send small idempotent
// "ops" (so an offline phone can queue and safely retry them) and get the
// full state back.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9_:-]{1,100}$/;
const FORMS = ['tablet', 'capsule', 'liquid', 'injection', 'inhaler', 'drops', 'cream', 'patch', 'other'];
const COLORS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'teal', 'indigo', 'coral', 'lime', 'brown', 'gray'];
const CUSTOM_COLOR = /^#[0-9a-f]{6}$/i;
const ICONS = ['round', 'oval', 'caplet', 'capsule', 'softgel', 'liquid', 'drops', 'syringe', 'inhaler', 'tube', 'patch'];
const HISTORY_DAYS = 190;

class Invalid extends Error {}

const need = (ok, message) => {
  if (!ok) throw new Invalid(message);
};
const text = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const id = (value, what) => {
  need(typeof value === 'string' && ID.test(value), `bad ${what} id`);
  return value;
};
const date = (value, what) => {
  need(typeof value === 'string' && DATE.test(value), `bad ${what}`);
  return value;
};
const optionalDate = (value, what) => (value == null || value === '' ? null : date(value, what));
const amount = (value, what, { min = 0, max = 100000 } = {}) => {
  need(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `bad ${what}`);
  return value;
};

function parseAnswers(json) {
  try {
    const answers = JSON.parse(json);
    return answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  } catch {
    return {};
  }
}

const journalRow = (j) => ({ date: j.date, answers: parseAnswers(j.answers), note: j.note });

function parseFollowUps(json) {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function getState(db, userId) {
  const meds = db
    .prepare('SELECT * FROM medications WHERE user_id = ? ORDER BY name COLLATE NOCASE')
    .all(userId);
  const schedules = db
    .prepare(
      `SELECT s.* FROM schedules s JOIN medications m ON m.id = s.medication_id
        WHERE m.user_id = ? ORDER BY s.time`,
    )
    .all(userId);
  const since = new Date(Date.now() - HISTORY_DAYS * 86400_000).toISOString().slice(0, 10);
  const doses = db
    .prepare('SELECT * FROM doses WHERE user_id = ? AND date >= ? ORDER BY date, time')
    .all(userId, since);
  const refills = db
    .prepare('SELECT * FROM refills WHERE user_id = ? ORDER BY date DESC')
    .all(userId);

  const questions = db
    .prepare('SELECT * FROM journal_questions WHERE user_id = ? ORDER BY created_at, rowid')
    .all(userId);
  const journal = db
    .prepare('SELECT * FROM journal_entries WHERE user_id = ? AND date >= ? ORDER BY date')
    .all(userId, since);

  const byMed = new Map();
  for (const s of schedules) {
    if (!byMed.has(s.medication_id)) byMed.set(s.medication_id, []);
    byMed.get(s.medication_id).push({
      id: s.id,
      time: s.time,
      qty: s.qty,
      days: s.days,
      startDate: s.start_date,
      endDate: s.end_date,
      followUps: parseFollowUps(s.follow_ups),
    });
  }

  return {
    meds: meds.map((m) => ({
      id: m.id,
      name: m.name,
      strength: m.strength,
      form: m.form,
      color: m.color,
      icon: m.icon,
      instructions: m.instructions,
      prescriber: m.prescriber,
      pharmacy: m.pharmacy,
      rxNumber: m.rx_number,
      stock: m.stock,
      lowDays: m.low_days,
      refillsLeft: m.refills_left,
      asNeeded: !!m.as_needed,
      archivedAt: m.archived_at,
      createdAt: m.created_at,
      schedules: byMed.get(m.id) ?? [],
    })),
    doses: doses.map((d) => ({
      id: d.id,
      medId: d.medication_id,
      scheduleId: d.schedule_id,
      date: d.date,
      time: d.time,
      status: d.status,
      qty: d.qty,
      takenAt: d.taken_at,
    })),
    refills: refills.map((r) => ({
      id: r.id,
      medId: r.medication_id,
      date: r.date,
      qty: r.qty,
      note: r.note,
    })),
    questions: questions.map((q) => ({ id: q.id, text: q.text, archived: !!q.archived })),
    journal: journal.map(journalRow),
  };
}

/** Everything, with no history cut-off. Used for backups. */
export function exportAll(db, userId) {
  const state = getState(db, userId);
  const doses = db.prepare('SELECT * FROM doses WHERE user_id = ? ORDER BY date, time').all(userId);
  const journal = db.prepare('SELECT * FROM journal_entries WHERE user_id = ? ORDER BY date').all(userId);
  return {
    exportedAt: new Date().toISOString(),
    ...state,
    journal: journal.map(journalRow),
    doses: doses.map((d) => ({
      id: d.id,
      medId: d.medication_id,
      scheduleId: d.schedule_id,
      date: d.date,
      time: d.time,
      status: d.status,
      qty: d.qty,
      takenAt: d.taken_at,
    })),
  };
}

function ownedMed(db, userId, medId) {
  return db.prepare('SELECT * FROM medications WHERE id = ? AND user_id = ?').get(medId, userId);
}

function adjustStock(db, medId, delta) {
  if (!delta) return;
  db.prepare(
    'UPDATE medications SET stock = MAX(0, stock + ?), updated_at = ? WHERE id = ? AND stock IS NOT NULL',
  ).run(delta, new Date().toISOString(), medId);
}

const handlers = {
  'med.put'(db, userId, op) {
    const m = op.med ?? {};
    const medId = id(m.id, 'medication');
    const name = text(m.name, 120);
    need(name, 'medication needs a name');
    const form = FORMS.includes(m.form) ? m.form : 'tablet';
    const color = COLORS.includes(m.color) ? m.color : typeof m.color === 'string' && CUSTOM_COLOR.test(m.color) ? m.color.toLowerCase() : 'blue';
    const icon = ICONS.includes(m.icon) ? m.icon : '';
    const stock = m.stock == null ? null : amount(m.stock, 'stock');
    const refillsLeft = m.refillsLeft == null ? null : Math.round(amount(m.refillsLeft, 'refills', { max: 999 }));
    const lowDays = m.lowDays == null ? 7 : Math.round(amount(m.lowDays, 'low-supply days', { max: 365 }));
    const archivedAt = optionalDate(m.archivedAt, 'archive date');
    const schedules = Array.isArray(m.schedules) ? m.schedules : [];
    need(schedules.length <= 48, 'too many schedule times');
    const cleanSchedules = schedules.map((s) => {
      need(typeof s.time === 'string' && TIME.test(s.time), 'bad schedule time');
      need(typeof s.days === 'string' && /^[0-6]{1,7}$/.test(s.days), 'bad schedule days');
      const followUps = s.followUps == null ? [] : s.followUps;
      need(Array.isArray(followUps) && followUps.length <= 24, 'bad follow-up doses');
      return {
        id: id(s.id, 'schedule'),
        time: s.time,
        qty: amount(s.qty, 'schedule quantity', { min: 0.01, max: 1000 }),
        days: [...new Set(s.days)].sort().join(''),
        startDate: date(s.startDate, 'schedule start date'),
        endDate: optionalDate(s.endDate, 'schedule end date'),
        followUps: JSON.stringify(
          followUps.map((f) => ({
            afterMinutes: Math.round(amount(f?.afterMinutes, 'follow-up wait', { min: 1, max: 2880 })),
            qty: amount(f?.qty, 'follow-up quantity', { min: 0.01, max: 1000 }),
          })),
        ),
      };
    });

    const now = new Date().toISOString();
    const existing = db.prepare('SELECT user_id FROM medications WHERE id = ?').get(medId);
    need(!existing || existing.user_id === userId, 'medication id is taken');

    const fields = [
      name,
      text(m.strength, 60),
      form,
      color,
      icon,
      text(m.instructions, 1000),
      text(m.prescriber, 120),
      text(m.pharmacy, 120),
      text(m.rxNumber, 60),
      lowDays,
      refillsLeft,
      m.asNeeded ? 1 : 0,
      archivedAt,
      now,
    ];
    if (existing) {
      // Stock is deliberately not touched here: it changes through doses,
      // refills and stock.set, so a stale edit can't undo a recorded dose.
      db.prepare(
        `UPDATE medications SET name = ?, strength = ?, form = ?, color = ?, icon = ?, instructions = ?,
                prescriber = ?, pharmacy = ?, rx_number = ?, low_days = ?, refills_left = ?,
                as_needed = ?, archived_at = ?, updated_at = ?
          WHERE id = ?`,
      ).run(...fields, medId);
    } else {
      db.prepare(
        `INSERT INTO medications (name, strength, form, color, icon, instructions, prescriber, pharmacy,
                rx_number, low_days, refills_left, as_needed, archived_at, updated_at,
                id, user_id, stock, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(...fields, medId, userId, stock, now);
    }

    const keep = new Set(cleanSchedules.map((s) => s.id));
    for (const row of db.prepare('SELECT id FROM schedules WHERE medication_id = ?').all(medId)) {
      if (!keep.has(row.id)) db.prepare('DELETE FROM schedules WHERE id = ?').run(row.id);
    }
    for (const s of cleanSchedules) {
      const clash = db.prepare('SELECT medication_id FROM schedules WHERE id = ?').get(s.id);
      need(!clash || clash.medication_id === medId, 'schedule id is taken');
      db.prepare(
        `INSERT INTO schedules (id, medication_id, time, qty, days, start_date, end_date, follow_ups)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET time = excluded.time, qty = excluded.qty, days = excluded.days,
                start_date = excluded.start_date, end_date = excluded.end_date, follow_ups = excluded.follow_ups`,
      ).run(s.id, medId, s.time, s.qty, s.days, s.startDate, s.endDate, s.followUps);
    }
  },

  'med.delete'(db, userId, op) {
    db.prepare('DELETE FROM medications WHERE id = ? AND user_id = ?').run(id(op.id, 'medication'), userId);
  },

  'stock.set'(db, userId, op) {
    const stock = op.stock == null ? null : amount(op.stock, 'stock');
    db.prepare('UPDATE medications SET stock = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
      stock,
      new Date().toISOString(),
      id(op.medId, 'medication'),
      userId,
    );
  },

  'dose.put'(db, userId, op) {
    const d = op.dose ?? {};
    const doseId = id(d.id, 'dose');
    const medId = id(d.medId, 'medication');
    need(d.status === 'taken' || d.status === 'skipped', 'bad dose status');
    need(typeof d.time === 'string' && TIME.test(d.time), 'bad dose time');
    const day = date(d.date, 'dose date');
    const qty = amount(d.qty, 'dose quantity', { min: 0.01, max: 1000 });
    const scheduleId = d.scheduleId == null ? null : id(d.scheduleId, 'schedule');
    const takenAt = d.status === 'taken' ? text(d.takenAt, 40) || new Date().toISOString() : null;

    if (!ownedMed(db, userId, medId)) return; // medication was deleted elsewhere
    const old = db.prepare('SELECT * FROM doses WHERE id = ?').get(doseId);
    need(!old || (old.user_id === userId && old.medication_id === medId), 'dose id is taken');

    db.prepare(
      `INSERT INTO doses (id, user_id, medication_id, schedule_id, date, time, status, qty, taken_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, qty = excluded.qty,
              time = excluded.time, taken_at = excluded.taken_at`,
    ).run(doseId, userId, medId, scheduleId, day, d.time, d.status, qty, takenAt);

    const before = old?.status === 'taken' ? old.qty : 0;
    const after = d.status === 'taken' ? qty : 0;
    adjustStock(db, medId, before - after);
  },

  'dose.delete'(db, userId, op) {
    const doseId = id(op.id, 'dose');
    const old = db.prepare('SELECT * FROM doses WHERE id = ? AND user_id = ?').get(doseId, userId);
    if (!old) return;
    db.prepare('DELETE FROM doses WHERE id = ?').run(doseId);
    if (old.status === 'taken') adjustStock(db, old.medication_id, old.qty);
  },

  'refill.add'(db, userId, op) {
    const r = op.refill ?? {};
    const refillId = id(r.id, 'refill');
    const medId = id(r.medId, 'medication');
    const qty = amount(r.qty, 'refill quantity', { min: 0.01 });
    const day = date(r.date, 'refill date');
    const med = ownedMed(db, userId, medId);
    if (!med) return;
    if (db.prepare('SELECT 1 FROM refills WHERE id = ?').get(refillId)) return; // already applied

    db.prepare('INSERT INTO refills (id, user_id, medication_id, date, qty, note) VALUES (?, ?, ?, ?, ?, ?)').run(
      refillId,
      userId,
      medId,
      day,
      qty,
      text(r.note, 200),
    );
    const useRefill = op.useRefill && med.refills_left != null && med.refills_left > 0;
    db.prepare(
      'UPDATE medications SET stock = COALESCE(stock, 0) + ?, refills_left = ?, updated_at = ? WHERE id = ?',
    ).run(qty, useRefill ? med.refills_left - 1 : med.refills_left, new Date().toISOString(), medId);
  },

  'question.put'(db, userId, op) {
    const q = op.question ?? {};
    const questionId = id(q.id, 'question');
    const words = text(q.text, 200);
    need(words, 'question needs some text');
    const existing = db.prepare('SELECT 1 FROM journal_questions WHERE user_id = ? AND id = ?').get(userId, questionId);
    if (!existing) {
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM journal_questions WHERE user_id = ?').get(userId);
      need(n < 100, 'too many journal questions');
    }
    db.prepare(
      `INSERT INTO journal_questions (user_id, id, text, archived, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET text = excluded.text, archived = excluded.archived`,
    ).run(userId, questionId, words, q.archived ? 1 : 0, new Date().toISOString());
  },

  // Replaces the whole entry for that day, so sending it twice changes nothing.
  'journal.put'(db, userId, op) {
    const e = op.entry ?? {};
    const day = date(e.date, 'journal date');
    const given = e.answers ?? {};
    need(typeof given === 'object' && !Array.isArray(given), 'bad journal answers');
    const keys = Object.keys(given);
    need(keys.length <= 100, 'too many journal answers');
    const answers = {};
    for (const key of keys) {
      const value = given[key];
      // Stored on 1–5 whatever scale the app shows (1–10, a slider…), so decimals are fine.
      need(typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5, 'bad journal answer');
      answers[id(key, 'question')] = Math.round(value * 1000) / 1000;
    }
    const note = text(e.note, 5000);
    if (!keys.length && !note) {
      db.prepare('DELETE FROM journal_entries WHERE user_id = ? AND date = ?').run(userId, day);
      return;
    }
    db.prepare(
      `INSERT INTO journal_entries (user_id, date, answers, note, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET answers = excluded.answers, note = excluded.note,
              updated_at = excluded.updated_at`,
    ).run(userId, day, JSON.stringify(answers), note, new Date().toISOString());
  },
};

/**
 * Applies ops in order. A malformed op is skipped and reported rather than
 * failing the batch, so one bad entry can never jam a client's queue.
 */
export function applyOps(db, userId, ops) {
  const rejected = [];
  ops.forEach((op, index) => {
    const handler = Object.hasOwn(handlers, op?.type) ? handlers[op.type] : null;
    if (!handler) {
      rejected.push({ index, error: 'unknown op' });
      return;
    }
    db.exec('SAVEPOINT op');
    try {
      handler(db, userId, op);
      db.exec('RELEASE op');
    } catch (err) {
      db.exec('ROLLBACK TO op; RELEASE op');
      if (!(err instanceof Invalid)) throw err;
      rejected.push({ index, error: err.message });
    }
  });
  return rejected;
}
