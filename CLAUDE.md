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
  - `src/lib/transfer.ts`, `csv.ts` import and export: CSV per kind of data, and the JSON backup
  - `src/lib/widget.ts` hands the Android home screen widget its data
  - `src/lib/updates.ts` Android self-update from GitHub releases (checks when the app comes into view; no timer)
  - `android/app/src/main/java/app/rxmindly/` hand-written native code: `NextDoseWidget` (the widget), `WidgetBridgePlugin` (how the web side reaches it) and `UpdaterPlugin` (downloads and installs an update) and `FileSaverPlugin` (Android's "save to" screen for exports; a download link does nothing in the app's web view, so always save through `saveFile()` in `src/lib/save-file.ts`)
  - `src/screens/` Organizer, Cabinet, Journal, History, Settings, Login
  - `android/` Capacitor project. `android/app/src/main/assets/public` is generated; never edit it.
- `Dockerfile`, `docker-compose.yml` — one image: builds `web/`, serves it from the server.
- `build-apk.sh` — builds `rxmindly.apk` (release build, signed) at the project root.
- `release.sh <version>` — bumps the version, tags and pushes; `.github/workflows/release.yml` then builds the APK and publishes a GitHub release.

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
- **Importing is done with ops, on the client.** `planImport` turns a CSV or backup file into ordinary ops, so there is no import route on the server and importing a file twice changes nothing (rows without an id get a deterministic one). Imported doses and refills are followed by `stock.set` so old history never moves the pill count. The outbox is sent in batches (`firstBatch` in `store.ts`), because one import can queue thousands of ops.
- **Colors are a named color or `#rrggbb`.** Always paint with `cssColor()`, never `var(--med-…)` directly. The named list exists in `types.ts`, `styles.css` (light and dark) and `server/src/store.js`.
- **`med.put` never changes stock on an existing medicine.** Stock moves only through doses, refills and `stock.set`, so a stale edit can't undo a recorded dose.
- **Dates and times are local strings**, `YYYY-MM-DD` and `HH:MM`, never UTC timestamps. Only `takenAt` is an ISO instant. The server does no time-zone maths.
- **Schedules are ended, not rewritten.** Editing a time ends the old schedule (`endDate`) and starts a new one, so past days keep the schedule they had. See `reviseSchedules`.
- **Every `/api` route except `status`, `setup` and `login` must call `authenticate`.** All queries filter by `user_id`.
- **The phone can have two addresses for the same server**: `serverUrl` (main) and `backupUrl` (usually its home-network IP). Every request goes through `withServer()` in `store.ts`, which switches to the other address only when the one in use can't be reached (`ApiError` status 0), never on a 401 or other refusal. Before the token goes to the other address, its `/api/status` must report the same `instanceId` (a random id the server makes once, in the `meta` table), so a stranger's device at the same LAN IP on another network never receives it. Never call `api.*` with an address directly from a screen.
- The Android app reaches the server through Capacitor's native HTTP (`CapacitorHttp` in `capacitor.config.ts`), so the server sends no CORS headers. Keep it that way.
- Layout uses `--safe-area-inset-*` CSS variables that Capacitor injects on Android; keep `--safe-top` / `--safe-bottom` on anything pinned to a screen edge.

## Releases and the signing key

- The app version is `web/package.json` `version`; `build.gradle` derives `versionName` and `versionCode` from it. Never hand-edit those in Gradle.
- A release is a tag `v<version>` with `rxmindly.apk` attached. Phones find it through the GitHub releases API (`UPDATE_REPO` in `updates.ts`) and install it over the top.
- **Claude does the versioning.** The user only gets app changes through a release, so after committing and pushing a change that affects the app (anything under `web/`), also run `./release.sh <next version>` without being asked. Pick the number: patch (1.1.2 → 1.1.3) for fixes and small changes, minor (1.1.x → 1.2.0) for new features, major only if the user says so. Build and test first. Server-only or docs-only changes need no release (the server is deployed by hand, see below). Only ever push or release when the user has asked for the change to be committed and pushed.
- `origin` is `git@github.com:voidxzero/rxmindly.git` over SSH (key `~/.ssh/id_ed25519`, no passphrase); HTTPS has no stored credentials on the dev machine.
- Node 24 is installed per-user in `~/.local/opt/`, linked from `~/.local/bin` (no sudo on the dev machine). The Android SDK and JDK are not installed, so `./build-apk.sh` doesn't run locally; the release workflow builds the APK.
- **Every APK must be signed with the same key** or Android refuses it as an update. The key is `~/.config/rxmindly/release.jks` with its password in `keystore.properties` beside it; the release workflow reads a copy from the repo's `KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` secrets. Never commit it, never regenerate it, never print the password. Without the key the build falls back to the debug key, which is only good for a fresh install.
- The repository is public (since 2026-11-13), so the phone checks and downloads releases with no token. The access-token field in Settings exists only in case the repo is ever made private again.

## Deployment (the user's server)

- Runs with `docker compose up -d --build` from the project folder on the server, kept under `/home/richard/docker/`.
- Published on host port **8060** (container port stays 8080).
- Data is a bind mount, `./data:/data`: the database is `data/rxmindly.db` beside the compose file. The folder must be owned by uid 1000, the container's user.
- The project is copied to the server by hand over SFTP. Only `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `server/` and `web/` (without `node_modules`, `dist`, `android`) are needed there. Never copy over or delete the server's `data/` folder.
- In the Android app the server address is entered at sign-in, e.g. `<server-ip>:8060`, with an optional local address used when the main one can't be reached. Both can be changed later in Settings → Your server (the local one without signing out).

## State of testing

- Server and logic tests pass. The web app was checked in headless Chromium at phone and desktop sizes, light and dark.
- **The home screen widget, stale-notification clearing, pull-to-sync and swipe between days have only been compiled or tried with simulated touches**, never on a real phone.
- The user installed the first Android build on their phone on 2026-11-11 and reported it working. Nothing added since has been confirmed on a device: the emulator cannot run on the dev machine, so native changes are only ever compiled here.
- The web app has no reminders; they come only from the Android app. Reminders are scheduled 14 days ahead each time the app runs.

## Conventions

- UI text is plain, American spelling, and uses the real-life metaphors: "pill organizer", "medicine cabinet", "bottle", "refill".
- A medicine's picture is `med.icon` (`MED_ICONS`); empty means "follow the form" (`iconOf`). The list exists in `web/src/lib/types.ts` and `server/src/store.js`; keep them the same.
- Animations (`lib/celebrate.ts`, the `.fresh` classes) must stay off under `prefers-reduced-motion`.
- Journal questions all run 1 (low) to 5 (high), and the built-in ones are worded so 5 is the good end, which keeps every chart reading the same way.
- Chart status colors (taken / some taken / missed / skipped) always carry an icon or number as well as color.
- The app was called Mediminder until 2026-11-12 and was renamed throughout with no carry-over for old installs (there was no data to keep). The old name should not appear anywhere in the code.
- The git history starts on 2026-11-12 with one commit of the already-working app; there is nothing older to look up.
