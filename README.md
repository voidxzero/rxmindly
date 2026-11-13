# Rxmindly

Keep track of your prescriptions and get reminded to take them. Your data lives on your own server.

- **Pill organizer** – a week of compartments. Open a day, tap **Take**.
- **Medicine cabinet** – every prescription as a bottle: how much is left, how many days that lasts, refills remaining, one-tap refill.
- **Journal** – a few 1-to-5 questions about your day (mood, energy, sleep, calm, plus any you add in Settings) and a free-text note, with a chart of each question over time.
- **Import and export** – medicines, dose history, journal and refills as CSV files for a spreadsheet, or everything as one backup file. Any of them can be imported again.
- **Home screen widget** (Android) – shows what is overdue or when the next dose is.
- **Updates itself** (Android) – checks GitHub for a newer release when you open the app and installs it with a tap.
- **History** – a day-by-day grid of what was taken, missed or skipped, plus totals per medicine and per time of day.
- **Reminders** – from the Android app, at each scheduled time, with a follow-up if you haven't taken it. They work with no connection to the server.
- **Follow-up doses** – for medicines taken again a set time later (say, every 4 hours): the next reminder is timed from when you marked the dose before as taken. If you forgot to mark a dose, you can set the time you really took it.

There are three parts: a server (Docker), a web app (served by the server), and an Android app. Everything is behind a login.

## Run the server

```sh
mkdir -p data && sudo chown 1000:1000 data   # the container runs as user 1000
docker compose up -d --build
```

Open `http://<your-server>:8060`. The first visit asks you to create the account; after that, sign-up is closed.

The database is a single SQLite file, `data/rxmindly.db`, next to `docker-compose.yml`. **Back that folder up.** You can also download a JSON backup from Settings in the web app.

Settings, in `docker-compose.yml`:

| Variable | Meaning |
|---|---|
| `RXMINDLY_TRUST_PROXY` | `true` when behind a reverse proxy, so login rate-limiting sees real client addresses |
| `RXMINDLY_ALLOW_SIGNUP` | `true` to let more people create accounts (each sees only their own data) |

If the server is reachable from outside your home network, put it behind HTTPS (a reverse proxy such as Caddy does this in two lines). Over plain `http://` your password and data travel unencrypted.

## Install the Android app

```sh
./build-apk.sh                 # needs the Android SDK and JDK 21
adb install -r rxmindly.apk  # or copy the file to your phone and open it
```

On first launch, enter your server's address (for example `192.168.1.20:8060`), then sign in. Allow notifications when asked.

The phone keeps its own copy of your data. You can take doses and get reminders anywhere; changes are sent to the server the next time it's reachable.

Some phones (Samsung, Xiaomi, OnePlus…) aggressively stop background apps. If reminders arrive late, exclude Rxmindly from battery optimisation in Android's settings.

## Development

```sh
cd server && npm start          # API on :8080, data in server/data/
cd web && npm install && npm run dev   # web app with live reload, proxies /api to :8080

cd server && npm test           # API tests
cd web && npm test              # schedule, pill-count and history logic tests
```

Layout:

- `server/` – Node, no dependencies; SQLite via Node's built-in driver. `src/store.js` holds the data rules.
- `web/` – React + TypeScript. The same code is the web app and, wrapped by Capacitor (`web/android/`), the Android app.
- `web/src/lib/logic.ts` mirrors the server's rules so the app can work offline; change the two together.
