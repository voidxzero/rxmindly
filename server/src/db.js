import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );

  CREATE TABLE medications (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    strength     TEXT NOT NULL DEFAULT '',
    form         TEXT NOT NULL DEFAULT 'tablet',
    color        TEXT NOT NULL DEFAULT 'blue',
    instructions TEXT NOT NULL DEFAULT '',
    prescriber   TEXT NOT NULL DEFAULT '',
    pharmacy     TEXT NOT NULL DEFAULT '',
    rx_number    TEXT NOT NULL DEFAULT '',
    stock        REAL,
    low_days     INTEGER NOT NULL DEFAULT 7,
    refills_left INTEGER,
    as_needed    INTEGER NOT NULL DEFAULT 0,
    archived_at  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX medications_user ON medications(user_id);

  CREATE TABLE schedules (
    id            TEXT PRIMARY KEY,
    medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    time          TEXT NOT NULL,
    qty           REAL NOT NULL DEFAULT 1,
    days          TEXT NOT NULL DEFAULT '0123456',
    start_date    TEXT NOT NULL,
    end_date      TEXT
  );
  CREATE INDEX schedules_med ON schedules(medication_id);

  CREATE TABLE doses (
    id            TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    schedule_id   TEXT,
    date          TEXT NOT NULL,
    time          TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('taken', 'skipped')),
    qty           REAL NOT NULL DEFAULT 1,
    taken_at      TEXT
  );
  CREATE INDEX doses_user_date ON doses(user_id, date);

  CREATE TABLE refills (
    id            TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    qty           REAL NOT NULL,
    note          TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX refills_med ON refills(medication_id);
  `,
  `
  ALTER TABLE medications ADD COLUMN icon TEXT NOT NULL DEFAULT '';
  ALTER TABLE schedules ADD COLUMN follow_ups TEXT NOT NULL DEFAULT '[]';
  `,
  `
  -- The questions a user has added to the daily journal, plus switched-off built-in ones
  -- (the built-in questions themselves live in the app; ids are only unique per user).
  CREATE TABLE journal_questions (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    text       TEXT NOT NULL,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  -- One journal entry per user per day: answers is a JSON object of question id -> 1..5.
  CREATE TABLE journal_entries (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    answers    TEXT NOT NULL DEFAULT '{}',
    note       TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, date)
  );
  `,
];

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
