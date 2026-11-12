# Rxmindly

Self-hosted prescription tracker and medicine reminder. Three parts: a server in Docker, a web app the server serves, and an Android app. Everything is behind a login. `README.md` has the user-facing setup.

## Layout

- `server/` — Node, zero npm dependencies, SQLite through Node's built-in `node:sqlite`.
  - `src/app.js` HTTP routes, static file serving, auth checks
  - `src/auth.js` scrypt passwords, session tokens (stored hashed), login rate limiter
  - `src/store.js` the data rules: applies client "ops", returns state
  - `src/db.js` schema and migrations (`MIGRATIONS` array, `PRAGMA user_version`)
- `web/` — React + TypeScript + Vite. One codebase is both the web app and the Android app.
  - `src/lib/logic.ts` pure logic: `applyOp`, what is due on a day, supply, history stats
  - `src/lib/store.ts` local state in `localStorage`, outbox, sync
  - `src/lib/journal.ts` the daily journal: built-in questions, which are active, trends for the charts
  - `src/lib/reminders.ts` Android local notifications (no-op in a browser)
  - `src/screens/` Organizer, Cabinet, Journal, History, Settings, Login
  - `android/` Capacitor project. `android/app/src/main/assets/public` is generated; never edit it.
- `Dockerfile`, `docker-compose.yml` — one image: builds `web/`, serves it from the server.
- `build-apk.sh` — builds `rxmindly.apk` at the project root.

## Commands

```sh
cd server && npm test        # API tests (node:test)
cd server && npm start       # dev server on :8080, data in server/data/
cd web && npm test           # logic tests (vitest)
cd web && npm run build      # type-check + bundle; run this before calling UI work done
cd web && npm run dev        # live reload, proxies /api to :8080
./build-apk.sh               # Android APK; finds the SDK and JDK under ~/Android
podman build -t rxmindly . # docker is not installed on the dev machine; podman is
```

## Rules that are easy to break

- **Ops are implemented twice.** Clients send idempotent ops (`med.put`, `med.delete`, `stock.set`, `dose.put`, `dose.delete`, `refill.add`, `question.put`, `journal.put`) to `POST /api/sync`. `server/src/store.js` applies them in SQL; `web/src/lib/logic.ts` `applyOp` applies the same rules locally so the app works offline. Change both together, and add a test on each side.
- **Every op must be safe to send twice.** A phone that misses the response resends its outbox. Scheduled dose ids are deterministic (`<scheduleId>:<date>`) for this reason.
- **Follow-up doses hang off a schedule.** `schedule.followUps` is a list of `{ afterMinutes, qty }` (a JSON column on the server). Each is due that long after the dose before it was *taken* (`takenAt`), so its time is worked out in `dueOn`, never stored. Dose ids are `<scheduleId>:<date>:<n>`, n from 1. Until the dose before is recorded the time is a guess (`estimated`) and no reminder is scheduled.
- **Changing when a dose was taken is just `dose.put` again** with a new `takenAt` (and `time`, for as-needed doses). No separate op.
- **The journal is one entry per day.** `journal.put` replaces that day's whole entry (`answers` is question id → 1–5, plus `note`); an entry with no answers and no note is deleted. The built-in questions live only in the app (`DEFAULT_QUESTIONS`); the server stores the user's own questions and, for a switched-off built-in one, a row with the same id and `archived`. Questions are archived, never deleted, so old answers stay.
- **`med.put` never changes stock on an existing medicine.** Stock moves only through doses, refills and `stock.set`, so a stale edit can't undo a recorded dose.
- **Dates and times are local strings**, `YYYY-MM-DD` and `HH:MM`, never UTC timestamps. Only `takenAt` is an ISO instant. The server does no time-zone maths.
- **Schedules are ended, not rewritten.** Editing a time ends the old schedule (`endDate`) and starts a new one, so past days keep the schedule they had. See `reviseSchedules`.
- **Every `/api` route except `status`, `setup` and `login` must call `authenticate`.** All queries filter by `user_id`.
- The Android app reaches the server through Capacitor's native HTTP (`CapacitorHttp` in `capacitor.config.ts`), so the server sends no CORS headers. Keep it that way.
- Layout uses `--safe-area-inset-*` CSS variables that Capacitor injects on Android; keep `--safe-top` / `--safe-bottom` on anything pinned to a screen edge.

## Deployment (the user's server)

- Runs with `docker compose up -d --build` from the project folder on the server, kept under `/home/richard/docker/`.
- Published on host port **8060** (container port stays 8080).
- Data is a bind mount, `./data:/data`: the database is `data/rxmindly.db` beside the compose file. The folder must be owned by uid 1000, the container's user.
- The project is copied to the server by hand over SFTP. Only `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `server/` and `web/` (without `node_modules`, `dist`, `android`) are needed there. Never copy over or delete the server's `data/` folder.
- In the Android app the server address is entered at sign-in, e.g. `<server-ip>:8060`.

## State of testing

- Server and logic tests pass. The web app was checked in headless Chromium at phone and desktop sizes, light and dark.
- **The Android app has only been compiled, never run.** The emulator cannot run on the dev machine. Connecting to the server, notifications, notification action buttons and safe-area layout are all unverified on a real device; treat reports from the phone as the first real test.
- The web app has no reminders; they come only from the Android app. Reminders are scheduled 14 days ahead each time the app runs.

## Conventions

- UI text is plain, American spelling, and uses the real-life metaphors: "pill organizer", "medicine cabinet", "bottle", "refill".
- A medicine's picture is `med.icon` (`MED_ICONS`); empty means "follow the form" (`iconOf`). The list exists in `web/src/lib/types.ts` and `server/src/store.js`; keep them the same.
- Animations (`lib/celebrate.ts`, the `.fresh` classes) must stay off under `prefers-reduced-motion`.
- Journal questions all run 1 (low) to 5 (high), and the built-in ones are worded so 5 is the good end, which keeps every chart reading the same way.
- Chart status colors (taken / some taken / missed / skipped) always carry an icon or number as well as color.
- **The app was called Mediminder until 2026-11-12** and was renamed throughout, identifiers included. Two shims remain on purpose and are the only places the old name should appear in code: `server/src/index.js` renames a leftover `mediminder.db` to `rxmindly.db` on start, and `web/src/lib/store.ts` reads the old `mediminder` browser storage key when the new one is empty. The local project folder is still `/home/richard/Projects/mediminder`.
- The git history starts on 2026-11-12 with one commit of the already-working app; there is nothing older to look up.
