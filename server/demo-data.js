// Fills a Rxmindly server with made-up medicines, a month of dose history and
// journal entries, for screenshots and trying things out. Never point it at a
// real account: it adds to whatever is there.
//
//   node demo-data.js [server] [username] [password]
//   node demo-data.js http://localhost:8099 demo demo-password
//
// Creates the account if the server has none yet, otherwise signs in. Running
// it again changes nothing (the ids are fixed), except that the days up to
// today are filled in.

const [server = 'http://localhost:8099', username = 'demo', password = 'demo-password'] = process.argv.slice(2);

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const atTime = (day, time, plusMinutes = 0) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m + plusMinutes);
};

// The same "random" numbers every run, so history looks the same each time.
let seed = 20261116;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const today = new Date();
const start = addDays(today, -35);
const startDate = localDate(start);

const med = (m) => ({
  strength: '',
  icon: '',
  instructions: '',
  prescriber: '',
  pharmacy: '',
  rxNumber: '',
  lowDays: 7,
  refillsLeft: null,
  asNeeded: false,
  archivedAt: null,
  createdAt: start.toISOString(),
  ...m,
  schedules: (m.schedules ?? []).map((s, i) => ({
    id: `${m.id}-s${i + 1}`,
    qty: 1,
    days: '0123456',
    startDate,
    endDate: null,
    followUps: [],
    ...s,
  })),
});

const meds = [
  med({
    id: 'demo-lisinopril', name: 'Lisinopril', strength: '10 mg', form: 'tablet', color: 'blue', icon: 'round',
    instructions: 'Take in the morning.', prescriber: 'Dr. Patel', pharmacy: 'Corner Pharmacy', rxNumber: '4471023',
    refillsLeft: 3, schedules: [{ time: '08:00' }],
  }),
  med({
    id: 'demo-metformin', name: 'Metformin', strength: '500 mg', form: 'tablet', color: 'orange', icon: 'caplet',
    instructions: 'Take with food.', prescriber: 'Dr. Patel', pharmacy: 'Corner Pharmacy', rxNumber: '4471088',
    refillsLeft: 5, schedules: [{ time: '08:00' }, { time: '19:00' }],
  }),
  med({
    id: 'demo-vitamin-d', name: 'Vitamin D3', strength: '2000 IU', form: 'capsule', color: 'yellow', icon: 'softgel',
    schedules: [{ time: '08:00' }],
  }),
  med({
    id: 'demo-atorvastatin', name: 'Atorvastatin', strength: '20 mg', form: 'tablet', color: 'violet', icon: 'oval',
    instructions: 'Take at bedtime.', prescriber: 'Dr. Okafor', pharmacy: 'Corner Pharmacy', rxNumber: '4470951',
    refillsLeft: 0, schedules: [{ time: '21:30' }],
  }),
  med({
    id: 'demo-ibuprofen', name: 'Ibuprofen', strength: '200 mg', form: 'tablet', color: 'red', icon: 'caplet',
    instructions: 'Up to 3 a day for pain. Take with food.', asNeeded: true,
  }),
];

// What the bottles hold at the end, whatever the history added up to.
const finalStock = {
  'demo-lisinopril': 23,
  'demo-metformin': 41,
  'demo-vitamin-d': 64,
  'demo-atorvastatin': 4,
  'demo-ibuprofen': 38,
};

const ops = [];
for (const m of meds) ops.push({ type: 'med.put', med: { ...m, stock: finalStock[m.id] } });

// Dose history: mostly on time, now and then late, skipped or missed.
const now = today.getTime();
for (let back = 34; back >= 0; back--) {
  const day = addDays(today, -back);
  const date = localDate(day);
  for (const m of meds) {
    for (const s of m.schedules) {
      const due = atTime(day, s.time);
      if (due.getTime() > now) continue; // not due yet: leave it in the organizer
      let r = rand();
      if (back === 0 && due.getTime() > now - 45 * 60000) continue; // due a moment ago: still to take
      if (back <= 6) r = 0.5; // a good last week, so the streak isn't zero
      if (r < 0.05) continue; // missed
      const id = `${s.id}:${date}`;
      if (r < 0.09) {
        ops.push({ type: 'dose.put', dose: { id, medId: m.id, scheduleId: s.id, date, time: s.time, status: 'skipped', qty: s.qty, takenAt: null } });
        continue;
      }
      const late = r > 0.9 ? 40 + Math.round(rand() * 80) : Math.round(rand() * 25) - 5;
      ops.push({
        type: 'dose.put',
        dose: { id, medId: m.id, scheduleId: s.id, date, time: s.time, status: 'taken', qty: s.qty, takenAt: atTime(day, s.time, late).toISOString() },
      });
    }
  }
  // An as-needed painkiller a few times a week.
  if (back > 0 && rand() < 0.3) {
    const time = `${pad(12 + Math.floor(rand() * 8))}:${pad(Math.floor(rand() * 4) * 15)}`;
    ops.push({
      type: 'dose.put',
      dose: { id: `demo-ibuprofen:${date}:${time.replace(':', '')}`, medId: 'demo-ibuprofen', scheduleId: null, date, time, status: 'taken', qty: rand() < 0.5 ? 1 : 2, takenAt: atTime(day, time).toISOString() },
    });
  }
}

ops.push({
  type: 'refill.add',
  refill: { id: 'demo-refill-lisinopril-1', medId: 'demo-lisinopril', date: localDate(addDays(today, -12)), qty: 30, note: 'Corner Pharmacy' },
  useRefill: false,
});
ops.push({
  type: 'refill.add',
  refill: { id: 'demo-refill-metformin-1', medId: 'demo-metformin', date: localDate(addDays(today, -20)), qty: 60, note: '' },
  useRefill: false,
});

// Journal: three weeks of answers drifting slowly upward, with a few notes.
const notes = {
  20: 'Started keeping the journal.',
  14: 'Bad night, neighbors were loud.',
  9: 'Long walk in the afternoon.',
  3: 'Felt good all day.',
};
for (let back = 21; back >= 1; back--) {
  const lift = (21 - back) / 21;
  const answer = (base) => Math.max(1, Math.min(5, Math.round((base + lift * 1.2 + (rand() - 0.5) * 1.6) * 2) / 2));
  const entry = { date: localDate(addDays(today, -back)), answers: { mood: answer(2.8), energy: answer(2.5), sleep: answer(2.9), calm: answer(3) }, note: notes[back] ?? '' };
  if (back === 14) entry.answers.sleep = 1;
  ops.push({ type: 'journal.put', entry });
}

for (const [medId, stock] of Object.entries(finalStock)) ops.push({ type: 'stock.set', medId, stock });

async function call(path, body, token) {
  const res = await fetch(server.replace(/\/$/, '') + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${data.error ?? ''}`);
  return data;
}

const status = await call('/api/status');
const { token } = await call(status.setupRequired ? '/api/setup' : '/api/login', { username, password });
const result = await call('/api/sync', { ops }, token);
const rejected = result.rejected?.length ?? 0;
console.log(`${status.setupRequired ? 'Created' : 'Signed in as'} "${username}", sent ${ops.length} changes${rejected ? `, ${rejected} rejected: ${JSON.stringify(result.rejected.slice(0, 3))}` : ''}`);
